/**
 * PR 30 — RRULE-Entfaltung über die Berliner Wanduhr (CLN-02, TIM-02, K-11).
 *
 * Der erste Block ist der wichtige: eine wöchentliche Serie um 06:00 behält über
 * die Zeitumstellung hinweg 06:00 **Ortszeit**, während ihr Instant um eine Stunde
 * springt. Beides wird einzeln zugesichert, weil genau hier eine Entfaltung in UTC
 * durchkommt, die danach umrechnet: sie liefert am 30. März 05:00 Ortszeit, und
 * niemandem fällt es auf, bis die Kolonne eine Stunde zu früh vor verschlossener
 * Tür steht.
 *
 * Die Umstellungstermine sind die von K-11: Sonntag, 29. März 2026 (CET→CEST) und
 * Sonntag, 25. Oktober 2026 (CEST→CET).
 */
import { describe, expect, it } from 'vitest';
import { berlinTeile, dauerMinuten } from '../../src/server/services/zeit/dauer.js';
import {
  entfalte,
  leseRegel,
  loeseOrtszeitAuf,
  RegelFehler,
  ZEITANOMALIEN,
  type Vorkommnis,
} from '../../src/lib/datum/rrule.js';

const um6 = { stunde: 6, minute: 0 } as const;
const iso = (v: readonly Vorkommnis[]): string[] => v.map((x) => x.beginnZeitpunkt.toISOString());
const tage = (v: readonly Vorkommnis[]): string[] => v.map((x) => x.planDatum);

describe('entfalte — die Wanduhr bleibt, der Instant springt (K-11)', () => {
  // 23. und 30. März 2026 sind Montage; dazwischen liegt die Vorstellung.
  const vorstellung = entfalte(
    'FREQ=WEEKLY;BYDAY=MO',
    { datum: '2026-03-23', ...um6 },
    { vonDatum: '2026-03-01', bisDatum: '2026-04-15' },
  );

  it('plant vier Montage, und jeder davon um 06:00 Ortszeit', () => {
    expect(tage(vorstellung)).toEqual(['2026-03-23', '2026-03-30', '2026-04-06', '2026-04-13']);
    for (const v of vorstellung) {
      expect(v.beginnLokal).toBe('06:00');
      // Nicht die gespeicherte Wanduhrzeit prüfen, sondern den Instant zurück
      // in Berliner Ortszeit lesen — sonst prüfte der Test seine eigene Eingabe.
      expect(berlinTeile(v.beginnZeitpunkt).stunde).toBe(6);
      expect(berlinTeile(v.beginnZeitpunkt).minute).toBe(0);
    }
  });

  it('verschiebt dabei den Instant um genau eine Stunde (05:00Z → 04:00Z)', () => {
    expect(iso(vorstellung)).toEqual([
      '2026-03-23T05:00:00.000Z', // CET
      '2026-03-30T04:00:00.000Z', // CEST — eine Stunde früher in UTC
      '2026-04-06T04:00:00.000Z',
      '2026-04-13T04:00:00.000Z',
    ]);
  });

  // 19. und 26. Oktober 2026 sind Montage; dazwischen liegt die Rückstellung.
  const rueckstellung = entfalte(
    'FREQ=WEEKLY;BYDAY=MO',
    { datum: '2026-10-19', ...um6 },
    { vonDatum: '2026-10-01', bisDatum: '2026-11-02' },
  );

  it('hält 06:00 Ortszeit auch über die Rückstellung, während der Instant zurückspringt', () => {
    expect(tage(rueckstellung)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    for (const v of rueckstellung) expect(berlinTeile(v.beginnZeitpunkt).stunde).toBe(6);
    expect(iso(rueckstellung)).toEqual([
      '2026-10-19T04:00:00.000Z', // CEST
      '2026-10-26T05:00:00.000Z', // CET
      '2026-11-02T05:00:00.000Z',
    ]);
  });

  it('lässt zwischen zwei 22:00-Vorkommnissen der Umstellungsnacht 23 Stunden', () => {
    // Die Nachtschichtserie: die Wanduhr sagt beide Male 22:00, der Abstand der
    // Instants sagt 23 Stunden. Gemessen mit `dauerMinuten` — die Dauer bleibt die
    // Differenz zweier Instants, hier wie überall (Invariante 2).
    const nacht = entfalte(
      'FREQ=DAILY',
      { datum: '2026-03-27', stunde: 22, minute: 0 },
      { vonDatum: '2026-03-27', bisDatum: '2026-03-30' },
    );
    expect(nacht.map((x) => x.beginnLokal)).toEqual(['22:00', '22:00', '22:00', '22:00']);
    const [fr, sa, so] = iso(nacht);
    expect([fr, sa, so]).toEqual([
      '2026-03-27T21:00:00.000Z',
      '2026-03-28T21:00:00.000Z',
      '2026-03-29T20:00:00.000Z',
    ]);
    const minuten = (a: string | undefined, b: string | undefined): number =>
      dauerMinuten(new Date(String(a)), new Date(String(b)));
    expect(minuten(fr, sa)).toBe(24 * 60);
    expect(minuten(sa, so)).toBe(23 * 60);
  });

  it('trägt an gewöhnlichen Tagen keine Anomalie', () => {
    for (const v of [...vorstellung, ...rueckstellung]) expect(v.anomalie).toBe('keine');
  });
});

describe('entfalte — INTERVAL, BYDAY, COUNT, UNTIL', () => {
  it('INTERVAL=2 zählt Wochen ab der Ankerwoche, nicht Tage ab dem Anker', () => {
    const v = entfalte(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
      { datum: '2026-03-23', ...um6 },
      { vonDatum: '2026-03-01', bisDatum: '2026-05-01' },
    );
    expect(tage(v)).toEqual(['2026-03-23', '2026-04-06', '2026-04-20']);
    expect(tage(v)).not.toContain('2026-03-30');
  });

  it('BYDAY mit mehreren Tagen liefert sie in kalendarischer Reihenfolge', () => {
    // Anker ist ein Dienstag, den die Regel nicht nennt: RFC 5545 nennt eine Serie
    // mit unsynchronisiertem DTSTART „undefined" — hier entsteht keine
    // Geisterschicht am Dienstag, und auch keine am Montag VOR dem Anker.
    const v = entfalte(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      { datum: '2026-05-05', ...um6 },
      { vonDatum: '2026-05-01', bisDatum: '2026-05-15' },
    );
    expect(tage(v)).toEqual([
      '2026-05-06',
      '2026-05-08',
      '2026-05-11',
      '2026-05-13',
      '2026-05-15',
    ]);
    expect(tage(v)).not.toContain('2026-05-04');
    expect(tage(v)).not.toContain('2026-05-05');
  });

  it('COUNT zählt ab dem Anker, nicht ab dem Fenster', () => {
    // Der Generator läuft jede Nacht mit wanderndem Fenster. Zählte COUNT ab
    // `vonDatum`, erzeugte diese Serie jede Nacht drei weitere Schichten.
    const v = entfalte(
      'FREQ=DAILY;COUNT=3',
      { datum: '2026-06-01', ...um6 },
      { vonDatum: '2026-06-03', bisDatum: '2026-06-30' },
    );
    expect(tage(v)).toEqual(['2026-06-03']);

    const ganz = entfalte(
      'FREQ=DAILY;COUNT=3',
      { datum: '2026-06-01', ...um6 },
      { vonDatum: '2026-06-01', bisDatum: '2026-06-30' },
    );
    expect(tage(ganz)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });

  it('UNTIL als Datum schliesst den genannten Tag ein', () => {
    const v = entfalte(
      'FREQ=DAILY;UNTIL=20260603',
      { datum: '2026-06-01', ...um6 },
      { vonDatum: '2026-06-01', bisDatum: '2026-06-30' },
    );
    expect(tage(v)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });

  it('UNTIL als UTC-Zeitpunkt wird am Instant verglichen, nicht am Tag', () => {
    // 06:00 Ortszeit ist im Juni 04:00Z. Die Grenze liegt am 3. Juni um 03:59:59Z,
    // also VOR dem Vorkommnis dieses Tages — es fällt weg.
    const v = entfalte(
      'FREQ=DAILY;UNTIL=20260603T035959Z',
      { datum: '2026-06-01', ...um6 },
      { vonDatum: '2026-06-01', bisDatum: '2026-06-30' },
    );
    expect(tage(v)).toEqual(['2026-06-01', '2026-06-02']);
  });

  it('liest die Komponenten in beliebiger Reihenfolge (RFC 5545 legt keine fest)', () => {
    const regel = leseRegel('INTERVAL=2;FREQ=WEEKLY;BYDAY=MO,WE');
    expect(regel.freq).toBe('WEEKLY');
    expect(regel.interval).toBe(2);
    expect(regel.byday).toEqual(['MO', 'WE']);
  });
});

describe('entfalte — MONTHLY und der 31. eines 30-tägigen Monats', () => {
  /**
   * RFC 5545 §3.3.10: „Recurrence instances with an invalid date … MUST be
   * ignored and MUST NOT be counted as part of the recurrence set." Der 31.
   * April existiert nicht, also entsteht kein Vorkommnis — und der ausgefallene
   * Termin verbraucht auch kein COUNT. Die Alternative wäre, auf den 30. oder auf
   * den 1. Mai auszuweichen; beides erfände eine Geschäftsregel (die Schicht
   * stünde an einem Tag, den niemand geplant hat) und beides widerspräche dem RFC.
   */
  it('überspringt Monate ohne den genannten Tag, statt auszuweichen', () => {
    const v = entfalte(
      'FREQ=MONTHLY;BYMONTHDAY=31',
      { datum: '2026-01-31', ...um6 },
      { vonDatum: '2026-01-01', bisDatum: '2026-07-31' },
    );
    expect(tage(v)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  });

  it('zählt den ausgefallenen 31. nicht gegen COUNT', () => {
    const v = entfalte(
      'FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3',
      { datum: '2026-01-31', ...um6 },
      { vonDatum: '2026-01-01', bisDatum: '2026-12-31' },
    );
    expect(tage(v)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('nimmt ohne BYMONTHDAY den Monatstag des Ankers', () => {
    const v = entfalte(
      'FREQ=MONTHLY;INTERVAL=2',
      { datum: '2026-01-15', ...um6 },
      { vonDatum: '2026-01-01', bisDatum: '2026-06-30' },
    );
    expect(tage(v)).toEqual(['2026-01-15', '2026-03-15', '2026-05-15']);
  });
});

describe('loeseOrtszeitAuf — die beiden pathologischen Ortszeiten (§7.2)', () => {
  it('02:30 in der Nacht der Vorstellung gibt es nicht: dst_luecke', () => {
    const a = loeseOrtszeitAuf('2026-03-29', 2, 30);
    expect(a.anomalie).toBe('dst_luecke');
    // Aufgelöst wird nach vorn: aus 02:30 wird real 03:30 Ortszeit. Genau
    // deshalb muss die Anomalie an den Einsatz — sonst steht in `beginn_lokal`
    // eine Uhrzeit, die der Instant nicht trägt, und niemand weiss davon.
    expect(berlinTeile(a.zeitpunkt).stunde).toBe(3);
    expect(berlinTeile(a.zeitpunkt).minute).toBe(30);
  });

  it('02:30 in der Nacht der Rückstellung gibt es zweimal: dst_doppelt, früherer Instant', () => {
    const a = loeseOrtszeitAuf('2026-10-25', 2, 30);
    expect(a.anomalie).toBe('dst_doppelt');
    // 00:30Z ist die CEST-Lesart, 01:30Z die CET-Lesart derselben Wanduhrzeit.
    // Die Vorgabe ist die frühere (§7.2, O-163) — die längere, besser bezahlte
    // Schicht. Dass das eine Vergütungsfrage ist, ist der Grund für O-163.
    expect(a.zeitpunkt.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(berlinTeile(a.zeitpunkt).stunde).toBe(2);
  });

  it('lässt die Wahl des Instants austauschen, ohne die Erkennung zu ändern', () => {
    const spaeter = loeseOrtszeitAuf('2026-10-25', 2, 30, {
      beiUeberlappung: (kandidaten) => kandidaten[1],
    });
    expect(spaeter.anomalie).toBe('dst_doppelt');
    expect(spaeter.zeitpunkt.toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect(dauerMinuten(loeseOrtszeitAuf('2026-10-25', 2, 30).zeitpunkt, spaeter.zeitpunkt)).toBe(60);
  });

  it('trägt die Anomalie bis ins entfaltete Vorkommnis', () => {
    const v = entfalte(
      'FREQ=DAILY',
      { datum: '2026-10-24', stunde: 2, minute: 30 },
      { vonDatum: '2026-10-24', bisDatum: '2026-10-26' },
    );
    expect(v.map((x) => x.anomalie)).toEqual(['keine', 'dst_doppelt', 'keine']);
    // Die geplante Wanduhrzeit bleibt stehen — sie ist der Beweis dessen, was
    // geplant war (§5.3), und der Idempotenzschlüssel hängt daran (§8.3).
    expect(v.map((x) => x.beginnLokal)).toEqual(['02:30', '02:30', '02:30']);
    for (const x of v) expect(ZEITANOMALIEN).toContain(x.anomalie);
  });
});

describe('leseRegel — unbekanntes wird abgewiesen, nicht überlesen', () => {
  const abgewiesen: readonly [string, string][] = [
    ['FREQ=WEEKLY;BYDAY=MO,WE,FR;BYSETPOS=1', 'BYSETPOS plant sonst drei Schichten statt einer'],
    ['FREQ=MONTHLY;BYMONTH=3', 'BYMONTH'],
    ['FREQ=WEEKLY;WKST=SU', 'WKST verschiebt bei INTERVAL>1 jede zweite Woche'],
    ['FREQ=YEARLY', 'FREQ=YEARLY'],
    ['FREQ=HOURLY', 'FREQ=HOURLY'],
    ['FREQ=MONTHLY;BYDAY=2MO', 'gezählter Wochentag'],
    ['FREQ=WEEKLY;BYDAY=2MO', 'gezählter Wochentag zu WEEKLY'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'negativer BYMONTHDAY'],
    ['FREQ=WEEKLY;BYMONTHDAY=15', 'BYMONTHDAY gehört zu MONTHLY'],
    ['FREQ=DAILY;COUNT=5;UNTIL=20260601', 'COUNT und UNTIL schliessen einander aus'],
    ['FREQ=DAILY;FREQ=WEEKLY', 'doppelte Komponente'],
    ['FREQ=DAILY;INTERVAL=0', 'INTERVAL=0 ergibt keine Serie'],
    ['RRULE:FREQ=DAILY', 'das Präfix gehört nicht in die Spalte'],
    ['DTSTART=20260301T060000;FREQ=DAILY', 'Anker gehören in ihre eigene Spalte'],
    ['FREQ=DAILY;INTERVAL', 'Komponente ohne Wert'],
    ['', 'leere Regel'],
  ];

  for (const [regel, warum] of abgewiesen) {
    it(`weist ${JSON.stringify(regel)} ab — ${warum}`, () => {
      expect(() => leseRegel(regel)).toThrow(RegelFehler);
      expect(() =>
        entfalte(regel, { datum: '2026-03-02', ...um6 }, { vonDatum: '2026-03-01', bisDatum: '2026-03-31' }),
      ).toThrow(RegelFehler);
    });
  }

  it('nennt im Fehlertext, was unterstützt ist', () => {
    expect(() => leseRegel('FREQ=WEEKLY;BYSETPOS=1')).toThrow(/BYSETPOS/u);
    expect(() => leseRegel('FREQ=WEEKLY;BYSETPOS=1')).toThrow(/BYDAY/u);
  });

  it('weist ein Fenster ab, dessen Ende vor seinem Beginn liegt', () => {
    expect(() =>
      entfalte('FREQ=DAILY', { datum: '2026-03-02', ...um6 }, { vonDatum: '2026-03-31', bisDatum: '2026-03-01' }),
    ).toThrow(RegelFehler);
  });

  it('weist einen Anker ab, den der Kalender nicht kennt', () => {
    expect(() =>
      entfalte('FREQ=DAILY', { datum: '2026-02-30', ...um6 }, { vonDatum: '2026-03-01', bisDatum: '2026-03-31' }),
    ).toThrow(RegelFehler);
  });
});
