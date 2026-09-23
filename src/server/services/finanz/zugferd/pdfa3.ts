import 'server-only';
import { maskiere } from '../xrechnung/xml.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AFRelationship, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString,
  type PDFImage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { RechnungVollstaendig } from '../kanonisch.js';
import { CII_DATEINAME, baueCii } from './cii.js';
import { PROFIL_BESCHREIBUNG, sRgbProfil } from './icc.js';
import { istCmykJpeg } from '../../../storage/raster.js';
import { blattInhalt } from './blatt-inhalt.js';
import { zeichneBlatt, type Schriften } from './blatt.js';

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

/*
 * Wie das Blatt aussieht — Seite, Rand, Farben, Masse, Spalten, Umbruch —
 * steht in `blatt.ts`, was darauf steht in `blatt-inhalt.ts` (V-134). Diese
 * Datei macht daraus ein PDF/A-3: Schriften, XMP, Ausgabeprofil, Anhang.
 */

const SCHRIFTEN = join(process.cwd(), 'assets', 'pdf');

export class PdfFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'PdfFehler';
  }
}

/**
 * Das festgeschriebene Logo ist nicht zu haben oder nicht dasselbe (V-132).
 *
 * Eigene Klasse, weil die Antwort eine andere ist als bei einer fehlenden
 * Schrift: das ist kein Defekt des Servers, sondern ein Zustand des
 * Speichers, und der Satz sagt, welcher.
 */
export class RechnungslogoFehler extends PdfFehler {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'RechnungslogoFehler';
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
  /**
   * Die Bytes des Logos, das die Nutzlast nennt (`r.leistender.logo`, V-132) —
   * geholt vom Aufrufer, geprüft HIER.
   *
   * Das Blatt entsteht nur mit genau dem Bild, dessen Prüfsumme in der
   * Hashkette steht. Fehlen die Bytes oder weichen sie ab, entsteht KEIN
   * Blatt: eine Rechnung, die heute ohne Logo und morgen mit Logo aus
   * demselben Snapshot kommt, wären zwei Dokumente zu einer Nummer — genau
   * das, wogegen der Snapshot gebaut ist (K-12).
   */
  readonly logo?: Uint8Array;
}

/** Das Logo der Nutzlast, geprüft und eingebettet — oder `null`, wenn sie keines nennt. */
async function bettetLogoEin(
  doc: PDFDocument, r: RechnungVollstaendig, bytes: Uint8Array | undefined,
): Promise<PDFImage | null> {
  const logo = r.leistender.logo;
  if (logo === null) {
    if (bytes !== undefined) {
      throw new RechnungslogoFehler(
        'Logo-Bytes übergeben, aber die Nutzlast nennt kein Logo. Das Blatt zeigt nur, '
        + 'was festgeschrieben wurde.');
    }
    return null;
  }
  if (bytes === undefined) {
    throw new RechnungslogoFehler(
      `Diese Rechnung wurde mit Logo festgeschrieben (${logo.schluessel}), die Bytes `
      + 'fehlen. Ohne sie entstünde ein anderes Blatt als das festgeschriebene.');
  }
  const summe = createHash('sha256').update(bytes).digest('hex');
  if (summe !== logo.sha256) {
    throw new RechnungslogoFehler(
      `Das Logo im Speicher ist nicht das festgeschriebene (SHA-256 ${summe}, `
      + `erwartet ${logo.sha256}). Das Blatt entsteht nicht.`);
  }
  if (logo.mime === 'image/png') return doc.embedPng(bytes);
  if (istCmykJpeg(bytes)) {
    throw new RechnungslogoFehler(
      'Das Logo ist ein CMYK-JPEG. Ein PDF/A-3 mit sRGB-Profil darf kein DeviceCMYK '
      + 'enthalten (ISO 19005-3, 6.2.4.3); die Rechnung wäre mit diesem Logo kein PDF/A.');
  }
  return doc.embedJpg(bytes);
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

  const z: Schriften = {
    normal: await doc.embedFont(schrift('NotoSans-Regular.ttf'), { subset: true }),
    fett: await doc.embedFont(schrift('NotoSans-Bold.ttf'), { subset: true }),
  };

  const logo = await bettetLogoEin(doc, r, optionen.logo);
  zeichneBlatt(doc, blattInhalt(r), z, logo);

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
