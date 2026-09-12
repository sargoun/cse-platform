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
import { RechnungFehler, korrigiere, storniere } from '@/server/services/finanz/rechnung';

/**
 * `POST /api/rechnungen/storno` — die stornierende Buchung (Invariante 4).
 *
 * Zwei Formen, ein Recht (`finanzen.stornieren`):
 *
 *  · `nur_storno` — eine Stornorechnung mit eigener Nummer, die das Original
 *    spiegelt. Fuer den Fall, in dem gar nichts haette berechnet werden
 *    duerfen.
 *  · `korrektur` — Storno PLUS Neuausstellung, beide festgeschrieben und ueber
 *    `rechnung_beziehung` mit dem Original verbunden.
 *
 * Das Original wird in beiden Faellen NICHT angefasst. Es gibt keinen Zustand
 * `storniert`; ein solcher waere ein Uebergang, den der
 * Unveraenderlichkeitsausloeser danach nur abzuweisen haette.
 */
export const dynamic = 'force-dynamic';

/**
 * Die Abweisungen der DATENBANK, die ein MENSCH lesen soll — Platzhalterkreis
 * (O-134), fehlendes Zahlungsziel (O-66), nicht freigegebener Rechnungskreis
 * (O-01), ein bereits festgeschriebener Beleg.
 *
 * Sie sind keine Programmfehler und werden deshalb als 409 mit Text und
 * Hinweis zurueckgegeben statt als 500. Die Liste steht als Konstante und
 * nicht als `catch(alles)`: ein echter Programmfehler soll weiterhin laut
 * sein, und eine breite Ausnahmebehandlung ist genau der Ort, an dem er
 * verschwindet.
 */
const ABWEISUNGEN = new Set([
  '23001', // restrict_violation — die Auslöser dieser Domaene
  'P0001', // raise_exception — die Vorgabe ohne eigenen Code
  'P0002', // no_data_found — kein offener Kreis
  '42501', // insufficient_privilege — Recht fehlt, Policy greift nicht
  '23514', // check_violation — ein CHECK der Rechnungszeile
  '23505', // unique_violation — Nummer oder Kettenposition belegt
  '22023', // invalid_parameter_value — unbrauchbare Nummernmaske
]);

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const rechnungId = daten.get('rechnungId');
  const grund = daten.get('grund');
  const form = daten.get('form');
  if (typeof rechnungId !== 'string' || rechnungId === ''
      || typeof grund !== 'string' || grund.trim().length < 10) {
    // Zehn Zeichen sind keine Formalie: `rechnung_beziehung` verlangt einen
    // Grund, der den Vorgang benennt, und weist „Fehler" ab.
    return NextResponse.json({ fehler: 'grund_fehlt' }, { status: 400 });
  }

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'finanzen.stornieren', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return form === 'korrektur'
          ? korrigiere(kontext, rechnungId, grund.trim())
          : storniere(kontext, rechnungId, grund.trim());
      })));

    const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
    return NextResponse.redirect(
      new URL(`/portal/${slug}/finanzen/rechnungen`, anfrage.nextUrl.origin), 303);
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
    const pg = fehler as { code?: unknown; message?: unknown; hint?: unknown };
    if (typeof pg.code === 'string' && ABWEISUNGEN.has(pg.code)) {
      return NextResponse.json(
        { fehler: 'abgewiesen', text: String(pg.message ?? ''), hinweis: String(pg.hint ?? '') },
        { status: 409 });
    }
    throw fehler;
  }
}
