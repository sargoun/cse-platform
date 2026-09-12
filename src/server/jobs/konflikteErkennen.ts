/**
 * `konflikte_erkennen` — naechtlich, je Mandant (TIM-05, TIM-06, TIM-14).
 *
 * Er laeuft NACH dem Generator: erst entstehen die Schichten des naechsten
 * Horizonts, dann wird geprueft, was sie zusammen bedeuten. Umgekehrt
 * pruefte er einen Plan, den es noch nicht gibt, und die Konfliktliste waere
 * jeden Morgen einen Tag alt.
 *
 * **Das Fenster ist kurz.** `app.arbzg_belastung` laesst hoechstens 35 Tage
 * zu, und das ist keine technische Grenze, sondern eine Aussage: der
 * Uebertritt ueber die Mandantengrenze ist ein Waechterwerkzeug, kein Export.
 * Geprueft werden darum die kommenden vier Wochen — der Zeitraum, in dem sich
 * ein Plan noch aendern laesst — UND die vergangene Woche: ein Verstoss, der
 * bereits stattgefunden hat, hoert nicht auf, einer zu sein, nur weil der Tag
 * vorbei ist.
 */
import { registriere, type JobDefinition, type JobKontext } from './registry.js';
import { erkenneKonflikte, type DetektorBericht } from '../services/arbzg/detektor.js';
import type { Abfrage } from '../services/arbzg/pruefung.js';

const FENSTER_TAGE = 28;

/**
 * **Und sieben Tage ZURUECK.**
 *
 * Der Lauf begann bei `now()`, und `ladeKandidaten` filtert
 * `e.ende_zeitpunkt > $2`: eine Schicht, die bereits vorbei war, konnte
 * niemals Kandidat werden. Ein Plan, der am Vorabend kurzfristig geaendert
 * wurde — Einspringen fuer eine Kranke, eine vorgezogene Nachtschicht —, war
 * am naechsten Morgen unpruefbar. Der Verstoss hatte stattgefunden und stand
 * nirgends.
 *
 * Sieben Tage sind kein runder Wert, sondern die Woche, in der eine Korrektur
 * noch etwas bewirkt: die Zeiterfassung ist offen, der Monat nicht
 * abgeschlossen, und die Ruhezeit der Folgewoche laesst sich noch planen.
 *
 * **Was das NICHT loest** (D-305, bewusst nicht in diesem PR): geprueft wird
 * die EINTEILUNG, nicht die erfasste Zeit. Eine Schicht, die 06:00–14:00
 * geplant war und 06:00–18:00 gearbeitet wurde, faellt hier weiter durch —
 * dafuer braucht der Detektor einen zweiten Kandidatenweg ueber
 * `zeiteintrag`, und der ist eine eigene Runde wert.
 */
const RUECKBLICK_TAGE = 7;

export function registriereKonfliktDetektor(db: Abfrage): JobDefinition {
  return registriere({
    schluessel: 'konflikte_erkennen',
    bezeichnung: 'Arbeitszeit- und Planungskonflikte der kommenden vier Wochen erkennen',
    // 02:45 UTC — eine halbe Stunde nach dem Generator, damit er auf einem
    // vollstaendigen Horizont prueft. Der Zeitplan ist UTC (K-21): 02:45
    // Ortszeit gibt es in einer Umstellungsnacht nicht und in der anderen
    // zweimal.
    zeitplan: '45 2 * * *',
    bereich: 'je_mandant',
    versuche: 2,
    ausfuehren: async (kontext: JobKontext): Promise<Record<string, unknown>> => {
      if (kontext.mandantId === null) {
        throw new Error('konflikte_erkennen ist je_mandant und braucht einen Mandanten.');
      }
      // Der Zeitpunkt kommt aus der DATENBANK (Invariante 5).
      const [uhr] = (await db.unsafe(`select now() as jetzt`)) as { jetzt: Date | string }[];
      const jetzt = uhr!.jetzt instanceof Date ? uhr!.jetzt : new Date(uhr!.jetzt);
      const von = new Date(jetzt.getTime() - RUECKBLICK_TAGE * 86_400_000);
      const bis = new Date(jetzt.getTime() + FENSTER_TAGE * 86_400_000);

      /**
       * `true`: dieser Lauf verbindet sich als `cse_job`. Ohne das Kennzeichen
       * griff der Detektor `app.arbzg_belastung` — nur `cse_app` gewaehrt —
       * und der Nachtlauf endete in `42501`, bevor er einen einzigen Befund
       * schreiben konnte. Ein Waechter, der jede Nacht abgewiesen wird und
       * nichts meldet, sieht von aussen aus wie einer, der nichts findet.
       */
      const bericht: DetektorBericht = await erkenneKonflikte(
        db, kontext.mandantId, von, bis, true,
      );
      return {
        ...bericht,
        fenster_tage: FENSTER_TAGE,
        rueckblick_tage: RUECKBLICK_TAGE,
      };
    },
  });
}
