/**
 * Die Rückmeldungen der zwei Formulare auf den Agentenblättern werden
 * angesagt (DESIGN §5 „Notices", §9 „errors announced via aria-live", V-217,
 * V-270, D-763).
 *
 * **Der Befund.** Werkzeugpflege und Assistentenfrage melden ihr Ergebnis nach
 * einer 303-Umleitung — die Kästen trugen aber keine `rolle`. Ein Screenreader
 * erfuhr nicht, ob gespeichert oder abgewiesen wurde, oder ob die Frage eine
 * Antwort bekam. Und der Anker `assistent-antwort` stand an einer `Card`, die
 * weder Rolle noch `data-cse` weiterreicht: im Dokument kam er nie an.
 *
 * Die Seiten sind Serverkomponenten mit Datenbank; geprüft wird deshalb das
 * öffnende Tag jedes Kastens im Quelltext — und dass `Card` wirklich nichts
 * weiterreicht, am gerenderten Baustein.
 */
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Card } from '../../src/components/ui/Card.js';

(globalThis as { React?: typeof React }).React = React;

const AGENT = readFileSync('src/app/portal/[mandant]/agenten/[agent]/page.tsx', 'utf8');
const ASSISTENT = readFileSync('src/app/portal/[mandant]/agenten/assistent/page.tsx', 'utf8');

/** Das öffnende Tag des Hinweiskastens mit diesem Anker. */
function hinweis(quelle: string, cse: string): string {
  const treffer = new RegExp(`<Hinweis\\b[^>]*\\bcse="${cse}"[^>]*>`, 'u').exec(quelle);
  expect(treffer, `kein Hinweis „${cse}"`).not.toBeNull();
  return treffer?.[0] ?? '';
}

describe('die Werkzeugpflege sagt ihren Ausgang an', () => {
  it('gespeichert: status', () => {
    expect(hinweis(AGENT, 'werkzeug-gesetzt')).toContain('rolle="status"');
  });

  it('abgewiesen: alert', () => {
    expect(hinweis(AGENT, 'werkzeug-abgewiesen')).toContain('rolle="alert"');
  });
});

describe('die Assistentenfrage sagt ihren Ausgang an', () => {
  it('abgewiesen und ohne Antwort: alert', () => {
    expect(hinweis(ASSISTENT, 'assistent-abgewiesen')).toContain('rolle="alert"');
    expect(hinweis(ASSISTENT, 'assistent-keine-antwort')).toContain('rolle="alert"');
    expect(hinweis(ASSISTENT, 'assistent-freigabe-nicht-lesbar')).toContain('rolle="alert"');
  });

  it('liegt zur Freigabe: status', () => {
    expect(hinweis(ASSISTENT, 'assistent-wartet-auf-freigabe')).toContain('rolle="status"');
  });

  it('die Antwort steht in einem Bereich mit role="status", der auch den Anker trägt', () => {
    expect(ASSISTENT).toMatch(/<div role="status" data-cse="assistent-antwort"[^>]*>\s*<Card>/u);
    /* Kein Anker mehr an einer Karte — er käme nicht an (siehe unten). */
    expect(ASSISTENT).not.toMatch(/<Card\b[^>]*data-cse=/u);
  });

  it('Card reicht weder Rolle noch data-cse weiter — deshalb der Bereich darum', () => {
    const html = renderToStaticMarkup(createElement(
      Card as unknown as React.FC<Record<string, unknown>>,
      { 'data-cse': 'x', role: 'status', children: 'Antwort' }));
    expect(html).not.toContain('data-cse');
    expect(html).not.toContain('role=');
  });
});
