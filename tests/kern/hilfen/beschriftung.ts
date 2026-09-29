import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { Karte } from '../../../src/lib/i18n/beschriftung/basis.js';

/**
 * Hilfen der Beschriftungsprüfungen (V-231, V-232): die Werte eines Enums aus
 * den Migrationen und die Prüfung einer Karte gegen sie.
 */

/** Die Werte eines Enum-Typs, wie die Migrationen sie anlegen und erweitern. */
export function enumWerte(typ: string): readonly string[] {
  const verzeichnis = fileURLToPath(new URL('../../../drizzle', import.meta.url));
  const werte: string[] = [];
  for (const datei of readdirSync(verzeichnis).filter((d) => d.endsWith('.sql')).sort()) {
    const text = readFileSync(join(verzeichnis, datei), 'utf8');
    const anlage = new RegExp(`create type ${typ}\\s+as enum\\s*\\(([^)]*)\\)`, 'u').exec(text);
    if (anlage !== null) {
      for (const m of (anlage[1] ?? '').matchAll(/'([^']+)'/gu)) werte.push(m[1] ?? '');
    }
    for (const m of text.matchAll(
      new RegExp(`alter type ${typ} add value (?:if not exists )?'([^']+)'`, 'gu'))) {
      werte.push(m[1] ?? '');
    }
  }
  return werte;
}

/** Jede Sprache kennt genau diese Schlüssel, und kein Wort ist ein Schlüssel. */
export function pruefeKarte(karte: Karte, schluessel: readonly string[], name: string): void {
  expect(schluessel.length, `${name}: keine Werte gefunden`).toBeGreaterThan(0);
  for (const s of ['de', 'en'] as const) {
    expect(Object.keys(karte[s]).sort(), `${name}/${s}`).toEqual([...schluessel].sort());
    for (const [k, wort] of Object.entries(karte[s])) {
      expect(wort, `${name}/${s}/${k}`).not.toMatch(/_/u);
      expect(wort.trim(), `${name}/${s}/${k}`).not.toBe('');
    }
  }
}

