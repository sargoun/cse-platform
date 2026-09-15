import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindePersoenlich } from '@/server/kontext/index';
import { legeFeedAn } from '@/server/kalender/feed';

/**
 * `POST /api/kalender-feed/anlegen` — einen iCal-Zugang ausgeben (CAL-03).
 *
 * **Der Token geht in die Adresse der Antwort, nicht in die Datenbank.** Die
 * Seite zeigt ihn einmal; gespeichert ist nur sein SHA-256. Das ist keine
 * Umständlichkeit, sondern die Zusage: wer die Datenbank liest, bekommt
 * keinen Kalenderzugang.
 *
 * **`bindePersoenlich` und nicht `withTenant`.** Der Feed gehört dem MENSCHEN
 * und keiner Gesellschaft — er gilt auch in der Gruppenansicht, in der es
 * keinen aktiven Mandanten gibt (Invariante 10). Eingegrenzt ist er trotzdem:
 * `t_feed_eigene` bindet jede Zeile an `app.aktueller_benutzer()`.
 *
 * **Kein Rechteschlüssel.** Ein Recht davor hiesse, dass jemand seinen eigenen
 * Kalender nicht abonnieren darf — und es gäbe keinen, der das ausdrückt.
 */
export const dynamic = 'force-dynamic';

const ZIEL = '/portal/konto/kalender-feed';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });

  const { token } = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindePersoenlich(tx, sitzung);
    const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
    return legeFeedAn({ abfrage, schreibe: abfrage });
  }) as Promise<{ token: string; id: string }>);

  /*
   * Der Token steht in der Adresse, an die umgeleitet wird -- er steht damit
   * im Verlauf des Browsers und moeglicherweise in einem Serverprotokoll.
   * Das ist bewusst in Kauf genommen: die Alternative waere, ihn in der
   * Sitzung zwischenzulagern, und damit laege er an einer zweiten Stelle.
   * Wer ihn gezeigt bekommen hat, hat ihn ohnehin.
   */
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
    internesZiel(`${ZIEL}?neu=${encodeURIComponent(token)}`, ZIEL, anfrage), 303);
  /*
   * **Die Umleitung selbst darf nicht zwischengespeichert werden.**
   * Ohne diese Zeile lieferte der Browser fuer das Ziel einen alten Stand:
   * die gerade widerrufene Zeile stand noch in der Liste, und wer sie sah,
   * klickte ein zweites Mal. Die Datenbank war die ganze Zeit richtig.
   */
  antwort.headers.set('cache-control', 'no-store');
  return antwort;
}
