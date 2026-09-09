import 'server-only';
import { cookies } from 'next/headers';
import type postgres from 'postgres';
import { db } from '../db/pool.js';
import { SITZUNG_COOKIE, sitzungAufloesen } from './sitzung.js';
import type { Sitzung } from '../kontext/index.js';

/**
 * Die Sitzung der laufenden Anfrage — aus dem Cookie, aufgeloest von der
 * Datenbank.
 *
 * **Sie oeffnet eine eigene, kurze Transaktion.** Das Aufloesen aktualisiert
 * `letzte_aktivitaet_am`, ist also ein Schreibvorgang; ihn in die
 * Lesetransaktion der Seite zu haengen hiesse, dass jede Seite, die etwas
 * anderes abbricht, auch die Sitzungsaktivitaet zurueckrollt — und der
 * Benutzer nach acht Minuten Leerlauf abgemeldet waere, obwohl er die ganze
 * Zeit gearbeitet hat.
 */
export async function aktuelleSitzung(): Promise<Sitzung | null> {
  const token = (await cookies()).get(SITZUNG_COOKIE)?.value;
  if (token === undefined || token === '') return null;
  return db().begin(async (tx: postgres.TransactionSql) =>
    sitzungAufloesen(tx, token)) as Promise<Sitzung | null>;
}

/**
 * Die Rolle der aktiven Mitgliedschaft — fuer die Wahl der Tab-Leiste.
 *
 * Sie kommt aus `benutzer_mandant`, nicht aus dem Cookie: eine Rolle im
 * Cookie waere eine Behauptung des Browsers ueber die eigenen Rechte.
 */
export async function aktiveRolle(sitzung: Sitzung): Promise<string | null> {
  if (sitzung.aktiverMandantId === null) return null;
  const zeilen = await (db().begin(async (tx: postgres.TransactionSql) =>
    tx.unsafe(
      `select r.schluessel from benutzer_mandant bm
         join rolle r on r.id = bm.rolle_id
        where bm.benutzer_id = $1 and bm.mandant_id = $2 and bm.entzogen_am is null
        limit 1`,
      [sitzung.benutzerId, sitzung.aktiverMandantId],
    )) as Promise<{ schluessel: string }[]>);
  return zeilen[0]?.schluessel ?? null;
}
