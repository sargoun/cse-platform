/**
 * Die Verweise der öffentlichen Hülle auf die Seiten der GRUPPE (V-155,
 * D-649, PUB-01, REC-03).
 *
 * **Der Befund.** `/ueber-uns` und `/news` waren gebaut, befüllt und in der
 * Sitemap, `/karriere` war das öffentliche Recruiting-Portal — und keine
 * Seite verlinkte eine davon. Die Kopfzeile führt vier Punkte (DESIGN §5,
 * D-417: mit mehr läuft die Zeile ab 1024px über), das Telefonmenü dieselben
 * vier, der Fuss nur Gesellschaften und Rechtliches. Wer „Über uns" suchte,
 * musste die Adresse tippen; wer Arbeit suchte, fand die Stellen nicht.
 *
 * **Warum eine Liste hier und nicht in der Hülle.** Die Hülle rendert sie
 * zweimal (Fuss und Telefonmenü), und `tests/kern/oeffentliche-navigation.test.ts`
 * prüft sie gegen den Dateibaum: jedes Ziel muss es in der Sprache, in die der
 * Verweis führt, wirklich geben. Stünde die Liste im Bauteil, liesse sie sich
 * nur über das Bauteil prüfen — und das rendert hier niemand.
 */
import { verweisIn, type Sprache, type SprachVerweis } from './sprache.js';

export const GRUPPEN_SEITEN = [
  { pfad: '/ueber-uns', schluessel: 'ueberUns' },
  { pfad: '/news', schluessel: 'news' },
  { pfad: '/karriere', schluessel: 'karriere' },
] as const;

export type GruppenSchluessel = (typeof GRUPPEN_SEITEN)[number]['schluessel'];

export interface GruppenVerweis extends SprachVerweis {
  readonly schluessel: GruppenSchluessel;
  /** Der Pfad OHNE Sprachpräfix — für `aria-current` gegen den offenen Pfad. */
  readonly pfad: string;
}

/**
 * Die drei Verweise, so wie eine Seite in `sprache` sie zeigt.
 *
 * `/karriere` ist bisher nur deutsch (`NUR_DEUTSCH`, O-512). Von einer
 * englischen Seite aus führt der Verweis deshalb auf die DEUTSCHE Seite und
 * trägt `sprache: 'de'` — die Hülle setzt daraus `hrefLang` und den Hinweis
 * „(in German)". `/en/karriere` wäre ein 404.
 */
export function gruppenVerweise(sprache: Sprache): readonly GruppenVerweis[] {
  return GRUPPEN_SEITEN.map(({ pfad, schluessel }) => ({
    ...verweisIn(pfad, sprache), schluessel, pfad,
  }));
}
