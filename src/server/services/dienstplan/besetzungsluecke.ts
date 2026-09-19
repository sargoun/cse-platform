import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';

/**
 * Offene Schichten — gewerkeuebergreifend (TIM-05, REC-01, SEC-01).
 *
 * ## Der Befund, der diese Datei geprägt hat
 *
 * Es gab bereits DREI Antworten auf die Frage „welche Schicht ist unbesetzt?",
 * und sie widersprachen sich:
 *
 *  1. `posten_unterbesetzung` (0069) — `besetzt_anzahl < min_besetzung`, aber
 *     **nur Postenschichten**, also nur Sicherheit.
 *  2. Die Kachel `schichten_unbesetzt` (`bericht/kacheln.ts`) —
 *     `besetzt_anzahl < soll_besetzung`, sieben Tage, alle Gewerke.
 *  3. `bedarf()` (`recruiting/dienst.ts`, REC-01) — Zahl der ZUSAGEN gegen
 *     `min_besetzung`, N Wochen, je Objekt aggregiert.
 *
 * Eine vierte Definition daneben zu setzen waere die schlimmste Antwort: vier
 * Bildschirme, vier Zahlen, jede plausibel. Diese Datei fuehrt deshalb keine
 * eigene Definition ein, sondern **zeigt beide Messgroessen nebeneinander**
 * und beschriftet sie:
 *
 *  - `eingeteilt` = `einsatz.besetzt_anzahl`, die gefuehrte Zahl LEBENDER
 *    Zuordnungen (0028) — das, was Kachel und Postensicht zaehlen.
 *  - `zugesagt`   = Zuordnungen mit `status = 'zugesagt'` — das, was
 *    `bedarf()` zaehlt und was morgens tatsaechlich erscheint.
 *
 * Beide werden gegen `min_besetzung` UND `soll_besetzung` gestellt. Damit
 * kann diese Seite die Kachel und REC-01 erklaeren, statt ihnen zu
 * widersprechen.
 *
 * ## Was diese Datei NICHT tut
 *
 * Sie leitet **keinen Personalbedarf** ab. Aus „14 unbesetzte Schichten"
 * folgt keine Zahl an Einzustellenden — dafuer braeuchte es Vertragsmodelle,
 * Ausfallquoten und ArbZG-Grenzen je Person. `bedarf()` aggregiert diese
 * Zahlen je Objekt; die Stelle schreibt ein Mensch.
 *
 * Sie entscheidet auch nicht, ob eine Absage die Besetzung mindert — das ist
 * O-170 und unbeantwortet. `eingeteilt` zaehlt deshalb, was lebt, und
 * `zugesagt` daneben, was zugesagt ist; wer die Differenz sieht, sieht die
 * offene Frage.
 *
 * ## Zeit
 *
 * Das Fenster wird in BERLINER Kalendertagen genannt und in der Datenbank zu
 * Instants aufgeloest (K-11, Invariante 2): `($1::date)::timestamp at time
 * zone 'Europe/Berlin'`. Ohne das `::timestamp` castet Postgres das Datum nach
 * `timestamptz` und rechnet es DANN nach Berlin — das Fenster begaenne im
 * Sommer vier Stunden zu spaet, und was fehlte, waere genau die Nachtschicht.
 * `bis` schliesst den ganzen Tag ein, sonst faellt die Schicht 22:00–06:00
 * des letzten Tages heraus.
 */

export interface LueckenFilter {
  /** Berliner Kalendertag `JJJJ-MM-TT`, inklusiv. */
  readonly von: string;
  /** Berliner Kalendertag `JJJJ-MM-TT`, inklusiv — der GANZE Tag. */
  readonly bis: string;
  readonly objektId?: string | null;
  /** Nur Schichten, deren Zusagen unter der Mindestbesetzung liegen. */
  readonly nurUnterMindest?: boolean;
}

export interface OffeneSchicht {
  readonly einsatzId: string;
  readonly quelle: 'turnus' | 'posten' | 'veranstaltung' | 'sonderleistung' | 'projekt' | 'manuell';
  readonly status: 'geplant' | 'laufend';
  /** `DD.MM.YYYY` — der Tag, an dem die Schicht BEGINNT (22:00–06:00 steht am Abend). */
  readonly tagLokal: string;
  /** `HH24:MI`. */
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly endetAmFolgetag: boolean;
  readonly dauerMinuten: number;
  readonly zeitanomalie: 'keine' | 'dst_luecke' | 'dst_doppelt';
  readonly objektId: string;
  readonly objekt: string;
  readonly kunde: string | null;
  readonly posten: string | null;
  readonly revier: string | null;
  readonly sollBesetzung: number;
  readonly minBesetzung: number;
  /** `einsatz.besetzt_anzahl` — lebende Zuordnungen (Kachel, Postensicht). */
  readonly eingeteilt: number;
  /** Zuordnungen mit `status = 'zugesagt'` — die Zahl aus REC-01. */
  readonly zugesagt: number;
}

/** Ein Berliner Kalendertag, wie ihn diese Schicht schreibt. */
const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

export class LueckenFensterFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'LueckenFensterFehler';
  }
}

/**
 * Prueft das Fenster, ohne es stillschweigend zu verbiegen.
 *
 * Ein unlesbares Datum aus `?von=` wird von der Seite auf die Vorgabe
 * zurueckgesetzt — das ist die Aufgabe der Seite. Kommt hier trotzdem eines
 * an, ist es ein Programmfehler und kein Benutzerfehler; dann wirft die
 * Funktion, statt „alle Schichten" zu bedeuten.
 */
export function pruefeFenster(von: string, bis: string): void {
  if (!DATUM.test(von) || !DATUM.test(bis)) {
    throw new LueckenFensterFehler('Das Fenster besteht aus zwei Kalendertagen JJJJ-MM-TT.');
  }
  if (bis < von) {
    throw new LueckenFensterFehler('Das Fensterende liegt vor seinem Anfang.');
  }
}

/**
 * Wie dringend ist diese Luecke — **aus Zahlen, nie aus einer Formulierung**
 * (Invariante 6).
 *
 * Drei Stufen, und die Grenze zwischen ihnen ist die Mindestbesetzung:
 *
 *  - `unter_mindest`: es haben weniger Menschen zugesagt, als mindestens da
 *    sein muessen. Bei einem Wachposten ist das die Nacht, in der das Objekt
 *    unbewacht bleibt (§ 34a GewO, SEC-01).
 *  - `unter_soll`: die Mindestbesetzung steht, die vereinbarte Staerke nicht.
 *  - `voll`: beide stehen.
 *
 * **O-210 begrenzt, was diese Funktion behaupten darf.** Ob bei einer
 * Veranstaltung die vereinbarte Staerke ZUGLEICH die Mindestbesetzung ist, ist
 * unbeantwortet — `posten` traegt beide getrennt, die Eventschicht bekommt
 * den Spaltenvorgabewert 1. Deshalb wird `min_besetzung` genommen, wie es in
 * der Zeile steht, und nichts daraus abgeleitet.
 */
export type Dringlichkeit = 'unter_mindest' | 'unter_soll' | 'voll';

export function dringlichkeit(s: {
  readonly zugesagt: number; readonly minBesetzung: number;
  readonly eingeteilt: number; readonly sollBesetzung: number;
}): Dringlichkeit {
  if (s.zugesagt < s.minBesetzung) return 'unter_mindest';
  if (s.eingeteilt < s.sollBesetzung || s.zugesagt < s.sollBesetzung) return 'unter_soll';
  return 'voll';
}

interface RohZeile {
  einsatz_id: string;
  quelle: OffeneSchicht['quelle'];
  status: OffeneSchicht['status'];
  tag_lokal: string;
  beginn_lokal: string;
  ende_lokal: string;
  endet_am_folgetag: boolean;
  dauer_minuten: number;
  zeitanomalie: OffeneSchicht['zeitanomalie'];
  objekt_id: string;
  objekt: string;
  kunde: string | null;
  posten: string | null;
  revier: string | null;
  soll_besetzung: number;
  min_besetzung: number;
  eingeteilt: number;
  zugesagt: number;
}

/**
 * Die Schichten im Fenster, denen Leute fehlen.
 *
 * „Fehlen" heisst hier: `eingeteilt < soll_besetzung` ODER
 * `zugesagt < min_besetzung`. Die erste Haelfte ist die Bedingung des
 * Waechterindex `einsatz_unterbesetzt_idx` (0028) und der Kachel; die zweite
 * ist die von `bedarf()` (REC-01). Eine Schicht, auf die nur die zweite
 * zutrifft — voll eingeteilt, aber niemand hat zugesagt —, ist genau der Fall,
 * den ein Planer sehen muss und den die Kachel heute nicht zeigt.
 *
 * Stornierte Schichten sind keine Luecke: sie finden nicht statt.
 */
export async function leseOffeneSchichten(
  kontext: LeseKontext, filter: LueckenFilter,
): Promise<readonly OffeneSchicht[]> {
  pruefeFenster(filter.von, filter.bis);
  const zeilen = await kontext.abfrage<RohZeile>(
    `with fenster as (
       select ($1::date)::timestamp at time zone 'Europe/Berlin'            as von,
              (($2::date) + 1)::timestamp at time zone 'Europe/Berlin'      as bis
     ),
     zahlen as (
       select e.id,
              (select count(*) from einsatz_zuordnung z
                where z.einsatz_id = e.id and z.entfernt_am is null
                  and z.status = 'zugesagt')::int as zugesagt
         from einsatz e
         cross join fenster f
        where e.storniert_am is null
          and e.status in ('geplant','laufend')
          and e.beginn_zeitpunkt >= f.von
          and e.beginn_zeitpunkt <  f.bis
     )
     select e.id as einsatz_id, e.quelle::text as quelle, e.status::text as status,
            to_char((e.beginn_zeitpunkt at time zone 'Europe/Berlin'), 'DD.MM.YYYY')
              as tag_lokal,
            to_char((e.beginn_zeitpunkt at time zone 'Europe/Berlin'), 'HH24:MI')
              as beginn_lokal,
            to_char((e.ende_zeitpunkt   at time zone 'Europe/Berlin'), 'HH24:MI')
              as ende_lokal,
            e.endet_am_folgetag,
            (extract(epoch from (e.ende_zeitpunkt - e.beginn_zeitpunkt)) / 60)::int
              as dauer_minuten,
            e.zeitanomalie::text as zeitanomalie,
            e.objekt_id, o.bezeichnung as objekt, ku.name as kunde,
            p.bezeichnung as posten, r.bezeichnung as revier,
            e.soll_besetzung::int as soll_besetzung,
            e.min_besetzung::int  as min_besetzung,
            e.besetzt_anzahl::int as eingeteilt,
            z.zugesagt
       from einsatz e
       join zahlen z on z.id = e.id
       join objekt o on o.mandant_id = e.mandant_id and o.id = e.objekt_id
       left join kunde  ku on ku.mandant_id = e.mandant_id and ku.id = e.kunde_id
       left join posten p  on p.mandant_id = e.mandant_id and p.id = e.posten_id
       left join revier r  on r.mandant_id = e.mandant_id and r.id = e.revier_id
      where (e.besetzt_anzahl < e.soll_besetzung or z.zugesagt < e.min_besetzung)
        and ($3::uuid is null or e.objekt_id = $3::uuid)
        and ($4::boolean is false or z.zugesagt < e.min_besetzung)
      order by (z.zugesagt < e.min_besetzung) desc, e.beginn_zeitpunkt, o.bezeichnung`,
    [filter.von, filter.bis, filter.objektId ?? null, filter.nurUnterMindest === true],
  );

  return zeilen.map((z) => ({
    einsatzId: z.einsatz_id,
    quelle: z.quelle,
    status: z.status,
    tagLokal: z.tag_lokal,
    beginnLokal: z.beginn_lokal,
    endeLokal: z.ende_lokal,
    endetAmFolgetag: z.endet_am_folgetag,
    dauerMinuten: Number(z.dauer_minuten),
    zeitanomalie: z.zeitanomalie,
    objektId: z.objekt_id,
    objekt: z.objekt,
    kunde: z.kunde,
    posten: z.posten,
    revier: z.revier,
    sollBesetzung: Number(z.soll_besetzung),
    minBesetzung: Number(z.min_besetzung),
    eingeteilt: Number(z.eingeteilt),
    zugesagt: Number(z.zugesagt),
  }));
}

/** Die Objekte des Fensters — fuer den Filter, aus derselben Menge. */
export async function objekteMitLuecke(
  kontext: LeseKontext, filter: Pick<LueckenFilter, 'von' | 'bis'>,
): Promise<readonly { readonly id: string; readonly bezeichnung: string }[]> {
  pruefeFenster(filter.von, filter.bis);
  return kontext.abfrage<{ id: string; bezeichnung: string }>(
    `with fenster as (
       select ($1::date)::timestamp at time zone 'Europe/Berlin'       as von,
              (($2::date) + 1)::timestamp at time zone 'Europe/Berlin' as bis
     )
     select distinct o.id, o.bezeichnung
       from einsatz e
       join objekt o on o.mandant_id = e.mandant_id and o.id = e.objekt_id
       cross join fenster f
      where e.storniert_am is null
        and e.status in ('geplant','laufend')
        and e.beginn_zeitpunkt >= f.von
        and e.beginn_zeitpunkt <  f.bis
        and (e.besetzt_anzahl < e.soll_besetzung
             or (select count(*) from einsatz_zuordnung z
                  where z.einsatz_id = e.id and z.entfernt_am is null
                    and z.status = 'zugesagt') < e.min_besetzung)
      order by o.bezeichnung`,
    [filter.von, filter.bis],
  );
}
