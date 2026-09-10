/**
 * Der Tabellenleser fuer den Raumbuch-Import (OPS-04).
 *
 * **Warum eigen und nicht eine Bibliothek.** Was hier gebraucht wird, ist
 * eng: CSV mit dem Trennzeichen, das Excel im deutschen Sprachraum schreibt
 * (`;`), Anfuehrungszeichen mit verdoppeltem Escape, BOM, und Zahlen mit
 * Dezimalkomma UND Tausenderpunkt. Eine Bibliothek brachte all das mit und
 * dazu ein eigenes Verstaendnis davon, was `1.234` bedeutet — und genau
 * dieses Missverstaendnis ist der teure Fehler: `1.234` heisst in einer
 * deutschen Tabelle 1234, in einer englischen 1,234.
 *
 * **Was hier NICHT steht: `.xlsx`.** Eine Excel-Datei ist ein ZIP mit XML,
 * und ein halbfertiger Leser dafuer ist schlimmer als keiner — er liest die
 * erste Tabelle, uebersieht Formeln und verdichtete Zellen und meldet
 * trotzdem Erfolg. Bis eine geprueft Bibliothek dafuer eingerichtet ist,
 * nimmt der Import CSV und sagt das; eine `.xlsx` wird ABGEWIESEN, nicht
 * stillschweigend halb gelesen.
 */

export class TabellenFehler extends Error {
  constructor(nachricht: string, readonly grund: 'leer' | 'format' | 'kopfzeile') {
    super(nachricht);
    this.name = 'TabellenFehler';
  }
}

export interface Tabelle {
  readonly kopf: readonly string[];
  /** Je Zeile: Spaltenkopf → Rohwert, unveraendert. */
  readonly zeilen: readonly Readonly<Record<string, string>>[];
}

/** Erkennt das Trennzeichen an der Kopfzeile: `;` (deutsch), `,` oder Tab. */
export function trennzeichenAus(kopfzeile: string): string {
  const kandidaten = [';', '\t', ','] as const;
  let bestes: string = ';';
  let meiste = -1;
  for (const k of kandidaten) {
    const anzahl = kopfzeile.split(k).length - 1;
    if (anzahl > meiste) { meiste = anzahl; bestes = k; }
  }
  return meiste > 0 ? bestes : ';';
}

/**
 * Ein CSV-Leser, der Anfuehrungszeichen versteht.
 *
 * Ohne sie zerfiele `"Raum 1; gross";12,5` in drei Felder statt zwei — und
 * die 12,5 landete in der falschen Spalte, ohne dass irgendetwas meldet.
 */
export function leseCsv(text: string): Tabelle {
  // Ein BOM aus Excel steht vor dem ersten Spaltennamen und macht aus
  // "Etage" ein "﻿Etage" — die Zuordnung fände die Spalte dann nie.
  const ohneBom = text.replace(/^﻿/u, '');
  if (ohneBom.trim() === '') throw new TabellenFehler('Die Datei ist leer', 'leer');

  const ersteZeile = ohneBom.split(/\r?\n/u)[0] ?? '';
  const trenner = trennzeichenAus(ersteZeile);

  const felder: string[][] = [];
  let zeile: string[] = [];
  let feld = '';
  let inAnfuehrung = false;

  for (let i = 0; i < ohneBom.length; i += 1) {
    const z = ohneBom[i]!;
    if (inAnfuehrung) {
      if (z === '"') {
        if (ohneBom[i + 1] === '"') { feld += '"'; i += 1; } else { inAnfuehrung = false; }
      } else {
        feld += z;
      }
      continue;
    }
    if (z === '"') { inAnfuehrung = true; continue; }
    if (z === trenner) { zeile.push(feld); feld = ''; continue; }
    if (z === '\n') {
      zeile.push(feld.replace(/\r$/u, ''));
      felder.push(zeile);
      zeile = []; feld = '';
      continue;
    }
    feld += z;
  }
  if (feld !== '' || zeile.length > 0) { zeile.push(feld); felder.push(zeile); }

  const [kopfRoh, ...rest] = felder;
  if (kopfRoh === undefined) throw new TabellenFehler('Keine Kopfzeile', 'kopfzeile');
  const kopf = kopfRoh.map((k) => k.trim());
  if (kopf.every((k) => k === '')) {
    throw new TabellenFehler('Die Kopfzeile ist leer', 'kopfzeile');
  }

  const zeilen = rest
    // Eine Zeile, die nur aus Trennzeichen besteht, ist keine Zeile — Excel
    // haengt sie ans Dateiende, und ohne diese Bedingung entstuende bei jedem
    // Import ein leerer Raum.
    .filter((z) => z.some((w) => w.trim() !== ''))
    .map((z) => {
      const satz: Record<string, string> = {};
      kopf.forEach((name, i) => { satz[name] = (z[i] ?? '').trim(); });
      return satz;
    });

  return { kopf, zeilen };
}

/**
 * Eine deutsche Zahl in ganzzahlige Tausendstel.
 *
 * `"1.234,5"` → `1_234_500n`. Der Tausenderpunkt faellt weg, das Komma ist
 * der Dezimaltrenner. `"12.5"` — englisch geschrieben — ist mehrdeutig und
 * wird als 12,5 gelesen, WENN nach dem Punkt hoechstens zwei Stellen stehen
 * und kein weiterer Punkt vorkommt; sonst gilt der Punkt als Tausendertrenner.
 * Diese Regel steht hier, weil sie sonst an drei Stellen anders geraten wird.
 */
export function deutscheZahl(roh: string): bigint | null {
  const text = roh.trim().replace(/\s/gu, '');
  if (text === '') return null;
  if (!/^-?[\d.,]+$/u.test(text)) return null;

  let ganz: string;
  let bruch: string;
  const negativ = text.startsWith('-');
  const ohneVorzeichen = negativ ? text.slice(1) : text;

  if (ohneVorzeichen.includes(',')) {
    const teile = ohneVorzeichen.split(',');
    if (teile.length > 2) return null;
    ganz = (teile[0] ?? '').replaceAll('.', '');
    bruch = teile[1] ?? '';
  } else {
    const punkte = ohneVorzeichen.split('.');
    if (punkte.length === 2 && (punkte[1] ?? '').length <= 2
        && (punkte[1] ?? '').length > 0) {
      ganz = punkte[0] ?? '';
      bruch = punkte[1] ?? '';
    } else {
      ganz = ohneVorzeichen.replaceAll('.', '');
      bruch = '';
    }
  }
  if (ganz === '') ganz = '0';
  if (!/^\d*$/u.test(ganz) || !/^\d*$/u.test(bruch)) return null;
  if (bruch.length > 3) return null;

  const tausendstel = BigInt(ganz) * 1000n + BigInt(bruch.padEnd(3, '0') || '0');
  return negativ ? -tausendstel : tausendstel;
}

/** `12_500n` → `"12.500"` — die Form, die `numeric(12,3)` erwartet. */
export function alsNumerisch(tausendstel: bigint): string {
  const negativ = tausendstel < 0n;
  const abs = negativ ? -tausendstel : tausendstel;
  const ganz = abs / 1000n;
  const rest = (abs % 1000n).toString().padStart(3, '0');
  return `${negativ ? '-' : ''}${ganz.toString()}.${rest}`;
}
