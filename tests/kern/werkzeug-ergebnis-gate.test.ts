/**
 * Das Tor für ein zurückgehaltenes Werkzeugergebnis (Invariante 7, V-270,
 * D-763) — `gateWerkzeugErgebnis` in `server/agent/policy.ts`.
 *
 * „Ergebnis nur mit Freigabe" war eine Anzeige. Jetzt liefert die Laufzeit
 * ein solches Ergebnis nur aus, wenn dieses Tor es durchlässt; die
 * Datenbankseite (Posteingang, Entscheidung, Nachzug der Aufgabe) prüft
 * `tests/isolation/agent-assistent.test.ts` (6).
 */
import { describe, expect, it } from 'vitest';
import {
  AKTION_WERKZEUG_ERGEBNIS, AKTIONEN, ergebnisAbdruck, FreigabeErforderlich,
  gateWerkzeugErgebnis, type ErgebnisFreigabe,
} from '../../src/server/agent/policy.js';
import { jcsDigest } from '../../src/server/services/freigabe/kette.js';

const MANDANT = '11111111-1111-4111-8111-111111111111';
const AUFGABE = '22222222-2222-4222-8222-222222222222';
const MENSCH = '33333333-3333-4333-8333-333333333333';

const inhalt = {
  agent: 'ceo_assistent', werkzeug: 'suche_bestand',
  frage: 'Wie viele Rechnungen sind offen?', anzeige: '3 Rechnungen',
  stand: '29.09.2026, 08:00', abfrageId: 'offene_rechnungen_anzahl',
  risiko_gruende: ['Erstmalig — kein Vergleich vorhanden'],
};
const ergebnis = { mandantId: MANDANT, aufgabeId: AUFGABE, inhalt };

function freigabe(teil: Partial<ErgebnisFreigabe> = {}): ErgebnisFreigabe {
  return {
    aktion: AKTION_WERKZEUG_ERGEBNIS, mandantId: MANDANT, aufgabeId: AUFGABE,
    status: 'genehmigt', freigegebenVon: MENSCH, nutzlastHash: ergebnisAbdruck(inhalt),
    ...teil,
  };
}

function abgewiesen(e: ReturnType<typeof gateWerkzeugErgebnis>): string {
  expect(e.erlaubt).toBe(false);
  if (e.erlaubt) throw new Error('unerreichbar');
  expect(e.fehler).toBeInstanceOf(FreigabeErforderlich);
  return e.fehler.message;
}

describe('gateWerkzeugErgebnis — ausgeliefert wird nur das genehmigte Ergebnis', () => {
  it('genehmigt, von einem benannten Menschen, für genau diese Aufgabe und diesen Abdruck', () => {
    expect(gateWerkzeugErgebnis(ergebnis, freigabe())).toEqual({ erlaubt: true, grund: 'freigabe' });
  });

  it('ohne Freigabe: nein — fail-closed wie gate()', () => {
    expect(abgewiesen(gateWerkzeugErgebnis(ergebnis, null))).toContain('keine Freigabe');
  });

  it('offen, abgelehnt oder automatisch nach Frist: nein', () => {
    for (const status of ['offen', 'abgelehnt', 'abgelaufen', 'automatisch_freigegeben']) {
      expect(abgewiesen(gateWerkzeugErgebnis(ergebnis, freigabe({ status }))), status)
        .toContain(status);
    }
  });

  it('genehmigt ohne benannten Menschen: nein (Invariante 7 verlangt einen Menschen)', () => {
    expect(abgewiesen(gateWerkzeugErgebnis(ergebnis, freigabe({ freigegebenVon: null }))))
      .toContain('ohne benannten Menschen');
  });

  it('eine Freigabe zu etwas anderem deckt dieses Ergebnis nicht', () => {
    for (const teil of [
      { aktion: 'email_senden' },
      { mandantId: '44444444-4444-4444-8444-444444444444' },
      { aufgabeId: '55555555-5555-4555-8555-555555555555' },
      { aufgabeId: null },
    ] as const) {
      expect(abgewiesen(gateWerkzeugErgebnis(ergebnis, freigabe(teil))))
        .toContain('etwas anderem');
    }
  });

  it('ein Ergebnis, das nach der Freigabe ein anderes ist, geht nicht hinaus', () => {
    const anders = { ...ergebnis, inhalt: { ...inhalt, anzeige: '4 Rechnungen' } };
    expect(abgewiesen(gateWerkzeugErgebnis(anders, freigabe()))).toContain('Hash-Abweichung');
    expect(abgewiesen(gateWerkzeugErgebnis(ergebnis, freigabe({ nutzlastHash: null }))))
      .toContain('Hash-Abweichung');
  });
});

describe('der Abdruck ist der des Posteingangs', () => {
  it('RFC 8785 — dieselbe Funktion wie payload_hash und das Kettenglied', () => {
    expect(ergebnisAbdruck(inhalt)).toBe(jcsDigest(inhalt));
  });

  it('die Reihenfolge der Schlüssel ändert ihn nicht, der Inhalt schon', () => {
    const umgestellt = Object.fromEntries(Object.entries(inhalt).reverse());
    expect(ergebnisAbdruck(umgestellt)).toBe(ergebnisAbdruck(inhalt));
    expect(ergebnisAbdruck({ ...inhalt, anzeige: '' })).not.toBe(ergebnisAbdruck(inhalt));
  });
});

describe('keine Richtlinie schaltet ein zurückgehaltenes Ergebnis frei', () => {
  it('die Aktion ist keine der AKTIONEN, die agent_richtlinie konfiguriert', () => {
    expect((AKTIONEN as readonly string[]).includes(AKTION_WERKZEUG_ERGEBNIS)).toBe(false);
  });
});
