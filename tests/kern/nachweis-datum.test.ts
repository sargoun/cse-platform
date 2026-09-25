/**
 * Monatsnachweis und Unterschriftsblatt zeigen Kalendertage in der
 * Hausschreibweise, nicht als `JJJJ-MM-TT` (V-210, EMP-06, CLN-04).
 *
 * Die Dienste liefern den Tag absichtlich als ISO-Text: er geht so in den
 * Schnappschuss und in den Hash, und der darf sich durch eine Anzeige nicht
 * ändern. Umgeschrieben wird deshalb NUR auf dem Blatt — und genau das prüft
 * dieser Test am Quelltext: kein Blatt reicht einen dieser Werte roh in JSX
 * durch. Die Umformung selbst prüft `kalendertag-stunden.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tagDeutsch, tagInSprache } from '../../src/lib/datum/kalendertag.js';

const WURZEL = join(import.meta.dirname, '..', '..');

const BLAETTER = [
  'src/app/portal/mein/monatsnachweis/page.tsx',
  'src/app/portal/[mandant]/reinigung/leistungsnachweise/[id]/unterschrift/page.tsx',
  'src/app/portal/mein/schichten/[zuordnungId]/leistungsnachweis/page.tsx',
] as const;

/** Ein ISO-Kalendertag, der ohne Umformung in einer JSX-Klammer steht. */
const ROH = /\{\s*(?:z\.kalendertag|vorschau\.kopf\.leistungszeitraum(?:Von|Bis)|n\.von|n\.bis|\w+\.planDatum)\s*\}/u;

function quelle(pfad: string): string {
  return readFileSync(join(WURZEL, pfad), 'utf8');
}

describe('Kalendertage auf Nachweis-Blättern', () => {
  it.each(BLAETTER)('%s reicht keinen ISO-Tag roh durch', (pfad) => {
    expect(quelle(pfad)).not.toMatch(ROH);
  });

  it('keine Schichtseite im Arbeiterportal zeigt den Plantag roh', () => {
    const basis = join(WURZEL, 'src/app/portal/mein/schichten');
    const seiten = readdirSync(basis, { recursive: true, encoding: 'utf8' })
      .filter((d) => d.endsWith('page.tsx'));
    expect(seiten.length).toBeGreaterThan(0);
    for (const seite of seiten) {
      expect(quelle(join('src/app/portal/mein/schichten', seite)), seite).not.toMatch(ROH);
    }
  });

  it('die Umformung ändert nur die Anzeige, nicht den Tag', () => {
    expect(tagDeutsch('2026-09-01')).toBe('01.09.2026');
    expect(tagInSprache('2026-09-30', 'de')).toBe('30.09.2026');
    expect(tagInSprache('2026-09-30', 'tr')).toBe('30.09.2026');
    expect(tagInSprache('2026-09-30', 'en')).toMatch(/^30 Sep\w* 2026$/u);
  });
});
