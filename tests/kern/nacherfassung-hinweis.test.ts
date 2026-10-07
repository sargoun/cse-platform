/**
 * Was die neue Fassung nach einer späten Nacherfassung sagt (V-321, O-165,
 * D-810).
 *
 * **Der Befund.** Die Seite sagte „die Leitung der Gesellschaft hat einen
 * Hinweis bekommen", sobald die Nacherfassung spät war — auch wenn der
 * Definer (0506) niemanden erreicht hatte: keine andere Leitung, die Zeiten
 * lesen darf, oder die erfassende Person war selbst die einzige Leitung.
 * Verspätung und Zustellung sind zwei Zahlen; die Adresse trägt beide, und
 * die Seite bestätigt den Hinweis nur mit `leitung=1`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { korrekturRueckweg } from '../../src/server/services/zeit/korrektur.js';
import { ohneKommentareMitTexten } from './hilfen/quelltext.js';

const ergebnis = (spaetTage: number | null, spaetGemeldet: number) => ({
  korrekturId: 'k-1', neueFassungId: 'z-2', version: 2, spaetTage, spaetGemeldet,
});

describe('V-321 — der Rückweg nach der Korrektur', () => {
  it('pünktlich: nur die neue Fassung', () => {
    expect(korrekturRueckweg('reinigung', ergebnis(null, 0)))
      .toBe('/portal/reinigung/zeiten/z-2?korrigiert=1');
  });

  it('spät und gemeldet: Abstand und leitung=1', () => {
    expect(korrekturRueckweg('reinigung', ergebnis(10, 2)))
      .toBe('/portal/reinigung/zeiten/z-2?korrigiert=1&spaet=10&leitung=1');
  });

  it('spät, aber niemand erreicht: leitung=0', () => {
    expect(korrekturRueckweg('reinigung', ergebnis(12, 0)))
      .toBe('/portal/reinigung/zeiten/z-2?korrigiert=1&spaet=12&leitung=0');
  });

  it('die Route nimmt genau diesen Rückweg', () => {
    const route = ohneKommentareMitTexten(
      readFileSync('src/app/api/zeit/korrektur/route.ts', 'utf8'));
    expect(route).toMatch(/korrekturRueckweg\(mandant, ergebnis\)/u);
  });

  it('die Seite bestätigt den Hinweis nur, wenn die Leitung erreicht ist', () => {
    const seite = ohneKommentareMitTexten(
      readFileSync('src/app/portal/[mandant]/zeiten/[id]/page.tsx', 'utf8'));
    expect(seite).toMatch(/leitungErreicht = frage\['leitung'\] === '1'/u);
    expect(seite).toMatch(
      /leitungErreicht\s*\?\s*' die Leitung der Gesellschaft hat einen Hinweis bekommen\.'/u);
    expect(seite).toContain('einen Hinweis hat niemand bekommen');
  });
});
