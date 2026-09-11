import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  ladeAusserhalbLv, nachtragTitelVorschlag, warnungsText,
  type AusserhalbLvWarnung,
} from '@/server/services/bau/ausserhalb-lv';

/**
 * `GET /api/bau/nachtrag-warnungen` — Leistung ausserhalb des LV ohne
 * Nachtrag (BAU-05, API-KARTE §C.15).
 *
 * **Der Ausfall dahinter ist Geld.** Gemessen und gebuchte Leistung ohne
 * Vertragsposition ist nach § 2 Abs. 8 VOB/B im Zweifel unentgeltlich; der
 * Fehler faellt bei der Schlussrechnung auf, wenn die Ankuendigungsfrist des
 * § 2 Abs. 6 Nr. 1 laengst verstrichen ist.
 *
 * **Der Satz kommt aus dem Dienst, nicht aus dem Handler.** `warnungsText`
 * und `nachtragTitelVorschlag` stehen an EINER Stelle; eine zweite Fassung
 * hier waere die, die beim naechsten Feld auseinanderlaeuft. Der Handler
 * autorisiert, ruft und gibt zurueck.
 *
 * `bau.lesen` und nicht `bau.nachtrag_anmelden`: die Liste zu SEHEN heisst
 * nicht, einen Anspruch anmelden zu duerfen — sie steht auch in der
 * Projektleitung, die nur liest.
 */
export const dynamic = 'force-dynamic';

export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const projektId = anfrage.nextUrl.searchParams.get('projekt_id');

  let warnungen: readonly AusserhalbLvWarnung[];
  try {
    warnungen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'bau.lesen', schreibend: false },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return ladeAusserhalbLv(kontext, {
          projektId: projektId === null || projektId === '' ? null : projektId,
        });
      })) as Promise<readonly AusserhalbLvWarnung[]>);
  } catch (fehler: unknown) {
    // AUT-06: ein fehlendes Recht sieht von aussen aus wie eine fehlende Zeile.
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    throw fehler;
  }

  return NextResponse.json({
    warnungen: warnungen.map((w) => ({
      ...w,
      // Die Warnung BENENNT die Position — ein Verweis auf „eine Position"
      // schickt die Bauleitung durch zwoelf Aufmassblaetter (BAU-05).
      text: warnungsText(w),
      nachtrag_titel_vorschlag: nachtragTitelVorschlag(w),
    })),
  });
}
