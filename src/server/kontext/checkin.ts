/**
 * Der sitzungslose Check-in-Prinzipal (K-08, Registerzeile 3).
 *
 * **Er setzt keine einzige GUC, und das ist der Punkt.** Eine Kraft, die um
 * 05:55 im Treppenhaus einen Link antippt, hat keine Anmeldung — es gibt in
 * diesem Moment keinen Benutzer, dessen Rechte man pruefen koennte. Also ist
 * fuer diesen Pfad jede K-03-Policy falsch, und er greift auf KEINE Tabelle
 * selbst zu: er darf genau eine Funktion ausfuehren
 * (`app.checkin_verbrauchen`), die Mandant, Beschaeftigung und Mensch aus der
 * Einteilung ableitet — nie aus der Anfrage.
 *
 * `cse_checkin` haelt deshalb kein Tabellenrecht, keine Policy und kein
 * `EXECUTE` auf irgendetwas anderem. Waere hier eine Sitzung gebunden, waere
 * die Marke eine Anmeldung, und ein weitergeleiteter Link waere ein Zugang.
 *
 * Der zweite Registereintrag dieser Rolle, `app.offline_ereignis_annehmen`,
 * kommt mit PR 35 und benutzt denselben Prinzipal: das Nachspielen ist
 * Check-in-Material, das spaet ankommt — dasselbe Subjekt, dieselbe
 * Authentifizierung, dieselbe Bedingtschreibdisziplin.
 */
import type { Transaktion } from './index.js';

export interface CheckinKontext {
  /** Genau der Funktionsaufruf, den K-08 diesem Prinzipal zugesteht. */
  rufe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export async function withCheckin<T>(
  tx: Transaktion,
  fn: (kontext: CheckinKontext) => Promise<T>,
): Promise<T> {
  await tx.unsafe(`set local role cse_checkin`);
  return fn({
    rufe: async <R,>(sql: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(sql, werte)) as readonly R[],
  });
}
