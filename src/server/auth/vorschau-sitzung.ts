import type { Sitzung } from '../kontext/index.js';
import { aktuelleSitzung } from './anfrage-sitzung.js';

/**
 * Die Sitzung als ZWEITER Schlüssel einer Datei, die öffentlich sein kann —
 * ein Logo oder Titelbild (`api/marke`, V-100), ein Beitragsbild
 * (`api/beitragsbild`, V-225) (D-768 Nr. 6).
 *
 * **Was diese Routen von der Sitzung wollen.** Nur die Vorschau: eine
 * angemeldete Gesellschaft sieht ihre eigene, noch unveröffentlichte Datei.
 * Veröffentlichtes lädt jeder, ohne Anmeldung. Ohne Sitzung — und ohne
 * aktiven Bereich, also auch in der Gruppenansicht — gibt es keine Vorschau,
 * und es gibt auch KEINE Anmeldung: die Route antwortet wie für jede fremde
 * Kennung 404 (AUT-06). Eine Weiterleitung zur Anmeldung verriete, dass dort
 * eine Datei liegt; ein `<img>` folgte ihr ohnehin nicht.
 *
 * **Warum eine eigene Frage statt `aktuelleSitzung()`.** Die Sitzungswache
 * (`tests/kern/hilfen/sitzungswache.ts`) verlangt von jeder Route, die
 * `aktuelleSitzung()` fragt, die Weiche (`ohneSitzungAntwort`), weil sie sonst
 * „keine Sitzung" auf einem eigenen Weg beantwortet. Hier IST der eigene Weg
 * die Entscheidung — sie steht an dieser einen Stelle statt als Ausnahme je
 * Route. Die Wache sieht die Routen trotzdem: ein eigenes 401 oder ein Code
 * der Anmeldung fiele dort weiter auf.
 */
export async function vorschauSitzung(): Promise<Sitzung | null> {
  const sitzung = await aktuelleSitzung();
  return sitzung !== null && sitzung.aktiverMandantId !== null ? sitzung : null;
}
