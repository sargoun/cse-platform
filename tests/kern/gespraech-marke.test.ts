/**
 * Ein abgesagtes Gespräch steht nicht als „Abgelehnt" da (V-267, Prüfung der
 * Gruppe kalender-dokumente; DESIGN §5 „Status pills").
 *
 * „Abgelehnt" heisst im Recruiting, dass die Gesellschaft die Bewerbung
 * abgelehnt hat — eine Aussage über die Bewerberin (§ 22 AGG). Seit V-220
 * lässt sich ein Gespräch absagen, und der Seed sagt eines ab: Liste und
 * Gesprächsblatt zeigten dann „Abgelehnt" / „Rejected".
 */
import { describe, expect, it } from 'vitest';
import {
  BEWERBUNG_MARKE, GESPRAECH_MARKE,
} from '../../src/app/portal/[mandant]/recruiting/marken.js';
import { PILLE_TEXTE } from '../../src/lib/i18n/pille.js';

describe('die Marke eines Gesprächs', () => {
  it('abgesagt ist die neutrale „Archiviert" — in keiner Sprache „abgelehnt"', () => {
    expect(GESPRAECH_MARKE['abgesagt']).toBe('Archiviert');
    for (const sprache of ['de', 'en', 'ar', 'tr'] as const) {
      expect(PILLE_TEXTE[sprache][GESPRAECH_MARKE['abgesagt']!])
        .not.toBe(PILLE_TEXTE[sprache].Abgelehnt);
    }
  });

  it('kein Zustand eines Gesprächs trägt die Marke der abgelehnten Bewerbung', () => {
    expect(Object.values(GESPRAECH_MARKE)).not.toContain(BEWERBUNG_MARKE.abgelehnt);
    expect(GESPRAECH_MARKE).toEqual({
      geplant: 'Geplant', stattgefunden: 'Abgeschlossen', abgesagt: 'Archiviert',
    });
  });
});
