import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEIN_TEXTE, PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';

/**
 * Wer `?monat=` LIEST, muss ihn auch SETZEN lassen (V-053, EMP-03).
 *
 * **Der Befund.** Drei Arbeiterseiten werteten den Parameter aus:
 * `/portal/mein/zeiten`, `/portal/mein/monatsnachweis` und
 * `/portal/mein/stundenkonto`. Nur die dritte bot ein Bedienelement, das ihn
 * erzeugt — zwei nackte Pfeile mit einer Zahl daneben. Auf den anderen
 * beiden musste man die Adresszeile tippen; auf einem Telefon ist das kein
 * Umweg, sondern eine verschlossene Tür.
 *
 * Und es ist genau der Blick, um den es geht: **die Abrechnung des letzten
 * Monats prüft man, wenn der Lohn da ist** — also im nächsten.
 *
 * **Warum das eine Sperrklinke braucht.** Ein fehlender Knopf wirft keine
 * Ausnahme. Die Seite lädt, zeigt den laufenden Monat und sieht vollständig
 * aus. Die nächste Seite, die `?monat=` liest, wird ihn genauso vergessen —
 * es sei denn, eine Prüfung besteht darauf.
 */

const WURZEL = 'src/app/portal/mein';

function alleSeiten(verzeichnis: string): readonly string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) gefunden.push(...alleSeiten(voll));
    else if (eintrag === 'page.tsx') gefunden.push(voll);
  }
  return gefunden;
}

describe('(1) jede Seite, die den Monat liest, lässt ihn wechseln', () => {
  it('kein `?monat=`-Leser ohne Monatswechsler', () => {
    const fehlend: string[] = [];
    for (const datei of alleSeiten(WURZEL)) {
      const quelle = readFileSync(datei, 'utf8');
      /*
       * Gesucht wird der ZUGRIFF auf den Parameter, nicht das Wort „monat":
       * eine Seite, die eine Spalte „Monat" beschriftet, liest ihn nicht.
       */
      const liest = /\[\s*'monat'\s*\]/u.test(quelle);
      if (liest && !quelle.includes('Monatswechsler')) fehlend.push(datei);
    }
    expect(fehlend).toEqual([]);
  });

  it('und mindestens eine Seite tut es — sonst prüft (1) nichts', () => {
    const leser = alleSeiten(WURZEL).filter(
      (d) => /\[\s*'monat'\s*\]/u.test(readFileSync(d, 'utf8')));
    expect(leser.length).toBeGreaterThanOrEqual(3);
  });
});

describe('(2) der Wechsler spricht alle vier Sprachen (SPEC §10)', () => {
  it('jede Sprache nennt die drei Wörter, und keines ist leer', () => {
    for (const sprache of PORTAL_SPRACHEN) {
      const t = MEIN_TEXTE[sprache];
      for (const wort of [t.monatVorher, t.monatSpaeter, t.monatHeute] as const) {
        expect(wort.trim()).not.toBe('');
      }
    }
  });

  it('keine zwei Sprachen teilen sich dasselbe Wort für „voriger Monat"', () => {
    /*
     * Eine kopierte Zeile ist die haeufigste Art, eine Uebersetzung zu
     * vergessen — sie faellt niemandem auf, weil der Bildschirm gefuellt
     * aussieht. Deutsch und Englisch teilen hier nichts; waere es so, waere
     * es ein Versehen.
     */
    const woerter = PORTAL_SPRACHEN.map((s) => MEIN_TEXTE[s].monatVorher);
    expect(new Set(woerter).size).toBe(woerter.length);
  });
});

describe('(3) die Entscheidung über einen Einwand hat Wörter (V-051)', () => {
  it('jede Sprache benennt alle sechs Zustände', async () => {
    const { EINWAND_STATUS_TEXTE } = await import('../../src/lib/i18n/texte.js');
    const zustaende = [
      'offen', 'in_pruefung', 'anerkannt', 'teilweise_anerkannt',
      'abgelehnt', 'zurueckgezogen',
    ] as const;
    for (const sprache of PORTAL_SPRACHEN) {
      for (const z of zustaende) {
        expect(EINWAND_STATUS_TEXTE[sprache][z].trim()).not.toBe('');
      }
    }
  });

  it('die Seite zeigt Zustand, Zeitpunkt UND Begründung — nicht nur den Zustand', () => {
    const quelle = readFileSync(
      'src/app/portal/mein/zeiten/[id]/einwand/page.tsx', 'utf8');
    /*
     * Vorher stand dort `{e.status}` — der rohe Enum-Wert — und sonst nichts.
     * Diese drei Zeilen halten fest, dass alle drei Teile der Entscheidung
     * auf dem Bildschirm landen.
     */
    expect(quelle).toContain('EINWAND_STATUS_TEXTE');
    expect(quelle).toContain('einwandEntschiedenAm');
    expect(quelle).toContain('entscheidungBegruendung');
    expect(quelle).not.toMatch(/<Feld label=\{t\.status\}>\{e\.status\}<\/Feld>/u);
  });
});
