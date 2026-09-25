import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { WOCHENTAGE, leseRegel, type Wochentag } from '../../../lib/datum/rrule.js';
import { generiereSofort, type SerienBericht } from './generator.js';
import { MAX_DAUER_MINUTEN } from './vorkommnisse.js';
import { pruefeLeistungsanker } from './leistungsanker.js';

/**
 * Serien anlegen — der Weg, auf dem eine Administration Schichten in den
 * Plan bekommt (TIM-01, TIM-02, CLN-02, SEC-04, D-487).
 *
 * **Der Befund.** Turnus, Posten und Planungsserie gab es, den Generator
 * auch — aber ausser dem Seed legte nichts eine `planungsserie` an. Ein
 * Posten mit Dienstzeiten blieb ein Posten ohne Schichten, und ein Revier
 * hatte keinen Weg zu einem Turnus. Der Dienstplan zeigte, was der Seed
 * geschrieben hatte, und sonst nichts.
 *
 * **Was hier entsteht.** Fuer die Reinigung ein Turnus (Revier, Leistung,
 * Wochentage, Beginn, Dauer, Feiertagsregel) samt Serie; fuer die Sicherheit
 * die Serie zu einem Posten, der Dienstzeiten traegt. In beiden Faellen
 * laeuft der Generator SOFORT fuer die Gesellschaft — der naechtliche Job
 * haette dieselbe Serie erst am naechsten Morgen materialisiert, und eine
 * Administration, die eine Serie anlegt, will die Schichten sehen. Was der
 * Generator ueberspringt (Objekt ohne Kunde), steht im Ergebnis, nicht
 * versteckt.
 *
 * **Die Regel wird gebaut, nicht getippt.** Wochentage werden zu
 * `FREQ=WEEKLY;BYDAY=…`, gelesen vom selben Parser wie der Generator; ein
 * Anker steht nie in der Regel (`turnus_rrule_ohne_anker`). Was der Parser
 * nicht liest, wird nicht gespeichert.
 */
export class SerieEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'SerieEingabeFehlt';
  }
}

export type Feiertagsregel = 'ausfall' | 'unveraendert';

/**
 * Die beiden Wiederkehrarten, die ein Reinigungsturnus braucht — in der
 * Sprache der Oberflaeche, nicht in RFC-Token.
 *
 * `FREQ=DAILY` steht absichtlich NICHT hier: eine taegliche Reinigung ist
 * `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU` und damit eine Aussage darueber,
 * ob am Sonntag gereinigt wird. `DAILY` liesse die Frage offen.
 */
export type TurnusFrequenz = 'woechentlich' | 'monatlich';

export interface TurnusSerieEingabe {
  readonly revierId: string;
  readonly leistungskatalogPositionId: string;
  readonly bezeichnung: string;
  /** Vorgabe `woechentlich` — der Weg, den `api/dienstplan/serien` geht. */
  readonly frequenz?: TurnusFrequenz;
  readonly wochentage: readonly string[];
  /** Nur zu `monatlich`: die Monatstage 1…31. */
  readonly monatstage?: readonly number[];
  /** `INTERVAL`, Vorgabe 1 — „jede zweite Woche", „jeden dritten Monat". */
  readonly interval?: number;
  /** Wanduhr `HH:MM`, Europe/Berlin. */
  readonly beginnLokal: string;
  readonly dauerMinuten: number;
  readonly gueltigAb: string;
  readonly gueltigBis?: string | null;
  readonly feiertagsregel: Feiertagsregel;
  /**
   * Die Leistungszeile, an deren Abrechnung die Zeit dieses Turnus hängt
   * (TIM-12, V-191). Der Generator schreibt sie auf jede Schicht, der
   * Zeiteintrag erbt sie von dort (`z_erben`). Ohne sie landet jede Stunde in
   * `zeiteintrag_ohne_auftrag`.
   */
  readonly auftragLeistungId?: string | null;
}

export interface PlanungsserieEingabe {
  readonly quelle: 'turnus' | 'posten';
  readonly traegerId: string;
  readonly feiertageUeberspringen: boolean;
  readonly bundesland?: string;
  readonly horizontTage?: number;
}

export interface SerienErgebnis {
  readonly planungsserieId: string;
  readonly traegerId: string;
  /** `true`, wenn die Serie schon bestand und nur der Generator lief. */
  readonly bestandSchon: boolean;
  readonly erzeugt: number;
  readonly aktualisiert: number;
  readonly uebersprungen: readonly { readonly quellSchluessel: string; readonly grund: string }[];
  readonly generiertBis: string | null;
}

const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/u;
const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Wochentage → `FREQ=WEEKLY;BYDAY=MO,WE,FR` — in Wochenreihenfolge, ohne
 * Doppelte, ohne Anker. Unbekannte Kuerzel sind ein Fehler, keine Auslassung.
 */
export function wochenRegel(tage: readonly string[], interval = 1): string {
  const gewaehlt = new Set<Wochentag>();
  for (const t of tage) {
    const kuerzel = t.trim().toUpperCase();
    if (!(WOCHENTAGE as readonly string[]).includes(kuerzel)) {
      throw new SerieEingabeFehlt(`"${t}" ist kein Wochentag (MO … SU).`);
    }
    gewaehlt.add(kuerzel as Wochentag);
  }
  if (gewaehlt.size === 0) throw new SerieEingabeFehlt('Mindestens ein Wochentag.');
  const geordnet = WOCHENTAGE.filter((w) => gewaehlt.has(w));
  const regel = `FREQ=WEEKLY;BYDAY=${geordnet.join(',')}${intervalTeil(interval)}`;
  leseRegel(regel);
  return regel;
}

/**
 * Monatstage → `FREQ=MONTHLY;BYMONTHDAY=1,15` — aufsteigend, ohne Doppelte,
 * ohne Anker.
 *
 * **Warum das fehlte und nicht fehlen durfte.** Der Seed fuehrt bereits
 * `FREQ=MONTHLY;BYMONTHDAY=15`, `leseRegel` versteht MONTHLY seit dem ersten
 * Tag, und die Seitenkarte verlangt fuer `/reinigung/turnus/neu` einen
 * RRULE-Bauer nach RFC 5545. Nur der Bauer kannte ausschliesslich Wochen: ein
 * monatlicher Turnus liess sich lesen, aber nicht anlegen. Der Zweig gehoert
 * hierher und nicht ins Formular — sonst gaebe es zwei Stellen, die eine
 * Regel zusammensetzen, und die zweite waere ungetestet.
 *
 * **Der 29., 30. und 31. sind zugelassen und werden NICHT umgedeutet.** RFC
 * 5545 laesst den Monat ohne diesen Tag einfach aus, und `entfalte` tut
 * dasselbe: der Februar hat dann keinen Termin. Das auf „letzter Tag des
 * Monats" zu verschieben waere eine Geschaeftsregel — `BYMONTHDAY=-1` waere
 * ihre Schreibweise, und die weist `leseRegel` ausdruecklich ab. Die
 * Oberflaeche sagt es beim Tag statt es zu heilen.
 */
export function monatsRegel(tage: readonly number[], interval = 1): string {
  const gewaehlt = new Set<number>();
  for (const t of tage) {
    if (!Number.isInteger(t) || t < 1 || t > 31) {
      throw new SerieEingabeFehlt(`"${String(t)}" ist kein Monatstag (1 … 31).`);
    }
    gewaehlt.add(t);
  }
  if (gewaehlt.size === 0) throw new SerieEingabeFehlt('Mindestens ein Monatstag.');
  const geordnet = [...gewaehlt].sort((a, b) => a - b);
  const regel = `FREQ=MONTHLY;BYMONTHDAY=${geordnet.join(',')}${intervalTeil(interval)}`;
  leseRegel(regel);
  return regel;
}

function intervalTeil(interval: number): string {
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
    throw new SerieEingabeFehlt('Das Intervall ist eine ganze Zahl zwischen 1 und 52.');
  }
  return interval === 1 ? '' : `;INTERVAL=${String(interval)}`;
}

/**
 * Die Regel aus der Eingabe — EIN Einstieg fuer beide Frequenzen.
 *
 * Gebaut und danach vom SELBEN Parser gegengelesen, der sie spaeter entfaltet
 * (`leseRegel` steht in beiden Bauern). Was der Parser abweist, wird nicht
 * gespeichert.
 */
export function turnusRegel(e: Pick<TurnusSerieEingabe,
  'frequenz' | 'wochentage' | 'monatstage' | 'interval'>): string {
  const interval = e.interval ?? 1;
  if ((e.frequenz ?? 'woechentlich') === 'monatlich') {
    return monatsRegel(e.monatstage ?? [], interval);
  }
  return wochenRegel(e.wochentage, interval);
}

function pruefeTurnusEingabe(e: TurnusSerieEingabe): { rrule: string; gueltigBis: string | null } {
  if (e.bezeichnung.trim() === '') throw new SerieEingabeFehlt('Eine Serie braucht eine Bezeichnung.');
  if (!UHRZEIT.test(e.beginnLokal)) throw new SerieEingabeFehlt('Der Beginn ist eine Uhrzeit HH:MM.');
  /**
   * `MAX_DAUER_MINUTEN` (1439) und nicht 1440. Die Grenze gehoert
   * `nominalesEnde`, das jede Schicht dieser Plattform durchlaeuft; hier stand
   * 1440, und genau die eine zulaessige Minute Unterschied liess sich anlegen
   * und brachte den Nachtlauf zum Stehen.
   */
  if (!Number.isInteger(e.dauerMinuten) || e.dauerMinuten < 15
    || e.dauerMinuten > MAX_DAUER_MINUTEN) {
    throw new SerieEingabeFehlt(
      `Die Dauer liegt zwischen 15 Minuten und ${String(MAX_DAUER_MINUTEN)} Minuten `
      + '(eine Schicht ist kuerzer als ein Tag).');
  }
  if (!DATUM.test(e.gueltigAb)) throw new SerieEingabeFehlt('„Gültig ab" ist ein Datum.');
  const gueltigBis = e.gueltigBis === undefined || e.gueltigBis === null || e.gueltigBis === '' ? null : e.gueltigBis;
  if (gueltigBis !== null && (!DATUM.test(gueltigBis) || gueltigBis < e.gueltigAb)) {
    throw new SerieEingabeFehlt('„Gültig bis" ist ein Datum nach „Gültig ab".');
  }
  if (e.feiertagsregel !== 'ausfall' && e.feiertagsregel !== 'unveraendert') {
    throw new SerieEingabeFehlt('Die Feiertagsregel ist „ausfall" oder „unveraendert".');
  }
  return { rrule: turnusRegel(e), gueltigBis };
}

/** Turnus (Reinigung) anlegen und sofort als Serie planen. */
export async function legeTurnusSerieAn(
  kontext: SchreibKontext, e: TurnusSerieEingabe,
): Promise<SerienErgebnis> {
  const { rrule, gueltigBis } = pruefeTurnusEingabe(e);
  const anker = e.auftragLeistungId ?? null;
  // Vor dem Schreiben, mit Satz — nicht als Fremdschluesselfehler (V-191).
  if (anker !== null) await pruefeLeistungsanker(kontext, anker);
  const [turnus] = await kontext.schreibe<{ id: string }>(
    `insert into turnus
       (mandant_id, revier_id, leistungskatalog_position_id, bezeichnung, rrule, dtstart_lokal,
        dauer_minuten, feiertagsregel, gueltig_ab, gueltig_bis, auftrag_leistung_id,
        erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, ($6 || ' ' || $7)::timestamp,
             $8::integer, $9::turnus_feiertagsregel, $6::date, $10::date, $12::uuid,
             'mensch', $11::uuid)
     returning id`,
    [kontext.aktiverMandantId, e.revierId, e.leistungskatalogPositionId, e.bezeichnung.trim(), rrule,
      e.gueltigAb, e.beginnLokal, e.dauerMinuten, e.feiertagsregel, gueltigBis, kontext.benutzerId,
      anker]);
  if (turnus === undefined) {
    throw new SerieEingabeFehlt(
      'Der Turnus wurde nicht angelegt — das Revier oder die Leistung gehört nicht zu dieser Gesellschaft.');
  }
  return legePlanungsserieAn(kontext, {
    quelle: 'turnus', traegerId: turnus.id, feiertageUeberspringen: e.feiertagsregel === 'ausfall',
  });
}

/**
 * Die Serie zu einem Traeger — und der Generator, sofort.
 *
 * Besteht zu diesem Traeger schon eine aktive Serie, entsteht keine zweite:
 * zwei Serien auf einen Turnus waeren doppelte Schichten. Dann laeuft nur
 * der Generator, und das Ergebnis sagt es.
 */
export async function legePlanungsserieAn(
  kontext: SchreibKontext, e: PlanungsserieEingabe,
): Promise<SerienErgebnis> {
  const bundesland = e.bundesland ?? 'BE';
  if (!/^[A-Z]{2}$/u.test(bundesland)) throw new SerieEingabeFehlt('Das Bundesland ist ein Kürzel wie BE.');
  const horizont = e.horizontTage ?? 56;
  if (!Number.isInteger(horizont) || horizont < 1 || horizont > 400) {
    throw new SerieEingabeFehlt('Der Horizont liegt zwischen 1 und 400 Tagen.');
  }
  const spalte = e.quelle === 'turnus' ? 'turnus_id' : 'posten_id';

  const [vorhanden] = await kontext.abfrage<{ id: string }>(
    `select id from planungsserie where ${spalte} = $1::uuid and archiviert_am is null limit 1`,
    [e.traegerId]);
  let planungsserieId: string;
  if (vorhanden !== undefined) {
    planungsserieId = vorhanden.id;
  } else {
    const [neu] = await kontext.schreibe<{ id: string }>(
      `insert into planungsserie
         (mandant_id, ${spalte}, quelle, zeitzone, feiertage_ueberspringen, feiertag_bundesland,
          horizont_tage, erstellt_von_art, erstellt_von)
       values ($1::uuid, $2::uuid, $3::einsatz_quelle, 'Europe/Berlin', $4::boolean, $5, $6::integer,
               'mensch', $7::uuid)
       returning id`,
      [kontext.aktiverMandantId, e.traegerId, e.quelle, e.feiertageUeberspringen, bundesland, horizont,
        kontext.benutzerId]);
    if (neu === undefined) {
      throw new SerieEingabeFehlt(
        'Die Serie wurde nicht angelegt — der Träger gehört nicht zu dieser Gesellschaft, oder die Sitzung darf hier nicht schreiben.');
    }
    planungsserieId = neu.id;
  }

  const berichte: readonly SerienBericht[] = await generiereSofort(
    { unsafe: (sql, werte) => kontext.schreibe<unknown>(sql, werte) },
    kontext.aktiverMandantId);
  const bericht = berichte.find((b) => b.planungsserieId === planungsserieId);

  await kontext.schreibe(
    `select app.protokolliere('dienstplan.serie_angelegt', 'planungsserie', $1, null, $2::jsonb, app.aktiver_mandant())`,
    /* Ein Objekt, kein JSON-Text (D-467). */
    [planungsserieId, { quelle: e.quelle, traegerId: e.traegerId, bestandSchon: vorhanden !== undefined,
      erzeugt: bericht?.erzeugt ?? 0, uebersprungen: bericht?.uebersprungen.length ?? 0 }]);

  return {
    planungsserieId, traegerId: e.traegerId, bestandSchon: vorhanden !== undefined,
    erzeugt: bericht?.erzeugt ?? 0, aktualisiert: bericht?.aktualisiert ?? 0,
    uebersprungen: bericht?.uebersprungen ?? [], generiertBis: bericht?.generiertBis ?? null,
  };
}

/* ===========================================================================
 * Das Blatt EINER Serie — lesend (TIM-02, TIM-03, D-487)
 * ======================================================================== */

/**
 * **`planungsserie` traegt keines der Felder, die ein Serienblatt zeigt.**
 *
 * Kein `bezeichnung`, kein `objekt_id`, keine `rrule`, kein `dtstart`, keine
 * `dauer_minuten`, keine Feiertagsregel, kein `gueltig_ab`/`gueltig_bis` —
 * nur `turnus_id`/`posten_id`/`veranstaltung_id`, `quelle`, `zeitzone`,
 * `feiertage_ueberspringen`, `feiertag_bundesland`, `horizont_tage`,
 * `generiert_bis`, `letzte_generierung_am`, `letzte_meldung`.
 *
 * `leseSerie` ist deshalb **kein Einzelsatz-Read, sondern der Traeger-Join**
 * ueber `turnus` + `posten` + `veranstaltung` + `revier` + `objekt` — derselbe
 * `coalesce`-Join, der in der Listenseite schon steht. Wer das als
 * `select * from planungsserie where id = $1` baut, bekommt eine Seite mit
 * lauter leeren Feldern und keine Fehlermeldung.
 *
 * Die Feiertagsregel einer POSTENSERIE wird aus `ps.feiertage_ueberspringen`
 * abgeleitet: `posten` traegt keine `feiertagsregel`-Spalte, und die
 * Entscheidung wurde bei der Anlage der Serie festgeschrieben (§8.5).
 */
export interface SerienBlatt {
  readonly id: string;
  readonly quelle: 'turnus' | 'posten' | 'veranstaltung';
  readonly turnusId: string | null;
  readonly postenId: string | null;
  readonly veranstaltungId: string | null;
  readonly bezeichnung: string;
  readonly objektId: string | null;
  readonly objekt: string | null;
  readonly revier: string | null;
  readonly posten: string | null;
  /** `null` bei einer Veranstaltung — ein einzelnes Fenster ist keine Regel (SEC-08). */
  readonly rrule: string | null;
  /** Wanduhr `HH:MM`, Europe/Berlin. */
  readonly beginnLokal: string | null;
  readonly dauerMinuten: number;
  readonly sollBesetzung: number;
  readonly minBesetzung: number;
  readonly feiertagsregel: 'ausfall' | 'unveraendert';
  readonly feiertagBundesland: string;
  readonly zeitzone: string;
  readonly gueltigAb: string | null;
  readonly gueltigBis: string | null;
  readonly horizontTage: number;
  readonly generiertBis: string | null;
  readonly letzteGenerierungLokal: string | null;
  readonly letzteMeldung: Record<string, unknown>;
  readonly archiviert: boolean;
  readonly einsaetze: number;
  /** Der Abrechnungsanker des Trägers (TIM-12, V-191) — `null` ohne Leistungszeile. */
  readonly auftragLeistungId: string | null;
}

interface RohBlatt {
  id: string;
  quelle: SerienBlatt['quelle'];
  turnus_id: string | null;
  posten_id: string | null;
  veranstaltung_id: string | null;
  bezeichnung: string | null;
  objekt_id: string | null;
  objekt: string | null;
  revier: string | null;
  posten: string | null;
  rrule: string | null;
  beginn_lokal: string | null;
  dauer_minuten: number | null;
  soll_besetzung: number | null;
  min_besetzung: number | null;
  feiertagsregel: string | null;
  feiertag_bundesland: string;
  zeitzone: string;
  gueltig_ab: string | null;
  gueltig_bis: string | null;
  horizont_tage: number;
  generiert_bis: string | null;
  letzte_generierung_lokal: string | null;
  letzte_meldung: Record<string, unknown> | null;
  archiviert: boolean;
  einsaetze: number;
  auftrag_leistung_id: string | null;
}

/**
 * Eine Serie — oder `null`, und das heisst nach aussen 404 und nie 403
 * (AUT-06). Eine fremde Zeile ist nicht vorhanden, nicht verboten.
 */
export async function leseSerie(
  kontext: LeseKontext, id: string,
): Promise<SerienBlatt | null> {
  const [z] = await kontext.abfrage<RohBlatt>(
    `select ps.id, ps.quelle::text as quelle,
            ps.turnus_id, ps.posten_id, ps.veranstaltung_id,
            coalesce(t.bezeichnung, p.bezeichnung, va.bezeichnung) as bezeichnung,
            coalesce(r.objekt_id, p.objekt_id, va.objekt_id)       as objekt_id,
            o.bezeichnung as objekt, r.bezeichnung as revier, p.bezeichnung as posten,
            coalesce(t.rrule, p.abdeckung_rrule)                   as rrule,
            to_char(coalesce(t.dtstart_lokal, p.dtstart_lokal,
                             (va.beginn at time zone 'Europe/Berlin')), 'HH24:MI')
                                                                   as beginn_lokal,
            coalesce(t.dauer_minuten, p.dauer_minuten,
                     (extract(epoch from (va.ende - va.beginn)) / 60)::int, 0)::int
                                                                   as dauer_minuten,
            coalesce(p.soll_besetzung, va.soll_besetzung, 1)::int   as soll_besetzung,
            coalesce(p.min_besetzung, 1)::int                      as min_besetzung,
            coalesce(t.feiertagsregel::text,
                     case when ps.feiertage_ueberspringen then 'ausfall'
                          else 'unveraendert' end)                 as feiertagsregel,
            ps.feiertag_bundesland, ps.zeitzone,
            to_char(coalesce(t.gueltig_ab, p.gueltig_ab,
                             (va.beginn at time zone 'Europe/Berlin')::date),
                    'YYYY-MM-DD')                                  as gueltig_ab,
            to_char(coalesce(t.gueltig_bis, p.gueltig_bis,
                             (va.ende at time zone 'Europe/Berlin')::date),
                    'YYYY-MM-DD')                                  as gueltig_bis,
            ps.horizont_tage,
            to_char(ps.generiert_bis, 'YYYY-MM-DD')                as generiert_bis,
            to_char((ps.letzte_generierung_am at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI')                          as letzte_generierung_lokal,
            ps.letzte_meldung,
            (ps.archiviert_am is not null)                         as archiviert,
            coalesce(e.anzahl, 0)::int                             as einsaetze,
            coalesce(t.auftrag_leistung_id, p.auftrag_leistung_id,
                     va.auftrag_leistung_id)::text                 as auftrag_leistung_id
       from planungsserie ps
       left join turnus t  on t.mandant_id = ps.mandant_id and t.id = ps.turnus_id
       left join posten p  on p.mandant_id = ps.mandant_id and p.id = ps.posten_id
       left join veranstaltung va on va.mandant_id = ps.mandant_id
                                 and va.id = ps.veranstaltung_id
       left join revier r  on r.mandant_id = ps.mandant_id and r.id = t.revier_id
       left join objekt o  on o.mandant_id = ps.mandant_id
                          and o.id = coalesce(r.objekt_id, p.objekt_id, va.objekt_id)
       left join lateral (
              select count(*) as anzahl from einsatz e
               where e.planungsserie_id = ps.id and e.storniert_am is null
            ) e on true
      where ps.id = $1`,
    [id],
  );
  if (z === undefined) return null;
  return {
    id: z.id,
    quelle: z.quelle,
    turnusId: z.turnus_id,
    postenId: z.posten_id,
    veranstaltungId: z.veranstaltung_id,
    /* Kein Traeger lesbar heisst: die Serie steht da, ihr Traeger nicht — das
       ist keine leere Bezeichnung, sondern eine Auskunft. */
    bezeichnung: z.bezeichnung ?? 'Träger nicht einsehbar',
    objektId: z.objekt_id,
    objekt: z.objekt,
    revier: z.revier,
    posten: z.posten,
    rrule: z.rrule,
    beginnLokal: z.beginn_lokal,
    dauerMinuten: Number(z.dauer_minuten ?? 0),
    sollBesetzung: Number(z.soll_besetzung ?? 1),
    minBesetzung: Number(z.min_besetzung ?? 1),
    feiertagsregel: z.feiertagsregel === 'ausfall' ? 'ausfall' : 'unveraendert',
    feiertagBundesland: z.feiertag_bundesland,
    zeitzone: z.zeitzone,
    gueltigAb: z.gueltig_ab,
    gueltigBis: z.gueltig_bis,
    horizontTage: Number(z.horizont_tage),
    generiertBis: z.generiert_bis,
    letzteGenerierungLokal: z.letzte_generierung_lokal,
    letzteMeldung: z.letzte_meldung ?? {},
    archiviert: z.archiviert,
    einsaetze: Number(z.einsaetze),
    auftragLeistungId: z.auftrag_leistung_id,
  };
}

export interface SerienEinsatzZeile {
  readonly id: string;
  readonly tagLokal: string;
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly endetAmFolgetag: boolean;
  readonly zeitanomalie: 'keine' | 'dst_luecke' | 'dst_doppelt';
  readonly status: string;
  readonly storniert: boolean;
  readonly stornoGrund: string | null;
  readonly sollBesetzung: number;
  readonly eingeteilt: number;
  readonly ausAusnahme: boolean;
}

/**
 * Die materialisierten Schichten dieser Serie — ab heute.
 *
 * `storniert` kommt MIT: eine Schicht, die der Generator wegen einer
 * Serienaenderung storniert hat, faellt sonst einfach weg, und im Plan fehlt
 * dann etwas ohne Grund (Invariante 8, §8.4).
 *
 * `ausAusnahme` liest den Idempotenzschluessel: ein Zusatztermin traegt
 * `ausnahme:<id>`, ein Serientermin `serie:<serie>:<tag>:<zeit>` (§8.3). Damit
 * steht auf dem Blatt, welche Schicht aus der Regel kommt und welche jemand
 * eigens eingetragen hat.
 */
export async function leseSerienEinsaetze(
  kontext: LeseKontext, serieId: string,
): Promise<readonly SerienEinsatzZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; tag_lokal: string; beginn_lokal: string; ende_lokal: string;
    endet_am_folgetag: boolean; zeitanomalie: SerienEinsatzZeile['zeitanomalie'];
    status: string; storniert: boolean; storno_grund: string | null;
    soll_besetzung: number; eingeteilt: number; aus_ausnahme: boolean;
  }>(
    `select e.id,
            to_char((e.beginn_zeitpunkt at time zone 'Europe/Berlin'), 'DD.MM.YYYY')
              as tag_lokal,
            to_char((e.beginn_zeitpunkt at time zone 'Europe/Berlin'), 'HH24:MI')
              as beginn_lokal,
            to_char((e.ende_zeitpunkt   at time zone 'Europe/Berlin'), 'HH24:MI')
              as ende_lokal,
            e.endet_am_folgetag, e.zeitanomalie::text as zeitanomalie,
            e.status::text as status,
            (e.storniert_am is not null) as storniert, e.storno_grund,
            e.soll_besetzung::int as soll_besetzung,
            e.besetzt_anzahl::int as eingeteilt,
            (e.quell_schluessel like 'ausnahme:%') as aus_ausnahme
       from einsatz e
      where e.planungsserie_id = $1
        and (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date
            >= app.berlin_heute()
      order by e.beginn_zeitpunkt`,
    [serieId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    tagLokal: z.tag_lokal,
    beginnLokal: z.beginn_lokal,
    endeLokal: z.ende_lokal,
    endetAmFolgetag: z.endet_am_folgetag,
    zeitanomalie: z.zeitanomalie,
    status: z.status,
    storniert: z.storniert,
    stornoGrund: z.storno_grund,
    sollBesetzung: Number(z.soll_besetzung),
    eingeteilt: Number(z.eingeteilt),
    ausAusnahme: z.aus_ausnahme,
  }));
}

/* ===========================================================================
 * Einzeltermin-Ausnahmen (TIM-02, §5.4, §8.2)
 * ======================================================================== */

/**
 * **Drei Arten, nicht zwei.** `turnus_ausnahme_art` ist
 * ('ausfall','zusatz','verschiebung'), und `zusatz` IST im Generator
 * implementiert (eigener Zweig in `vorkommnisse.ts`). Eine Liste mit nur zwei
 * Arten liesse eine bestehende `zusatz`-Zeile unbeschriftet und den einzigen
 * Weg, eine Zusatzschicht in eine Serie zu haengen, unerreichbar.
 */
export type AusnahmeArt = 'ausfall' | 'zusatz' | 'verschiebung';

export const AUSNAHME_ARTEN: readonly AusnahmeArt[] = ['ausfall', 'verschiebung', 'zusatz'];

export interface AusnahmeZeile {
  readonly id: string;
  readonly datum: string;
  readonly art: AusnahmeArt;
  /** `JJJJ-MM-TT HH:MM` Wanduhr — ohne Zone, so wie die Spalte sie traegt. */
  readonly ersatzBeginnLokal: string | null;
  readonly dauerMinuten: number | null;
  /** Nur bei einer Postenausnahme belegt (§6.4). */
  readonly ersatzBesetzung: number | null;
  readonly grund: string;
  readonly angelegtLokal: string;
  readonly angelegtVon: string | null;
}

/**
 * Die Ausnahmen des Traegers — aus der Tabelle, die zu ihm gehoert.
 *
 * `turnus_ausnahme` verlangt zum LESEN `reinigung.lesen`,
 * `posten_ausnahme` verlangt `security.lesen` (0029 / 0069) — nicht
 * `dienstplan.lesen`, auf das die Serienroute getort ist. Eine Sitzung ohne
 * das Gewerkerecht bekommt hier null Zeilen, und die Seite muss das als
 * „nicht einsehbar" ausweisen statt als „keine Ausnahme". Welches Recht
 * gilt, sagt `ausnahmeLeserecht`.
 */
export function ausnahmeLeserecht(blatt: Pick<SerienBlatt, 'turnusId' | 'postenId'>): string | null {
  if (blatt.turnusId !== null) return 'reinigung.lesen';
  if (blatt.postenId !== null) return 'security.lesen';
  return null;
}

export function ausnahmeSchreibrecht(
  blatt: Pick<SerienBlatt, 'turnusId' | 'postenId'>,
): string | null {
  if (blatt.turnusId !== null) return 'reinigung.schreiben';
  if (blatt.postenId !== null) return 'security.schreiben';
  return null;
}

export async function leseAusnahmen(
  kontext: LeseKontext, blatt: Pick<SerienBlatt, 'turnusId' | 'postenId'>,
): Promise<readonly AusnahmeZeile[]> {
  const [tabelle, spalte, traegerId, staerke] = blatt.turnusId !== null
    ? ['turnus_ausnahme', 'turnus_id', blatt.turnusId, 'null::smallint']
    : blatt.postenId !== null
      ? ['posten_ausnahme', 'posten_id', blatt.postenId, 'a.ersatz_besetzung']
      : [null, null, null, null];
  if (tabelle === null || traegerId === null) return [];

  const zeilen = await kontext.abfrage<{
    id: string; datum: string; art: AusnahmeArt;
    ersatz_beginn_lokal: string | null; dauer_minuten: number | null;
    ersatz_besetzung: number | null; grund: string;
    angelegt_lokal: string; angelegt_von: string | null;
  }>(
    `select a.id, to_char(a.datum, 'YYYY-MM-DD') as datum, a.art::text as art,
            to_char(a.ersatz_beginn_lokal, 'YYYY-MM-DD HH24:MI') as ersatz_beginn_lokal,
            a.dauer_minuten, ${staerke as string} as ersatz_besetzung, a.grund,
            to_char((a.erstellt_am at time zone 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI')
              as angelegt_lokal,
            b.name as angelegt_von
       from ${tabelle} a
       left join benutzer b on b.id = a.erstellt_von
      where a.${spalte as string} = $1
      order by a.datum desc, a.erstellt_am desc`,
    [traegerId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    datum: z.datum,
    art: z.art,
    ersatzBeginnLokal: z.ersatz_beginn_lokal,
    dauerMinuten: z.dauer_minuten === null ? null : Number(z.dauer_minuten),
    ersatzBesetzung: z.ersatz_besetzung === null || z.ersatz_besetzung === undefined
      ? null : Number(z.ersatz_besetzung),
    grund: z.grund,
    angelegtLokal: z.angelegt_lokal,
    angelegtVon: z.angelegt_von,
  }));
}

export interface AusnahmeEingabe {
  readonly planungsserieId: string;
  readonly datum: string;
  readonly art: AusnahmeArt;
  /** Wanduhr `HH:MM` am Ersatztag — Pflicht bei `verschiebung`. */
  readonly ersatzDatum?: string | null;
  readonly ersatzZeit?: string | null;
  readonly dauerMinuten?: number | null;
  readonly ersatzBesetzung?: number | null;
  readonly grund: string;
}

export class AusnahmeNichtTragfaehig extends Error {
  readonly code = 'nicht_tragfaehig';
  readonly status = 409;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'AusnahmeNichtTragfaehig';
  }
}

const MINDESTGRUND = 10;

/**
 * Eine Einzeltermin-Ausnahme anlegen — und sofort neu materialisieren.
 *
 * **Warum der Generator gleich mitlaeuft.** Eine Ausnahme, die erst der
 * Nachtlauf anwendet, ist bis zum naechsten Morgen eine Zeile ohne Wirkung:
 * die Schicht steht noch im Plan, und wer sie ausgetragen hat, glaubt das
 * Gegenteil. Derselbe Grund wie bei `legePlanungsserieAn`.
 *
 * **Eine Veranstaltung hat keine Ausnahmetabelle.** Ein einzelnes Fenster
 * (SEC-08) wird geaendert oder abgesagt, nicht „ausgenommen" — der Versuch
 * wird abgewiesen, statt eine Zeile zu schreiben, die nirgends hingehoert.
 */
export async function legeAusnahmeAn(
  kontext: SchreibKontext, e: AusnahmeEingabe,
): Promise<{ readonly id: string; readonly bericht: SerienBericht | null }> {
  if (!DATUM.test(e.datum)) throw new SerieEingabeFehlt('Das Datum ist ein Kalendertag JJJJ-MM-TT.');
  if (!AUSNAHME_ARTEN.includes(e.art)) {
    throw new SerieEingabeFehlt('Die Art ist „ausfall", „verschiebung" oder „zusatz".');
  }
  const grund = e.grund.trim();
  if (grund.length < MINDESTGRUND) {
    throw new SerieEingabeFehlt(
      `Der Grund ist Pflicht und mindestens ${String(MINDESTGRUND)} Zeichen lang — eine `
      + 'Ausnahme ohne genannten Grund ist keine Dokumentation, sondern ein Klick.');
  }

  const [serie] = await kontext.abfrage<{
    turnus_id: string | null; posten_id: string | null; veranstaltung_id: string | null;
  }>(
    `select turnus_id, posten_id, veranstaltung_id from planungsserie
      where id = $1 and archiviert_am is null`,
    [e.planungsserieId]);
  // AUT-06: eine fremde oder archivierte Serie ist nicht vorhanden.
  if (serie === undefined) throw new SerieEingabeFehlt('Diese Serie ist nicht vorhanden.');
  if (serie.turnus_id === null && serie.posten_id === null) {
    throw new AusnahmeNichtTragfaehig(
      'Eine Veranstaltung kennt keine Einzeltermin-Ausnahme (SEC-08): ein einzelnes '
      + 'Fenster wird geändert oder abgesagt. Es gibt dafür keine Tabelle, und eine '
      + 'Zeile ohne Tabelle wäre eine Eingabe, die verschwindet.');
  }

  let ersatzBeginn: string | null = null;
  if (e.art === 'verschiebung' || (e.art === 'zusatz' && (e.ersatzZeit ?? '') !== '')) {
    const zeit = e.ersatzZeit ?? '';
    const tag = (e.ersatzDatum ?? '') === '' ? e.datum : (e.ersatzDatum as string);
    if (!UHRZEIT.test(zeit)) {
      throw new SerieEingabeFehlt(
        'Eine Verschiebung braucht eine Ersatz-Uhrzeit HH:MM — die Prüfbedingung der '
        + 'Tabelle lässt sie nicht weg.');
    }
    if (!DATUM.test(tag)) throw new SerieEingabeFehlt('Der Ersatztag ist ein Kalendertag.');
    ersatzBeginn = `${tag} ${zeit}`;
  }

  const dauer = e.dauerMinuten ?? null;
  /*
   * `MAX_DAUER_MINUTEN` (= 1439) und nicht 1440 — dieselbe Zahl wie in
   * `nominalesEnde`, und aus demselben Grund wie bei `pruefeTurnusEingabe`.
   *
   * Genau 1440 liess sich hier eintragen und brachte danach `nominalesEnde`
   * zum Werfen: bei `zusatz` und `verschiebung` laeuft der Generator in
   * DERSELBEN Transaktion, `PlanungsFehler` traegt weder `code` noch
   * `status`, `alsAntwort` gibt `null` zurueck — HTTP 500, Transaktion
   * zurueckgerollt, und der Planer sieht nicht, was er falsch gemacht hat.
   * Eine Zahl, zwei Aufrufer (vorkommnisse.ts §MAX_DAUER_MINUTEN).
   */
  if (dauer !== null
      && (!Number.isInteger(dauer) || dauer < 15 || dauer > MAX_DAUER_MINUTEN)) {
    throw new SerieEingabeFehlt(
      `Die Dauer liegt zwischen 15 Minuten und ${String(MAX_DAUER_MINUTEN)} Minuten — `
      + 'eine Schicht über 24 Stunden ist keine Schicht.');
  }
  const staerke = e.ersatzBesetzung ?? null;
  if (staerke !== null && (!Number.isInteger(staerke) || staerke < 1)) {
    throw new SerieEingabeFehlt('Die Ersatzbesetzung ist eine ganze Zahl ab 1.');
  }

  /*
   * Zwei Tabellen, zwei Spaltenlisten — `posten_ausnahme` traegt
   * `ersatz_besetzung`, `turnus_ausnahme` nicht (0069 §6.4). Die eine Spalte
   * in beide Anweisungen zu schreiben waere ein Laufzeitfehler auf der
   * Reinigungsseite, und zwar erst beim ersten Klick.
   */
  const schreibeAusnahme = async (): Promise<readonly { id: string }[]> => (
    serie.turnus_id !== null
      ? kontext.schreibe<{ id: string }>(
        `insert into turnus_ausnahme
           (mandant_id, turnus_id, datum, art, ersatz_beginn_lokal, dauer_minuten,
            grund, erstellt_von_art, erstellt_von)
         values ($1::uuid, $2::uuid, $3::date, $4::turnus_ausnahme_art,
                 $5::timestamp, $6::integer, $7, 'mensch', $8::uuid)
         returning id`,
        [kontext.aktiverMandantId, serie.turnus_id, e.datum, e.art, ersatzBeginn, dauer,
          grund, kontext.benutzerId])
      : kontext.schreibe<{ id: string }>(
        `insert into posten_ausnahme
           (mandant_id, posten_id, datum, art, ersatz_beginn_lokal, dauer_minuten,
            ersatz_besetzung, grund, erstellt_von_art, erstellt_von)
         values ($1::uuid, $2::uuid, $3::date, $4::turnus_ausnahme_art,
                 $5::timestamp, $6::integer, $7::smallint, $8, 'mensch', $9::uuid)
         returning id`,
        [kontext.aktiverMandantId, serie.posten_id, e.datum, e.art, ersatzBeginn, dauer,
          staerke, grund, kontext.benutzerId])
  );

  /**
   * **Ein Doppelklick ist kein Serverfehler.**
   *
   * `posten_ausnahme_uk` ist UNBEDINGT `(posten_id, datum)` — auch fuer
   * `zusatz`; `turnus_ausnahme_uk` ist partiell auf `ausfall`/`verschiebung`.
   * Die zweite Ausnahme am selben Tag kommt also als roher Postgres-Fehler
   * `23505` zurueck, und `alsAntwort` erkennt nur Fehler mit `code` UND
   * `status`: die Route wirft weiter, der Planer bekommt eine 500 statt
   * „für diesen Tag gibt es schon eine Ausnahme". Dasselbe gilt fuer die
   * Pruefbedingungen (`23514`), sollten sie doch einmal durchschlagen.
   *
   * Uebersetzt wird HIER und nicht in der Route: die Route weiss nicht,
   * welche der beiden Tabellen sie gerade getroffen hat.
   */
  let zeilen: readonly { id: string }[];
  try {
    zeilen = await schreibeAusnahme();
  } catch (fehler) {
    const code = (fehler as { code?: unknown }).code;
    if (code === '23505') {
      throw new AusnahmeNichtTragfaehig(
        'Für diesen Tag gibt es in dieser Serie schon eine Ausnahme. Es gibt genau '
        + 'eine je Tag — ändern Sie die bestehende, statt eine zweite anzulegen.');
    }
    if (code === '23514') {
      throw new AusnahmeNichtTragfaehig(
        'Die Ausnahme verletzt eine Prüfbedingung der Tabelle: eine Verschiebung '
        + 'braucht einen Ersatzbeginn, die Ersatzbesetzung ist eine ganze Zahl ab 1, '
        + 'und die Dauer ist positiv.');
    }
    throw fehler;
  }
  const [zeile] = zeilen;

  if (zeile === undefined) {
    /*
     * Null Zeilen heisst hier NICHT „gibt es nicht", sondern: die
     * Schreibpolicy hat nicht getroffen. `turnus_ausnahme` verlangt
     * `reinigung.schreiben`, `posten_ausnahme` verlangt `security.schreiben`
     * — nicht `dienstplan.schreiben`, auf das die Route getort ist. Der Satz
     * nennt das Recht, weil die Route es sonst als 404 ausgibt und niemand
     * erfaehrt, was fehlt.
     */
    throw new SerieEingabeFehlt(
      'Die Ausnahme wurde nicht geschrieben — dafür fehlt das Gewerkerecht '
      + `(${serie.turnus_id !== null ? 'reinigung.schreiben' : 'security.schreiben'}) `
      + 'oder die Serie gehört nicht zu dieser Gesellschaft.');
  }

  const berichte: readonly SerienBericht[] = await generiereSofort(
    { unsafe: (sql, werte) => kontext.schreibe<unknown>(sql, werte) },
    kontext.aktiverMandantId);

  await kontext.schreibe(
    `select app.protokolliere('dienstplan.ausnahme_angelegt', $1, $2, null, $3::jsonb,
                              app.aktiver_mandant())`,
    [serie.turnus_id !== null ? 'turnus_ausnahme' : 'posten_ausnahme', zeile.id,
      { planungsserieId: e.planungsserieId, datum: e.datum, art: e.art, grund }]);

  return {
    id: zeile.id,
    bericht: berichte.find((b) => b.planungsserieId === e.planungsserieId) ?? null,
  };
}
