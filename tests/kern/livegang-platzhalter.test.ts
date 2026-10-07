/**
 * **Der Livegang hält an Platzhaltern an** (V-389, O-12, O-13, D-818).
 *
 * `assertKeinePlatzhalter()` hatte keinen Aufrufer, und ihr Kommentar sagte
 * das Gegenteil. Jetzt ruft `next.config.ts` sie — mit einem eigenen
 * Schalter, weil auch die Vorführung ein Produktionsbuild ist und dort die
 * gekennzeichneten Platzhalter zu Recht stehen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PLATZHALTER, assertKeinePlatzhalter, istLivegang,
} from '../../src/lib/placeholder-assets.js';

describe('V-389 — der Schalter', () => {
  it('nur CSE_LIVEGANG=1 ist der Livegang — nicht NODE_ENV', () => {
    expect(istLivegang({ CSE_LIVEGANG: '1' })).toBe(true);
    expect(istLivegang({})).toBe(false);
    expect(istLivegang({ CSE_LIVEGANG: '' })).toBe(false);
    expect(istLivegang({ CSE_LIVEGANG: 'true' })).toBe(false);
    expect(istLivegang({ NODE_ENV: 'production' })).toBe(false);
  });
});

describe('V-389 — die Sperre', () => {
  it('im Livegang mit Platzhaltern: der Build hält an und nennt sie', () => {
    expect(PLATZHALTER.length).toBeGreaterThan(0);
    expect(() => assertKeinePlatzhalter(true)).toThrow(/Livegang-Build mit \d+ Platzhaltern/u);
    expect(() => assertKeinePlatzhalter(true)).toThrow(/public\/brand\/reinigung\.svg/u);
  });

  it('ohne Livegang oder ohne Platzhalter: nichts', () => {
    expect(() => assertKeinePlatzhalter(false)).not.toThrow();
    expect(() => assertKeinePlatzhalter(true, [])).not.toThrow();
  });

  it('next.config.ts ruft sie mit dem Schalter auf', () => {
    const quelle = readFileSync('next.config.ts', 'utf8');
    expect(quelle).toContain('assertKeinePlatzhalter(istLivegang(process.env))');
  });

  it('.env.example nennt den Schalter, leer', () => {
    expect(readFileSync('.env.example', 'utf8')).toMatch(/^CSE_LIVEGANG=$/mu);
  });
});
