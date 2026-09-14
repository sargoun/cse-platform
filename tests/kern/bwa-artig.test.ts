/**
 * ACC-08, PR 65: die Monatszahlen heissen „BWA-artig" — nie „BWA". Eine
 * Betriebswirtschaftliche Auswertung erstellt der Steuerberater aus gebuchten
 * Konten; was die Plattform zeigt, kommt aus Belegen. Ein Bildschirm, der
 * „BWA" sagt, behauptet mehr, als er hat.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function dateien(verzeichnis: string): string[] {
  const aus: string[] = [];
  for (const name of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, name);
    if (statSync(pfad).isDirectory()) aus.push(...dateien(pfad));
    else if (/\.(?:ts|tsx)$/u.test(name) && !name.endsWith('.generiert.ts')) aus.push(pfad);
  }
  return aus;
}

describe('„BWA-artig", nie „BWA"', () => {
  it('kein Bildschirm und kein Dienst nennt die Zahlen eine BWA', () => {
    const treffer: string[] = [];
    for (const datei of [...dateien('src/app'), ...dateien('src/server/services'), ...dateien('src/components')]) {
      readFileSync(datei, 'utf8').split('\n').forEach((zeile, i) => {
        if (/\bBWA\b(?!-artig)/u.test(zeile)) treffer.push(`${datei}:${String(i + 1)}: ${zeile.trim()}`);
      });
    }
    expect(treffer).toEqual([]);
  });
});
