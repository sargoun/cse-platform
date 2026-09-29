/**
 * Bedienelemente AUF dem weissen Blatt tragen die Druckfarben (DESIGN §11,
 * `DRUCK_STEUERUNG`, V-269, D-765).
 *
 * **Der Befund.** „Drucken oder als PDF sichern" stand auf dem Berichtsblatt
 * und auf dem Monatsnachweis — beide am Bildschirm weiss (`druck-papier`) —
 * mit `text-text` (#FAFAFA) auf durchsichtigem Grund: fast-weiss auf weiss,
 * 1,04:1. Man sah einen leeren, dunkel umrandeten Kasten; lesbar wurde er nur
 * beim Überfahren, auf dem Telefon nie. Auf dem Monatsnachweis galt dasselbe
 * für den Monatswechsel und die Wahl der Beschäftigung.
 *
 * Geprüft wird, was gerendert wird — nicht, was im Quelltext steht.
 */
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DruckKnopf } from '../../src/components/ui/DruckKnopf.js';
import { Monatswechsler } from '../../src/app/portal/mein/bausteine.js';
import { MEIN_TEXTE } from '../../src/lib/i18n/texte.js';
import { DRUCK_STEUERUNG, FARBEN_DRUCK } from '../../src/lib/design/theme.js';

/* Die `.tsx`-Bausteine übersetzt der Testläufer mit der klassischen JSX-Form —
   sie erwarten `React` im Geltungsbereich (wie in `monatsplan.test.ts`). */
(globalThis as { React?: typeof React }).React = React;

const TEXT = FARBEN_DRUCK['druck-text'].toLowerCase();
const LEISE = FARBEN_DRUCK['druck-text-leise'].toLowerCase();

describe('der Druckknopf steht in Druckfarben auf dem Blatt', () => {
  const html = renderToStaticMarkup(createElement(DruckKnopf, { text: 'Drucken', cse: 'x' }))
    .toLowerCase();

  it('Text in druck-text, Rand in druck-text-leise, Fläche druck-papier', () => {
    expect(html).toContain(`color:${TEXT}`);
    expect(html).toContain(`border-color:${LEISE}`);
    expect(html).toContain(`background-color:${FARBEN_DRUCK['druck-papier'].toLowerCase()}`);
  });

  it('keine Bildschirmfarbe mehr — weder Text noch Hover-Fläche', () => {
    expect(html).not.toMatch(/\btext-text\b/u);
    expect(html).not.toContain('hover:bg-surface-2');
  });

  it('bleibt ein 44-px-Ziel und steht nicht auf dem Ausdruck', () => {
    expect(html).toContain('min-h-11');
    expect(html).toContain('cse-nicht-drucken');
  });

  it('die Zuordnung ist die aus DESIGN §11', () => {
    expect(DRUCK_STEUERUNG).toEqual({
      color: FARBEN_DRUCK['druck-text'],
      borderColor: FARBEN_DRUCK['druck-text-leise'],
      backgroundColor: FARBEN_DRUCK['druck-papier'],
    });
  });
});

describe('der Monatswechsel auf dem Monatsnachweis', () => {
  const props = {
    pfad: '/portal/mein/monatsnachweis', monat: '2026-07-01', heute: '2026-09-29',
    texte: MEIN_TEXTE.de,
  };

  it('auf Papier: jeder Verweis in Druckfarben, der Monat daneben leise', () => {
    const html = renderToStaticMarkup(createElement(Monatswechsler, { ...props, aufPapier: true }))
      .toLowerCase();
    const verweise = html.match(/<a [^>]*>/gu) ?? [];
    expect(verweise.length).toBeGreaterThanOrEqual(2);
    for (const a of verweise) {
      expect(a).toContain(`color:${TEXT}`);
      expect(a).not.toMatch(/\btext-text\b/u);
    }
    expect(html).toContain(`color:${LEISE}`);
    expect(html).not.toContain('text-text-muted');
  });

  it('auf dem dunklen Bildschirm bleibt er, wie er war', () => {
    const html = renderToStaticMarkup(createElement(Monatswechsler, props));
    expect(html).toContain('text-text ');
    expect(html).not.toContain(`color:${TEXT}`);
  });
});
