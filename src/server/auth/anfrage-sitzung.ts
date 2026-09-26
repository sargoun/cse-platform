import 'server-only';
import { cookies, headers } from 'next/headers';
import type postgres from 'postgres';
import { db } from '../db/pool.js';
import { SITZUNG_COOKIE, sitzungAufloesen } from './sitzung.js';
import { anfrageAdresse } from './adresse.js';
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
  const sitzung = await (db().begin(async (tx: postgres.TransactionSql) =>
    sitzungAufloesen(tx, token)) as Promise<Sitzung | null>);
  if (sitzung === null) return null;
  /*
   * **Die Adresse DIESER Anfrage reist mit der Sitzung** (SEC-A9, V-163).
   * Jede Bindung (`withTenant`, `bindeAnfrage`, …) setzt sie als `app.ip`, und
   * `app.protokolliere` schreibt sie in jede Protokollzeile. Hier und nicht in
   * `sitzungAufloesen`: die Sitzungszeile kennt keine Anfrage, und dieselbe
   * Sitzung kommt morgen von einer anderen Adresse.
   */
  return { ...sitzung, ip: anfrageAdresse(await headers()) };
}

/**
 * Die Rolle der aktiven Mitgliedschaft steht NICHT hier.
 *
 * Sie stand hier, in einer eigenen Transaktion, und band darin nichts. Die
 * Policy `t_bm_lesen` verlangt `benutzer_id = app.aktueller_benutzer()` — die
 * Antwort war deshalb immer die leere Menge und die Rolle immer `null`.
 * Gelesen wird sie jetzt von `rolleImMandanten` in der Transaktion, die das
 * Zugangstor ohnehin oeffnet (`src/server/kontext/index.ts`): eine Bindung,
 * eine Wahrheit, keine zweite Stelle, an der sie fehlen kann.
 */
