import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import { alleJobs } from '@/server/jobs/bootstrap';
import { JahrespaketFehler, erstelleJahrespaket, type Jahrespaket } from '@/server/services/buchhaltung/jahrespaket';
import { auslieferungAusUmgebung } from '@/server/services/buchhaltung/verfahrensdokumentation';
import { Z3Fehler } from '@/server/services/buchhaltung/z3';
import { WirtschaftsjahrFehler } from '@/server/services/buchhaltung/wirtschaftsjahr';

/**
 * `GET /api/buchhaltung/jahrespaket?mandant=&jahr=` — das Jahrespaket fuer
 * den Steuerberater als ZIP (ACC-11, PR 67, D-486).
 *
 * Immer moeglich: Listen, Manifest, Dokumentation entstehen im Speicher.
 * Dateien (EXTF, PDF) nur mit verbundenem Belegspeicher — sonst sagt das
 * LIESMICH, was fehlt; ein Paket ohne Dateien ist kein Fehler, ein Paket,
 * das Dateien behauptet, waere einer. Jeder Abruf steht im Protokoll.
 */
export const dynamic = 'force-dynamic';

export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const p = anfrage.nextUrl.searchParams;
  const slug = (p.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const jahrRoh = p.get('jahr') ?? '';
  if (!/^\d{4}$/u.test(jahrRoh)) return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  const jahr = Number(jahrRoh);
  const speicher = waehleSpeicher();

  try {
    const jobs = alleJobs(db());
    const paket = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'buchhaltung.exportieren' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const jp = await erstelleJahrespaket(kontext, speicher, jahr, { jobs, auslieferung: auslieferungAusUmgebung() });
        await kontext.schreibe(
          `select app.protokolliere('buchhaltung.jahrespaket_abgerufen', 'jahrespaket', $1, null,
                                    $2::jsonb, app.aktiver_mandant())`,
          /* Ein Objekt, kein JSON-Text (D-467). */
          [String(jahr), { zipSha256: jp.zipSha256, dateien: jp.dateien.length, belegeImPaket: jp.zahlen.belegeImPaket,
            datevDateien: jp.zahlen.datevDateien, zeilenOhneStapel: jp.zahlen.zeilenOhneStapel,
            speicherVerbunden: jp.speicherVerbunden }]);
        return jp;
      }))) as Jahrespaket;
    if (paket.zip === null || paket.zipSha256 === null) {
      return NextResponse.json({ fehler: 'kein_paket' }, { status: 500 });
    }
    return new NextResponse(Buffer.from(paket.zip), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="jahrespaket-${slug}-${paket.bezeichnung.replace('/', '-')}.zip"`,
        'x-cse-paket-sha256': paket.zipSha256,
        'cache-control': 'no-store',
      },
    });
  } catch (fehler: unknown) {
    if (fehler instanceof JahrespaketFehler || fehler instanceof Z3Fehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message }, { status: 409 });
    }
    if (fehler instanceof NichtVerbundenFehler) {
      return NextResponse.json({ fehler: 'speicher_nicht_verbunden', meldung: fehler.message }, { status: 503 });
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
