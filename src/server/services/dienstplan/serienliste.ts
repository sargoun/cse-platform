import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';

/**
 * Die LESENDE Seite der Serien — an EINER Stelle (TIM-02, TIM-03, CLN-02,
 * D-487).
 *
 * **Der Befund, der diese Datei gebracht hat.** Die Serienliste stand als
 * `kontext.abfrage`-Aufruf mitten in
 * `src/app/portal/[mandant]/dienstplan/serien/page.tsx`. Solange sie die
 * einzige Seite war, die Serien zeigt, war das nur unschön. Mit
 * `/reinigung/turnus` daneben wäre es eine ZWEITE WAHRHEIT über zwei Zahlen
 * geworden, die beide Seiten gross anzeigen:
 *
 *  - **„Wie viele Termine hat diese Serie?"** — `count(*) from einsatz where
 *    storniert_am is null`. Eine Kopie, die das `storniert_am` vergisst,
 *    zählt stornierte Schichten mit und meldet einen Plan, den es nicht gibt.
 *  - **„Bis wann ist geplant?"** — `planungsserie.generiert_bis`. Eine Serie,
 *    die stehen geblieben ist, sieht sonst aus wie eine Serie ohne Termine.
 *
 * **Die Geltung hängt am TRÄGER, nicht an der Serie.** `planungsserie` trägt
 * kein `gueltig_ab`/`gueltig_bis` — das steht in `turnus` bzw. `posten`.
 * Deshalb steht hier `coalesce(t.gueltig_bis, p.gueltig_bis)` und nicht
 * `ps.gueltig_bis`; die Spalte gibt es nicht, und ein `select` darauf wäre ein
 * Fehler beim ersten Aufruf — im besten Fall.
 *
 * **Die Rechte laufen auseinander, und das ist hier wichtig.** `turnus` liegt
 * hinter `reinigung.lesen`, `planungsserie` und `einsatz` hinter
 * `dienstplan.lesen` (nachgemessen in `pg_policies`). Diese Datei liest
 * ANKERND auf `planungsserie` — sie ist deshalb die Liste für den
 * Dienstplanbereich, nicht die für das Reinigungsmodul. Der turnus-verankerte
 * Blick steht in `services/reinigung/turnus.ts` und benutzt die Bausteine
 * unten, damit die beiden Zahlen dieselben bleiben.
 */

/**
 * „Lebende Termine dieser Serie" — der EINE Ausdruck.
 *
 * Als Lateral und nicht als korrelierte Unterabfrage im `select`, damit
 * hundert Serien eine Abfrage bleiben und nicht hunderteins werden.
 */
export const EINSAETZE_LEBEND = `
  left join lateral (
         select count(*) as anzahl from einsatz e
          where e.planungsserie_id = ps.id and e.storniert_am is null
       ) e on true`;

/** Dasselbe für einen Blick, der am `turnus` ankert statt an der Serie. */
export const EINSAETZE_LEBEND_JE_TURNUS = `
  left join lateral (
         select count(*) as anzahl from einsatz e
          where e.turnus_id = t.id and e.storniert_am is null
       ) e on true`;

/**
 * Die Feiertagsregel einer Serie — aus dem Träger, sonst aus der Serie.
 *
 * `posten` trägt keine `feiertagsregel`-Spalte: die Entscheidung wurde bei der
 * Anlage in `planungsserie.feiertage_ueberspringen` festgeschrieben (§8.5), und
 * eine spätere Stammdatenpflege soll die Historie nicht umdatieren.
 */
export const FEIERTAGSREGEL = `
  coalesce(t.feiertagsregel::text,
           case when ps.feiertage_ueberspringen then 'ausfall' else 'unveraendert' end)`;

export interface SerienListeZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly objekt: string;
  readonly revier: string | null;
  readonly rrule: string;
  readonly beginn_lokal: string;
  readonly dauer_minuten: number;
  readonly feiertagsregel: string;
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
  readonly generiert_bis: string | null;
  readonly archiviert: boolean;
  readonly einsaetze: number;
}

/**
 * Turnus-Serien (Reinigung) und Postenserien (Sicherheit) in EINER Liste.
 *
 * Verlangt `dienstplan.lesen` — ohne das Recht filtert die RLS auf
 * `planungsserie` still auf null Zeilen, und die Seite dahinter ist auf
 * `dienstplan.lesen` bewacht, also kann das gar nicht eintreten.
 */
export async function listeSerien(
  kontext: LeseKontext,
): Promise<readonly SerienListeZeile[]> {
  return kontext.abfrage<SerienListeZeile>(
    `select ps.id, coalesce(t.bezeichnung, p.bezeichnung) as bezeichnung,
            o.bezeichnung as objekt, r.bezeichnung as revier,
            coalesce(t.rrule, p.abdeckung_rrule)                        as rrule,
            to_char(coalesce(t.dtstart_lokal, p.dtstart_lokal), 'HH24:MI') as beginn_lokal,
            coalesce(t.dauer_minuten, p.dauer_minuten, 0)::int           as dauer_minuten,
            ${FEIERTAGSREGEL}                                            as feiertagsregel,
            to_char(coalesce(t.gueltig_ab, p.gueltig_ab), 'YYYY-MM-DD')   as gueltig_ab,
            to_char(coalesce(t.gueltig_bis, p.gueltig_bis), 'YYYY-MM-DD') as gueltig_bis,
            to_char(ps.generiert_bis, 'YYYY-MM-DD')        as generiert_bis,
            (ps.archiviert_am is not null)                 as archiviert,
            coalesce(e.anzahl, 0)::int                     as einsaetze
       from planungsserie ps
       left join turnus t on t.mandant_id = ps.mandant_id and t.id = ps.turnus_id
       left join posten p on p.mandant_id = ps.mandant_id and p.id = ps.posten_id
       left join revier r on r.mandant_id = t.mandant_id and r.id = t.revier_id
       join objekt o on o.mandant_id = ps.mandant_id and o.id = coalesce(r.objekt_id, p.objekt_id)
       ${EINSAETZE_LEBEND}
      order by ps.archiviert_am nulls first, o.bezeichnung, coalesce(t.bezeichnung, p.bezeichnung)`,
  );
}
