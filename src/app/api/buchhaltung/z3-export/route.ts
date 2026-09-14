import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { Z3Fehler, erstelleZ3Paket, type Z3Paket } from '@/server/services/buchhaltung/z3';
import { WirtschaftsjahrFehler } from '@/server/services/buchhaltung/wirtschaftsjahr';

/**
 * `GET /api/buchhaltung/z3-export?mandant=&jahr=&format=zip|index` — die
 * Datentraegerueberlassung eines Wirtschaftsjahrs (ACC-09, § 147 Abs. 6 AO,
 * PR 66, D-485).
 *
 * `zip` ist das Paket; `index` nur die Strukturbeschreibung, damit ein
 * Pruefer vorab sieht, was kommt. Beides entsteht im Speicher, ohne
 * Objektspeicher — ein Z3-Paket gibt es immer. Jeder Abruf steht im
 * Protokoll mit dem SHA-256 des Pakets: Daten verlassen das Haus.
 */
export const dynamic = 'force-dynamic';

function dateiname(slug: string, p: Z3Paket, endung: string): string {
  return `z3-${slug}-${p.bezeichnung.replace('/', '-')}${endung}`;
}

export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const p = anfrage.nextUrl.searchParams;
  const slug = (p.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const jahrRoh = p.get('jahr') ?? '';
  const format = p.get('format') ?? 'zip';
  if (!/^\d{4}$/u.test(jahrRoh) || (format !== 'zip' && format !== 'index')) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }
  const jahr = Number(jahrRoh);

  try {
    const paket = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'buchhaltung.exportieren' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const z3 = await erstelleZ3Paket(kontext, jahr);
        await kontext.schreibe(
          `select app.protokolliere('buchhaltung.z3_abgerufen', 'z3_paket', $1, null,
                                    $2::jsonb, app.aktiver_mandant())`,
          /* Ein Objekt, kein JSON-Text (D-467). */
          [String(jahr), { format, zipSha256: z3.zipSha256, tabellen: z3.tabellen.length,
            zeilen: z3.tabellen.reduce((s, t) => s + t.zeilen, 0), unvollstaendig: z3.unvollstaendig }]);
        return z3;
      }))) as Z3Paket;

    const bytes = format === 'zip' ? paket.zip : paket.indexXml;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': format === 'zip' ? 'application/zip' : 'application/xml; charset=utf-8',
        'content-disposition': `attachment; filename="${dateiname(slug, paket, format === 'zip' ? '.zip' : '-index.xml')}"`,
        'x-cse-paket-sha256': paket.zipSha256,
        'cache-control': 'no-store',
      },
    });
  } catch (fehler: unknown) {
    if (fehler instanceof Z3Fehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message }, { status: 409 });
    }
    if (fehler instanceof WirtschaftsjahrFehler) {
      return NextResponse.json({ fehler: 'wirtschaftsjahr', meldung: fehler.message }, { status: 400 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }
}
