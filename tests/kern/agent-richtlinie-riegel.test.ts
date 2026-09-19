/**
 * Die Riegel aus `0290` gegen den Code, der sie meint (AGT-03, Invariante 7).
 *
 * **Warum eine Migration gegen TypeScript gehalten wird.** `0290` schreibt
 * zwei Entscheidungen in die Datenbank, die bereits im Code stehen: der
 * Wertebereich von `agent_richtlinie.aktion` sind die acht `AKTIONEN`, und
 * drei davon gehen nie automatisch hinaus. Beides steht damit an zwei Orten —
 * absichtlich (die Datenbank ist die zweite Linie, nicht die einzige), aber
 * zwei Orte laufen auseinander, und hier ist die Richtung, in die sie
 * auseinanderlaufen, teuer:
 *
 *  * Eine neue Aktion in `policy.ts`, die `0290` nicht kennt, lässt sich nicht
 *    konfigurieren — die Seite zeigt sie, und das Speichern scheitert an einem
 *    `check_violation`.
 *  * Eine neue Aktion in `IM_CODE_GESPERRT`, die der Riegel nicht kennt, kann
 *    als `auto_erlaubt = true` in der Tabelle stehen. `gate()` weist sie ab,
 *    also passiert nichts — aber in der Zeile steht eine Erlaubnis, und wer
 *    später belegen soll, was diese Gesellschaft eingestellt HATTE, liest sie
 *    als eine.
 *
 * Der Test liest deshalb die SQL-Datei und nicht eine Abschrift ihrer Listen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AKTIONEN } from '../../src/server/agent/policy.js';
import { IM_CODE_GESPERRT } from '../../src/server/services/agent/richtlinie.js';

const SQL = readFileSync(
  new URL('../../drizzle/0290_agent_richtlinie_willenserklaerung.sql', import.meta.url),
  'utf8');

/** Die Zeichenketten eines `check (aktion in (…))`-Blocks, in Reihenfolge. */
function listeNach(marke: string): readonly string[] {
  const ab = SQL.indexOf(marke);
  expect(ab, `„${marke}" steht nicht in 0290`).toBeGreaterThan(-1);
  const auf = SQL.indexOf('(', SQL.indexOf('aktion in', ab));
  const zu = SQL.indexOf(')', auf);
  return [...SQL.slice(auf, zu).matchAll(/'([a-z_]+)'/gu)].map((m) => m[1] ?? '');
}

describe('0290 — der Wertebereich von `aktion`', () => {
  it('nennt genau die acht AKTIONEN des Gates, in derselben Reihenfolge', () => {
    expect(listeNach('agent_richtlinie_aktion_bekannt')).toEqual([...AKTIONEN]);
  });

  it('und AKTIONEN führt wirklich acht — der Typ kennt keine neunte', () => {
    /*
     * Der Kommentar in `policy.ts` erzaehlt den Fall: `nachtrag_einreichen`
     * stand im TYP und fehlte in AKTIONEN, und `tests/kern/gate.test.ts`
     * laeuft ueber AKTIONEN als den vollstaendigen Konfigurationsraum — die
     * Aktion war damit von jeder erschoepfenden Pruefung ausgenommen. Diese
     * Zeile haelt die Zahl fest, damit dasselbe nicht ein zweites Mal
     * unbemerkt bleibt.
     */
    expect(AKTIONEN).toHaveLength(8);
    expect(new Set(AKTIONEN).size).toBe(8);
  });
});

describe('0290 — keine Automatik für die drei Willenserklärungen', () => {
  it('nennt genau die Aktionen, die `gate()` im Code sperrt', () => {
    expect(listeNach('agent_richtlinie_kein_auto_willenserklaerung'))
      .toEqual([...IM_CODE_GESPERRT]);
  });

  it('und jede davon ist eine bekannte Aktion', () => {
    for (const aktion of IM_CODE_GESPERRT) {
      expect(AKTIONEN, aktion).toContain(aktion);
    }
  });

  it('löst den alten Riegel ab, statt neben ihm zu stehen', () => {
    /*
     * Zwei Riegel mit ueberlappendem Gegenstand sind zwei Stellen, an denen
     * jemand die naechste Aktion nachtraegt — und er traegt sie in eine
     * davon. `0290` wirft `agent_richtlinie_kein_auto_angebot` deshalb weg.
     */
    expect(SQL).toContain('drop constraint agent_richtlinie_kein_auto_angebot');
  });

  it('prüft auch die vorhandenen Zeilen — kein `not valid`', () => {
    /*
     * Ein `not valid` haette die Bedingung nur auf neue Zeilen gelegt. Gaebe
     * es eine alte mit unbekannter Aktion oder mit unerlaubter Automatik,
     * wollte man das beim Anwenden der Migration wissen und nicht beim
     * naechsten Schreiben auf ihr.
     */
    /* Nur ANWEISUNGEN, nicht die Erklärung darüber — der Kommentar in 0290
       nennt „not valid" selbst, um zu sagen, warum es dort nicht steht. */
    const anweisungen = SQL.split('\n')
      .filter((z) => !/^\s*(--|\*|\/\*|\/\*\*)/u.test(z))
      .join('\n');
    expect(anweisungen).not.toMatch(/not\s+valid/iu);
  });
});
