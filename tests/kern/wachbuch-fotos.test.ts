/**
 * Fotos am Wachbucheintrag — was ohne Datenbank feststeht (V-181, D-675,
 * SEC-05, D-599, D-728).
 *
 * Der Weg durch die echte Datenbank (Policy `t_wachbuch_medien`, „nie
 * danach", Lesen mit `wachbuch.lesen`, M1) steht in
 * `tests/isolation/wachbuch-fotos.test.ts`. Hier steht:
 *
 *  1. jeder Grund, aus dem eine Aufnahme scheitert, hat auf beiden
 *     Wachbuchseiten einen Satz — in allen vier Sprachen der Wache und in
 *     beiden der Verwaltung. Die Routen schicken `foto_<grund>`; fehlte ein
 *     Satz, sähe die Wache einen allgemeinen Rückfall statt „zu groß";
 *  2. ohne verbundenen Speicher scheitert `legeWachbuchFotosAb` VOR dem
 *     ersten Byte und vor jeder Zeile — und ohne Datei ist er kein Hindernis.
 */
import { describe, expect, it } from 'vitest';
import {
  legeWachbuchFotosAb, type MedienFehler,
} from '../../src/server/services/zeit/medien.js';
import { NichtVerbundenFehler, type Speicher } from '../../src/server/storage/adapter.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { WACHBUCH_SCHICHT_TEXTE } from '../../src/lib/i18n/wachbuch-schicht.js';
import { WACHBUCH_TEXTE } from '../../src/lib/i18n/verwaltung/wachbuch.js';
import { AUFNAHMEN_TEXTE } from '../../src/lib/i18n/verwaltung/aufnahmen.js';

/** Jeder Grund aus `MedienFehler` — der Typ unten haelt die Liste vollstaendig. */
const GRUENDE = [
  'zu_gross', 'leer', 'typ_unbekannt', 'typ_nicht_erlaubt', 'widerspruch', 'bereinigung',
] as const satisfies readonly MedienFehler['grund'][];
type Fehlend = Exclude<MedienFehler['grund'], (typeof GRUENDE)[number]>;
const vollstaendig: [Fehlend] extends [never] ? true : false = true;

const ROUTENGRUENDE = [...GRUENDE.map((g) => `foto_${g}`), 'speicher_nicht_verbunden'];

describe('(1) jeder Grund einer gescheiterten Aufnahme hat einen Satz', () => {
  it('die Liste deckt MedienFehler ganz ab', () => {
    expect(vollstaendig).toBe(true);
  });

  for (const sprache of ['de', 'en', 'ar', 'tr'] as const) {
    it(`Mitarbeiterportal, ${sprache}`, () => {
      const t = WACHBUCH_SCHICHT_TEXTE[sprache];
      for (const g of ROUTENGRUENDE) {
        expect(t.fehler[g], g).toMatch(/\S/u);
        expect(t.fehler[g]).not.toContain(g);
      }
      for (const text of [t.fotos, t.fotoHinweis, t.fotoNichtVerbunden, t.fotoOhneAdresse]) {
        expect(text).toMatch(/\S/u);
      }
    });
  }

  for (const sprache of ['de', 'en'] as const) {
    it(`Leitstelle, ${sprache}`, () => {
      const t = WACHBUCH_TEXTE[sprache];
      for (const g of ROUTENGRUENDE) {
        expect(t.fehler[g], g).toMatch(/\S/u);
        expect(t.fehler[g]).not.toContain(g);
      }
      const a = AUFNAHMEN_TEXTE[sprache];
      expect(a.fotoOeffnen(2)).toContain('2');
      expect(a.fotoErfasst('01.02.2030 03:04')).toContain('01.02.2030 03:04');
      expect(t.fotoAnzahl(1)).not.toBe(t.fotoAnzahl(2).replace('2', '1'));
    });
  }
});

describe('(2) ohne verbundenen Speicher: nichts, und zwar vor der Datenbank', () => {
  const NICHT_VERBUNDEN: Speicher = {
    verbunden: false,
    lege: () => Promise.reject(new NichtVerbundenFehler('Der Medienspeicher')),
    hole: () => Promise.reject(new NichtVerbundenFehler('Der Medienspeicher')),
    entferne: () => Promise.reject(new NichtVerbundenFehler('Der Medienspeicher')),
    signierteUrl: () => Promise.reject(new NichtVerbundenFehler('Der Medienspeicher')),
  };
  const aufrufe: string[] = [];
  const kontext: SchreibKontext = {
    scope: 'mandant', portal: 'intern', benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    mandantIds: ['00000000-0000-4000-8000-000000000002'],
    abfrage: (s: string) => { aufrufe.push(s); return Promise.resolve([]); },
    schreibe: (s: string) => { aufrufe.push(s); return Promise.resolve([]); },
  };

  it('mit Datei: NichtVerbundenFehler, keine Zeile', async () => {
    await expect(legeWachbuchFotosAb(kontext, {
      eintragId: '00000000-0000-4000-8000-000000000003',
      dateien: [{ daten: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), behaupteterTyp: null }],
    }, NICHT_VERBUNDEN)).rejects.toBeInstanceOf(NichtVerbundenFehler);
    expect(aufrufe).toEqual([]);
  });

  it('ohne Datei: kein Hindernis, keine Zeile', async () => {
    await expect(legeWachbuchFotosAb(kontext, {
      eintragId: '00000000-0000-4000-8000-000000000003', dateien: [],
    }, NICHT_VERBUNDEN)).resolves.toEqual([]);
    expect(aufrufe).toEqual([]);
  });
});
