/**
 * Ein QR-Code, gerechnet statt geladen — Bytemodus, Fehlerkorrektur M,
 * Versionen 1 bis 10 (bis 213 Zeichen).
 *
 * **Warum ueberhaupt selbst?** Ein zweiter Faktor, den man abtippen muss, wird
 * nicht eingerichtet — und ein QR-Code, der von einem fremden Dienst als Bild
 * geladen wird, traegt das Geheimnis dorthin. Beide Wege sind schlechter als
 * zweihundert Zeilen, die niemand mehr anfassen muss: ISO/IEC 18004 aendert
 * sich nicht.
 *
 * Das Ergebnis ist eine Matrix aus `true`/`false`. Gezeichnet wird sie als
 * SVG — ein Pfad aus Rechtecken, gestochen scharf in jeder Groesse, ohne
 * Bilddatei und ohne Netzwerkzugriff.
 */

/** Fehlerkorrektur M: 15 % Redundanz. Der uebliche Kompromiss. */
const EC_STUFE = 0b00;

interface VersionsAngabe {
  /** EC-Codewoerter je Block. */
  readonly ec: number;
  /** [Bloecke, Datencodewoerter] je Gruppe. */
  readonly gruppen: readonly (readonly [number, number])[];
  readonly ausrichtung: readonly number[];
}

/** Tabelle 13/14 aus ISO/IEC 18004 fuer Stufe M. */
const VERSIONEN: Record<number, VersionsAngabe> = {
  1:  { ec: 10, gruppen: [[1, 16]], ausrichtung: [] },
  2:  { ec: 16, gruppen: [[1, 28]], ausrichtung: [6, 18] },
  3:  { ec: 26, gruppen: [[1, 44]], ausrichtung: [6, 22] },
  4:  { ec: 18, gruppen: [[2, 32]], ausrichtung: [6, 26] },
  5:  { ec: 24, gruppen: [[2, 43]], ausrichtung: [6, 30] },
  6:  { ec: 16, gruppen: [[4, 27]], ausrichtung: [6, 34] },
  7:  { ec: 18, gruppen: [[4, 31]], ausrichtung: [6, 22, 38] },
  8:  { ec: 22, gruppen: [[2, 38], [2, 39]], ausrichtung: [6, 24, 42] },
  9:  { ec: 22, gruppen: [[3, 36], [2, 37]], ausrichtung: [6, 26, 46] },
  10: { ec: 26, gruppen: [[4, 43], [1, 44]], ausrichtung: [6, 28, 50] },
};

function datenCodewoerter(version: number): number {
  return VERSIONEN[version]!.gruppen.reduce((s, [n, d]) => s + n * d, 0);
}

// --- GF(256), Generatorpolynom x^8 + x^4 + x^3 + x^2 + 1 ---------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
}

function mul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}

/** Das Generatorpolynom fuer `n` EC-Codewoerter. */
function generator(n: number): Uint8Array {
  let p = new Uint8Array([1]);
  for (let i = 0; i < n; i += 1) {
    const q = new Uint8Array(p.length + 1);
    for (let j = 0; j < p.length; j += 1) {
      q[j] = (q[j] ?? 0) ^ p[j]!;
      q[j + 1] = (q[j + 1] ?? 0) ^ mul(p[j]!, EXP[i]!);
    }
    p = q;
  }
  return p;
}

function ecCodewoerter(daten: Uint8Array, n: number): Uint8Array {
  const g = generator(n);
  const rest = new Uint8Array(n);
  for (const b of daten) {
    const faktor = b ^ rest[0]!;
    rest.copyWithin(0, 1);
    rest[n - 1] = 0;
    if (faktor !== 0) {
      for (let i = 0; i < n; i += 1) rest[i] = rest[i]! ^ mul(g[i + 1]!, faktor);
    }
  }
  return rest;
}

// --- Bitstrom ---------------------------------------------------------------

class Bits {
  private readonly bits: number[] = [];

  schreibe(wert: number, laenge: number): void {
    for (let i = laenge - 1; i >= 0; i -= 1) this.bits.push((wert >>> i) & 1);
  }

  get laenge(): number { return this.bits.length; }

  bytes(): Uint8Array {
    const n = Math.ceil(this.bits.length / 8);
    const aus = new Uint8Array(n);
    this.bits.forEach((b, i) => {
      if (b) aus[i >> 3] = aus[i >> 3]! | (0x80 >> (i & 7));
    });
    return aus;
  }
}

// --- Aufbau -----------------------------------------------------------------

function versionFuer(bytes: number): number {
  for (let v = 1; v <= 10; v += 1) {
    const zaehlerBits = v <= 9 ? 8 : 16;
    const noetig = Math.ceil((4 + zaehlerBits + bytes * 8) / 8);
    if (noetig <= datenCodewoerter(v)) return v;
  }
  throw new Error(`QR: ${String(bytes)} Byte passen nicht in Version 10 (Stufe M).`);
}

function nutzlast(text: string, version: number): Uint8Array {
  const roh = new TextEncoder().encode(text);
  const gesamt = datenCodewoerter(version);
  const bits = new Bits();
  bits.schreibe(0b0100, 4);                        // Bytemodus
  bits.schreibe(roh.length, version <= 9 ? 8 : 16); // Zeichenzahl
  for (const b of roh) bits.schreibe(b, 8);
  // Abschluss: bis zu vier Nullbits, dann auf volle Byte auffuellen.
  bits.schreibe(0, Math.min(4, gesamt * 8 - bits.laenge));
  while (bits.laenge % 8 !== 0) bits.schreibe(0, 1);
  const daten = Array.from(bits.bytes());
  // Fuellbytes im vorgeschriebenen Wechsel.
  for (let i = 0; daten.length < gesamt; i += 1) daten.push(i % 2 === 0 ? 0xec : 0x11);
  return new Uint8Array(daten);
}

/** Bloecke bilden, EC rechnen, verschachteln (ISO/IEC 18004 §8.6). */
function endgueltigeFolge(daten: Uint8Array, version: number): Uint8Array {
  const { ec, gruppen } = VERSIONEN[version]!;
  const datenBloecke: Uint8Array[] = [];
  const ecBloecke: Uint8Array[] = [];
  let versatz = 0;
  for (const [anzahl, groesse] of gruppen) {
    for (let i = 0; i < anzahl; i += 1) {
      const block = daten.slice(versatz, versatz + groesse);
      versatz += groesse;
      datenBloecke.push(block);
      ecBloecke.push(ecCodewoerter(block, ec));
    }
  }
  const aus: number[] = [];
  const maxDaten = Math.max(...datenBloecke.map((b) => b.length));
  for (let i = 0; i < maxDaten; i += 1) {
    for (const b of datenBloecke) if (i < b.length) aus.push(b[i]!);
  }
  for (let i = 0; i < ec; i += 1) {
    for (const b of ecBloecke) aus.push(b[i]!);
  }
  return new Uint8Array(aus);
}

// --- Matrix -----------------------------------------------------------------

type Matrix = (boolean | null)[][];

function leereMatrix(groesse: number): Matrix {
  return Array.from({ length: groesse }, () => Array.from({ length: groesse }, () => null));
}

function setzeSucher(m: Matrix, zeile: number, spalte: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let s = -1; s <= 7; s += 1) {
      const y = zeile + r;
      const x = spalte + s;
      if (y < 0 || y >= m.length || x < 0 || x >= m.length) continue;
      const rand = r === 0 || r === 6 || s === 0 || s === 6;
      const kern = r >= 2 && r <= 4 && s >= 2 && s <= 4;
      m[y]![x] = rand || kern;
    }
  }
}

function setzeAusrichtung(m: Matrix, zeile: number, spalte: number): void {
  for (let r = -2; r <= 2; r += 1) {
    for (let s = -2; s <= 2; s += 1) {
      m[zeile + r]![spalte + s] = Math.max(Math.abs(r), Math.abs(s)) !== 1;
    }
  }
}

function geruest(version: number): Matrix {
  const groesse = version * 4 + 17;
  const m = leereMatrix(groesse);

  setzeSucher(m, 0, 0);
  setzeSucher(m, 0, groesse - 7);
  setzeSucher(m, groesse - 7, 0);

  const zentren = VERSIONEN[version]!.ausrichtung;
  for (const z of zentren) {
    for (const s of zentren) {
      // Nicht in die Ecken der Suchmuster.
      if ((z === 6 && s === 6) || (z === 6 && s === groesse - 7)
        || (z === groesse - 7 && s === 6)) continue;
      setzeAusrichtung(m, z, s);
    }
  }

  for (let i = 8; i < groesse - 8; i += 1) {
    const an = i % 2 === 0;
    m[6]![i] = an;
    m[i]![6] = an;
  }

  // Das immer dunkle Modul (§8.9).
  m[groesse - 8]![8] = true;

  /**
   * Ab Version 7 stehen zwei Kopien der Versionsinformation im Code — und ihr
   * Platz muss VOR den Daten belegt sein.
   *
   * Sie erst nach `schreibeDaten` zu setzen sah richtig aus und war der
   * teuerste Fehler dieser Datei: die achtzehn Module wurden erst mit Daten
   * gefuellt, dann ueberschrieben, und ab Version 7 stimmte jedes
   * Reed-Solomon-Syndrom nicht mehr. Ein Leser haette den Code als beschaedigt
   * verworfen — ohne dass hier irgendetwas ausgesehen haette wie ein Fehler.
   */
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const z = Math.floor(i / 3);
      const s = i % 3;
      m[z]![groesse - 11 + s] = false;
      m[groesse - 11 + s]![z] = false;
    }
  }

  // Platz fuer die Formatinformation freihalten.
  for (let i = 0; i <= 8; i += 1) {
    if (m[8]![i] === null) m[8]![i] = false;
    if (m[i]![8] === null) m[i]![8] = false;
  }
  for (let i = 0; i < 8; i += 1) {
    if (m[8]![groesse - 1 - i] === null) m[8]![groesse - 1 - i] = false;
    if (m[groesse - 1 - i]![8] === null) m[groesse - 1 - i]![8] = false;
  }

  return m;
}

/** Welche Felder sind Funktionsmuster? Gemessen am Geruest VOR den Daten. */
function belegt(version: number): boolean[][] {
  const g = geruest(version);
  return g.map((zeile) => zeile.map((z) => z !== null));
}

function schreibeDaten(m: Matrix, frei: boolean[][], folge: Uint8Array): void {
  const groesse = m.length;
  let bit = 0;
  let aufwaerts = true;
  for (let spalte = groesse - 1; spalte > 0; spalte -= 2) {
    // Die Spalte 6 ist die senkrechte Taktreihe und wird uebersprungen.
    const s = spalte <= 6 ? spalte - 1 : spalte;
    for (let i = 0; i < groesse; i += 1) {
      const zeile = aufwaerts ? groesse - 1 - i : i;
      for (const versatz of [0, 1]) {
        const x = s - versatz;
        if (frei[zeile]![x]) continue;
        const wert = bit < folge.length * 8
          ? ((folge[bit >> 3]! >>> (7 - (bit & 7))) & 1) === 1
          : false;
        m[zeile]![x] = wert;
        bit += 1;
      }
    }
    aufwaerts = !aufwaerts;
  }
}

const MASKEN: readonly ((z: number, s: number) => boolean)[] = [
  (z, s) => (z + s) % 2 === 0,
  (z) => z % 2 === 0,
  (_z, s) => s % 3 === 0,
  (z, s) => (z + s) % 3 === 0,
  (z, s) => (Math.floor(z / 2) + Math.floor(s / 3)) % 2 === 0,
  (z, s) => ((z * s) % 2) + ((z * s) % 3) === 0,
  (z, s) => (((z * s) % 2) + ((z * s) % 3)) % 2 === 0,
  (z, s) => (((z + s) % 2) + ((z * s) % 3)) % 2 === 0,
];

/** Die vier Strafen aus §8.8.2 — je niedriger, desto besser lesbar. */
function strafe(m: boolean[][]): number {
  const n = m.length;
  let p = 0;

  const reihe = (hole: (a: number, b: number) => boolean): void => {
    for (let a = 0; a < n; a += 1) {
      let lauf = 1;
      for (let b = 1; b < n; b += 1) {
        if (hole(a, b) === hole(a, b - 1)) lauf += 1;
        else { if (lauf >= 5) p += lauf - 2; lauf = 1; }
      }
      if (lauf >= 5) p += lauf - 2;
    }
  };
  reihe((z, s) => m[z]![s]!);
  reihe((s, z) => m[z]![s]!);

  for (let z = 0; z < n - 1; z += 1) {
    for (let s = 0; s < n - 1; s += 1) {
      const v = m[z]![s]!;
      if (v === m[z]![s + 1] && v === m[z + 1]![s] && v === m[z + 1]![s + 1]) p += 3;
    }
  }

  const muster = [true, false, true, true, true, false, true, false, false, false, false];
  const umgekehrt = [...muster].reverse();
  const passt = (hole: (i: number) => boolean, start: number, ziel: boolean[]): boolean =>
    ziel.every((w, i) => hole(start + i) === w);
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b + 11 <= n; b += 1) {
      if (passt((i) => m[a]![i]!, b, muster) || passt((i) => m[a]![i]!, b, umgekehrt)) p += 40;
      if (passt((i) => m[i]![a]!, b, muster) || passt((i) => m[i]![a]!, b, umgekehrt)) p += 40;
    }
  }

  const dunkel = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs((dunkel * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

function formatBits(maske: number): number {
  const daten = (EC_STUFE << 3) | maske;
  let rest = daten << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rest >>> i) & 1) rest ^= 0b10100110111 << (i - 10);
  }
  return ((daten << 10) | rest) ^ 0b101010000010010;
}

function versionBits(version: number): number {
  let rest = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rest >>> i) & 1) rest ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | rest;
}

function setzeFormat(m: boolean[][], maske: number): void {
  const n = m.length;
  const bits = formatBits(maske);
  const an = (i: number): boolean => ((bits >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) m[8]![i] = an(i);
  m[8]![7] = an(6);
  m[8]![8] = an(7);
  m[7]![8] = an(8);
  for (let i = 9; i <= 14; i += 1) m[14 - i]![8] = an(i);

  // Sieben Module senkrecht unten links (Bit 0–6) und acht waagerecht oben
  // rechts (Bit 7–14). Das achte unten waere das IMMER dunkle Modul (§8.9) —
  // es gehoert nicht zur Formatinformation und wird hier nicht ueberschrieben.
  for (let i = 0; i <= 6; i += 1) m[n - 1 - i]![8] = an(i);
  for (let i = 7; i <= 14; i += 1) m[8]![n - 15 + i] = an(i);
}

function setzeVersion(m: boolean[][], version: number): void {
  if (version < 7) return;
  const n = m.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const an = ((bits >>> i) & 1) === 1;
    const z = Math.floor(i / 3);
    const s = i % 3;
    m[z]![n - 11 + s] = an;
    m[n - 11 + s]![z] = an;
  }
}

/** Die fertige Matrix: `true` = dunkles Modul. */
export function qrMatrix(text: string): boolean[][] {
  const roh = new TextEncoder().encode(text);
  const version = versionFuer(roh.length);
  const folge = endgueltigeFolge(nutzlast(text, version), version);
  const frei = belegt(version);

  let beste: boolean[][] | null = null;
  let besteStrafe = Number.POSITIVE_INFINITY;
  let besteMaske = 0;

  for (let maske = 0; maske < 8; maske += 1) {
    const m = geruest(version);
    schreibeDaten(m, frei, folge);
    const fertig = m.map((zeile, z) => zeile.map((wert, s) => {
      const w = wert ?? false;
      return frei[z]![s] ? w : w !== MASKEN[maske]!(z, s);
    }));
    setzeFormat(fertig, maske);
    setzeVersion(fertig, version);
    const s = strafe(fertig);
    if (s < besteStrafe) { besteStrafe = s; beste = fertig; besteMaske = maske; }
  }

  void besteMaske;
  return beste!;
}

/**
 * Die Matrix als SVG.
 *
 * Ein einziger Pfad statt tausend Rechtecken: der Browser zeichnet ihn in
 * einem Zug, und die Zeichenkette bleibt kurz genug, um sie ohne Bedenken in
 * die Seite zu schreiben. `shape-rendering="crispEdges"` verhindert, dass die
 * Kanten bei krummen Vergroesserungen verwaschen — ein weichgezeichneter
 * QR-Code wird von manchen Kameras nicht mehr gelesen.
 */
export function qrSvg(text: string, randModule = 4): string {
  const m = qrMatrix(text);
  const n = m.length;
  const gesamt = n + randModule * 2;
  const teile: string[] = [];
  for (let z = 0; z < n; z += 1) {
    for (let s = 0; s < n; s += 1) {
      if (m[z]![s]) teile.push(`M${String(s + randModule)} ${String(z + randModule)}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(gesamt)} ${String(gesamt)}"`
    + ` shape-rendering="crispEdges" role="img">`
    + `<rect width="${String(gesamt)}" height="${String(gesamt)}" fill="#ffffff"/>`
    + `<path d="${teile.join('')}" fill="#000000"/></svg>`;
}
