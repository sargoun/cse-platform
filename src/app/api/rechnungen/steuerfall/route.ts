import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { SteuerfallFehler, schreibeSteuerfall }
  from '@/server/services/finanz/steuerfall';

/**
 * `POST /api/rechnungen/steuerfall` — §13b UStG und §48 EStG an einem Entwurf
 * bestimmen (FIN-09, FIN-10).
 *
 * **Der Tatbestand kommt aus dem Formular, die Folge aus den Nachweisen.** Der
 * Mensch sagt, WAS er geleistet hat (Bauleistung, Gebäudereinigung, oder
 * keines von beiden); ob daraus ein Reverse Charge folgt, entscheidet der
 * hinterlegte §13b-Status am Leistungsdatum — nicht das Formular und nicht das
 * Gewerk der Gesellschaft.
 */
export const dynamic = 'force-dynamic';

const ABWEISUNGEN = new Set([
  'P0001', // raise_exception — fin.reverse_charge_pruefen
  '23514', // check_violation
  '42501', // insufficient_privilege
  '22P02', // invalid_text_representation — unbrauchbarer Tatbestand
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
  /**
   * `''` heisst „keines von beiden" und wird als NULL geschrieben — das ist
   * eine Aussage und kein fehlender Wert: die Leistung ist weder eine
   * Bauleistung noch eine Gebäudereinigungsleistung, und §13b ist nicht
   * berührt.
   */
  const roh = daten.get('grundlage');
  const grundlage = roh === 'bau' || roh === 'gebaeudereinigung' ? roh : null;

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'finanzen.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        /*
         * Erst den Tatbestand, dann die Folge — und beides in EINER
         * Transaktion: ein gesetzter Tatbestand ohne neu bestimmten
         * Steuerfall waere ein Beleg, dessen Kopf das eine sagt und dessen
         * Betraege das andere.
         */
        await kontext.abfrage(
          `update rechnung set reverse_charge = false,
                  reverse_charge_grundlage = $2::bauleistungsart
            where id = $1 and status = 'entwurf'`,
          [rechnungId, grundlage],
        );
        return schreibeSteuerfall(kontext, rechnungId);
      })));

    const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
    return NextResponse.redirect(
      new URL(`/portal/${slug}/finanzen/rechnungen/${rechnungId}`, erwarteterUrsprung(anfrage)), 303);
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
    if (fehler instanceof SteuerfallFehler) {
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
