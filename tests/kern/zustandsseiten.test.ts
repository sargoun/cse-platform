import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Die drei Zustandsseiten — dass es sie GIBT, und was sie nicht tun dürfen.
 *
 * **Warum eine Prüfung auf Dateien und nicht auf Verhalten.** Das Verhalten
 * prüft die Browsersuite (`tests/e2e/zustandsseiten.spec.ts`). Hier steht die
 * andere Hälfte: dass diese Dateien überhaupt existieren. 232 Aufrufe von
 * `notFound()` führten monatelang auf Next.js' englische Vorgabe, und niemand
 * hat es bemerkt — weil eine fehlende `not-found.tsx` kein Fehler ist,
 * sondern einfach eine andere Seite. Genau diese Klasse von Lücke findet kein
 * Test, der nur prüft, was da ist.
 */
const WURZEL = resolve(import.meta.dirname, '../..');
const APP = join(WURZEL, 'src/app');

function lies(name: string): string {
  return readFileSync(join(APP, name), 'utf8');
}

describe('Zustandsseiten (DESIGN §5)', () => {
  for (const datei of ['not-found.tsx', 'error.tsx']) {
    it(`\`${datei}\` existiert an der Wurzel von src/app`, () => {
      /*
       * An der WURZEL, nicht in einer Routengruppe: Next.js sucht die nächste
       * oberhalb der Stelle, an der der Fall fällt. Eine Datei in `(public)`
       * deckt `/auth/…` nicht ab — und `/auth/…` ist genau der Pfad, auf dem
       * jemand mit einem alten Link landet.
       */
      expect(existsSync(join(APP, datei)), `${datei} fehlt`).toBe(true);
    });
  }

  it('die Fehlerseite zeigt den `digest` — und keine Fehlermeldung', () => {
    const quelle = lies('error.tsx');
    expect(quelle).toContain('digest');
    /*
     * `fehler.message` auf dem Bildschirm kann einen Tabellennamen, ein
     * SQL-Fragment oder den Inhalt einer Zeile tragen. Der `digest` verrät
     * nichts und macht eine Nachfrage trotzdem beantwortbar.
     */
    expect(quelle).not.toMatch(/\{\s*fehler\.message\s*\}/u);
    expect(quelle).not.toMatch(/\{\s*fehler\.stack\s*\}/u);
  });

  it('beide sind deutsch — das Portal ist es auch', () => {
    for (const datei of ['not-found.tsx', 'error.tsx']) {
      const quelle = lies(datei);
      expect(quelle, datei).not.toMatch(/Page not found|Something went wrong|Loading\.\.\./u);
    }
  });

  it('der 404-Text verrät nicht, ob die Seite fehlt oder jemand anderem gehört', () => {
    /*
     * AUT-06: ein fehlendes RECHT bekommt denselben 404 wie eine fehlende
     * SEITE. Ein Text wie „Sie haben keine Berechtigung" nähme dem Statuscode
     * genau die Eigenschaft, um derentwillen er 404 ist.
     */
    const quelle = lies('not-found.tsx');
    expect(quelle).not.toMatch(/keine Berechtigung|nicht berechtigt|kein Zugriff/u);
  });

  /**
   * **Die teuerste Zeile dieser Datei.**
   *
   * Eine `loading.tsx` hüllt ihr Segment in eine Suspense-Grenze: die Hülle
   * geht hinaus, BEVOR die Seite irgendetwas entschieden hat — mit Status
   * `200`. An der Wurzel macht das aus jedem `404` der Anwendung ein `200`,
   * auch aus dem, an dem AUT-06 hängt: die Anfrage nach den Daten einer
   * fremden Gesellschaft antwortete dann *gefunden*.
   *
   * Sie war geschrieben, sah harmlos aus, und hat jeden Statuscode der
   * Anwendung umgelegt, bis eine Browserprüfung es fand. Diese Prüfung ist
   * der Grund, warum das nicht ein zweites Mal passiert — und sie prüft das
   * GANZE `src/app`, nicht nur die Wurzel: jedes Segment hier kann
   * `notFound()` rufen.
   */
  it('es gibt NIRGENDS eine loading.tsx — sie macht aus jedem 404 eine 200', () => {
    const gefunden: string[] = [];
    const suche = (verzeichnis: string): void => {
      for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
        const voll = join(verzeichnis, eintrag.name);
        if (eintrag.isDirectory()) suche(voll);
        else if (eintrag.name === 'loading.tsx' || eintrag.name === 'loading.jsx') {
          gefunden.push(relative(WURZEL, voll));
        }
      }
    };
    suche(APP);
    expect(gefunden, 'DESIGN §5: eine Ladeseite gehört IN die Seite, nicht davor')
      .toEqual([]);
  });

  it('keine der beiden baut einen Verweis ungeprüft aus dem Pfad', () => {
    /*
     * Die 404-Seite liest den Pfad, um zurück ins Portal zu zeigen. Ein
     * Verweis, der ungeprüft daraus entsteht, ist die Stelle, an der jemand
     * `/portal/..%2f..` unterbringt — deshalb steht dort ein Muster.
     */
    expect(lies('not-found.tsx')).toMatch(/\[a-z0-9-\]/u);
  });
});
