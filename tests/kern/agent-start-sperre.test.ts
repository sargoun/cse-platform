/**
 * Das Vorschaltblatt eines Laufs zeigt den Startknopf nur, wo ein Lauf
 * entstünde (`agenten/[agent]/start`, V-230, V-271, D-764).
 *
 * **Der Befund.** Ohne offene Anfrage schrieb das Blatt des Akquise-Agenten
 * „Ein Lauf entstünde deshalb nicht — er schriebe an niemanden", und darunter
 * stand der Knopf „Lauf starten und vorlegen" trotzdem; der Klick führte nur
 * zurück auf „Kein Lauf". Ohne Modell und beim Budgetstopp blendete dasselbe
 * Blatt ihn aus — „ein Knopf, der verspricht, was nicht geht, wäre schlimmer
 * als keiner".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startSperre } from '../../src/app/portal/[mandant]/agenten/darstellung.js';

const BEREIT = {
  istAktiv: true, hatAuftrag: true, modell: 'demo:hausintern-v1', gestoppt: false,
  tatsachen: { anfrage_datum: '28.09.2026' },
} as const;

describe('startSperre — ein Knopf nur, wo ein Lauf entstünde', () => {
  it('alles da: der Knopf steht', () => {
    expect(startSperre(BEREIT)).toBeNull();
    /* Ein Agent, für den die Plattform keine Werte liest, läuft trotzdem. */
    expect(startSperre({ ...BEREIT, tatsachen: {} })).toBeNull();
  });

  it('ohne offene Anfrage: kein Knopf', () => {
    expect(startSperre({ ...BEREIT, tatsachen: null })).toBe('keine_anfrage');
  });

  it('die anderen Gründe wie bisher — und in der Reihenfolge der Hinweise', () => {
    expect(startSperre({ ...BEREIT, istAktiv: false, tatsachen: null })).toBe('agent_aus');
    expect(startSperre({ ...BEREIT, hatAuftrag: false })).toBe('ohne_auftrag');
    expect(startSperre({ ...BEREIT, modell: null, tatsachen: null })).toBe('kein_modell');
    expect(startSperre({ ...BEREIT, gestoppt: true, tatsachen: null })).toBe('budget_stopp');
  });
});

describe('das Blatt fragt die Regel, bevor es das Formular zeichnet', () => {
  const seite = readFileSync('src/app/portal/[mandant]/agenten/[agent]/start/page.tsx', 'utf8');

  it('das Formular steht nur im Zweig ohne Sperre', () => {
    expect(seite).toMatch(/startSperre\(\{[\s\S]*tatsachen,?\s*\}\)/u);
    expect(seite).toMatch(/sperre !== null \? null : \([\s\S]*?data-cse="start-formular"/u);
    /* Keine zweite, eigene Kette mehr, die `tatsachen` übersehen kann. */
    expect(seite).not.toMatch(/auftrag === undefined \? null : modell === null/u);
  });
});
