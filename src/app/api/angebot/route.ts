import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
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

type Aktion = 'aus_raumbuch' | 'versenden' | 'in_auftrag';

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
    art: text('art'), startDatum: text('startDatum'),
  };
}

const ARTEN = new Set(['einzelauftrag', 'rahmenvertrag', 'dauerauftrag', 'projekt']);

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
          { recht: 'angebot.versenden', schreibend: true },
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

          const angebotId = await legeAngebotAn(dbSchicht, { kundeId, titel, objektId });
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
          if (angebotId === undefined || art === undefined || !ARTEN.has(art)
              || startDatum === undefined) {
            return { art: 'ungueltig' as const };
          }
          const auftrag = await wandleInAuftrag(dbSchicht, angebotId, {
            art: art as 'einzelauftrag', verantwortlichBenutzerId: sitzung.benutzerId,
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

    const jsonGewuenscht = (anfrage.headers.get('content-type') ?? '')
      .includes('application/json');
    if (jsonGewuenscht) return NextResponse.json(ergebnis, { status: 200 });

    const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
    const ziel = slug === ''
      ? '/portal'
      : `/portal/${slug}/angebote/${ergebnis.angebotId}`;
    return NextResponse.redirect(new URL(ziel, anfrage.nextUrl.origin), 303);
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
    if (fehler instanceof AngebotFehler) {
      return NextResponse.json({ fehler: fehler.grund, text: fehler.message }, { status: 409 });
    }
    if (fehler instanceof NummernkreisFehler) {
      return NextResponse.json({ fehler: fehler.grund, text: fehler.message }, { status: 409 });
    }
    if (fehler instanceof TarifFehler) {
      return NextResponse.json({ fehler: 'turnus', text: fehler.message }, { status: 400 });
    }
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    if (/unbestaetigte Werte/u.test(text)) {
      return NextResponse.json({ fehler: 'kalkulation_platzhalter', text }, { status: 409 });
    }
    throw fehler;
  }
}
