/**
 * Das Rechnungsblatt zeigt, was die Rechnung sagt — vollständig, auf so
 * vielen Seiten wie nötig, in deutschen Formaten (V-134, D-629, DESIGN §11,
 * § 14 Abs. 4/5 und § 14a Abs. 5 UStG, § 48 EStG).
 *
 * Geprüft wird am INHALT (`blatt-inhalt.ts`), weil der Text im PDF als
 * Glyphen einer Teilschrift steht und sich nicht zuverlässig zurücklesen
 * lässt; am PDF selbst die Seitenzahl, und in `tests/compliance/` durch
 * veraPDF, dass auch das mehrseitige Blatt PDF/A-3B bleibt.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { cent, formatiereGeld } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  blattInhalt, einheitAnzeige,
} from '../../src/server/services/finanz/zugferd/blatt-inhalt.js';
import { prozentText } from '../../src/server/services/finanz/prozent.js';
import { umbrechen } from '../../src/server/services/finanz/zugferd/blatt.js';
import { baueZugferdPdf } from '../../src/server/services/finanz/zugferd/pdfa3.js';
import { beispielRechnung, position } from './hilfen/rechnung-beispiel.js';

const NBSP = ' ';
const ERZEUGT = new Date(Date.UTC(2026, 8, 11, 9, 0, 0));
const r = beispielRechnung();
const alles = (i: ReturnType<typeof blattInhalt>): string => JSON.stringify(i);

describe('§1 Zahlen und Daten, wie man sie auf Deutsch liest', () => {
  it('die Menge mit Komma — 30,87 m², nicht „30.870"', () => {
    const p = blattInhalt(r).positionen[0]!;
    expect(p.menge).toBe(`30,87${NBSP}m²`);
    expect(alles(blattInhalt(r))).not.toContain('30.870');
  });

  it('Daten als TT.MM.JJJJ — Rechnungsdatum, Zeitraum, Fälligkeit', () => {
    const i = blattInhalt(r);
    expect(i.eckdaten).toContainEqual(['Rechnungsdatum', '11.09.2026']);
    expect(i.eckdaten).toContainEqual(['Leistungszeitraum', '01.08.2026 – 31.08.2026']);
    expect(i.eckdaten).toContainEqual(['Fällig am', '11.10.2026']);
    expect(alles(i)).not.toMatch(/20\d\d-\d\d-\d\d/u);
  });

  it.each([
    [1900, '19,0 %'], [700, '7,0 %'], [0, '0,0 %'],
    [250, '2,5 %'], [705, '7,05 %'], [-50, '-0,5 %'],
  ])('prozentText(%i) = %s — derselbe Text wie im Kundenportal, ohne Gleitkomma', (bp, text) => {
    expect(prozentText(bp)).toBe(text);
  });

  it('das Blatt schreibt den Satz wie die Seite des Kundenportals', () => {
    expect(blattInhalt(r).positionen[0]!.ust).toBe(prozentText(1900));
  });

  it('Hochzahlen an Flächen und Rauminhalt, sonst bleibt die Einheit, wie sie ist', () => {
    expect(einheitAnzeige('m2')).toBe('m²');
    expect(einheitAnzeige('m3')).toBe('m³');
    expect(einheitAnzeige('km2')).toBe('km²');
    expect(einheitAnzeige('Std.')).toBe('Std.');
    expect(einheitAnzeige('m')).toBe('m');
    expect(einheitAnzeige(null)).toBe('');
  });
});

describe('§2 nichts wird gekürzt, und jede Positionsart erscheint', () => {
  it('eine lange Bezeichnung steht vollständig da', () => {
    const lang = `Unterhaltsreinigung ${'Treppenhaus, Aufzug und Kellergänge '.repeat(6)}Ende`;
    const i = blattInhalt({ ...r, positionen: [{ ...r.positionen[0]!, bezeichnung: lang }] });
    expect(i.positionen[0]!.bezeichnung).toBe(lang);
  });

  it('Beschreibung, eigener Zeitraum, Rabatt und Bezugsmenge darunter', () => {
    const p = {
      ...r.positionen[0]!, beschreibung: 'inkl. Glasflächen', leistungVon: '2026-08-03',
      leistungBis: '2026-08-07', rabattBp: 500, preisBasismenge: milliMenge(100_000n),
    };
    expect(blattInhalt({ ...r, positionen: [p] }).positionen[0]!.unterzeilen).toEqual([
      'inkl. Glasflächen', 'Leistungszeitraum 03.08.2026 – 07.08.2026',
      'Rabatt 5,0 %', `Einzelpreis je 100${NBSP}m²`,
    ]);
  });

  it('Textzeile und Zwischensumme — die Nutzlast trägt sie, das Blatt auch', () => {
    const i = blattInhalt({ ...r, positionen: [
      { ...r.positionen[0]!, art: 'textzeile', bezeichnung: 'Los 2: Aussenanlagen',
        nettoCent: null, menge: null, einzelpreisCent: null },
      { ...r.positionen[0]!, art: 'zwischensumme', bezeichnung: 'Zwischensumme Los 1' },
    ] });
    expect(i.positionen.map((p) => [p.art, p.bezeichnung, p.betrag])).toEqual([
      ['text', 'Los 2: Aussenanlagen', ''],
      ['zwischensumme', 'Zwischensumme Los 1', formatiereGeld(r.positionen[0]!.nettoCent!)],
    ]);
  });
});

describe('§3 die Pflichtangaben, die in der Nutzlast stehen, stehen auf dem Blatt', () => {
  it('§ 14a Abs. 5 UStG: der Hinweis auf die Steuerschuldnerschaft', () => {
    const hinweis = 'Steuerschuldnerschaft des Leistungsempfängers (§ 13b Abs. 2 Nr. 4 UStG)';
    expect(blattInhalt({ ...r, reverseCharge: true, steuerhinweis: hinweis }).steuerhinweis)
      .toBe(hinweis);
  });

  it('das Entgelt je Steuersatz und der Befreiungsgrund einer steuerfreien Zeile', () => {
    const i = blattInhalt({ ...r, steuerzeilen: [
      ...r.steuerzeilen,
      { steuersatzGruppe: 'befreit', kategorie: 'E', satzBp: 0, nettoCent: cent(5_000n),
        steuerCent: cent(0n), befreiungsgrundCode: 'vatex-eu-132',
        befreiungsgrundText: 'Steuerfrei nach § 4 Nr. 12 UStG' },
    ] });
    expect(i.summen.map((z) => z.text)).toContain(`Umsatzsteuer 0,0 % auf 50,00${NBSP}€`);
    expect(i.summenHinweise).toContain(
      `0,0 % auf 50,00${NBSP}€: Steuerfrei nach § 4 Nr. 12 UStG`);
  });

  it('§ 14 Abs. 5 UStG: die Abschläge mit Steuer, der Abzug und der ZAHLbetrag', () => {
    const i = blattInhalt({
      ...r, rechnungsart: 'schluss',
      abzuege: [{ abschlagNummer: 'RE-2026-00031', steuersatzGruppe: 'ust_19',
        abzugNettoCent: cent(50_000n), abzugSteuerCent: cent(9_500n) }],
      abzugBruttoCent: cent(59_500n),
      zahlbetragCent: cent(r.bruttoCent - 59_500n),
      ueberweisungsbetragCent: cent(r.bruttoCent - 59_500n),
    });
    expect(i.titel).toBe('Schlussrechnung RE-2026-00042');
    const texte = i.summen.map((z) => `${z.text}|${z.betrag}`);
    expect(texte).toContain(`abzüglich Abschlagsrechnung RE-2026-00031: netto 500,00${NBSP}€, `
      + `Umsatzsteuer 95,00${NBSP}€|`);
    expect(texte).toContain(`Summe der Abzüge|-595,00${NBSP}€`);
    expect(texte).toContain(`Zahlbetrag|${formatiereGeld(cent(r.bruttoCent - 59_500n))}`);
  });

  it('§ 48 EStG: der Einbehalt und der Überweisungsbetrag', () => {
    const i = blattInhalt({
      ...r,
      bauabzugsteuer: { pflichtig: true, satzBp: 1500, grundlageCent: r.bruttoCent,
        einbehaltCent: cent(17_850n), freistellungsbescheinigung: null },
      ueberweisungsbetragCent: cent(r.zahlbetragCent - 17_850n),
    });
    const texte = i.summen.map((z) => `${z.text}|${z.betrag}`);
    expect(texte).toContain(`Einbehalt Bauabzugsteuer nach § 48 EStG (15,0 % von `
      + `${formatiereGeld(r.bruttoCent)})|-178,50${NBSP}€`);
    expect(texte).toContain(
      `Überweisungsbetrag|${formatiereGeld(cent(r.zahlbetragCent - 17_850n))}`);
  });

  it('eine Freistellungsbescheinigung wird genannt, mit Gültigkeit', () => {
    const i = blattInhalt({ ...r, bauabzugsteuer: { ...r.bauabzugsteuer,
      freistellungsbescheinigung: { nummer: 'FB-4711', finanzamt: 'Finanzamt Neukölln',
        gueltigVon: '2026-01-01', gueltigBis: '2026-12-31', umfang: 'alle' } } });
    expect(i.summenHinweise).toContain('Freistellungsbescheinigung nach § 48b EStG: Nr. '
      + 'FB-4711, Finanzamt Neukölln, gültig vom 01.01.2026 bis 31.12.2026.');
  });

  it('USt-IdNr. des Empfängers, Leistungsort, Kopf-, Schluss- und Hinweistexte', () => {
    const i = blattInhalt({
      ...r,
      empfaenger: { ...r.empfaenger, ustid: 'DE999999999' },
      objekt: { id: '55555555-5555-5555-5555-555555555555', bezeichnung: 'Bürohaus Mitte',
        anschrift: { zeile: 'Rosenthaler Str. 40, 10178 Berlin, DE', strasse: 'Rosenthaler Str. 40',
          zusatz: null, plz: '10178', ort: 'Berlin', land: 'DE' } },
      kopftext: 'Storno zu Rechnung RE-2026-00040', fusstext: 'Vielen Dank.',
      hinweise: ['Aufbewahrungspflicht nach § 14b Abs. 1 Satz 5 UStG'],
    });
    expect(i.empfaenger).toContain('USt-IdNr. DE999999999');
    expect(i.leistungsort).toBe('Leistungsort: Bürohaus Mitte, Rosenthaler Str. 40, 10178 Berlin, DE');
    expect(i.kopftext).toBe('Storno zu Rechnung RE-2026-00040');
    expect(i.fusstext).toBe('Vielen Dank.');
    expect(i.hinweise).toEqual(['Aufbewahrungspflicht nach § 14b Abs. 1 Satz 5 UStG']);
  });

  it('Nachlass negativ, Zuschlag positiv — beide mit Grundlage', () => {
    const i = blattInhalt({ ...r, zuschlaege: [
      { art: 'nachlass', bezeichnung: 'Treuerabatt', grundCode: '95', basisCent: cent(100_000n),
        satzBp: 300, betragCent: cent(3_000n), steuersatzGruppe: 'ust_19',
        gruppeSatzBp: 1900, gruppeKategorie: 'S' },
      { art: 'zuschlag', bezeichnung: 'Nachtzuschlag', grundCode: 'ZZZ', basisCent: null,
        satzBp: null, betragCent: cent(2_000n), steuersatzGruppe: 'ust_19',
        gruppeSatzBp: 1900, gruppeKategorie: 'S' },
    ] });
    const texte = i.summen.map((z) => `${z.text}|${z.betrag}`);
    expect(texte).toContain(`Nachlass: Treuerabatt (3,0 % von 1.000,00${NBSP}€)|`
      + `-30,00${NBSP}€`);
    expect(texte).toContain(`Zuschlag: Nachtzuschlag|20,00${NBSP}€`);
  });

  it('die Rechnungsart steht im Titel', () => {
    expect(blattInhalt({ ...r, rechnungsart: 'storno' }).titel)
      .toBe('Stornorechnung RE-2026-00042');
    expect(blattInhalt({ ...r, rechnungsart: 'abschlag' }).titel)
      .toBe('Abschlagsrechnung RE-2026-00042');
  });
});

describe('§4 das Blatt rechnet nicht — jeder Betrag kommt aus der Nutzlast', () => {
  it('Netto, Steuer, Gesamt: je genau das Feld der Nutzlast, formatiert', () => {
    const texte = blattInhalt(r).summen.map((z) => `${z.text}|${z.betrag}`);
    expect(texte).toContain(`Nettobetrag|${formatiereGeld(r.nettoGesamtCent)}`);
    expect(texte).toContain(`Gesamtbetrag|${formatiereGeld(r.bruttoCent)}`);
    for (const s of r.steuerzeilen) {
      expect(texte).toContain(
        `Umsatzsteuer ${prozentText(s.satzBp)} auf ${formatiereGeld(s.nettoCent)}|`
        + formatiereGeld(s.steuerCent));
    }
  });

  it('ohne Abzüge und Einbehalt kein Zahl- und kein Überweisungsbetrag daneben', () => {
    const texte = blattInhalt(r).summen.map((z) => z.text);
    expect(texte).not.toContain('Zahlbetrag');
    expect(texte).not.toContain('Überweisungsbetrag');
  });
});

describe('§5 so viele Seiten wie nötig', () => {
  it('eine Rechnung mit einer Position bleibt EINE Seite', async () => {
    const d = await PDFDocument.load(await baueZugferdPdf(r, { erzeugtAm: ERZEUGT }));
    expect(d.getPageCount()).toBe(1);
  });

  it('sechzig Positionen laufen auf eine Folgeseite, statt unter den Fuss', async () => {
    const viele = Array.from({ length: 60 }, (_, n) => position(n + 1, 1_000n, 100n));
    const d = await PDFDocument.load(
      await baueZugferdPdf({ ...r, positionen: viele }, { erzeugtAm: ERZEUGT }));
    expect(d.getPageCount()).toBeGreaterThan(1);
    for (const seite of d.getPages()) {
      expect(Math.round(seite.getHeight())).toBe(842);
    }
  });
});

describe('§6 Zeilenumbruch und Zeichenvorrat', () => {
  const schrift = async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    return doc.embedFont(new Uint8Array(
      readFileSync(join(process.cwd(), 'assets', 'pdf', 'NotoSans-Regular.ttf'))),
    { subset: true });
  };

  it('keine Zeile ist breiter als erlaubt — auch nicht ein einziges langes Wort', async () => {
    const f = await schrift();
    const zeilen = umbrechen(`Kurz ${'X'.repeat(200)} und\nzweiter Absatz`, f, 10, 120);
    expect(zeilen.length).toBeGreaterThan(3);
    for (const z of zeilen) expect(f.widthOfTextAtSize(z, 10)).toBeLessThanOrEqual(120);
    expect(zeilen.join('')).toContain('zweiter Absatz');
  });

  it('ein geschütztes Leerzeichen trennt nie — „1.000,00 €" bleibt auf einer Zeile', async () => {
    const f = await schrift();
    const betrag = `1.000,00${NBSP}€`;
    const zeilen = umbrechen(`Umsatzsteuer auf ${betrag}`, f, 10, f.widthOfTextAtSize('Umsatzsteuer auf 1.000,00', 10));
    expect(zeilen.some((z) => z.includes(betrag))).toBe(true);
    expect(zeilen.every((z) => z !== '€' && !z.startsWith('€'))).toBe(true);
  });

  it('ein Name ausserhalb der Schrift macht das Blatt nicht kaputt', async () => {
    const pdf = await baueZugferdPdf(
      { ...r, empfaenger: { ...r.empfaenger, name: 'شركة البناء 北京' } },
      { erzeugtAm: ERZEUGT });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
});
