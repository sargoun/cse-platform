/**
 * Die Felder eines eigenen Termins und ihre Zeit — ohne Datenbank
 * (CAL-01, V-221, D-715, Invariante 2).
 *
 * Die vier Zeitfälle aus CLAUDE.md („Test before UI for money and time")
 * gelten hier sinngemäss: ein Termin über Mitternacht, einer in der Nacht der
 * Sommerzeit, einer in der Nacht der Winterzeit, und der ganztägige Tag, der
 * an einem Umstellungstag 23 oder 25 Stunden hat. Die Dauer ist in jedem Fall
 * die Differenz zweier Instants.
 */
import { describe, expect, it } from 'vitest';
import {
  EIGENE_ARTEN, TerminFehler, leseTerminZeiten, pruefeTermin, type TerminEingabe,
} from '../../src/server/services/kalender/termin.js';

const STUNDE = 3600 * 1000;

function eingabe(ueber: Partial<TerminEingabe> = {}): TerminEingabe {
  return {
    art: 'besprechung', titel: 'Objektleitungsrunde', beschreibung: '', ort: '',
    beginn: new Date('2026-09-01T07:00:00Z'), ende: new Date('2026-09-01T08:00:00Z'),
    ganztaegig: false, teilnehmer: [], ...ueber,
  };
}

describe('die Felder', () => {
  it('nur die drei Arten, die der Kalender besitzt — nie Wiedervorlage oder Gespräch', () => {
    expect([...EIGENE_ARTEN]).toEqual(['besprechung', 'kundentermin', 'sonstiges']);
    for (const art of ['wiedervorlage', 'bewerbungsgespraech', '']) {
      expect(() => pruefeTermin(eingabe({ art })), art).toThrow(TerminFehler);
    }
  });

  it('Titel Pflicht, Ende nach Beginn, Teilnehmende nur als Kennung', () => {
    expect(() => pruefeTermin(eingabe({ titel: '   ' })))
      .toThrow(expect.objectContaining({ grund: 'titel_fehlt' }) as Error);
    expect(() => pruefeTermin(eingabe({ ende: new Date('2026-09-01T07:00:00Z') })))
      .toThrow(expect.objectContaining({ grund: 'ende_vor_beginn' }) as Error);
    expect(() => pruefeTermin(eingabe({ teilnehmer: ['keine-kennung'] })))
      .toThrow(expect.objectContaining({ grund: 'teilnehmer_unbekannt' }) as Error);
    const k = '00000000-0000-4000-8000-000000000001';
    expect(pruefeTermin(eingabe({ teilnehmer: [k, k, ' '] })).teilnehmer).toEqual([k]);
    expect(pruefeTermin(eingabe({ ort: '  ', beschreibung: '' }))).toMatchObject({
      ort: null, beschreibung: null,
    });
  });
});

describe('die Zeit — Berliner Wanduhr rein, Instants raus (Invariante 2)', () => {
  it('22:00–06:00 über Mitternacht: acht Stunden', () => {
    const z = leseTerminZeiten({
      ganztaegig: false, beginn: '2026-09-01T22:00', ende: '2026-09-02T06:00',
    });
    expect(z.beginn.toISOString()).toBe('2026-09-01T20:00:00.000Z');
    expect(z.ende.getTime() - z.beginn.getTime()).toBe(8 * STUNDE);
  });

  it('Nacht der Sommerzeit: 01:00–04:00 sind zwei Stunden, nicht drei', () => {
    const z = leseTerminZeiten({
      ganztaegig: false, beginn: '2026-03-29T01:00', ende: '2026-03-29T04:00',
    });
    expect(z.ende.getTime() - z.beginn.getTime()).toBe(2 * STUNDE);
  });

  it('Nacht der Winterzeit: 01:00–04:00 sind vier Stunden, nicht drei', () => {
    const z = leseTerminZeiten({
      ganztaegig: false, beginn: '2026-10-25T01:00', ende: '2026-10-25T04:00',
    });
    expect(z.ende.getTime() - z.beginn.getTime()).toBe(4 * STUNDE);
  });

  it('ganztägig: Berliner Mitternacht bis Mitternacht NACH dem letzten Tag', () => {
    const sommer = leseTerminZeiten({ ganztaegig: true, vonTag: '2026-03-29' });
    expect(sommer.beginn.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(sommer.ende.getTime() - sommer.beginn.getTime()).toBe(23 * STUNDE);
    const winter = leseTerminZeiten({ ganztaegig: true, vonTag: '2026-10-25', bisTag: '2026-10-25' });
    expect(winter.ende.getTime() - winter.beginn.getTime()).toBe(25 * STUNDE);
    const drei = leseTerminZeiten({ ganztaegig: true, vonTag: '2026-07-12', bisTag: '2026-07-14' });
    expect(drei.ende.toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });

  it('einen Tag, den es nicht gibt, weist die Lesart ab — mit Grund', () => {
    expect(() => leseTerminZeiten({ ganztaegig: true, vonTag: '2026-02-30' }))
      .toThrow(expect.objectContaining({ grund: 'kein_kalendertag' }) as Error);
    expect(() => leseTerminZeiten({ ganztaegig: false, beginn: 'morgen', ende: '' }))
      .toThrow(expect.objectContaining({ grund: 'zeitpunkt_unlesbar' }) as Error);
  });
});
