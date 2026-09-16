import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alleJobs, vergissRegistrierung } from '../../src/server/jobs/bootstrap.js';
import { leereRegister } from '../../src/server/jobs/registry.js';
import {
  cronPlanSql, fensterMinuten, idempotenzSchluessel, planzeilen,
} from '../../src/server/jobs/zeitplan.js';

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

/**
 * **Das Fenster, in dem ein Lauf derselbe Lauf ist** — und warum es davon
 * nicht nur eines geben darf.
 *
 * Der Schluessel war `<job>:<Berliner Datum>` fuer jeden Job. Fuer einen
 * Nachtlauf ist das genau richtig. Fuer `social_plan`, der alle fuenf Minuten
 * laeuft, war es toedlich: nach dem ersten Lauf eines Tages fand jeder weitere
 * seinen Schluessel schon vergeben und wurde uebersprungen. Ein Beitrag auf
 * 14:00 ginge bis zum naechsten Morgen nicht hinaus — und der Lauf meldete
 * „uebersprungen", also nicht einmal einen Fehler.
 *
 * Diese Tests halten beides fest: dass ein haeufiger Lauf haeufig laeuft, und
 * dass der taegliche dabei bleibt, was er war.
 */
describe('Das Idempotenzfenster folgt dem Zeitplan (SPEC §14)', () => {
  it('liest aus dem Cron, wie oft ein Lauf laeuft', () => {
    expect(fensterMinuten('0 3 * * *'), 'naechtlich').toBe(1440);
    expect(fensterMinuten('*/5 * * * *'), 'alle fuenf Minuten').toBe(5);
    expect(fensterMinuten('* * * * *'), 'jede Minute').toBe(1);
    expect(fensterMinuten('0 * * * *'), 'stuendlich').toBe(60);
    expect(fensterMinuten('0 */4 * * *'), 'alle vier Stunden').toBe(240);
  });

  it('eine Stundenliste ist lesbar genug — feste Minute heisst hoechstens stuendlich', () => {
    /*
     * `0 8-18 * * 1-5` trifft elfmal am Tag, immer zur vollen Stunde. 60 ist
     * das richtige Fenster: zwei Laeufe liegen nie enger beieinander.
     */
    expect(fensterMinuten('0 8-18 * * 1-5')).toBe(60);
    expect(fensterMinuten('30 6,18 * * *')).toBe(60);
    expect(fensterMinuten('0 6 15 6,12 *'), 'zweimal im Jahr, aber nie zweimal am Tag')
      .toBe(1440);
    expect(fensterMinuten('*/90 * * * *'), 'trifft nur Minute 0').toBe(60);
    expect(fensterMinuten('0 */30 * * *')).toBe(1440);
  });

  it('was sie nicht lesen kann, raet sie nicht — sie wirft', () => {
    /*
     * **Der Grund steht im Befund.** Eine Minutenliste heisst mehrmals je
     * Stunde; stillschweigend „taeglich" daraus zu machen waere derselbe
     * Ausfall, den dieses Fenster gerade behoben hat — nur eine Ebene tiefer
     * versteckt. Der Test darunter ruft `fensterMinuten` fuer jeden
     * registrierten Job auf: ein unlesbarer Zeitplan wird damit beim
     * Festschreiben rot und nicht im Betrieb still.
     */
    for (const unlesbar of ['', '0', '15,45 * * * *', '0-30 * * * *', '*/0 * * * *']) {
      expect(() => fensterMinuten(unlesbar), JSON.stringify(unlesbar)).toThrow();
    }
  });

  it('DER Befund: zwoelf Ausloeser einer Stunde ergeben zwoelf Laeufe, nicht einen', () => {
    /*
     * Mit dem Tagesschluessel war diese Menge einelementig — und `social_plan`
     * damit nach seinem ersten Lauf bis Mitternacht stillgelegt.
     */
    const beginn = Date.parse('2026-06-15T12:00:00Z');
    const schluessel = new Set(
      Array.from({ length: 12 }, (_, i) =>
        idempotenzSchluessel('social_plan', '*/5 * * * *',
          new Date(beginn + i * 5 * 60_000), 120)));
    expect(schluessel.size).toBe(12);
  });

  it('zwei Ausloeser IM selben Fenster bleiben ein Lauf', () => {
    const a = idempotenzSchluessel('social_plan', '*/5 * * * *',
      new Date('2026-06-15T12:00:10Z'), 120);
    const b = idempotenzSchluessel('social_plan', '*/5 * * * *',
      new Date('2026-06-15T12:04:59Z'), 120);
    expect(a).toBe(b);
    expect(idempotenzSchluessel('social_plan', '*/5 * * * *',
      new Date('2026-06-15T12:05:00Z'), 120)).not.toBe(a);
  });

  it('der Nachtlauf traegt das BERLINER Datum — dasselbe, das die Route meldet', () => {
    /*
     * Hier stand einmal der zurueckgerechnete UTC-Augenblick: der Lauf vom
     * 15. Juni um 03:30 Berliner Zeit hiess `mahnlauf:2026-06-14`, weil
     * Berliner Mitternacht im Sommer um 22:00 UTC des Vortags liegt. Der
     * Schluessel widersprach damit dem `tag` derselben Antwort.
     */
    expect(idempotenzSchluessel('mahnlauf', '0 3 * * *',
      new Date('2026-06-15T01:30:00Z'), 120)).toBe('mahnlauf:2026-06-15');
    expect(idempotenzSchluessel('mahnlauf', '0 3 * * *',
      new Date('2026-01-15T02:30:00Z'), 60)).toBe('mahnlauf:2026-01-15');
    /* Und kurz vor Berliner Mitternacht noch derselbe Tag. */
    expect(idempotenzSchluessel('mahnlauf', '0 3 * * *',
      new Date('2026-06-15T21:59:00Z'), 120)).toBe('mahnlauf:2026-06-15');
    expect(idempotenzSchluessel('mahnlauf', '0 3 * * *',
      new Date('2026-06-15T22:01:00Z'), 120)).toBe('mahnlauf:2026-06-16');
  });

  it('in der Nacht der Rueckstellung ist 02:05 zweimal — und das sind zwei Laeufe', () => {
    /*
     * 25.10.2026: um 03:00 MESZ geht die Uhr auf 02:00 MEZ zurueck. Die
     * Wanduhr zeigt 02:05 zweimal, eine volle Stunde auseinander. Ein
     * Schluessel aus der Wanduhr wuerde den zweiten Lauf als Wiederholung
     * ueberspringen — samt allem, was in dieser Stunde faellig wird.
     */
    const erst = idempotenzSchluessel('social_plan', '*/5 * * * *',
      new Date('2026-10-25T00:05:00Z'), 120);
    const zweit = idempotenzSchluessel('social_plan', '*/5 * * * *',
      new Date('2026-10-25T01:05:00Z'), 60);
    expect(erst).not.toBe(zweit);
  });

  it('jeder registrierte Job bekommt daraus einen brauchbaren Schluessel', () => {
    /*
     * Kein Job darf einen Schluessel bekommen, der seltener wechselt als er
     * selbst laeuft — sonst laeuft er nicht.
     */
    for (const j of jobs()) {
      const fenster = fensterMinuten(j.zeitplan);
      const a = idempotenzSchluessel(j.schluessel, j.zeitplan,
        new Date('2026-06-15T12:00:00Z'), 120);
      const b = idempotenzSchluessel(j.schluessel, j.zeitplan,
        new Date(Date.parse('2026-06-15T12:00:00Z') + fenster * 60_000), 120);
      expect(a, j.schluessel).toMatch(new RegExp(`^${j.schluessel}:`, 'u'));
      expect(b, `${j.schluessel} wechselt nach seinem Fenster`).not.toBe(a);
    }
  });
});
