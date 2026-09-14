import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { alleJobs } from '@/server/jobs/bootstrap';
import { schreibeTextPdf } from '@/server/services/dokument/pdf';
import {
  alsMarkdown, alsText, auslieferungAusUmgebung, erstelleVerfahrensdokumentation,
  type Verfahrensdokumentation,
} from '@/server/services/buchhaltung/verfahrensdokumentation';
import { WirtschaftsjahrFehler } from '@/server/services/buchhaltung/wirtschaftsjahr';

/**
 * `GET /api/buchhaltung/verfahrensdokumentation?mandant=&format=md|pdf|json`
 * — die Verfahrensdokumentation zum Mitnehmen (ACC-10, PR 66, D-485).
 *
 * `md` ist die lesbare Fassung, `pdf` dieselbe als Text-PDF (WinAnsi, ohne
 * Bibliothek — `dokument/pdf.ts`), `json` die kanonische Struktur, deren
 * SHA-256 im Kopf jeder Antwort steht. Jeder Abruf steht im Protokoll.
 */
export const dynamic = 'force-dynamic';

const FORMATE = ['md', 'pdf', 'json'] as const;
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
    const jobs = alleJobs(db());
    const d = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'buchhaltung_konfiguration.lesen' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const doku = await erstelleVerfahrensdokumentation(kontext, { jobs, auslieferung: auslieferungAusUmgebung() });
        await kontext.schreibe(
          `select app.protokolliere('buchhaltung.verfahrensdokumentation_abgerufen', 'verfahrensdokumentation',
                                    $1, null, $2::jsonb, app.aktiver_mandant())`,
          /* Ein Objekt, kein JSON-Text (D-467). */
          [doku.sha256, { format, abschnitte: doku.abschnitte.length, schemastand: doku.schemastand?.migration ?? null }]);
        return doku;
      }))) as Verfahrensdokumentation;

    const datei = `verfahrensdokumentation-${slug}`;
    if (format === 'json') {
      return new NextResponse(Buffer.from(d.kanonisch), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${datei}.json"`,
          'x-cse-dokument-sha256': d.sha256,
          'cache-control': 'no-store',
        },
      });
    }
    if (format === 'pdf') {
      const pdf = schreibeTextPdf({ titel: `Verfahrensdokumentation — ${d.firma}`, text: alsText(d) });
      return new NextResponse(Buffer.from(pdf.bytes), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${datei}.pdf"`,
          'x-cse-dokument-sha256': d.sha256,
          'x-cse-ersetzte-zeichen': String(pdf.ersetzteZeichen),
          'cache-control': 'no-store',
        },
      });
    }
    return new NextResponse(alsMarkdown(d), {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${datei}.md"`,
        'x-cse-dokument-sha256': d.sha256,
        'cache-control': 'no-store',
      },
    });
  } catch (fehler: unknown) {
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
