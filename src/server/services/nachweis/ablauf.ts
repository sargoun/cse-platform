/**
 * Der Ablaufwaechter 60/30/7 (SPEC §14, SEC-02, EMP-08, LEG-04).
 *
 * **Die Zusage lautet „je Stufe genau einmal", und sie haengt nicht an dieser
 * Datei.** Ein Waechter, der taeglich laeuft, sieht denselben Nachweis an
 * sechzig aufeinanderfolgenden Tagen. Wer die Stufe im Anwendungscode merkt —
 * lesen, vergleichen, schreiben —, hat einen Wettlauf gebaut: zwei
 * gleichzeitige Laeufe, ein Wiederholungslauf nach einem Netzfehler, und die
 * Meldung geht zweimal hinaus. Der Traeger ist deshalb der eindeutige
 * Schluessel auf `nachweis_warnung` und das `on conflict do nothing`: **null
 * betroffene Zeilen IST die Antwort „schon gemeldet"** (K-09).
 *
 * **Ein verpasster Lauf verschluckt keine Warnung.** Faellig ist jede Stufe,
 * deren Schwelle unterschritten ist und die noch nicht quittiert wurde — nicht
 * nur die, deren Schwelle genau heute erreicht wird. Laeuft der Waechter drei
 * Tage nicht und faellt der Nachweis dabei von 32 auf 29 Tage, meldet der
 * naechste Lauf die 30er-Stufe nach. Die Gegenrichtung waere still: die
 * Warnung faende nie statt, und niemand saehe, dass sie fehlt.
 *
 * **Ein bereits abgelaufener Nachweis wird nicht gewarnt.** „Laeuft in 7 Tagen
 * ab" ueber ein Dokument, das seit gestern ungueltig ist, ist eine falsche
 * Aussage. Ab dem Ablauf ist nicht mehr die Vorwarnung zustaendig, sondern die
 * Hartsperre in `tor.ts`.
 */
import { erzeuge, type ErzeugteBenachrichtigung } from '../../benachrichtigung/registry.js';
import { artSchluessel } from './benachrichtigung.js';
import { tageZwischen } from './gueltigkeit.js';

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

/**
 * Welche Stufen sind faellig?
 *
 * Rein und ohne Uhr: `heute` ist ein Argument, weil sich der Sprung ueber eine
 * Schwelle sonst nicht pruefen liesse, ohne den Rechner umzustellen.
 * Absteigend sortiert, damit die groebste Stufe zuerst gemeldet wird, wenn
 * mehrere zugleich nachzuholen sind.
 */
export function faelligeStufen(
  gueltigBis: string, stufen: readonly number[], heute: string,
): readonly number[] {
  const tage = tageZwischen(heute, gueltigBis);
  if (tage < 0) return [];
  return [...stufen].filter((s) => s > 0 && tage <= s).sort((a, b) => b - a);
}

export interface Ablaufmeldung {
  readonly nachweisId: string;
  readonly personId: string;
  readonly stufeTage: number;
  readonly gueltigBis: string;
  readonly benachrichtigung: ErzeugteBenachrichtigung;
}

export interface Ablaufbericht {
  readonly geprueft: number;
  readonly gemeldet: readonly Ablaufmeldung[];
  /** Stufen ohne registrierte Benachrichtigungsart — gemeldet, nie verschluckt. */
  readonly unzustellbar: readonly { nachweisId: string; stufeTage: number; grund: string }[];
}

interface Kandidat {
  id: string;
  person_id: string;
  gueltig_bis: string | Date;
  warnung_tage: number[];
  bezeichnung: string;
  blockiert_einsatz: boolean;
  erfasst_von_mandant_id: string;
  mandant_slug: string | null;
}

const alsTag = (wert: string | Date): string =>
  wert instanceof Date ? wert.toISOString().slice(0, 10) : String(wert).slice(0, 10);

/**
 * Prueft alle ablaufenden Nachweise und quittiert jede faellige Stufe genau
 * einmal.
 *
 * `heute` kommt vom Aufrufer — beim Nachtlauf aus `select now()` der
 * Datenbank, nie aus der Uhr des Prozesses, auf dem der Job gerade laeuft
 * (Invariante 5).
 */
export async function meldeAblaufwarnungen(
  db: Abfrage, heute: string,
): Promise<Ablaufbericht> {
  /**
   * Die Vorauswahl macht die DATENBANK, ueber `nachweis_ablauf_idx`.
   *
   * Alle Nachweise zu laden und in JavaScript zu filtern waere bei tausend
   * Beschaeftigten ein voller Tabellenscan je Nacht — und, schlimmer, die
   * Auswahl waere dann nicht mehr an `q.warnung_tage` gebunden, sondern an
   * eine Konstante im Code.
   */
  const kandidaten = (await db.unsafe(
    `select n.id, n.person_id, n.gueltig_bis, q.warnung_tage, q.bezeichnung,
            q.blockiert_einsatz, n.erfasst_von_mandant_id, m.slug as mandant_slug
       from nachweis n
       join qualifikation q on q.id = n.qualifikation_id
       left join mandant m on m.id = n.erfasst_von_mandant_id
      where n.status = 'gueltig'
        and n.widerrufen_am is null
        and n.gueltig_bis is not null
        and n.gueltig_bis >= $1::date
        and n.gueltig_bis <= $1::date
            + coalesce((select max(t) from unnest(q.warnung_tage) t), 0)
      order by n.gueltig_bis`,
    [heute],
  )) as readonly Kandidat[];

  const gemeldet: Ablaufmeldung[] = [];
  const unzustellbar: { nachweisId: string; stufeTage: number; grund: string }[] = [];

  for (const k of kandidaten) {
    const gueltigBis = alsTag(k.gueltig_bis);
    for (const stufe of faelligeStufen(gueltigBis, k.warnung_tage ?? [], heute)) {
      /**
       * Das Fenster gehoert der DATENBANK, nicht dieser Schleife (K-09).
       * Wer als Zweiter kommt — anderer Lauf, anderer Prozess, derselbe
       * Prozess nach einem Wiederholungsversuch — trifft null Zeilen und
       * meldet nichts.
       */
      const getroffen = await db.unsafe(
        `insert into nachweis_warnung (nachweis_id, person_id, stufe_tage, gueltig_bis)
         values ($1::uuid, $2::uuid, $3::integer, $4::date)
         on conflict (nachweis_id, gueltig_bis, stufe_tage) do nothing
         returning id`,
        [k.id, k.person_id, stufe, gueltigBis],
      );
      if (getroffen.length === 0) continue;

      try {
        gemeldet.push({
          nachweisId: k.id,
          personId: k.person_id,
          stufeTage: stufe,
          gueltigBis,
          benachrichtigung: erzeuge(artSchluessel(stufe), {
            /**
             * Der Mandant der Meldung ist der, der den Nachweis ERFASST hat.
             *
             * `nachweis` traegt kein `mandant_id` — der Nachweis gehoert dem
             * Menschen (D-09). `benachrichtigung.mandant_id` ist aber
             * `not null`, also braucht die Zeile einen. `erfasst_von_mandant_id`
             * ist die einzige Entitaet, die auf der Zeile steht und eine
             * Verantwortlichkeit ausdrueckt (§6.17); einen anderen zu waehlen
             * hiesse, einen zu erfinden.
             */
            mandantId: k.erfasst_von_mandant_id,
            mandantSlug: k.mandant_slug,
            objektTyp: 'nachweis',
            objektId: k.id,
            daten: {
              bezeichnung: k.bezeichnung,
              gueltigBis,
              stufeTage: stufe,
              blockiertEinsatz: k.blockiert_einsatz,
            },
          }),
        });
      } catch (fehler: unknown) {
        /**
         * Eine Stufe aus `warnung_tage`, fuer die keine Art registriert ist —
         * SPEC §14 nennt 60/30/7, der Katalog laesst andere zu. Die Quittung
         * steht dann schon; sie bleibt stehen, damit die Stufe nicht bei jedem
         * Lauf erneut anschlaegt, und der Bericht sagt, dass niemand sie
         * bekommen hat. Stillschweigend fallen lassen waere die eine Variante,
         * die niemand bemerkt.
         */
        unzustellbar.push({
          nachweisId: k.id,
          stufeTage: stufe,
          grund: fehler instanceof Error ? fehler.message : String(fehler),
        });
      }
    }
  }

  return { geprueft: kandidaten.length, gemeldet, unzustellbar };
}
