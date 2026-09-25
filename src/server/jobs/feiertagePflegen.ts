/**
 * `feiertage_pflegen` — die Berliner Feiertage in den Kalender schreiben
 * (CLN-03, TIM-02, V-178, D-672).
 *
 * **Der Lauf, den 0028 angekuendigt hat und den es nicht gab.** `feiertag`
 * wird von Generator, Turnusvorschau und Dienstplan gelesen und hatte keinen
 * Schreiber; ein Turnus mit `ausfall` plante deshalb am 3. Oktober. Dieser
 * Lauf traegt das laufende und die zwei folgenden Jahre ein (`pflegeJahre`)
 * und meldet, was er vorfindet, statt es umzuschreiben
 * (`services/dienstplan/feiertage.ts`).
 *
 * **`plattform`, nicht `je_mandant`.** `feiertag` traegt keine `mandant_id` —
 * der 3. Oktober ist fuer alle vier Gesellschaften derselbe Tag (0028, K-16).
 * Ein Lauf je Mandant schriebe viermal dieselbe Zeile, und drei davon faenden
 * sie schon vor.
 *
 * **Als `cse_job`** (`alsJobRolle`): die Policy `f_job` (0028) ist der eine
 * Schreibweg auf diese Tabelle. Unter der Rolle aus `DATABASE_URL` liefe er
 * in CI als Superuser und bewiese nichts ueber die Auslieferung.
 *
 * **Um 01:50 UTC — vor `einsaetze_generieren` (02:15 UTC).** In der Nacht zum
 * 1. Januar kommt so das neue uebernaechste Jahr hinzu, bevor der Generator
 * seinen Horizont darueber legt. „Heute" kommt aus der Datenbank
 * (`app.berlin_heute()`), nicht aus der Prozessuhr (Invariante 5).
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobRolle, type JobVerbindung } from './sitzung.js';
import { pflegeFeiertage, pflegeJahre } from '../services/dienstplan/feiertage.js';

export function registriereFeiertagePflegen(db: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'feiertage_pflegen',
    bezeichnung: 'Berliner Feiertage in den Kalender schreiben (laufendes Jahr und zwei weitere)',
    zeitplan: '50 1 * * *',
    bereich: 'plattform',
    // Idempotent ueber `feiertag_uk`: ein zweiter Versuch traegt nichts doppelt ein.
    versuche: 2,
    /*
     * Schreibend (`nurLesen: false`), und zwar genau eine Tabelle:
     * `feiertag` — neue Zeilen, nie eine Aenderung an einer vorhandenen
     * (siehe Dienst).
     */
    ausfuehren: async () => alsJobRolle(db, async (jd) => {
      const [heute] = await jd.abfrage<{ jahr: number }>(
        `select extract(year from app.berlin_heute())::int as jahr`);
      if (heute === undefined) {
        throw new Error('Die Datenbank lieferte kein Berliner Datum.');
      }
      return pflegeFeiertage(jd, pflegeJahre(Number(heute.jahr)));
    }, { nurLesen: false }),
  });
}
