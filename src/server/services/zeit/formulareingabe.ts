import { berlinInstant, istKalendertag } from './dauer.js';

/**
 * Was ein `datetime-local`-Feld schickt, und was daraus werden muss.
 *
 * **Diese Datei lag unter `services/social/planeingabe.ts`** — an Social war
 * sie nie gebunden, sie stand dort nur, weil die Beitragsplanung sie zuerst
 * brauchte. Der Gesprächstermin (REC-06) braucht dieselbe Umrechnung, und eine
 * zweite Fassung wäre eine zweite Wahrheit über dieselbe Zeitzone. Der alte
 * Pfad re-exportiert weiter, damit ein Umzug keine Datei anfasst, die sich
 * sonst nicht ändert.
 *
 * **Warum eine eigene Datei.** Die Funktion gehörte zuerst in die Route —
 * und Next.js weist das ab: aus einer `route.ts` darf nur exportiert werden,
 * was ein Routenhandler ist. Das ist keine Schikane, sondern dieselbe Regel,
 * die CLAUDE.md meint („Route handlers stay thin: authorize → call a service
 * → return"): eine Umrechnung, die ein Test lesen soll, ist ein Dienst.
 *
 * **Übersetzt wird mit `berlinInstant`, nicht mit `new Date(wert)`.** Ein
 * `datetime-local`-Wert trägt keine Zone; `new Date` liest ihn als Ortszeit
 * des Servers, und der läuft in UTC — aus 09:00 Berlin würden 09:00 UTC, im
 * Sommer zwei Stunden zu früh. `berlinInstant` steht seit der Zeiterfassung
 * in `zeit/dauer.ts`, ist gegen beide Umstellungsnächte geprüft und sagt
 * ausdrücklich, wohin eine Uhrzeit fällt, die es zweimal oder gar nicht gibt.
 */

export interface EingabeFehler { readonly grund: string; readonly satz: string }

/** `2026-04-01T09:00` (Berliner Ortszeit) als Instant — oder der Grund. */
export function planEingabe(wert: string): Date | EingabeFehler {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(wert.trim());
  if (treffer === null) {
    return {
      grund: 'zeitpunkt_unlesbar',
      satz: 'Der Zeitpunkt ist keiner. Erwartet werden Datum und Uhrzeit in Berliner Zeit.',
    };
  }
  const [, j, mo, t, st, mi] = treffer;
  const jahr = Number(j);
  const monat = Number(mo);
  const tag = Number(t);
  const stunde = Number(st);
  const minute = Number(mi);
  /*
   * **Die Form zu pruefen genuegt nicht.** `2026-02-30` hat sie, und
   * `Date.UTC` rutscht stillschweigend auf den 2. Maerz weiter -- der Beitrag
   * ginge an einem Tag hinaus, den niemand gewaehlt hat. Dieselbe Pruefung
   * wie in `berlinTagesZeitpunkt`.
   */
  if (!istKalendertag(jahr, monat, tag)) {
    return { grund: 'kein_kalendertag', satz: `Diesen Tag gibt es nicht: ${wert.trim()}.` };
  }
  if (stunde > 23 || minute > 59) {
    return { grund: 'keine_uhrzeit', satz: `Diese Uhrzeit gibt es nicht: ${wert.trim()}.` };
  }
  return berlinInstant(jahr, monat, tag, stunde, minute);
}
