/**
 * Ausfall und Zusatztermin eines Turnus mindern bzw. erhöhen die
 * Monatspauschale (V-327, O-146, O-700, D-850) — was ohne Datenbank
 * entschieden wird.
 *
 * Was die Datenbank hält — die Turnusse der Vereinbarung über
 * `fin.turnusse_der_abrechnung`, auch ohne `reinigung.lesen`, und die Zeilen
 * auf einem echten Entwurf —, steht in `tests/isolation/abrechnungsart.test.ts`.
 * Hier:
 *
 *  1. Die Regeltermine des Monats: nach Feiertagsregel und Gültigkeit, vor
 *     den Ausnahmen, je Turnus addiert — der Nenner.
 *  2. Welche Ausnahmen zählen: ein Ausfall nur an einem Regeltermin, nur
 *     abrechnungsrelevant, je Tag einmal; ein Zusatztermin für sich; eine
 *     Verschiebung nie; „ohne Angabe" wird gezählt, nicht gerechnet.
 *  3. Das Geld: Termine als Menge, Regeltermine als Basismenge, die
 *     Pauschale als Preis — eine Rundung je Zeile.
 *  4. Die Prüfung sagt vorher, was nicht geht und was nicht zählt.
 *  5. Die Verdrahtung.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cent } from '../../src/server/services/finanz/geld.js';
import { berechneNetto, type Abfrage } from '../../src/server/services/finanz/rechnung.js';
import {
  ganzeMenge, type VertragAbrechnung,
} from '../../src/server/services/finanz/abrechnungsart/typen.js';
import { MONATSPAUSCHALE } from '../../src/server/services/finanz/abrechnungsart/monatspauschale.js';
import {
  turnusImAbschnitt, type AbrechnungsAusnahme, type AbrechnungsTurnus, type TurnusDaten,
} from '../../src/server/services/finanz/abrechnungsart/turnusausfall.js';

const OKTOBER = { von: '2026-10-01', bis: '2026-10-31' };
const DEZEMBER = { von: '2026-12-01', bis: '2026-12-31' };

/** Montag, Mittwoch, Freitag um 06:00 — im Oktober 2026 dreizehn Termine. */
const MO_MI_FR: AbrechnungsTurnus = {
  id: 't1', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', ankerDatum: '2026-01-05', ankerStunde: 6,
  ankerMinute: 0, dauerMinuten: 120, feiertagsregel: 'ausfall', gueltigAb: '2026-01-01',
  gueltigBis: null,
};

let laufend = 0;
const ausnahme = (
  datum: string, art: AbrechnungsAusnahme['art'], relevant: boolean | null, turnusId = 't1',
): AbrechnungsAusnahme => {
  laufend += 1;
  return { id: `a${String(laufend)}`, turnusId, datum, art, abrechnungsrelevant: relevant };
};

const daten = (
  ausnahmen: readonly AbrechnungsAusnahme[], turnusse: readonly AbrechnungsTurnus[] = [MO_MI_FR],
): TurnusDaten => ({ turnusse, ausnahmen });

describe('(1) die Regeltermine des Monats — der Nenner', () => {
  it('Montag, Mittwoch, Freitag im Oktober 2026: dreizehn', () => {
    expect(turnusImAbschnitt(daten([]), OKTOBER, OKTOBER).termine).toBe(13);
  });

  it('der erste Weihnachtstag fällt nach der Feiertagsregel aus — unverändert zählt er', () => {
    expect(turnusImAbschnitt(daten([]), DEZEMBER, DEZEMBER).termine).toBe(12);
    const unveraendert = { ...MO_MI_FR, feiertagsregel: 'unveraendert' as const };
    expect(turnusImAbschnitt(daten([], [unveraendert]), DEZEMBER, DEZEMBER).termine).toBe(13);
  });

  it('die Gültigkeit schneidet — und mehrere Turnusse addieren sich', () => {
    const bisMitte = { ...MO_MI_FR, gueltigBis: '2026-10-15' };
    expect(turnusImAbschnitt(daten([], [bisMitte]), OKTOBER, OKTOBER).termine).toBe(6);
    const monatlich: AbrechnungsTurnus = {
      ...MO_MI_FR, id: 't2', rrule: 'FREQ=MONTHLY;BYMONTHDAY=5', ankerDatum: '2026-01-05',
    };
    expect(turnusImAbschnitt(daten([], [MO_MI_FR, monatlich]), OKTOBER, OKTOBER).termine).toBe(14);
  });

  it('der Nenner gehört dem ganzen Monat, auch im angebrochenen Abschnitt', () => {
    const zweiteHaelfte = { von: '2026-10-16', bis: '2026-10-31' };
    expect(turnusImAbschnitt(daten([]), OKTOBER, zweiteHaelfte).termine).toBe(13);
  });
});

describe('(2) welche Ausnahmen zählen', () => {
  const OKTOBER_AUSNAHMEN = [
    ausnahme('2026-10-12', 'ausfall', true),
    ausnahme('2026-10-14', 'ausfall', true),
    ausnahme('2026-10-13', 'ausfall', true),      // Dienstag — kein Regeltermin
    ausnahme('2026-10-16', 'ausfall', false),     // nach Vereinbarung nicht abrechnungsrelevant
    ausnahme('2026-10-19', 'ausfall', null),      // ohne Angabe
    ausnahme('2026-10-24', 'zusatz', true),
    ausnahme('2026-10-21', 'verschiebung', true),
    ausnahme('2026-10-12', 'ausfall', true),      // derselbe Tag ein zweites Mal
    ausnahme('2026-10-26', 'ausfall', true, 't9'), // ein anderer Turnus
  ];

  it('zwei Ausfälle, ein Zusatztermin, eine ohne Angabe — der Rest ändert nichts', () => {
    expect(turnusImAbschnitt(daten(OKTOBER_AUSNAHMEN), OKTOBER, OKTOBER)).toEqual({
      termine: 13,
      ausfaelle: ['2026-10-12', '2026-10-14'],
      zusaetze: ['2026-10-24'],
      ohneAngabe: 1,
    });
  });

  it('gezählt wird nur im Abschnitt', () => {
    expect(turnusImAbschnitt(daten(OKTOBER_AUSNAHMEN), OKTOBER, { von: '2026-10-16', bis: '2026-10-31' }))
      .toEqual({ termine: 13, ausfaelle: [], zusaetze: ['2026-10-24'], ohneAngabe: 1 });
  });

  it('ein Ausfall am Feiertag, den die Regel ohnehin streicht, mindert nichts', () => {
    const weihnachten = [ausnahme('2026-12-25', 'ausfall', true)];
    expect(turnusImAbschnitt(daten(weihnachten), DEZEMBER, DEZEMBER).ausfaelle).toEqual([]);
    const unveraendert = { ...MO_MI_FR, feiertagsregel: 'unveraendert' as const };
    expect(turnusImAbschnitt(daten(weihnachten, [unveraendert]), DEZEMBER, DEZEMBER).ausfaelle)
      .toEqual(['2026-12-25']);
  });
});

describe('(3) das Geld — eine Rundung je Zeile', () => {
  it('zwei von dreizehn Terminen mindern 1.890,00 € um 290,77 €, ein Zusatztermin kostet 145,38 €', () => {
    const pauschale = cent(189_000n);
    const basis = ganzeMenge(13);
    // 2 × 189000 / 13 = 29076,92… → 29077, mit Vorzeichen
    expect(berechneNetto(ganzeMenge(-2), basis, pauschale, 0)).toBe(cent(-29_077n));
    // 189000 / 13 = 14538,46… → 14538
    expect(berechneNetto(ganzeMenge(1), basis, pauschale, 0)).toBe(cent(14_538n));
  });

  it('alle Termine ausgefallen: genau die Pauschale, kein Cent mehr', () => {
    expect(berechneNetto(ganzeMenge(-13), ganzeMenge(13), cent(189_000n), 0)).toBe(cent(-189_000n));
  });
});

describe('(4) die Prüfung der Pauschale sagt es vorher', () => {
  const konfiguration: VertragAbrechnung = {
    id: '00000000-0000-0000-0000-000000000001',
    mandantId: '00000000-0000-0000-0000-000000000002',
    auftragId: '00000000-0000-0000-0000-000000000003',
    auftragLeistungId: '00000000-0000-0000-0000-000000000004',
    abrechnungsart: 'monatspauschale',
    parameter: { teilmonat: 'keine' },
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
    gueltigBis: null,
  };
  /** Ein Turnus am 31. jedes Monats — der November hat keinen. */
  const db = (ausnahmen: readonly object[]): Abfrage => ({
    abfrage: async <T,>(anweisung: string): Promise<readonly T[]> => {
      if (!anweisung.includes('fin.turnusse_der_abrechnung')) {
        throw new Error(`unerwartete Abfrage: ${anweisung}`);
      }
      return [{ daten: {
        turnusse: [{
          id: 't1', rrule: 'FREQ=MONTHLY;BYMONTHDAY=31', anker_datum: '2026-01-31',
          anker_stunde: 6, anker_minute: 0, dauer_minuten: 120, feiertagsregel: 'ausfall',
          gueltig_ab: '2026-01-01', gueltig_bis: null,
        }],
        ausnahmen,
      } }] as unknown as T[];
    },
  });
  const november = { von: '2026-11-01', bis: '2026-11-30' };

  it('ein Zusatztermin in einem Monat ohne Regeltermin hat keinen Satz — Befund mit O-146', async () => {
    const befunde = await MONATSPAUSCHALE.pruefe(db([
      { id: 'a1', turnus_id: 't1', datum: '2026-11-20', art: 'zusatz', abrechnungsrelevant: true },
    ]), { konfiguration, periode: november, bisher: [] });
    expect(befunde.filter((b) => b.offeneFrage === 'O-146')).toEqual([
      expect.objectContaining({ art: 'fehler', feld: 'turnus_ausnahme.abrechnungsrelevant' }),
    ]);
  });

  it('eine Ausnahme ohne Angabe ist eine Warnung, keine Sperre', async () => {
    const befunde = await MONATSPAUSCHALE.pruefe(db([
      { id: 'a1', turnus_id: 't1', datum: '2026-11-20', art: 'zusatz', abrechnungsrelevant: null },
    ]), { konfiguration, periode: november, bisher: [] });
    expect(befunde).toEqual([
      expect.objectContaining({ art: 'warnung', offeneFrage: 'O-700' }),
    ]);
  });
});

describe('(5) Verdrahtung', () => {
  it('die Pauschale fragt die Turnusse über die Definer-Funktion und sagt die Voreinstellung', () => {
    const dienst = readFileSync('src/server/services/finanz/abrechnungsart/turnusausfall.ts', 'utf8');
    expect(dienst).toContain('// TODO(client, O-146): Voreinstellung');
    expect(dienst).toContain('fin.turnusse_der_abrechnung($1::uuid, $2::date, $3::date)');
    const pauschale = readFileSync('src/server/services/finanz/abrechnungsart/monatspauschale.ts', 'utf8');
    expect(pauschale.match(/entwuerfe\.push\(\.\.\.turnus\(abschnitt, zeitraum\)\)/gu)).toHaveLength(3);
    const migration = readFileSync('drizzle/0534_turnus_fuer_abrechnung.sql', 'utf8');
    expect(migration).toContain("app.hat_recht('abrechnung.lesen', v_mandant)");
    expect(migration).toContain('owner to cse_definer');
    // Der Grundtext einer Ausnahme verlässt die Funktion nicht.
    expect(migration).not.toMatch(/'grund'/u);
  });
});
