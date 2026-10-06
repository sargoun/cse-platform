/**
 * Die Voreinstellungen des Sicherheitsmoduls (D-783): Posten- und
 * Schluesselarten (O-148) und die § 34a-Nachweise (O-342) — als Listen, die
 * ein Knopf in den Katalog schreibt. Hier wird die FORM der Listen gehalten:
 * eindeutige Schluessel, die drei Sprachen des Mitarbeiterportals, und bei den
 * Nachweisen die Rechtsgrundlage, auf die sich jede Zeile beruft.
 */
import { describe, expect, it } from 'vitest';
import {
  POSTENART_VOREINSTELLUNG, SCHLUESSELART_VOREINSTELLUNG, type ArtVoreinstellung,
} from '../../src/server/services/security/arten.js';
import { ANFORDERUNG_VOREINSTELLUNG } from '../../src/server/services/security/anforderung.js';

function pruefeListe(liste: readonly ArtVoreinstellung[], erwartet: number): void {
  expect(liste).toHaveLength(erwartet);
  const schluessel = liste.map((a) => a.schluessel);
  expect(new Set(schluessel).size).toBe(schluessel.length);
  let letzte = -1;
  for (const a of liste) {
    expect(a.schluessel, a.schluessel).toMatch(/^[a-z_]+$/u);
    expect(a.bezeichnung.trim().length, a.schluessel).toBeGreaterThan(0);
    for (const sprache of ['en', 'ar', 'tr'] as const) {
      expect(a.uebersetzungen[sprache].trim().length, `${a.schluessel}/${sprache}`).toBeGreaterThan(0);
    }
    expect(a.sortierung, a.schluessel).toBeGreaterThan(letzte);
    letzte = a.sortierung;
  }
}

describe('O-148 — Posten- und Schlüsselarten der Voreinstellung', () => {
  it('sechs Postenarten, eindeutig, in drei Sprachen, geordnet', () => {
    pruefeListe(POSTENART_VOREINSTELLUNG, 6);
    expect(POSTENART_VOREINSTELLUNG.map((a) => a.schluessel)).toContain('objektschutz');
    expect(POSTENART_VOREINSTELLUNG.map((a) => a.schluessel)).toContain('veranstaltung');
  });

  it('fünf Schlüsselarten, eindeutig, in drei Sprachen, geordnet', () => {
    pruefeListe(SCHLUESSELART_VOREINSTELLUNG, 5);
    expect(SCHLUESSELART_VOREINSTELLUNG.map((a) => a.schluessel)).toContain('transponder');
  });
});

describe('O-342 — die § 34a-Nachweise der Voreinstellung', () => {
  it('ein Posten verlangt die Unterrichtung für jede Kraft — als einzige Zeile', () => {
    expect(ANFORDERUNG_VOREINSTELLUNG.posten).toEqual([
      { qualifikation: '34a_unterrichtung', geltung: 'jeder', rechtsgrundlage: '§ 34a Abs. 1a GewO' },
    ]);
  });

  it('eine Veranstaltung verlangt dazu mindestens eine Sachkunde', () => {
    const v = ANFORDERUNG_VOREINSTELLUNG.veranstaltung;
    expect(v.map((z) => z.qualifikation)).toEqual(['34a_unterrichtung', '34a_sachkunde']);
    expect(v.find((z) => z.qualifikation === '34a_sachkunde')?.geltung).toBe('mindestens_einer');
    for (const z of [...ANFORDERUNG_VOREINSTELLUNG.posten, ...v]) {
      expect(z.rechtsgrundlage, z.qualifikation).toContain('§ 34a');
    }
  });
});
