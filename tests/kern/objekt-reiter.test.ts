/**
 * **Die zehn Reiter des Objektblatts — jeder mit Recht und Wort** (V-044).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `04-SEITENKARTE.md` §5.4 beschreibt `/objekte/[id]` mit zehn Reitern —
 * „each tab rendered only where its module is enabled and its `lesen` right
 * held". Gebaut war **einer**. Sechs der neun fehlenden Module gab es längst;
 * sie hängen alle an derselben `objekt_id`, und von der Objektseite aus
 * führte kein Weg dorthin.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was diese Sperrklinke hält.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Reiter, dessen Recht es nicht gibt, ist entweder unsichtbar (die
 * Rechteprüfung antwortet `false` auf einen unbekannten Schlüssel) oder
 * sichtbar für alle — je nachdem, wo der Tippfehler steht. Beides ist
 * schlechter als ein Fehler beim Bauen.
 *
 * Und ein Reiter ohne Wort in einer der beiden Sprachen zeigt seinen
 * SCHLÜSSEL. Das ist dieselbe Klasse wie V-123: Quelltext auf dem Schirm.
 */
import { describe, expect, it } from 'vitest';
import { REITER, istReiter } from '../../src/server/services/objekt/umfeld.js';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { OBJEKTE_TEXTE } from '../../src/lib/i18n/verwaltung/objekte.js';
import { modulFuerRecht } from '../../src/server/registry/modul.js';

describe('die Reiter des Objektblatts', () => {
  it('es sind die zehn aus der Seitenkarte', () => {
    expect(REITER.map((r) => r.schluessel)).toEqual([
      'uebersicht', 'raumbuch', 'reviere', 'posten', 'dienstanweisungen',
      'schluessel', 'auftraege', 'einsaetze', 'dokumente', 'qualitaet',
    ]);
  });

  it('jedes genannte Recht steht im Katalog', () => {
    const bekannt = new Set(KATALOG.map((e) => e.schluessel));
    const fremd = REITER
      .map((r) => r.recht)
      .filter((r): r is string => r !== null)
      .filter((r) => !bekannt.has(r));
    expect(fremd, 'Reiterrecht ohne Eintrag im Katalog').toEqual([]);
  });

  /**
   * `modulFuerRecht` ordnet jedes Recht seinem Modul zu; `modulAktiv` fragt
   * danach. Ein Recht, dessen Modul leer bliebe, wäre ein Reiter, den die
   * Modulbuchung nicht erreicht — er stünde auch in einer Gesellschaft, die
   * das Gewerk nicht gebucht hat.
   */
  it('jedes Reiterrecht hat ein Modul', () => {
    const ohne = REITER
      .map((r) => r.recht)
      .filter((r): r is string => r !== null)
      .filter((r) => modulFuerRecht(r).trim() === '');
    expect(ohne, 'Reiterrecht ohne Modul').toEqual([]);
  });

  it('jeder Reiter trägt in beiden Sprachen ein Wort', () => {
    const fehlt: string[] = [];
    for (const sprache of ['de', 'en'] as const) {
      const worte = OBJEKTE_TEXTE[sprache].reiter;
      for (const r of REITER) {
        const w = worte[r.schluessel];
        if (w === undefined || w.trim() === '') fehlt.push(`${sprache}:${r.schluessel}`);
      }
    }
    expect(fehlt, 'Reiter ohne Beschriftung — er zeigte sonst seinen Schlüssel').toEqual([]);
  });

  it('`istReiter` nimmt nur, was es gibt', () => {
    expect(istReiter('schluessel')).toBe(true);
    expect(istReiter('uebersicht')).toBe(true);
    /* Aus der Adresszeile kommt alles. */
    expect(istReiter('alle')).toBe(false);
    expect(istReiter('')).toBe(false);
    expect(istReiter(null)).toBe(false);
    expect(istReiter(7)).toBe(false);
  });
});
