/**
 * Der Rueckweg nach einem Bereichswechsel (D-474) — was `rueckwegImBereich`
 * annimmt und was es still verwirft.
 *
 * Der Wert kommt aus dem Formular des Wechselblatts, also vom Aufrufer. Die
 * Pruefung ist eine Allowlist ueber die Form UND eine Bindung an das Ziel:
 * wer in die Reinigung wechselt, landet in der Reinigung — nicht in `mein`,
 * nicht auf einem fremden Host, nicht ueber `..` irgendwo anders.
 */
import { describe, expect, it } from 'vitest';
import { rueckwegImBereich } from '../../src/server/auth/switch-mandant.js';

const REINIGUNG = { art: 'mandant', slug: 'reinigung' } as const;
const GRUPPE = { art: 'gruppe' } as const;

describe('rueckwegImBereich', () => {
  it('nimmt einen Pfad im Zielbereich an — mit und ohne Abfrage', () => {
    expect(rueckwegImBereich('/portal/reinigung/agenten/budget', REINIGUNG))
      .toBe('/portal/reinigung/agenten/budget');
    expect(rueckwegImBereich('/portal/reinigung', REINIGUNG)).toBe('/portal/reinigung');
    expect(rueckwegImBereich('/portal/reinigung/dienstplan/woche?woche=2026-08-31', REINIGUNG))
      .toBe('/portal/reinigung/dienstplan/woche?woche=2026-08-31');
    expect(rueckwegImBereich('/portal/gruppe/auftraege', GRUPPE)).toBe('/portal/gruppe/auftraege');
  });

  it('verwirft einen anderen Bereich — auch die Gruppe fuer ein Mandantsziel', () => {
    expect(rueckwegImBereich('/portal/bau/projekte', REINIGUNG)).toBeNull();
    expect(rueckwegImBereich('/portal/gruppe', REINIGUNG)).toBeNull();
    expect(rueckwegImBereich('/portal/reinigung', GRUPPE)).toBeNull();
    expect(rueckwegImBereich('/portal/mein', REINIGUNG)).toBeNull();
    // Der Praefix allein reicht nicht: `reinigung-alt` ist nicht `reinigung`.
    expect(rueckwegImBereich('/portal/reinigung-alt/x', REINIGUNG)).toBeNull();
  });

  it('verwirft alles, was den Ursprung oder den Bereich verlassen koennte', () => {
    expect(rueckwegImBereich('https://boese.example/portal/reinigung', REINIGUNG)).toBeNull();
    expect(rueckwegImBereich('//boese.example/portal/reinigung', REINIGUNG)).toBeNull();
    // `new URL` loeste `..` still auf — `/portal/reinigung/../mein` IST `/portal/mein`.
    expect(rueckwegImBereich('/portal/reinigung/../mein', REINIGUNG)).toBeNull();
    expect(rueckwegImBereich('/portal/reinigung/./x', REINIGUNG)).toBeNull();
    expect(rueckwegImBereich('/portal/reinigung\\mein', REINIGUNG)).toBeNull();
    expect(rueckwegImBereich('/portal/reinigung/x#y', REINIGUNG)).toBeNull();
    expect(rueckwegImBereich('/portal/reinigung/%2e%2e/mein', REINIGUNG)).toBeNull();
    expect(rueckwegImBereich(`/portal/reinigung/${'a'.repeat(600)}`, REINIGUNG)).toBeNull();
  });

  it('gibt fuer Fehlendes und Falsches null zurueck — kein Fehler, kein Hinweis', () => {
    expect(rueckwegImBereich(null, REINIGUNG)).toBeNull();
    expect(rueckwegImBereich(undefined, REINIGUNG)).toBeNull();
    expect(rueckwegImBereich('', REINIGUNG)).toBeNull();
    expect(rueckwegImBereich(42, REINIGUNG)).toBeNull();
    expect(rueckwegImBereich(['/portal/reinigung'], REINIGUNG)).toBeNull();
  });
});
