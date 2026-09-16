/**
 * **Der Firmenname im Kopf ist nur dann ein Weg, wenn er einer ist.**
 *
 * `PortalRahmen` zeigt oben links die Wortmarke und, auf Unterseiten, eine
 * Spur (`‹ Uebersicht › Seite`). Beide verwiesen bedingungslos auf die
 * Portalwurzel — und die Uebersicht traegt ein eigenes Leserecht
 * (`bericht.dashboard_lesen` im Mandantenportal, `gruppe.bericht.lesen` in
 * der Gruppensicht). Rechte sind je Gesellschaft einzeln widerrufbar; wem es
 * fehlt, der bekam hinter dem Firmennamen ein 404 — auf JEDER Portalseite,
 * weil der Rahmen ueberall derselbe ist (AUT-06, D-581, D-583).
 *
 * Die Bedingung gehoert genau hierher und nicht in die 162 Seiten: eine
 * Regel, die man 162-mal schreiben muss, schreibt irgendwann jemand nicht.
 * Deshalb prueft dieser Fall den RAHMEN — und `verweis-rechte.test.ts` darf
 * die Wurzel im Gegenzug ueberspringen.
 *
 * Gefragt wird die Tab-Leiste, weil `portalZugang` sie in derselben
 * gebundenen Transaktion bewertet hat wie den Zugang zur Seite. Eine zweite
 * Abfrage waere eine zweite Wahrheit ueber dasselbe Recht — und ein
 * Datenbankgang auf jeder Seite.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TABLEISTEN } from '../../src/server/registry/tableiste.js';

const RAHMEN = readFileSync(fileURLToPath(new URL(
  '../../src/components/portal/PortalRahmen.tsx', import.meta.url)), 'utf8');

describe('die Portalwurzel im Rahmen haengt an ihrem Recht (D-583)', () => {
  it('der Rahmen berechnet `wurzelOffen` aus der Tab-Leiste', () => {
    expect(RAHMEN).toMatch(/const wurzelTab = tabs\.ziele\.find\(/u);
    expect(RAHMEN).toMatch(/sichtbareTabs\[wurzelTab\.schluessel\] !== false/u);
  });

  it('jeder Verweis auf `wurzel` steht unter dieser Bedingung', () => {
    /*
     * Gezaehlt wird im QUELLTEXT: jeder `href={wurzel}` muss im selben
     * Ausdruck von `wurzelOffen` abhaengen. Die Glocke bekommt `wurzel` als
     * Eigenschaft und baut daraus ihr eigenes Ziel — sie zaehlt hier nicht.
     */
    const verweise = [...RAHMEN.matchAll(/href=\{wurzel\}/gu)].length;
    const bedingt = [...RAHMEN.matchAll(/wurzelOffen \?/gu)].length;
    expect(verweise).toBeGreaterThan(0);
    expect(bedingt, 'jeder `href={wurzel}` braucht seinen `wurzelOffen`-Zweig')
      .toBe(verweise);
  });

  it('ohne Recht bleibt der Name ein Name — kein gesperrter Knopf', () => {
    expect(RAHMEN).toMatch(/data-cse="portal-logo-ohne-ziel"/u);
    expect(RAHMEN).toMatch(/data-cse="spur-ohne-ziel"/u);
    expect(RAHMEN).not.toMatch(/aria-disabled=\{?["']?true/u);
  });

  /**
   * **Hoechstens eines — und keines ist auch eine Antwort.**
   *
   * Das Mitarbeiterportal fuehrt seine Wurzel („Heute") ohne Recht: es ist
   * `selbst`-bewacht, jede Kraft sieht ihren eigenen Tag. Der Rahmen laesst
   * den Verweis dann stehen, und das ist richtig — die Pruefung verlangt
   * deshalb nicht EIN Ziel mit Recht, sondern hoechstens eines. Zwei waeren
   * zweideutig: der Rahmen naehme das erste und wuesste nicht, dass es ein
   * zweites gibt.
   */
  it('keine Leiste hat mehr als ein Wurzelziel mit Recht', () => {
    for (const leiste of TABLEISTEN) {
      const wurzelZiele = leiste.ziele.filter((z) => z.pfad === '' && z.recht !== null);
      expect(wurzelZiele.length,
        `Leiste ${leiste.schluessel} hat ${String(wurzelZiele.length)} Wurzelziele mit Recht`)
        .toBeLessThanOrEqual(1);
    }
  });

  it('die Leisten der beiden Portale mit Dashboard fuehren ihr Recht auch', () => {
    const mitRecht = TABLEISTEN.filter(
      (l) => l.ziele.some((z) => z.pfad === '' && z.recht !== null));
    expect(mitRecht.map((l) => l.schluessel).length,
      'kein einziges Wurzelrecht — dann prueft der Rahmen nie etwas')
      .toBeGreaterThan(0);
  });
});
