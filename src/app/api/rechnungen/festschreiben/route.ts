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
import { RechnungFehler, finalisiere } from '@/server/services/finanz/rechnung';

/**
 * `POST /api/rechnungen/festschreiben` — das einseitige Tor (FIN-02, FIN-03).
 *
 * EIGENE Adresse und EIGENES Recht (`finanzen.festschreiben`), weil dieser
 * Uebergang etwas tut, was kein anderer tut: er vergibt eine Nummer aus einem
 * lueckenlosen Kreis und macht einen Beleg unveraenderlich. Mit dem
 * Schreibrecht zusammengelegt haette jeder, der eine Position tippen darf,
 * auch Rechnungen ausgestellt.
 *
 * **POST und kein GET.** Ein Uebergang, den ein weitergeleiteter Link
 * ausloesen kann, ist keiner, den jemand entschieden hat.
 *
 * Die ganze Transaktion ist die des Dienstes: beide Definer-Aufrufe liegen
 * darin, und die Sperre auf dem Nummernkreis haelt bis zum COMMIT (§5.6).
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
  if (typeof rechnungId !== 'string' || rechnungId === '') {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'finanzen.festschreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return finalisiere(kontext, rechnungId);
      })));

    const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
    return NextResponse.redirect(
      new URL(`/portal/${slug}/finanzen/rechnungen/${rechnungId}`, anfrage.nextUrl.origin), 303);
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
