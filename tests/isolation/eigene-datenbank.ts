/**
 * Eine Datenbank, die EINER Testdatei gehört.
 *
 * **Warum es das braucht.** Drei Dateien fahren den echten Seed
 * (`seed.test.ts`, `oeffentlich.test.ts`, `lead.test.ts`) und behaupten in
 * ihren Kommentaren, sie täten es auf einem frischen Stand. Das stimmte, als
 * `scripts/test-db.sh up` noch bedingungslos `drop database` machte. Genau
 * das wurde abgeschafft — und aus gutem Grund: jeder Neuaufbau riss der
 * laufenden Suite die Datenbank unter den Füßen weg und kappte den Pool, den
 * die Harness über Dateigrenzen hinweg offen hält. Seither heißt `up` „sorge
 * dafür, dass sie steht", und die drei Dateien liefen auf dem Stand, den die
 * jeweils vorherige Datei hinterlassen hatte.
 *
 * Was das kostete, war kein theoretischer Schaden:
 *
 *  - `seed.test.ts` prüfte „der Rechnungskreis ist ein Platzhalter (O-134)"
 *    gegen einen Kreis, den eine Schwesterdatei längst bestätigt und benutzt
 *    hatte — rot, ohne dass am Seed etwas falsch war.
 *  - `oeffentlich.test.ts` brach im Seed mit `benutzer_person_key` ab: die
 *    Harness-Fixtur hatte denselben Menschen schon angelegt und ihm einen
 *    Zugang gegeben, und EMP-14 lässt genau einen zu. Der Seed ist gegen
 *    seine EIGENE Ausgabe wiederholbar, nicht gegen fremde Zeilen — und das
 *    soll er auch nicht sein: „wer den Zugang behält" ist keine Frage, die
 *    ein Seed still entscheiden darf.
 *
 * Und rot oder grün entschied allein die Reihenfolge: Vitest ordnet die
 * Dateien nach Größe, also verschob schon eine neue Testdatei das Ergebnis.
 *
 * **Die Lösung ist eine Datenbank je Datei.** Dann darf `neu` wieder
 * zerstörend sein — es zerstört nur den eigenen Boden —, und die Datei stört
 * niemanden und wird von niemandem gestört. `test-db.sh` nimmt den Namen aus
 * der DSN; das kostet eine Umgebungsvariable und keine Zeile Skript.
 */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { DB_URL, type Sitzung } from './harness.js';

const WURZEL = resolve(import.meta.dirname, '../..');

export interface AufbauOptionen {
  /** Zusätzlich `scripts/content-import.ts` — für alles, was Seiteninhalt liest. */
  readonly inhalt?: boolean;
}

export interface EigeneDatenbank {
  readonly url: string;
  readonly sql: postgres.Sql;
  alsApp<T>(sitzung: Sitzung, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
  /** Baut die Datenbank NEU auf und fährt den echten Seed. Gehört in `beforeAll`. */
  baueAuf(optionen?: AufbauOptionen): void;
}

/**
 * `name` ist der Datenbankname, nicht der Dateiname — er steht in
 * `pg_database` und taucht in jeder Fehlermeldung auf. Zwei Dateien mit
 * demselben Namen teilen sich wieder eine Datenbank; das ist dann eine
 * Entscheidung und kein Versehen.
 */
export function eigeneDatenbank(name: string): EigeneDatenbank {
  const url = DB_URL.replace(/\/[^/?]+(\?|$)/u, `/${name}$1`);
  /*
   * Kein `sql.end()` irgendwo: der Pool lebt je Worker-PROZESS, und ein in
   * `afterAll` geschlossener Pool tötet jede Abfrage eines späteren Laufs
   * derselben Datei mit `CONNECTION_ENDED` — derselbe Fehler, der in
   * `mitarbeiter.spec.ts` schon einmal eine Zusicherung unmessbar gemacht hat.
   */
  const sql = postgres(url, { max: 2, onnotice: () => {} });

  return {
    url,
    sql,
    baueAuf(optionen: AufbauOptionen = {}): void {
      const umgebung = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url };
      execFileSync('bash', [join(WURZEL, 'scripts/test-db.sh'), 'neu'],
        { cwd: WURZEL, encoding: 'utf8', env: umgebung });
      execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
        [join(WURZEL, 'src/server/db/seed/index.ts')],
        { cwd: WURZEL, encoding: 'utf8', env: umgebung });
      if (optionen.inhalt === true) {
        execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
          [join(WURZEL, 'scripts/content-import.ts')],
          { cwd: WURZEL, encoding: 'utf8', env: umgebung });
      }
    },
    /** Dieselbe Bindung wie `harness.alsApp` — nur auf DIESER Datenbank. */
    async alsApp<T>(
      sitzung: Sitzung, fn: (tx: postgres.TransactionSql) => Promise<T>,
    ): Promise<T> {
      return sql.begin(async (tx) => {
        await tx.unsafe(`set local role cse_app`);
        await tx.unsafe(`select set_config('app.scope', $1, true)`, [sitzung.scope]);
        await tx.unsafe(`select set_config('app.mandant_id', $1, true)`,
          [sitzung.mandantId ?? '']);
        await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`,
          [(sitzung.mandantIds ?? []).join(',')]);
        await tx.unsafe(`select set_config('app.person_id', $1, true)`,
          [sitzung.personId ?? '']);
        await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`,
          [sitzung.benutzerId ?? '']);
        await tx.unsafe(`select set_config('app.readonly', $1, true)`,
          [sitzung.readonly === false ? 'off' : 'on']);
        await tx.unsafe(`select set_config('app.portal', $1, true)`, [sitzung.portal ?? '']);
        await tx.unsafe(`select set_config('app.akteur_typ', 'mensch', true)`);
        return fn(tx);
      }) as Promise<T>;
    },
  };
}
