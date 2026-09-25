/**
 * Das Feld „Leistungszeile" wählt den bisherigen Anker — immer (V-192).
 *
 * **Der Befund.** `listeAnkerbareLeistungen` kappte nach dem `or al.id = …`
 * mit `limit`; bei mehr als 300 lebenden Zeilen fiel der bisherige Anker aus
 * der Liste, das Feld wählte „ohne", und das nächste Speichern der
 * Turnuspflege (auch nur einer Uhrzeit) löste ihn. Der Dienst liefert ihn
 * jetzt ungekappt mit (`tests/isolation/leistungsanker.test.ts` §5); dieses
 * Feld hält ihn auch dann, wenn er trotzdem fehlt.
 */
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LeistungsankerFeld } from '../../src/components/portal/LeistungsankerFeld.js';
import { LEISTUNGSANKER_TEXTE } from '../../src/lib/i18n/verwaltung/leistungsanker.js';
import type { AnkerbareLeistung } from '../../src/server/services/dienstplan/leistungsanker.js';

/* Klassische JSX-Umwandlung dieses Testläufers — `React` im Geltungsbereich (wie V-153). */
(globalThis as { React?: typeof React }).React = React;

const LEBEND: AnkerbareLeistung = {
  id: '6c1e5b0d-0a41-4c55-9d1c-1c2f3b4a5d6f', auftragId: '7d2f6c1e-0a41-4c55-9d1c-1c2f3b4a5d70',
  auftragsnummer: 'AU-2026-0042', positionNr: 1, bezeichnung: 'Unterhaltsreinigung',
  kunde: 'Hausverwaltung Mitte', objekt: 'Bürohaus Nord', lebt: true,
};
const BISHER = '8e3a7d2f-0a41-4c55-9d1c-1c2f3b4a5d71';

function feld(leistungen: readonly AnkerbareLeistung[] | null, gewaehlt: string | null): string {
  return renderToStaticMarkup(createElement(LeistungsankerFeld, {
    leistungen, gewaehlt, sprache: 'de', feldKlasse: 'feld',
  }));
}

/** Der Wert der gewählten Option — `null`, wenn keine gewählt ist. */
function gewaehlterWert(html: string): string | null {
  return /<option value="([^"]*)"[^>]*selected=""/u.exec(html)?.[1] ?? null;
}

describe('LeistungsankerFeld — der bisherige Anker ist gewählt', () => {
  it('steht er in der Liste, ist GENAU er gewählt', () => {
    expect(gewaehlterWert(feld([LEBEND], LEBEND.id))).toBe(LEBEND.id);
  });

  it('fehlt er in der Liste, steht er als eigene Zeile da und bleibt gewählt — nicht „ohne"', () => {
    const html = feld([LEBEND], BISHER);
    expect(gewaehlterWert(html)).toBe(BISHER);
    expect(html).toContain('data-cse="leistungsanker-bisher"');
    expect(html).toContain(LEISTUNGSANKER_TEXTE.de.bisherNichtGelistet);
    // Die Kennung ist ein Wert, keine Beschriftung.
    expect(html).not.toContain(`>${BISHER}<`);
  });

  it('ohne Anker ist „ohne" gewählt, und es gibt keine Zusatzzeile', () => {
    const html = feld([LEBEND], null);
    expect(gewaehlterWert(html) ?? '').toBe('');
    expect(html).not.toContain('leistungsanker-bisher');
  });

  it('ohne `auftrag.lesen` bleibt es beim Satz statt eines Feldes', () => {
    const html = feld(null, BISHER);
    expect(html).not.toContain('<select');
    expect(html).toContain('data-cse="leistungsanker-kein-recht"');
  });
});

describe('LeistungsankerFeld — jede Zeile nennt Kunde und Objekt (V-192)', () => {
  it('Auftragsnummer, Position, Bezeichnung, Kunde und Objekt stehen in der Zeile', () => {
    const html = feld([LEBEND], null);
    expect(html).toContain('AU-2026-0042 · Pos. 1 · Unterhaltsreinigung · Hausverwaltung Mitte · Bürohaus Nord');
  });

  it('ohne Leserecht auf Kunde oder Objekt fehlt nur die Angabe, nicht die Zeile', () => {
    const html = feld([{ ...LEBEND, kunde: null, objekt: null }], null);
    expect(html).toContain('AU-2026-0042 · Pos. 1 · Unterhaltsreinigung<');
  });

  it('eine nicht wählbare bisherige Zeile sagt es', () => {
    const html = feld([{ ...LEBEND, lebt: false }], LEBEND.id);
    expect(html).toContain(`(${LEISTUNGSANKER_TEXTE.de.nichtWaehlbar})`);
    expect(gewaehlterWert(html)).toBe(LEBEND.id);
  });
});
