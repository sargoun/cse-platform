/**
 * Die Voreinstellungen der Radar-Runde (D-786) — Zahlen, die ein neues Profil,
 * der Seed und die Budgetmaske bekommen, gegen die Skala und gegen die Sätze
 * gelesen, die sie nennen.
 *
 * Was hier NICHT steht: ob `legeProfilAn` die Schwelle wirklich schreibt —
 * das prüft `tests/isolation/radar-profil-schreiben.test.ts` (6) an der
 * Datenbank.
 */
import { describe, expect, it } from 'vitest';
import {
  GEWICHTE_PLATZHALTER, SCHWELLE_VOREINSTELLUNG, SKALA_MAX_PLATZHALTER,
} from '../../src/server/services/radar/gewichte.platzhalter.js';
import { ABFRAGE_VOREINSTELLUNG, quellStand } from '../../src/server/services/radar/quelle.js';
import {
  BUDGET_VOREINSTELLUNG_CENT, budgetInCent,
} from '../../src/server/services/agent/budget-pflege.js';
import { BUDGET_TEXTE } from '../../src/lib/i18n/verwaltung/agent-budget.js';
import { cent, formatiereGeld } from '../../src/server/services/finanz/geld.js';

const glatt = (s: string): string => s.replace(/\u00a0/gu, ' ');

describe('Treffermeldung ab 60 von 100 (O-15, D-786)', () => {
  it('liegt auf der Skala', () => {
    expect(Number.isInteger(SCHWELLE_VOREINSTELLUNG)).toBe(true);
    expect(SCHWELLE_VOREINSTELLUNG).toBeGreaterThan(0);
    expect(SCHWELLE_VOREINSTELLUNG).toBeLessThanOrEqual(SKALA_MAX_PLATZHALTER);
  });

  it('kein Kriterium erreicht sie allein — CPV und Region zusammen schon', () => {
    for (const gewicht of Object.values(GEWICHTE_PLATZHALTER)) {
      expect(gewicht).toBeLessThan(SCHWELLE_VOREINSTELLUNG);
    }
    expect(GEWICHTE_PLATZHALTER.cpv + GEWICHTE_PLATZHALTER.region)
      .toBeGreaterThanOrEqual(SCHWELLE_VOREINSTELLUNG);
  });
});

describe('die Radar-Abfrage (O-366, D-786)', () => {
  it('nennt die drei Gewerke, Berlin und Brandenburg und ein Zeitfenster', () => {
    expect([...ABFRAGE_VOREINSTELLUNG.cpvAbteilungen]).toEqual(['90', '79', '45']);
    expect([...ABFRAGE_VOREINSTELLUNG.nutsPraefixe]).toEqual(['DE3', 'DE4']);
    expect(ABFRAGE_VOREINSTELLUNG.zeitfensterTage).toBe(30);
    for (const teil of ['90', '79', '45', 'DE3', 'DE4', '30 Tage']) {
      expect(ABFRAGE_VOREINSTELLUNG.text).toContain(teil);
    }
  });

  it('steht im Satz einer nicht verbundenen Quelle — mit der Frage und ohne „TODO"', () => {
    const vorher = process.env['RADAR_TED_URL'];
    delete process.env['RADAR_TED_URL'];
    try {
      const stand = quellStand('ted');
      expect(stand.verbunden).toBe(false);
      expect(stand.hinweis).toContain('O-366');
      expect(stand.hinweis).toContain('trägt der Betreiber ein');
      expect(stand.hinweis).toContain(ABFRAGE_VOREINSTELLUNG.text);
      expect(stand.hinweis).not.toContain('TODO');
    } finally {
      if (vorher !== undefined) process.env['RADAR_TED_URL'] = vorher;
    }
  });
});

describe('das Monatsbudget 50,00 € (O-26, D-786)', () => {
  it('ist ein ganzer Cent-Betrag und liest sich aus der eigenen Anzeige zurück', () => {
    expect(typeof BUDGET_VOREINSTELLUNG_CENT).toBe('bigint');
    expect(BUDGET_VOREINSTELLUNG_CENT).toBeGreaterThan(0n);
    /* Die Maske belegt mit `formatiereGeld` vor — und `budgetInCent` muss genau das lesen. */
    const vorbelegt = formatiereGeld(cent(BUDGET_VOREINSTELLUNG_CENT));
    expect(budgetInCent(vorbelegt)).toBe(BUDGET_VOREINSTELLUNG_CENT);
  });

  it('wird in beiden Sprachen der Maske mit derselben Zahl genannt', () => {
    const betrag = glatt(formatiereGeld(cent(BUDGET_VOREINSTELLUNG_CENT)));
    expect(glatt(BUDGET_TEXTE.de.betragErklaerung)).toContain(betrag);
    expect(glatt(BUDGET_TEXTE.de.betragErklaerung)).toContain('Voreinstellung');
    expect(glatt(BUDGET_TEXTE.de.betragErklaerung)).not.toMatch(/offene Frage|Platzhalter/u);
    expect(glatt(BUDGET_TEXTE.en.betragErklaerung)).toContain(betrag);
  });
});
