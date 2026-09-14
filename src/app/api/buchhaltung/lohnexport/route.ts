import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { LohnexportFehler, erstelleLohnexport, type Lohnexport } from '@/server/services/zeit/lohnexport';

/**
 * `GET /api/buchhaltung/lohnexport?mandant=&monat=JJJJ-MM` — die Zeitdaten
 * eines Monats fuer das Lohnsystem als ZIP (ACC-12, TIM-13, D-06, PR 67).
 *
 * Das Format ist ein Platzhalter (O-27); die Datei sagt es. Personenbezogene
 * Daten verlassen das Haus — unter `zeit.exportieren`, und jeder Abruf steht
 * im Protokoll mit Monat, Hash und Zahl der Beschaeftigten.
 */
export const dynamic = 'force-dynamic';

export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const p = anfrage.nextUrl.searchParams;
  const slug = (p.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const monat = p.get('monat') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(monat)) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    const e = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'zeit.exportieren' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const lohn = await erstelleLohnexport(kontext, monat);
        await kontext.schreibe(
          `select app.protokolliere('zeit.lohnexport_abgerufen', 'lohnexport', $1, null,
                                    $2::jsonb, app.aktiver_mandant())`,
          /* Ein Objekt, kein JSON-Text (D-467). */
          [monat, { zipSha256: lohn.zipSha256, format: lohn.format.schluessel, beschaeftigte: lohn.zahlen.beschaeftigte,
            gesperrt: lohn.zahlen.gesperrt, unfreigegeben: lohn.zahlen.unfreigegeben }]);
        return lohn;
      }))) as Lohnexport;

    return new NextResponse(Buffer.from(e.zip), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="lohnexport-${slug}-${monat}.zip"`,
        'x-cse-paket-sha256': e.zipSha256,
        'x-cse-format': e.format.schluessel,
        'cache-control': 'no-store',
      },
    });
  } catch (fehler: unknown) {
    if (fehler instanceof LohnexportFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message }, { status: 400 });
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
