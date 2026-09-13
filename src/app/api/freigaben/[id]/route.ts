import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { oeffneFreigabe, type FreigabeAnsicht } from '@/server/services/freigabe/laden';
import { ansichtAlsJson } from '@/server/services/freigabe/json';

/**
 * `GET /api/freigaben/[id]` — die Pruefungsansicht (APR-02, APR-03, APR-08).
 *
 * **Die eine Leseroute mit vorgeschriebener Nebenwirkung:** sie schreibt die
 * `freigabe_ansicht`-Zeile, auf der die Pruefdauer gemessen wird (K-13, §4.6).
 * Deshalb eine SCHREIBENDE Transaktion und `schreibend: true` — die
 * Gruppenansicht kann nichts vermerken und bekommt hier 404; ihr Posteingang
 * ist `/portal/gruppe/freigaben` (Phase 8).
 *
 * `geoeffnet_am` kommt aus keiner Anfrage: die Datenbank setzt `now()`.
 */
export const dynamic = 'force-dynamic';

/** Ein Wort ist keine Kennung — ohne die Wache waere `where id = $1` ein 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function GET(
  _anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  try {
    const ansicht = await (db().begin(
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht: 'freigabe.lesen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        return oeffneFreigabe(kontext, id, 'web');
      }))) as FreigabeAnsicht | null;
    if (ansicht === null) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    return NextResponse.json(ansichtAlsJson(ansicht));
  } catch (fehler: unknown) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }
}
