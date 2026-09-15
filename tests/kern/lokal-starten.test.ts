import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **Die Anleitung muss denselben Server nennen wie die CI.**
 *
 * Sie tat es nicht. `docs/LOKAL-STARTEN.md` sagte `postgres:16`, die CI
 * benutzt seit `0151` `pgvector/pgvector:pg16` — und wer der Anleitung folgte,
 * lief 151 Migrationen weit und bekam dann `extension "vector" is not
 * available`. Danach war die Datenbank halb migriert, und die beiden nächsten
 * Befehle scheiterten an ganz anderen Meldungen: drei Fehler, ein Ursprung,
 * eine halbe Stunde.
 *
 * Eine Anleitung ist Code, den ein Mensch ausführt. Sie gehört unter dieselbe
 * Wache.
 */
const WURZEL = resolve(import.meta.dirname, '../..');

const anleitung = readFileSync(join(WURZEL, 'docs/LOKAL-STARTEN.md'), 'utf8');
const ciBild = /image:\s*(\S+)/u.exec(
  readFileSync(join(WURZEL, '.github/workflows/a11y.yml'), 'utf8'))?.[1] ?? '';

describe('docs/LOKAL-STARTEN.md', () => {
  it('die CI nennt überhaupt ein Bild — sonst prüft dieser Test nichts', () => {
    expect(ciBild).not.toBe('');
    expect(ciBild).toMatch(/:/u);
  });

  it('nennt DASSELBE Bild wie die CI', () => {
    const bilder = [...anleitung.matchAll(/-p 5433:5432 (\S+)/gu)].map((m) => m[1]);
    expect(bilder.length, 'kein `docker run` in der Anleitung gefunden')
      .toBeGreaterThan(0);
    for (const bild of bilder) expect(bild).toBe(ciBild);
  });

  it('erklärt, warum es nicht das nackte postgres:16 ist', () => {
    /*
     * Ohne den Satz steht dort ein Bildname, den beim naechsten Aufraeumen
     * jemand "vereinfacht" -- und der Fehler ist zurueck.
     */
    expect(anleitung).toMatch(/vector/iu);
  });

  it('nennt den Fensterschlüssel, ohne den der Seed unvollständig bleibt', () => {
    expect(anleitung).toContain('cse.fenster_schluessel');
  });
});
