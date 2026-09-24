/**
 * Die Koordinaten eines Objekts — Dezimalgrad in, `numeric(9,6)` heraus
 * (V-170, OPS-01, BAU-08).
 *
 * `objekt.geo_lat`/`geo_lon` gab es seit 0021, und kein Weg schrieb sie. Die
 * Eingabe kommt jetzt als Text aus einem Formular — mit deutschem Komma oder
 * mit dem Punkt einer Karte — und darf auf dem Weg in die Spalte weder zur
 * Gleitkommazahl werden noch still verrutschen. Diese Datei hält fest, was
 * angenommen, was gerundet und was abgewiesen wird.
 */
import { describe, expect, it } from 'vitest';
import {
  koordinateAlsText, koordinatenAus, leseKoordinate, ObjektFehler,
} from '../../src/server/services/objekt/anlegen.js';

function grundVon(f: () => unknown): string {
  try {
    f();
  } catch (fehler) {
    if (fehler instanceof ObjektFehler) return fehler.grund;
    throw fehler;
  }
  throw new Error('kein Fehler geworfen');
}

describe('leseKoordinate', () => {
  it.each([
    ['52,520008', 'breite', '52.520008'],
    ['52.520008', 'breite', '52.520008'],
    ['13,404954', 'laenge', '13.404954'],
    [' 52,52 ', 'breite', '52.520000'],
    ['52', 'breite', '52.000000'],
    ['52°', 'breite', '52.000000'],
    ['-33,868820', 'breite', '-33.868820'],
    ['+151,209296', 'laenge', '151.209296'],
    ['-0,0000001', 'laenge', '0.000000'],
  ] as const)('%s (%s) → %s', (roh, art, erwartet) => {
    expect(leseKoordinate(roh, art)).toBe(erwartet);
  });

  it('rundet auf sechs Stellen halb aufwärts vom Nullpunkt weg — in ganzen Zahlen', () => {
    // Das liefert eine Karte beim Kopieren; die siebte Stelle entscheidet.
    expect(leseKoordinate('52.52000659999999', 'breite')).toBe('52.520007');
    expect(leseKoordinate('52.5200064', 'breite')).toBe('52.520006');
    expect(leseKoordinate('52.5200065', 'breite')).toBe('52.520007');
    expect(leseKoordinate('-13.4049545', 'laenge')).toBe('-13.404955');
    // Das Aufrunden trägt über die Grenze einer Stelle hinweg.
    expect(leseKoordinate('13.9999995', 'laenge')).toBe('14.000000');
  });

  it('nimmt die Ränder an und weist dahinter ab — die CHECKs aus 0021', () => {
    expect(leseKoordinate('90', 'breite')).toBe('90.000000');
    expect(leseKoordinate('-90', 'breite')).toBe('-90.000000');
    expect(leseKoordinate('180', 'laenge')).toBe('180.000000');
    expect(grundVon(() => leseKoordinate('90,000001', 'breite'))).toBe('koordinate_bereich');
    expect(grundVon(() => leseKoordinate('-180,5', 'laenge'))).toBe('koordinate_bereich');
    expect(grundVon(() => leseKoordinate('181', 'laenge'))).toBe('koordinate_bereich');
    // Geprüft wird der GERUNDETE Wert — der, der in der Spalte landet.
    expect(leseKoordinate('89.9999996', 'breite')).toBe('90.000000');
    expect(grundVon(() => leseKoordinate('90.0000005', 'breite'))).toBe('koordinate_bereich');
  });

  it.each([
    'abc', '52,5,1', '1.234,5', '52.', ',5', '5 2', '1234', '52,5 N', '',
  ])('weist „%s" ab, statt zu raten', (roh) => {
    expect(grundVon(() => leseKoordinate(roh, 'breite'))).toBe('koordinate_ungueltig');
  });
});

describe('koordinatenAus — das Paar', () => {
  it('beide leer heisst: keine Koordinaten', () => {
    expect(koordinatenAus(undefined, undefined)).toBeNull();
    expect(koordinatenAus('', '  ')).toBeNull();
  });

  it('ein halbes Paar ist kein Ort', () => {
    expect(grundVon(() => koordinatenAus('52,5', ''))).toBe('koordinaten_paar');
    expect(grundVon(() => koordinatenAus(undefined, '13,4'))).toBe('koordinaten_paar');
  });

  it('gibt beide Werte in der Form von numeric(9,6) zurück', () => {
    expect(koordinatenAus('52,503100', '13.3324')).toEqual(
      { lat: '52.503100', lon: '13.332400' });
  });

  it('prüft Breite und Länge je gegen ihren eigenen Bereich', () => {
    // 120 ist als Länge gültig, als Breite nicht — vertauschte Felder fallen auf.
    expect(grundVon(() => koordinatenAus('120', '52'))).toBe('koordinate_bereich');
    expect(koordinatenAus('52', '120')).toEqual({ lat: '52.000000', lon: '120.000000' });
  });
});

describe('koordinateAlsText', () => {
  it('zeigt die gespeicherte Koordinate mit deutschem Komma, ohne Umweg über Number', () => {
    expect(koordinateAlsText('52.520008')).toBe('52,520008');
    expect(koordinateAlsText('-0.000001')).toBe('-0,000001');
    expect(koordinateAlsText(null)).toBe('');
  });
});
