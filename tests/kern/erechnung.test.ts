/**
 * PR 63 — E-Rechnung lesen (ACC-05). Was der Extraktor zusichert:
 *
 *  1. Die eigene XRechnung (UBL) und die eigene CII kommen Feld fuer Feld
 *     zurueck — Nummer, Daten, Lieferant, IBAN, Betraege, Steuerzeilen.
 *  2. Jedes Feld nennt sein Element (Zelle) und sein Zitat.
 *  3. Die Rechenprobe reisst, wenn eine Summe nicht aufgeht — am Brutto,
 *     an der Steuerzeile, an der Kopfsumme —, und nur dann.
 *  4. Formatbefunde: Fremdwaehrung, falsche IBAN, drei Nachkommastellen,
 *     ein Datum, das keines ist.
 *  5. Was keine E-Rechnung ist, wird benannt abgewiesen; eine DTD ebenso.
 *  6. ZUGFeRD: die im eigenen PDF/A-3 eingebettete `factur-x.xml` wird
 *     gefunden und liefert dieselbe Rechnung.
 */
import { describe, expect, it } from 'vitest';
import { baueUbl } from '../../src/server/services/finanz/xrechnung/index.js';
import { baueCii } from '../../src/server/services/finanz/zugferd/cii.js';
import { baueZugferdPdf } from '../../src/server/services/finanz/zugferd/pdfa3.js';
import {
  ERechnungFehler, bpAusProzent, centAusBetrag, extrahiereERechnung, ibanGueltig, isoDatum,
  steuerAus, type Rohfeld,
} from '../../src/server/services/finanz/eingang/erechnung.js';
import { eingebetteteERechnung } from '../../src/server/services/finanz/eingang/pdf-anhang.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { beispielRechnung } from './hilfen/rechnung-beispiel.js';

const feld = (felder: readonly Rohfeld[], pfad: string): Rohfeld => {
  const f = felder.find((x) => x.feldPfad === pfad);
  if (f === undefined) throw new Error(`Feld ${pfad} fehlt`);
  return f;
};
const gerissen = (f: Rohfeld): readonly string[] =>
  f.befunde.filter((b) => !b.bestanden).map((b) => b.hinweis ?? b.pruefung);

describe('(0) die Bausteine', () => {
  it('Betraege ueber Zeichenketten, Prozent in Basispunkten, Datum in zwei Formen', () => {
    expect(centAusBetrag('1190.00')).toBe(119000n);
    expect(centAusBetrag('7')).toBe(700n);
    expect(centAusBetrag('-12.5')).toBe(-1250n);
    expect(centAusBetrag('1.234')).toBeNull();
    expect(centAusBetrag('1,00')).toBeNull();
    expect(bpAusProzent('19.00')).toBe(1900);
    expect(bpAusProzent('7')).toBe(700);
    expect(isoDatum('2026-09-11')).toBe('2026-09-11');
    expect(isoDatum('20260911')).toBe('2026-09-11');
    expect(isoDatum('2026-02-30')).toBeNull();
    expect(ibanGueltig('DE02 1203 0000 0000 2020 51')).toBe(true);
    expect(ibanGueltig('DE02120300000000202052')).toBe(false);
    expect(steuerAus(cent(100_000n), 1900)).toBe(19_000n);
    expect(steuerAus(cent(1_050n), 1900)).toBe(200n);   // 199,5 → 200 (kaufmaennisch)
    expect(steuerAus(cent(-1_050n), 1900)).toBe(-200n);
  });
});

describe('(1) die eigene XRechnung kommt zurueck', () => {
  const e = extrahiereERechnung(baueUbl(beispielRechnung()));

  it('Format, Kopf und Daten', () => {
    expect(e.format).toBe('ubl');
    expect(e.nutzlast.rechnungsnummer).toBe('RE-2026-00042');
    expect(e.nutzlast.rechnungsartCode).toBe('380');
    expect(e.nutzlast.rechnungsdatum).toBe('2026-09-11');
    expect(e.nutzlast.faelligAm).toBe('2026-10-11');
    expect(e.nutzlast.leistungVon).toBe('2026-08-01');
    expect(e.nutzlast.leistungBis).toBe('2026-08-31');
    expect(e.nutzlast.kaeuferReferenz).toBe('BESTELLUNG-4711');
    expect(e.nutzlast.waehrung).toBe('EUR');
    expect(e.nutzlast.positionenAnzahl).toBe(1);
  });

  it('der Lieferant mit USt-IdNr., Steuernummer, Anschrift und Bankverbindung', () => {
    expect(e.nutzlast.lieferant.name).toBe('CSE Dienstleistungen GmbH');
    expect(e.nutzlast.lieferant.ustId).toBe('DE123456789');
    expect(e.nutzlast.lieferant.steuernummer).toBe('30/123/45678');
    expect(e.nutzlast.lieferant.iban).toBe('DE02120300000000202051');
    expect(e.nutzlast.lieferant.bic).toBe('BYLADEM1001');
    expect(e.nutzlast.lieferant.ort).toBe('Berlin');
    expect(e.nutzlast.lieferant.plz).toBe('10719');
  });

  it('die Betraege in Cent — und die Steuerzeile', () => {
    expect(e.nutzlast.nettoCent).toBe(100_000n);
    expect(e.nutzlast.steuerCent).toBe(19_000n);
    expect(e.nutzlast.bruttoCent).toBe(119_000n);
    expect(e.nutzlast.zahlbetragCent).toBe(119_000n);
    expect(e.nutzlast.steuerzeilen).toEqual([
      { kategorie: 'S', satzBp: 1900, nettoCent: 100_000n, steuerCent: 19_000n },
    ]);
  });

  it('jedes Feld nennt Zelle und Zitat, und keines ist gerissen', () => {
    for (const f of e.felder) {
      expect(f.zelle, f.feldPfad).toMatch(/^Invoice\//u);
      expect(gerissen(f), f.feldPfad).toEqual([]);
    }
    expect(feld(e.felder, '/bruttoCent').zitat).toBe('1190.00');
    expect(feld(e.felder, '/bruttoCent').wert).toMatch(/1\.190,00/u);
    expect(feld(e.felder, '/bruttoCent').zelle).toBe('Invoice/LegalMonetaryTotal/TaxInclusiveAmount');
    expect(feld(e.felder, '/rechnungsdatum').wert).toBe('11.09.2026');
    /* Rechenproben sind gelaufen — nicht nur Formatpruefungen. */
    expect(feld(e.felder, '/bruttoCent').befunde.some((b) => b.pruefung === 'rechenprobe')).toBe(true);
    expect(feld(e.felder, '/steuerzeilen/0').befunde.some((b) => b.pruefung === 'rechenprobe')).toBe(true);
  });
});

describe('(2) die eigene CII kommt ebenso zurueck', () => {
  const e = extrahiereERechnung(baueCii(beispielRechnung()));

  it('dieselbe Rechnung, anderes Vokabular', () => {
    expect(e.format).toBe('cii');
    expect(e.nutzlast.rechnungsnummer).toBe('RE-2026-00042');
    expect(e.nutzlast.rechnungsdatum).toBe('2026-09-11');
    expect(e.nutzlast.faelligAm).toBe('2026-10-11');
    expect(e.nutzlast.leistungVon).toBe('2026-08-01');
    expect(e.nutzlast.lieferant.name).toBe('CSE Dienstleistungen GmbH');
    expect(e.nutzlast.lieferant.ustId).toBe('DE123456789');
    expect(e.nutzlast.lieferant.iban).toBe('DE02120300000000202051');
    expect(e.nutzlast.nettoCent).toBe(100_000n);
    expect(e.nutzlast.steuerCent).toBe(19_000n);
    expect(e.nutzlast.bruttoCent).toBe(119_000n);
    expect(e.nutzlast.steuerzeilen[0]?.satzBp).toBe(1900);
    for (const f of e.felder) {
      expect(f.zelle, f.feldPfad).toMatch(/^CrossIndustryInvoice\//u);
      expect(gerissen(f), f.feldPfad).toEqual([]);
    }
  });
});

describe('(3) die Rechenprobe reisst — genau dort, wo es nicht aufgeht', () => {
  it('ein Brutto, das nicht Netto + USt ist', () => {
    const xml = baueUbl(beispielRechnung())
      .replace('<cbc:TaxInclusiveAmount currencyID="EUR">1190.00</cbc:TaxInclusiveAmount>',
        '<cbc:TaxInclusiveAmount currencyID="EUR">1191.00</cbc:TaxInclusiveAmount>');
    const e = extrahiereERechnung(xml);
    expect(gerissen(feld(e.felder, '/bruttoCent'))[0]).toMatch(/ergibt .*1\.190,00/u);
    expect(gerissen(feld(e.felder, '/nettoCent'))).toEqual([]);
  });

  it('eine Steuerzeile, deren Betrag nicht Basis × Satz ist', () => {
    const xml = baueCii(beispielRechnung())
      .replace('<ram:CalculatedAmount>190.00</ram:CalculatedAmount>',
        '<ram:CalculatedAmount>190.02</ram:CalculatedAmount>');
    const e = extrahiereERechnung(xml);
    expect(gerissen(feld(e.felder, '/steuerzeilen/0'))[0]).toMatch(/19,00 %/u);
    /* Und die Kopfsumme der Steuer stimmt dann ebenfalls nicht mehr zu den Zeilen. */
    expect(gerissen(feld(e.felder, '/steuerCent')).length).toBe(1);
  });

  it('ohne Steuerzeile ist der Satz unbestimmbar', () => {
    const xml = baueUbl(beispielRechnung()).replace(/<cac:TaxSubtotal>[\s\S]*?<\/cac:TaxSubtotal>/u, '');
    const e = extrahiereERechnung(xml);
    expect(e.nutzlast.steuerzeilen).toEqual([]);
    expect(gerissen(feld(e.felder, '/steuerCent'))[0]).toMatch(/keine Steuerzeile/u);
  });
});

describe('(4) Formatbefunde', () => {
  it('eine Fremdwaehrung ist ein Befund am Feld, kein Euro', () => {
    const xml = baueUbl(beispielRechnung())
      .replace('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>',
        '<cbc:DocumentCurrencyCode>USD</cbc:DocumentCurrencyCode>');
    const e = extrahiereERechnung(xml);
    expect(e.nutzlast.waehrung).toBe('USD');
    expect(gerissen(feld(e.felder, '/waehrung'))[0]).toMatch(/USD/u);
  });

  it('eine IBAN mit falscher Pruefsumme', () => {
    const xml = baueUbl(beispielRechnung()).replace('DE02120300000000202051', 'DE02120300000000202052');
    const e = extrahiereERechnung(xml);
    expect(gerissen(feld(e.felder, '/lieferant/iban'))[0]).toMatch(/Prüfsumme/u);
  });

  it('drei Nachkommastellen und ein Datum, das keines ist', () => {
    const xml = baueUbl(beispielRechnung())
      .replace('<cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>',
        '<cbc:TaxExclusiveAmount currencyID="EUR">1000.001</cbc:TaxExclusiveAmount>')
      .replace('<cbc:IssueDate>2026-09-11</cbc:IssueDate>', '<cbc:IssueDate>11.09.2026</cbc:IssueDate>');
    const e = extrahiereERechnung(xml);
    expect(e.nutzlast.nettoCent).toBeNull();
    expect(gerissen(feld(e.felder, '/nettoCent'))[0]).toMatch(/Nachkommastellen/u);
    expect(e.nutzlast.rechnungsdatum).toBeNull();
    expect(gerissen(feld(e.felder, '/rechnungsdatum'))[0]).toMatch(/Kalendertag/u);
  });

  it('eine fehlende Rechnungsnummer ist ein Befund, kein Wurf', () => {
    const xml = baueUbl(beispielRechnung()).replace('<cbc:ID>RE-2026-00042</cbc:ID>', '');
    const e = extrahiereERechnung(xml);
    expect(e.nutzlast.rechnungsnummer).toBeNull();
    expect(gerissen(feld(e.felder, '/rechnungsnummer'))[0]).toMatch(/fehlt/u);
  });
});

describe('(5) was keine E-Rechnung ist', () => {
  it('ein CAMT-Auszug hat die falsche Wurzel', () => {
    expect(() => extrahiereERechnung('<Document><BkToCstmrStmt/></Document>'))
      .toThrow(ERechnungFehler);
    expect(() => extrahiereERechnung('<Document><BkToCstmrStmt/></Document>'))
      .toThrow(/Wurzel <Document>/u);
  });

  it('eine DTD wird abgewiesen', () => {
    expect(() => extrahiereERechnung('<!DOCTYPE x [<!ENTITY e "x">]><Invoice/>'))
      .toThrow(/DTD/u);
  });
});

describe('(6) ZUGFeRD — die eingebettete factur-x.xml', () => {
  it('wird im eigenen PDF/A-3 gefunden und liest dieselbe Rechnung', async () => {
    const pdf = await baueZugferdPdf(beispielRechnung(), {
      erzeugtAm: new Date(Date.UTC(2026, 8, 11, 9, 0, 0)),
    });
    const anhang = await eingebetteteERechnung(pdf);
    expect(anhang?.dateiname).toBe('factur-x.xml');
    const e = extrahiereERechnung(anhang!.xml);
    expect(e.format).toBe('cii');
    expect(e.nutzlast.rechnungsnummer).toBe('RE-2026-00042');
    expect(e.nutzlast.bruttoCent).toBe(119_000n);
  });

  it('ein PDF ohne Anhang liefert null — kein OCR, kein Raten (O-135)', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const leer = await PDFDocument.create();
    leer.addPage();
    const anhang = await eingebetteteERechnung(await leer.save());
    expect(anhang).toBeNull();
  });
});
