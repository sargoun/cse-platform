import { describe, expect, it } from 'vitest';
import { neuerToken, tokenHash } from '../../src/server/kalender/feed.js';

/**
 * Der Token des iCal-Zugangs (CAL-03) — die Eigenschaften, die ihn tragen.
 */
describe('Der Feed-Token', () => {
  it('ist lang genug, dass Raten keine Rechnung wert ist', () => {
    // 32 Byte in base64url sind 43 Zeichen.
    expect(neuerToken()).toHaveLength(43);
  });

  it('übersteht eine Adresse unverändert — kein +, kein /, kein =', () => {
    for (let i = 0; i < 200; i += 1) {
      const t = neuerToken();
      expect(t, t).toMatch(/^[A-Za-z0-9_-]+$/u);
      expect(encodeURIComponent(t), t).toBe(t);
    }
  });

  it('zweimal ist zweimal verschieden', () => {
    const viele = new Set(Array.from({ length: 500 }, () => neuerToken()));
    expect(viele.size).toBe(500);
  });

  it('der Hash ist SHA-256 in hex — und der CHECK der Tabelle erkennt ihn', () => {
    const h = tokenHash('beliebig');
    expect(h).toMatch(/^[0-9a-f]{64}$/u);
    expect(tokenHash('beliebig')).toBe(h);
    expect(tokenHash('beliebiG')).not.toBe(h);
  });
});
