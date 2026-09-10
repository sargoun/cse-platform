import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import type { Sitzung } from '@/server/kontext/index';
import type { PlanSchicht, PlanTag } from '@/components/portal/Wochenplan';

/**
 * Die Daten des Dienstplans — und wo die Zeit gerechnet wird.
 *
 * **Jede Zeitangabe kommt fertig aus der Datenbank.** Die Ortszeiten als
 * Zeichenketten (`HH:MM`), die Tagesgrenzen als Instants der Berliner
 * Mitternachten. Der Node-Prozess rechnet keine Zone um: seine
 * Zonendatenbank ist nicht die des Servers, und `TZ` der Laufzeit soll den
 * Plan nicht verschieben koennen (Invariante 2, §7.2).
 *
 * **Ein Tag ist nicht immer 1440 Minuten lang.** An der Umstellung sind es
 * 1380 oder 1500, und genau deshalb kommen `beginn` und `ende` je Tag aus
 * `at time zone`, statt aus „Mitternacht plus 24 Stunden".
 */

interface TagZeile {
  readonly datum: string;
  readonly beginn: Date;
  readonly ende: Date;
  readonly feiertag: string | null;
}

interface BefundZeile {
  readonly einsatz_id: string;
  readonly art: string;
  readonly schwere: string;
  readonly blockiert: boolean;
  readonly text: string;
}

interface SchichtZeile {
  readonly id: string;
  readonly beginn: Date;
  readonly ende: Date;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
  readonly objekt: string;
  readonly revier: string | null;
  readonly besetzt: number;
  readonly soll: number;
  readonly status: string;
}

export interface Planfenster {
  readonly tage: readonly PlanTag[];
  readonly schichten: readonly PlanSchicht[];
}

export async function ladePlanfenster(
  sitzung: Sitzung, vonDatum: string, bisDatum: string,
): Promise<Planfenster> {
  return db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const tage = await kontext.abfrage<TagZeile>(
        /**
         * `d.tag::date` ueberall, weil `generate_series(date, date, interval)`
         * **timestamp** liefert und nicht `date`. `d.tag + 1` waere dort
         * `timestamp + integer` — ein Fehler, den Postgres wirft, und im
         * besten Fall ist er das: eine stille Variante haette den Tag um eine
         * Sekunde verschoben.
         */
        `select to_char(d.tag::date, 'YYYY-MM-DD')                    as datum,
                (d.tag::date::timestamp)       at time zone 'Europe/Berlin' as beginn,
                ((d.tag::date + 1)::timestamp) at time zone 'Europe/Berlin' as ende,
                f.bezeichnung                                         as feiertag
           from generate_series($1::date, $2::date, interval '1 day') as d(tag)
           left join feiertag f
             on f.datum = d.tag::date and f.bundesland = 'BE' and f.gesetzlich
          order by d.tag`,
        [vonDatum, bisDatum],
      );

      const schichten = await kontext.abfrage<SchichtZeile>(
        /**
         * `ende_zeitpunkt > fensterbeginn and beginn_zeitpunkt < fensterende`
         * — die Ueberschneidung, nicht `plan_datum between …`. Sonst fehlte
         * die Nachtschicht, die am Vortag beginnt, in der Spalte des
         * Folgetags: sichtbar leer, und niemand vermisst sie.
         */
        `select e.id,
                e.beginn_zeitpunkt              as beginn,
                e.ende_zeitpunkt                as ende,
                to_char(e.beginn_lokal, 'HH24:MI') as beginn_lokal,
                to_char(e.ende_lokal,   'HH24:MI') as ende_lokal,
                o.bezeichnung                   as objekt,
                r.bezeichnung                   as revier,
                e.besetzt_anzahl::int           as besetzt,
                e.soll_besetzung::int           as soll,
                e.status::text                  as status
           from einsatz e
           join objekt o on o.mandant_id = e.mandant_id and o.id = e.objekt_id
           left join revier r on r.mandant_id = e.mandant_id and r.id = e.revier_id
          where e.ende_zeitpunkt   > ($1::date::timestamp)       at time zone 'Europe/Berlin'
            and e.beginn_zeitpunkt < (($2::date + 1)::timestamp) at time zone 'Europe/Berlin'
          order by e.beginn_zeitpunkt, e.id`,
        [vonDatum, bisDatum],
      );

      /**
       * Die Befunde zu den Schichten des Fensters (TIM-05, TIM-06, SEC-04).
       *
       * Sie kommen aus `planungs_konflikt`, nicht aus einer Neuberechnung im
       * Seitenaufruf: der Detektor hat sie erkannt, quittiert wurden sie
       * womoeglich nicht, und der Plan soll zeigen, was OFFEN ist. Eine
       * Ansicht, die selbst nachrechnet, zeigte im Zweifel etwas anderes als
       * die Konfliktliste — zwei Wahrheiten ueber denselben Verstoss.
       *
       * Fremde Gesellschaften bleiben dabei ungenannt: `betrifft_fremden_mandant`
       * sagt DASS, nie wo (K-06).
       */
      const befunde = await kontext.abfrage<BefundZeile>(
        `select k.einsatz_id,
                k.art::text                       as art,
                k.schwere::text                   as schwere,
                k.blockiert,
                case k.art::text
                  when 'arbeitszeit'   then
                    case when k.betrifft_fremden_mandant
                         then 'Arbeitszeit über Gesellschaften hinweg'
                         else 'Arbeitszeit überschritten' end
                  when 'qualifikation' then 'Nachweis fehlt oder abgelaufen'
                  when 'ueberschneidung' then 'Überschneidet eine andere Schicht'
                  else 'Unterbesetzt'
                end                               as text
           from planungs_konflikt k
          where k.einsatz_id is not null
            and k.status = 'offen'
            and k.hinfaellig_am is null
            and k.zeitraum_ende   > ($1::date::timestamp)       at time zone 'Europe/Berlin'
            and k.zeitraum_beginn < (($2::date + 1)::timestamp) at time zone 'Europe/Berlin'`,
        [vonDatum, bisDatum],
      );
      const jeSchicht = new Map<string, BefundZeile[]>();
      for (const b of befunde) {
        const liste = jeSchicht.get(b.einsatz_id);
        if (liste === undefined) jeSchicht.set(b.einsatz_id, [b]);
        else liste.push(b);
      }

      return {
        tage: tage.map((t) => ({
          datum: t.datum,
          beschriftung: beschriftung(t.datum),
          beginn: new Date(t.beginn),
          ende: new Date(t.ende),
          feiertag: t.feiertag,
        })),
        schichten: schichten.map((s) => ({
          id: s.id,
          beginn: new Date(s.beginn),
          ende: new Date(s.ende),
          beginnLokal: s.beginn_lokal,
          endeLokal: s.ende_lokal,
          objekt: s.objekt,
          revier: s.revier,
          besetzt: Number(s.besetzt),
          soll: Number(s.soll),
          status: s.status,
          /**
           * `blockiert` wird zur Sperre, alles andere zur Warnung oder zum
           * Hinweis. Der Unterschied ist nicht Kosmetik: eine Sperre laesst
           * sich nicht uebergehen (SEC-04, §34a), eine Warnung mit
           * Begruendung schon.
           */
          befunde: (jeSchicht.get(s.id) ?? []).map((b) => ({
            art: b.blockiert
              ? ('sperre' as const)
              // `verstoss` UND `warnung` lesen sich als Warnung. Nur `warnung`
              // auf „Hinweis" abzubilden waere eine Abschwaechung, die
              // niemand entschieden hat — und die Planerin liest das mildere
              // Wort, waehrend die Datenbank das schaerfere meint.
              : b.schwere === 'hinweis' ? ('hinweis' as const) : ('warnung' as const),
            text: b.text,
          })),
        })),
      };
    }));
}

/**
 * Die Tagesbeschriftung — deutsch, und **nicht** aus `to_char(… 'TMDy …')`.
 *
 * `TM` nimmt die Namen aus `lc_time` der Verbindung. Steht die auf `C`, liest
 * der Dienstplan „Tue" und „Wed" — auf einem deutschen Bildschirm, ohne
 * Fehlermeldung, und je nach Serverbild anders. Eine Anzeige, die von einer
 * Umgebungsvariablen abhaengt, ist keine Anzeige, sondern ein Zufall.
 *
 * Der Wochentag wird aus dem Kalendertag gerechnet (Zeller ueber `Date.UTC`,
 * also ohne Zonenanteil) und aus einer festen Liste benannt.
 */
const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

export function beschriftung(datum: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  const tag = WOCHENTAGE[(d.getUTCDay() + 6) % 7] ?? '';
  return `${tag} ${datum.slice(8, 10)}.${datum.slice(5, 7)}.`;
}

/** Der Montag der Woche, in der `datum` liegt. */
export function montag(datum: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function tagePlus(datum: string, tage: number): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

/** Der erste und der letzte Tag des Monats, in dem `datum` liegt. */
export function monatsgrenzen(datum: string): { von: string; bis: string } {
  const d = new Date(`${datum}T00:00:00Z`);
  const von = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const bis = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { von: von.toISOString().slice(0, 10), bis: bis.toISOString().slice(0, 10) };
}
