import { describe, expect, it } from 'vitest';
import { planEingabe } from '../../src/server/services/social/planeingabe.js';

/**
 * Was ein `datetime-local`-Feld schickt, und was daraus werden muss.
 *
 * **Der Wert trägt keine Zone.** `new Date('2026-07-01T09:00')` liest ihn als
 * Ortszeit des Servers — und der läuft in UTC. Aus 09:00 Berlin würden 09:00
 * UTC: der Beitrag ginge im Sommer zwei Stunden zu früh hinaus, im Winter
 * eine. Niemand merkt das an einem einzelnen Beitrag; auffallen würde es erst
 * an dem, der um 00:30 statt um 02:30 erscheint.
 */
describe('planEingabe', () => {
  const alsDate = (wert: string): Date => {
    const d = planEingabe(wert);
    if (!(d instanceof Date)) throw new Error(`erwartet ein Datum, bekam ${d.grund}`);
    return d;
  };

  it('(1) Sommerzeit: 09:00 Berlin sind 07:00 UTC', () => {
    expect(alsDate('2026-07-01T09:00').toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });

  it('(2) Winterzeit: 09:00 Berlin sind 08:00 UTC', () => {
    expect(alsDate('2026-01-15T09:00').toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('(3) die Nacht der Umstellung nach vorn — 01:59 und 03:00 sind eine Minute', () => {
    const vor = alsDate('2026-03-29T01:59');
    const nach = alsDate('2026-03-29T03:00');
    expect(vor.toISOString()).toBe('2026-03-29T00:59:00.000Z');
    expect(nach.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(nach.getTime() - vor.getTime()).toBe(60_000);
  });

  it('(4) die Nacht der Umstellung zurück — 02:30 gibt es zweimal, gemeint ist die erste', () => {
    /* 2026-10-25: 03:00 MESZ wird zu 02:00 MEZ. 02:30 gibt es um 00:30 UTC
       und noch einmal um 01:30 UTC. Genommen wird die erste. */
    expect(alsDate('2026-10-25T02:30').toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('(5) einen Tag, den es nicht gibt, schiebt sie nicht still weiter', () => {
    const f = planEingabe('2026-02-30T09:00');
    expect(f).not.toBeInstanceOf(Date);
    expect((f as { grund: string }).grund).toBe('kein_kalendertag');
  });

  it('(6) eine Uhrzeit, die es nicht gibt, auch nicht', () => {
    expect((planEingabe('2026-02-01T25:00') as { grund: string }).grund).toBe('keine_uhrzeit');
    expect((planEingabe('2026-02-01T09:77') as { grund: string }).grund).toBe('keine_uhrzeit');
  });

  it('(7) was kein Zeitpunkt ist, wird keiner', () => {
    for (const roh of ['', 'morgen', '2026-07-01', '01.07.2026 09:00', '2026-07-01T09:00:00Z']) {
      expect(planEingabe(roh), roh).not.toBeInstanceOf(Date);
    }
  });

  it('(8) Leerzeichen am Rand sind kein Grund zur Abweisung', () => {
    expect(alsDate('  2026-07-01T09:00  ').toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });
});
