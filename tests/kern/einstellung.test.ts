/**
 * Die Einstellung, ohne Datenbank (D-09, EMP-14, §5.12).
 *
 * Geprüft wird hier genau das, was eine reine Funktion beantworten kann: was
 * eine gültige Eingabe ist, und in welchem Zustand eine Beschäftigung
 * ENTSTEHT. Beides hat je einen Grenzfall, der teuer ist und den man im
 * Browser nicht sieht — eine leere Personalnummer (der Schlüssel, unter dem
 * die Gesellschaft die Zeile führt) und ein Eintritt in der Zukunft, der
 * sonst als `aktiv` in jeder Auswertung „wer arbeitet hier" mitzählt.
 */
import { describe, expect, it } from 'vitest';
import {
  EinstellungFehler, SPRACHEN, pruefeEingabe, statusFuerEintritt,
} from '../../src/server/services/personal/einstellung.js';

const BESTEHEND = '11111111-2222-3333-4444-555555555555';

function bestehend(ueber: Record<string, unknown> = {}) {
  return {
    mensch: { art: 'bestehend' as const, personId: BESTEHEND },
    personalnummer: 'R-4711',
    eintritt: '2026-04-01',
    ...ueber,
  };
}

function neu(ueber: Record<string, unknown> = {}) {
  return {
    mensch: {
      art: 'neu' as const, vorname: 'Aylin', nachname: 'Yildiz',
      telefon: null, sprache: 'tr',
    },
    personalnummer: 'R-4712',
    eintritt: '2026-04-01',
    ...ueber,
  };
}

describe('pruefeEingabe — die Beschäftigungsseite', () => {
  it('nimmt eine vollständige Eingabe an und gibt sie getrimmt zurück', () => {
    const g = pruefeEingabe(bestehend({ personalnummer: '  R-4711  ' }));
    expect(g.personalnummer).toBe('R-4711');
    expect(g.mensch).toEqual({ art: 'bestehend', personId: BESTEHEND });
  });

  it('ohne Personalnummer nicht — sie ist der Schlüssel der Gesellschaft (D-09)', () => {
    expect(() => pruefeEingabe(bestehend({ personalnummer: '   ' })))
      .toThrow(EinstellungFehler);
    expect(() => pruefeEingabe(bestehend({ personalnummer: '' })))
      .toThrow(/Personalnummer ist Pflicht/u);
  });

  it('und nicht mit einem Eintritt, der kein Kalendertag ist', () => {
    // `01.04.2026`, `2026-4-1` und ein Zeitpunkt sind drei Arten, dieselbe
    // Spalte falsch zu füllen — `eintritt` ist ein `date` (Invariante 2).
    for (const krumm of ['01.04.2026', '2026-4-1', '2026-04-01T06:00:00Z', 'morgen']) {
      expect(() => pruefeEingabe(bestehend({ eintritt: krumm })), krumm)
        .toThrow(/Kalendertag/u);
    }
  });

  it('ein fehlender Mensch ist kein leeres Feld, sondern ein Abbruch', () => {
    /*
     * Der Fall, um den es auf dieser Seite geht: gesendet wird ein Formular
     * ohne gewählte Person. Eine Beschäftigung ohne Menschen gibt es nicht
     * (D-09) — und ein `personId: ''` wäre in der Datenbank eine
     * Syntaxfehlermeldung statt einer Auskunft.
     */
    expect(() => pruefeEingabe(bestehend({
      mensch: { art: 'bestehend', personId: '' },
    }))).toThrow(/kein Mensch gewählt/u);
    expect(() => pruefeEingabe(bestehend({
      mensch: { art: 'bestehend', personId: 'nicht-uuid' },
    }))).toThrow(EinstellungFehler);
  });
});

describe('pruefeEingabe — der neue Mensch', () => {
  it('nimmt Vorname, Nachname, Telefon und eine der vier Sprachen', () => {
    const g = pruefeEingabe(neu());
    expect(g.mensch).toEqual({
      art: 'neu', vorname: 'Aylin', nachname: 'Yildiz', telefon: null, sprache: 'tr',
    });
  });

  it('trimmt, und macht aus einem leeren Telefonfeld `null` statt einer leeren Zeichenkette', () => {
    const g = pruefeEingabe(neu({
      mensch: { art: 'neu', vorname: ' Aylin ', nachname: ' Yildiz ', telefon: '   ', sprache: 'de' },
    }));
    expect(g.mensch).toMatchObject({ vorname: 'Aylin', nachname: 'Yildiz', telefon: null });
  });

  it('ohne Nachnamen nicht', () => {
    expect(() => pruefeEingabe(neu({
      mensch: { art: 'neu', vorname: 'Aylin', nachname: '  ', telefon: null, sprache: 'de' },
    }))).toThrow(/Vorname und Nachname sind Pflicht/u);
  });

  it('und nur mit einer Sprache aus EMP-12 — keine erfundene fünfte', () => {
    for (const s of SPRACHEN) {
      expect(pruefeEingabe(neu({
        mensch: { art: 'neu', vorname: 'A', nachname: 'B', telefon: null, sprache: s },
      })).mensch).toMatchObject({ sprache: s });
    }
    expect(() => pruefeEingabe(neu({
      mensch: { art: 'neu', vorname: 'A', nachname: 'B', telefon: null, sprache: 'pl' },
    }))).toThrow(/EMP-12/u);
  });
});

describe('statusFuerEintritt — der Kalender entscheidet, nicht der Klick', () => {
  it('heute heisst aktiv: der Eintritt ist der ERSTE Arbeitstag', () => {
    expect(statusFuerEintritt('2026-04-01', '2026-04-01')).toBe('aktiv');
  });

  it('gestern heisst aktiv — eine Nacherfassung macht niemanden zum Geplanten', () => {
    expect(statusFuerEintritt('2026-03-01', '2026-04-01')).toBe('aktiv');
  });

  it('morgen heisst geplant', () => {
    /*
     * Der Fall, der ohne diese Funktion falsch wäre: wer zum Ersten des
     * nächsten Monats anfängt, ist heute nicht beschäftigt. `aktiv` zählte
     * ihn in jeder Auswertung „wer arbeitet hier" mit — und niemand sähe es,
     * weil die Zeile völlig plausibel aussieht.
     */
    expect(statusFuerEintritt('2026-04-02', '2026-04-01')).toBe('geplant');
    expect(statusFuerEintritt('2027-01-01', '2026-12-31')).toBe('geplant');
  });

  it('der Vergleich ist lexikografisch — und `JJJJ-MM-TT` erlaubt das', () => {
    // Der Grund, warum die Kalendertage überall als `YYYY-MM-DD` stehen:
    // Zeichenkettenvergleich und Datumsvergleich fallen zusammen.
    expect(statusFuerEintritt('2026-09-09', '2026-09-10')).toBe('aktiv');
    expect(statusFuerEintritt('2026-10-01', '2026-09-30')).toBe('geplant');
  });
});
