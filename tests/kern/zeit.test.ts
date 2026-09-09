/**
 * PR 1 acceptance (1)–(4), (7) — the mandated time tests, K-11.
 *
 * The dates are the K-11 reference cases verbatim. The transition NIGHT begins
 * the evening before the transition day; naming the shift by the transition
 * date is off by one and asserts a value the shift does not have.
 */
import { describe, expect, it } from 'vitest';
import {
  berlinAnzeige,
  berlinInstant,
  berlinKalendertag,
  dauerMinuten,
  splitteNachMonat,
  verteilePausenMinuten,
  ZeitFehler,
} from '../../src/server/services/zeit/dauer.js';
import { verteileSpalten } from '../../src/server/services/zeit/spalten.js';

const utc = (iso: string): Date => new Date(iso);

describe('dauerMinuten — the difference of UTC instants (invariant 2, K-11)', () => {
  it('(1) an ordinary night 22:00–06:00 Berlin is 480 minutes', () => {
    expect(dauerMinuten(utc('2026-03-27T21:00:00Z'), utc('2026-03-28T05:00:00Z'))).toBe(480);
  });

  it('(2) the spring-forward night 2026-03-28 22:00 → 03-29 06:00 is 420 minutes', () => {
    expect(dauerMinuten(utc('2026-03-28T21:00:00Z'), utc('2026-03-29T04:00:00Z'))).toBe(420);
  });

  it('(3) the fall-back night 2026-10-24 22:00 → 10-25 06:00 is 540 minutes', () => {
    expect(dauerMinuten(utc('2026-10-24T20:00:00Z'), utc('2026-10-25T05:00:00Z'))).toBe(540);
  });

  it('(3a) CONTROL: a shift starting 22:00 ON a transition day is an ordinary 480', () => {
    // 29 March — the transition already happened at 01:00Z that morning.
    expect(dauerMinuten(utc('2026-03-29T20:00:00Z'), utc('2026-03-30T04:00:00Z'))).toBe(480);
    // 25 October — likewise.
    expect(dauerMinuten(utc('2026-10-25T21:00:00Z'), utc('2026-10-26T05:00:00Z'))).toBe(480);
  });

  it('the wall-clock reading confirms the fixtures really are 22:00 → 06:00 Berlin', () => {
    expect(berlinAnzeige(utc('2026-03-28T21:00:00Z'))).toContain('22:00');
    expect(berlinAnzeige(utc('2026-03-29T04:00:00Z'))).toContain('06:00');
    expect(berlinAnzeige(utc('2026-10-24T20:00:00Z'))).toContain('22:00');
    expect(berlinAnzeige(utc('2026-10-25T05:00:00Z'))).toContain('06:00');
  });

  it('refuses an end before its beginning rather than returning a negative duration', () => {
    expect(() => dauerMinuten(utc('2026-01-02T00:00:00Z'), utc('2026-01-01T00:00:00Z'))).toThrow(
      ZeitFehler,
    );
  });
});

describe('splitteNachMonat — Berlin month boundaries, never UTC midnight (K-11)', () => {
  it('(7) 31.01 20:00 → 01.02 04:00 Berlin splits 240/240 — the CET case', () => {
    expect(splitteNachMonat(utc('2026-01-31T19:00:00Z'), utc('2026-02-01T03:00:00Z'))).toEqual([
      { jahr: 2026, monat: 1, minuten: 240 },
      { jahr: 2026, monat: 2, minuten: 240 },
    ]);
  });

  it('K-11 worked example: 21:00Z → 05:00Z splits 120/360, not 180/300', () => {
    const anteile = splitteNachMonat(utc('2026-01-31T21:00:00Z'), utc('2026-02-01T05:00:00Z'));
    expect(anteile).toEqual([
      { jahr: 2026, monat: 1, minuten: 120 },
      { jahr: 2026, monat: 2, minuten: 360 },
    ]);
    // The UTC-midnight answer, asserted as wrong so nobody "simplifies" back to it.
    expect(anteile[0]?.minuten).not.toBe(180);
  });

  it('the CEST case: a July/August boundary splits at 22:00Z', () => {
    const anteile = splitteNachMonat(utc('2026-07-31T20:00:00Z'), utc('2026-08-01T04:00:00Z'));
    expect(anteile).toEqual([
      { jahr: 2026, monat: 7, minuten: 120 },
      { jahr: 2026, monat: 8, minuten: 360 },
    ]);
  });

  it('crosses a year boundary and the parts always sum to the total', () => {
    const von = utc('2026-12-31T22:00:00Z');
    const bis = utc('2027-01-01T06:00:00Z');
    const anteile = splitteNachMonat(von, bis);
    expect(anteile.map((a) => `${a.jahr}-${a.monat}`)).toEqual(['2026-12', '2027-1']);
    expect(anteile.reduce((s, a) => s + a.minuten, 0)).toBe(dauerMinuten(von, bis));
  });

  it('a shift inside one month is one part', () => {
    expect(splitteNachMonat(utc('2026-05-04T06:00:00Z'), utc('2026-05-04T14:00:00Z'))).toEqual([
      { jahr: 2026, monat: 5, minuten: 480 },
    ]);
  });

  it('break minutes split by largest remainder and sum to the recorded total exactly', () => {
    const anteile = splitteNachMonat(utc('2026-01-31T21:00:00Z'), utc('2026-02-01T05:00:00Z'));
    const pausen = verteilePausenMinuten(anteile, 45);
    expect(pausen.reduce((s, p) => s + p, 0)).toBe(45);
    expect(pausen).toEqual([11, 34]);
  });
});

describe('berlinInstant / berlinKalendertag', () => {
  it('resolves a Berlin wall-clock time to the right instant in CET and CEST', () => {
    expect(berlinInstant(2026, 1, 15, 22, 0).toISOString()).toBe('2026-01-15T21:00:00.000Z');
    expect(berlinInstant(2026, 7, 15, 22, 0).toISOString()).toBe('2026-07-15T20:00:00.000Z');
  });

  it('assigns a night shift to the Berlin day it starts on', () => {
    expect(berlinKalendertag(utc('2026-03-28T21:00:00Z'))).toBe('2026-03-28');
    expect(berlinKalendertag(utc('2026-03-29T04:00:00Z'))).toBe('2026-03-29');
  });
});

describe('verteileSpalten — TIM-04', () => {
  it('(4) ten shifts with an identical start instant get ten distinct lanes', () => {
    const von = utc('2026-05-04T06:00:00Z');
    const bis = utc('2026-05-04T14:00:00Z');
    const zehn = Array.from({ length: 10 }, (_, i) => ({
      id: `einsatz-${i}`,
      vonUtc: von,
      bisUtc: bis,
    }));

    const verteilt = verteileSpalten(zehn);

    expect(verteilt).toHaveLength(10);
    expect(new Set(verteilt.map((v) => v.spalte)).size).toBe(10);
    expect(new Set(verteilt.map((v) => v.id)).size).toBe(10);
    expect(verteilt.every((v) => v.spaltenImCluster === 10)).toBe(true);
  });

  it('reuses a lane once the previous shift has ended', () => {
    const verteilt = verteileSpalten([
      { id: 'a', vonUtc: utc('2026-05-04T06:00:00Z'), bisUtc: utc('2026-05-04T10:00:00Z') },
      { id: 'b', vonUtc: utc('2026-05-04T10:00:00Z'), bisUtc: utc('2026-05-04T14:00:00Z') },
    ]);
    expect(verteilt.map((v) => v.spalte)).toEqual([0, 0]);
  });

  it('gives overlapping shifts different lanes', () => {
    const verteilt = verteileSpalten([
      { id: 'a', vonUtc: utc('2026-05-04T06:00:00Z'), bisUtc: utc('2026-05-04T12:00:00Z') },
      { id: 'b', vonUtc: utc('2026-05-04T10:00:00Z'), bisUtc: utc('2026-05-04T14:00:00Z') },
    ]);
    expect(verteilt.map((v) => v.spalte)).toEqual([0, 1]);
    expect(verteilt.every((v) => v.spaltenImCluster === 2)).toBe(true);
  });
});
