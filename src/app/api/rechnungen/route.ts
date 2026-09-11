import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { cent } from '@/server/services/finanz/geld';
import { milliMenge } from '@/server/services/finanz/menge';
import {
  RechnungFehler, fuegePositionHinzu, fuegeZeitPositionHinzu, legeEntwurfAn,
} from '@/server/services/finanz/rechnung';
import {
  QuellenFehler, type QuelleEingabe,
} from '@/server/services/finanz/positionsquelle';

/**
 * `POST /api/rechnungen` — den Entwurf anlegen und ihn bestuecken.
 *
 * Beide Handlungen tragen dasselbe Recht (`finanzen.schreiben`) und laufen
 * deshalb ueber dieselbe Adresse. Die drei Uebergaenge, die ein EIGENES Recht
 * tragen — festschreiben, verwerfen, stornieren — haben je eine eigene
 * Adresse; sie teilen sich keine, weil sonst ein Recht das andere mit
 * durchliesse.
 *
 * Der Handler bleibt duenn: pruefen, den Dienst rufen, antworten. Gerechnet
 * wird in `services/finanz`, entschieden in der Datenbank.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, pfad: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  return NextResponse.redirect(
    new URL(`/portal/${slug}/finanzen/rechnungen${pfad}`, anfrage.nextUrl.origin), 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const aktion = text('aktion') ?? 'anlegen';

  try {
    const ziel = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'finanzen.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        /**
         * **Die Zeile AUS der Zeiterfassung** (TIM-12, FIN-07) — der Weg, den
         * die Seitenkarte „billing type, then source" nennt.
         *
         * Er steht vor `position`, weil er der Regelfall sein soll: eine Zeile,
         * die aus freigegebenen Zeiteintraegen entsteht, traegt ihren Beleg
         * von selbst und kann sich nicht vertippen. Die Handeingabe darunter
         * ist die Ausnahme und verlangt deshalb eine Begruendung.
         */
        if (aktion === 'aus-zeiten') {
          const rechnungId = text('rechnungId');
          const stundensatz = text('stundensatzCent');
          if (rechnungId === null || stundensatz === null) return null;
          await fuegeZeitPositionHinzu(kontext, {
            rechnungId,
            bezeichnung: text('bezeichnung') ?? 'Geleistete Stunden',
            stundensatzCent: cent(BigInt(stundensatz)),
            steuergruppe: text('steuergruppe') ?? 'ust_19',
            auftragLeistungId: text('auftragLeistungId'),
            auftragId: text('auftragId'),
            vonDatum: text('vonDatum'),
            bisDatum: text('bisDatum'),
          });
          return `/${rechnungId}`;
        }

        if (aktion === 'position') {
          const rechnungId = text('rechnungId');
          const menge = text('menge');
          const einzelpreis = text('einzelpreisCent');
          if (rechnungId === null || menge === null || einzelpreis === null) {
            return null;
          }
          /**
           * **Die Herkunft ist Pflicht** (FIN-07, §4.4). Das Formular bietet
           * genau zwei Wege an: eine Vertragszeile als Beleg, oder
           * ausdruecklich „von Hand" MIT Begruendung. Einen dritten — „ohne
           * Angabe" — gibt es nicht, und der Handler erfindet auch keinen:
           * fehlt die Begruendung, weist der Dienst ab, und die Datenbank
           * taete es beim COMMIT ohnehin.
           */
          const herkunft = text('herkunft') ?? 'manuell';
          const quellen: QuelleEingabe[] = herkunft === 'vertrag'
            ? [{ typ: 'vertrag', id: text('auftragLeistungId') }]
            : [{ typ: 'manuell', notiz: text('herkunftNotiz') }];

          /**
           * Menge und Preis kommen als ganze Zahlen herein — Tausendstel und
           * Cent (K-16, Invariante 1). Die Oberflaeche rechnet nicht um: eine
           * Gleitkommazahl an dieser Stelle waere ein Bruchteil eines Cents,
           * der spaeter niemandem mehr auffaellt.
           */
          await fuegePositionHinzu(kontext, {
            rechnungId,
            bezeichnung: text('bezeichnung') ?? '',
            beschreibung: text('beschreibung'),
            menge: milliMenge(BigInt(menge)),
            einheit: text('einheit') ?? '',
            einzelpreisCent: cent(BigInt(einzelpreis)),
            steuergruppe: text('steuergruppe') ?? 'ust_19',
            auftragLeistungId: herkunft === 'vertrag' ? text('auftragLeistungId') : null,
            quellen,
          });
          return `/${rechnungId}`;
        }

        const kundeId = text('kundeId');
        if (kundeId === null) return null;
        const zielTage = text('zahlungszielTage');
        const neu = await legeEntwurfAn(kontext, {
          kundeId,
          objektId: text('objektId'),
          leistungVon: text('leistungVon'),
          leistungBis: text('leistungBis'),
          // Kein Vorgabewert (§4.2): fehlt die Eingabe, loest der Dienst auf,
          // und bleibt es NULL, weist die Festschreibung benannt ab.
          zahlungszielTage: zielTage === null ? null : Number(zielTage),
          kopftext: text('kopftext'),
        });
        return `/${neu}`;
      })) as Promise<string | null>);

    if (ziel === null) return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
    return zurueck(anfrage, ziel);
  } catch (fehler) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    if (fehler instanceof RechnungFehler) {
      return NextResponse.json({ fehler: fehler.grund, text: fehler.message }, { status: 409 });
    }
    /**
     * Eine fehlende oder unbelegbare Herkunft ist eine Abweisung, kein
     * Programmfehler (FIN-07): der Mensch hat die Begruendung vergessen oder
     * im Zeitraum liegt keine freigegebene Stunde. 409 mit Text, nicht 500.
     */
    if (fehler instanceof QuellenFehler) {
      return NextResponse.json({ fehler: fehler.grund, text: fehler.message }, { status: 409 });
    }
    throw fehler;
  }
}
