/**
 * Die Stoppmeldung der Agenten (AGT-05, NOT-01, NOT-03).
 *
 * Geprueft wird nicht, dass ein Text existiert, sondern dass er das leistet,
 * wofuer NOT-03 ihn verlangt: ein Ziel, an dem etwas zu TUN ist, und ein Satz,
 * der sagt, was gerade nicht mehr laeuft. Und dass er NICHT sammelbar ist —
 * eine Tageszusammenfassung erreicht den Empfaenger nach der Nacht, in der
 * nichts lief.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { erzeuge, findeArt, leereArten } from '../../src/server/benachrichtigung/registry.js';
import {
  ART_BUDGET_ERSCHOEPFT, registriereAgentArten,
} from '../../src/server/agent/benachrichtigung.js';

const MANDANT = '11111111-1111-1111-1111-111111111111';
const BUDGET = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  leereArten();
  registriereAgentArten();
});

describe('agent.budget_erschoepft', () => {
  it('ist registriert und nicht sammelbar', () => {
    const art = findeArt(ART_BUDGET_ERSCHOEPFT);
    expect(art).toBeDefined();
    expect(art?.sammelbar, 'am naechsten Morgen gelesen heisst nach der Nacht ohne Agenten')
      .toBe(false);
  });

  it('führt auf die Budgetseite des Mandanten — nicht auf die Aufgabenliste', () => {
    const b = erzeuge(ART_BUDGET_ERSCHOEPFT, {
      mandantId: MANDANT, objektTyp: 'agent_budget', objektId: BUDGET, daten: {},
    });
    expect(b.ziel).toBe(`/portal/${MANDANT}/agenten/budget`);
  });

  it('nennt den Monat, wenn er bekannt ist', () => {
    const b = erzeuge(ART_BUDGET_ERSCHOEPFT, {
      mandantId: MANDANT, objektTyp: 'agent_budget', objektId: BUDGET,
      daten: { monat: 'September 2026' },
    });
    expect(b.text).toContain('September 2026');
  });

  it('nennt ihn NICHT, wenn er unbekannt ist — statt eines leeren Klammerpaares', () => {
    const b = erzeuge(ART_BUDGET_ERSCHOEPFT, {
      mandantId: MANDANT, objektTyp: 'agent_budget', objektId: BUDGET, daten: { monat: '' },
    });
    expect(b.text).not.toContain('()');
    expect(b.text).toContain('Monatsbudget');
  });

  it('sagt, dass die manuelle Arbeit weiterläuft', () => {
    const b = erzeuge(ART_BUDGET_ERSCHOEPFT, {
      mandantId: MANDANT, objektTyp: 'agent_budget', objektId: BUDGET, daten: {},
    });
    /*
     * Das ist der Satz, der einen Anruf spart. Ohne ihn liest die Empfaengerin
     * „gestoppt" und nimmt an, das Portal sei aus.
     */
    expect(b.text).toMatch(/[Mm]anuelle Arbeit ist nicht betroffen/u);
  });
});
