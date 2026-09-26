/**
 * Das Logo erreicht die Rechnung — **festgehalten, nie verwiesen** (V-132,
 * D-625, K-12, DESIGN §4/§11, `cse.rechnung.v4`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DESIGN §11 verlangt „each entity prints its own logo", das Angebotsblatt
 * tut es seit V-100 — die ZUGFeRD-Rechnung druckte den Namen. Ein Logo dort
 * ist ein K-12-Fall wie die Fusszeile (V-099): läse das PDF es aus der
 * lebenden Identität, änderte ein neues Logo rückwirkend jede alte Rechnung,
 * und die Kette meldete weiter „intakt".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was festgehalten wird, und warum das so gut ist wie eine Kopie.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Schlüssel, SHA-256 und Typ — nicht die Bytes. Der Schlüssel im Behälter
 * `marke` IST der Inhalt (`<mandant>/<art>/<sha256>.<endung>`), nichts dort
 * wird überschrieben oder gelöscht, und die Prüfsumme steht in der Nutzlast,
 * also in der Kette. Das Blatt entsteht nur mit genau diesen Bytes (§4).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, type PDFDict } from 'pdf-lib';
import {
  SCHEMA_VERSION, SCHEMA_VERSION_V2, SCHEMA_VERSION_V3, buildKanonischePayload,
  type RechnungsLogo, type RechnungVollstaendig,
} from '../../src/server/services/finanz/kanonisch.js';
import { leseNutzlast, SnapshotFehler }
  from '../../src/server/services/finanz/xrechnung/aus-snapshot.js';
import { waehleRechnungsLogo, zerlegeLogoSchluessel }
  from '../../src/server/services/finanz/rechnungslogo.js';
import { baueZugferdPdf, RechnungslogoFehler }
  from '../../src/server/services/finanz/zugferd/pdfa3.js';
import { istCmykJpeg, jpegKomponenten } from '../../src/server/storage/raster.js';
import { beispielRechnung } from './hilfen/rechnung-beispiel.js';
import { JPEG_CMYK, JPEG_RGB, pngMitAlpha } from './hilfen/bild.js';

const MANDANT = '11111111-1111-1111-1111-111111111111';
const FREMD = '22222222-2222-2222-2222-222222222222';
const ERZEUGT = new Date(Date.UTC(2026, 8, 11, 9, 0, 0));

const summe = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

function logoFuer(bytes: Uint8Array, art: 'logo_druck' | 'logo_hell', endung: 'png' | 'jpg',
  mandant = MANDANT): RechnungsLogo {
  const s = summe(bytes);
  return {
    schluessel: `${mandant}/${art}/${s}.${endung}`,
    sha256: s,
    mime: endung === 'png' ? 'image/png' : 'image/jpeg',
  };
}

function mitLogo(logo: RechnungsLogo | null): RechnungVollstaendig {
  const r = beispielRechnung();
  return { ...r, leistender: { ...r.leistender, logo } };
}

const PNG = pngMitAlpha(240, 80);
const PNG_LOGO = logoFuer(PNG, 'logo_druck', 'png');

function nutzlast(logo: RechnungsLogo | null): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(buildKanonischePayload(mitLogo(logo)))) as
    Record<string, unknown>;
}
const leistender = (o: Record<string, unknown>): Record<string, unknown> =>
  o['leistender'] as Record<string, unknown>;

describe('§1 das Logo steht IN der Nutzlast — und damit in der Kette', () => {
  it('v4 trägt Schlüssel, Prüfsumme und Typ unter `leistender.logo`', () => {
    const o = nutzlast(PNG_LOGO);
    expect(o['schema']).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe('cse.rechnung.v4');
    expect(leistender(o)['logo']).toEqual({
      schluessel: PNG_LOGO.schluessel, sha256: PNG_LOGO.sha256, mime: 'image/png',
    });
  });

  it('ohne Logo steht `null` — AUSGESCHRIEBEN (§5.3)', () => {
    const l = leistender(nutzlast(null));
    expect('logo' in l).toBe(true);
    expect(l['logo']).toBeNull();
  });

  it('ein anderes Logo ergibt andere Bytes — also einen anderen Hash', () => {
    const anderes = logoFuer(pngMitAlpha(120, 40), 'logo_druck', 'png');
    const b = (l: RechnungsLogo | null): string =>
      new TextDecoder().decode(buildKanonischePayload(mitLogo(l)));
    expect(new Set([b(PNG_LOGO), b(anderes), b(null)]).size).toBe(3);
  });
});

describe('§2 welches Logo die Festschreibung wählt (DESIGN §4)', () => {
  const s = 'a'.repeat(64);
  const t = 'b'.repeat(64);
  it('das Drucklogo vor dem hellen', () => {
    expect(waehleRechnungsLogo(MANDANT, `${MANDANT}/logo_druck/${s}.png`,
      `${MANDANT}/logo_hell/${t}.png`)?.schluessel).toBe(`${MANDANT}/logo_druck/${s}.png`);
  });

  it('ein SVG-Drucklogo lässt das helle Raster drucken — Papier ist hell', () => {
    expect(waehleRechnungsLogo(MANDANT, `${MANDANT}/logo_druck/${s}.svg`,
      `${MANDANT}/logo_hell/${t}.jpg`)).toEqual({
      schluessel: `${MANDANT}/logo_hell/${t}.jpg`, sha256: t, mime: 'image/jpeg',
    });
  });

  it('nur SVG — dann kein Logo, und die Rechnung druckt den Namen', () => {
    expect(waehleRechnungsLogo(MANDANT, `${MANDANT}/logo_druck/${s}.svg`,
      `${MANDANT}/logo_hell/${t}.svg`)).toBeNull();
    expect(waehleRechnungsLogo(MANDANT, null, null)).toBeNull();
  });

  it('nie ein Pfad eines FREMDEN Mandanten, auch wenn er in der Spalte stünde', () => {
    expect(waehleRechnungsLogo(MANDANT, `${FREMD}/logo_druck/${s}.png`, null)).toBeNull();
  });

  it('nie das Logo für dunkle Flächen — es verschwände auf Papier', () => {
    expect(zerlegeLogoSchluessel(`${MANDANT}/logo_dunkel/${s}.png`)).toBeNull();
  });
});

describe('§3 der Leser: v4 streng, v2/v3 ohne Logo', () => {
  it('eine v4-Nutzlast liest das Logo zurück', () => {
    const gelesen = leseNutzlast(buildKanonischePayload(mitLogo(PNG_LOGO)));
    expect(gelesen.leistender.logo).toEqual(PNG_LOGO);
  });

  it('eine v3-Nutzlast liest sich VOLLSTÄNDIG, mit `logo: null`', () => {
    const o = nutzlast(null);
    o['schema'] = SCHEMA_VERSION_V3;
    delete leistender(o)['logo'];
    const gelesen = leseNutzlast(JSON.stringify(o));
    expect(gelesen.leistender.logo).toBeNull();
    expect(gelesen.leistender.fusszeile).not.toBeNull();
  });

  it('eine v2-Nutzlast ebenso — ohne Fusszeile und ohne Logo', () => {
    const o = nutzlast(null);
    o['schema'] = SCHEMA_VERSION_V2;
    delete leistender(o)['logo'];
    delete leistender(o)['fusszeile'];
    const gelesen = leseNutzlast(JSON.stringify(o));
    expect(gelesen.leistender.logo).toBeNull();
    expect(gelesen.leistender.fusszeile).toBeNull();
  });

  it('eine v4-Zeile OHNE das Feld ist beschädigt, nicht „ohne Logo"', () => {
    const o = nutzlast(null);
    delete leistender(o)['logo'];
    expect(() => leseNutzlast(JSON.stringify(o))).toThrow(/logo fehlt/u);
  });

  it('eine v3-Zeile MIT dem Feld ebenso — sie kann es nie getragen haben', () => {
    const o = nutzlast(PNG_LOGO);
    o['schema'] = SCHEMA_VERSION_V3;
    expect(() => leseNutzlast(JSON.stringify(o))).toThrow(SnapshotFehler);
  });

  it.each([
    ['Prüfsumme passt nicht zum Schlüssel', { sha256: 'c'.repeat(64) }, /sha256/u],
    ['Ordner eines fremden Mandanten',
      { schluessel: PNG_LOGO.schluessel.replace(MANDANT, FREMD) }, /Ordner des Leistenden/u],
    ['Typ passt nicht zur Endung', { mime: 'image/jpeg' }, /mime/u],
    ['kein Logo-Schlüssel', { schluessel: 'irgendwo/anders.png' }, /kein druckbares Logo/u],
  ] as const)('%s → SnapshotFehler', (_name, aenderung, meldung) => {
    const o = nutzlast(PNG_LOGO);
    leistender(o)['logo'] = { ...PNG_LOGO, ...aenderung };
    expect(() => leseNutzlast(JSON.stringify(o))).toThrow(meldung);
  });
});

/** Alle Bildobjekte des Dokuments, mit ihren Wörterbüchern. */
async function bilder(pdf: Uint8Array): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(pdf);
  const gefunden: PDFDict[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream
        && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
      gefunden.push(obj.dict);
    }
  }
  return gefunden;
}

describe('§4 das Blatt: genau DIESES Bild, oder kein Blatt', () => {
  it('ein PNG mit Alpha wird eingebettet — als Bild MIT /SMask', async () => {
    const pdf = await baueZugferdPdf(mitLogo(PNG_LOGO), { erzeugtAm: ERZEUGT, logo: PNG });
    const b = await bilder(pdf);
    /* Das Bild und seine Maske — die Transparenz bleibt erhalten. */
    const mitMaske = b.filter((d) => d.get(PDFName.of('SMask')) !== undefined);
    expect(mitMaske).toHaveLength(1);
    expect(mitMaske[0]?.get(PDFName.of('Width'))?.toString()).toBe('240');
  });

  it('ein RGB-JPEG wird eingebettet (DCTDecode)', async () => {
    const logo = logoFuer(JPEG_RGB, 'logo_hell', 'jpg');
    const pdf = await baueZugferdPdf(mitLogo(logo), { erzeugtAm: ERZEUGT, logo: JPEG_RGB });
    const b = await bilder(pdf);
    expect(b).toHaveLength(1);
    expect(b[0]?.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
  });

  it('ohne Logo kein Bild — das Blatt bleibt, wie es war', async () => {
    expect(await bilder(await baueZugferdPdf(mitLogo(null), { erzeugtAm: ERZEUGT })))
      .toHaveLength(0);
  });

  it('dieselbe Rechnung zweimal ergibt dieselben Bytes — auch mit Logo', async () => {
    const a = await baueZugferdPdf(mitLogo(PNG_LOGO), { erzeugtAm: ERZEUGT, logo: PNG });
    const b = await baueZugferdPdf(mitLogo(PNG_LOGO), { erzeugtAm: ERZEUGT, logo: PNG });
    expect(summe(a)).toBe(summe(b));
  });

  it('die Nutzlast nennt ein Logo, die Bytes fehlen → kein Blatt', async () => {
    await expect(baueZugferdPdf(mitLogo(PNG_LOGO), { erzeugtAm: ERZEUGT }))
      .rejects.toBeInstanceOf(RechnungslogoFehler);
  });

  it('andere Bytes als die festgeschriebenen → kein Blatt', async () => {
    await expect(baueZugferdPdf(mitLogo(PNG_LOGO),
      { erzeugtAm: ERZEUGT, logo: pngMitAlpha(241, 80) }))
      .rejects.toThrow(/nicht das festgeschriebene/u);
  });

  it('Bytes ohne Logo in der Nutzlast → kein Blatt (es zeigt nur, was festgeschrieben ist)',
    async () => {
      await expect(baueZugferdPdf(mitLogo(null), { erzeugtAm: ERZEUGT, logo: PNG }))
        .rejects.toBeInstanceOf(RechnungslogoFehler);
    });

  it('ein CMYK-JPEG → kein Blatt: DeviceCMYK verletzte PDF/A mit sRGB-Profil', async () => {
    const logo = logoFuer(JPEG_CMYK, 'logo_druck', 'jpg');
    await expect(baueZugferdPdf(mitLogo(logo), { erzeugtAm: ERZEUGT, logo: JPEG_CMYK }))
      .rejects.toThrow(/CMYK/u);
  });
});

describe('§5 die Farbkomponenten eines JPEG, aus den Bytes gelesen', () => {
  it('RGB hat drei, CMYK vier', () => {
    expect(jpegKomponenten(JPEG_RGB)).toBe(3);
    expect(jpegKomponenten(JPEG_CMYK)).toBe(4);
    expect(istCmykJpeg(JPEG_RGB)).toBe(false);
    expect(istCmykJpeg(JPEG_CMYK)).toBe(true);
  });

  it('kein JPEG, ein abgeschnittenes, eines ohne Bildkopf → null, nie ein Absturz', () => {
    expect(jpegKomponenten(PNG)).toBeNull();
    expect(jpegKomponenten(JPEG_RGB.slice(0, 20))).toBeNull();
    expect(jpegKomponenten(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(jpegKomponenten(new Uint8Array(0))).toBeNull();
  });
});
