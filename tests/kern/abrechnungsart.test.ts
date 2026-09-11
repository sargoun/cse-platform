/**
 * PR 48 — was sich ohne Datenbank entscheiden lässt (FIN-01, O-04).
 *
 * Die Beträge prüft `tests/isolation/abrechnungsart.test.ts` gegen eine echte
 * Datenbank; hier stehen die drei Dinge, die reine Funktionen sind und deren
 * Fehler sich sonst hinter einer Abfrage verstecken:
 *
 *  1. **Das Register ist offen.** Eine sechste Abrechnungsart einzutragen
 *     verlangt keine Änderung an einer bestehenden Datei (Abnahme 5). Das ist
 *     eine Aussage über Typen und eine Karte, nicht über Postgres.
 *  2. **Der Kalender ist der gregorianische**, nicht der der Systemzeitzone.
 *     Ein Quartal sind drei Monatsabschnitte, und der Februar 2028 hat
 *     29 Tage — daran hängt jede anteilige Monatspauschale.
 *  3. **Ein fehlender Parameter blockiert.** Der Befund entsteht, bevor
 *     irgendetwas gerechnet wird, und er nennt die offene Frage.
 */
import { describe, expect, it } from 'vitest';
import {
  ABRECHNUNGSARTEN,
  AbrechnungFehler,
  alleAbrechnungsarten,
  entferne,
  hole,
  istRegistriert,
  registriere,
  type Abrechnungsart,
} from '../../src/server/services/finanz/abrechnungsart/index.js';
import {
  alsTag, monateDerPeriode, pruefeParameter, tageImMonat, zerlegeTag,
  type VertragAbrechnung,
} from '../../src/server/services/finanz/abrechnungsart/typen.js';

function konfiguration(
  art: string, parameter: Record<string, unknown> = {},
  modus = 'kalendermonat',
): VertragAbrechnung {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    mandantId: '00000000-0000-0000-0000-000000000002',
    auftragId: '00000000-0000-0000-0000-000000000003',
    auftragLeistungId: null,
    abrechnungsart: art,
    parameter,
    pauschaleNettoCent: null,
    stundensatzCent: null,
    festpreisNettoCent: null,
    mindestabnahmeStunden: null,
    abrechnungsintervall: 'monatlich',
    leistungszeitraumModus: modus,
    zahlungszielTage: null,
    reverseCharge13b: false,
    unterliegtBauabzugsteuer: false,
    gueltigAb: '2026-01-01',
    gueltigBis: null,
  };
}

describe('das Register der fünf — und der sechsten (Abnahme 5)', () => {
  it('kennt genau die fünf Namen aus FIN-01', () => {
    expect(alleAbrechnungsarten().map((a) => a.schluessel).sort())
      .toEqual([...ABRECHNUNGSARTEN].sort());
  });

  it('jede der fünf ist als provisorisch markiert (O-04)', () => {
    // Eine Art ohne diese Marke behauptet, jemand hätte ihre Regeln bestätigt.
    expect(alleAbrechnungsarten().filter((a) => !a.istProvisorisch)).toEqual([]);
  });

  it('jede der fünf nennt mindestens eine offene Frage, und jede trägt O-04', () => {
    for (const art of alleAbrechnungsarten()) {
      expect(art.offeneParameter.length, art.schluessel).toBeGreaterThan(0);
      for (const p of art.offeneParameter) {
        expect(p.offeneFrage, `${art.schluessel}.${p.schluessel}`).toBe('O-04');
        // Die Frage steht im Klartext, damit die Oberfläche sie stellen kann.
        expect(p.frage.length, `${art.schluessel}.${p.schluessel}`).toBeGreaterThan(20);
      }
    }
  });

  it('eine sechste trägt sich ein, ohne dass eine der fünf sich ändert', () => {
    const doppel: Abrechnungsart = {
      schluessel: 'kern_pruef_art',
      bezeichnung: 'Prüf-Art',
      istProvisorisch: true,
      offeneParameter: [],
      pruefe: () => Promise.resolve([]),
      positionen: () => Promise.resolve([]),
    };
    expect(istRegistriert('kern_pruef_art')).toBe(false);
    registriere(doppel);
    try {
      expect(hole('kern_pruef_art')).toBe(doppel);
      expect(alleAbrechnungsarten()).toHaveLength(ABRECHNUNGSARTEN.length + 1);
    } finally {
      entferne('kern_pruef_art');
    }
    expect(istRegistriert('kern_pruef_art')).toBe(false);
  });

  it('ein unbekannter Schlüssel wirft — es gibt keine Standardart', () => {
    // Ein Rückfall auf „dann eben stundenbasiert" wäre eine Rechnung nach
    // einer Regel, die im Vertrag nicht steht, und sie ist eine Sekunde
    // später festgeschrieben und unveränderlich.
    try {
      hole('gibt_es_nicht');
      expect.unreachable('hole() hätte werfen müssen');
    } catch (e) {
      expect(e).toBeInstanceOf(AbrechnungFehler);
      expect((e as AbrechnungFehler).grund).toBe('unbekannte_abrechnungsart');
    }
  });
});

describe('der Kalender ist der gregorianische, nicht die Systemzeitzone', () => {
  it('kennt die Schaltjahrregel bis zur Hundert- und Vierhundertgrenze', () => {
    expect(tageImMonat(2026, 2)).toBe(28);
    expect(tageImMonat(2028, 2)).toBe(29);
    expect(tageImMonat(1900, 2)).toBe(28);
    expect(tageImMonat(2000, 2)).toBe(29);
  });

  it('ein Quartal zerfällt in drei Monatsabschnitte, jeder voll', () => {
    expect(monateDerPeriode({ von: '2026-07-01', bis: '2026-09-30' })).toEqual([
      { von: '2026-07-01', bis: '2026-07-31' },
      { von: '2026-08-01', bis: '2026-08-31' },
      { von: '2026-09-01', bis: '2026-09-30' },
    ]);
  });

  it('ein angebrochener erster und letzter Monat bleiben angebrochen', () => {
    expect(monateDerPeriode({ von: '2026-01-20', bis: '2026-03-10' })).toEqual([
      { von: '2026-01-20', bis: '2026-01-31' },
      { von: '2026-02-01', bis: '2026-02-28' },
      { von: '2026-03-01', bis: '2026-03-10' },
    ]);
  });

  it('ein Zeitraum über den Jahreswechsel zählt richtig weiter', () => {
    expect(monateDerPeriode({ von: '2026-12-15', bis: '2027-01-14' })).toEqual([
      { von: '2026-12-15', bis: '2026-12-31' },
      { von: '2027-01-01', bis: '2027-01-14' },
    ]);
  });

  it('ein Zeitraum, der vor seinem Beginn endet, wird abgewiesen', () => {
    expect(() => monateDerPeriode({ von: '2026-08-31', bis: '2026-08-01' }))
      .toThrow(AbrechnungFehler);
  });

  it('ein Tag in falscher Form wird abgewiesen statt geraten', () => {
    // `31.08.2026` ist deutsche Anzeige, kein Kalendertag der Schnittstelle.
    expect(() => zerlegeTag('31.08.2026')).toThrow(AbrechnungFehler);
    expect(alsTag(2026, 8, 1)).toBe('2026-08-01');
  });
});

describe('ein fehlender Parameter blockiert, bevor gerechnet wird', () => {
  it('meldet den Schlüssel, die Frage und die offene Nummer', () => {
    const art = hole('stundenbasiert');
    const befunde = pruefeParameter(art, konfiguration('stundenbasiert'));
    const treffer = befunde.find((b) => b.feld === 'parameter.minuten_rundung');
    expect(treffer?.art).toBe('fehler');
    expect(treffer?.offeneFrage).toBe('O-04');
    expect(treffer?.textDe).toMatch(/Unbestätigter Wert/u);
  });

  it('ein Wert ausserhalb der zulässigen Liste ist ebenfalls ein Fehler', () => {
    const art = hole('stundenbasiert');
    const befunde = pruefeParameter(art, konfiguration('stundenbasiert', { minuten_rundung: 7 }));
    expect(befunde.some((b) => b.feld === 'parameter.minuten_rundung')).toBe(true);
  });

  it('mit gesetztem Parameter bleibt kein Befund übrig', () => {
    const art = hole('stundenbasiert');
    expect(pruefeParameter(art, konfiguration('stundenbasiert', { minuten_rundung: 15 })))
      .toEqual([]);
  });

  it('`nach_leistungsnachweis` blockiert für sich allein (FIN-05, O-54)', () => {
    /**
     * FIN-05 nennt den Leistungszeitraum das am häufigsten fehlende
     * Pflichtfeld und hält fest, dass sein Fehlen dem Kunden den
     * Vorsteuerabzug kostet. Wie er aus einem Leistungsnachweis hergeleitet
     * wird, ist offen — also wird nicht der Kalendermonat unterstellt.
     */
    const art = hole('monatspauschale');
    const befunde = pruefeParameter(
      art,
      konfiguration('monatspauschale', { teilmonat: 'keine' }, 'nach_leistungsnachweis'),
    );
    const treffer = befunde.find((b) => b.feld === 'leistungszeitraum_modus');
    expect(treffer?.art).toBe('fehler');
    expect(treffer?.offeneFrage).toBe('O-54');
  });
});
