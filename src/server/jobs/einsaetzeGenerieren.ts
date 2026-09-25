/**
 * `einsaetze_generieren` — naechtlich, je Mandant (TIM-03).
 *
 * **`je_mandant`, nicht `uebergreifend`.** Ein Lauf sieht die Serien genau
 * eines Bereichs und schreibt sein Ergebnis nach `job_lauf_mandant`. Ein
 * uebergreifender Lauf haette eine Mandantengrenze ueberschritten, ohne dass
 * jemand die Entscheidung dazu getroffen haette.
 *
 * **Nachts um 02:15 UTC — und ausdruecklich nicht um 02:15 Ortszeit.** Der
 * Zeitplan ist UTC (K-21), und das ist hier mehr als eine Konvention: 02:15
 * Berliner Zeit gibt es in der Nacht der Vorstellung nicht, und in der Nacht
 * der Rueckstellung gibt es sie zweimal. Ein Generator, der genau in dieser
 * Nacht gar nicht oder doppelt liefe, waere schwer zu finden und einmal im
 * Jahr teuer.
 *
 * **„Heute" kommt aus der Datenbank** (Invariante 5). Die Uhr dieses
 * Prozesses ist nicht die Wahrheit; ein um Stunden falsch gehender Runner
 * verschoebe den ganzen Horizont.
 */
import { registriere, type JobDefinition, type JobKontext } from './registry.js';
import {
  berlinHeute, generiereEinsaetze, type Abfrage,
} from '../services/dienstplan/generator.js';

export function registriereEinsatzGenerator(db: Abfrage): JobDefinition {
  return registriere({
    schluessel: 'einsaetze_generieren',
    bezeichnung: 'Dienstplan aus den Serien materialisieren (acht Wochen)',
    zeitplan: '15 2 * * *',
    bereich: 'je_mandant',
    // Ein Netzfehler ist kein Grund aufzugeben; die Arbeit ist idempotent,
    // ein zweiter Versuch legt also nichts doppelt an.
    versuche: 2,
    ausfuehren: async (kontext: JobKontext) => {
      if (kontext.mandantId === null) {
        throw new Error('einsaetze_generieren ist je_mandant und braucht einen Mandanten.');
      }
      const heute = await berlinHeute(db);
      const berichte = await generiereEinsaetze(db, kontext.mandantId, {
        heute, laufId: kontext.laufId,
      });

      /**
       * Die Summe UND die Serien, die etwas nicht anwenden konnten (§8.4).
       *
       * Nur die Summe zu melden waere die stille Variante: eine
       * Serienaenderung, die auf lauter bereits gearbeitete Schichten trifft,
       * saehe als „0 aktualisiert" aus wie ein ruhiger Lauf.
       */
      const summe = berichte.reduce(
        (a, b) => ({
          erzeugt: a.erzeugt + b.erzeugt,
          aktualisiert: a.aktualisiert + b.aktualisiert,
          storniert: a.storniert + b.storniert,
        }),
        { erzeugt: 0, aktualisiert: 0, storniert: 0 },
      );
      /*
       * V-178: ein Kalenderjahr ohne Feiertage im Horizont ist KEIN ruhiger
       * Lauf — dort faellt kein Turnus mit `ausfall` aus. Es steht deshalb im
       * Laufprotokoll, nicht nur an der einzelnen Serie.
       */
      const ohneKalender = [...new Set(berichte.flatMap((b) => b.feiertagskalenderFehlt ?? []))]
        .sort((a, b) => a - b);
      return {
        ...summe,
        serien: berichte.length,
        stichtag: heute,
        nicht_angewandt: berichte
          .filter((b) => b.uebersprungen.length > 0)
          .map((b) => ({ serie: b.planungsserieId, faelle: b.uebersprungen })),
        ...(ohneKalender.length === 0 ? {} : { feiertagskalender_fehlt: ohneKalender }),
      };
    },
  });
}
