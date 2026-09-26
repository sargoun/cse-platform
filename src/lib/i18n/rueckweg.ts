/**
 * Die Beschriftung des Rueckwegs in allen vier Portalsprachen
 * (DESIGN §5 „The way back", D-613).
 *
 * **Warum nicht im Bauteil selbst** — dieselbe Begruendung wie bei `pille.ts`:
 * der Rueckweg steht in beiden Welten. Im Verwaltungsportal (de/en) und im
 * Arbeiterportal (de/en/ar/tr, EMP-12, SPEC §10). Eine Zeichenkette im Bauteil
 * haette sich fuer eine der beiden entscheiden muessen, und die Wahl `de`
 * haette der Arbeiterin, die Arabisch eingestellt hat, ein deutsches
 * `aria-label` vorgelesen.
 *
 * **Es ist ein `aria-label`, und gerade deshalb zaehlt es.** Sichtbar steht
 * daneben der Text, den die Seite uebergibt („Alle Anstellungen") — den sieht
 * jeder. Das Label hoert nur, wer die Seite vorlesen laesst, und genau dieser
 * Mensch hat am wenigsten davon, wenn es in einer Sprache steht, die er nicht
 * spricht. BFSG gilt (DESIGN §9).
 *
 * **Kein Fachbegriff.** „Zurueck" traegt keine Rechtsbedeutung wie `Mandant`
 * oder `Leistungsnachweis`; es ist die Beschriftung eines Pfeils und wird
 * deshalb uebersetzt, nicht stehen gelassen.
 */
import { istPortalSprache, type PortalSprache } from './texte.js';

export const RUECKWEG_TEXTE: Readonly<Record<PortalSprache, string>> = {
  de: 'Zurück',
  en: 'Back',
  ar: 'رجوع',
  tr: 'Geri',
};

/**
 * Die Beschriftung zu einer Sprache — faellt auf Deutsch, wenn keine oder eine
 * unbekannte kommt.
 *
 * Dasselbe Verhalten wie bei der Pille: `sprache` ist freiwillig, damit eine
 * Verwaltungsseite den Rueckweg setzen kann, ohne ihn zu uebergeben, und
 * trotzdem nie ein leeres Label entsteht.
 */
export function rueckwegLabel(sprache?: string | null): string {
  /* `istPortalSprache` nimmt einen `string`; `null` und `undefined` sind hier
     der Normalfall einer Verwaltungsseite, die nichts uebergibt. */
  return typeof sprache === 'string' && istPortalSprache(sprache)
    ? RUECKWEG_TEXTE[sprache]
    : RUECKWEG_TEXTE.de;
}
