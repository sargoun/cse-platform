import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohnePsKommentare } from './hilfen/quelltext.js';

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

describe('Das Windows-Startskript', () => {
  /**
   * **Ein Skript, das die Anleitung nicht kennt, ist eine zweite Anleitung.**
   *
   * `scripts/windows-start.ps1` gibt es, weil eine Liste von zehn Befehlen zum
   * Einzelkopieren genau das nicht auffangen kann, was beim Einfügen schiefgeht:
   * PowerShell bleibt bei einem Fehler nicht stehen, also lief die Liste über
   * den ersten Fehlschlag hinweg und endete mit drei Meldungen, von denen nur
   * die erste zählte.
   *
   * Diese Prüfungen halten fest, was das Skript können MUSS — nicht, wie es
   * formuliert ist.
   */
  const roh = readFileSync(
    resolve(import.meta.dirname, '../../scripts/windows-start.ps1'), 'utf8');
  /*
   * **Ohne die Kommentare.** Der Kopf des Skripts ERZÄHLT den Fehlschlag, für
   * den es das Skript gibt — samt der Wörter `pnpm build` und `Hafen 3001`.
   * Eine Prüfung, die den Rohtext durchsucht, findet die Erzählung vor dem
   * Befehl und misst die falsche Reihenfolge.
   */
  const skript = ohnePsKommentare(roh);

  it('die Anleitung nennt es als kurzen Weg', () => {
    expect(anleitung).toContain('windows-start.ps1');
  });

  it('es beendet einen laufenden Server, BEVOR es baut', () => {
    /*
     * Der Fehlschlag, für den es das Skript gibt. Die Reihenfolge ist die
     * Zusicherung: stoppen, dann bauen — nicht umgekehrt.
     */
    const stopp = skript.indexOf('Stop-Process');
    const bau = skript.indexOf('pnpm build');
    expect(stopp, 'kein Stop-Process im Skript').toBeGreaterThan(-1);
    expect(bau, 'kein pnpm build im Skript').toBeGreaterThan(-1);
    expect(stopp, 'erst beenden, dann bauen').toBeLessThan(bau);
  });

  it('und es beendet NUR einen Server dieses Projekts', () => {
    /*
     * `Stop-Process` auf alles, was den Hafen hält, würde irgendwann ein
     * fremdes Programm treffen. `/healthz` ist die Route, die ein fremder
     * Dienst nicht zufällig nachbildet.
     */
    expect(skript).toContain('/healthz');
  });

  it('es bleibt bei einem Fehlschlag stehen', () => {
    // Ohne diese Prüfung läuft PowerShell über den ersten Fehler hinweg.
    expect(skript).toContain('LASTEXITCODE');
    expect(skript).toMatch(/exit 1/u);
  });

  it('es benutzt dasselbe Datenbankbild wie CI und die Anleitung', () => {
    expect(skript).toContain('pgvector/pgvector:pg16');
  });

  it('es setzt den ArbZG-Fensterschluessel — sonst bleibt der Seed unvollstaendig', () => {
    expect(skript).toContain('cse.fenster_schluessel');
  });

  it('es setzt CSE_DEV_FLAECHEN — sonst kommt das Telefon nicht hinein (D-541)', () => {
    expect(skript).toContain('CSE_DEV_FLAECHEN');
  });
});
