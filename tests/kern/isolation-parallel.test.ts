import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FENSTER_SCHLUESSEL_TEST, HOECHSTENS_WORKER, anzahlWorker, datenbankName, mitDatenbank,
  pruefeBezeichner, psqlBefehl, verwaltungsUrl, vorlagenNamen, workerUrl,
} from '../../tests/isolation/parallel.js';
import konfiguration from '../../vitest.isolation.config.js';

/**
 * Die parallele Isolationssuite (D-424) — was ohne Datenbank beweisbar ist.
 *
 * Der Kern der Zusage: zwei Arbeiter sehen nie dieselbe Datenbank. Das haengt
 * an drei reinen Funktionen und an der Konfiguration; beides steht hier.
 */
const WURZEL = resolve(import.meta.dirname, '../..');
const BASIS = 'postgres://postgres@localhost:55432/cse_test';

describe('jeder Arbeiter bekommt seine eigene Datenbank', () => {
  it('haengt die Pool-Kennung an den Namen — und nur an den Namen', () => {
    expect(workerUrl(BASIS, '3')).toBe('postgres://postgres@localhost:55432/cse_test_w3');
    expect(workerUrl(`${BASIS}?sslmode=disable`, '1'))
      .toBe('postgres://postgres@localhost:55432/cse_test_w1?sslmode=disable');
  });

  it('laesst die Adresse ohne Pool-Kennung unveraendert', () => {
    expect(workerUrl(BASIS, undefined)).toBe(BASIS);
    expect(workerUrl(BASIS, '')).toBe(BASIS);
  });

  it('zwei Kennungen, zwei Datenbanken — nie dieselbe', () => {
    const namen = new Set([1, 2, 3, 4].map((i) => datenbankName(workerUrl(BASIS, String(i)))));
    expect(namen.size).toBe(4);
    expect(namen.has('cse_test')).toBe(false);
  });

  it('Name, Verwaltung und Vorlagen leiten sich aus derselben Adresse ab', () => {
    expect(datenbankName(BASIS)).toBe('cse_test');
    expect(verwaltungsUrl(BASIS)).toBe('postgres://postgres@localhost:55432/postgres');
    expect(mitDatenbank(BASIS, 'cse_seed')).toBe('postgres://postgres@localhost:55432/cse_seed');
    expect(vorlagenNamen('cse_test')).toEqual({
      seed: 'cse_test_vorlage', inhalt: 'cse_test_vorlage_inhalt',
    });
  });
});

describe('die Zahl der Arbeiter', () => {
  it('folgt den Kernen, hoechstens vier', () => {
    expect(anzahlWorker({}, 2)).toBe(2);
    expect(anzahlWorker({}, 16)).toBe(HOECHSTENS_WORKER);
    expect(anzahlWorker({}, 0)).toBe(1);
  });

  it('`CSE_ISOLATION_WORKER` gewinnt — der serielle Lauf bleibt erreichbar', () => {
    expect(anzahlWorker({ CSE_ISOLATION_WORKER: '1' }, 8)).toBe(1);
    expect(anzahlWorker({ CSE_ISOLATION_WORKER: '9' }, 8)).toBe(HOECHSTENS_WORKER);
    expect(anzahlWorker({ CSE_ISOLATION_WORKER: 'x' }, 3)).toBe(3);
  });
});

describe('die Konfiguration traegt den Aufbau — nicht nur die Absicht', () => {
  it('globalSetup baut die Klone, und die Dateien laufen in Forks', () => {
    const test = (konfiguration as { test?: Record<string, unknown> }).test ?? {};
    expect(test['globalSetup']).toEqual(['./tests/isolation/global-setup.ts']);
    expect(test['pool']).toBe('forks');
    expect(test['maxWorkers']).toBe(test['minWorkers']);
    expect(test['fileParallelism']).toBe((test['maxWorkers'] as number) > 1);
  });

  /**
   * Der Schluessel steht zweimal — in `scripts/test-db.sh` fuer die Basis und
   * hier fuer die Klone. Laufen sie auseinander, rechnet `app.arbzg_belastung`
   * in einem Klon ueber andere Fenstergruppen als in der Basis.
   */
  it('der Test-Fensterschluessel ist derselbe wie in scripts/test-db.sh', () => {
    const skript = readFileSync(join(WURZEL, 'scripts/test-db.sh'), 'utf8');
    const treffer = /cse\.fenster_schluessel = '([A-Za-z0-9+/=]+)'/u.exec(skript);
    expect(treffer?.[1]).toBe(FENSTER_SCHLUESSEL_TEST);
  });
});

describe('die Klone haben pruefbare Namen und finden psql', () => {
  it('ein Name, der kein Bezeichner ist, faellt laut — nicht als halbes Kommando', () => {
    expect(pruefeBezeichner('cse_test_w3')).toBe('cse_test_w3');
    expect(() => pruefeBezeichner('cse"; drop database postgres; --'))
      .toThrow(/zulaessiger Datenbankname/u);
    expect(() => pruefeBezeichner('')).toThrow();
    expect(() => pruefeBezeichner('Cse-Test')).toThrow();
  });

  it('psql kommt vom PATH, wenn es dort liegt', () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), 'cse-psql-'));
    writeFileSync(join(verzeichnis, 'psql'), '#!/bin/sh\n');
    try {
      expect(psqlBefehl({ PATH: `/nirgends${delimiter}${verzeichnis}` }))
        .toBe(join(verzeichnis, 'psql'));
    } finally {
      rmSync(verzeichnis, { recursive: true, force: true });
    }
  });

  it('… und sonst aus /usr/lib/postgresql oder als nackter Befehl — nie leer', () => {
    const ergebnis = psqlBefehl({ PATH: '/nirgends' });
    expect(ergebnis === 'psql' || /^\/usr\/lib\/postgresql\/\d+\/bin\/psql$/u.test(ergebnis))
      .toBe(true);
  });
});
