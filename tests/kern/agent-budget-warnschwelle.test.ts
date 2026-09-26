/**
 * Was die Budgetseite über die Warnschwelle sagt (AGT-05, O-195; V-245,
 * D-739; V-254, D-746).
 *
 * **Warum diese Datei.** Die Seite zeigt eine gesetzte Schwelle in ihrer
 * Zeile und den Satz „nicht hinterlegt (O-195)" unter der Tabelle, solange
 * eine Zeile keine hat. Der zweite Zweig — der Satz verschwindet, sobald
 * jede Zeile eine Schwelle trägt — lief bis V-254 nirgends: der Seed setzt
 * mit Absicht keine (eine gesetzte Zahl wäre eine still erfundene
 * Finanzregel, `seed/index.ts`), und `agenten.spec.ts` prüft nur den Fall
 * ohne. Hier stehen beide Zweige, und die Schreibweise der Zahl in beiden
 * Sprachen.
 */
import { describe, expect, it } from 'vitest';
import { warnschwelleOffen } from '../../src/server/agent/budget.js';
import { BUDGET_TEXTE } from '../../src/lib/i18n/verwaltung/agent-budget.js';

const zeile = (warnschwelle_prozent: number | null) => ({ warnschwelle_prozent });

describe('der Satz „Warnschwelle: nicht hinterlegt (O-195)"', () => {
  it('steht, solange es keine Budgetzeile gibt', () => {
    expect(warnschwelleOffen([])).toBe(true);
  });

  it('steht, solange EINE gezeigte Zeile keine Schwelle hat', () => {
    expect(warnschwelleOffen([zeile(null)])).toBe(true);
    expect(warnschwelleOffen([zeile(80), zeile(null)])).toBe(true);
    expect(warnschwelleOffen([zeile(null), zeile(90)])).toBe(true);
  });

  it('verschwindet erst, wenn jede Zeile eine hat — dann stünde er falsch da', () => {
    expect(warnschwelleOffen([zeile(80)])).toBe(false);
    expect(warnschwelleOffen([zeile(80), zeile(100), zeile(1)])).toBe(false);
  });
});

describe('die gesetzte Schwelle in ihrer Zeile', () => {
  it('deutsch mit Leerzeichen vor dem Prozentzeichen', () => {
    expect(BUDGET_TEXTE.de.warnungAb(80)).toBe('Warnung ab 80 %');
    expect(BUDGET_TEXTE.de.warnungAb(100)).toBe('Warnung ab 100 %');
  });

  it('englisch ohne Leerzeichen, wie prozentTextIn (V-213)', () => {
    expect(BUDGET_TEXTE.en.warnungAb(80)).toBe('Warns at 80%');
    expect(BUDGET_TEXTE.en.warnungAb(1)).toBe('Warns at 1%');
  });

  it('der Satz darunter bleibt in beiden Sprachen bei O-195 — kein Vorgabewert', () => {
    for (const t of [BUDGET_TEXTE.de, BUDGET_TEXTE.en]) {
      expect(t.warnschwelleOffen).toContain('O-195');
      expect(t.warnschwelleOffen).not.toMatch(/\d+\s?%/u);
    }
  });
});
