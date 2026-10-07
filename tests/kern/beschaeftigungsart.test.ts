/**
 * Die Beschäftigungsart einer Stelle (V-362, O-200, D-816) — ohne Datenbank.
 *
 * Geprüft wird das Vokabular, der Vorschlag aus den Wochenstunden (nur
 * Vollzeit oder Teilzeit, nie Minijob oder Aushilfe), das Lesen aus dem
 * Formular und dass jede Art in jeder Sprache einen Namen hat.
 */
import { describe, expect, it } from 'vitest';
import {
  BESCHAEFTIGUNGSARTEN, VOLLZEIT_AB_STUNDEN, istBeschaeftigungsart, vorschlagAusWochenstunden,
} from '../../src/server/services/recruiting/beschaeftigungsart.js';
import { leseStellenfelder } from '../../src/app/api/recruiting/stellen/felder.js';
import { RECRUITING_STELLENENTWURF_TEXTE } from '../../src/lib/i18n/verwaltung/recruiting-stellenentwurf.js';
import { RECRUITING_RUECKMELDUNG } from '../../src/lib/i18n/verwaltung/recruiting-rueckmeldung.js';
import { KARRIERE_TEXTE } from '../../src/app/(public)/karriere/texte.js';

const BASIS = { titel: 'Reinigungskraft', beschreibung: 'Text.' };

describe('V-362 — das Vokabular (O-200)', () => {
  it('Vollzeit, Teilzeit, Minijob, Aushilfe — und sonst nichts', () => {
    expect(BESCHAEFTIGUNGSARTEN).toEqual(['vollzeit', 'teilzeit', 'minijob', 'aushilfe']);
    expect(istBeschaeftigungsart('teilzeit')).toBe(true);
    expect(istBeschaeftigungsart('Teilzeit')).toBe(false);
    expect(istBeschaeftigungsart('festanstellung')).toBe(false);
    expect(istBeschaeftigungsart(null)).toBe(false);
  });
});

describe('V-362 — der Vorschlag aus den Wochenstunden', () => {
  it('ab 35 Vollzeit, darunter Teilzeit (Voreinstellung)', () => {
    expect(VOLLZEIT_AB_STUNDEN).toBe(35);
    expect(vorschlagAusWochenstunden(40)).toBe('vollzeit');
    expect(vorschlagAusWochenstunden(35)).toBe('vollzeit');
    expect(vorschlagAusWochenstunden(34.5)).toBe('teilzeit');
    expect(vorschlagAusWochenstunden(10)).toBe('teilzeit');
  });

  it('ohne Stunden kein Vorschlag — und nie Minijob oder Aushilfe', () => {
    expect(vorschlagAusWochenstunden(null)).toBeNull();
    expect(vorschlagAusWochenstunden(0)).toBeNull();
    expect(vorschlagAusWochenstunden(Number.NaN)).toBeNull();
    for (let h = 1; h <= 60; h += 0.5) {
      expect(['vollzeit', 'teilzeit']).toContain(vorschlagAusWochenstunden(h));
    }
  });
});

describe('V-362 — das Formular', () => {
  it('leer heisst nicht festgelegt, ein bekannter Wert wird übernommen', () => {
    expect(leseStellenfelder({ ...BASIS }).beschaeftigungsart).toBeNull();
    expect(leseStellenfelder({ ...BASIS, beschaeftigungsart: ' ' }).beschaeftigungsart).toBeNull();
    expect(leseStellenfelder({ ...BASIS, beschaeftigungsart: 'minijob' }).beschaeftigungsart)
      .toBe('minijob');
  });

  it('ein unbekannter Wert ist ein Satz, kein 500', () => {
    for (const roh of ['Vollzeit', 'festanstellung', 'vollzeit;drop']) {
      expect(() => leseStellenfelder({ ...BASIS, beschaeftigungsart: roh }))
        .toThrow(expect.objectContaining({ grund: 'unbrauchbare_beschaeftigungsart', status: 400 }));
    }
  });
});

describe('V-362 — jede Art hat in jeder Sprache einen Namen', () => {
  it('Verwaltung de/en, Karriereseite de/en, Rückmeldung de/en', () => {
    for (const sprache of ['de', 'en'] as const) {
      for (const art of BESCHAEFTIGUNGSARTEN) {
        expect(RECRUITING_STELLENENTWURF_TEXTE[sprache].beschaeftigungsarten[art]).toMatch(/\S/u);
        expect(KARRIERE_TEXTE[sprache].beschaeftigungsart[art]).toMatch(/\S/u);
      }
      expect(RECRUITING_STELLENENTWURF_TEXTE[sprache].fehler['unbrauchbare_beschaeftigungsart'])
        .toMatch(/\S/u);
    }
    expect(KARRIERE_TEXTE.en.beschaeftigungsart.teilzeit).toBe('Part-time');
    for (const sprache of ['de', 'en'] as const) {
      expect(RECRUITING_RUECKMELDUNG[sprache].stelleNeu['unbrauchbare_beschaeftigungsart'])
        .toMatch(/\S/u);
    }
  });
});
