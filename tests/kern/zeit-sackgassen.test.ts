import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  istMerkmal, MERKMALE, MERKMAL_TEXT,
} from '../../src/app/portal/[mandant]/zeiten/daten.js';

/**
 * **Zwei Bildschirme, die etwas wussten und es nicht sagten** (V-070, V-071).
 *
 * Beide Befunde haben dieselbe Form und sind deshalb in einer Datei: eine
 * Seite hat die Auskunft bereits geladen — als Zahl, als Merker — und lässt
 * den Menschen damit stehen.
 *
 * **V-070.** Der Monatsabschluss meldet „3 Zeiteinträge sind nicht
 * freigegeben" und zeigte auf nichts. Wer die drei sehen wollte, musste sie in
 * einer Wochenliste suchen, ohne zu wissen, in welcher Woche — und die Liste
 * kannte nicht einmal ein Merkmal dafür: sie konnte „freigegeben" filtern und
 * dessen Gegenteil nicht.
 *
 * **V-071.** Das Zeiteintragsblatt lädt `freigegeben`, `abgerechnet` und
 * `gesperrt` seit je mit — `ZEILE_SPALTEN` führt alle drei — und zeigte
 * keinen davon. Es sind genau die drei Fragen, die man an einem Eintrag
 * stellt: Lässt sich das noch korrigieren? Ist das schon im Lohn? Ist der
 * Monat zu?
 *
 * **Warum eine Sperrklinke.** Ein fehlender Verweis wirft keine Ausnahme. Die
 * Seite lädt, sieht vollständig aus, und die Auskunft bleibt in einer
 * Variablen liegen.
 */

describe('(1) die Liste kann nach „nicht freigegeben" filtern (V-070)', () => {
  it('das Merkmal gibt es, und es hat ein Wort', () => {
    expect(istMerkmal('nicht_freigegeben')).toBe(true);
    expect(MERKMALE).toContain('nicht_freigegeben');
    expect(MERKMAL_TEXT['nicht_freigegeben'].trim()).not.toBe('');
  });

  it('jedes Merkmal trägt ein Wort — keines ist eine leere Beschriftung', () => {
    for (const m of MERKMALE) expect(MERKMAL_TEXT[m].trim()).not.toBe('');
  });

  it('und ein erfundenes Merkmal wird abgewiesen', () => {
    // Ein durchgereichter Fremdwert wäre eine Bedingung aus der Adresszeile.
    expect(istMerkmal('nicht_abgerechnet')).toBe(false);
    expect(istMerkmal("';--")).toBe(false);
  });
});

describe('(2) die Zeitliste kennt ein Monatsfenster (V-070)', () => {
  const LISTE = 'src/app/portal/[mandant]/zeiten/page.tsx';

  it('`?monat=` spannt das Fenster über den ganzen Monat', () => {
    const quelle = readFileSync(LISTE, 'utf8');
    expect(quelle).toMatch(/\[\s*'monat'\s*\]/u);
    // Ein Verweis auf die erste WOCHE des Monats zeigte einen Teil der
    // Einträge und behauptete, es seien alle.
    expect(quelle).toContain('monatVerschieben');
  });

  it('und führt zurück in die Wochenansicht', () => {
    // Das Monatsfenster ist der Sonderfall; wer darin landet, muss wieder
    // heraus, ohne die Adresszeile zu putzen.
    expect(readFileSync(LISTE, 'utf8')).toContain('Zur Wochenansicht');
  });
});

describe('(3) der Monatsabschluss führt zu den offenen Einträgen (V-070)', () => {
  const ABSCHLUSS =
    'src/app/portal/[mandant]/personal/stundenkonten/abschluss/page.tsx';

  it('die Zahl ist ein Verweis, kein Satz', () => {
    const quelle = readFileSync(ABSCHLUSS, 'utf8');
    expect(quelle).toContain('zu-offenen-zeiten');
    expect(quelle).toContain('merkmal=nicht_freigegeben');
  });

  it('und der Verweis hängt am Recht SEINES Ziels (AUT-06)', () => {
    /*
     * Die Seite trägt `zeit.konto_lesen`, das Ziel `zeit.lesen`. Ohne die
     * Prüfung führte der Verweis für eine Rolle mit dem einen und ohne das
     * andere auf 404 — und ein Menüpunkt, der auf 404 führt, verrät, was er
     * nicht zeigen darf.
     */
    const quelle = readFileSync(ABSCHLUSS, 'utf8');
    expect(quelle).toContain("darf['zeit.lesen']");
  });
});

describe('(4) das Zeiteintragsblatt zeigt, was es weiss (V-071)', () => {
  const BLATT = 'src/app/portal/[mandant]/zeiten/[id]/page.tsx';

  it('Freigabe, Abrechnung und Sperre stehen auf dem Blatt', () => {
    const quelle = readFileSync(BLATT, 'utf8');
    expect(quelle).toContain('freigegebenAmLokal');
    expect(quelle).toContain('abgerechnetAmLokal');
    expect(quelle).toContain('gesperrtAmLokal');
  });

  it('als ZEITPUNKT und nicht als „ja"', () => {
    /*
     * „Freigegeben: ja" ist die halbe Auskunft; im Lohnstreit lautet die
     * Frage, wann. Die Daten liefern den Stempel in Berliner Ortszeit — die
     * Seite zeigt ihn, statt ihn auf einen Wahrheitswert zu verkürzen.
     */
    const daten = readFileSync('src/app/portal/[mandant]/zeiten/daten.ts', 'utf8');
    expect(daten).toContain('freigegeben_am_lokal');
    expect(daten).toContain("to_char(z.abgerechnet_am at time zone 'Europe/Berlin'");
  });

  it('und sagt, was die Sperre bedeutet', () => {
    // Eine Zeitangabe allein sagt nicht, dass sie eine Tür schliesst.
    expect(readFileSync(BLATT, 'utf8')).toContain('zeit-gesperrt-hinweis');
  });
});
