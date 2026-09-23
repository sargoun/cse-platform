import {
  popGraphicsState, pushGraphicsState, rgb, setCharacterSpacing,
  type PDFDocument, type PDFFont, type PDFImage, type PDFPage, type RGB,
} from 'pdf-lib';
import { FARBEN_DRUCK, FARBEN_MARKE, MASSE_DRUCK } from '../../../../lib/design/theme.js';
import type { BlattInhalt, BlattPosition, SummenZeile } from './blatt-inhalt.js';

/**
 * **Das Rechnungsblatt, gezeichnet** (V-134, DESIGN §11) — was darauf steht,
 * entscheidet `blatt-inhalt.ts`; hier wird nur gesetzt.
 *
 * **Mehrseitig.** Eine Bauschlussrechnung mit sechzig Aufmasszeilen passt
 * auf keine Seite, und die alte Fassung zeichnete einfach weiter — unter den
 * Fuss und über den Blattrand. Jetzt bricht jede Zeile um, bevor sie den Fuss
 * erreicht; der Tabellenkopf steht auf jeder Folgeseite wieder, der feste
 * Fuss (DESIGN §11) auf jeder Seite, mit „Seite x von y".
 *
 * **Jeder Wert aus DESIGN §11** — Papier, Text, leiser Text, Linien, Masse
 * der Tabelle —, gelesen aus `lib/design/theme.ts`, das DESIGN.md spiegelt.
 * Die alte Fassung trug ein eigenes Grau (`#555`) und 7-pt-Fusszeilen; beides
 * steht nirgends in DESIGN.md.
 */

/** A4 in PDF-Punkten (72 dpi) und der Rand aus DESIGN §11 (20 mm). */
const SEITE = { breite: 595.28, hoehe: 841.89 } as const;
const RAND = 56.69;
const RECHTS = SEITE.breite - RAND;
const OBEN = SEITE.hoehe - RAND;

/** `"6pt"` → `6` — die Masse stehen in DESIGN.md mit Einheit. */
const pt = (wert: string): number => Number.parseFloat(wert);
const SATZ = 10;                                       // DESIGN §11: 10pt Grundschrift
const SATZ_ZEILE = 13;
const META = pt(MASSE_DRUCK['druck-meta-groesse']);    // 9pt
const META_ZEILE = 11;
const KOPF = pt(MASSE_DRUCK['druck-kopf-groesse']);    // 8pt
const KOPF_SPERRUNG = pt(MASSE_DRUCK['druck-kopf-sperrung']) * KOPF; // 0.08em
const BLOCK = pt(MASSE_DRUCK['druck-block']);          // 12pt
const ZELLE_Y = pt(MASSE_DRUCK['druck-zelle-y']);      // 6pt
const ZELLE_X = pt(MASSE_DRUCK['druck-zelle-x']);      // 4pt

function farbe(hex: string): RGB {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}
const PAPIER = farbe(FARBEN_DRUCK['druck-papier']);
const TINTE = farbe(FARBEN_DRUCK['druck-text']);
const LEISE = farbe(FARBEN_DRUCK['druck-text-leise']);
const LINIE = farbe(FARBEN_DRUCK['druck-linie']);
const LINIE_LEICHT = farbe(FARBEN_DRUCK['druck-linie-leicht']);
/** Die Kopflinie — die eine Stelle, an der CSE-Rot auf Papier steht (DESIGN §11). */
const ROT = farbe(FARBEN_MARKE.red);

/**
 * Das Logo im Briefkopf (V-132): Höhe `marke-xl` aus DESIGN §4 — 56 CSS-Pixel,
 * dieselbe Höhe wie im Kopf des Angebotsblatts. Ein CSS-Pixel ist 0,75 pt
 * (CSS 2.1, 96 px = 72 pt), also 42 pt. Die Breite folgt der Datei und ist
 * höchstens der Satzspiegel (`max-w-full` im `MarkenLogo`).
 */
const LOGO_HOEHE = 56 * 0.75;

/**
 * Die Spalten der Positionstabelle, als rechte Kanten (Zahlen stehen
 * rechtsbündig, DESIGN §11) — die Leistung bekommt, was übrig bleibt.
 */
const SPALTE = {
  nr: RAND,
  leistung: RAND + 26,
  mengeRechts: RECHTS - 194,
  preisRechts: RECHTS - 120,
  ustRechts: RECHTS - 80,
  betragRechts: RECHTS,
} as const;
const LEISTUNG_BREITE = SPALTE.mengeRechts - 70 - ZELLE_X * 2 - SPALTE.leistung;

export interface Schriften {
  readonly normal: PDFFont;
  readonly fett: PDFFont;
}

/**
 * Nur Zeichen, die die eingebettete Schrift hat.
 *
 * Ein Zeichen ausserhalb (ein Name in einer Schrift, die Noto Sans nicht
 * führt) würde als `.notdef` gezeichnet — und ein Verweis auf `.notdef` macht
 * das Dokument zu einem, das PDF/A-3 nicht mehr ist (ISO 19005-3, 6.2.11.8).
 * Es wird `?`. Die eingebettete XML trägt den Namen unverändert; sie ist bei
 * einer E-Rechnung ohnehin das Massgebliche.
 */
function druckbar(text: string, f: PDFFont): string {
  const vorrat = zeichenvorrat(f);
  let aus = '';
  for (const zeichen of text.replace(/[\u0000-\u001f\u007f]/gu, ' ')) {
    aus += vorrat.has(zeichen.codePointAt(0) ?? 0) ? zeichen : '?';
  }
  return aus;
}

const VORRAT = new WeakMap<PDFFont, ReadonlySet<number>>();
function zeichenvorrat(f: PDFFont): ReadonlySet<number> {
  let v = VORRAT.get(f);
  if (v === undefined) {
    v = new Set(f.getCharacterSet());
    VORRAT.set(f, v);
  }
  return v;
}

/**
 * Ein Text in Zeilen, die in `breite` passen. Absätze (`\n`) bleiben
 * Absätze; ein Wort, das allein zu breit ist, wird zeichenweise getrennt,
 * statt über den Rand zu laufen.
 */
export function umbrechen(text: string, f: PDFFont, groesse: number, breite: number): string[] {
  const zeilen: string[] = [];
  for (const absatz of text.split(/\r?\n/u)) {
    let aktuell = '';
    for (const wort of absatz.split(/\s+/u).filter((w) => w !== '')) {
      const probe = aktuell === '' ? wort : `${aktuell} ${wort}`;
      if (f.widthOfTextAtSize(druckbar(probe, f), groesse) <= breite) {
        aktuell = probe;
        continue;
      }
      if (aktuell !== '') zeilen.push(aktuell);
      aktuell = '';
      let rest = wort;
      while (f.widthOfTextAtSize(druckbar(rest, f), groesse) > breite && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && f.widthOfTextAtSize(druckbar(rest.slice(0, n), f), groesse) > breite) n -= 1;
        zeilen.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      aktuell = rest;
    }
    zeilen.push(aktuell);
  }
  /* Leere Absätze am Ende tragen nichts. */
  while (zeilen.length > 1 && zeilen[zeilen.length - 1] === '') zeilen.pop();
  return zeilen;
}

class Blatt {
  readonly seiten: PDFPage[] = [];
  seite!: PDFPage;
  y = 0;
  /** Der Tabellenkopf wird auf einer Folgeseite wiederholt, solange Positionen laufen. */
  inTabelle = false;

  constructor(
    private readonly doc: PDFDocument,
    private readonly s: Schriften,
    private readonly inhalt: BlattInhalt,
    readonly unten: number,
  ) {}

  text(t: string, x: number, y: number, f: PDFFont, groesse: number, farbe = TINTE): void {
    this.seite.drawText(druckbar(t, f), { x, y, size: groesse, font: f, color: farbe });
  }

  rechts(t: string, rechterRand: number, y: number, f: PDFFont, groesse: number,
    farbe = TINTE): void {
    const d = druckbar(t, f);
    this.seite.drawText(d, {
      x: rechterRand - f.widthOfTextAtSize(d, groesse), y, size: groesse, font: f, color: farbe,
    });
  }

  /** Ein Tabellenkopf: 8 pt, Versalien, 0,08 em gesperrt (DESIGN §11). */
  kopfzelle(t: string, x: number, rechtsbuendig: boolean): void {
    const d = druckbar(t.toUpperCase(), this.s.fett);
    const breite = this.s.fett.widthOfTextAtSize(d, KOPF) + KOPF_SPERRUNG * (d.length - 1);
    this.seite.pushOperators(pushGraphicsState(), setCharacterSpacing(KOPF_SPERRUNG));
    this.seite.drawText(d, {
      x: rechtsbuendig ? x - breite : x, y: this.y, size: KOPF, font: this.s.fett, color: LEISE,
    });
    this.seite.pushOperators(popGraphicsState());
  }

  linie(y: number, von: number, bis: number, dicke: number, farbe: RGB): void {
    this.seite.drawLine({ start: { x: von, y }, end: { x: bis, y }, thickness: dicke, color: farbe });
  }

  neueSeite(): void {
    this.seite = this.doc.addPage([SEITE.breite, SEITE.hoehe]);
    this.seiten.push(this.seite);
    this.seite.drawRectangle({
      x: 0, y: 0, width: SEITE.breite, height: SEITE.hoehe, color: PAPIER,
    });
    this.y = OBEN;
    if (this.seiten.length > 1) {
      this.y -= META;
      this.text(this.inhalt.absenderName, RAND, this.y, this.s.fett, META);
      this.rechts(`${this.inhalt.titel} — Fortsetzung`, RECHTS, this.y, this.s.normal, META, LEISE);
      this.y -= 4;
      this.linie(this.y, RAND, RECHTS, 0.5, LINIE);
      this.y -= BLOCK * 2;
      if (this.inTabelle) this.tabellenkopf();
    }
  }

  /** Reicht der Platz bis zum Fuss nicht, beginnt eine neue Seite. */
  platz(hoehe: number): void {
    if (this.y - hoehe < this.unten) this.neueSeite();
  }

  absatz(t: string | null, f: PDFFont, groesse: number, zeile: number, farbe = TINTE,
    x = RAND, breite = RECHTS - RAND): void {
    if (t === null || t.trim() === '') return;
    for (const z of umbrechen(t, f, groesse, breite)) {
      this.platz(zeile);
      this.text(z, x, this.y, f, groesse, farbe);
      this.y -= zeile;
    }
  }

  /**
   * Mehrere Absätze, die zusammengehören — die Zahlungsangaben: Frist,
   * Skonto, Bankverbindung, Verwendungszweck. Sie werden nicht zwischen zwei
   * Seiten geteilt; wer die IBAN sucht, soll die Frist daneben finden. Nur
   * was allein länger ist als eine Seite, bricht doch um.
   */
  block(texte: readonly string[], f: PDFFont, groesse: number, zeile: number): void {
    const zeilen = texte.flatMap((t) => umbrechen(t, f, groesse, RECHTS - RAND));
    if (zeilen.length * zeile <= OBEN - this.unten - BLOCK * 4) this.platz(zeilen.length * zeile);
    for (const z of zeilen) {
      this.platz(zeile);
      this.text(z, RAND, this.y, f, groesse);
      this.y -= zeile;
    }
  }

  tabellenkopf(): void {
    this.kopfzelle('Pos.', SPALTE.nr, false);
    this.kopfzelle('Leistung', SPALTE.leistung, false);
    this.kopfzelle('Menge', SPALTE.mengeRechts, true);
    this.kopfzelle('Einzelpreis', SPALTE.preisRechts, true);
    this.kopfzelle('USt', SPALTE.ustRechts, true);
    this.kopfzelle('Betrag', SPALTE.betragRechts, true);
    this.y -= ZELLE_Y;
    this.linie(this.y, RAND, RECHTS, 0.5, LINIE);
    this.y -= ZELLE_Y + SATZ;
  }
}

/** Das Logo oben links; zurück kommt die Höhe, die es belegt. */
function zeichneLogo(b: Blatt, bild: PDFImage | null): number {
  if (bild === null) return 0;
  const massstab = Math.min(LOGO_HOEHE / bild.height, (RECHTS - RAND) / bild.width);
  const breite = bild.width * massstab;
  const hoehe = bild.height * massstab;
  b.seite.drawImage(bild, { x: RAND, y: OBEN - hoehe, width: breite, height: hoehe });
  return hoehe + BLOCK;
}

function zeichneKopf(b: Blatt, i: BlattInhalt, s: Schriften, logo: PDFImage | null): void {
  b.y = OBEN - zeichneLogo(b, logo) - 11;   // 11: die Oberlänge der 14-pt-Zeile
  b.text(i.absenderName, RAND, b.y, s.fett, 14);
  b.y -= 6;
  b.linie(b.y, RAND, RECHTS, 2, ROT);
  b.y -= BLOCK + META;
  for (const z of i.absenderZeilen) {
    b.text(z, RAND, b.y, s.normal, META, LEISE);
    b.y -= META_ZEILE;
  }

  /* Empfänger links, Eckdaten rechts — nebeneinander, von derselben Höhe an. */
  const anfang = b.y - BLOCK;
  let links = anfang;
  i.empfaenger.forEach((z, n) => {
    for (const teil of umbrechen(z, n === 0 ? s.fett : s.normal, SATZ, 250)) {
      b.text(teil, RAND, links, n === 0 ? s.fett : s.normal, SATZ);
      links -= SATZ_ZEILE;
    }
  });
  let rechts = anfang;
  for (const [k, v] of i.eckdaten) {
    b.text(k, RECHTS - 200, rechts, s.normal, META, LEISE);
    /* Ein langer Wert (eine Referenz des Kunden) bricht um, statt in die
       Beschriftung zu laufen. */
    for (const teil of umbrechen(v, s.normal, META, 118)) {
      b.rechts(teil, RECHTS, rechts, s.normal, META);
      rechts -= META_ZEILE + 1;
    }
  }
  b.y = Math.min(links, rechts) - BLOCK * 2;

  b.text(i.titel, RAND, b.y, s.fett, 16);
  b.y -= BLOCK * 2;
  if (i.leistungsort !== null) {
    b.absatz(i.leistungsort, s.normal, META, META_ZEILE, LEISE);
    b.y -= BLOCK / 2;
  }
  if (i.kopftext !== null && i.kopftext.trim() !== '') {
    b.absatz(i.kopftext, s.normal, SATZ, SATZ_ZEILE);
    b.y -= BLOCK / 2;
  }
  b.y -= BLOCK / 2;
}

function zeichnePosition(b: Blatt, p: BlattPosition, s: Schriften): void {
  const bezFont = p.art === 'zwischensumme' ? s.fett : s.normal;
  const bezBreite = p.art === 'leistung' ? LEISTUNG_BREITE
    : p.art === 'zwischensumme' ? SPALTE.ustRechts - SPALTE.leistung
      : RECHTS - SPALTE.leistung;
  const bez = umbrechen(p.bezeichnung, bezFont, SATZ, bezBreite);
  const unter = p.unterzeilen.flatMap((u) =>
    umbrechen(u, s.normal, META, RECHTS - SPALTE.leistung));

  /* Die erste Zeile samt Zahlen muss auf die Seite; der Rest darf umbrechen. */
  b.platz(SATZ_ZEILE + ZELLE_Y);
  b.text(p.nr, SPALTE.nr, b.y, s.normal, META, LEISE);
  if (p.menge !== '') b.rechts(p.menge, SPALTE.mengeRechts, b.y, s.normal, META);
  if (p.einzelpreis !== '') b.rechts(p.einzelpreis, SPALTE.preisRechts, b.y, s.normal, META);
  if (p.ust !== '') b.rechts(p.ust, SPALTE.ustRechts, b.y, s.normal, META);
  if (p.betrag !== '') {
    b.rechts(p.betrag, SPALTE.betragRechts, b.y, p.art === 'zwischensumme' ? s.fett : s.normal,
      SATZ);
  }
  /* Der Schritt der zuletzt gesetzten Zeile — an ihm hängt, wo die Trennlinie sitzt. */
  let schritt = SATZ_ZEILE;
  bez.forEach((z, n) => {
    if (n > 0) b.platz(SATZ_ZEILE);
    b.text(z, SPALTE.leistung, b.y, bezFont, SATZ);
    b.y -= SATZ_ZEILE;
  });
  for (const z of unter) {
    b.platz(META_ZEILE);
    b.text(z, SPALTE.leistung, b.y, s.normal, META, LEISE);
    b.y -= META_ZEILE;
    schritt = META_ZEILE;
  }
  /*
   * Die Trennlinie (`--druck-linie-leicht`) sitzt `--druck-zelle-y` unter der
   * Unterlänge der letzten Zeile, die nächste Grundlinie `--druck-zelle-y`
   * plus eine Oberlänge darunter.
   */
  const trenn = b.y + schritt - 3 - ZELLE_Y;
  b.linie(trenn, RAND, RECHTS, 0.5, LINIE_LEICHT);
  b.y = trenn - ZELLE_Y - 8;
}

/** Die Summen rechts — als EIN Block: er wird nicht zwischen zwei Seiten geteilt. */
function zeichneSummen(b: Blatt, zeilen: readonly SummenZeile[], s: Schriften): void {
  const links = RECHTS - 300;
  const textBreite = 300 - 90;
  const gesetzt = zeilen.map((z) => ({
    ...z, teile: umbrechen(z.text, z.fett ? s.fett : s.normal, META, textBreite),
  }));
  const hoehe = gesetzt.reduce((h, z) => h + z.teile.length * META_ZEILE + 5, BLOCK);
  b.platz(hoehe);
  b.y -= 2;
  b.linie(b.y + SATZ, links, RECHTS, 0.5, LINIE);
  for (const z of gesetzt) {
    if (z.fett) b.linie(b.y + SATZ, links, RECHTS, 0.75, TINTE);
    z.teile.forEach((t, n) => {
      b.text(t, links, b.y, z.fett ? s.fett : s.normal, META, z.fett ? TINTE : LEISE);
      if (n === 0 && z.betrag !== '') {
        b.rechts(z.betrag, RECHTS, b.y, z.fett ? s.fett : s.normal, SATZ);
      }
      b.y -= META_ZEILE;
    });
    b.y -= 5;
  }
  b.y -= BLOCK;
}

/** Der feste Fuss auf jeder Seite, und „Seite x von y" darüber. */
function zeichneFuesse(b: Blatt, zeilen: readonly string[], s: Schriften): void {
  b.seiten.forEach((seite, n) => {
    b.seite = seite;
    let y = RAND;
    for (const z of [...zeilen].reverse()) {
      b.text(z, RAND, y, s.normal, META, LEISE);
      y += META_ZEILE;
    }
    b.linie(y - 1, RAND, RECHTS, 0.5, LINIE);
    b.rechts(`Seite ${String(n + 1)} von ${String(b.seiten.length)}`, RECHTS, y + 3,
      s.normal, KOPF, LEISE);
  });
}

export function zeichneBlatt(
  doc: PDFDocument, i: BlattInhalt, s: Schriften, logo: PDFImage | null,
): number {
  const fuss = i.fuss.flatMap((z) => umbrechen(z, s.normal, META, RECHTS - RAND));
  /* Bis hierher darf Inhalt reichen: Fusszeilen, die Linie, „Seite x von y", ein Block. */
  const unten = RAND + fuss.length * META_ZEILE + KOPF + BLOCK * 2;
  const b = new Blatt(doc, s, i, unten);
  b.neueSeite();
  zeichneKopf(b, i, s, logo);

  b.inTabelle = true;
  b.platz(SATZ * 4);
  b.tabellenkopf();
  for (const p of i.positionen) zeichnePosition(b, p, s);
  b.inTabelle = false;
  b.y -= BLOCK;

  zeichneSummen(b, i.summen, s);
  for (const h of i.summenHinweise) b.absatz(h, s.normal, META, META_ZEILE, LEISE);
  if (i.summenHinweise.length > 0) b.y -= BLOCK;

  if (i.steuerhinweis !== null && i.steuerhinweis.trim() !== '') {
    b.absatz(i.steuerhinweis, s.fett, SATZ, SATZ_ZEILE);
    b.y -= BLOCK / 2;
  }
  for (const h of i.hinweise) b.absatz(h, s.normal, META, META_ZEILE);
  if (i.hinweise.length > 0) b.y -= BLOCK / 2;
  if (i.fusstext !== null && i.fusstext.trim() !== '') {
    b.absatz(i.fusstext, s.normal, SATZ, SATZ_ZEILE);
    b.y -= BLOCK / 2;
  }
  b.block(i.zahlung, s.normal, META, META_ZEILE);

  zeichneFuesse(b, fuss, s);
  return b.seiten.length;
}
