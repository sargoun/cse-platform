/**
 * Der Test gegen den Fehler, den kein anderer Test sehen konnte.
 *
 * Es gab ein Register, einen Runner, ein Laufprotokoll und vier
 * Jobdefinitionen — und ausserhalb der Tests registrierte sie niemand.
 * `jobs()` war in Produktion leer: der Dienstplan materialisierte sich nie,
 * Konflikte wurden nie erkannt, Nachweise liefen unbemerkt ab. Jede Datei war
 * gebaut und geprueft; zusammen taten sie nichts.
 *
 * Genau das ist die Luecke, die eine Einzelpruefung nicht findet. Ein Test,
 * der einen Job direkt registriert und ausfuehrt, ist gruen — er beweist,
 * dass der Job funktioniert, und sagt nichts darueber, ob ihn jemand aufruft.
 * Deshalb prueft dieser Test nicht die Jobs, sondern die VERDRAHTUNG: er
 * liest das Verzeichnis und verlangt, dass jede Datei, die eine
 * Registrierfunktion ausfuehrt, auch im Bootstrap steht.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alleJobs, vergissRegistrierung } from '../../src/server/jobs/bootstrap.js';
import { leereRegister } from '../../src/server/jobs/registry.js';

const JOBS = fileURLToPath(new URL('../../src/server/jobs', import.meta.url));

/**
 * Eine Attrappe: der Bootstrap darf beim Registrieren nichts abfragen.
 *
 * `begin` wirft absichtlich statt still `[]` zurueckzugeben. Ein Job, der
 * beim REGISTRIEREN schon eine Transaktion oeffnet, ist einer, der beim
 * Laden des Moduls die Datenbank braucht — das soll hier auffallen und nicht
 * durchgehen.
 */
const db = {
  unsafe: (): Promise<readonly unknown[]> => Promise.resolve([]),
  begin: <T,>(): Promise<T> => {
    throw new Error('Registrieren oeffnet keine Transaktion.');
  },
};

beforeEach(() => {
  leereRegister();
  vergissRegistrierung();
});
afterEach(() => {
  leereRegister();
  vergissRegistrierung();
});

describe('der Bootstrap verdrahtet ALLE Jobs', () => {
  it('registriert die zweiundzwanzig Jobs, die es gibt', () => {
    const schluessel = alleJobs(db).map((j) => j.schluessel).sort();
    expect(schluessel).toEqual([
      'akquise_recherche', 'basiszinssatz_pruefen', 'belegarchiv_ausgangsrechnung',
      'bewerber_loeschung', 'dokument_aufbewahrung',
      'einsaetze_generieren', 'freigabe_fenster', 'kette_pruefen',
      'konflikte_erkennen', 'konten_rollover', 'lead_sla_eskalation',
      'mahnvorschlaege_erzeugen',
      'morgen_unbesetzt', 'nachtrag_ueberfaellig', 'nachweis_warnungen',
      'offene_posten_abgleichen', 'radar_einlesen', 'radar_warnungen',
      'schicht_ohne_zeiteintrag', 'social_plan',
      /*
       * `stundenkonto_abgleich` kam mit V-073 dazu: `pruefeAbgleich` stand
       * seit `0060` im Dienst, trug „(job:stundenkonto_abgleich, naechtlich)"
       * im Kopf — und den Lauf gab es nicht.
       */
      'stundenkonto_abgleich',
      'urlaubskonten_jahr',
    ]);
  });

  /**
   * **Die acht Wachen aus SPEC §14 sind vollständig.** Die Liste steht dort
   * als Tabelle; hier als Prüfsumme, damit eine gestrichene Wache auffällt.
   * `mahnvorschlaege_erzeugen` ist „Invoice overdue > 14 days → propose
   * dunning", `kette_pruefen` der nächtliche Hashkettenprüfer.
   */
  it('alle acht Waechter aus SPEC §14 sind verdrahtet', () => {
    const schluessel = new Set(alleJobs(db).map((j) => j.schluessel));
    for (const wache of [
      'radar_warnungen', 'lead_sla_eskalation', 'schicht_ohne_zeiteintrag',
      'morgen_unbesetzt', 'nachweis_warnungen', 'mahnvorschlaege_erzeugen',
      'nachtrag_ueberfaellig', 'kette_pruefen',
    ]) {
      expect(schluessel.has(wache), `SPEC §14: ${wache} fehlt`).toBe(true);
    }
  });

  /**
   * Die eigentliche Wache. Sie faellt, sobald jemand eine fuenfte Jobdatei
   * anlegt und den Eintrag im Bootstrap vergisst — also genau in dem Moment,
   * in dem der Fehler entsteht, und nicht Wochen spaeter beim Vermissen von
   * Zahlen.
   */
  it('keine Jobdatei bleibt unverdrahtet', () => {
    const dateien = readdirSync(JOBS)
      .filter((d) => d.endsWith('.ts'))
      .filter((d) => !['registry.ts', 'runner.ts', 'bootstrap.ts', 'alarm.ts',
        'postgres-protokoll.ts'].includes(d));

    const registrierend = dateien.filter((d) =>
      /export function registriere[A-Z]/u.test(readFileSync(join(JOBS, d), 'utf8')));
    expect(registrierend.length).toBeGreaterThan(0);

    const bootstrap = readFileSync(join(JOBS, 'bootstrap.ts'), 'utf8');
    const fehlend = registrierend.filter((d) => !bootstrap.includes(`./${d.replace(/\.ts$/u, '.js')}`));
    expect(fehlend).toEqual([]);
  });

  it('zweimal aufgerufen registriert nicht doppelt', () => {
    const erst = alleJobs(db).length;
    // `registriere()` wirft beim zweiten Mal mit demselben Schluessel — ohne
    // das Merken waere das hier ein Fehler und in der Entwicklung, wo Next.js
    // Module neu laedt, ein Absturz beim zweiten Seitenaufruf.
    expect(() => alleJobs(db)).not.toThrow();
    expect(alleJobs(db).length).toBe(erst);
  });

  it('jeder Job erklaert Mandantenbezug, Zeitplan und Wiederholungen', () => {
    for (const job of alleJobs(db)) {
      expect(['je_mandant', 'uebergreifend', 'plattform']).toContain(job.bereich);
      expect(job.zeitplan).toMatch(/^(\S+\s+){4}\S+$/u);
      expect(job.versuche).toBeGreaterThanOrEqual(0);
      expect(job.bezeichnung.length).toBeGreaterThan(10);
    }
  });

  /**
   * Die Nachtlaeufe duerfen sich nicht auf dieselbe Minute legen: der
   * Generator braucht die Nachweislage, bevor er einteilt, und zwei
   * gleichzeitige Laeufe auf derselben Datenbank sind kein Plan, sondern ein
   * Zufall.
   */
  it('die Ablaufwarnungen laufen VOR dem Dienstplangenerator', () => {
    const minute = (s: string): number => {
      const [m, h] = s.split(' ');
      return Number(h) * 60 + Number(m);
    };
    const register = new Map(alleJobs(db).map((j) => [j.schluessel, j.zeitplan]));
    expect(minute(register.get('nachweis_warnungen')!))
      .toBeLessThan(minute(register.get('einsaetze_generieren')!));
  });
});
