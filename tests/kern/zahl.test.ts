import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groesseText, zahlText } from '../../src/lib/zahl.js';
import { groesseText as groesseMitarbeiter } from '../../src/server/services/mitarbeiter/dokumente.js';

/**
 * Zahlen und Grössen aus EINER Funktion (Audit Befund 69, V-233, D-727).
 *
 * „2.5 MB" mit Punkt, „1234,56 €" ohne Tausenderpunkt auf dem Blatt, das der
 * Kunde unterschreibt — beides entstand in Seiten, die ihre Zahl von Hand
 * bauten. Geld geht durch `formatiereGeld` (geprüft in `geld.test.ts`),
 * Grössen und Zahlen durch `src/lib/zahl.ts`.
 */

describe('groesseText — deutsch mit Komma, englisch mit Punkt', () => {
  it('Byte, KB und MB, eine Nachkommastelle unter zehn', () => {
    expect(groesseText('512')).toBe('512 B');
    expect(groesseText('1536')).toBe('1,5 KB');
    expect(groesseText('10240')).toBe('10 KB');
    expect(groesseText(2_621_440)).toBe('2,5 MB');
    expect(groesseText('268435456')).toBe('256 MB');
  });

  it('der Befund: 2,5 MB statt 2.5 MB — und auf Englisch 2.5 MB', () => {
    expect(groesseText('2621440')).not.toContain('2.5');
    expect(groesseText('2621440', 'en')).toBe('2.5 MB');
  });

  it('eine fehlende oder unlesbare Grösse ist ein Strich, keine Null', () => {
    for (const roh of [null, undefined, '', '   ', 'viel', '-5', '0', 1.5, Number.NaN]) {
      expect(groesseText(roh as never), String(roh)).toBe('—');
    }
  });

  it('das Arbeiterportal rechnet mit derselben Funktion, in der gesetzlichen Form', () => {
    expect(groesseMitarbeiter('1048576')).toBe(groesseText('1048576'));
    expect(groesseMitarbeiter('1048576')).toBe('1,0 MB');
  });
});

describe('zahlText — mit Tausendertrennung', () => {
  it('deutsch und englisch', () => {
    expect(zahlText(1234)).toBe('1.234');
    expect(zahlText(1234, 'en')).toBe('1,234');
    expect(zahlText(2.25, 'de', 1)).toBe('2,3');
  });
});

describe('keine Seite baut Grösse oder Geld mehr von Hand', () => {
  function dateien(wurzel: string): string[] {
    return readdirSync(wurzel).flatMap((n) => {
      const p = join(wurzel, n);
      return statSync(p).isDirectory() ? dateien(p) : /\.tsx?$/u.test(n) ? [p] : [];
    });
  }
  const quellen = [...dateien('src/app'), ...dateien('src/components')]
    .map((p) => ({ p, text: readFileSync(p, 'utf8') }));

  it('kein toFixed vor einer Grösseneinheit', () => {
    const treffer = quellen.filter((q) => /toFixed\(\d\)[^\n]*\b(KB|MB|kB|GB)\b/u.test(q.text))
      .map((q) => q.p);
    expect(treffer).toEqual([]);
  });

  it('das Unterschriftsblatt und die Sonderleistungen nehmen formatiereGeld', () => {
    for (const p of [
      'src/app/portal/[mandant]/reinigung/leistungsnachweise/[id]/unterschrift/page.tsx',
      'src/app/portal/[mandant]/reinigung/sonderleistungen/page.tsx',
    ]) {
      const text = readFileSync(p, 'utf8');
      expect(text, p).toContain('formatiereGeld(');
      expect(text, p).not.toMatch(/\$\{ganz\},\$\{rest\} €/u);
    }
  });
});
