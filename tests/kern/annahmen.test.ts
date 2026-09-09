/**
 * Das Annahmen-Register ist nur dann etwas wert, wenn es VOLLSTÄNDIG ist.
 *
 * Es existiert, damit der Mandant das Projekt ansehen kann, bevor er die
 * offenen Fragen beantwortet — jede Stelle hat einen vorläufigen Wert, und
 * jeder Wert steht mit seiner Frage im Register. Ein Wert, der irgendwo im
 * Code steht und hier fehlt, ist genau das, was das Register verhindern soll:
 * eine geratene Zahl, die als Entscheidung durchgeht.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANNAHMEN, OFFEN_GEBLIEBEN, annahmeZu } from '../../src/lib/annahmen.js';
import { erzeuge, ZIEL } from '../../scripts/annahmen.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const DECISIONS = readFileSync(join(WURZEL, 'docs/DECISIONS.md'), 'utf8');

/** Die O-Nummern, die `docs/DECISIONS.md` als Tabellenzeile führt. */
const REGISTRIERT = new Set(
  [...DECISIONS.matchAll(/^\|\s*(O-\d{1,3})\s*\|/gmu)].map((m) => m[1]!),
);

describe('jede Annahme zeigt auf eine echte offene Frage', () => {
  it.each(ANNAHMEN.map((a) => [a.frage] as const))(
    '%s steht in DECISIONS.md', (frage) => {
      // Eine Annahme zu einer Frage, die es nicht gibt, ist eine erfundene
      // Frage — und niemand beantwortet sie, weil sie auf keiner Liste steht.
      expect(REGISTRIERT.has(frage), `${frage} fehlt in docs/DECISIONS.md`).toBe(true);
    },
  );

  it.each(OFFEN_GEBLIEBEN.map((o) => [o.frage] as const))(
    '%s (bewusst offen) steht ebenfalls in DECISIONS.md', (frage) => {
      expect(REGISTRIERT.has(frage), `${frage} fehlt in docs/DECISIONS.md`).toBe(true);
    },
  );

  it('keine Frage steht zweimal drin', () => {
    const alle = [...ANNAHMEN.map((a) => a.frage), ...OFFEN_GEBLIEBEN.map((o) => o.frage)];
    expect(new Set(alle).size).toBe(alle.length);
  });

  it('eine Frage ist ENTWEDER vorbelegt ODER bewusst offen, nie beides', () => {
    // Beides hiesse: der Code benutzt einen Wert, und das Dokument sagt, es
    // gebe keinen. Der Mandant liest dann eine Sperre, die nicht besteht.
    const offen = new Set(OFFEN_GEBLIEBEN.map((o) => o.frage));
    for (const a of ANNAHMEN) expect(offen.has(a.frage), a.frage).toBe(false);
  });
});

describe('jeder Eintrag ist beantwortbar formuliert', () => {
  it.each(ANNAHMEN.map((a) => [a.frage, a] as const))('%s', (_frage, a) => {
    // Eine Annahme ohne Frage daneben ist eine Entscheidung, die niemand
    // getroffen hat, und sie bleibt für immer stehen.
    expect(a.annahme.length).toBeGreaterThan(40);
    expect(a.zuKlaeren.length).toBeGreaterThan(40);
    /**
     * Eine FRAGE oder eine BITTE — beides kann der Mandant beantworten.
     *
     * Nicht jeder offene Punkt ist eine Frage: „Bitte das Original-Logo als
     * SVG" ist eine Lieferung, keine Entscheidung, und sie in ein Fragezeichen
     * zu zwingen hätte den Satz verschlechtert. Was hier durchfällt, ist die
     * blosse Feststellung — die kann niemand erledigen.
     */
    expect(/\?/u.test(a.zuKlaeren) || /\bBitte\b/u.test(a.zuKlaeren), a.zuKlaeren)
      .toBe(true);
    expect(a.wirktIn.length).toBeGreaterThan(0);
  });

  it.each(OFFEN_GEBLIEBEN.map((o) => [o.frage, o] as const))(
    '%s nennt einen Grund, der die Sperre trägt', (_frage, o) => {
      expect(o.grund.length).toBeGreaterThan(60);
    },
  );
});

describe('die drei unumkehrbaren Punkte sind NICHT vorbelegt', () => {
  /**
   * Diese drei erzeugen etwas, das man nicht zurücknimmt: eine
   * festgeschriebene Rechnung ist unveränderlich (Invariante 4), eine
   * Konformitätsaussage ist eine rechtliche Zusage, und eine falsche
   * Rechtsform entscheidet, ob überhaupt fakturiert werden darf.
   */
  it.each([['O-134'], ['O-205'], ['O-01']])('%s bleibt offen', (frage) => {
    expect(annahmeZu(frage!), `${frage!} darf keinen vorläufigen Wert haben`)
      .toBeUndefined();
    expect(OFFEN_GEBLIEBEN.some((o) => o.frage === frage)).toBe(true);
  });
});

describe('docs/ANNAHMEN.md ist aus dem Register erzeugt und aktuell', () => {
  it('das Dokument stimmt mit dem Register überein', () => {
    // Zwei von Hand gepflegte Fassungen laufen auseinander, und die
    // gefährlichere Richtung ist die stille: im Dokument stehen 24 Stunden,
    // im Code 48 — und im Gespräch bestätigt jemand eine Zahl, die nirgends gilt.
    expect(readFileSync(ZIEL, 'utf8')).toBe(erzeuge());
  });

  it('es nennt jede Frage, die im Register steht', () => {
    const text = readFileSync(ZIEL, 'utf8');
    for (const a of ANNAHMEN) expect(text).toContain(a.frage);
    for (const o of OFFEN_GEBLIEBEN) expect(text).toContain(o.frage);
  });
});
