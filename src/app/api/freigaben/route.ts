import type postgres from 'postgres';
import { NextResponse } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { ladePosteingang, type PosteingangEintrag } from '@/server/services/freigabe/laden';
import { eintragAlsJson } from '@/server/services/freigabe/json';

/**
 * `GET /api/freigaben` — der Posteingang als JSON (APR-01, 05-API-KARTE).
 *
 * Dieselbe Ordnung wie der Bildschirm, aus derselben Funktion: Frist,
 * Risiko, Betrag, Alter (`sortierePosteingang`). Der Handler bleibt duenn —
 * pruefen, laden, antworten.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  try {
    const eintraege = await (db().begin(SCHNAPPSCHUSS,
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht: 'freigabe.lesen' },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        return ladePosteingang(kontext, new Date());
      }))) as readonly PosteingangEintrag[];
    return NextResponse.json({ eintraege: eintraege.map(eintragAlsJson) });
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
