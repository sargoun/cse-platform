import { describe, expect, it } from 'vitest';
import {
  alsKanonischerWert, diffAusJson, diffZuJson, fuerJsonb,
} from '../../src/server/services/freigabe/diff-json.js';
import {
  diffVergleich, DiffFehler, type Vergleichsmodell, type VergleichsPosition,
} from '../../src/server/services/freigabe/diff.js';
import { kanonischerText } from '../../src/server/services/finanz/kanonisch.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';

/**
 * Der Diff ueberlebt den Weg durch `jsonb` — Byte fuer Byte (D-472).
 *
 * Die Kette hasht ueber die kanonischen Bytes des GESPEICHERTEN Diffs.
 * Sollte die Abbildung hin und zurueck auch nur eine Zahl anders schreiben,
 * rechnet der Waechter andere Bytes nach als die Entscheidung geschrieben hat.
 */
function position(teil: Partial<VergleichsPosition> = {}): VergleichsPosition {
  return {
    objektId: 'obj-1', leistungskatalogId: 'kat-1', bezeichnung: 'Unterhaltsreinigung',
    menge: milliMenge(160_000n), einheit: 'h', einzelpreisCent: cent(2_850n),
    betragCent: cent(456_000n), herkunft: [{ art: 'vertrag', id: 'v-1' }],
    meta: { zuschlag: 'nacht' }, ...teil,
  };
}

function modell(positionen: readonly VergleichsPosition[]): Vergleichsmodell {
  const netto = positionen.reduce((s, p) => s + p.betragCent, 0n);
  return {
    vorgangTyp: 'monatsrechnung_entwurf', periode: 'August 2026', positionen,
    ustGruppen: [{ steuersatzGruppeId: 'ust-19', nettoCent: cent(netto),
      ustCent: cent((netto * 19n) / 100n) }],
    summeNettoCent: cent(netto), summeBruttoCent: cent(netto + (netto * 19n) / 100n),
    leistungszeitraum: { von: '2026-08-01', bis: '2026-08-31' },
  };
}

describe('der Diff geht als JSON hin und kommt gleich zurueck', () => {
  const vorher = modell([position()]);
  const nachher = modell([
    position({ menge: milliMenge(172_000n), betragCent: cent(490_200n) }),
    position({ objektId: 'obj-2', bezeichnung: 'Glasreinigung', menge: milliMenge(4_000n),
      einzelpreisCent: cent(4_500n), betragCent: cent(18_000n), meta: {} }),
  ]);
  const diff = diffVergleich(vorher, nachher);

  it('Rundreise ueber jsonb-Text: derselbe Diff, dieselben bigint', () => {
    const json = fuerJsonb(diffZuJson(diff));
    expect(diffAusJson(json)).toEqual(diff);
  });

  it('die kanonischen Bytes sind vor und nach der Rundreise dieselben', () => {
    const json = fuerJsonb(diffZuJson(diff));
    expect(kanonischerText(alsKanonischerWert(json))).toBe(kanonischerText(diffZuJson(diff)));
  });

  it('die Vorgabe der Spalte und ein leeres Objekt heissen „kein Diff"', () => {
    expect(diffAusJson([])).toBeNull();
    expect(diffAusJson({})).toBeNull();
    expect(diffAusJson(null)).toBeNull();
  });

  it('eine falsche Form faellt laut, nicht als NaN', () => {
    expect(() => diffAusJson({ geaendert: [{ feld: 'farbe' }] })).toThrow(DiffFehler);
    expect(() => diffAusJson({ deltaNettoCent: 1.5 })).toThrow(DiffFehler);
    expect(() => diffAusJson([1])).toThrow(DiffFehler);
  });
});

describe('alsKanonischerWert und fuerJsonb', () => {
  it('laesst undefined weg und lehnt Kommazahlen ab', () => {
    expect(alsKanonischerWert({ a: 1, b: undefined, c: [null, 'x'] })).toEqual({ a: 1, c: [null, 'x'] });
    expect(() => alsKanonischerWert({ a: 1.5 })).toThrow(DiffFehler);
  });

  it('liefert ein OBJEKT mit bigint als ganzer Zahl — keine Zeichenkette, die der Treiber erneut kodierte', () => {
    expect(fuerJsonb({ betrag: 456_000n, text: 'ä' })).toEqual({ betrag: 456000, text: 'ä' });
    expect(typeof fuerJsonb({ a: 1n })).toBe('object');
    expect(kanonischerText({ betrag: 456_000n })).toBe(kanonischerText({ betrag: 456_000 }));
  });
});
