import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MERKMALE, MERKMAL_TEXT } from '../../src/app/portal/[mandant]/zeiten/daten.js';

/**
 * **Ein Zustand, den vier Oberflächen beschriften und nichts erzeugt**
 * (V-083, TIM-11, O-890).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund — und warum er NICHT gebaut wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `zeiteintrag_status` führt seit `0034` den Wert `offen_nacherfassung`, und
 * nichts im Baum schreibt ihn. Die naheliegende Antwort wäre, ihn zu setzen —
 * und sie wäre falsch. Er wäre der ehrliche Zustand für „von der Planung
 * gesetzt, aber noch nicht bestätigt"; nur beschreibt **kein Dokument, wer
 * ihn wieder wegnimmt und was bis dahin gilt**: zählt die Stunde ins
 * Stundenkonto, steht sie im Monatsnachweis, darf sie abgerechnet werden?
 * Ein Eintrag in einem Zustand, aus dem kein Weg herausführt, ist schlimmer
 * als keiner. Die Frage steht als O-890 beim Auftraggeber.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier festgehalten wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. **Niemand schreibt den Wert** — und wenn eines Tages jemand anfängt,
 *     fällt genau diese Prüfung um. Das ist die Erinnerung, dass dann auch
 *     der erklärende Satz auf der Zeitenliste verschwinden muss und O-890
 *     beantwortet ist.
 *  2. **Das Merkmal bleibt in der Auswahl.** Der Satz der Merkmale ist der
 *     Satz der Zustände; eines herauszunehmen hiesse, die Auswahl bei der
 *     Antwort wieder zu ändern und bis dahin zu verschweigen, dass es den
 *     Zustand gibt.
 *  3. **Und daneben steht der Satz.** Eine leere Liste sagt von sich aus
 *     nicht, ob niemand gearbeitet hat oder ob dieser Zustand gar nicht
 *     entstehen kann — das ist der eigentliche Fehler, den V-083 benennt.
 */

const WERT = 'offen_nacherfassung';

function alleDateien(verzeichnis: string): readonly string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) gefunden.push(...alleDateien(pfad));
    else if (pfad.endsWith('.ts') || pfad.endsWith('.tsx')) gefunden.push(pfad);
  }
  return gefunden;
}

describe('§1 niemand schreibt den Zustand', () => {
  it('kein Dienst und keine Route setzt `offen_nacherfassung`', () => {
    /*
     * Gesucht wird der Wert in einer SCHREIBENDEN Anweisung, nicht seine
     * blosse Erwähnung: `daten.ts` führt ihn als Merkmal, drei Blätter
     * beschriften ihn, und ein Dutzend Kommentare erklären ihn. Ein `toContain`
     * auf den blossen Namen wäre deshalb immer rot.
     */
    const treffer: string[] = [];
    for (const datei of [...alleDateien('src/server'), ...alleDateien('src/app/api')]) {
      const inhalt = readFileSync(datei, 'utf8');
      for (const [i, zeile] of inhalt.split('\n').entries()) {
        const roh = zeile.trimStart();
        if (roh.startsWith('*') || roh.startsWith('//') || roh.startsWith('/*')) continue;
        if (!zeile.includes(WERT)) continue;
        /* `set status = 'offen_nacherfassung'` oder als Wert in einem INSERT. */
        if (/status\s*=\s*'offen_nacherfassung'|'offen_nacherfassung'::zeiteintrag_status/u
          .test(zeile)) {
          treffer.push(`${datei}:${String(i + 1)}`);
        }
      }
    }
    expect(treffer,
      'Schreibt jetzt jemand den Zustand? Dann ist O-890 beantwortet — und der '
      + 'erklärende Satz auf /zeiten muss weg.').toEqual([]);
  });
});

describe('§2 das Merkmal bleibt — und trägt seinen Satz', () => {
  it('steht weiter in der Auswahl der Zeitenliste', () => {
    expect(MERKMALE).toContain(WERT);
    expect(MERKMAL_TEXT[WERT]).toBe('Nacherfassung offen');
  });

  it('und die Seite erklärt, dass ihn heute nichts erzeugt', () => {
    const seite = readFileSync('src/app/portal/[mandant]/zeiten/page.tsx', 'utf8');
    expect(seite).toContain('merkmal-ohne-erzeuger');
    /*
     * Die OFFENE FRAGE wird beim Namen genannt. Ein Satz „gibt es nicht"
     * ohne ihre Nummer wäre eine Behauptung ohne Adresse — und niemand
     * wüsste, wen zu fragen ist, damit es sie gibt.
     */
    expect(seite).toContain('O-890');
    /* Und der Weg, den ein Mensch stattdessen sucht, steht daneben. */
    expect(seite).toContain("MERKMAL_TEXT['nacherfasst']");
  });
});
