import { describe, expect, it } from 'vitest';
import {
  type BeitragStatus, type Schritt, darfBearbeiten, istAbgeschlossen,
  moeglicheSchritte, naechsterStatus, planFehler,
} from '../../src/server/services/social/weg.js';

/**
 * Der Weg eines Beitrags (SOC-03).
 *
 * Die Prüfungen hier sind bewusst NEGATIV formuliert: interessant ist nicht,
 * dass ein Entwurf vorgelegt werden kann, sondern dass ein abgelehnter nicht
 * ohne Umweg hinausgeht und ein veröffentlichter nicht wieder Entwurf wird.
 */

const ALLE: readonly BeitragStatus[] = [
  'entwurf', 'vorgelegt', 'freigegeben', 'geplant',
  'veroeffentlicht', 'abgelehnt', 'zurueckgezogen',
];

describe('der Weg eines Beitrags', () => {
  it('(1) der volle Weg läuft durch: Entwurf → Prüfung → Freigabe → Planung → draussen', () => {
    let s: BeitragStatus = 'entwurf';
    for (const schritt of ['vorlegen', 'freigeben', 'planen', 'veroeffentlichen'] as Schritt[]) {
      const n = naechsterStatus(s, schritt);
      expect(n, `${s} —${schritt}→`).not.toBeNull();
      s = n!;
    }
    expect(s).toBe('veroeffentlicht');
  });

  it('(2) NUR über eine Freigabe: aus dem Entwurf führt kein Weg nach draussen', () => {
    for (const schritt of ['freigeben', 'planen', 'veroeffentlichen'] as Schritt[]) {
      expect(naechsterStatus('entwurf', schritt)).toBeNull();
    }
    expect(naechsterStatus('abgelehnt', 'veroeffentlichen')).toBeNull();
    expect(naechsterStatus('abgelehnt', 'freigeben')).toBeNull();
  });

  it('(3) ein veröffentlichter Beitrag wird nicht wieder Entwurf', () => {
    expect(naechsterStatus('veroeffentlicht', 'ueberarbeiten')).toBeNull();
    expect(moeglicheSchritte('veroeffentlicht')).toEqual(['zuruecknehmen']);
  });

  it('(4) zurückgezogen ist ein Ende', () => {
    expect(moeglicheSchritte('zurueckgezogen')).toEqual([]);
    expect(istAbgeschlossen('zurueckgezogen')).toBe(true);
    for (const s of ALLE) {
      if (s !== 'zurueckgezogen') expect(istAbgeschlossen(s)).toBe(false);
    }
  });

  it('(5) bearbeitet wird nur der Entwurf — sonst hinge die Freigabe an altem Text', () => {
    for (const s of ALLE) expect(darfBearbeiten(s)).toBe(s === 'entwurf');
  });

  it('(6) jeder Übergang landet in einem bekannten Zustand', () => {
    for (const s of ALLE) {
      for (const schritt of moeglicheSchritte(s)) {
        const n = naechsterStatus(s, schritt);
        expect(ALLE).toContain(n);
        expect(n).not.toBe(s);
      }
    }
  });

  it('(7) geplant wird nur in die Zukunft, und nur was freigegeben ist', () => {
    const jetzt = new Date('2026-03-29T00:30:00Z');
    expect(planFehler('freigegeben', new Date('2026-03-29T02:00:00Z'), jetzt)).toBeNull();
    expect(planFehler('freigegeben', new Date('2026-03-29T00:30:00Z'), jetzt))
      .toBe('vergangenheit');
    expect(planFehler('freigegeben', new Date('2026-03-28T23:00:00Z'), jetzt))
      .toBe('vergangenheit');
    expect(planFehler('entwurf', new Date('2026-04-01T09:00:00Z'), jetzt))
      .toBe('falscher_status');
    expect(planFehler('veroeffentlicht', new Date('2026-04-01T09:00:00Z'), jetzt))
      .toBe('falscher_status');
  });

  it('(8) die Umstellungsnacht ändert nichts — verglichen werden Instants', () => {
    /*
     * 2026-03-29 ist die Nacht der Sommerzeit-Umstellung in Europe/Berlin:
     * 02:00 Ortszeit gibt es nicht. Beide Werte hier sind UTC-Instants, und
     * ihre Reihenfolge hängt an keiner Ortszeit (Invariante 2).
     */
    const vor = new Date('2026-03-29T00:59:59Z');
    const nach = new Date('2026-03-29T01:00:01Z');
    expect(planFehler('freigegeben', nach, vor)).toBeNull();
    expect(planFehler('freigegeben', vor, nach)).toBe('vergangenheit');
  });
});
