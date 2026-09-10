/**
 * PR 1 acceptance (5)–(6) — the cross-entity ArbZG cases. TIM-14, LEG-03, D-09.
 *
 * Case (5) is the flagship: it is the reason K-06 exists, and the assertion
 * that the SAME shifts evaluated per employment return no breach is what
 * proves the aggregation is really personenbezogen rather than incidentally
 * passing.
 */
import { describe, expect, it } from 'vitest';
import {
  ARBZG_REGELN,
  pruefeArbzg,
  type Schicht,
} from '../../src/server/services/zeit/arbzg.js';
import { berlinTagesZeitpunkt, ZeitFehler } from '../../src/server/services/zeit/dauer.js';

const utc = (iso: string): Date => new Date(iso);

const PERSON = 'person-fatima';
const REINIGUNG = 'mandant-reinigung';
const SECURITY = 'mandant-security';

/** 6 h cleaning, 05:00–11:00 Berlin on 4 May 2026 (CEST, so 03:00Z–09:00Z). */
const reinigung6h: Schicht = {
  id: 'schicht-reinigung',
  personId: PERSON,
  mandantId: REINIGUNG,
  vonUtc: utc('2026-05-04T03:00:00Z'),
  bisUtc: utc('2026-05-04T09:00:00Z'),
  pauseMinuten: 0,
};

/** 5 h guarding, 14:00–19:00 Berlin the same day. */
const security5h: Schicht = {
  id: 'schicht-security',
  personId: PERSON,
  mandantId: SECURITY,
  vonUtc: utc('2026-05-04T12:00:00Z'),
  bisUtc: utc('2026-05-04T17:00:00Z'),
  pauseMinuten: 0,
};

describe('pruefeArbzg — §3 across employments (acceptance 5)', () => {
  const befunde = pruefeArbzg([reinigung6h, security5h]);

  it('raises BOTH §3 rules at 660 minutes on the Berlin calendar day', () => {
    const regeln = befunde.map((b) => b.regel);
    expect(regeln).toContain('tagesarbeitszeit_ueber_8h');
    expect(regeln).toContain('tagesarbeitszeit_ueber_10h');

    const acht = befunde.find((b) => b.regel === 'tagesarbeitszeit_ueber_8h');
    const zehn = befunde.find((b) => b.regel === 'tagesarbeitszeit_ueber_10h');
    expect(acht?.minuten).toBe(660);
    expect(zehn?.minuten).toBe(660);
    expect(acht?.kalendertag).toBe('2026-05-04');
  });

  it('marks the finding as crossing entities and names both shifts', () => {
    const acht = befunde.find((b) => b.regel === 'tagesarbeitszeit_ueber_8h');
    expect(acht?.ueberMandanten).toBe(true);
    expect(acht?.beteiligteSchichten).toEqual(['schicht-reinigung', 'schicht-security']);
  });

  it('THE SAME SHIFTS EVALUATED PER EMPLOYMENT RETURN NO §3 BREACH', () => {
    // This is the assertion that proves the aggregation. Six hours is lawful.
    // Five hours is lawful. Eleven hours is not — and only the person-keyed
    // call can see it.
    const nurReinigung = pruefeArbzg([reinigung6h]);
    const nurSecurity = pruefeArbzg([security5h]);
    const tagesregeln = (bs: readonly { regel: string }[]): string[] =>
      bs.map((b) => b.regel).filter((r) => r.startsWith('tagesarbeitszeit'));

    expect(tagesregeln(nurReinigung)).toEqual([]);
    expect(tagesregeln(nurSecurity)).toEqual([]);
    expect(tagesregeln(befunde).length).toBe(2);
  });

  it('every finding uses a value the arbzg_regel enum can hold', () => {
    for (const b of befunde) {
      expect(ARBZG_REGELN).toContain(b.regel);
      expect(['hinweis', 'warnung', 'verstoss']).toContain(b.schwere);
    }
  });

  it('refuses shifts of two different people — the key is the person (D-09)', () => {
    expect(() =>
      pruefeArbzg([reinigung6h, { ...security5h, personId: 'person-anders' }]),
    ).toThrow(ZeitFehler);
  });
});

describe('pruefeArbzg — §5 rest period across entities (acceptance 6)', () => {
  it('23:00 end in A, 07:00 start next day in B → ruhezeit_unter_11h at 480 min', () => {
    const abendA: Schicht = {
      id: 'abend-a',
      personId: PERSON,
      mandantId: SECURITY,
      vonUtc: utc('2026-05-04T17:00:00Z'), // 19:00 Berlin
      bisUtc: utc('2026-05-04T21:00:00Z'), // 23:00 Berlin
      pauseMinuten: 0,
    };
    const morgenB: Schicht = {
      id: 'morgen-b',
      personId: PERSON,
      mandantId: REINIGUNG,
      vonUtc: utc('2026-05-05T05:00:00Z'), // 07:00 Berlin
      bisUtc: utc('2026-05-05T09:00:00Z'), // 11:00 Berlin
      pauseMinuten: 0,
    };

    const ruhe = pruefeArbzg([abendA, morgenB]).find((b) => b.regel === 'ruhezeit_unter_11h');
    expect(ruhe).toBeDefined();
    expect(ruhe?.minuten).toBe(480);
    expect(ruhe?.ueberMandanten).toBe(true);
    expect(ruhe?.schwere).toBe('verstoss');
    expect(ruhe?.beteiligteSchichten).toEqual(['abend-a', 'morgen-b']);
  });

  it('a full eleven hours between shifts raises nothing', () => {
    const abend: Schicht = {
      id: 'abend',
      personId: PERSON,
      mandantId: SECURITY,
      vonUtc: utc('2026-05-04T14:00:00Z'),
      bisUtc: utc('2026-05-04T20:00:00Z'),
      pauseMinuten: 30,
    };
    const morgen: Schicht = {
      id: 'morgen',
      personId: PERSON,
      mandantId: SECURITY,
      vonUtc: utc('2026-05-05T07:00:00Z'),
      bisUtc: utc('2026-05-05T12:00:00Z'),
      pauseMinuten: 0,
    };
    expect(pruefeArbzg([abend, morgen]).map((b) => b.regel)).not.toContain('ruhezeit_unter_11h');
  });
});

describe('pruefeArbzg — §4 breaks, read and never invented', () => {
  it('reports a missing 30-minute break above six hours', () => {
    const siebenStunden: Schicht = {
      ...reinigung6h,
      bisUtc: utc('2026-05-04T10:00:00Z'),
      pauseMinuten: 0,
    };
    const befund = pruefeArbzg([siebenStunden]).find((b) => b.regel === 'pause_fehlt_ueber_6h');
    expect(befund).toBeDefined();
    expect(befund?.minuten).toBe(0);
  });

  it('reports the 45-minute rule above nine hours, not the 30-minute one', () => {
    const zehnStunden: Schicht = {
      ...reinigung6h,
      bisUtc: utc('2026-05-04T13:00:00Z'),
      pauseMinuten: 30,
    };
    const regeln = pruefeArbzg([zehnStunden]).map((b) => b.regel);
    expect(regeln).toContain('pause_fehlt_ueber_9h');
    expect(regeln).not.toContain('pause_fehlt_ueber_6h');
  });

  it('a recorded break is deducted before the §3 limits are applied', () => {
    // 8 h 30 gross with a 45-minute break is 7 h 45 net — lawful.
    const mitPause: Schicht = {
      ...reinigung6h,
      bisUtc: utc('2026-05-04T11:30:00Z'),
      pauseMinuten: 45,
    };
    expect(pruefeArbzg([mitPause]).map((b) => b.regel)).not.toContain('tagesarbeitszeit_ueber_8h');
  });
});

describe('the §3 Satz 2 extension changes severity, never the finding (O-18)', () => {
  // Nine hours net: over the eight-hour rule, under the ten-hour ceiling.
  const neunStunden: Schicht = {
    ...reinigung6h,
    bisUtc: utc('2026-05-04T12:30:00Z'),
    pauseMinuten: 30,
  };

  it('without the extension configured, exceeding eight hours is a Verstoß', () => {
    const acht = pruefeArbzg([neunStunden]).find((b) => b.regel === 'tagesarbeitszeit_ueber_8h');
    expect(acht?.schwere).toBe('verstoss');
    expect(acht?.begruendung).toContain('O-18');
  });

  it('with it configured, the SAME day is a Warnung — and the finding still exists', () => {
    const acht = pruefeArbzg([neunStunden], { zehnStundenAusnahme: true }).find(
      (b) => b.regel === 'tagesarbeitszeit_ueber_8h',
    );
    expect(acht?.schwere).toBe('warnung');
    expect(acht?.minuten).toBe(540);
  });

  it('the eight-hour finding is NEVER suppressed — it is the input to the averaging', () => {
    // Suppressing it would delete what `ausgleichszeitraum_ueberschritten` is
    // computed from: the platform would report nothing while the six-month
    // average drifted above eight hours. Asserted so no configuration can
    // silence it.
    for (const ausnahme of [false, true]) {
      const regeln = pruefeArbzg([reinigung6h, security5h], {
        zehnStundenAusnahme: ausnahme,
      }).map((b) => b.regel);
      expect(regeln).toContain('tagesarbeitszeit_ueber_8h');
      expect(regeln).toContain('tagesarbeitszeit_ueber_10h');
    }
  });

  it('the ten-hour ceiling is a Verstoß under every configuration', () => {
    for (const ausnahme of [false, true]) {
      const zehn = pruefeArbzg([reinigung6h, security5h], {
        zehnStundenAusnahme: ausnahme,
      }).find((b) => b.regel === 'tagesarbeitszeit_ueber_10h');
      expect(zehn?.schwere).toBe('verstoss');
    }
  });
});

/**
 * Ein Datum, das es nicht gibt, wird abgewiesen — nicht weitergerutscht.
 *
 * `Date.UTC(2026, 1, 30)` wirft nicht, sondern ergibt den 2. Maerz. Die
 * Formpruefung `\d{4}-\d{2}-\d{2}` laesst `2026-02-30` durch, und danach
 * legte eine Wiedervorlage auf einem Tag, den niemand gewaehlt hat.
 */
describe('berlinTagesZeitpunkt: der Kalender, nicht nur die Form', () => {
  it.each(['2026-02-30', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00'])(
    'weist %s ab', (datum) => {
      expect(() => berlinTagesZeitpunkt(datum)).toThrow(ZeitFehler);
    });

  it('der 29. Februar geht im Schaltjahr und faellt sonst', () => {
    expect(() => berlinTagesZeitpunkt('2028-02-29')).not.toThrow();
    expect(() => berlinTagesZeitpunkt('2026-02-29')).toThrow(ZeitFehler);
  });

  it('und ein gewoehnlicher Tag geht weiterhin', () => {
    expect(berlinTagesZeitpunkt('2026-07-14', 9).toISOString())
      .toBe('2026-07-14T07:00:00.000Z');   // CEST: 09:00 Berlin = 07:00 UTC
  });
});
