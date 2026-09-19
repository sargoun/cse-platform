import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';
import { rechteImKontext } from '../../auth/kontext-rechte.js';
import { nachweislage, type Nachweislage } from '../nachweis/uebersicht.js';

/**
 * Das Blatt EINER Veranstaltung — Kopf, Besetzungsstand, Dienstanweisung
 * (SEC-08, SEC-04, D-09).
 *
 * **Warum es diese Datei gibt, obwohl `eventbesetzung.ts` daneben liegt.**
 * Jener Dienst SCHREIBT: er legt die Eventschicht an und reicht jede Zuweisung
 * an `besetzeEinsatz` weiter. Sein `ladeVeranstaltung` ist privat und liefert
 * genau, was das Schreiben braucht — `id`, `objekt_id`, `kunde_id`,
 * `auftrag_leistung_id`, `soll_besetzung`, `archiviert`. Keines der Kopffelder
 * ist dabei: kein `bezeichnung`, kein `anlass`, kein `beginn`, kein `ende`,
 * kein Ort, keine Leitung, keine Dienstanweisung. Ein Einzelblatt darauf zu
 * bauen ergäbe eine Seite mit lauter leeren Feldern und keine Fehlermeldung.
 *
 * ## Drei unterscheidbare Zustände, nicht zwei
 *
 * `veranstaltung` liegt hinter `security.lesen` — dem Recht der Route.
 * `einsatz` und `einsatz_zuordnung` liegen hinter `dienstplan.lesen`, die
 * Nachweislage je Person hinter `personal.nachweis_lesen`. Mit
 * `security.lesen` allein ist die Veranstaltung sichtbar und der
 * Besetzungsstand LEER — und leer ist hier gefährlich, weil eine unbesetzte
 * Veranstaltung und eine nicht lesbare Veranstaltung gleich aussehen. Der
 * Besetzungsblock trägt deshalb `geprueft` mit, und die Oberfläche
 * unterscheidet:
 *
 *  1. **nicht geprüft** — das Recht fehlt, es gibt keine Aussage;
 *  2. **geprüft, keine Schicht** — niemand hat die Eventschicht angelegt;
 *  3. **geprüft, Schicht da** — mit Zahl und Namen.
 *
 * ## `soll_besetzung` trägt keine Dringlichkeit
 *
 * Ob die vereinbarte Stärke zugleich die MINDESTstärke ist, steht in keinem
 * Dokument — und die Antwort entscheidet, ob jede unvollständig besetzte
 * Veranstaltung als Notfall gemeldet wird oder keine. Dieser Dienst liefert
 * deshalb die Zahlen und keine Ampel.
 *
 * // TODO(client, O-210): Gilt bei einem Veranstaltungsdienst die vereinbarte Stärke zugleich als Mindestbesetzung, oder gibt es eine niedrigere Grenze, unter der der Dienst als nicht erbracht gilt (SEC-08)?
 *
 * ## Woher ein Eventauftrag kommt, ist offen
 *
 * Es gibt im ganzen Baum keinen Anlegeweg für eine `veranstaltung`, und die
 * Seitenkarte §5.8 führt keine Route `/veranstaltungen/neu`. Ob ein
 * Eventauftrag aus `auftrag_leistung` entsteht, im Vertrieb angelegt oder von
 * der Wachleitung handerfasst wird, ist nicht entschieden — und davon hängt
 * ab, welche Felder Pflicht sind und wer sie füllt.
 *
 * // TODO(client, O-703): Woher entsteht ein Veranstaltungsauftrag — aus einer Auftragsleistung, aus dem Vertrieb oder handerfasst von der Wachleitung, und wer darf ihn anlegen?
 */

export class VeranstaltungNichtSichtbar extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Die Veranstaltung ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'VeranstaltungNichtSichtbar';
  }
}

/** Die Rechte, die das Blatt ausser `security.lesen` gern hätte. */
export const VERANSTALTUNG_FREMDRECHTE = [
  'dienstplan.lesen', 'personal.nachweis_lesen', 'objekt.lesen', 'crm.lesen',
  'dienstanweisung.lesen',
] as const;

export interface VeranstaltungKopf {
  readonly id: string;
  readonly bezeichnung: string;
  readonly anlass: string | null;
  readonly kundeId: string;
  /** `null` heisst: `crm.lesen` fehlt — nicht „kein Kunde". */
  readonly kunde: string | null;
  readonly objektId: string | null;
  /** `null` heisst: kein Objekt ODER `objekt.lesen` fehlt — `hatObjekt` trennt. */
  readonly objekt: string | null;
  readonly hatObjekt: boolean;
  readonly veranstaltungsortText: string | null;
  /** Berliner Ortszeit, fertig aus der Datenbank (Invariante 2). */
  readonly beginnLokal: string;
  readonly endeLokal: string;
  /** Der Instant, wie gespeichert — UTC. Für die Fussnote, nicht für die Zeile. */
  readonly beginnUtc: string;
  readonly endeUtc: string;
  /** Differenz der Instants in Minuten — nie eine Wanduhr-Subtraktion. */
  readonly dauerMinuten: number;
  readonly erwarteteBesucher: number | null;
  readonly sollBesetzung: number;
  readonly leitungAnstellungId: string | null;
  readonly leitung: string | null;
  readonly dienstanweisungId: string | null;
  /** `null` heisst: kein Verweis ODER `dienstanweisung.lesen` fehlt. */
  readonly dienstanweisungTitel: string | null;
  readonly dienstanweisungVersion: number | null;
  readonly dienstanweisungStatus: string | null;
  readonly archiviert: boolean;
  readonly auftragLeistungId: string | null;
}

interface KopfRoh {
  id: string;
  bezeichnung: string;
  anlass: string | null;
  kunde_id: string;
  kunde: string | null;
  objekt_id: string | null;
  objekt: string | null;
  veranstaltungsort_text: string | null;
  beginn_lokal: string;
  ende_lokal: string;
  beginn_utc: string;
  ende_utc: string;
  dauer_minuten: number;
  erwartete_besucher: number | null;
  soll_besetzung: number;
  leitung_anstellung_id: string | null;
  leitung: string | null;
  dienstanweisung_id: string | null;
  da_titel: string | null;
  da_version: number | null;
  da_status: string | null;
  archiviert: boolean;
  auftrag_leistung_id: string | null;
}

export interface BesetzungZeile {
  readonly zuordnungId: string;
  readonly personId: string;
  readonly anstellungId: string;
  readonly name: string;
  readonly funktion: string | null;
  readonly status: string;
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly zugesagtAmLokal: string | null;
  readonly abgesagtAmLokal: string | null;
  readonly absageGrund: string | null;
  /** `null` heisst: `personal.nachweis_lesen` fehlt — nicht „kein Nachweis". */
  readonly lage: Nachweislage | null;
}

export interface Eventschicht {
  readonly einsatzId: string;
  readonly planDatum: string;
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly sollBesetzung: number;
  readonly minBesetzung: number;
  readonly besetztAnzahl: number;
  readonly status: string;
  readonly storniert: boolean;
  readonly besetzung: readonly BesetzungZeile[];
}

export interface VeranstaltungBlatt {
  readonly kopf: VeranstaltungKopf;
  readonly geprueft: Readonly<Record<string, boolean>>;
  /**
   * `null` heisst: `dienstplan.lesen` fehlt, es gibt KEINE Aussage.
   * Ein leeres Array heisst: geprüft, und es gibt keine Eventschicht.
   */
  readonly schichten: readonly Eventschicht[] | null;
  readonly stichtag: string;
}

/**
 * Der Kopf-Join.
 *
 * `objekt` (`objekt.lesen`), `kunde` (`crm.lesen`) und `dienstanweisung`
 * (`dienstanweisung.lesen`) als LEFT JOIN: ein Innenverbund liesse die
 * Veranstaltung ganz verschwinden, weil ein Recht fehlt — und ein 404 auf
 * einer Seite, die es gibt, ist die falsche Antwort.
 *
 * Die Dauer kommt als Differenz der INSTANTS (`ende - beginn`), nicht als
 * Differenz der Ortszeiten: eine Veranstaltung über die Umstellungsnacht wäre
 * sonst eine Stunde zu lang oder zu kurz (Invariante 2).
 */
const KOPF_ABFRAGE = `
  select v.id, v.bezeichnung, v.anlass,
         v.kunde_id, k.name as kunde,
         v.objekt_id, o.bezeichnung as objekt, v.veranstaltungsort_text,
         to_char(v.beginn at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as beginn_lokal,
         to_char(v.ende   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as ende_lokal,
         to_char(v.beginn at time zone 'UTC', 'YYYY-MM-DD HH24:MI')           as beginn_utc,
         to_char(v.ende   at time zone 'UTC', 'YYYY-MM-DD HH24:MI')           as ende_utc,
         (extract(epoch from (v.ende - v.beginn)) / 60)::int as dauer_minuten,
         v.erwartete_besucher, v.soll_besetzung::int as soll_besetzung,
         v.leitung_anstellung_id,
         (lp.vorname || ' ' || lp.nachname) as leitung,
         v.dienstanweisung_id,
         da.titel        as da_titel,
         dav.version::int as da_version,
         da.status::text as da_status,
         (v.archiviert_am is not null) as archiviert,
         v.auftrag_leistung_id
    from veranstaltung v
    left join kunde  k on k.mandant_id = v.mandant_id and k.id = v.kunde_id
    left join objekt o on o.mandant_id = v.mandant_id and o.id = v.objekt_id
    left join anstellung la
           on la.mandant_id = v.mandant_id and la.id = v.leitung_anstellung_id
    left join person lp on lp.id = la.person_id
    left join dienstanweisung da
           on da.mandant_id = v.mandant_id and da.id = v.dienstanweisung_id
    left join dienstanweisung_version dav
           on dav.mandant_id = da.mandant_id and dav.id = da.aktive_version_id`;

function alsKopf(z: KopfRoh): VeranstaltungKopf {
  return {
    id: z.id,
    bezeichnung: z.bezeichnung,
    anlass: z.anlass,
    kundeId: z.kunde_id,
    kunde: z.kunde,
    objektId: z.objekt_id,
    objekt: z.objekt,
    hatObjekt: z.objekt_id !== null,
    veranstaltungsortText: z.veranstaltungsort_text,
    beginnLokal: z.beginn_lokal,
    endeLokal: z.ende_lokal,
    beginnUtc: z.beginn_utc,
    endeUtc: z.ende_utc,
    dauerMinuten: Number(z.dauer_minuten),
    erwarteteBesucher: z.erwartete_besucher === null ? null : Number(z.erwartete_besucher),
    sollBesetzung: Number(z.soll_besetzung),
    leitungAnstellungId: z.leitung_anstellung_id,
    leitung: z.leitung,
    dienstanweisungId: z.dienstanweisung_id,
    dienstanweisungTitel: z.da_titel,
    dienstanweisungVersion: z.da_version === null ? null : Number(z.da_version),
    dienstanweisungStatus: z.da_status,
    archiviert: z.archiviert,
    auftragLeistungId: z.auftrag_leistung_id,
  };
}

/**
 * Die Veranstaltung samt Besetzungsstand — oder `null`, wenn es sie in dieser
 * Gesellschaft nicht gibt.
 *
 * `stichtag` ist ein Pflichtargument: die Nachweislage wird gegen den TAG DER
 * VERANSTALTUNG geprüft und nicht gegen heute. „Ist der Nachweis heute
 * gültig" und „war er am Einsatztag gültig" sind zwei Fragen, und ein
 * Vorgabewert machte aus der zweiten stillschweigend die erste.
 */
export async function findeVeranstaltung(
  kontext: LeseKontext, id: string,
): Promise<VeranstaltungBlatt | null> {
  const geprueft = await rechteImKontext(kontext, ...VERANSTALTUNG_FREMDRECHTE);
  const [roh] = await kontext.abfrage<KopfRoh>(
    `${KOPF_ABFRAGE} where v.id = $1::uuid`, [id],
  );
  if (roh === undefined) return null;
  const kopf = alsKopf(roh);

  /* Der Stichtag ist der Berliner Kalendertag des BEGINNS — aus der Datenbank,
     nicht aus dem formatierten Text zusammengeschnitten. */
  const [tag] = await kontext.abfrage<{ tag: string }>(
    `select to_char(v.beginn at time zone 'Europe/Berlin', 'YYYY-MM-DD') as tag
       from veranstaltung v where v.id = $1::uuid`, [id],
  );
  const stichtag = tag?.tag ?? '';

  if (geprueft['dienstplan.lesen'] !== true) {
    return { kopf, geprueft, schichten: null, stichtag };
  }

  const schichtZeilen = await kontext.abfrage<{
    id: string; plan_datum: string; beginn_lokal: string; ende_lokal: string;
    soll: number; min: number; besetzt: number; status: string; storniert: boolean;
  }>(
    `select e.id,
            to_char(e.plan_datum, 'YYYY-MM-DD') as plan_datum,
            to_char(e.beginn_lokal, 'HH24:MI')  as beginn_lokal,
            to_char(e.ende_lokal, 'HH24:MI')    as ende_lokal,
            e.soll_besetzung::int  as soll,
            e.min_besetzung::int   as min,
            e.besetzt_anzahl::int  as besetzt,
            e.status::text         as status,
            (e.storniert_am is not null) as storniert
       from einsatz e
      where e.veranstaltung_id = $1::uuid
      order by e.beginn_zeitpunkt`,
    [id],
  );

  const schichten: Eventschicht[] = [];
  for (const s of schichtZeilen) {
    const zuordnungen = await kontext.abfrage<{
      id: string; person_id: string; anstellung_id: string; name: string;
      funktion: string | null; status: string;
      beginn_lokal: string; ende_lokal: string;
      zugesagt_lokal: string | null; abgesagt_lokal: string | null;
      absage_grund: string | null;
    }>(
      /*
       * `entfernt_am is null`: eine entfernte Zuordnung ist nicht geloescht
       * (Invariante 8), aber sie besetzt die Schicht nicht mehr. Sie hier
       * mitzuzaehlen liesse eine unbesetzte Nacht besetzt aussehen.
       */
      `select z.id, z.person_id, z.anstellung_id,
              (p.vorname || ' ' || p.nachname) as name,
              z.funktion, z.status::text as status,
              to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                as beginn_lokal,
              to_char(z.ende_zeitpunkt   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                as ende_lokal,
              to_char(z.zugesagt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                as zugesagt_lokal,
              to_char(z.abgesagt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                as abgesagt_lokal,
              z.absage_grund
         from einsatz_zuordnung z
         join person p on p.id = z.person_id
        where z.einsatz_id = $1::uuid and z.entfernt_am is null
        order by p.nachname, p.vorname`,
      [s.id],
    );

    const besetzung: BesetzungZeile[] = [];
    for (const z of zuordnungen) {
      /*
       * Die Nachweislage kommt aus dem EINEN Dienst, der sie kennt
       * (`nachweis/uebersicht.ts`) — und der beruehrt `anstellung` gar nicht,
       * damit kein Entgeltfeld mitwandert (K-05, D-09 §6). Ohne
       * `personal.nachweis_lesen` liefert die RLS dort nichts; dann steht
       * `null` und nicht eine leere Nachweisliste, die wie „kein Nachweis"
       * aussieht.
       */
      const lage = geprueft['personal.nachweis_lesen'] === true
        ? await nachweislage(
          { unsafe: (sql, werte) => kontext.abfrage<unknown>(sql, werte) },
          z.person_id, stichtag,
        )
        : null;
      besetzung.push({
        zuordnungId: z.id,
        personId: z.person_id,
        anstellungId: z.anstellung_id,
        name: z.name,
        funktion: z.funktion,
        status: z.status,
        beginnLokal: z.beginn_lokal,
        endeLokal: z.ende_lokal,
        zugesagtAmLokal: z.zugesagt_lokal,
        abgesagtAmLokal: z.abgesagt_lokal,
        absageGrund: z.absage_grund,
        lage,
      });
    }

    schichten.push({
      einsatzId: s.id,
      planDatum: s.plan_datum,
      beginnLokal: s.beginn_lokal,
      endeLokal: s.ende_lokal,
      sollBesetzung: Number(s.soll),
      minBesetzung: Number(s.min),
      besetztAnzahl: Number(s.besetzt),
      status: s.status,
      storniert: s.storniert,
      besetzung,
    });
  }

  return { kopf, geprueft, schichten, stichtag };
}
