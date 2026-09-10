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
  constructor(nachricht: string, readonly grund: 'leer' | 'format' | 'kopfzeile' | 'anfuehrung' | 'feldzahl') {
    super(nachricht);
    this.name = 'TabellenFehler';
  }
}

export interface Tabelle {
  readonly kopf: readonly string[];
  /** Je Zeile: Spaltenkopf → Rohwert, unveraendert. */
  readonly zeilen: readonly Readonly<Record<string, string>>[];
}

/**
 * Erkennt das Trennzeichen an der Kopfzeile: `;` (deutsch), `,` oder Tab.
 *
 * Gezaehlt wird NUR AUSSERHALB von Anfuehrungszeichen. Sonst gewinnt in
 * `Etage;"Bezeichnung, lang";"Flaeche, m²"` das Komma mit zwei Treffern gegen
 * das Semikolon mit zweien — und die Datei zerfaellt an der falschen Stelle,
 * worauf jede Spalte um eins verrutscht und die Flaeche in der Nutzungsart
 * landet. Das faellt niemandem auf, weil die Vorschau dann ordentlich
 * aussieht: sie zeigt ja genau das, was gelesen wurde.
 */
export function trennzeichenAus(kopfzeile: string): string {
  const kandidaten = [';', '\t', ','] as const;
  const zaehler = new Map<string, number>(kandidaten.map((k) => [k, 0]));

  let inAnfuehrung = false;
  for (let i = 0; i < kopfzeile.length; i += 1) {
    const z = kopfzeile[i];
    if (z === '"') {
      // `""` innerhalb eines Feldes ist ein Anfuehrungszeichen, kein Wechsel.
      if (inAnfuehrung && kopfzeile[i + 1] === '"') { i += 1; continue; }
      inAnfuehrung = !inAnfuehrung;
      continue;
    }
    if (inAnfuehrung) continue;
    const bisher = zaehler.get(z ?? '');
    if (bisher !== undefined) zaehler.set(z ?? '', bisher + 1);
  }

  let bestes: string = ';';
  let meiste = 0;
  for (const k of kandidaten) {
    const anzahl = zaehler.get(k) ?? 0;
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
  /**
   * Ein nicht geschlossenes Anfuehrungszeichen ist ein FEHLER, kein Rest.
   *
   * Blieb `inAnfuehrung` am Dateiende wahr, hat der Parser alles ab dem
   * offenen Zeichen — Zeilenumbrueche eingeschlossen — in EIN Feld gezogen.
   * Er lieferte das bisher als gueltige Tabelle zurueck: die restlichen
   * Zeilen verschwanden in einer Zelle, und der Import las verschobene Daten
   * als sauber ein.
   */
  if (inAnfuehrung) {
    throw new TabellenFehler(
      'Ein Anfuehrungszeichen wurde nicht geschlossen — die Datei laesst sich '
      + 'nicht sicher lesen', 'anfuehrung');
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
    .map((z, i) => {
      /**
       * Eine Zeile mit ANDERER Feldzahl wurde bisher still aufgefuellt oder
       * abgeschnitten. Genau dann ist die Datei verschoben — und die Spalten,
       * die es trifft, sind Flaeche und Belag. Ein stillschweigend
       * aufgefuellter Raum bekommt die Flaeche des Nachbarn.
       */
      if (z.length !== kopf.length) {
        throw new TabellenFehler(
          `Zeile ${i + 2} hat ${z.length} Felder, die Kopfzeile ${kopf.length} — `
          + 'die Datei ist verschoben', 'feldzahl');
      }
      const satz: Record<string, string> = {};
      kopf.forEach((name, j) => { satz[name] = (z[j] ?? '').trim(); });
      return satz;
    });

  return { kopf, zeilen };
}

/** Was beim Lesen einer Zahl herauskam — Wert UND Sicherheit. */
export interface Zahlbefund {
  /** Die Tausendstel, oder `null`, wenn hier keine Zahl steht. */
  readonly wert: bigint | null;
  /**
   * Wahr, wenn die Schreibweise zwei Lesarten zulaesst und wir eine gewaehlt
   * haben. `12.50` ist deutsch 1250 und englisch 12,50 — beides plausibel.
   */
  readonly mehrdeutig: boolean;
  /** Die gewaehlte Lesart im Klartext, fuer die Vorschau. */
  readonly deutung: string | null;
}

/** Ein Zifferngefuege mit Tausenderpunkten: `1.234`, `12.345.678`. */
const GRUPPIERT = /^\d{1,3}(?:\.\d{3})+$/u;

/**
 * Eine deutsche Zahl in ganzzahlige Tausendstel — und die Auskunft, ob die
 * Schreibweise eindeutig war.
 *
 * `"1.234,5"` → `1_234_500n`. Der Tausenderpunkt faellt weg, das Komma ist der
 * Dezimaltrenner.
 *
 * **`"12.50"` ist MEHRDEUTIG** und wird als solche gemeldet, nicht stumm
 * umgedeutet: deutsch gelesen sind es 1250, englisch 12,50 — ein Faktor 100
 * auf einer Flaeche, aus der ein Preis wird (08-PR-PLAN §288 (3)). Gelesen
 * wird sie als 12,50, weil das die haeufigere Herkunft solcher Dateien ist;
 * gesagt wird es trotzdem.
 *
 * Was KEINE Zahl ist, ist keine: `"."`, `","`, `"1..2"` und `"1.2.3"` haben
 * vorher 0, 0, 12000 und 123000 ergeben — Werte, die aussehen wie Messwerte
 * und keine sind.
 */
export function leseZahl(roh: string): Zahlbefund {
  const leer: Zahlbefund = { wert: null, mehrdeutig: false, deutung: null };
  const text = roh.trim().replace(/\s/gu, '');
  if (text === '') return leer;
  if (!/^-?[\d.,]+$/u.test(text)) return leer;
  // Ohne wenigstens eine Ziffer ist es Interpunktion, kein Wert.
  if (!/\d/u.test(text)) return leer;

  const negativ = text.startsWith('-');
  const ohneVorzeichen = negativ ? text.slice(1) : text;

  let ganz: string;
  let bruch: string;
  let mehrdeutig = false;
  let deutung: string | null = null;

  if (ohneVorzeichen.includes(',')) {
    const teile = ohneVorzeichen.split(',');
    if (teile.length > 2) return leer;
    const kopf = teile[0] ?? '';
    // Der Ganzteil darf gruppiert sein oder gar keinen Punkt tragen — alles
    // dazwischen (`1..2`, `1.2.3`, `12.34`) ist keine gueltige Gruppierung.
    if (kopf.includes('.') && !GRUPPIERT.test(kopf)) return leer;
    // `12,` ist eine angefangene Zahl, keine 12. Sie stillschweigend als
    // 12,000 zu lesen hiesse, einen abgeschnittenen Wert als vollstaendig
    // auszugeben — und es ist eine FLAECHE, die daraus wird.
    if ((teile[1] ?? '') === '') return leer;
    ganz = kopf.replaceAll('.', '');
    bruch = teile[1] ?? '';
  } else if (ohneVorzeichen.includes('.')) {
    const punkte = ohneVorzeichen.split('.');
    if (punkte.some((t) => t === '')) return leer;         // `1..2`, `.5.`, `1.`
    if (GRUPPIERT.test(ohneVorzeichen)) {
      ganz = ohneVorzeichen.replaceAll('.', '');
      bruch = '';
    } else if (punkte.length === 2 && (punkte[1] ?? '').length <= 2) {
      ganz = punkte[0] ?? '';
      bruch = punkte[1] ?? '';
      mehrdeutig = true;
      deutung = `${ganz},${bruch} (Punkt als Dezimaltrenner gelesen)`;
    } else {
      return leer;                                          // `1.2.3`, `1.2345`
    }
  } else {
    ganz = ohneVorzeichen;
    bruch = '';
  }

  if (ganz === '') ganz = '0';
  if (!/^\d*$/u.test(ganz) || !/^\d*$/u.test(bruch)) return leer;
  if (bruch.length > 3) return leer;

  const tausendstel = BigInt(ganz) * 1000n + BigInt(bruch.padEnd(3, '0') || '0');
  return { wert: negativ ? -tausendstel : tausendstel, mehrdeutig, deutung };
}

/** Nur der Wert — fuer Aufrufer, denen die Mehrdeutigkeit gleichgueltig ist. */
export function deutscheZahl(roh: string): bigint | null {
  return leseZahl(roh).wert;
}

/** `12_500n` → `"12.500"` — die Form, die `numeric(12,3)` erwartet. */
export function alsNumerisch(tausendstel: bigint): string {
  const negativ = tausendstel < 0n;
  const abs = negativ ? -tausendstel : tausendstel;
  const ganz = abs / 1000n;
  const rest = (abs % 1000n).toString().padStart(3, '0');
  return `${negativ ? '-' : ''}${ganz.toString()}.${rest}`;
}
