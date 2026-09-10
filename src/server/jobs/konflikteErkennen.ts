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
 * ein Plan noch aendern laesst.
 */
import { registriere, type JobDefinition, type JobKontext } from './registry.js';
import { erkenneKonflikte, type DetektorBericht } from '../services/arbzg/detektor.js';
import type { Abfrage } from '../services/arbzg/pruefung.js';

const FENSTER_TAGE = 28;

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
      const bis = new Date(jetzt.getTime() + FENSTER_TAGE * 86_400_000);

      const bericht: DetektorBericht = await erkenneKonflikte(
        db, kontext.mandantId, jetzt, bis,
      );
      return { ...bericht, fenster_tage: FENSTER_TAGE };
    },
  });
}
