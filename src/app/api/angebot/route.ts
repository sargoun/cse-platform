import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung, internesZiel }
  from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtGefundenFehler, NichtAngemeldetFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { ladeKalkulationsgrundlage } from '@/server/services/kalkulation/raumbuch';
import { kalkuliere } from '@/server/services/kalkulation/index';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF, PLATZHALTER_TURNUSSE, TarifFehler }
  from '@/server/services/kalkulation/tarif';
import {
  AngebotFehler, legeAngebotAn, uebernimmKalkulation, versendeAngebot, wandleInAuftrag,
} from '@/server/services/angebot/index';
import { NummernkreisFehler } from '@/server/services/finanz/nummernkreis';

/**
 * `POST /api/angebot` — die drei Uebergaenge des Angebots.
 *
 * Alle drei sind POST und keiner ist ein GET: ein Angebot zu versenden ist
 * die Handlung, die Invariante 7 meint ("nothing leaves without human
 * approval"), und eine Handlung, die ein weitergeleiteter Link ausloest, ist
 * keine Handlung, die jemand entschieden hat.
 *
 * Der Handler bleibt duenn: pruefen, den Dienst rufen, antworten. Gerechnet
 * wird in `services/`, entschieden in der Datenbank.
 */
export const dynamic = 'force-dynamic';

/** JSON oder Formular — dieselbe Frage im Erfolgs- und im Fehlerweg. */
function jsonAngefragt(anfrage: NextRequest): boolean {
  return (anfrage.headers.get('content-type') ?? '').includes('application/json');
}

type Aktion = 'aus_raumbuch' | 'versenden' | 'in_auftrag';

/**
 * Je Handlung ihr eigenes Recht — nicht ein Recht fuer alle drei.
 *
 * Vorher stand vor der Verzweigung EINE Pruefung auf `angebot.versenden`, und
 * darunter lagen drei verschiedene Handlungen. Der Katalog fuehrt
 * `angebot.annahme_erfassen` als eigenes Recht, und `04-SEITENKARTE.md` haengt
 * die Annahme daran: eine Rolle, die versenden darf, konnte damit ein Angebot
 * als angenommen buchen und einen Auftrag anlegen — eine kaufmaennische
 * Zusage, fuer die sie nie berechtigt wurde.
 *
 * Ein unbekannter Wert bekommt das ENGSTE Recht, nicht das weiteste: er faellt
 * ohnehin gleich auf `ungueltig`, aber die Reihenfolge der Pruefungen soll
 * nicht darueber entscheiden, ob das auffaellt.
 */
function rechtFuer(aktion: Aktion | undefined): string {
  switch (aktion) {
    case 'aus_raumbuch': return 'angebot.schreiben';
    case 'versenden': return 'angebot.versenden';
    case 'in_auftrag': return 'angebot.annahme_erfassen';
    default: return 'angebot.annahme_erfassen';
  }
}

/**
 * `| undefined` steht ausdruecklich da, nicht nur `?`.
 *
 * `exactOptionalPropertyTypes` unterscheidet "Feld fehlt" von "Feld ist
 * undefined", und ein Formular liefert das zweite. Die Unterscheidung ist an
 * anderen Stellen wertvoll; hier waere sie eine Huerde ohne Gewinn.
 */
interface Koerper {
  readonly aktion?: string | undefined;
  readonly objektId?: string | undefined;
  readonly kundeId?: string | undefined;
  readonly titel?: string | undefined;
  readonly turnus?: string | undefined;
  readonly angebotId?: string | undefined;
  readonly art?: string | undefined;
  readonly startDatum?: string | undefined;
  /**
   * Die Anfrage, auf die das Angebot aus dem Raumbuch antwortet (V-138,
   * CRM-05). Optional; `legeAngebotAn` prueft Gesellschaft und Kunden.
   */
  readonly leadId?: string | undefined;
  /**
   * Wohin ein FORMULAR nach einem abgewiesenen Uebergang zurueckkehrt.
   *
   * Ohne dieses Feld beantwortete die Route jeden `AngebotFehler` mit
   * `{"fehler":"ohne_freigabe"}` als JSON — ein Mensch, der auf
   * `/angebote/[id]/versand` gedrueckt hatte, landete auf einer weissen Seite
   * mit einem Datenfeld. Die Seite fuehrt fuer genau diese Gruende eine
   * Satztabelle; unerreichbar war nur der Weg dorthin. `uebergang.ts` macht
   * es fuer die anderen Routen dieser Runde genauso (D-562).
   */
  readonly zurueck?: string | undefined;
}

async function koerperAus(anfrage: NextRequest): Promise<Koerper> {
  const typ = anfrage.headers.get('content-type') ?? '';
  if (typ.includes('application/json')) return (await anfrage.json()) as Koerper;
  const daten = await anfrage.formData();
  const text = (name: string): string | undefined => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert !== '' ? wert : undefined;
  };
  return {
    aktion: text('aktion'), objektId: text('objektId'), kundeId: text('kundeId'),
    titel: text('titel'), turnus: text('turnus'), angebotId: text('angebotId'),
    art: text('art'), startDatum: text('startDatum'), zurueck: text('zurueck'),
    leadId: text('leadId'),
  };
}

/**
 * Die Auftragsarten — als getypte Menge mit einem Waechter, nicht als
 * `Set<string>` plus `as`.
 *
 * Vorher stand hier `art: art as 'einzelauftrag'`. Das ist eine Zusicherung an
 * den Uebersetzer und aendert den LAUFZEITWERT nicht — gespeichert wurde also
 * die richtige Art. Falsch war die Zusage: sie schaltete genau die Pruefung
 * ab, die `AuftragAnlegen` traegt, und haette jede spaetere Aenderung an der
 * Aufzaehlung stillschweigend durchgelassen. Ein Waechter sagt dasselbe, nur
 * ueberpruefbar.
 */
const ARTEN = ['einzelauftrag', 'rahmenvertrag', 'dauerauftrag', 'projekt'] as const;
type Auftragsart = (typeof ARTEN)[number];

function istAuftragsart(wert: string): wert is Auftragsart {
  return (ARTEN as readonly string[]).includes(wert);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const koerper = await koerperAus(anfrage);
  const aktion = koerper.aktion as Aktion | undefined;

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const dbSchicht = {
          abfrage: kontext.abfrage.bind(kontext),
          unsafe: async (s: string, w: readonly unknown[] = []) =>
            (await tx.unsafe(s, w as never[])) as readonly unknown[],
        };

        /**
         * Linie 1 — IN der gebundenen Transaktion, nicht davor.
         *
         * `app.hat_recht` liest die Sitzungsbindung; ausserhalb antwortet es
         * `false` auf alles, und die Pruefung waere eine, die immer
         * dasselbe sagt. Linie 2 ist RLS und prueft dieselbe Frage noch
         * einmal — sie ersetzt diese hier nicht, denn null Zeilen sind von
         * "gibt es nicht" ununterscheidbar (AUT-05).
         */
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: rechtFuer(aktion), schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'aus_raumbuch') {
          const { objektId, kundeId, titel } = koerper;
          if (objektId === undefined || kundeId === undefined || titel === undefined) {
            return { art: 'ungueltig' as const };
          }
          const turnus = koerper.turnus ?? '1_pro_monat';
          if (!PLATZHALTER_TURNUSSE.includes(turnus)) return { art: 'ungueltig' as const };

          const stichtag = new Date();
          const grundlage = await ladeKalkulationsgrundlage(dbSchicht, objektId, stichtag);
          const frequenz = PLATZHALTER_FREQUENZ.frequenz(turnus);
          const tarif = PLATZHALTER_TARIF.tarif(sitzung.aktiverMandantId!, 'reinigung');
          const kalk = kalkuliere({
            posten: grundlage.posten,
            frequenz,
            tarif,
            flaecheOhneBelagsart: grundlage.flaecheOhneBelagsart,
            // Beide Luecken gehen MIT — `uebernimmKalkulation` weist ein
            // Angebot ueber nicht bepreisbare Flaeche ab (D-97).
            ohneGueltigenLeistungswert: grundlage.ohneGueltigenLeistungswert,
          });
          if (kalk.zeilen.length === 0) return { art: 'leer' as const };

          const angebotId = await legeAngebotAn(dbSchicht, {
            kundeId, titel, objektId,
            ...(koerper.leadId === undefined ? {} : { leadId: koerper.leadId }),
          });
          await uebernimmKalkulation(dbSchicht, angebotId, kalk,
            { objektId, turnusLabel: turnus, tarif, frequenz });
          return { art: 'angelegt' as const, angebotId };
        }

        if (aktion === 'versenden') {
          if (koerper.angebotId === undefined) return { art: 'ungueltig' as const };
          const versand = await versendeAngebot(
            dbSchicht, koerper.angebotId, sitzung.benutzerId);
          return { art: 'versendet' as const, angebotId: koerper.angebotId, versand };
        }

        if (aktion === 'in_auftrag') {
          const { angebotId, art, startDatum } = koerper;
          if (angebotId === undefined || art === undefined || !istAuftragsart(art)
              || startDatum === undefined) {
            return { art: 'ungueltig' as const };
          }
          const auftrag = await wandleInAuftrag(dbSchicht, angebotId, {
            art, verantwortlichBenutzerId: sitzung.benutzerId,
            startDatum,
          });
          return { art: 'gewandelt' as const, angebotId, auftrag };
        }

        return { art: 'ungueltig' as const };
      })) as Promise<
        | { art: 'ungueltig' } | { art: 'leer' }
        | { art: 'angelegt'; angebotId: string }
        | { art: 'versendet'; angebotId: string; versand: { angebotsnummer: string } }
        | { art: 'gewandelt'; angebotId: string; auftrag: { auftragId: string } }>);

    if (ergebnis.art === 'ungueltig') {
      return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
    }
    if (ergebnis.art === 'leer') {
      // Kein Fehler des Aufrufers: das Raumbuch traegt keine kalkulierbare
      // Flaeche. Die Antwort sagt das, statt ein leeres Angebot anzulegen.
      return NextResponse.json({ fehler: 'nichts_zu_kalkulieren' }, { status: 409 });
    }

    if (jsonAngefragt(anfrage)) return NextResponse.json(ergebnis, { status: 200 });

    const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
    const ziel = slug === ''
      ? '/portal'
      : `/portal/${slug}/angebote/${ergebnis.angebotId}`;
    return NextResponse.redirect(new URL(ziel, erwarteterUrsprung(anfrage)), 303);
  } catch (fehler) {
    // Die Antworten des Tors: 401 ohne Sitzung, 403 ohne zweiten Faktor,
    // 404 fuer ein fehlendes Recht — nie 403, das die Existenz bestaetigte.
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    /**
     * Die benannten Fehler der Dienste werden zu Antworten, die ein Mensch
     * lesen kann — ein 500 mit Stapelspur sagt der Leitung nichts darueber,
     * dass die Kalkulation noch auf offenen Werten steht.
     */
    const grund = fehler instanceof AngebotFehler ? fehler.grund
      : fehler instanceof NummernkreisFehler ? fehler.grund
        : fehler instanceof TarifFehler ? 'turnus'
          : /unbestaetigte Werte/u.test(
            fehler instanceof Error ? fehler.message : String(fehler))
            ? 'kalkulation_platzhalter' : null;
    if (grund !== null) {
      /**
       * Ein FORMULAR bekommt seine Seite zurueck, kein JSON — derselbe Weg
       * wie in `uebergang.ts` (D-562).
       *
       * `/angebote/[id]/versand` fuehrt eine Satztabelle fuer genau diese
       * Gruende (`ohne_freigabe`, `kein_kreis`, `luecke` …) und einen
       * `?fehler=`-Block, der sie zeigt. Ohne dieses versteckte Feld war
       * beides unerreichbar: ein abgewiesener Versand — eine veraltete Seite,
       * zwei Klicks im Rennen — endete auf einer weissen Seite mit
       * `{"fehler":"…"}`. `internesZiel` laesst nur einen Pfad DIESER
       * Anwendung durch; ein fremdes Ziel im Feld waere eine offene Umleitung.
       */
      const zurueck = koerper.zurueck;
      if (!jsonAngefragt(anfrage) && zurueck !== undefined && zurueck !== '') {
        const trenner = zurueck.includes('?') ? '&' : '?';
        return NextResponse.redirect(
          internesZiel(
            `${zurueck}${trenner}fehler=${encodeURIComponent(grund)}`, '/portal', anfrage),
          303);
      }
      const text = fehler instanceof Error ? fehler.message : String(fehler);
      return NextResponse.json(
        { fehler: grund, text }, { status: fehler instanceof TarifFehler ? 400 : 409 });
    }
    throw fehler;
  }
}
