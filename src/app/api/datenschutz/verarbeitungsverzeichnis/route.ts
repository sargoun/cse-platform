import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  alsMarkdown, erstelleVerarbeitungsverzeichnis, type Verarbeitungsverzeichnis,
} from '@/server/services/datenschutz/verzeichnis';

/**
 * `GET /api/datenschutz/verarbeitungsverzeichnis?mandant=&format=md|json`
 * — das Verzeichnis nach Art. 30 DSGVO zum Mitnehmen (LEG-09, Phase 10).
 *
 * **Kein PDF, mit Absicht.** Ein Verzeichnis nach Art. 30 wird fortgeschrieben
 * und vorgelegt, nicht archiviert: eine Aufsicht bekommt den Stand des Tages,
 * an dem sie fragt. Markdown ist die Fassung, die ein Mensch liest und in sein
 * eigenes Dokument übernimmt, JSON die, die eine Prüfung vergleicht. Ein PDF
 * wäre eine dritte Kopie, die ab dem Abruf veraltet — genau das Problem,
 * gegen das diese Seite gebaut ist.
 *
 * **Jeder Abruf steht im Protokoll**, wie bei ACC-10: wer das Verzeichnis
 * seines Mandanten gezogen hat, ist selbst eine Auskunft.
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
    const v = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /*
         * Dasselbe Recht wie die Seite (`routen.generiert.ts`): wer die
         * Einstellungen der Gesellschaft lesen darf, darf ihr Verzeichnis
         * lesen. Zwei verschiedene Rechte für dieselbe Auskunft wären eine
         * Tür mit zwei Schlössern und einem Schlüssel.
         */
        await authorize(
          sitzung, { recht: 'system.einstellung_lesen' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const verzeichnis = await erstelleVerarbeitungsverzeichnis(kontext, new Date());
        await kontext.schreibe(
          `select app.protokolliere('system.verarbeitungsverzeichnis_abgerufen',
                                    'verarbeitungsverzeichnis', $1, null, $2::jsonb,
                                    app.aktiver_mandant())`,
          /* Ein Objekt, kein JSON-Text (D-467). */
          [verzeichnis.sha256, {
            format,
            taetigkeiten: verzeichnis.taetigkeiten.length,
            offen: verzeichnis.offen.length,
          }]);
        return verzeichnis;
      }))) as Verarbeitungsverzeichnis;

    const datei = `verarbeitungsverzeichnis-${slug}`;
    if (format === 'json') {
      return NextResponse.json({
        mandantId: v.mandantId,
        verantwortlicher: v.verantwortlicher,
        abschnitte: v.abschnitte,
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
