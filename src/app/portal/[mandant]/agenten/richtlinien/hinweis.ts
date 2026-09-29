import { HINWEIS_TEXT } from '@/server/services/agent/richtlinie';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * Der Satz zu `?hinweis=` auf den drei Richtlinienseiten (Agentenzentrum:
 * Liste und Blatt; Einstellungen) — nur als eigener Eintrag von
 * `HINWEIS_TEXT` (D-728, D-774 Nachrunde).
 *
 * **Der Befund.** Alle drei Seiten schlugen `HINWEIS_TEXT[suche['hinweis']]`
 * nach. `HINWEIS_TEXT` ist ein gewöhnliches Objektliteral und erbt von
 * `Object.prototype`: `?hinweis=__proto__` fand `Object.prototype` selbst,
 * `?hinweis=constructor` die Funktion `Object`. Beides ist nicht
 * `undefined`, der Rückfall griff nicht, und React weigert sich, ein Objekt
 * als Kind zu zeigen — ein Link, den jeder tippen kann, brachte die Seite
 * zum Absturz. Die Wache `nachschlagen.test.ts` sah es nicht: sie sucht
 * `[fehler]` und `[grund]`, hier hiess der Schlüssel `hinweis`.
 *
 * Ein unbekannter Name zeigt nichts — wie bisher; nie den Namen selbst.
 */
export function richtlinienHinweis(
  suche: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  return eigenerEintrag(HINWEIS_TEXT, suche['hinweis']) ?? null;
}
