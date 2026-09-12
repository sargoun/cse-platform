/**
 * Die Aufbausperre der Testdatenbank darf den Server nicht ueberleben.
 *
 * **Der Ausfall, gegen den das steht.** `scripts/test-db.sh` haelt waehrend
 * des Aufbaus eine `flock` auf Dateikanal 9 — richtig, denn zwei gleichzeitige
 * `initdb` auf dasselbe `$PGDATA` zerlegen einander. Innerhalb dieser Sperre
 * startet es aber auch den Server, und `pg_ctl start` loest einen Prozess ab,
 * der danach weiterlaeuft. Ohne `9>&-` erbt dieser Server den Kanal — und
 * damit die Sperre — auf Lebenszeit.
 *
 * Der Fehler zeigte sich nicht beim Anlegen, sondern beim naechsten Aufruf:
 * der erste `up` auf einem frischen Rechner lief durch, JEDER folgende wartete
 * die vollen zehn Minuten und starb an „Warte-Zeit abgelaufen". Eine Sperre
 * gegen gleichzeitige Aufbauten, die am Ende den Aufbau selbst verhindert —
 * und sie sieht dabei aus wie ein haengender Postgres.
 *
 * **Geprueft wird der WORTLAUT aus dem Skript, nicht eine Abschrift.** Die
 * Funktion wird aus `scripts/test-db.sh` herausgeschnitten und ausgefuehrt;
 * `su` und `sudo` bekommen eine Attrappe auf dem PATH, damit der Test als root
 * wie als gewoehnlicher Benutzer denselben Weg nimmt. Statt eines Servers
 * startet ein `sleep` — was hier zaehlt, ist allein, ob der abgeloeste Prozess
 * den Dateikanal mitnimmt.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WURZEL = resolve(import.meta.dirname, '../..');
const SKRIPT = readFileSync(join(WURZEL, 'scripts/test-db.sh'), 'utf8');

/** `als_postgres() { … }` — der Rumpf, wie er im Skript steht. */
function alsPostgresAusSkript(): string {
  const treffer = /^als_postgres\(\) \{[\s\S]*?^\}$/mu.exec(SKRIPT);
  expect(treffer, 'als_postgres() nicht in scripts/test-db.sh gefunden').not.toBeNull();
  return treffer![0];
}

let arbeit: string;

beforeAll(() => {
  arbeit = mkdtempSync(join(tmpdir(), 'cse-sperre-'));
  // Attrappen fuer `su postgres -c "CMD"` und `sudo -n -u postgres bash -c "CMD"`.
  writeFileSync(join(arbeit, 'su'), '#!/bin/sh\nexec /bin/sh -c "$3"\n');
  writeFileSync(join(arbeit, 'sudo'), '#!/bin/sh\nexec /bin/sh -c "$6"\n');
  chmodSync(join(arbeit, 'su'), 0o755);
  chmodSync(join(arbeit, 'sudo'), 0o755);
});

afterAll(() => { rmSync(arbeit, { recursive: true, force: true }); });

/**
 * Faehrt den Rumpf hinter einer gehaltenen Sperre und startet darin einen
 * Prozess, der die Shell ueberlebt. Gibt zurueck, ob die Sperre danach frei
 * ist.
 */
function sperreFreiNach(rumpf: string): boolean {
  const sperrdatei = join(arbeit, `sperre-${String(Math.random()).slice(2)}`);
  const kind = join(arbeit, 'kind.sh');
  writeFileSync(kind, [
    'set -eu',
    'PGBIN=/nonexistent',
    rumpf,
    `exec 9>"${sperrdatei}"`,
    'flock -w 5 9',
    // `setsid`: der Prozess ueberlebt die Shell, genau wie ein abgeloester
    // Postgres. Ohne das endete er mit ihr, und der Test waere immer gruen.
    `als_postgres "setsid sleep 30 >/dev/null 2>&1 &"`,
  ].join('\n'));

  execFileSync('/bin/bash', [kind], {
    env: { ...process.env, PATH: `${arbeit}:${process.env['PATH'] ?? ''}` },
    stdio: 'ignore',
  });

  const probe = spawnSync('flock', ['-n', '-E', '9', sperrdatei, '-c', 'true']);
  return probe.status === 0;
}

describe('die Aufbausperre der Testdatenbank', () => {
  it('das Skript schliesst Kanal 9, bevor es einen Prozess abloest', () => {
    expect(sperreFreiNach(alsPostgresAusSkript()), 'Der abgeloeste Prozess haelt '
      + 'die Sperre weiter. Jeder weitere `db:test:up` wartet zehn Minuten '
      + 'und stirbt dann.').toBe(true);
  });

  /**
   * **Die Gegenprobe** — ohne die bewiese der Test oben nichts. Derselbe
   * Rumpf ohne `9>&-` MUSS die Sperre halten; taete er es nicht, pruefte die
   * Zusage oben eine Eigenschaft, die die Umgebung ohnehin hat.
   */
  it('und ohne das Schliessen bleibt sie gehalten', () => {
    const ohne = alsPostgresAusSkript().replaceAll(' 9>&-', '');
    expect(ohne, 'im Skript steht kein 9>&- mehr — die Gegenprobe prueft nichts')
      .not.toBe(alsPostgresAusSkript());
    expect(sperreFreiNach(ohne)).toBe(false);
  });
});
