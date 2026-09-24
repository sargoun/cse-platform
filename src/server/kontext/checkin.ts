/**
 * Der sitzungslose Check-in-Prinzipal (K-08, Registerzeile 3).
 *
 * **Er bindet keine Sitzung, und das ist der Punkt.** Eine Kraft, die um
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
 * **Gesetzt wird genau EINE GUC: die Herkunft** (`app.ip`, `bindeHerkunft`;
 * SEC-A9, V-235, D-729). Sie ist keine Sitzung — kein Konto, kein Mandant,
 * kein Portal —, sondern die Adresse der Anfrage, dieselbe, die als `p_ip`
 * schon in `checkin_token.ip_adresse` und an der Bremse steht. Bis V-235
 * setzte dieser Weg sie nicht, und jede Protokollzeile eines Check-ins
 * (`zeiteintrag.insert`, `zeit.eingestempelt`, `zeit.offline_empfangen`)
 * trug `ip = NULL`, obwohl die Adresse bekannt war: `app.protokolliere` liest
 * sie aus der Bindung, nicht aus dem Argument. Die Adresse ist deshalb eine
 * Pflichtangabe — ein Weg, der sie vergisst, uebersetzt nicht; `null` heisst
 * ehrlich: keine bekannt.
 *
 * Der zweite Registereintrag dieser Rolle, `app.offline_ereignis_annehmen`,
 * kommt mit PR 35 und benutzt denselben Prinzipal: das Nachspielen ist
 * Check-in-Material, das spaet ankommt — dasselbe Subjekt, dieselbe
 * Authentifizierung, dieselbe Bedingtschreibdisziplin.
 */
import { bindeHerkunft, type Transaktion } from './index.js';

export interface CheckinKontext {
  /** Genau der Funktionsaufruf, den K-08 diesem Prinzipal zugesteht. */
  rufe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export async function withCheckin<T>(
  tx: Transaktion,
  ip: string | null,
  fn: (kontext: CheckinKontext) => Promise<T>,
): Promise<T> {
  /* Vor dem Rollenwechsel: `set_config` ist fuer jede Rolle frei, aber so
     steht die Herkunft fest, bevor der Prinzipal irgendetwas ruft. */
  await bindeHerkunft(tx, ip);
  await tx.unsafe(`set local role cse_checkin`);
  return fn({
    rufe: async <R,>(sql: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(sql, werte)) as readonly R[],
  });
}
