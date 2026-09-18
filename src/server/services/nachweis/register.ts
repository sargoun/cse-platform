/**
 * Die Abfragen des Nachweisregisters — an EINER Stelle (SEC-02, EMP-08,
 * LEG-04).
 *
 * **Warum die Datei hierher gewandert ist.** Sie lag als `daten.ts` NEBEN der
 * Seite `/personal/nachweise`. Der Modulkopf der Sicherheit braucht dieselbe
 * Auskunft — welche § 34a-Nachweise ablaufen — und haette damit die `daten.ts`
 * einer anderen Seite gelesen: ein Weg, der beim ersten Umbau der Personal-
 * seite bricht, und eine Zustaendigkeit, die niemand mehr sieht. Der Lesepfad
 * gehoert einem Dienst; `personal/nachweise/daten.ts` verweist nur noch
 * hierher.
 *
 * **Der Stichtag ist ein ARGUMENT, kein `current_date`.** `now()` in der
 * Datenbank ist UTC; zwischen 00:00 und 02:00 Berliner Zeit ist das noch der
 * Vortag, und eine Restlaufzeit von „0 Tagen" statt „1 Tag" entscheidet genau
 * an der Grenze falsch — dort, wo es darauf ankommt. Der Berliner Kalendertag
 * kommt aus `berlinHeute()` und wird durchgereicht (K-11).
 *
 * **Die Restlaufzeit rechnet die Datenbank**, nicht die Seite: `gueltig_bis`
 * ist ein `date`, und eine Differenz zweier Kalendertage in JavaScript ist
 * eine Zeitzonenfrage, die niemand sehen will.
 */
import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';

export interface RegisterZeile {
  readonly nachweisId: string;
  readonly personId: string;
  readonly name: string;
  readonly qualifikation: string;
  readonly qualifikationSchluessel: string;
  readonly nummer: string | null;
  readonly ausstellendeStelle: string | null;
  readonly gueltigAb: string;
  /** `null` heisst unbefristet — und nicht „abgelaufen". */
  readonly gueltigBis: string | null;
  readonly status: 'beantragt' | 'gueltig' | 'abgelaufen' | 'widerrufen' | 'abgelehnt';
  readonly blockiertEinsatz: boolean;
  readonly laeuftAb: boolean;
  /** Tage bis zum Ablauf; negativ heisst „seit so vielen Tagen abgelaufen". */
  readonly restTage: number | null;
  /** Die Warnstufen, die der Wächter für dieses Ablaufdatum quittiert hat. */
  readonly gemeldeteStufen: readonly number[];
  /** Die Stufen der Qualifikation (Vorgabe 60/30/7). */
  readonly stufen: readonly number[];
  readonly dokumentId: string | null;
  readonly widerrufenAm: Date | null;
}

interface RegisterRoh {
  nachweis_id: string;
  person_id: string;
  name: string;
  qualifikation: string;
  qualifikation_schluessel: string;
  nummer: string | null;
  ausstellende_stelle: string | null;
  gueltig_ab: string;
  gueltig_bis: string | null;
  status: RegisterZeile['status'];
  blockiert_einsatz: boolean;
  laeuft_ab: boolean;
  rest_tage: number | null;
  gemeldete_stufen: number[] | null;
  stufen: number[];
  dokument_id: string | null;
  widerrufen_am: Date | null;
}

function alsZeile(z: RegisterRoh): RegisterZeile {
  return {
    nachweisId: z.nachweis_id,
    personId: z.person_id,
    name: z.name,
    qualifikation: z.qualifikation,
    qualifikationSchluessel: z.qualifikation_schluessel,
    nummer: z.nummer,
    ausstellendeStelle: z.ausstellende_stelle,
    gueltigAb: String(z.gueltig_ab).slice(0, 10),
    gueltigBis: z.gueltig_bis === null ? null : String(z.gueltig_bis).slice(0, 10),
    status: z.status,
    blockiertEinsatz: z.blockiert_einsatz,
    laeuftAb: z.laeuft_ab,
    restTage: z.rest_tage === null ? null : Number(z.rest_tage),
    gemeldeteStufen: (z.gemeldete_stufen ?? []).map(Number),
    stufen: (z.stufen ?? []).map(Number),
    dokumentId: z.dokument_id,
    widerrufenAm: z.widerrufen_am,
  };
}

/**
 * `join person` und NICHT `join anstellung`.
 *
 * Ein Nachweis haengt am Menschen (D-09); die RLS entscheidet über
 * `app.person_sichtbar`, wer davon in diesem Bereich zu sehen ist. Ein Join
 * über `anstellung` „nur für die Personalnummer" trüge früher oder später den
 * Stundensatz der anderen Gesellschaft mit hinaus (K-05).
 *
 * **Der Join auf `qualifikation` ist zugleich eine Grenze, und das ist
 * Absicht.** `q_lesen` gibt plattformweite Katalogzeilen (`mandant_id is
 * null`, §6.16) jedem frei und mandantseigene nur ihrer Gesellschaft. Damit
 * sieht die Planerin der Reinigung den § 34a-Nachweis eines auch bei der
 * Security beschäftigten Menschen — den Fall, den D-09 §6 ausdrücklich
 * verlangt —, aber nicht eine Anforderung, die sich die Security selbst
 * angelegt hat. Beide Richtungen prüft `tests/isolation/nachweisregister.test.ts`.
 *
 * Daraus folgt eine Betriebsregel: **eine gesetzliche Qualifikation gehört in
 * den plattformweiten Katalog**, nicht in den eines Bereichs. Legt eine
 * Gesellschaft § 34a als eigene Zeile an, ist ihr Nachweis für die
 * Schwestergesellschaft unsichtbar — lautlos, mit einer leeren Liste statt
 * einer Meldung.
 */
const QUELLE = `
    from nachweis n
    join person p on p.id = n.person_id
    join qualifikation q on q.id = n.qualifikation_id`;

const SPALTEN = `
         n.id                                as nachweis_id,
         n.person_id,
         (p.vorname || ' ' || p.nachname)     as name,
         q.bezeichnung                        as qualifikation,
         q.schluessel                         as qualifikation_schluessel,
         n.nummer, n.ausstellende_stelle,
         to_char(n.gueltig_ab, 'YYYY-MM-DD')  as gueltig_ab,
         to_char(n.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
         n.status::text                       as status,
         q.blockiert_einsatz, q.laeuft_ab, q.warnung_tage as stufen,
         n.dokument_id, n.widerrufen_am,
         case when n.gueltig_bis is null then null
              else (n.gueltig_bis - $1::date) end::int as rest_tage,
         (select array_agg(w.stufe_tage order by w.stufe_tage desc)
            from nachweis_warnung w
           where w.nachweis_id = n.id and w.gueltig_bis = n.gueltig_bis)
                                              as gemeldete_stufen`;

/** Das ganze Register des Bereichs, zum genannten Berliner Stichtag. */
export async function leseRegister(
  kontext: LeseKontext, stichtag: string,
): Promise<readonly RegisterZeile[]> {
  const zeilen = await kontext.abfrage<RegisterRoh>(
    `select ${SPALTEN} ${QUELLE}
      order by (n.gueltig_bis is null),
               n.gueltig_bis asc nulls last,
               p.nachname, p.vorname`,
    [stichtag],
  );
  return zeilen.map(alsZeile);
}

/** EIN Nachweis — derselbe Ausdruck, ein Filter mehr. */
export async function leseNachweis(
  kontext: LeseKontext, stichtag: string, id: string,
): Promise<RegisterZeile | null> {
  const [z] = await kontext.abfrage<RegisterRoh>(
    `select ${SPALTEN} ${QUELLE} where n.id = $2::uuid`,
    [stichtag, id],
  );
  return z === undefined ? null : alsZeile(z);
}

export interface WarnungZeile {
  readonly stufeTage: number;
  readonly gueltigBis: string;
  readonly ausgeloestAm: Date;
}

/**
 * Das Quittungsbuch des Wächters zu EINEM Nachweis.
 *
 * Es steht auf dem Einzelblatt, weil „läuft in 30 Tagen ab" eine Meldung ist,
 * die jemand bekommen haben muss. Ohne diese Liste liesse sich nicht sagen, ob
 * niemand gewarnt wurde oder ob alle die Warnung ignoriert haben — zwei sehr
 * verschiedene Gespräche.
 */
export async function leseWarnungen(
  kontext: LeseKontext, nachweisId: string,
): Promise<readonly WarnungZeile[]> {
  const zeilen = await kontext.abfrage<{
    stufe_tage: number; gueltig_bis: string; ausgeloest_am: Date;
  }>(
    `select stufe_tage, to_char(gueltig_bis, 'YYYY-MM-DD') as gueltig_bis, ausgeloest_am
       from nachweis_warnung
      where nachweis_id = $1::uuid
      order by gueltig_bis desc, stufe_tage desc`,
    [nachweisId],
  );
  return zeilen.map((z) => ({
    stufeTage: Number(z.stufe_tage),
    gueltigBis: String(z.gueltig_bis).slice(0, 10),
    ausgeloestAm: z.ausgeloest_am,
  }));
}

export type Lage = 'abgelaufen' | 'kritisch' | 'warnung' | 'gueltig' | 'unbefristet' | 'ungueltig';

/**
 * Die Lage EINER Zeile — eine Funktion, kein `if` in drei Zellen.
 *
 * Die Schwellen kommen aus `qualifikation.warnung_tage` und nicht aus einer
 * Konstante hier: der Wächter meldet nach denselben Stufen, und zwei
 * Wahrheiten über „kritisch" wären zwei Farben für denselben Tag.
 */
export function lageVon(z: RegisterZeile): Lage {
  if (z.widerrufenAm !== null || z.status === 'widerrufen' || z.status === 'abgelehnt') {
    return 'ungueltig';
  }
  if (z.gueltigBis === null) return 'unbefristet';
  if (z.restTage === null) return 'unbefristet';
  if (z.restTage < 0 || z.status === 'abgelaufen') return 'abgelaufen';
  const stufen = [...z.stufen].sort((a, b) => a - b);
  const kleinste = stufen[0];
  const groesste = stufen[stufen.length - 1];
  if (kleinste !== undefined && z.restTage <= kleinste) return 'kritisch';
  if (groesste !== undefined && z.restTage <= groesste) return 'warnung';
  return 'gueltig';
}
