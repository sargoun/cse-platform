/**
 * Die Regeln der Fassungskette, die sich ohne Datenbank prüfen lassen
 * (DOC-05, V-219, D-713).
 *
 *  - Welche Kategorien eine zweite Fassung bekommen — und dass der Dienst
 *    dieselbe Liste sperrt wie der Auslöser in 0470. Zwei Listen, die
 *    auseinanderlaufen, wären zwei Wahrheiten über dieselbe GoBD-Regel.
 *  - Der Schlüssel einer Fassung ist ein GESCHWISTER der ersten, kein
 *    Unterordner: im Vorführordner ist der erste Schlüssel eine Datei.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FASSUNG_ERLAUBT_PLATZHALTER, FASSUNG_GESPERRT, KATEGORIEN, fassungMoeglich,
} from '../../src/server/services/dokument/kategorie.js';
import { AblageFehler, fassungSchluessel, type AblageGrund }
  from '../../src/server/services/dokument/ablage.js';
import { ladeHoch } from '../../src/server/services/dokument/upload.js';
import { OrdnerSpeicher } from '../../src/server/storage/ordner.js';
import type { Speicher } from '../../src/server/storage/adapter.js';
import { fassungGrund } from '../../src/app/api/dokumente/[id]/version/grund.js';
import { DOKUMENT_BLATT_TEXTE } from '../../src/lib/i18n/verwaltung/dokument-blatt.js';

describe('welche Kategorien eine zweite Fassung bekommen', () => {
  it('Rechnung, Beleg und Buchhaltung nie — die übrigen sechs bis zur Antwort auf O-937', () => {
    for (const k of ['rechnung', 'beleg', 'buchhaltung']) expect(fassungMoeglich(k), k).toBe(false);
    for (const k of ['kunde', 'vertrag', 'angebot', 'mitarbeiter', 'projekt', 'unternehmen']) {
      expect(fassungMoeglich(k), k).toBe(true);
    }
    expect(fassungMoeglich('unbekannt')).toBe(false);
    expect([...FASSUNG_GESPERRT, ...FASSUNG_ERLAUBT_PLATZHALTER].sort())
      .toEqual([...KATEGORIEN].sort());
  });

  /*
   * JEDE Fassung des Auslösers — 0470, 0474 und 0488 ersetzen ihn nacheinander
   * (V-266). Geprüft wird die neueste, die auf der Datenbank gilt, und jede
   * davor: eine, die nur die erste liest, bliebe grün, während die geltende
   * eine andere Liste trüge.
   */
  it('der Auslöser sperrt in jeder seiner Fassungen genau dieselben Kategorien', () => {
    const ordner = fileURLToPath(new URL('../../drizzle/', import.meta.url));
    const dateien = readdirSync(ordner).filter((d) => d.endsWith('.sql')).sort()
      .filter((d) => /create (or replace )?function kern\.dokument_fassung_pruefen\(/u
        .test(readFileSync(`${ordner}${d}`, 'utf8')));
    expect(dateien[0]).toBe('0470_dokument_fassungskette.sql');
    expect(dateien.length).toBeGreaterThanOrEqual(3);
    for (const datei of dateien) {
      const treffer = /v_kategorie in \(([^)]*)\)/u.exec(readFileSync(`${ordner}${datei}`, 'utf8'));
      expect(treffer, datei).not.toBeNull();
      const liste = (treffer![1] ?? '').split(',').map((t) => t.trim().replace(/'/gu, ''));
      expect(liste.sort(), datei).toEqual([...FASSUNG_GESPERRT].sort());
    }
  });
});

describe('der Schlüssel einer Fassung', () => {
  const mandant = '00000000-0000-4000-8000-000000000001';
  const dokument = '00000000-0000-4000-8000-0000000000aa';

  it('ist ein Geschwister der ersten Fassung, nicht ihr Unterordner', () => {
    const erste = `${mandant}/vertrag/${dokument}`;
    const zweite = fassungSchluessel(mandant, 'vertrag', dokument, 2);
    expect(zweite).toBe(`${erste}.v2`);
    expect(zweite.startsWith(`${erste}/`)).toBe(false);
    expect(fassungSchluessel(mandant, 'vertrag', dokument, 3)).not.toBe(zweite);
  });

  it('passt in den Vorführordner neben die erste Fassung', () => {
    const ordner = new OrdnerSpeicher('/tmp/cse-fassung-probe');
    const erste = ordner.ort('dokumente', `${mandant}/vertrag/${dokument}`);
    const zweite = ordner.ort('dokumente', fassungSchluessel(mandant, 'vertrag', dokument, 2));
    expect(zweite).not.toBe(erste);
    expect(zweite.startsWith(`${erste}/`)).toBe(false);
  });
});

/**
 * **Jeder Wurf der Prüfkette bekommt einen Grund — und einen Satz in beiden
 * Sprachen** (V-266, D-759). `ExifFehler` fiel durch die Abbildung der Route
 * und endete als 500: jedes erlaubte Bild ohne Bereinigungsverfahren (TIFF,
 * GIF, WebP) und jedes verschlüsselte PDF — der eingescannte oder signierte
 * Vertrag, der typische Fall einer zweiten Fassung.
 */
describe('die Prüfkette einer Fassung und die Sätze des Blatts', () => {
  const speicher: Speicher = {
    verbunden: true,
    lege: () => Promise.resolve(),
    hole: () => Promise.reject(new Error('nie')),
    entferne: () => Promise.reject(new Error('nie')),
    signierteUrl: () => Promise.reject(new Error('nie')),
  };
  const mit = (kopf: readonly number[], rest = 64): Uint8Array =>
    Uint8Array.from([...kopf, ...new Array<number>(rest).fill(0x20)]);
  const ascii = (t: string): number[] => [...Buffer.from(t, 'latin1')];
  const faelle: readonly [string, Uint8Array, string | undefined, string][] = [
    ['leer', new Uint8Array(0), undefined, 'datei_leer'],
    ['unbekannt', mit(ascii('kein bekanntes Format')), undefined, 'datei_unbekannt'],
    ['Widerspruch', mit(ascii('%PDF-1.7')), 'image/png', 'datei_widerspruch'],
    ['TIFF', mit([0x49, 0x49, 0x2a, 0x00]), 'image/tiff', 'datei_metadaten'],
    ['GIF', mit(ascii('GIF89a')), 'image/gif', 'datei_metadaten'],
    ['WebP', mit([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')]), 'image/webp',
      'datei_metadaten'],
    ['verschlüsseltes PDF', mit(ascii('%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >>')),
      'application/pdf', 'datei_metadaten'],
  ];

  it.each(faelle)('%s → ein Grund, und das Blatt hat einen Satz dafür', async (_, daten, typ, grund) => {
    const fehler = await ladeHoch({
      mandantId: '00000000-0000-4000-8000-000000000001', kategorie: 'vertrag', titel: 'Vertrag',
      dateiname: 'datei', daten, ...(typ === undefined ? {} : { behaupteterTyp: typ }),
    }, speicher, 2026).then(() => null, (e: unknown) => e);
    expect(fehler, 'die Prüfkette weist ab').not.toBeNull();
    expect(fassungGrund(fehler)).toBe(grund);
    for (const sprache of ['de', 'en'] as const) {
      const satz = (DOKUMENT_BLATT_TEXTE[sprache].faFehler as Readonly<Record<string, string>>)[grund];
      expect(satz, `${sprache}: ${grund}`).toBeTruthy();
    }
  });

  it('ein fremder Fehler bleibt ein Fehler — kein Grund, keine erfundene Abweisung', () => {
    expect(fassungGrund(new TypeError('x'))).toBeNull();
  });

  /*
   * D-774 Nachrunde: jeder `AblageFehler` wurde `datei_zu_gross` — auch einer,
   * zu dem das Blatt einen eigenen Satz hat. Jetzt reist sein Grund, wo der
   * Satz existiert; sonst bleibt der bisherige Rückfall.
   */
  it('`AblageFehler` reist mit seinem Grund, wo das Blatt einen Satz hat — sonst wie bisher', () => {
    const mitSatz: readonly AblageGrund[] = ['datei_leer', 'datei_zu_gross'];
    const ohneSatz: readonly AblageGrund[] = [
      'titel_fehlt', 'titel_zu_lang', 'kategorie_unbekannt', 'beschreibung_zu_lang',
      'kunde_unbekannt', 'objekt_unbekannt', 'auftrag_unbekannt',
    ];
    for (const g of mitSatz) {
      expect(fassungGrund(new AblageFehler('x', g)), g).toBe(g);
      for (const sprache of ['de', 'en'] as const) {
        expect((DOKUMENT_BLATT_TEXTE[sprache].faFehler as Readonly<Record<string, string>>)[g],
          `${sprache}: ${g}`).toBeTruthy();
      }
    }
    for (const g of ohneSatz) {
      expect(Object.hasOwn(DOKUMENT_BLATT_TEXTE.de.faFehler, g), g).toBe(false);
      expect(fassungGrund(new AblageFehler('x', g)), g).toBe('datei_zu_gross');
    }
  });
});
