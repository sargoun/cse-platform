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

  /**
   * **Reines ASCII — und das ist keine Stilfrage, sondern die Bedingung dafür,
   * dass die Datei überhaupt läuft.**
   *
   * Ein Nutzer bekam beim Start drei Parserfehler, der erste davon auf der
   * LETZTEN Zeile („Die Zeichenfolge hat kein Abschlusszeichen: '"). Die Datei
   * war syntaktisch einwandfrei — nur nicht in der Kodierung, in der Windows
   * PowerShell 5.1 sie liest: ohne BOM nimmt es **ANSI (Windows-1252)**, nicht
   * UTF-8.
   *
   * Ein Geviertstrich `—` ist in UTF-8 `E2 80 94`. Als Windows-1252 gelesen
   * werden daraus drei Zeichen, und das letzte (`0x94`) ist U+201D — ein
   * typografisches Anführungszeichen. **PowerShell erkennt die typografischen
   * Anführungszeichen als Anführungszeichen.** Jeder Gedankenstrich im Skript
   * öffnete damit eine Zeichenkette, die nie geschlossen wurde; der Parser
   * meldete das Ende der Datei, und der Mensch davor suchte auf der falschen
   * Zeile.
   *
   * Ein BOM täte es auch. ASCII ist die stärkere Zusicherung: es überlebt
   * jeden Editor, jedes Entpacken und jedes Kopieren durch ein Fenster, das
   * die Kodierung nicht kennt.
   */
  it('ist reines ASCII — sonst liest Windows PowerShell 5.1 es als ANSI', () => {
    const fremd = [...roh]
      .map((z, i) => ({ z, i }))
      .filter(({ z }) => z.codePointAt(0)! > 127)
      .slice(0, 10)
      .map(({ z, i }) => `${z} (U+${z.codePointAt(0)!.toString(16).toUpperCase()}) an ${String(i)}`);
    expect(
      fremd,
      'Ohne BOM liest Windows PowerShell 5.1 die Datei als Windows-1252. Ein '
      + '`—` wird dabei zu `â€”`, und das Schluss-Byte ist ein typografisches '
      + 'Anführungszeichen, das PowerShell als Anführungszeichen erkennt — die '
      + 'Datei lässt sich dann nicht mehr parsen.',
    ).toEqual([]);
  });

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
