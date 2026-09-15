import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindePersoenlich } from '@/server/kontext/index';
import { widerrufeFeed } from '@/server/kalender/feed';

/**
 * `POST /api/kalender-feed/widerrufen` — einen iCal-Zugang schliessen (CAL-03).
 *
 * **Der Widerruf wirkt sofort**, weil `app.kalender_feed_aufloesen` auf
 * `widerrufen_am is null` filtert: der nächste Abruf bekommt nichts, ohne dass
 * irgendein Zwischenspeicher ablaufen müsste.
 *
 * **Ein `update`, kein `delete`.** Wer wissen will, ob ein Zugang bestand und
 * wann er endete, findet die Zeile — und der Eindeutigkeitsindex auf dem Hash
 * verhindert, dass derselbe Token je wieder vergeben wird.
 *
 * **Ein fremder Zugang antwortet wie ein nicht vorhandener.** `t_feed_eigene`
 * lässt das `update` gar nicht erst greifen; die Route sagt nicht, ob es die
 * Zeile gibt.
 */
export const dynamic = 'force-dynamic';

const ZIEL = '/portal/konto/kalender-feed';
const IST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });

  const daten = await anfrage.formData();
  const id = String(daten.get('id') ?? '');
  if (!IST_UUID.test(id)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindePersoenlich(tx, sitzung);
    const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
    return widerrufeFeed({ abfrage, schreibe: abfrage }, id);
  }));

  /*
   * **Ohne das zeigt die Seite nach dem Umleiten den alten Stand.**
   *
   * Der Browser folgt der 303 auf dieselbe Route, und Next liefert dafuer den
   * zwischengespeicherten Router-Eintrag: die widerrufene Zeile stand danach
   * noch in der Liste, und wer sie sah, klickte ein zweites Mal oder hielt
   * den Widerruf fuer gescheitert. Die Datenbank war die ganze Zeit richtig --
   * ein Fehler, den nur ein Browsertest findet, weil er in keiner Abfrage
   * steht.
   */
  revalidatePath(ZIEL);

  const antwort = NextResponse.redirect(
    internesZiel(`${ZIEL}?widerrufen=1`, ZIEL, anfrage), 303);
  /*
   * **Die Umleitung selbst darf nicht zwischengespeichert werden.**
   * Ohne diese Zeile lieferte der Browser fuer das Ziel einen alten Stand:
   * die gerade widerrufene Zeile stand noch in der Liste, und wer sie sah,
   * klickte ein zweites Mal. Die Datenbank war die ganze Zeit richtig.
   */
  antwort.headers.set('cache-control', 'no-store');
  return antwort;
}
