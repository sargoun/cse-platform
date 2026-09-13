/**
 * Die Isolationssuite laeuft PARALLEL — je Arbeiter eine eigene Datenbank.
 *
 * **Warum.** 69 Dateien liefen eine nach der anderen gegen EINE `cse_test`,
 * weil zwei Dateien auf derselben Datenbank einander die Fixturen
 * wegtruncaten wuerden und der Fehlschlag dann wie ein RLS-Defekt aussaehe.
 * Das war richtig — und kostete in CI 25 Minuten fuer einen Schritt, den
 * vier Kerne in einem Viertel der Zeit schaffen. Die Antwort ist nicht,
 * die Dateien auf einer Datenbank zu mischen, sondern jedem Arbeiter seine
 * zu geben: `cse_test_w1` … `cse_test_w4`, jede ein Klon der migrierten
 * `cse_test` (`create database … template`), jede so frisch wie bisher die
 * eine. Innerhalb eines Arbeiters laufen die Dateien weiter nacheinander,
 * und `seed()` setzt vor jeder Datei zurueck — genau wie vorher, nur viermal
 * nebeneinander (D-424).
 *
 * Diese Datei importiert nichts aus dem Projekt: `vitest.isolation.config.ts`
 * liest sie vor dem Start der Arbeiter, die Arbeiter lesen sie in `harness.ts`,
 * und ein Unit-Test liest sie ohne Datenbank.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Mehr als vier lohnt nicht: ein GitHub-Runner hat vier Kerne, und Postgres will auch einen. */
export const HOECHSTENS_WORKER = 4;

/**
 * Wie viele Arbeiter — `CSE_ISOLATION_WORKER` gewinnt, sonst die Kerne, hoechstens vier.
 *
 * `CSE_ISOLATION_WORKER=1` ist der alte, serielle Lauf: fuer die Fehlersuche,
 * wenn eine Datei nur in Gesellschaft anderer faellt.
 */
export function anzahlWorker(
  umgebung: Readonly<Record<string, string | undefined>>, kerne: number,
): number {
  const gewuenscht = Number.parseInt(umgebung['CSE_ISOLATION_WORKER'] ?? '', 10);
  if (Number.isInteger(gewuenscht) && gewuenscht >= 1) return Math.min(gewuenscht, HOECHSTENS_WORKER);
  return Math.max(1, Math.min(HOECHSTENS_WORKER, Math.floor(kerne)));
}

/** Der Datenbankname einer Adresse — `postgres://…/cse_test?x=1` → `cse_test`. */
export function datenbankName(url: string): string {
  const treffer = /\/([^/?]+)(?:\?|$)/u.exec(url.replace(/^[a-z]+:\/\/[^/]+/u, ''));
  return treffer?.[1] ?? '';
}

/** Dieselbe Adresse mit einem anderen Datenbanknamen. */
export function mitDatenbank(url: string, name: string): string {
  return url.replace(/\/[^/?]+(\?|$)/u, `/${name}$1`);
}

/**
 * Die Datenbank EINES Arbeiters: `cse_test` + `_w3` fuer `VITEST_POOL_ID=3`.
 *
 * Ohne Pool-Kennung (ein Skript, das die Harness ausserhalb von Vitest laedt)
 * bleibt die Adresse, wie sie ist.
 */
export function workerUrl(basisUrl: string, poolId: string | undefined): string {
  if (poolId === undefined || poolId === '') return basisUrl;
  return mitDatenbank(basisUrl, `${datenbankName(basisUrl)}_w${poolId}`);
}

/** Die Verwaltungsadresse desselben Servers — Datenbank `postgres`. */
export function verwaltungsUrl(url: string): string {
  return mitDatenbank(url, 'postgres');
}

/**
 * Die beiden Vorlagen fuer Dateien mit EIGENER Datenbank (`eigeneDatenbank`):
 * migriert + geseedet, und dazu mit den Texten der oeffentlichen Seiten.
 *
 * Sie werden einmal je Lauf gebaut (`global-setup.ts`) und dann geklont —
 * ein Klon dauert eine Sekunde, ein Seed anderthalb Minuten, und fuenf
 * Dateien brauchten bisher fuenf Seeds.
 */
export function vorlagenNamen(basisName: string): { seed: string; inhalt: string } {
  return { seed: `${basisName}_vorlage`, inhalt: `${basisName}_vorlage_inhalt` };
}

/**
 * Derselbe OFFENSICHTLICHE Testwert wie in `scripts/test-db.sh` (base64 von
 * `TEST-KEY-NICHT-FUER-PRODUKTION`, K-06). `tests/kern/isolation-parallel.test.ts`
 * prueft, dass beide Stellen denselben tragen.
 */
export const FENSTER_SCHLUESSEL_TEST = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O';

/**
 * Ein Datenbankname, der in ein SQL-Kommando darf.
 *
 * Die Namen kommen aus `TEST_DATABASE_URL` und aus Testdateien — beides im
 * Repository. Trotzdem: ein Name mit Anfuehrungszeichen oder Leerzeichen
 * faellt hier mit seinem Namen, nicht als halbes Kommando im Server.
 */
export function pruefeBezeichner(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(name)) {
    throw new Error(
      `Kein zulaessiger Datenbankname: „${name}" — a–z, 0–9 und _, hoechstens 63 Zeichen.`,
    );
  }
  return name;
}

/**
 * `psql` — vom PATH, sonst die neueste Version unter `/usr/lib/postgresql`,
 * wie `scripts/test-db.sh` sie sucht.
 *
 * Im Entwicklungscontainer und auf einem GitHub-Runner liegt der Client unter
 * `/usr/bin`; die Suche darunter ist fuer den Rechner, auf dem nur das
 * Serverpaket steht und niemand den PATH ergaenzt hat.
 */
export function psqlBefehl(
  umgebung: Readonly<Record<string, string | undefined>> = process.env,
): string {
  for (const verzeichnis of (umgebung['PATH'] ?? '').split(delimiter)) {
    if (verzeichnis !== '' && existsSync(join(verzeichnis, 'psql'))) {
      return join(verzeichnis, 'psql');
    }
  }
  const wurzel = '/usr/lib/postgresql';
  const versionen = existsSync(wurzel)
    ? readdirSync(wurzel)
      .filter((v) => existsSync(join(wurzel, v, 'bin/psql')))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    : [];
  const neueste = versionen.at(-1);
  return neueste === undefined ? 'psql' : join(wurzel, neueste, 'bin/psql');
}

/**
 * Fuehrt Kommandos mit `psql` aus und gibt die nackte Ausgabe zurueck.
 *
 * `psql` und nicht der Treiber, aus zwei Gruenden: `create database` laeuft
 * ausserhalb einer Transaktion, und die Vorlage darf beim Klonen keine
 * offene Verbindung haben — ein Prozess, der endet, hat keine. Fehler gehen
 * auf stderr durch, damit der Grund im Protokoll steht und nicht nur
 * „Command failed".
 */
export function psql(url: string, ...befehle: readonly string[]): string {
  const args = ['-v', 'ON_ERROR_STOP=1', '-q', '-tA'];
  for (const b of befehle) args.push('-c', b);
  return execFileSync(psqlBefehl(), [url, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

/**
 * Klont eine Datenbank: `drop … with (force)`, `create … template`, und der
 * Testschluessel.
 *
 * Datenbankeinstellungen (`pg_db_role_setting`) wandern NICHT mit dem Klon —
 * sie haengen an der OID. Ohne die letzte Zeile wirft `app.arbzg_belastung`
 * „unrecognized configuration parameter" — laut, und richtig so (K-06).
 */
export function kloneDatenbank(verwaltung: string, ziel: string, vorlage: string): void {
  psql(verwaltung,
    `drop database if exists "${pruefeBezeichner(ziel)}" with (force)`,
    `create database "${ziel}" template "${pruefeBezeichner(vorlage)}"`,
    `alter database "${ziel}" set cse.fenster_schluessel = '${FENSTER_SCHLUESSEL_TEST}'`);
}
