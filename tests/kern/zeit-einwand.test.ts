/**
 * PR 36, Abnahme (4) — die HTTP-Seite von EMP-07, ohne Datenbank.
 *
 * Die Datenbankseite („auch mit `zeit.schreiben` bleibt das UPDATE
 * wirkungslos") steht in `tests/isolation/zeit-auftrag.test.ts`. Hier steht
 * die andere Haelfte der Zusage: dass der Versuch **404** ergibt und nicht
 * 403 — ein 403 bestaetigte die Existenz der Zeile, die der Aufrufer nicht
 * sehen darf (AUT-06) —, und dass das Manifest genau eine Zeitroute mit einem
 * Recht fuehrt: die ENTSCHEIDUNG.
 */
import { describe, expect, it } from 'vitest';
import { authorize, type Akteur } from '../../src/server/auth/authorize.js';
import { NichtGefundenFehler } from '../../src/server/auth/fehler.js';
import { ROUTEN } from '../../src/server/auth/route-manifest.js';
import { ENTSCHIEDEN } from '../../src/server/services/zeit/einwand.js';

const KRAFT: Akteur = {
  benutzerId: 'b-1', personId: 'p-1', aktiverMandantId: 'm-1',
  ansicht: 'mandant', aal: 'aal1', portal: 'mitarbeiter', sitzungId: 's-1',
};

/** Ein Pruefer, der genau die genannten Schluessel haelt. */
const haelt = (...schluessel: readonly string[]) => ({
  hatRecht: async (s: string): Promise<boolean> => Promise.resolve(schluessel.includes(s)),
});

describe('(4) der Versuch eines Mitarbeitenden endet auf 404, nicht auf 403', () => {
  it('ohne `zeit.einwand_entscheiden` wirft `authorize` NichtGefunden', async () => {
    // Die Kraft haelt sogar `zeit.schreiben` — und kommt trotzdem nicht durch:
    // die Entscheidung haengt an einem anderen Recht.
    await expect(authorize(
      KRAFT,
      { recht: 'zeit.einwand_entscheiden', schreibend: true },
      haelt('zeit.lesen', 'zeit.schreiben'),
    )).rejects.toBeInstanceOf(NichtGefundenFehler);
  });

  it('und der Fehler traegt 404 — die Antwort, die nichts verraet', () => {
    expect(new NichtGefundenFehler('x').status).toBe(404);
  });

  it('die Planung mit dem Recht kommt durch', async () => {
    const planer: Akteur = { ...KRAFT, portal: 'intern' };
    await expect(authorize(
      planer,
      { recht: 'zeit.einwand_entscheiden', schreibend: true },
      haelt('zeit.einwand_entscheiden'),
    )).resolves.toBe(planer);
  });
});

describe('das Manifest führt genau die zwei Wege, die EMP-07 kennt', () => {
  const einreichen = ROUTEN.find((r) => r.pfad === 'api/zeit/einwand');
  const entscheiden = ROUTEN.find((r) => r.pfad === 'api/zeit/einwand/entscheidung');

  it('das Einreichen ist Selbstzugriff — kein Modulrecht, aber ein Grund', () => {
    expect(einreichen).toBeDefined();
    expect(einreichen?.recht).toBeNull();
    // Der Grund ist die Stelle, an der jemand die Entscheidung nachlesen kann.
    expect((einreichen?.grund ?? '').length).toBeGreaterThan(40);
    expect(einreichen?.grund).toContain('EMP-07');
  });

  it('das Entscheiden verlangt `zeit.einwand_entscheiden`, nicht `zeit.schreiben`', () => {
    expect(entscheiden?.recht).toBe('zeit.einwand_entscheiden');
  });

  it('und es gibt KEINE Route, die einen Zeiteintrag ändert', () => {
    // EMP-07 als Eigenschaft der Adressliste: was es nicht gibt, ruft auch
    // niemand versehentlich auf.
    const verdaechtig = ROUTEN.filter((r) => /^api\/zeit(?:eintrag|\/eintrag)/u.test(r.pfad));
    expect(verdaechtig).toEqual([]);
  });
});

describe('ein entschiedener Einwand ist entschieden', () => {
  it('die vier Endzustände sind benannt und enthalten kein „offen“', () => {
    // Der Dienst prueft gegen diese Liste, bevor er schreibt, und der Ausloeser
    // `einwand_status_maschine` noch einmal danach. Zwei Linien, eine Liste.
    expect([...ENTSCHIEDEN].sort()).toEqual(
      ['abgelehnt', 'anerkannt', 'teilweise_anerkannt', 'zurueckgezogen'],
    );
    expect(ENTSCHIEDEN).not.toContain('offen');
    expect(ENTSCHIEDEN).not.toContain('in_pruefung');
  });
});
