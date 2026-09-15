import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg } from '../../src/lib/qr.js';

/**
 * Ein selbst gerechneter QR-Code ist nur dann etwas wert, wenn ihn eine Kamera
 * liest — und keine Kamera laeuft in dieser Testsuite. Also wird er hier
 * **zurueckgelesen**, und zwar auf dem umgekehrten Weg:
 *
 *  1. Die Formatbits kommen aus der Matrix, nicht aus dem Encoder, und werden
 *     gegen die veroeffentlichte Tabelle aus ISO/IEC 18004 geprueft. Damit
 *     haengt die Maskenwahl an einer externen Quelle statt an sich selbst.
 *  2. Die Datenmodule werden demaskiert, in derselben Zickzackfolge gelesen,
 *     entschachtelt — und dann wird das Reed-Solomon-SYNDROM gerechnet. Das ist
 *     eine andere Rechnung als die Erzeugung (Auswertung des Polynoms an den
 *     Nullstellen statt Division durch das Generatorpolynom): ein Fehler in
 *     `ecCodewoerter` faellt hier auf, ein blosser Selbstvergleich nicht.
 *  3. Modus, Laenge und Nutzlast werden geparst und mit dem Eingabetext
 *     verglichen.
 */

// --- GF(256), unabhaengig nachgebaut ----------------------------------------
const EXP: number[] = [];
const LOG: number[] = new Array<number>(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) { EXP.push(x); LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 0; i < 255; i += 1) EXP.push(EXP[i]!);
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

const VERSIONEN: Record<number, { ec: number; gruppen: [number, number][] }> = {
  1: { ec: 10, gruppen: [[1, 16]] },
  2: { ec: 16, gruppen: [[1, 28]] },
  3: { ec: 26, gruppen: [[1, 44]] },
  4: { ec: 18, gruppen: [[2, 32]] },
  5: { ec: 24, gruppen: [[2, 43]] },
  6: { ec: 16, gruppen: [[4, 27]] },
  7: { ec: 18, gruppen: [[4, 31]] },
  8: { ec: 22, gruppen: [[2, 38], [2, 39]] },
  9: { ec: 22, gruppen: [[3, 36], [2, 37]] },
  10: { ec: 26, gruppen: [[4, 43], [1, 44]] },
};

const AUSRICHTUNG: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const MASKEN: ((z: number, s: number) => boolean)[] = [
  (z, s) => (z + s) % 2 === 0,
  (z) => z % 2 === 0,
  (_z, s) => s % 3 === 0,
  (z, s) => (z + s) % 3 === 0,
  (z, s) => (Math.floor(z / 2) + Math.floor(s / 3)) % 2 === 0,
  (z, s) => ((z * s) % 2) + ((z * s) % 3) === 0,
  (z, s) => (((z * s) % 2) + ((z * s) % 3)) % 2 === 0,
  (z, s) => (((z + s) % 2) + ((z * s) % 3)) % 2 === 0,
];

/** Die Funktionsmuster — noch einmal, unabhaengig von der Quelle. */
function funktionsfelder(version: number): boolean[][] {
  const n = version * 4 + 17;
  const f = Array.from({ length: n }, () => Array.from({ length: n }, () => false));
  const block = (z0: number, s0: number, h: number, b: number): void => {
    for (let z = z0; z < z0 + h; z += 1) {
      for (let s = s0; s < s0 + b; s += 1) {
        if (z >= 0 && z < n && s >= 0 && s < n) f[z]![s] = true;
      }
    }
  };
  // Sucher inklusive Trennung und Formatstreifen.
  block(0, 0, 9, 9);
  block(0, n - 8, 9, 8);
  block(n - 8, 0, 8, 9);
  // Taktreihen.
  block(6, 0, 1, n);
  block(0, 6, n, 1);
  // Ausrichtungsmuster.
  const z = AUSRICHTUNG[version]!;
  for (const a of z) {
    for (const b of z) {
      if ((a === 6 && b === 6) || (a === 6 && b === n - 7) || (a === n - 7 && b === 6)) continue;
      block(a - 2, b - 2, 5, 5);
    }
  }
  // Versionsinformation.
  if (version >= 7) { block(0, n - 11, 6, 3); block(n - 11, 0, 3, 6); }
  return f;
}

/** Die 32 veroeffentlichten Formatzeichenketten (ISO/IEC 18004 Tabelle C.1), Stufe M. */
const FORMAT_M = [
  '101010000010010', '101000100100101', '101111001111100', '101101101001011',
  '100010111111001', '100000011001110', '100111110010111', '100101010100000',
];

function leseFormat(m: boolean[][]): { stufe: number; maske: number } {
  const bits: boolean[] = [];
  for (let i = 0; i <= 5; i += 1) bits.push(m[8]![i]!);
  bits.push(m[8]![7]!, m[8]![8]!, m[7]![8]!);
  for (let i = 9; i <= 14; i += 1) bits.push(m[14 - i]![8]!);
  // `bits[i]` ist Bit i (niederwertig zuerst) — als Zeichenkette ist es umgekehrt.
  const text = [...bits].reverse().map((b) => (b ? '1' : '0')).join('');
  const maske = FORMAT_M.indexOf(text);
  return { stufe: maske >= 0 ? 0 : -1, maske };
}

function leseDaten(m: boolean[][], version: number, maske: number): number[] {
  const n = m.length;
  const frei = funktionsfelder(version);
  const bits: number[] = [];
  let aufwaerts = true;
  for (let spalte = n - 1; spalte > 0; spalte -= 2) {
    const s0 = spalte <= 6 ? spalte - 1 : spalte;
    for (let i = 0; i < n; i += 1) {
      const zeile = aufwaerts ? n - 1 - i : i;
      for (const versatz of [0, 1]) {
        const x = s0 - versatz;
        if (frei[zeile]![x]) continue;
        const roh = m[zeile]![x]!;
        bits.push((roh !== MASKEN[maske]!(zeile, x)) ? 1 : 0);
      }
    }
    aufwaerts = !aufwaerts;
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | bits[i + j]!;
    bytes.push(b);
  }
  return bytes;
}

/** Entschachteln: der Gegenweg zu §8.6. */
function entschachtele(folge: number[], version: number): { daten: number[]; bloecke: number[][] } {
  const { ec, gruppen } = VERSIONEN[version]!;
  const groessen: number[] = [];
  for (const [anzahl, groesse] of gruppen) for (let i = 0; i < anzahl; i += 1) groessen.push(groesse);
  const datenBloecke: number[][] = groessen.map(() => []);
  let p = 0;
  const max = Math.max(...groessen);
  for (let i = 0; i < max; i += 1) {
    for (let b = 0; b < groessen.length; b += 1) {
      if (i < groessen[b]!) { datenBloecke[b]!.push(folge[p]!); p += 1; }
    }
  }
  const ecBloecke: number[][] = groessen.map(() => []);
  for (let i = 0; i < ec; i += 1) {
    for (let b = 0; b < groessen.length; b += 1) { ecBloecke[b]!.push(folge[p]!); p += 1; }
  }
  return {
    daten: datenBloecke.flat(),
    bloecke: datenBloecke.map((d, i) => [...d, ...ecBloecke[i]!]),
  };
}

/** Syndrom S_j = C(α^j). Null fuer jedes j heisst: fehlerfrei. */
function syndrome(codewort: number[], ec: number): number[] {
  return Array.from({ length: ec }, (_, j) => {
    let s = 0;
    for (const c of codewort) s = mul(s, EXP[j]!) ^ c;
    return s;
  });
}

function versionAusGroesse(n: number): number { return (n - 17) / 4; }

function leseText(daten: number[], version: number): string {
  let bit = 0;
  const hole = (anzahl: number): number => {
    let w = 0;
    for (let i = 0; i < anzahl; i += 1) {
      w = (w << 1) | ((daten[bit >> 3]! >>> (7 - (bit & 7))) & 1);
      bit += 1;
    }
    return w;
  };
  expect(hole(4)).toBe(0b0100);                      // Bytemodus
  const laenge = hole(version <= 9 ? 8 : 16);
  const bytes = Array.from({ length: laenge }, () => hole(8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function zurueck(text: string): string {
  const m = qrMatrix(text);
  const version = versionAusGroesse(m.length);
  const { maske } = leseFormat(m);
  expect(maske, 'Formatbits stehen nicht in der veroeffentlichten Tabelle').toBeGreaterThanOrEqual(0);
  const folge = leseDaten(m, version, maske);
  const { daten, bloecke } = entschachtele(folge, version);
  for (const b of bloecke) {
    expect(syndrome(b, VERSIONEN[version]!.ec).every((s) => s === 0),
      'Reed-Solomon-Syndrom ist nicht null — die EC-Codewoerter stimmen nicht').toBe(true);
  }
  return leseText(daten, version);
}

describe('QR-Code', () => {
  it('liest sich selbst zurueck — kurz', () => {
    expect(zurueck('HELLO')).toBe('HELLO');
  });

  it('liest sich zurueck: eine echte otpauth-Adresse', () => {
    const text = 'otpauth://totp/CSE%20Gruppe%3Aleitung%40cse-dienstleistungen.de'
      + '?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=CSE%20Gruppe'
      + '&algorithm=SHA1&digits=6&period=30';
    expect(zurueck(text)).toBe(text);
  });

  it.each([1, 10, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213])(
    'liest sich zurueck bei %i Zeichen — genau an den Versionsgrenzen',
    (n) => {
      const text = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + (i % 26))).join('');
      expect(zurueck(text)).toBe(text);
    },
  );

  it('traegt Umlaute als UTF-8 durch', () => {
    expect(zurueck('Gebäudereinigung · Straße 7 · Berlin')).toBe('Gebäudereinigung · Straße 7 · Berlin');
  });

  it('waehlt die kleinste Version, die passt', () => {
    expect(qrMatrix('A'.repeat(14)).length).toBe(21);   // Version 1
    expect(qrMatrix('A'.repeat(15)).length).toBe(25);   // Version 2
    expect(qrMatrix('A'.repeat(213)).length).toBe(57);  // Version 10
  });

  it('weist zurueck, was nicht mehr passt, statt still zu kuerzen', () => {
    expect(() => qrMatrix('A'.repeat(214))).toThrow(/Version 10/u);
  });

  it('hat die drei Suchmuster an ihren Plaetzen', () => {
    const m = qrMatrix('HELLO');
    const n = m.length;
    for (const [z0, s0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      expect(m[z0]![s0]).toBe(true);
      expect(m[z0 + 1]![s0 + 1]).toBe(false);
      expect(m[z0 + 3]![s0 + 3]).toBe(true);
    }
    // Das immer dunkle Modul (§8.9).
    expect(m[n - 8]![8]).toBe(true);
  });

  it('gibt ein SVG ohne fremde Quellen aus', () => {
    const svg = qrSvg('HELLO');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/u);
    expect(svg).toContain('viewBox="0 0 29 29"');   // 21 + 2 × 4 Rand
  });
});
