/**
 * Was eine Serie im Fenster ergibt — die Rechnung ohne Datenbank.
 *
 * Die Faelle hier sind die aus der Abnahme von PR 30 (`08-PR-PLAN.md`), soweit
 * sie ohne Postgres pruefbar sind: Achtwochenhorizont, Ausnahmen, Feiertage
 * und die Stabilitaet des Idempotenzschluessels. Die Instantabstaende der
 * Zeitumstellung (480/420/540) stehen im Isolationstest, weil den Instant nach
 * §7.2 die Datenbank setzt und nicht dieser Prozess.
 */
import { describe, expect, it } from 'vitest';
import {
  ausnahmeSchluessel, nominalesEnde, planeVorkommnisse, PlanungsFehler, serienSchluessel,
  type Ausnahme, type Bedarfstraeger,
} from '@/server/services/dienstplan/vorkommnisse';

const SERIE = '11111111-1111-4111-8111-111111111111';

function traeger(ueber: Partial<Bedarfstraeger> = {}): Bedarfstraeger {
  return {
    planungsserieId: SERIE,
    quelle: 'turnus',
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    dtstartLokal: { datum: '2026-01-05', stunde: 6, minute: 0 }, // ein Montag
    zeitzone: 'Europe/Berlin',
    dauerMinuten: 180,
    sollBesetzung: 2,
    minBesetzung: 1,
    feiertagsregel: 'ausfall',
    gueltigAb: '2026-01-01',
    gueltigBis: null,
    ...ueber,
  };
}

const KEINE_FEIERTAGE = new Map<string, string>();

describe('der Achtwochenhorizont (TIM-03)', () => {
  it('eine woechentliche Serie ergibt genau acht Termine in 56 Tagen', () => {
    const { einsaetze } = planeVorkommnisse(
      traeger(), [], KEINE_FEIERTAGE, { vonDatum: '2026-01-05', bisDatum: '2026-03-01' },
    );
    expect(einsaetze).toHaveLength(8);
    expect(einsaetze[0]?.planDatum).toBe('2026-01-05');
    expect(einsaetze[7]?.planDatum).toBe('2026-02-23');
  });

  it('ein zweiter Lauf ueber dasselbe Fenster ergibt dieselben Schluessel', () => {
    const fenster = { vonDatum: '2026-01-05', bisDatum: '2026-03-01' };
    const a = planeVorkommnisse(traeger(), [], KEINE_FEIERTAGE, fenster);
    const b = planeVorkommnisse(traeger(), [], KEINE_FEIERTAGE, fenster);
    expect(b.einsaetze.map((e) => e.quellSchluessel))
      .toEqual(a.einsaetze.map((e) => e.quellSchluessel));
  });

  it('gueltig_bis schneidet das Fenster, statt hinterher zu filtern', () => {
    const { einsaetze } = planeVorkommnisse(
      traeger({ gueltigBis: '2026-01-26' }), [], KEINE_FEIERTAGE,
      { vonDatum: '2026-01-05', bisDatum: '2026-03-01' },
    );
    expect(einsaetze.map((e) => e.planDatum))
      .toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  it('eine Serie, deren Gueltigkeit vor dem Fenster endet, ergibt nichts', () => {
    const { einsaetze } = planeVorkommnisse(
      traeger({ gueltigBis: '2025-12-31' }), [], KEINE_FEIERTAGE,
      { vonDatum: '2026-01-05', bisDatum: '2026-03-01' },
    );
    expect(einsaetze).toEqual([]);
  });
});

describe('die Nachtschicht auf der Wanduhr (K-11)', () => {
  // 22:00 + 480 Minuten ist 06:00 — in JEDER Nacht. Der Unterschied der drei
  // Naechte steckt im Instantabstand, nicht in der Uhrzeit.
  const nacht = traeger({
    rrule: 'FREQ=DAILY',
    dtstartLokal: { datum: '2026-03-27', stunde: 22, minute: 0 },
    dauerMinuten: 480,
    gueltigAb: '2026-03-27',
  });

  it('endet um 06:00 am Folgetag — auch in der Nacht der Vorstellung', () => {
    const { einsaetze } = planeVorkommnisse(
      nacht, [], KEINE_FEIERTAGE, { vonDatum: '2026-03-27', bisDatum: '2026-03-29' },
    );
    expect(einsaetze).toHaveLength(3);
    for (const e of einsaetze) {
      expect(e.beginnLokal).toBe('22:00');
      expect(e.endeLokal).toBe('06:00');
      expect(e.endetAmFolgetag).toBe(true);
    }
    // Der 28.03. ist die Nacht der Vorstellung: der Plantag ist der ABEND davor.
    expect(einsaetze.map((e) => e.planDatum))
      .toEqual(['2026-03-27', '2026-03-28', '2026-03-29']);
  });

  it('eine Tagesschicht ueber Mitternacht hinaus meldet den Folgetag', () => {
    expect(nominalesEnde(22, 0, 480)).toEqual({ endeLokal: '06:00', endetAmFolgetag: true });
    expect(nominalesEnde(6, 0, 480)).toEqual({ endeLokal: '14:00', endetAmFolgetag: false });
    expect(nominalesEnde(23, 30, 30)).toEqual({ endeLokal: '00:00', endetAmFolgetag: true });
  });

  it('eine Dauer ueber 24 Stunden ist ein Tippfehler, kein Dienst', () => {
    expect(() => nominalesEnde(22, 0, 1440)).toThrow(PlanungsFehler);
    expect(() => nominalesEnde(22, 0, 0)).toThrow(PlanungsFehler);
    expect(() => nominalesEnde(22, 0, 28_800)).toThrow(/Sekunden/u);
  });
});

describe('Feiertage (CLN-03)', () => {
  const feiertage = new Map([['2026-10-05', 'Tag der Deutschen Einheit (verschoben)']]);
  const montags = traeger({ dtstartLokal: { datum: '2026-10-05', stunde: 6, minute: 0 },
    gueltigAb: '2026-10-01' });

  it('mit `ausfall` entsteht keine Schicht — und das steht in der Meldung', () => {
    const { einsaetze, uebersprungen } = planeVorkommnisse(
      montags, [], feiertage, { vonDatum: '2026-10-01', bisDatum: '2026-10-12' },
    );
    expect(einsaetze.map((e) => e.planDatum)).toEqual(['2026-10-12']);
    expect(uebersprungen).toEqual([{
      datum: '2026-10-05',
      quellSchluessel: serienSchluessel(SERIE, '2026-10-05', '06:00'),
      grund: 'feiertag',
      hinweis: 'Tag der Deutschen Einheit (verschoben)',
    }]);
  });

  it('mit `unveraendert` entsteht sie und traegt den Feiertag', () => {
    const { einsaetze, uebersprungen } = planeVorkommnisse(
      traeger({ ...montags, feiertagsregel: 'unveraendert' }), [], feiertage,
      { vonDatum: '2026-10-01', bisDatum: '2026-10-12' },
    );
    expect(einsaetze.map((e) => e.planDatum)).toEqual(['2026-10-05', '2026-10-12']);
    expect(einsaetze[0]?.feiertagDatum).toBe('2026-10-05');
    expect(einsaetze[1]?.feiertagDatum).toBeNull();
    expect(uebersprungen).toEqual([]);
  });
});

describe('Ausnahmen (§8.2 Schritt 3)', () => {
  const fenster = { vonDatum: '2026-01-05', bisDatum: '2026-02-02' };

  function ausnahme(ueber: Partial<Ausnahme>): Ausnahme {
    return {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', datum: '2026-01-12', art: 'ausfall',
      ersatzBeginnLokal: null, dauerMinuten: null, ...ueber,
    };
  }

  it('`ausfall` nimmt den Termin heraus und meldet ihn', () => {
    const { einsaetze, uebersprungen } = planeVorkommnisse(
      traeger(), [ausnahme({})], KEINE_FEIERTAGE, fenster,
    );
    expect(einsaetze.map((e) => e.planDatum)).not.toContain('2026-01-12');
    expect(uebersprungen[0]?.grund).toBe('ausnahme_ausfall');
  });

  it('`verschiebung` behaelt den Schluessel des Ursprungstermins', () => {
    // Das ist die Zusage, an der ein dritter Lauf sonst ein Duplikat anlegt.
    const { einsaetze } = planeVorkommnisse(
      traeger(),
      [ausnahme({ art: 'verschiebung', ersatzBeginnLokal: '2026-01-14T09:30' })],
      KEINE_FEIERTAGE, fenster,
    );
    const verschoben = einsaetze.find((e) => e.planDatum === '2026-01-14');
    expect(verschoben?.quellSchluessel).toBe(serienSchluessel(SERIE, '2026-01-12', '06:00'));
    expect(verschoben?.beginnLokal).toBe('09:30');
    expect(einsaetze.some((e) => e.planDatum === '2026-01-12')).toBe(false);
  });

  it('`verschiebung` darf eine eigene Dauer mitbringen', () => {
    const { einsaetze } = planeVorkommnisse(
      traeger(),
      [ausnahme({ art: 'verschiebung', ersatzBeginnLokal: '2026-01-14T09:30', dauerMinuten: 60 })],
      KEINE_FEIERTAGE, fenster,
    );
    expect(einsaetze.find((e) => e.planDatum === '2026-01-14')?.endeLokal).toBe('10:30');
  });

  it('`zusatz` bekommt einen eigenen Schluessel und traegt die Ausnahme als Herkunft', () => {
    const { einsaetze } = planeVorkommnisse(
      traeger(),
      [ausnahme({ art: 'zusatz', datum: '2026-01-14', ersatzBeginnLokal: '2026-01-14T18:00' })],
      KEINE_FEIERTAGE, fenster,
    );
    const zusatz = einsaetze.find((e) => e.planDatum === '2026-01-14');
    expect(zusatz?.quellSchluessel)
      .toBe(ausnahmeSchluessel('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    expect(zusatz?.herkunft).toBe('ausnahme');
  });

  it('ein `zusatz` am Feiertag bleibt stehen — wer ihn eintraegt, meint ihn', () => {
    const { einsaetze } = planeVorkommnisse(
      traeger({ gueltigAb: '2026-10-01', dtstartLokal: { datum: '2026-10-05', stunde: 6, minute: 0 } }),
      [ausnahme({ art: 'zusatz', datum: '2026-10-05', ersatzBeginnLokal: '2026-10-05T18:00' })],
      new Map([['2026-10-05', 'Feiertag']]),
      { vonDatum: '2026-10-01', bisDatum: '2026-10-12' },
    );
    // Die Regel faellt aus, der eigens eingetragene Zusatz nicht.
    expect(einsaetze.map((e) => e.planDatum)).toEqual(['2026-10-05', '2026-10-12']);
    expect(einsaetze[0]?.herkunft).toBe('ausnahme');
  });

  it('eine Verschiebung ohne Ersatzzeit ist kein Datensatz dieser Anwendung', () => {
    expect(() => planeVorkommnisse(
      traeger(), [ausnahme({ art: 'verschiebung' })], KEINE_FEIERTAGE, fenster,
    )).toThrow(PlanungsFehler);
  });
});

describe('der Idempotenzschluessel (§8.3)', () => {
  it('nennt Serie, urspruenglichen Tag und urspruengliche Zeit — nie das Objekt', () => {
    const s = serienSchluessel(SERIE, '2026-03-12', '06:00');
    expect(s).toBe(`serie:${SERIE}:20260312:0600`);
  });

  it('zwei Serien am selben Objekt zur selben Sekunde ergeben zwei Schluessel (TIM-04)', () => {
    const zweite = '22222222-2222-4222-8222-222222222222';
    expect(serienSchluessel(SERIE, '2026-03-12', '06:00'))
      .not.toBe(serienSchluessel(zweite, '2026-03-12', '06:00'));
  });

  it('bleibt unter der Laengengrenze der Spalte (8 … 200 Zeichen)', () => {
    const s = serienSchluessel(SERIE, '2026-03-12', '06:00');
    expect(s.length).toBeGreaterThanOrEqual(8);
    expect(s.length).toBeLessThanOrEqual(200);
  });
});

describe('die Veranstaltung ohne Wiederholungsregel (SEC-08)', () => {
  it('ergibt genau ein Fenster und geht durch dieselbe Rechnung', () => {
    const { einsaetze } = planeVorkommnisse(
      traeger({ quelle: 'veranstaltung', rrule: null,
        dtstartLokal: { datum: '2026-05-20', stunde: 18, minute: 30 }, dauerMinuten: 300,
        gueltigAb: '2026-05-01' }),
      [], KEINE_FEIERTAGE, { vonDatum: '2026-05-01', bisDatum: '2026-06-01' },
    );
    expect(einsaetze).toHaveLength(1);
    expect(einsaetze[0]?.beginnLokal).toBe('18:30');
    expect(einsaetze[0]?.endeLokal).toBe('23:30');
    expect(einsaetze[0]?.endetAmFolgetag).toBe(false);
  });
});
