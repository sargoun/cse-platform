import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEIN_TEXTE, PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';

/**
 * **Zwei Felder, die es gab und die nie etwas enthielten** (V-059, V-060).
 *
 * **V-060 — die Gerätezeit.** Vier Formulare trugen ein verstecktes
 * `geraete_zeit`, sechs Routen nehmen den Wert entgegen, die Datenbank leitet
 * `zeitabweichung_sek` daraus ab — und **kein einziges Formular füllte es**.
 * Jede Anzeige der Abweichung stand seit je auf „—", nicht weil die Uhren
 * stimmten, sondern weil nie eine zweite Uhr gefragt wurde. Ein Telefon, das
 * eine Stunde nachgeht, erzeugt damit eine Schicht, die um eine Stunde
 * verschoben behauptet wird und trotzdem sauber aussieht.
 *
 * **V-059 — die vierte Positionszeile.** Der Leistungsnachweis bot genau
 * drei, fest verdrahtet in Seite UND Route, ohne „Zeile hinzufügen". Bei
 * einer Grundreinigung mit Glas, Sanitär, Boden und Sonderfläche ist die
 * vierte Zeile der Regelfall.
 *
 * **Warum eine Sperrklinke.** Beides wirft keine Ausnahme. Das Feld ist da,
 * das Formular sendet, die Zeile entsteht — nur steht in der einen Spalte
 * NULL und die vierte Position nirgends.
 */

const WURZEL = 'src/app';

function alleSeiten(verzeichnis: string): readonly string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) gefunden.push(...alleSeiten(voll));
    else if (eintrag.endsWith('.tsx')) gefunden.push(voll);
  }
  return gefunden;
}

describe('(1) kein leeres Gerätezeit-Feld mehr (V-060)', () => {
  it('keine Seite trägt ein totes `geraete_zeit`', () => {
    /*
     * Ein `<input type="hidden" name="geraete_zeit">` ohne Füller ist ein
     * Feld, das aussieht, als würde es etwas melden, und immer leer ankommt.
     * Wer die Gerätezeit will, nimmt den Baustein; wer sie nicht will, lässt
     * das Feld weg.
     */
    const tot = alleSeiten(WURZEL).filter((d) =>
      /<input[^>]*name="geraete_zeit"/u.test(readFileSync(d, 'utf8')));
    expect(tot).toEqual([]);
  });

  it('der Baustein liest die Uhr beim ABSENDEN, nicht beim Laden', () => {
    /*
     * Ein Wert, der beim Rendern entsteht, ist die Zeit, zu der die Seite
     * geöffnet wurde. Bei einem Wachbucheintrag, den jemand in Ruhe tippt,
     * sind das zwanzig Minuten Unterschied — und die Abweichung wiese auf ein
     * Gerät, das gar nicht falsch geht.
     */
    const quelle = readFileSync('src/app/portal/mein/Geraetezeit.tsx', 'utf8');
    expect(quelle).toContain("addEventListener('submit'");
    expect(quelle).toContain('new Date().toISOString()');
    // Und er ist eine Client-Insel: `new Date()` gibt es nur im Browser.
    expect(quelle.startsWith("'use client'")).toBe(true);
  });

  it('die fünf Formulare, die eine Gerätezeit melden, benutzen ihn', () => {
    for (const datei of [
      'src/app/portal/mein/bausteine.tsx',
      'src/app/portal/mein/schichten/[zuordnungId]/wachbuch/page.tsx',
      'src/app/portal/mein/dienstanweisungen/[id]/page.tsx',
      'src/app/portal/[mandant]/qualitaet/pruefungen/neu/page.tsx',
      'src/app/portal/[mandant]/security/schluessel/[id]/quittung/page.tsx',
    ]) {
      expect(readFileSync(datei, 'utf8')).toContain('<Geraetezeit');
    }
  });
});

describe('(2) die vierte Positionszeile (V-059)', () => {
  const SEITE =
    'src/app/portal/mein/schichten/[zuordnungId]/leistungsnachweis/page.tsx';
  const ROUTE =
    'src/app/api/mein/schichten/[zuordnungId]/leistungsnachweis/route.ts';

  it('die Zahl der Zeilen ist keine feste Drei mehr', () => {
    const seite = readFileSync(SEITE, 'utf8');
    expect(seite).not.toContain('const ZEILEN = [0, 1, 2];');
    expect(seite).toContain('ZEILEN_MAX');
    expect(seite).toContain('mehr-zeilen');
  });

  it('und die Route begrenzt sie ein ZWEITES Mal', () => {
    /*
     * Ein Formular ist das, was ankommt, nicht das, was ausgeliefert wurde.
     * Ohne die Schranke in der Route wäre `zeilen=100000` eine Schleife, die
     * niemand bestellt hat.
     */
    const route = readFileSync(ROUTE, 'utf8');
    expect(route).toContain('ZEILEN_MAX');
    expect(route).toMatch(/Math\.min\([^)]*ZEILEN_MAX\)/u);
  });

  it('der Verweis steht in allen vier Sprachen', () => {
    for (const sprache of PORTAL_SPRACHEN) {
      const t = MEIN_TEXTE[sprache];
      expect(t.mehrZeilen.trim()).not.toBe('');
      expect(t.mehrZeilenHinweis.trim()).not.toBe('');
    }
  });

  it('und er warnt, dass Getipptes verloren geht', () => {
    // Ein Verweis, der still löscht, ist eine Falle — auf einem
    // Diensttelefon tippt man langsam.
    expect(MEIN_TEXTE.de.mehrZeilenHinweis).toMatch(/verloren/u);
  });
});
