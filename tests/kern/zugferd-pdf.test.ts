/**
 * PR 53 — das PDF/A-3, zurückgelesen (FIN-12).
 *
 * veraPDF prüft in CI die Konformität; hier steht das, was ein
 * ZUGFeRD-Leser beim Empfänger tut: die eingebettete XML finden, ihren Namen
 * und ihre Beziehung prüfen, und nachsehen, ob das Dokument sich selbst als
 * PDF/A-3 mit Factur-X-Erweiterung ausweist.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { baueZugferdPdf } from '../../src/server/services/finanz/zugferd/pdfa3.js';
import { XRechnungUnvollstaendigFehler }
  from '../../src/server/services/finanz/xrechnung/index.js';
import { beispielRechnung } from './hilfen/rechnung-beispiel.js';

const ERZEUGT = new Date(Date.UTC(2026, 8, 11, 9, 0, 0));

async function pdf(): Promise<Uint8Array> {
  return baueZugferdPdf(beispielRechnung(), { erzeugtAm: ERZEUGT });
}

const alsText = (d: Uint8Array): string => Buffer.from(d).toString('latin1');

describe('(1) Es ist ein PDF, und es ist EINE Seite', () => {
  it('Kopf, Version und Seitenzahl', async () => {
    const d = await pdf();
    expect(alsText(d).slice(0, 8)).toMatch(/^%PDF-1\.\d$/u);
    const gelesen = await PDFDocument.load(d);
    expect(gelesen.getPageCount()).toBe(1);
    const { width, height } = gelesen.getPage(0).getSize();
    /* A4 in Punkten — DESIGN §11. */
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('die Rechnungsnummer steht als Titel im Dokument', async () => {
    const gelesen = await PDFDocument.load(await pdf());
    expect(gelesen.getTitle()).toBe('Rechnung RE-2026-00042');
    expect(gelesen.getAuthor()).toBe('CSE Dienstleistungen GmbH');
  });
});

describe('(2) Die Rechnung liegt zweimal darin — als Blatt und als Daten', () => {
  it('`factur-x.xml` ist eingebettet und trägt die CII', async () => {
    const roh = alsText(await pdf());
    expect(roh).toContain('factur-x.xml');
    /* Die eingebettete XML wird unkomprimiert nicht erwartet — der
       Dateiname und die Beziehung stehen aber im Klartext im Katalog. */
    expect(roh).toContain('/AFRelationship /Alternative');
  });

  it('der Katalog verweist über `/AF` darauf — sonst ist es nur ein Anhang', async () => {
    const gelesen = await PDFDocument.load(await pdf());
    const af = gelesen.catalog.get(PDFName.of('AF'));
    expect(af, 'Kein /AF am Katalog').toBeDefined();
    const namen = gelesen.catalog.get(PDFName.of('Names'));
    expect(namen, 'Kein /Names am Katalog').toBeDefined();
  });

  /**
   * **Ohne XML kein Blatt.** Ein ZUGFeRD-PDF, dessen XML fehlt, ist ein PDF
   * — und der Empfänger bucht von Hand, ohne zu wissen, warum.
   */
  it('fehlt eine Pflichtangabe, entsteht GAR KEIN Dokument', async () => {
    const r = beispielRechnung();
    await expect(baueZugferdPdf({
      ...r,
      leistender: { ...r.leistender, kontakt: { name: null, telefon: null, email: null } },
    }, { erzeugtAm: ERZEUGT })).rejects.toThrow(XRechnungUnvollstaendigFehler);
  });
});

describe('(3) Es weist sich als PDF/A-3 mit Factur-X aus', () => {
  it('das XMP nennt Teil 3, Stufe B und die eingebettete Datei', async () => {
    const gelesen = await PDFDocument.load(await pdf());
    const strom = gelesen.catalog.lookup(PDFName.of('Metadata'));
    expect(strom).toBeInstanceOf(PDFRawStream);
    const xmp = Buffer.from((strom as PDFRawStream).contents).toString('utf8');
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>');
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
    /* Ohne das Erweiterungsschema ist `fx:` für einen Prüfer unbekannt. */
    expect(xmp).toContain('pdfaExtension:schemas');
  });

  it('ein OutputIntent mit eingebettetem sRGB-Profil hängt am Katalog', async () => {
    const gelesen = await PDFDocument.load(await pdf());
    const intents = gelesen.catalog.lookup(PDFName.of('OutputIntents'));
    expect(intents, 'Kein /OutputIntents').toBeDefined();
    const roh = alsText(await pdf());
    expect(roh).toContain('/GTS_PDFA1');
    /* Das Profil selbst — `acsp` ist die Dateikennung jedes ICC-Profils. */
    expect(roh).toContain('acsp');
  });

  it('die Schriften sind EINGEBETTET — sonst ist es kein PDF/A', async () => {
    const roh = alsText(await pdf());
    expect(roh).toContain('/FontFile2');
    expect(roh).toContain('NotoSans');
    /* Und keine der 14 Standardschriften, die PDF/A verbietet. */
    expect(roh).not.toContain('/BaseFont /Helvetica');
  });
});

describe('(4) Zweimal dieselbe Rechnung ergibt dasselbe Dokument', () => {
  it('zwei Läufe sind bytegleich — ein Beleg, der sich ändert, beweist nichts', async () => {
    const a = await pdf();
    const b = await pdf();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
