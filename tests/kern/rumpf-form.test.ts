/**
 * **Gueltiges JSON ist noch kein Rumpf.**
 *
 * `liesRumpf` nahm alles an, was `JSON.parse` durchliess: `[1, 2]`, `"text"`,
 * `42`, `null`. Aus einer Zeichenkette machte `Object.entries` Felder mit den
 * Namen `0`, `1`, `2`; aus einer Liste Felder mit Indexnamen. Die Route
 * antwortete daraufhin `unvollstaendig` (409) — der Aufrufer suchte also ein
 * FEHLENDES FELD, waehrend seine FORM falsch war. `unlesbarer_rumpf` (400)
 * benennt genau diesen Unterschied, und das Geruest antwortet ihn schon,
 * wenn `liesRumpf` wirft.
 *
 * Gemeldet von der Copilot-Runde auf PR 16 (D-583).
 */
import { describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { liesRumpf } from '../../src/app/api/rumpf.js';

/** Eine Anfrage mit JSON-Rumpf, so viel wie `liesRumpf` davon anfasst. */
function jsonAnfrage(rumpf: string): NextRequest {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(JSON.parse(rumpf) as unknown),
  } as unknown as NextRequest;
}

describe('liesRumpf nimmt nur ein Objekt an (400 statt 409)', () => {
  for (const [name, rumpf] of [
    ['eine Liste', '[1, 2, 3]'],
    ['eine Zeichenkette', '"titel=Probe"'],
    ['eine Zahl', '42'],
    ['null', 'null'],
    ['wahr', 'true'],
  ] as const) {
    it(`weist ${name} ab`, async () => {
      await expect(liesRumpf(jsonAnfrage(rumpf))).rejects.toThrow(SyntaxError);
    });
  }

  it('ein Objekt geht durch, und nur seine Zeichenkettenfelder zaehlen', async () => {
    const rumpf = await liesRumpf(jsonAnfrage(
      '{"titel":"Probe","zahl":7,"liste":["a","b"],"leer":null}'));
    expect(rumpf.felder).toEqual({ titel: 'Probe' });
    expect(rumpf.alle('liste')).toEqual(['a', 'b']);
    expect(rumpf.json).toBe(true);
  });

  it('kaputte Syntax wirft weiterhin — dieselbe Antwort, derselbe Weg', async () => {
    await expect(liesRumpf(jsonAnfrage('{kaputt'))).rejects.toThrow();
  });
});
