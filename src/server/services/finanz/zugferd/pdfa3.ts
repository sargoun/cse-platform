import 'server-only';
import { maskiere } from '../xrechnung/xml.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AFRelationship, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString,
  rgb, type PDFFont, type PDFPage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { RechnungVollstaendig } from '../kanonisch.js';
import { formatiereGeld } from '../geld.js';
import { CII_DATEINAME, baueCii } from './cii.js';
import { PROFIL_BESCHREIBUNG, sRgbProfil } from './icc.js';

/**
 * ZUGFeRD 2.x — die Rechnung als PDF/A-3 mit eingebetteter CII (FIN-12, PR 53).
 *
 * **Ein Dokument, zwei Leser.** Wer es ansieht, sieht eine Rechnung nach
 * DESIGN §11: weisses Blatt, dunkler Text, A4 mit 20 mm Rand. Wer es einliest,
 * findet `factur-x.xml` — dieselbe Rechnung als CII, Cent für Cent. Das ist
 * der ganze Zweck von ZUGFeRD: der Empfänger entscheidet, welchen der beiden
 * Wege er nimmt, und beide führen zur selben Zahl.
 *
 * **Warum PDF/A-3 und nicht „ein PDF mit Anhang".** §14b UStG und die GoBD
 * verlangen zehn Jahre Lesbarkeit. PDF/A ist die Zusage, dass das Dokument
 * sich selbst genügt: Schriften eingebettet, Farben über ein eingebettetes
 * Profil definiert, keine Verweise nach draussen. Ein gewöhnliches PDF, das
 * auf eine Systemschrift zeigt, sieht in zehn Jahren anders aus — oder gar
 * nicht.
 *
 * **Die drei Dinge, die ein PDF/A-3 zusätzlich braucht**, und die keine
 * PDF-Bibliothek von allein setzt:
 *
 *  1. `/Metadata` — ein XMP-Paket, das `pdfaid:part=3` sagt UND die
 *     ZUGFeRD-Erweiterung nennt, sonst findet der Leser die XML nicht.
 *  2. `/OutputIntents` mit eingebettetem ICC-Profil (`icc.ts`).
 *  3. `/AF` am Katalog auf die eingebettete Datei, mit
 *     `AFRelationship = /Alternative` — die XML ist eine ANDERE Darstellung
 *     derselben Rechnung, kein Anhang und keine Quelle.
 *
 * **Geprüft wird von veraPDF**, nicht von diesem Modul: `pnpm test:compliance`
 * lässt den Prüfer über das erzeugte Dokument laufen. Ein Bauer, der seine
 * eigene Konformität behauptet, behauptet sie auch dann, wenn sie fehlt.
 */

/** A4 in PDF-Punkten (72 dpi) und der Rand aus DESIGN §11 (20 mm). */
const SEITE = { breite: 595.28, hoehe: 841.89 } as const;
const RAND = 56.69;
const SATZ = 10;      // DESIGN §11: 10pt Grundschrift
const ZEILE = 14;

/** DESIGN §11 — die Druckfarben, und keine Bildschirmfarbe darf hier hinein. */
const PAPIER = rgb(1, 1, 1);
const TINTE = rgb(0x11 / 255, 0x11 / 255, 0x11 / 255);
const GRAU = rgb(0x55 / 255, 0x55 / 255, 0x55 / 255);
const ROT = rgb(0xe3 / 255, 0x06 / 255, 0x13 / 255);

const SCHRIFTEN = join(process.cwd(), 'assets', 'pdf');

export class PdfFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'PdfFehler';
  }
}

/**
 * Die Schriftdateien — gelesen, nicht gebündelt.
 *
 * Sie liegen als OFL-lizenzierte Dateien im Repository (`assets/pdf/`). Inter
 * wäre die Hausschrift (DESIGN §2), es gibt sie aber nur als Variable Font,
 * und eine variable Schrift bettet in PDF/A eine Instanz ein, die niemand
 * festgelegt hat. Für ein Dokument mit zehn Jahren Aufbewahrung ist eine
 * statische Schrift die richtige Wahl.
 */
function schrift(datei: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(join(SCHRIFTEN, datei)));
  } catch {
    throw new PdfFehler(
      `Die Schrift ${datei} fehlt unter assets/pdf/. Ohne eingebettete Schrift `
      + 'gibt es kein PDF/A — und ein Dokument, das PDF/A behauptet und keines '
      + 'ist, fällt erst beim Empfänger auf.');
  }
}

interface Zeug {
  readonly normal: PDFFont;
  readonly fett: PDFFont;
}

function zeile(
  seite: PDFPage, text: string, x: number, y: number,
  f: PDFFont, groesse = SATZ, farbe = TINTE,
): void {
  seite.drawText(text, { x, y, size: groesse, font: f, color: farbe });
}

/** Rechtsbündig — für Beträge, wie DESIGN §11 es verlangt. */
function rechts(
  seite: PDFPage, text: string, rechterRand: number, y: number,
  f: PDFFont, groesse = SATZ, farbe = TINTE,
): void {
  const breite = f.widthOfTextAtSize(text, groesse);
  seite.drawText(text, { x: rechterRand - breite, y, size: groesse, font: f, color: farbe });
}

/**
 * Das XMP-Paket.
 *
 * **Die ZUGFeRD-Erweiterung ist kein Beiwerk.** Ein Leser sucht die Datei
 * nicht am Namen, sondern an diesen Feldern: `DocumentFileName`,
 * `DocumentType`, `Version` und `ConformanceLevel`. Fehlen sie, ist das
 * Dokument ein PDF mit einem Anhang — und der Empfänger bucht von Hand.
 *
 * Das Paket wird UNKOMPRIMIERT eingebettet (PDF/A verlangt das für
 * `/Metadata`) und trägt die Anweisungen `begin`/`end`, an denen ein
 * Werkzeug es auch ohne PDF-Parser findet.
 */
function xmp(r: RechnungVollstaendig, erzeugtAm: string): string {
  /*
   * **Maskiert, bevor es in die Zeichenkette geht** — mit demselben Maskierer
   * wie die XRechnung (`xrechnung/xml.ts`). Ein Firmenname wie
   * „Müller & Söhne" oder eine Rechnungsnummer mit `<` machte den XMP-Block
   * sonst nicht wohlgeformt: das PDF sieht heil aus, veraPDF weist es ab, und
   * der Empfaenger bekommt eine Rechnung, die sein System nicht liest.
   */
  const titel = maskiere(`Rechnung ${r.nummer}`, 'xmp/dc:title');
  const ersteller = maskiere(r.leistender.name, 'xmp/dc:creator');
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${titel}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${ersteller}</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>${erzeugtAm}</xmp:CreateDate>
   <xmp:ModifyDate>${erzeugtAm}</xmp:ModifyDate>
   <xmp:CreatorTool>CSE Platform</xmp:CreatorTool>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>CSE Platform</pdf:Producer>
  </rdf:Description>
  <rdf:Description rdf:about=""
    xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
    xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
    xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>Name des eingebetteten XML-Dokuments</pdfaProperty:description>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>DocumentType</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>INVOICE</pdfaProperty:description>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>Version</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>Version des Standards</pdfaProperty:description>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>Profil des Standards</pdfaProperty:description>
        </rdf:li>
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>
  <rdf:Description rdf:about=""
    xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentFileName>${CII_DATEINAME}</fx:DocumentFileName>
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Der Kopf: Absender, Empfänger, die roten Linie und die Eckdaten. */
function zeichneKopf(seite: PDFPage, r: RechnungVollstaendig, z: Zeug): number {
  let y = SEITE.hoehe - RAND;

  zeile(seite, r.leistender.name, RAND, y, z.fett, 14);
  y -= 6;
  seite.drawLine({
    start: { x: RAND, y }, end: { x: SEITE.breite - RAND, y },
    thickness: 2, color: ROT,
  });

  y -= ZEILE * 1.5;
  for (const t of [
    r.leistender.anschrift.strasse, 
    `${r.leistender.anschrift.plz ?? ''} ${r.leistender.anschrift.ort ?? ''}`.trim(),
  ]) {
    if (t !== null && t !== '') { zeile(seite, t, RAND, y, z.normal, 8, GRAU); y -= 10; }
  }

  y -= ZEILE;
  zeile(seite, r.empfaenger.name, RAND, y, z.fett); y -= ZEILE;
  for (const t of [
    r.empfaenger.anschrift.strasse,
    `${r.empfaenger.anschrift.plz ?? ''} ${r.empfaenger.anschrift.ort ?? ''}`.trim(),
  ]) {
    if (t !== null && t !== '') { zeile(seite, t, RAND, y, z.normal); y -= ZEILE; }
  }

  const rechterRand = SEITE.breite - RAND;
  let yr = SEITE.hoehe - RAND - ZEILE * 3;
  for (const [k, v] of [
    ['Rechnungsnummer', r.nummer],
    ['Rechnungsdatum', r.rechnungsdatum],
    ['Leistungszeitraum', r.leistungVon === null ? '—'
      : `${r.leistungVon} – ${r.leistungBis ?? r.leistungVon}`],
    ['Fällig am', r.zahlung.faelligAm ?? '—'],
  ] as const) {
    zeile(seite, k, rechterRand - 200, yr, z.normal, 8, GRAU);
    rechts(seite, v, rechterRand, yr, z.normal, 9);
    yr -= 12;
  }

  y -= ZEILE * 2;
  zeile(seite, `Rechnung ${r.nummer}`, RAND, y, z.fett, 16);
  return y - ZEILE * 2;
}

/** Die Positionen — Bezeichnung, Menge, Einzelpreis, Betrag. */
function zeichnePositionen(
  seite: PDFPage, r: RechnungVollstaendig, z: Zeug, start: number,
): number {
  const rechterRand = SEITE.breite - RAND;
  let y = start;

  zeile(seite, 'Leistung', RAND, y, z.fett, 9);
  rechts(seite, 'Menge', RAND + 330, y, z.fett, 9);
  rechts(seite, 'Einzelpreis', RAND + 410, y, z.fett, 9);
  rechts(seite, 'Betrag', rechterRand, y, z.fett, 9);
  y -= 6;
  seite.drawLine({
    start: { x: RAND, y }, end: { x: rechterRand, y }, thickness: 0.5, color: GRAU,
  });
  y -= ZEILE;

  for (const p of r.positionen.filter((x) => x.art === 'leistung')) {
    zeile(seite, p.bezeichnung.slice(0, 60), RAND, y, z.normal);
    rechts(seite, `${(Number(p.menge) / 1000).toFixed(3)} ${p.einheit ?? ''}`.trim(),
      RAND + 330, y, z.normal, 9);
    rechts(seite, p.einzelpreisCent === null ? '—' : formatiereGeld(p.einzelpreisCent),
      RAND + 410, y, z.normal, 9);
    rechts(seite, p.nettoCent === null ? '—' : formatiereGeld(p.nettoCent),
      rechterRand, y, z.normal);
    y -= ZEILE;
  }
  return y - ZEILE;
}

/** Die Summen — und die Zahlungsangaben darunter. */
function zeichneSummen(
  seite: PDFPage, r: RechnungVollstaendig, z: Zeug, start: number,
): void {
  const rechterRand = SEITE.breite - RAND;
  let y = start;
  seite.drawLine({
    start: { x: RAND + 300, y: y + 8 }, end: { x: rechterRand, y: y + 8 },
    thickness: 0.5, color: GRAU,
  });

  zeile(seite, 'Nettobetrag', RAND + 300, y, z.normal, 9, GRAU);
  rechts(seite, formatiereGeld(r.nettoGesamtCent), rechterRand, y, z.normal);
  y -= ZEILE;

  for (const s of r.steuerzeilen) {
    zeile(seite, `Umsatzsteuer ${(s.satzBp / 100).toFixed(0)} %`,
      RAND + 300, y, z.normal, 9, GRAU);
    rechts(seite, formatiereGeld(s.steuerCent), rechterRand, y, z.normal);
    y -= ZEILE;
  }

  seite.drawLine({
    start: { x: RAND + 300, y: y + 8 }, end: { x: rechterRand, y: y + 8 },
    thickness: 1, color: TINTE,
  });
  zeile(seite, 'Gesamtbetrag', RAND + 300, y, z.fett);
  rechts(seite, formatiereGeld(r.bruttoCent), rechterRand, y, z.fett);
  y -= ZEILE * 2;

  if (r.zahlung.zahlungsbedingungText !== null) {
    zeile(seite, r.zahlung.zahlungsbedingungText, RAND, y, z.normal, 9); y -= ZEILE;
  }
  if (r.zahlung.bankkonto !== null) {
    zeile(seite, `IBAN ${r.zahlung.bankkonto.iban}`
      + (r.zahlung.bankkonto.bic === null ? '' : ` · BIC ${r.zahlung.bankkonto.bic}`),
    RAND, y, z.normal, 9); y -= ZEILE;
  }
}

/**
 * Der feste Fussbereich (DESIGN §11): Gesellschaft, Registergericht, HRB,
 * Geschäftsführung — und die Steuernummern, die §14 UStG verlangt.
 */
function zeichneFuss(seite: PDFPage, r: RechnungVollstaendig, z: Zeug): void {
  const zeilen = [
    [r.leistender.name, r.leistender.gericht, r.leistender.hrb]
      .filter((t): t is string => t !== null && t !== '').join(' · '),
    [r.leistender.geschaeftsfuehrer === null ? null
      : `Geschäftsführung: ${r.leistender.geschaeftsfuehrer}`,
    r.leistender.ustid === null ? null : `USt-IdNr. ${r.leistender.ustid}`,
    r.leistender.steuernummer === null ? null : `Steuernummer ${r.leistender.steuernummer}`]
      .filter((t): t is string => t !== null).join(' · '),
    /**
     * **Die stehende Fusszeile der Gesellschaft** (V-099, K-12).
     *
     * Sie kommt aus dem SNAPSHOT (`r.leistender.fusszeile`) und nicht aus
     * `mandant_identitaet` — dieselbe Regel wie fuer jede andere Angabe auf
     * diesem Blatt. Wer sie ein Jahr spaeter pflegt, aendert damit nicht,
     * was auf einer festgeschriebenen Rechnung steht.
     *
     * Eine v2-Rechnung traegt sie nicht; dann faellt die Zeile weg.
     * Mehrzeilige Fusszeilen werden in ihre Zeilen zerlegt, damit sie nicht
     * als ein langer Strich ueber den Rand laufen.
     */
    ...(r.leistender.fusszeile ?? '').split('\n').map((t) => t.trim()),
  ];
  let y = RAND;
  for (const t of [...zeilen].reverse()) {
    if (t !== '') { zeile(seite, t, RAND, y, z.normal, 7, GRAU); y += 9; }
  }
}

export interface PdfOptionen {
  /**
   * Der Zeitstempel im Dokument — HEREINGEREICHT (Invariante 5, K-11).
   *
   * Ein PDF, das `new Date()` liest, ist bei jedem Aufruf ein anderes: der
   * Hash über die Datei ändert sich, und damit lässt sich nicht mehr zeigen,
   * dass zweimal dasselbe erzeugt wurde. Für einen Beleg mit zehn Jahren
   * Aufbewahrung ist das der Unterschied zwischen „reproduzierbar" und
   * „irgendwann einmal erzeugt".
   */
  readonly erzeugtAm: Date;
}

/**
 * Die Rechnung als PDF/A-3 mit eingebetteter CII — oder gar nichts.
 *
 * @throws XRechnungUnvollstaendigFehler (aus `baueCii`) wenn eine Pflichtangabe
 *   fehlt. Das Papier entsteht dann NICHT: ein PDF ohne die XML wäre ein
 *   ZUGFeRD-Dokument, das keines ist.
 */
export async function baueZugferdPdf(
  r: RechnungVollstaendig, optionen: PdfOptionen,
): Promise<Uint8Array> {
  /* Zuerst die XML — scheitert sie, entsteht kein Blatt Papier. */
  const cii = baueCii(r);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const z: Zeug = {
    normal: await doc.embedFont(schrift('NotoSans-Regular.ttf'), { subset: true }),
    fett: await doc.embedFont(schrift('NotoSans-Bold.ttf'), { subset: true }),
  };

  const seite = doc.addPage([SEITE.breite, SEITE.hoehe]);
  seite.drawRectangle({
    x: 0, y: 0, width: SEITE.breite, height: SEITE.hoehe, color: PAPIER,
  });
  const nachKopf = zeichneKopf(seite, r, z);
  const nachPositionen = zeichnePositionen(seite, r, z, nachKopf);
  zeichneSummen(seite, r, z, nachPositionen);
  zeichneFuss(seite, r, z);

  /* --- Die eingebettete Rechnung (AFRelationship /Alternative) --- */
  await doc.attach(new TextEncoder().encode(cii), CII_DATEINAME, {
    mimeType: 'text/xml',
    description: 'Rechnung als CII nach EN 16931 (ZUGFeRD 2.x)',
    creationDate: optionen.erzeugtAm,
    modificationDate: optionen.erzeugtAm,
    afRelationship: AFRelationship.Alternative,
  });

  /* --- Dokumentangaben; sie müssen zum XMP passen --- */
  doc.setTitle(`Rechnung ${r.nummer}`);
  doc.setAuthor(r.leistender.name);
  doc.setProducer('CSE Platform');
  doc.setCreator('CSE Platform');
  doc.setCreationDate(optionen.erzeugtAm);
  doc.setModificationDate(optionen.erzeugtAm);

  /* --- /Metadata: das XMP-Paket, unkomprimiert --- */
  const stempel = optionen.erzeugtAm.toISOString().replace(/\.\d{3}Z$/u, 'Z');
  const xmpStrom = PDFRawStream.of(
    doc.context.obj({ Type: 'Metadata', Subtype: 'XML' }),
    new TextEncoder().encode(xmp(r, stempel)),
  );
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmpStrom));

  /* --- /OutputIntents mit eingebettetem Profil --- */
  const profil = sRgbProfil(optionen.erzeugtAm);
  const iccStrom = PDFRawStream.of(doc.context.obj({ N: 3 }), profil);
  const iccRef = doc.context.register(iccStrom);
  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([{
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB'),
    Info: PDFString.of(PROFIL_BESCHREIBUNG),
    DestOutputProfile: iccRef,
  }]));

  /*
   * Die Datei-Kennung im Trailer. PDF/A verlangt sie, und sie ist der einzige
   * Wert hier, der aus dem INHALT kommen muss statt aus dem Zufall: zwei
   * Läufe über dieselbe Rechnung ergeben sonst zwei Dokumente, die sich nur
   * in dieser Zeile unterscheiden.
   */
  const kennung = PDFHexString.of(
    [...`${r.nummer}:${r.festgeschriebenAm}`]
      .reduce((h, zch) => (h * 31 + zch.charCodeAt(0)) >>> 0, 7)
      .toString(16).padStart(8, '0').repeat(4).slice(0, 32).toUpperCase(),
  );
  doc.context.trailerInfo.ID = doc.context.obj([kennung, kennung]);

  return doc.save({ useObjectStreams: false });
}
