import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alleJobs, vergissRegistrierung } from '../../src/server/jobs/bootstrap.js';
import { leereRegister } from '../../src/server/jobs/registry.js';
import { cronPlanSql, planzeilen } from '../../src/server/jobs/zeitplan.js';

/**
 * Der Auslöseplan — **dass er jeden Job trifft, und dass er nichts erfindet**.
 *
 * **Der Befund dahinter.** Sechzehn Jobs tragen einen Zeitplan, es gibt einen
 * Runner, ein Laufprotokoll und eine bewachte Auslöseroute — und nichts, das
 * sie ruft. Jede Datei einzeln gebaut und geprüft; zusammen lief kein
 * einziger Wächter. Das ist dieselbe Lücke wie in `bootstrap.ts`, nur eine
 * Ebene weiter draussen, und sie wird nirgends rot: ein Test, der einen Job
 * ausführt, beweist, dass er funktioniert, und sagt nichts darüber, ob ihn
 * jemand startet.
 *
 * Deshalb prüft diese Datei die Verbindung, nicht die Teile.
 */
const WURZEL = resolve(import.meta.dirname, '../..');

/** Eine Abfrage, die anschlägt, sobald jemand sie benutzt. */
const nie = (): never => {
  throw new Error('Der Planer stellt keine Abfragen.');
};

function jobs() {
  leereRegister();
  vergissRegistrierung();
  return alleJobs({ unsafe: nie, begin: nie });
}

describe('Der Auslöseplan der Nachtläufe (SPEC §14)', () => {
  it('jeder registrierte Job steht im Plan — keiner fällt heraus', () => {
    const alle = jobs();
    expect(alle.length).toBeGreaterThan(0);
    const imPlan = new Set(planzeilen(alle).map((p) => p.schluessel));
    const fehlend = alle.map((j) => j.schluessel).filter((s) => !imPlan.has(s));
    expect(fehlend, 'Ein Job ohne Planzeile läuft nie').toEqual([]);
  });

  it('und das erzeugte SQL nennt jeden davon mit seinem eigenen Zeitplan', () => {
    const alle = jobs();
    const sql = cronPlanSql(alle, { basis: 'https://probe.invalid' });
    for (const j of alle) {
      expect(sql, j.schluessel).toContain(`/api/jobs/${j.schluessel}`);
      expect(sql, j.schluessel).toContain(`'${j.zeitplan}'`);
    }
    /*
     * Genau so viele Einträge wie Jobs. Ein Plan, der einen Job zweimal
     * einträgt, lässt ihn zweimal laufen — die Idempotenz in `job_lauf` fängt
     * das ab, aber ein Plan, der sich auf die Notbremse verlässt, ist keiner.
     */
    expect(sql.match(/cron\.schedule\(/gu)?.length).toBe(alle.length);
    expect(sql.match(/cron\.unschedule\(/gu)?.length).toBe(alle.length);
  });

  it('das Geheimnis steht NICHT im Plan, sondern als Datenbankeinstellung', () => {
    /*
     * Ein Token in einer eingecheckten Datei ist ein Token in der
     * Versionsgeschichte, und dort bleibt es auch nach dem Wechsel.
     */
    const sql = cronPlanSql(jobs(), { basis: 'https://probe.invalid' });
    expect(sql).toContain("current_setting('cse.job_token')");
    expect(sql).not.toMatch(/JOB_TOKEN\s*[:=]\s*['"][^'"]/u);
  });

  it('ohne brauchbare Basis wird nichts erzeugt — geraten schon gar nicht', () => {
    for (const schlecht of ['', 'cse.example', '/api', 'ftp://x']) {
      expect(() => cronPlanSql(jobs(), { basis: schlecht }), schlecht).toThrow(/Basisadresse/u);
    }
  });

  it('die eingecheckte Datei ist aktuell — und trägt keinen echten Host', () => {
    /*
     * **Beides in einer Prüfung, weil beides derselbe Fehler ist.** Eine
     * veraltete Datei spielt einen alten Zeitplan ein; eine mit einem
     * plausiblen Host darin wird irgendwann in eine Produktionskonsole
     * eingefügt und ruft dann jede Nacht eine fremde Adresse — mit dem
     * Geheimnis im Kopf. `.invalid` ist nach RFC 2606 reserviert und löst
     * nirgends auf: ein versehentliches Einfügen scheitert sofort und laut.
     */
    const datei = readFileSync(resolve(WURZEL, 'docs/JOB-AUSLOESER.sql'), 'utf8');
    const erwartet = cronPlanSql(jobs(), { basis: 'https://basis-einsetzen.invalid' });
    expect(datei, 'veraltet — `pnpm jobs:plan` erneut laufen lassen').toBe(erwartet);
    expect(datei).toContain('.invalid/api/jobs/');
  });
});
