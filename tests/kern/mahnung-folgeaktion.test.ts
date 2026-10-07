/**
 * Die Folgeaktion einer Mahnstufe als reine Rechnung (V-313, O-181, D-840).
 *
 * Gegen Postgres (Vermerk, Rechte, Protokoll, der Übergang zu `erledigt`):
 * `tests/isolation/mahnung.test.ts` (10).
 */
import { describe, expect, it } from 'vitest';
import {
  folgeaktionStand, type Uebergabevermerk,
} from '../../src/server/services/finanz/mahnung/folgeaktion.js';
import { MAHNUNGEN_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/mahnungen.js';

const versendet = { status: 'versendet', folgeaktion: 'inkasso' as const, zahlbarBis: '2026-10-14' };
const vermerk: Uebergabevermerk = {
  aktion: 'inkasso', begruendung: 'Übergeben an Inkassobüro Muster',
  vermerktVon: 'Bea Buchhaltung', vermerktAm: '2026-10-20T08:00:00Z',
};

describe('folgeaktionStand', () => {
  it('der letzte Tag der Frist gehört dem Schuldner — fällig am Tag danach', () => {
    expect(folgeaktionStand(versendet, [], '2026-10-14'))
      .toEqual({ art: 'wartet', aktion: 'inkasso', abTag: '2026-10-15' });
    expect(folgeaktionStand(versendet, [], '2026-10-15'))
      .toEqual({ art: 'faellig', aktion: 'inkasso', seitTag: '2026-10-15' });
    expect(folgeaktionStand(versendet, [], '2026-11-30'))
      .toEqual({ art: 'faellig', aktion: 'inkasso', seitTag: '2026-10-15' });
  });

  it('über den Monats- und Jahreswechsel', () => {
    expect(folgeaktionStand({ ...versendet, zahlbarBis: '2026-12-31' }, [], '2027-01-01'))
      .toEqual({ art: 'faellig', aktion: 'inkasso', seitTag: '2027-01-01' });
  });

  it('ein Vermerk derselben Aktion beendet die Fälligkeit — einer einer anderen nicht', () => {
    expect(folgeaktionStand(versendet, [vermerk], '2026-10-20'))
      .toEqual({ art: 'vermerkt', aktion: 'inkasso', vermerk });
    expect(folgeaktionStand(versendet, [{ ...vermerk, aktion: 'lieferstopp' }], '2026-10-20'))
      .toMatchObject({ art: 'faellig' });
  });

  it('ohne Folgeaktion an der Stufe: nichts', () => {
    expect(folgeaktionStand({ ...versendet, folgeaktion: 'keine' }, [], '2026-11-30'))
      .toEqual({ art: 'keine' });
  });

  it('nur eine versendete Mahnung macht eine Folgeaktion fällig', () => {
    for (const status of ['entwurf', 'freigegeben', 'verworfen']) {
      expect(folgeaktionStand({ ...versendet, status }, [], '2026-11-30'), status)
        .toEqual({ art: 'keine' });
    }
  });

  it('eine erledigte Sache braucht keine Folgeaktion — ein Vermerk davor bleibt sichtbar', () => {
    expect(folgeaktionStand({ ...versendet, status: 'erledigt' }, [], '2026-11-30'))
      .toEqual({ art: 'erledigt' });
    expect(folgeaktionStand({ ...versendet, status: 'erledigt' }, [vermerk], '2026-11-30'))
      .toMatchObject({ art: 'vermerkt' });
  });
});

describe('die Wörter der Folgeaktion', () => {
  it('jede Aktion hat einen Namen in beiden Sprachen', () => {
    for (const sprache of ['de', 'en'] as const) {
      for (const aktion of ['lieferstopp', 'inkasso', 'mahnbescheid'] as const) {
        expect(MAHNUNGEN_TEXTE[sprache].folgeaktionNamen[aktion], `${sprache} ${aktion}`).toBeTruthy();
      }
    }
  });

  it('die Sätze nennen Aktion und Tag', () => {
    expect(MAHNUNGEN_TEXTE.de.folgeaktionFaellig('Übergabe an ein Inkassobüro', '15.10.2026'))
      .toBe('Fällig seit dem 15.10.2026: Übergabe an ein Inkassobüro. Die Zahlungsfrist dieser '
        + 'Mahnung ist verstrichen.');
    expect(MAHNUNGEN_TEXTE.en.folgeaktionWartet('Inkasso', '15 Oct 2026')).toContain('15 Oct 2026');
    expect(MAHNUNGEN_TEXTE.de.folgeaktionVoreinstellung).toContain('O-181');
  });
});
