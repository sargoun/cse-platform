/**
 * Ein angebrochener Monat der Pauschale nach Arbeitstagen (V-281, O-04,
 * O-167, D-843).
 *
 * Die Beträge gegen Postgres stehen in `tests/isolation/abrechnungsart.test.ts`
 * (1). Hier, was ohne Datenbank entschieden wird:
 *
 *  1. `arbeitstageZwischen` zählt Montag bis Freitag ohne die Tage der
 *     übergebenen Liste — die Liste ist die Eingabe, nicht eine Annahme.
 *     Die erwarteten Zahlen sind unabhängig nachgezählt (Ostern nach Gauß,
 *     Berliner Feiertage seit 2019 mit dem Frauentag).
 *  2. Die Berliner Liste enthält nur gesetzliche Feiertage — Heiligabend und
 *     Silvester sind Arbeitstage.
 *  3. `arbeitstageImAbschnitt` liefert Teil und Monat; daraus ergibt sich
 *     der Anteil der Pauschale.
 *  4. Die Prüfung verweigert den Modus nicht mehr, sagt aber, wenn im
 *     Zeitraum kein Arbeitstag liegt; eine anteilige Zeile beansprucht nur
 *     ihre Tage, die zweite Hälfte des Monats bleibt abrechenbar.
 */
import { describe, expect, it } from 'vitest';
import {
  arbeitstageZwischen, gesetzlicheFeiertageBerlin,
} from '../../src/lib/datum/werktage.js';
import {
  MONATSPAUSCHALE, arbeitstageImAbschnitt,
} from '../../src/server/services/finanz/abrechnungsart/monatspauschale.js';
import type {
  BisherigerAnspruch, VertragAbrechnung,
} from '../../src/server/services/finanz/abrechnungsart/typen.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import type { Abfrage } from '../../src/server/services/finanz/rechnung.js';

const berlin = (von: string, bis: string): number =>
  arbeitstageZwischen(von, bis, gesetzlicheFeiertageBerlin(von, bis));

describe('arbeitstageZwischen — die Liste ist die Eingabe', () => {
  it('ein Monat ohne Feiertag: August 2026 hat 21 Arbeitstage, der 1. bis 15. hat 10', () => {
    expect(berlin('2026-08-01', '2026-08-31')).toBe(21);
    expect(berlin('2026-08-01', '2026-08-15')).toBe(10);
  });

  it('Mai 2026: Tag der Arbeit, Himmelfahrt, Pfingstmontag fallen heraus', () => {
    expect(berlin('2026-05-01', '2026-05-31')).toBe(18);
    expect(berlin('2026-05-01', '2026-05-15')).toBe(9);
    expect(berlin('2026-05-16', '2026-05-31')).toBe(9);
  });

  it('Dezember 2026: der erste Weihnachtstag fällt heraus, Heiligabend und Silvester nicht', () => {
    expect(berlin('2026-12-01', '2026-12-31')).toBe(22);
    expect(berlin('2026-12-16', '2026-12-31')).toBe(11);
  });

  it('der Frauentag ist in Berlin ein Feiertag: März 2027 hat 20 Arbeitstage', () => {
    expect(berlin('2027-03-01', '2027-03-31')).toBe(20);
  });

  it('ein Wochenende hat keinen; ein einzelner Tag zählt sich selbst', () => {
    expect(berlin('2026-10-10', '2026-10-11')).toBe(0);
    expect(berlin('2026-10-07', '2026-10-07')).toBe(1);
  });

  it('dieselbe Zählung mit einer anderen Liste — das Land entscheidet, wer sie übergibt', () => {
    // Ohne Feiertage hat der Mai 2026 21 Arbeitstage; mit der Berliner Liste 18.
    expect(arbeitstageZwischen('2026-05-01', '2026-05-31', new Set())).toBe(21);
    expect(arbeitstageZwischen('2026-05-01', '2026-05-31', new Set(['2026-05-01']))).toBe(20);
  });

  it('eine falsche Eingabe wirft', () => {
    expect(() => berlin('2026-08-31', '2026-08-01')).toThrow(RangeError);
    expect(() => arbeitstageZwischen('1.8.2026', '2026-08-31', new Set())).toThrow(RangeError);
    expect(() => arbeitstageZwischen('2026-02-30', '2026-03-01', new Set())).toThrow(RangeError);
  });
});

describe('die Berliner Liste', () => {
  it('nur gesetzliche Feiertage, über den Jahreswechsel', () => {
    const liste = gesetzlicheFeiertageBerlin('2026-12-01', '2027-01-31');
    expect([...liste].sort()).toEqual(['2026-12-25', '2026-12-26', '2027-01-01']);
  });
});

describe('arbeitstageImAbschnitt — Teil und Monat', () => {
  it('liefert den Anteil, aus dem die Zeile rechnet', () => {
    expect(arbeitstageImAbschnitt({ von: '2026-08-01', bis: '2026-08-15' }))
      .toEqual({ tage: 10, imMonat: 21 });
    expect(arbeitstageImAbschnitt({ von: '2026-05-16', bis: '2026-05-31' }))
      .toEqual({ tage: 9, imMonat: 18 });
    expect(arbeitstageImAbschnitt({ von: '2026-10-10', bis: '2026-10-11' }))
      .toEqual({ tage: 0, imMonat: 22 });
  });
});

describe('die Prüfung der Pauschale im Modus „arbeitstage"', () => {
  /*
   * Ohne Datenbank — bis auf die eine Frage, die die Pauschale seit V-327
   * immer stellt: die Turnusse der Vereinbarung (hier keine). Jede andere
   * Abfrage wirft.
   */
  const ohneDb: Abfrage = {
    abfrage: async <T,>(anweisung: string): Promise<readonly T[]> => {
      if (anweisung.includes('fin.turnusse_der_abrechnung')) {
        return [{ daten: { turnusse: [], ausnahmen: [] } }] as unknown as T[];
      }
      throw new Error(`unerwartete Abfrage: ${anweisung}`);
    },
  };
  const konfiguration = (gueltigBis: string | null = null): VertragAbrechnung => ({
    id: '00000000-0000-0000-0000-000000000001',
    mandantId: '00000000-0000-0000-0000-000000000002',
    auftragId: '00000000-0000-0000-0000-000000000003',
    auftragLeistungId: null,
    abrechnungsart: 'monatspauschale',
    parameter: { teilmonat: 'arbeitstage' },
    pauschaleNettoCent: cent(189_000n),
    stundensatzCent: null,
    festpreisNettoCent: null,
    mindestabnahmeStunden: null,
    abrechnungsintervall: 'monatlich',
    leistungszeitraumModus: 'kalendermonat',
    zahlungszielTage: null,
    reverseCharge13b: false,
    unterliegtBauabzugsteuer: false,
    gueltigAb: '2026-01-01',
    gueltigBis,
  });

  it('ein angebrochener Monat ist kein Fehler mehr — er wird gerechnet', async () => {
    const befunde = await MONATSPAUSCHALE.pruefe(ohneDb, {
      konfiguration: konfiguration('2026-08-15'),
      periode: { von: '2026-08-01', bis: '2026-08-31' }, bisher: [],
    });
    expect(befunde.filter((b) => b.art === 'fehler')).toEqual([]);
  });

  it('liegt im Zeitraum kein Arbeitstag, sagt die Prüfung es — mit O-04', async () => {
    const befunde = await MONATSPAUSCHALE.pruefe(ohneDb, {
      konfiguration: konfiguration('2026-10-11'),
      periode: { von: '2026-10-10', bis: '2026-10-31' }, bisher: [],
    });
    const fehler = befunde.filter((b) => b.art === 'fehler');
    expect(fehler).toHaveLength(1);
    expect(fehler[0]!.offeneFrage).toBe('O-04');
    expect(fehler[0]!.textDe).toContain('kein Arbeitstag');
  });

  it('eine anteilige Zeile beansprucht nur ihre Tage — die zweite Hälfte bleibt frei', async () => {
    const erste: BisherigerAnspruch = {
      rechnungId: 'r', nummer: 'RE-00011', angelegtAm: '2026-10-16',
      leistungVon: '2026-10-01', leistungBis: '2026-10-15', nettoCent: cent(94_500n),
    };
    const zweite = await MONATSPAUSCHALE.pruefe(ohneDb, {
      konfiguration: konfiguration(),
      periode: { von: '2026-10-16', bis: '2026-10-31' }, bisher: [erste],
    });
    // Der 16. bis 31. ist ein voller Rest — aber kein voller MONAT: frei.
    expect(zweite.filter((b) => b.feld === 'leistung_von')).toEqual([]);
    const doppelt = await MONATSPAUSCHALE.pruefe(ohneDb, {
      konfiguration: konfiguration(),
      periode: { von: '2026-10-10', bis: '2026-10-20' }, bisher: [erste],
    });
    expect(doppelt.filter((b) => b.feld === 'leistung_von').map((b) => b.textDe).join(' '))
      .toContain('RE-00011');
  });
});
