/**
 * Der interne Vorlauf der Vergabemappe (V-307, O-112, D-839).
 *
 *  1. Ein Werktag ist Montag bis Freitag ohne gesetzlichen Feiertag in
 *     Berlin — Heiligabend und Silvester sind keine.
 *  2. Fünf Werktage vor der Frist überspringen Wochenende und Feiertage:
 *     über Ostern, über den Jahreswechsel, von einer Frist am Sonntag aus.
 *  3. Der Stand: offen, heute, überschritten — und erledigt, sobald die
 *     Mappe vollständig, freigegeben oder eingereicht ist.
 */
import { describe, expect, it } from 'vitest';
import { isoWochentag, istWerktag, werktageVor } from '../../src/lib/datum/werktage.js';
import {
  VORLAUF_WERKTAGE, internerVorlauf,
} from '../../src/server/services/vergabe/vorlauf.js';
import { FRIST_KNAPP_TAGE } from '../../src/server/services/radar/gewichte.platzhalter.js';
import { VORLAUF_TEXTE } from '../../src/lib/i18n/verwaltung/vergabe-vorlauf.js';

describe('Werktage im Berliner Kalender', () => {
  it('der ISO-Wochentag: Montag 1 bis Sonntag 7', () => {
    expect(isoWochentag('2026-10-05')).toBe(1);
    expect(isoWochentag('2026-10-07')).toBe(3);
    expect(isoWochentag('2026-10-11')).toBe(7);
  });

  it('Wochenende und gesetzliche Feiertage sind keine Werktage', () => {
    expect(istWerktag('2026-10-07')).toBe(true);
    expect(istWerktag('2026-10-10')).toBe(false); // Samstag
    expect(istWerktag('2026-10-11')).toBe(false); // Sonntag
    expect(istWerktag('2026-05-01')).toBe(false); // Tag der Arbeit, Freitag
    expect(istWerktag('2026-04-03')).toBe(false); // Karfreitag
    expect(istWerktag('2026-04-06')).toBe(false); // Ostermontag
    expect(istWerktag('2026-05-14')).toBe(false); // Christi Himmelfahrt
    expect(istWerktag('2026-05-25')).toBe(false); // Pfingstmontag
    expect(istWerktag('2027-03-08')).toBe(false); // Internationaler Frauentag (Berlin), Montag
  });

  it('Heiligabend und Silvester sind keine gesetzlichen Feiertage — also Werktage', () => {
    expect(istWerktag('2026-12-24')).toBe(true);
    expect(istWerktag('2026-12-31')).toBe(true);
  });

  it('fünf Werktage vor einem Donnerstag ist der Donnerstag davor', () => {
    expect(werktageVor('2026-10-15', 5)).toBe('2026-10-08');
  });

  it('über Ostern zählen Karfreitag und Ostermontag nicht', () => {
    expect(werktageVor('2026-04-08', 5)).toBe('2026-03-30');
  });

  it('über den Jahreswechsel: Neujahr und die Feiertage zählen nicht, Silvester schon', () => {
    expect(werktageVor('2027-01-04', 5)).toBe('2026-12-24');
  });

  it('von einer Frist am Sonntag aus zählt der Freitag als erster', () => {
    expect(werktageVor('2026-10-18', 5)).toBe('2026-10-12');
  });

  it('null Werktage ist der Tag selbst; eine falsche Eingabe wirft', () => {
    expect(werktageVor('2026-10-15', 0)).toBe('2026-10-15');
    expect(() => werktageVor('15.10.2026', 5)).toThrow(RangeError);
    expect(() => werktageVor('2026-02-30', 5)).toThrow(RangeError);
    expect(() => werktageVor('2026-10-15', -1)).toThrow(RangeError);
    expect(() => werktageVor('2026-10-15', 1.5)).toThrow(RangeError);
  });
});

describe('internerVorlauf (O-112)', () => {
  it('die Voreinstellung: fünf Werktage — dieselbe Zahl wie die Fristwarnung des Radars', () => {
    expect(VORLAUF_WERKTAGE).toBe(5);
    expect(VORLAUF_WERKTAGE).toBe(FRIST_KNAPP_TAGE);
  });

  it('offen, heute, überschritten', () => {
    expect(internerVorlauf('2026-10-15', '2026-10-07', 'in_arbeit'))
      .toEqual({ internFaelligAm: '2026-10-08', stand: 'offen', werktage: 5 });
    expect(internerVorlauf('2026-10-15', '2026-10-08', 'in_arbeit')?.stand).toBe('heute');
    expect(internerVorlauf('2026-10-15', '2026-10-09', 'offen')?.stand).toBe('ueberschritten');
  });

  it('erledigt, sobald die Mappe vollständig, freigegeben oder eingereicht ist', () => {
    for (const stand of ['vollstaendig', 'freigegeben', 'eingereicht']) {
      expect(internerVorlauf('2026-10-15', '2026-10-14', stand)?.stand).toBe('erledigt');
    }
  });

  it('ohne Frist und für eine verworfene Mappe: kein Vorlauf', () => {
    expect(internerVorlauf(null, '2026-10-07', 'in_arbeit')).toBeNull();
    expect(internerVorlauf('2026-10-15', '2026-10-07', 'verworfen')).toBeNull();
  });

  it('die Sätze nennen Tag und Zahl, in beiden Sprachen', () => {
    expect(VORLAUF_TEXTE.de.zeile('08.10.2026', 5)).toBe(
      'Intern fertig bis 08.10.2026 — 5 Werktage vor der Abgabe.');
    expect(VORLAUF_TEXTE.en.zeile('8 Oct 2026', 5)).toContain('5 working days');
    expect(VORLAUF_TEXTE.de.voreinstellung).toContain('O-112');
    expect(VORLAUF_TEXTE.en.voreinstellung).toContain('O-112');
  });
});
