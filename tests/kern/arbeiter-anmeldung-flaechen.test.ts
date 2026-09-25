/**
 * Die Anmeldung der Beschäftigten ist eine Fläche der Beschäftigten — auch in
 * ihren Feldern, Kästen und Rückwegen (V-200, D-694 Nr. 8, DESIGN §5, §8).
 *
 * **Der Befund.** D-694 Nr. 8 sagte „Fliesstext in 16 px auf allen diesen
 * Flächen". Kästen, Absätze, Fuss und Schrittzähler waren umgestellt, die
 * Felder nicht: Beschriftung, Hinweis und Fehler von `FormField` standen fest
 * in `xs` (13 px) — „Mobilnummer", „Deutsche Nummern mit 0 beginnend …",
 * „Fordern Sie einen neuen Code an." in vier Sprachen, auf Arabisch am
 * schwersten lesbar.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormField } from '../../src/components/ui/FormField.js';

void React;
const WURZEL = resolve(import.meta.dirname, '../..');
const quelle = (pfad: string): string => readFileSync(join(WURZEL, pfad), 'utf8');

/** Die Klassen des Elements, dessen Text genau `text` ist. */
function klassenVon(html: string, text: string): string {
  const treffer = new RegExp(`class="([^"]*)"[^>]*>${text}<`, 'u').exec(html);
  return treffer?.[1] ?? '';
}

describe('FormField groesse (DESIGN §5 „Forms")', () => {
  const felder = { label: 'Mobilnummer', hinweis: 'Mit 0 beginnend', fehler: 'Neuer Code' };

  it('ohne Angabe: Beschriftung, Hinweis und Fehler in xs — wie bisher', () => {
    const html = renderToStaticMarkup(createElement(FormField, felder));
    for (const t of Object.values(felder)) {
      expect(klassenVon(html, t), t).toContain('text-xs');
      expect(klassenVon(html, t), t).not.toContain('text-base');
    }
  });

  it('`groesse="base"`: alle drei in 16 px, keiner mehr in xs', () => {
    const html = renderToStaticMarkup(createElement(FormField, { ...felder, groesse: 'base' }));
    for (const t of Object.values(felder)) {
      expect(klassenVon(html, t), t).toContain('text-base');
      expect(klassenVon(html, t), t).not.toContain('text-xs');
    }
    /* Das Eingabefeld ist in beiden Grössen `base`, und die Fehlerzeile bleibt angesagt. */
    expect(html).toMatch(/<input[^>]*class="[^"]*text-base/u);
    expect(html).toMatch(/role="alert" aria-live="polite"/u);
  });
});

describe('die beiden Anmeldeseiten der Beschäftigten', () => {
  const SEITEN = ['src/app/auth/mitarbeiter/page.tsx', 'src/app/auth/mitarbeiter/code/page.tsx'];

  it.each(SEITEN)('%s: jedes Feld in 16 px', (seite) => {
    const s = quelle(seite);
    const felder = [...s.matchAll(/<FormField\b[^>]*?(?:\/>|>)/gsu)].map((m) => m[0]);
    expect(felder.length, seite).toBeGreaterThan(0);
    for (const f of felder) expect(f, seite).toContain('groesse="base"');
  });
});

describe('die Kästen der Anmeldung sind das Bauteil (DESIGN §5 „Notices", V-217)', () => {
  const KAESTEN = [
    { seite: 'src/app/auth/mitarbeiter/page.tsx', cse: 'anmeldung-abgelaufen', art: 'warnung', alert: true },
    { seite: 'src/app/auth/mitarbeiter/page.tsx', cse: 'keks-ohne-secure', art: 'hinweis', alert: false },
    { seite: 'src/app/auth/mitarbeiter/page.tsx', cse: 'sms-nicht-verbunden', art: 'warnung', alert: false },
    { seite: 'src/app/auth/mitarbeiter/code/page.tsx', cse: 'dev-code', art: 'warnung', alert: false },
    { seite: 'src/app/auth/mitarbeiter/code/page.tsx', cse: 'code-fehler', art: 'warnung', alert: true },
  ] as const;

  it.each(KAESTEN)('$cse: Hinweis $art in 16 px', ({ seite, cse, art, alert }) => {
    const s = quelle(seite);
    const kasten = new RegExp(`<Hinweis[^>]*cse="${cse}"[^>]*>`, 'u').exec(s)?.[0] ?? '';
    expect(kasten, cse).not.toBe('');
    expect(kasten).toContain(`art="${art}"`);
    expect(kasten).toContain('groesse="base"');
    /* Der Ausgang eines abgeschickten Formulars wird angesagt (§9). */
    if (alert) expect(kasten).toContain('rolle="alert"');
  });

  it.each(['src/app/auth/mitarbeiter/page.tsx', 'src/app/auth/mitarbeiter/code/page.tsx'])(
    '%s baut keinen Kasten mehr aus Klassen nach', (seite) => {
      const s = quelle(seite);
      expect(s).not.toMatch(/border-warning bg-warning-soft/u);
      expect(s).not.toMatch(/rounded-md border border-line bg-surface p-s4/u);
      expect(s).not.toMatch(/data-cse="(?:anmeldung-abgelaufen|keks-ohne-secure|sms-nicht-verbunden|dev-code)"/u);
    });
});
