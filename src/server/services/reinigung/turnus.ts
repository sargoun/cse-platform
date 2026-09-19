import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { rechteImKontext } from '../../auth/kontext-rechte.js';
import { ladeFeiertage } from '../dienstplan/generator.js';
import { EINSAETZE_LEBEND_JE_TURNUS } from '../dienstplan/serienliste.js';
import {
  turnusVorschau, type VorschauAusnahme, type VorschauTermin,
} from './turnusvorschau.js';

/**
 * Die Turnusse der Reinigung — lesend, mit Ausnahmen (CLN-02, CLN-03, TIM-02).
 *
 * **Diese Datei ankert auf `turnus`, nicht auf `planungsserie`** — und das ist
 * der ganze Unterschied zu `services/dienstplan/serienliste.ts`. Ein Turnus
 * ohne Serie ist ein wirklicher Zustand: die Regel steht, der Generator hat
 * sie noch nie gesehen. Wer auf der Serie ankert, sieht genau diesen Turnus
 * nicht — also den einen, um den es geht.
 *
 * **Die Rechte laufen quer zur Route, und die Seite MUSS es sagen.**
 * `/portal/[mandant]/reinigung/turnus` ist auf `reinigung.lesen` bewacht.
 * Dahinter liegen aber (nachgemessen in `pg_policies`):
 *
 * | Tabelle | Recht |
 * |---|---|
 * | `turnus`, `turnus_ausnahme`, `revier` | `reinigung.lesen` |
 * | `objekt` | `objekt.lesen` |
 * | `leistungskatalog_position` | `katalog.lesen` |
 * | `planungsserie`, `einsatz` | `dienstplan.lesen` |
 *
 * RLS filtert **still**. Ein `join objekt` waere deshalb keine Spalte weniger,
 * sondern die halbe Liste weniger — ohne Fehlermeldung. Und `generiert_bis =
 * null` plus „0 Schichten" liest sich als „der Generator steht", wo in
 * Wirklichkeit niemand nachgesehen hat. Beides sind Falschauskuenfte, die wie
 * Befunde aussehen.
 *
 * Deshalb: **jede fremdberechtigte Tabelle als LEFT JOIN**, und das Ergebnis
 * traegt neben den Zeilen die Karte `geprueft`. Dieselbe Bauart wie
 * `ladePlanfenster.abwesenheitGeprueft`.
 */

export class TurnusNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Den Turnus ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'TurnusNichtGefunden';
  }
}

export class AusnahmeEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'AusnahmeEingabeFehlt';
  }
}

/** Die Rechte, die ein vollstaendiger Turnusblick braucht — ausser dem eigenen. */
export const TURNUS_FREMDRECHTE = [
  'objekt.lesen', 'katalog.lesen', 'dienstplan.lesen',
] as const;

export type TurnusGeprueft = Readonly<Record<string, boolean>>;

export interface TurnusZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly revierId: string;
  readonly revier: string;
  /** `null` heisst: `objekt.lesen` fehlt — nicht „kein Objekt". */
  readonly objekt: string | null;
  /** `null` heisst: `katalog.lesen` fehlt — nicht „keine Leistung". */
  readonly leistung: string | null;
  readonly leistungIstPlatzhalter: boolean | null;
  readonly rrule: string;
  /** Wanduhr `HH:MM`, Europe/Berlin. */
  readonly beginnLokal: string;
  /** Sollangabe, `integer` — keine gemessene Dauer. */
  readonly dauerMinuten: number;
  readonly feiertagsregel: 'ausfall' | 'unveraendert';
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
  /** Der Stand des Turnus selbst (`letzte_generierung_bis`). */
  readonly letzteGenerierungBis: string | null;
  /**
   * `null` heisst: **kein Recht ODER keine Serie** — die beiden sind an dieser
   * Spalte allein nicht zu unterscheiden. Wer daraus eine Aussage macht, muss
   * vorher `serieGeprueft` lesen.
   */
  readonly planungsserieId: string | null;
  /**
   * `false` heisst: `dienstplan.lesen` fehlt, `planungsserie` ist von RLS
   * still weggefiltert. Dann ist `planungsserieId === null` **keine** Aussage
   * über die Serie — „keine Serie" wäre ein Fehlalarm auf jedem Turnus.
   */
  readonly serieGeprueft: boolean;
  /** `null` heisst: `dienstplan.lesen` fehlt — nicht „noch nie gelaufen". */
  readonly generiertBis: string | null;
  readonly horizontTage: number | null;
  /** `null` heisst: ungeprueft (`dienstplan.lesen` fehlt). */
  readonly einsaetze: number | null;
  readonly archiviert: boolean;
}

interface TurnusRoh {
  id: string;
  bezeichnung: string;
  revier_id: string;
  revier: string;
  objekt: string | null;
  leistung: string | null;
  leistung_platzhalter: boolean | null;
  rrule: string;
  beginn_lokal: string;
  dauer_minuten: number;
  feiertagsregel: string;
  gueltig_ab: string;
  gueltig_bis: string | null;
  letzte_generierung_bis: string | null;
  planungsserie_id: string | null;
  generiert_bis: string | null;
  horizont_tage: number | null;
  einsaetze: number;
  archiviert: boolean;
  dtstart_datum: string;
  dtstart_stunde: number;
  dtstart_minute: number;
}

const TURNUS_QUELLE = `
  from turnus t
  join revier r on r.mandant_id = t.mandant_id and r.id = t.revier_id
  left join objekt o on o.mandant_id = t.mandant_id and o.id = r.objekt_id
  left join leistungskatalog_position lkp
         on lkp.mandant_id = t.mandant_id and lkp.id = t.leistungskatalog_position_id
  left join planungsserie ps
         on ps.mandant_id = t.mandant_id and ps.turnus_id = t.id and ps.archiviert_am is null
  ${EINSAETZE_LEBEND_JE_TURNUS}`;

const TURNUS_SPALTEN = `
  t.id, t.bezeichnung, t.revier_id, r.bezeichnung as revier,
  o.bezeichnung as objekt,
  lkp.kurztext as leistung, lkp.ist_platzhalter as leistung_platzhalter,
  t.rrule,
  to_char(t.dtstart_lokal, 'HH24:MI')          as beginn_lokal,
  to_char(t.dtstart_lokal, 'YYYY-MM-DD')       as dtstart_datum,
  extract(hour   from t.dtstart_lokal)::int    as dtstart_stunde,
  extract(minute from t.dtstart_lokal)::int    as dtstart_minute,
  t.dauer_minuten::int                         as dauer_minuten,
  t.feiertagsregel::text                       as feiertagsregel,
  to_char(t.gueltig_ab, 'YYYY-MM-DD')          as gueltig_ab,
  to_char(t.gueltig_bis, 'YYYY-MM-DD')         as gueltig_bis,
  to_char(t.letzte_generierung_bis, 'YYYY-MM-DD') as letzte_generierung_bis,
  ps.id                                        as planungsserie_id,
  to_char(ps.generiert_bis, 'YYYY-MM-DD')      as generiert_bis,
  ps.horizont_tage::int                        as horizont_tage,
  coalesce(e.anzahl, 0)::int                   as einsaetze,
  (t.archiviert_am is not null)                as archiviert`;

function alsZeile(z: TurnusRoh, geprueft: TurnusGeprueft): TurnusZeile {
  const planbar = geprueft['dienstplan.lesen'] === true;
  return {
    id: z.id,
    bezeichnung: z.bezeichnung,
    revierId: z.revier_id,
    revier: z.revier,
    objekt: z.objekt,
    leistung: z.leistung,
    leistungIstPlatzhalter: z.leistung_platzhalter,
    rrule: z.rrule,
    beginnLokal: z.beginn_lokal,
    dauerMinuten: Number(z.dauer_minuten),
    feiertagsregel: z.feiertagsregel === 'unveraendert' ? 'unveraendert' : 'ausfall',
    gueltigAb: z.gueltig_ab,
    gueltigBis: z.gueltig_bis,
    letzteGenerierungBis: z.letzte_generierung_bis,
    // `planungsserie` liegt hinter `dienstplan.lesen` (pg_policies: t_mandant).
    // Ohne das Recht liefert der LEFT JOIN still NULL — und „keine Serie" waere
    // dann ein Fehlalarm auf JEDEM Turnus. Deshalb dieselbe Behandlung wie bei
    // `generiertBis` und `einsaetze`, plus `serieGeprueft` als das Wort dazu.
    planungsserieId: planbar ? z.planungsserie_id : null,
    serieGeprueft: planbar,
    generiertBis: planbar ? z.generiert_bis : null,
    horizontTage: z.horizont_tage === null ? null : Number(z.horizont_tage),
    // NULL heisst „nicht geprueft", 0 heisst „geprueft und keine da". Der
    // Unterschied ist die ganze Auskunft dieser Spalte.
    einsaetze: planbar ? Number(z.einsaetze) : null,
    archiviert: z.archiviert,
  };
}

export interface TurnusListe {
  readonly zeilen: readonly TurnusZeile[];
  readonly geprueft: TurnusGeprueft;
}

/**
 * Alle Turnusse der aktiven Gesellschaft — archivierte zuletzt, nicht
 * ausgeblendet.
 *
 * Ein archivierter Turnus wegzulassen waere die bequeme Variante und die
 * falsche: die Schichten, die er erzeugt hat, stehen weiter im Plan und in
 * Rechnungen. Wer fragt „woher kommt diese Schicht", muss ihn finden.
 */
export async function listeTurnusse(kontext: LeseKontext): Promise<TurnusListe> {
  const geprueft = await rechteImKontext(kontext, ...TURNUS_FREMDRECHTE);
  const zeilen = await kontext.abfrage<TurnusRoh>(
    `select ${TURNUS_SPALTEN} ${TURNUS_QUELLE}
      order by (t.archiviert_am is not null), o.bezeichnung nulls last,
               r.bezeichnung, t.dtstart_lokal, t.bezeichnung
      limit 500`,
  );
  return { zeilen: zeilen.map((z) => alsZeile(z, geprueft)), geprueft };
}

export interface TurnusBlatt extends TurnusZeile {
  /** Der lokale Anker, wie `entfalte` ihn braucht. */
  readonly anker: { readonly datum: string; readonly stunde: number; readonly minute: number };
}

export async function findeTurnus(
  kontext: LeseKontext, id: string,
): Promise<{ readonly blatt: TurnusBlatt | null; readonly geprueft: TurnusGeprueft }> {
  const geprueft = await rechteImKontext(kontext, ...TURNUS_FREMDRECHTE);
  const [z] = await kontext.abfrage<TurnusRoh>(
    `select ${TURNUS_SPALTEN} ${TURNUS_QUELLE} where t.id = $1::uuid`, [id],
  );
  if (z === undefined) return { blatt: null, geprueft };
  return {
    blatt: {
      ...alsZeile(z, geprueft),
      anker: {
        datum: z.dtstart_datum,
        stunde: Number(z.dtstart_stunde),
        minute: Number(z.dtstart_minute),
      },
    },
    geprueft,
  };
}

/* ===========================================================================
 * Die Ausnahmen eines Turnus (04-PLANUNG-ZEIT.md §8.2 Schritt 3)
 * ======================================================================== */

export type AusnahmeArt = 'ausfall' | 'zusatz' | 'verschiebung';
export const AUSNAHME_ARTEN: readonly AusnahmeArt[] = ['ausfall', 'zusatz', 'verschiebung'];

export const AUSNAHME_TEXT: Readonly<Record<AusnahmeArt, string>> = {
  ausfall: 'Ausfall',
  zusatz: 'Zusatztermin',
  verschiebung: 'Verschiebung',
};

export interface AusnahmeZeile {
  readonly id: string;
  readonly datum: string;
  readonly art: AusnahmeArt;
  /** `JJJJ-MM-TTTHH:MM`, Ortszeit — oder `null`. */
  readonly ersatzBeginnLokal: string | null;
  readonly dauerMinuten: number | null;
  readonly grund: string;
  /**
   * `null` heisst UNBEANTWORTET und nicht „nein".
   *
   * Ob ein Ausfall vom Rechnungsbetrag abgeht und ob ein Zusatztermin
   * zusaetzlich berechnet wird, steht in keinem Dokument dieser Plattform —
   * es steht im Vertrag. Die Spalte ist deshalb nullbar, und dieser Dienst
   * leitet den Wert nicht aus der Art ab.
   *
   * // TODO(client, O-700): Ist ein Ausfall eines Reinigungsturnus vom Pauschalbetrag abzuziehen und ein Zusatztermin zusaetzlich zu berechnen, oder gleicht die Pauschale beides aus?
   */
  readonly abrechnungsrelevant: boolean | null;
  readonly erstelltAmLokal: string;
}

interface AusnahmeRoh {
  id: string;
  datum: string;
  art: string;
  ersatz_beginn_lokal: string | null;
  dauer_minuten: number | null;
  grund: string;
  abrechnungsrelevant: boolean | null;
  erstellt_lokal: string;
}

function alsAusnahme(z: AusnahmeRoh): AusnahmeZeile {
  return {
    id: z.id,
    datum: z.datum,
    art: (AUSNAHME_ARTEN.find((a) => a === z.art) ?? 'ausfall'),
    ersatzBeginnLokal: z.ersatz_beginn_lokal,
    dauerMinuten: z.dauer_minuten === null ? null : Number(z.dauer_minuten),
    grund: z.grund,
    abrechnungsrelevant: z.abrechnungsrelevant,
    erstelltAmLokal: z.erstellt_lokal,
  };
}

export async function ladeAusnahmen(
  kontext: LeseKontext, turnusId: string,
): Promise<readonly AusnahmeZeile[]> {
  const zeilen = await kontext.abfrage<AusnahmeRoh>(
    `select a.id, to_char(a.datum, 'YYYY-MM-DD') as datum, a.art::text as art,
            to_char(a.ersatz_beginn_lokal, 'YYYY-MM-DD"T"HH24:MI') as ersatz_beginn_lokal,
            a.dauer_minuten::int as dauer_minuten, a.grund, a.abrechnungsrelevant,
            to_char(a.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as erstellt_lokal
       from turnus_ausnahme a
      where a.turnus_id = $1::uuid
      order by a.datum, a.art
      limit 400`,
    [turnusId],
  );
  return zeilen.map(alsAusnahme);
}

export interface AusnahmeEingabe {
  readonly turnusId: string;
  readonly datum: string;
  readonly art: AusnahmeArt;
  /** `HH:MM` — der Ersatzbeginn AM `datum`, oder `null`. */
  readonly ersatzBeginn?: string | null;
  readonly dauerMinuten?: number | null;
  readonly grund: string;
  /** Bleibt `null`, wenn niemand es setzt — siehe O-700. */
  readonly abrechnungsrelevant?: boolean | null;
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/u;

/**
 * Eine Ausnahme anlegen — der einzige Schreibweg auf `turnus_ausnahme`
 * ausserhalb des Seeds.
 *
 * **`abrechnungsrelevant` wird NICHT aus der Art abgeleitet.** Die naechste
 * Zeile waere `art === 'ausfall' ? true : false`, sie waere plausibel, und sie
 * waere eine Vertragsaussage, die niemand getroffen hat (O-700).
 *
 * **Der Ersatzbeginn kommt als Uhrzeit herein, nicht als Zeitstempel.** Die
 * Tabelle fuehrt `timestamp without time zone` — eine Wanduhr, wie
 * `turnus.dtstart_lokal`. Er wird deshalb in der ANWEISUNG aus Datum und
 * Uhrzeit gebaut und nie in Node zusammengesetzt (K-11).
 */
export async function legeAusnahmeAn(
  kontext: SchreibKontext, e: AusnahmeEingabe,
): Promise<{ readonly id: string }> {
  if (!DATUM.test(e.datum)) throw new AusnahmeEingabeFehlt('Das Datum ist ein Kalendertag.');
  if (!AUSNAHME_ARTEN.includes(e.art)) {
    throw new AusnahmeEingabeFehlt('Die Art ist Ausfall, Zusatztermin oder Verschiebung.');
  }
  if (e.grund.trim() === '') {
    throw new AusnahmeEingabeFehlt(
      'Eine Ausnahme braucht einen Grund — sonst steht im Plan eine Luecke ohne Erklaerung.');
  }
  const beginn = e.ersatzBeginn === undefined || e.ersatzBeginn === null || e.ersatzBeginn === ''
    ? null : e.ersatzBeginn;
  if (beginn !== null && !UHRZEIT.test(beginn)) {
    throw new AusnahmeEingabeFehlt('Der Ersatzbeginn ist eine Uhrzeit HH:MM.');
  }
  if (e.art === 'verschiebung' && beginn === null) {
    throw new AusnahmeEingabeFehlt('Eine Verschiebung braucht einen Ersatzbeginn.');
  }
  const dauer = e.dauerMinuten === undefined || e.dauerMinuten === null ? null : e.dauerMinuten;
  if (dauer !== null && (!Number.isInteger(dauer) || dauer < 15 || dauer > 24 * 60 - 1)) {
    throw new AusnahmeEingabeFehlt('Die abweichende Dauer liegt zwischen 15 und 1439 Minuten.');
  }

  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into turnus_ausnahme
       (mandant_id, turnus_id, datum, art, ersatz_beginn_lokal, dauer_minuten,
        grund, abrechnungsrelevant, erstellt_von_art, erstellt_von)
     select app.aktiver_mandant(), t.id, $2::date, $3::turnus_ausnahme_art,
            case when $4::text is null then null
                 else ($2 || ' ' || $4)::timestamp end,
            $5::integer, $6, $7::boolean, 'mensch', app.aktueller_benutzer()
       from turnus t
      where t.id = $1::uuid
     returning id`,
    [e.turnusId, e.datum, e.art, beginn, dauer, e.grund.trim(),
      e.abrechnungsrelevant ?? null],
  );
  if (zeile === undefined) throw new TurnusNichtGefunden(e.turnusId);
  return { id: zeile.id };
}

/* ===========================================================================
 * Die Vorschau und die materialisierten Schichten
 * ======================================================================== */

export interface TurnusVorschauErgebnis {
  readonly termine: readonly VorschauTermin[];
  readonly fenster: { readonly vonDatum: string; readonly bisDatum: string };
  /** Bundesland der Serie, sonst Berlin — die Feiertage haengen daran. */
  readonly bundesland: string;
}

/**
 * Die Vorschau eines Turnus, mit ECHTEN Feiertagen.
 *
 * Das Bundesland kommt aus `planungsserie.feiertag_bundesland`, wenn es eine
 * Serie gibt, und sonst aus `BE`: der Sitz der Gruppe ist Berlin, und die
 * Serie schreibt das Land bei der Anlage fest (§8.5). Ohne Serie ist die
 * Vorschau eine Aussage darueber, was ENTSTEHEN wuerde — dann ist Berlin die
 * Annahme, und die Seite nennt sie.
 */
export async function ladeVorschau(
  kontext: LeseKontext, blatt: TurnusBlatt,
  fenster: { readonly vonDatum: string; readonly bisDatum: string },
): Promise<TurnusVorschauErgebnis> {
  const [land] = blatt.planungsserieId === null ? [] : await kontext.abfrage<{ land: string }>(
    `select feiertag_bundesland as land from planungsserie where id = $1::uuid`,
    [blatt.planungsserieId],
  );
  const bundesland = land?.land ?? 'BE';
  const { namen } = await ladeFeiertage(
    { unsafe: (sql, werte) => kontext.abfrage<unknown>(sql, werte) },
    bundesland, fenster.vonDatum, fenster.bisDatum,
  );
  const ausnahmen = await ladeAusnahmen(kontext, blatt.id);
  const termine = turnusVorschau(
    {
      rrule: blatt.rrule,
      dtstartLokal: blatt.anker,
      dauerMinuten: blatt.dauerMinuten,
      feiertagsregel: blatt.feiertagsregel,
      gueltigAb: blatt.gueltigAb,
      gueltigBis: blatt.gueltigBis,
    },
    ausnahmen.map((a): VorschauAusnahme => ({
      id: a.id,
      datum: a.datum,
      art: a.art,
      ersatzBeginnLokal: a.ersatzBeginnLokal,
      dauerMinuten: a.dauerMinuten,
      grund: a.grund,
    })),
    namen, fenster,
  );
  return { termine, fenster, bundesland };
}

export interface TurnusEinsatzZeile {
  readonly id: string;
  readonly planDatum: string;
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly besetzt: number;
  readonly soll: number;
  readonly status: string;
  readonly storniert: boolean;
  readonly zeitanomalie: string;
}

/**
 * Die Schichten, die dieser Turnus schon erzeugt hat.
 *
 * Verlangt `dienstplan.lesen` — ohne das Recht kommt eine leere Liste, und die
 * Seite muss das als „nicht geprueft" zeigen, nicht als „keine Schichten".
 * `listeTurnusse`/`findeTurnus` geben die Karte `geprueft` dafuer mit.
 */
export async function ladeTurnusEinsaetze(
  kontext: LeseKontext, turnusId: string, grenze = 60,
): Promise<readonly TurnusEinsatzZeile[]> {
  return kontext.abfrage<TurnusEinsatzZeile>(
    `select e.id,
            to_char(e.plan_datum, 'YYYY-MM-DD')  as "planDatum",
            to_char(e.beginn_lokal, 'HH24:MI')   as "beginnLokal",
            to_char(e.ende_lokal, 'HH24:MI')     as "endeLokal",
            e.besetzt_anzahl::int                as besetzt,
            e.soll_besetzung::int                as soll,
            e.status::text                       as status,
            (e.storniert_am is not null)         as storniert,
            e.zeitanomalie::text                 as zeitanomalie
       from einsatz e
      where e.turnus_id = $1::uuid
      order by e.plan_datum desc, e.beginn_lokal
      limit $2::integer`,
    [turnusId, grenze],
  );
}
