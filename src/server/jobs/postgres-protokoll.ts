/**
 * Das Laufprotokoll gegen Postgres.
 *
 * Getrennt vom Runner, damit dieser ohne Datenbank pruefbar bleibt — und
 * damit die Idempotenz dort liegt, wo sie halten kann: auf einem eindeutigen
 * Index, nicht in einer Variablen im Prozess. Zwei gleichzeitig ausgeloeste
 * Laeufe treffen denselben Index; einer gewinnt, der andere sieht das.
 */
import type { Ergebnis, LaufProtokoll } from './runner.js';

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export class PostgresProtokoll implements LaufProtokoll {
  constructor(private readonly sql: Abfrage) {}

  async neuerLauf(
    job: string, idempotenzSchluessel: string | null, versuch: number,
  ): Promise<{ laufId: string; bereitsErledigt: boolean }> {
    if (idempotenzSchluessel !== null) {
      const vorhanden = await this.sql.unsafe(
        `select id from job_lauf
          where job = $1 and idempotenz_schluessel = $2 and ergebnis = 'erfolg'`,
        [job, idempotenzSchluessel],
      ) as { id: string }[];
      if (vorhanden[0] !== undefined) {
        return { laufId: vorhanden[0].id, bereitsErledigt: true };
      }
    }

    const zeilen = await this.sql.unsafe(
      `insert into job_lauf (job, idempotenz_schluessel, versuch) values ($1,$2,$3)
       returning id`,
      [job, idempotenzSchluessel, versuch],
    ) as { id: string }[];
    return { laufId: zeilen[0]!.id, bereitsErledigt: false };
  }

  async beendeLauf(
    laufId: string, ergebnis: Ergebnis,
    kennzahlen: Record<string, unknown>, fehlertext: string | null,
  ): Promise<void> {
    await this.sql.unsafe(
      `update job_lauf set beendet_am = now(), ergebnis = $2::job_ergebnis,
              kennzahlen = $3::jsonb, fehlertext = $4
        where id = $1`,
      // Das OBJEKT, nicht `JSON.stringify(...)`: der Treiber serialisiert
      // json-Parameter selbst, und ein bereits serialisierter String wird
      // dann ein zweites Mal codiert — die Spalte haelt danach einen
      // jsonb-STRING statt eines Objekts, und jeder Lesezugriff auf ein Feld
      // liefert undefined.
      [laufId, ergebnis, kennzahlen, fehlertext],
    );
  }

  async ergebnisJeMandant(
    laufId: string, mandantId: string, ergebnis: Ergebnis,
    kennzahlen: Record<string, unknown>, fehlertext: string | null,
  ): Promise<void> {
    await this.sql.unsafe(
      `insert into job_lauf_mandant (job_lauf_id, mandant_id, ergebnis, kennzahlen, fehlertext)
       values ($1,$2,$3::job_ergebnis,$4::jsonb,$5)`,
      [laufId, mandantId, ergebnis, kennzahlen, fehlertext],
    );
  }
}
