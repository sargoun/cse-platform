import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { db as pool } from '@/server/db/pool';
import { alleJobs } from '@/server/jobs/bootstrap';
import {
  alsMarkdown, erstelleLoeschkonzept, type Loeschkonzept,
} from '@/server/services/datenschutz/loeschkonzept';

/**
 * `GET /api/datenschutz/loeschkonzept?mandant=&format=md|json` — das
 * Löschkonzept zum Mitnehmen (LEG-09, Phase 10).
 *
 * Dieselbe Form wie das Verarbeitungsverzeichnis daneben, und aus denselben
 * Gründen: kein PDF (es wird fortgeschrieben, nicht archiviert), jeder Abruf
 * im Protokoll. Es beschreibt Löschungen und führt keine aus.
 */
export const dynamic = 'force-dynamic';

const FORMATE = ['md', 'json'] as const;
type Format = (typeof FORMATE)[number];

export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const p = anfrage.nextUrl.searchParams;
  const slug = (p.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const formatRoh = p.get('format') ?? 'md';
  if (!(FORMATE as readonly string[]).includes(formatRoh)) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }
  const format = formatRoh as Format;

  try {
    const jobs = alleJobs(pool());
    const v = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /*
         * Dasselbe Recht wie die Seite (`routen.generiert.ts`) und wie das
         * Verarbeitungsverzeichnis: beide beschreiben die Konfiguration
         * dieser Gesellschaft und ändern nichts.
         */
        await authorize(
          sitzung, { recht: 'system.einstellung_lesen' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const verzeichnis = await erstelleLoeschkonzept(kontext, jobs, new Date());
        await kontext.schreibe(
          `select app.protokolliere('system.loeschkonzept_abgerufen',
                                    'loeschkonzept', $1, null, $2::jsonb,
                                    app.aktiver_mandant())`,
          /* Ein Objekt, kein JSON-Text (D-467). */
          [verzeichnis.sha256, {
            format,
            fristen: verzeichnis.fristen.length,
            offen: verzeichnis.offen.length,
          }]);
        return verzeichnis;
      }))) as Loeschkonzept;

    const datei = `loeschkonzept-${slug}`;
    if (format === 'json') {
      return NextResponse.json({
        mandantId: v.mandantId,
        firma: v.firma,
        fristen: v.fristen,
        laeufe: v.laeufe,
        sperren: v.sperren,
        offen: v.offen,
        sha256: v.sha256,
        abgerufenAm: v.abgerufenAm,
      }, {
        status: 200,
        headers: {
          'content-disposition': `attachment; filename="${datei}.json"`,
          'x-cse-dokument-sha256': v.sha256,
          'cache-control': 'no-store',
        },
      });
    }
    return new NextResponse(alsMarkdown(v), {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${datei}.md"`,
        'x-cse-dokument-sha256': v.sha256,
        'cache-control': 'no-store',
      },
    });
  } catch (fehler: unknown) {
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
