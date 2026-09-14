import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { NichtVerbundenFehler, SupabaseSpeicher } from '@/server/storage/adapter';
import {
  PruefbuendelFehler, erstellePruefbuendel, packePruefbuendel, type Pruefbuendel,
} from '@/server/services/buchhaltung/pruefbuendel';
import { WirtschaftsjahrFehler } from '@/server/services/buchhaltung/wirtschaftsjahr';

/**
 * `GET /api/dokumente/buendel?mandant=&jahr=&format=manifest|zip` — das
 * Pruefbuendel eines Wirtschaftsjahrs zum Herunterladen (DOC-08, PR 64).
 *
 * `manifest` gibt es immer: kanonisches JSON, mit dem SHA-256 im Kopf.
 * `zip` gibt es nur mit verbundenem Belegspeicher und ohne Exportsperre —
 * sonst 503 bzw. 409 mit dem Satz, nie ein Archiv ohne Dateien. Jeder Abruf
 * steht im Protokoll: ein Pruefbuendel verlaesst das Haus.
 */
export const dynamic = 'force-dynamic';

function dateiname(slug: string, b: Pruefbuendel, endung: string): string {
  return `pruefbuendel-${slug}-${b.bezeichnung.replace('/', '-')}${endung}`;
}

export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const p = anfrage.nextUrl.searchParams;
  const slug = (p.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const jahrRoh = p.get('jahr') ?? '';
  const format = p.get('format') ?? 'manifest';
  if (!/^\d{4}$/u.test(jahrRoh) || (format !== 'manifest' && format !== 'zip')) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }
  const jahr = Number(jahrRoh);
  const speicher = new SupabaseSpeicher();

  try {
    const { buendel, bytes } = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'dokument.buendel_exportieren' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const b = await erstellePruefbuendel(kontext, jahr);
        const aus = format === 'zip' ? await packePruefbuendel(b, speicher) : b.manifest;
        await kontext.schreibe(
          `select app.protokolliere('dokument.buendel_abgerufen', 'pruefbuendel', $1, null,
                                    $2::jsonb, app.aktiver_mandant())`,
          [String(jahr), JSON.stringify({ format, manifestSha256: b.manifestSha256,
            dateien: b.paket?.dateien.length ?? 0, sperre: b.sperre !== null })]);
        return { buendel: b, bytes: aus };
      }))) as { buendel: Pruefbuendel; bytes: Uint8Array };

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': format === 'zip' ? 'application/zip' : 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${dateiname(slug, buendel, format === 'zip' ? '.zip' : '-manifest.json')}"`,
        'x-cse-manifest-sha256': buendel.manifestSha256,
        'cache-control': 'no-store',
      },
    });
  } catch (fehler: unknown) {
    if (fehler instanceof PruefbuendelFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'nicht_verbunden' ? 503 : 409 });
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
