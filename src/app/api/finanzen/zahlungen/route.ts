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
import { GeldFehler, parseGeld } from '@/server/services/finanz/geld';
import {
  ZahlungFehler, storniereZahlung, verbucheZahlungseingang, type Zahlungsart,
} from '@/server/services/finanz/zahlung/index';

/**
 * `POST /api/finanzen/zahlungen` — einen Zahlungseingang erfassen (FIN-14,
 * ACC-04; `05-API-KARTE.md` §937).
 *
 * **Erfassen, nicht auslösen.** Es gibt keine Bankanbindung. Diese Route
 * schreibt auf, dass Geld angekommen ist; sie bewegt keines (keine erfundenen
 * Integrationen).
 *
 * Der Handler bleibt dünn: prüfen, den Dienst rufen, antworten. Die
 * Überzahlung entscheidet nicht er, sondern `verbucheZahlungseingang` — und
 * die Datenbank weist zurück, was sie nicht halten kann.
 *
 * **Warum `bar` hier nicht abgefangen wird.** Eine Barzahlung ohne Kasse
 * scheitert an `zahlung_bar_braucht_kasse` (0121), und diese Route übersetzt
 * die Abweisung. Sie ein zweites Mal in TypeScript zu prüfen hiesse, dieselbe
 * Regel an zwei Stellen zu pflegen — und die eine, die zählt, steht in der
 * Datenbank.
 */
export const dynamic = 'force-dynamic';

const MITTEL: ReadonlySet<string> = new Set(
  ['ueberweisung', 'lastschrift', 'bar', 'karte', 'verrechnung']);

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(`/portal/${slug}/finanzen/zahlungen`, anfrage.nextUrl.origin);
  if (hinweis !== undefined) url.searchParams.set('hinweis', hinweis);
  return NextResponse.redirect(url, 303);
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

  const aktion = text('aktion') ?? 'erfassen';

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'zahlung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'stornieren') {
          const zahlungId = text('zahlungId');
          const grund = text('grund');
          if (zahlungId === null || grund === null) {
            return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
          }
          await storniereZahlung(kontext, zahlungId, grund);
          return zurueck(anfrage, 'storniert');
        }

        const rechnungId = text('rechnungId');
        const betragRoh = text('betrag');
        const zahlungsdatum = text('zahlungsdatum');
        const mittel = text('zahlungsmittel');
        if (rechnungId === null || betragRoh === null || zahlungsdatum === null
            || mittel === null || !MITTEL.has(mittel)) {
          return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
        }
        /*
         * `YYYY-MM-DD`, wie ein `<input type="date">` es sendet. Ohne diese
         * Schranke landete jede Zeichenkette im `::date`-Cast und ergaebe
         * einen rohen Postgres-Syntaxfehler statt einer Abweisung.
         */
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(zahlungsdatum)) {
          return NextResponse.json({ fehler: 'ungueltig', felder: ['zahlungsdatum'] },
            { status: 400 });
        }

        const ergebnis = await verbucheZahlungseingang(kontext, {
          rechnungId,
          betragCent: parseGeld(betragRoh),
          zahlungsdatum,
          zahlungsmittel: mittel as Zahlungsart,
          bankkontoId: text('bankkontoId'),
          referenz: text('referenz'),
        });

        /*
         * Die Überzahlung wird BENANNT und nicht verschluckt: die Seite zeigt
         * danach den Guthabenposten, und der Hinweis sagt, dass einer
         * entstanden ist.
         */
        return zurueck(anfrage,
          ergebnis.ueberzahlungCent > 0n ? 'guthaben' : 'erfasst');
      }))) as NextResponse;
  } catch (fehler) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof GeldFehler) {
      return NextResponse.json({ fehler: 'ungueltig', felder: ['betrag'] }, { status: 400 });
    }
    if (fehler instanceof ZahlungFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'nicht_gefunden' ? 404 : 409 });
    }
    throw fehler;
  }
}
