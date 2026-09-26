import type { LeseKontext } from '../../kontext/index.js';
import { OFFENE_ZUSTAENDE } from '../kern/aufgabe.js';

/**
 * Offene Aufgaben über alle Gesellschaften — die Liste hinter der Spalte
 * „Offene Aufgaben" der Gruppenübersicht (DSH-01, DSH-04, V-150, D-644).
 *
 * **Dieselbe Menge wie die Zahl davor.** `gruppenUebersicht` zählt je Bereich
 * `aufgabe` mit `geloescht_am is null` und einem Stand aus
 * `OFFENE_ZUSTAENDE` (`kern/aufgabe.ts`) — dieselbe Menge, die `/aufgaben`
 * im Bereich in seiner Vorgabe zeigt. Hier steht dasselbe Prädikat mit
 * denselben Werten; ein vierter offener Stand ändert beide.
 *
 * **Gelesen wird über `t_aufgabe_gruppe`** (0230): `gruppe.aufgabe.lesen` je
 * Bereich, nie schreibbar (Invariante 10). Die zugewiesene Person steht
 * hier bewusst nicht: `benutzer` ist im Gruppen-Scope nicht allgemein
 * lesbar, und eine Spalte, die je nach Recht leer bliebe, sähe aus wie
 * „niemandem zugewiesen".
 */
export interface GruppenAufgabe {
  readonly id: string;
  readonly slug: string;
  readonly bereichName: string;
  readonly titel: string;
  /** Der Stand als Schlüssel — die Seite übersetzt ihn, zeigt ihn nie roh. */
  readonly status: string;
  /**
   * Die Frist in Berliner Ortszeit (Invariante 2): ein Zeitpunkt als
   * `TT.MM.JJJJ HH:MM`, ein Kalendertag als `TT.MM.JJJJ`, sonst NULL.
   */
  readonly faellig: string | null;
}

interface Roh {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly titel: string;
  readonly status: string;
  readonly faellig: string | null;
}

/** Wie viele Zeilen die Liste höchstens zeigt — dieselbe Grenze wie die übrigen Gruppenlisten. */
export const GRUPPEN_AUFGABEN_GRENZE = 500;

export async function gruppenAufgaben(
  kontext: LeseKontext, mandantIds: readonly string[],
): Promise<readonly GruppenAufgabe[]> {
  const zeilen = await kontext.abfrage<Roh>(
    `select a.id, m.slug, m.name as bereich_name, a.titel, a.status::text as status,
            coalesce(
              to_char(a.faellig_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'),
              to_char(a.faellig_datum, 'DD.MM.YYYY')) as faellig
       from aufgabe a
       join mandant m on m.id = a.mandant_id
      where a.mandant_id = any($1::uuid[])
        and a.geloescht_am is null
        and a.status::text = any($2::text[])
      order by coalesce(a.faellig_am,
                        (a.faellig_datum + time '23:59') at time zone 'Europe/Berlin')
                 nulls last,
               m.sortierung, a.id
      limit $3::int`,
    [mandantIds, OFFENE_ZUSTAENDE, GRUPPEN_AUFGABEN_GRENZE]);
  return zeilen.map((z) => ({
    id: z.id, slug: z.slug, bereichName: z.bereich_name, titel: z.titel,
    status: z.status, faellig: z.faellig,
  }));
}
