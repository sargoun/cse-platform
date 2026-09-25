/**
 * Jedes Häkchen im Arbeiterportal ist ein 44-px-Tippziel (DESIGN §8, EMP-12;
 * V-244, D-738; V-254, D-746).
 *
 * **Der Befund.** V-244 hat die drei Häkchen der Abwesenheit auf 44 × 44 px
 * gebracht. Das vierte, das derselbe Zweig ins Arbeiterportal brachte —
 * „nachgetragen" im Wachbuch —, behielt seine native Grösse; nur die
 * Beschriftung darum war 44 px hoch. Die Browsersuite misst jedes `input`
 * einzeln (`mitarbeiter.spec.ts` (6)), aber nur auf den Seiten ihrer Liste,
 * und die Wachbuchseite steht nicht darin: sie hängt an einer
 * Security-Schicht, die die gemessene Person nicht hat.
 *
 * Diese Wache liest deshalb den QUELLBAUM und keine Liste: jedes
 * `<input type="checkbox">` und `type="radio"` unter `src/app/portal/mein`
 * trägt `min-h-11` und `min-w-11`. Ein neues Häkchen auf einer neuen Seite
 * ist damit geprüft, bevor irgendeine Liste die Seite kennt.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WURZEL = resolve(import.meta.dirname, '../..');
const MEIN = join(WURZEL, 'src/app/portal/mein');

function dateien(verzeichnis: string): string[] {
  const alle: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) alle.push(...dateien(voll));
    else if (voll.endsWith('.tsx')) alle.push(voll);
  }
  return alle;
}

interface Haekchen {
  readonly datei: string;
  readonly quelle: string;
}

/** Jedes `<input … />` mit `type="checkbox"` oder `type="radio"` — auch über mehrere Zeilen. */
function haekchen(): readonly Haekchen[] {
  const treffer: Haekchen[] = [];
  for (const datei of dateien(MEIN)) {
    const text = readFileSync(datei, 'utf8');
    for (const m of text.matchAll(/<input\b[\s\S]*?\/>/gu)) {
      if (!/\btype="(?:checkbox|radio)"/u.test(m[0])) continue;
      treffer.push({ datei: relative(WURZEL, datei), quelle: m[0].replace(/\s+/gu, ' ') });
    }
  }
  return treffer;
}

describe('Häkchen im Arbeiterportal (DESIGN §8: Tippziele ≥ 44 × 44 px)', () => {
  const alle = haekchen();

  it('die Wache findet, was es gibt — sonst prüfte sie nichts', () => {
    // Drei in der Abwesenheit, drei im Wachbuch (Stand V-254). Weniger hiesse,
    // dass die Suche ins Leere greift und jede Zeile unten grün ist.
    expect(alle.length).toBeGreaterThanOrEqual(6);
    expect(alle.map((h) => h.datei)).toContain(
      'src/app/portal/mein/schichten/[zuordnungId]/wachbuch/page.tsx');
  });

  it('jedes trägt min-h-11 und min-w-11', () => {
    const zuKlein = alle.filter((h) => {
      const klasse = /className="([^"]*)"/u.exec(h.quelle)?.[1] ?? '';
      const teile = new Set(klasse.split(/\s+/u));
      return !teile.has('min-h-11') || !teile.has('min-w-11');
    });
    expect(zuKlein.map((h) => `${h.datei}: ${h.quelle}`)).toEqual([]);
  });
});
