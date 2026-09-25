/**
 * Der Zeit-Einwand (EMP-07, TIM-11, LEG-02; 01-KERN §6.27).
 *
 * **Der Mensch aendert seinen Zeiteintrag nie selbst.** Das ist keine
 * Bequemlichkeitsentscheidung der Oberflaeche, sondern der Grund, warum der
 * Datensatz im Lohnstreit ueberhaupt etwas wert ist: eine Aufzeichnung, die
 * die betroffene Person geschrieben hat, ist keine Aufzeichnung mehr, sondern
 * ihre Behauptung. Was der Mensch hat, ist dieser eine Weg — er meldet die
 * Abweichung, die Planung entscheidet, und erst die Entscheidung erzeugt eine
 * `zeiteintrag_korrektur`.
 *
 * Drei Dinge, die dieser Dienst deshalb NICHT tut:
 *
 *  - Er schreibt **keine Zeit**. `behauptet_*` ist die Behauptung, nie ein
 *    massgeblicher Zeitpunkt (Invariante 5, §1.8).
 *  - Er entscheidet **nicht selbst**. `entscheideEinwand` setzt nur den
 *    Zustand mit Begruendung; die Korrektur schreibt
 *    `korrigiereZeiteintrag` — und deren Ausloeser `zk_nicht_selbst`
 *    verlangt einen anderen Menschen.
 *  - Er ermittelt den Mandanten **nicht aus der Anfrage**. Der Aufrufer
 *    betritt `withTenant` mit dem Mandanten der betroffenen Anstellung, den
 *    `mandantDerAnstellung` serverseitig aufloest (K-02, Invariante 3).
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { erzeuge } from '../../benachrichtigung/registry.js';
import { registriereZeitArten } from './benachrichtigung.js';
import { ART_EINWAND_ENTSCHIEDEN } from './benachrichtigung.js';

export type EinwandArt =
  'eintrag_fehlt' | 'zeit_falsch' | 'pause_falsch' | 'zuordnung_falsch' | 'sonstiges';

export type EinwandStatus =
  | 'offen' | 'in_pruefung'
  | 'anerkannt' | 'teilweise_anerkannt' | 'abgelehnt' | 'zurueckgezogen';

/** Die Zustaende, die einen Vorgang abschliessen. */
export const ENTSCHIEDEN: readonly EinwandStatus[] = [
  'anerkannt', 'teilweise_anerkannt', 'abgelehnt', 'zurueckgezogen',
];

/**
 * Die drei, die eine ENTSCHEIDUNG der Planung sind.
 *
 * Nur sie loesen das Selbstentscheidungsverbot aus (EMP-07) — dieselbe Liste
 * wie in `kern.zeit_einwand_status`. `in_pruefung` ist ein Zwischenstand, und
 * `zurueckgezogen` ist keine Entscheidung UEBER den Einwand, sondern die
 * Feststellung, dass er keine mehr braucht.
 *
 * **Richtigstellung (V-052).** Hier stand, `zurueckgezogen` ziehe „die
 * betroffene Person selbst" zurueck. Das stimmte nicht und widersprach der
 * Migration, die es baut: `0052` gibt der betroffenen Person ausdrücklich NUR
 * `t_selbst_einreichen` (INSERT) und kein UPDATE-Gegenstueck, mit der
 * Begruendung, einen eingereichten Einwand zurueckzuziehen sei „eine
 * Entscheidung der Planung … nicht ein zweiter Griff des Menschen in seinen
 * eigenen Vorgang". Ein Kommentar, der das Gegenteil der Policy behauptet,
 * ist schlimmer als keiner: er laesst eine Oberflaeche bauen, die an einer
 * Regel scheitert, die niemand gesucht haette.
 *
 * Ob es so bleiben soll, ist offen — siehe **O-901**. Erfunden wird hier
 * nichts; gebaut ist der Weg, den die Datenbank heute erlaubt.
 */
export const ENTSCHEIDUNG: readonly EinwandStatus[] = [
  'anerkannt', 'teilweise_anerkannt', 'abgelehnt',
];

export interface EinwandEingabe {
  readonly anstellungId: string;
  /** NULL genau dann, wenn `art = 'eintrag_fehlt'` (§6.27). */
  readonly zeiteintragId?: string | null;
  readonly art: EinwandArt;
  /** Der BERLINER Kalendertag, `JJJJ-MM-TT` (K-11). */
  readonly betrifftDatum: string;
  readonly behauptetBeginn?: Date | null;
  readonly behauptetEnde?: Date | null;
  readonly behauptetPauseMinuten?: number | null;
  readonly begruendung: string;
  readonly eingereichtVonBenutzerId: string;
}

export interface EinwandZeile {
  readonly id: string;
  readonly mandantId: string;
  readonly anstellungId: string;
  readonly personId: string;
  readonly personName: string;
  readonly zeiteintragId: string | null;
  readonly art: EinwandArt;
  readonly betrifftDatum: string;
  readonly behauptetBeginn: Date | null;
  readonly behauptetEnde: Date | null;
  readonly behauptetPauseMinuten: number | null;
  readonly begruendung: string;
  readonly status: EinwandStatus;
  readonly eingereichtAm: Date;
  readonly entschiedenAm: Date | null;
  readonly entscheidungBegruendung: string | null;
}

export class EinwandNichtGefundenFehler extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten. Der
    // Unterschied waere die Auskunft, dass es sie woanders gibt.
    super(`Einwand ${id} ist nicht vorhanden.`);
    this.name = 'EinwandNichtGefundenFehler';
  }
}

export class EinwandBereitsEntschiedenFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(status: EinwandStatus) {
    super(`Der Einwand ist bereits ${status}. Ein neuer Sachverhalt ist ein neuer Einwand.`);
    this.name = 'EinwandBereitsEntschiedenFehler';
  }
}

export class EinwandOhneBezugFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor() {
    super('Nur ein Einwand der Art „eintrag_fehlt" kommt ohne Zeiteintrag aus.');
    this.name = 'EinwandOhneBezugFehler';
  }
}

/**
 * Ueber den eigenen Einwand entscheidet man nicht (EMP-07).
 *
 * **Der Befund, der diese Klasse gebracht hat.** Der Ausloeser
 * `kern.zeit_einwand_status` verbietet es und wirft mit `check_violation` —
 * `entscheideEinwand` prueft es vorher NICHT, und die Route kennt in ihrer
 * Fangkette nur „nicht gefunden", „bereits entschieden" und die
 * Auth-Fehler. Der Klick endete damit in einem ungefangenen 500 statt in
 * einer Meldung. Auf der Detailseite ist das der wahrscheinlichste Weg
 * dorthin: dort hat die betroffene Person ihren eigenen Vorgang offen vor
 * sich.
 *
 * Geprueft wird hier UND in der Datenbank. Die Datenbank ist die zweite
 * Linie und bleibt es; was hier dazukommt, ist ein Satz statt eines
 * Serverfehlers.
 */
export class EinwandEigenerFehler extends Error {
  readonly code = 'eigener_einwand';
  readonly status = 409;
  constructor() {
    super(
      'Über den eigenen Einwand entscheidet man nicht (EMP-07). Die Aufzeichnung '
      + 'behält ihren Beweiswert nur, wenn die betroffene Person sie nicht selbst '
      + 'bewegt — die Entscheidung trifft die Planung.');
    this.name = 'EinwandEigenerFehler';
  }
}

export class KeineAnstellungFehler extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor() {
    super('Zu dieser Beschaeftigung ist nichts vorhanden.');
    this.name = 'KeineAnstellungFehler';
  }
}

/**
 * Welcher Gesellschaft gehoert diese Beschaeftigung?
 *
 * Der Einwand entsteht im Portal des Menschen, also im Personen-Scope — und
 * dort ist `app.aktiver_mandant()` NULL, sodass keine Schreibpolicy zutrifft
 * (K-18). Der Dienst betritt deshalb `withTenant` neu, und der Mandant kommt
 * aus DIESER Abfrage: serverseitig aus der Anstellung des Anfragenden
 * abgeleitet, nie aus einem Feld der Anfrage (K-02, Invariante 3).
 *
 * Die Abfrage laeuft unter der Personen-RLS, trifft also nur Anstellungen des
 * angemeldeten Menschen. Eine fremde `anstellungId` liefert null Zeilen und
 * damit 404 — nicht 403, das bestaetigte ihre Existenz.
 */
export async function mandantDerAnstellung(
  kontext: LeseKontext, anstellungId: string,
): Promise<string> {
  const [a] = await kontext.abfrage<{ mandant_id: string }>(
    `select mandant_id from anstellung where id = $1`,
    [anstellungId],
  );
  if (a === undefined) throw new KeineAnstellungFehler();
  return a.mandant_id;
}

/**
 * Warum ein Einwand gegen die Uhr der Datenbank nicht passt (V-193) — als
 * Schlüssel, den das Formular in der Sprache der Kraft nachschlägt.
 *
 *  - `tag_in_zukunft`: der Tag liegt nach dem heutigen Berliner Tag.
 *  - `zeit_in_zukunft`: der behauptete Beginn oder das Ende liegt nach jetzt.
 *  - `beginn_nicht_am_tag`: bei „Eine Zeit fehlt" beginnt die behauptete Zeit
 *    nicht an dem gewählten Tag.
 */
export type EinwandZeitGrund = 'tag_in_zukunft' | 'zeit_in_zukunft' | 'beginn_nicht_am_tag';

export class EinwandZeitFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 422;
  constructor(readonly grund: EinwandZeitGrund) {
    super(`Der Einwand passt nicht zur Uhr der Datenbank: ${grund}`);
    this.name = 'EinwandZeitFehler';
  }
}

/**
 * Der Einwand wird eingereicht.
 *
 * Kein Rechteschluessel: EMP-07 fuehrt das Einreichen als Selbstzugriff (`S`)
 * und nicht als Modulrecht. Die Wache ist die Policy
 * `t_selbst_einreichen` — sie trifft nur Zeilen, deren Anstellung dem
 * angemeldeten Menschen gehoert, und sie ist die einzige Schreiboperation,
 * die ein Mitarbeitender in dieser Domaene besitzt.
 *
 * **Tag und behauptete Zeit gelten gegen die Uhr der Datenbank** (V-193,
 * Invariante 5). Die Seite „Eine Zeit fehlt" setzte `max={heute}` nur im
 * Browser; eine nachgebaute Anfrage legte einen Einwand für einen künftigen
 * Tag an. Ein Einwand behauptet, dass gearbeitet WURDE: ein Tag nach heute
 * oder eine Zeit nach jetzt ist keine Behauptung über geleistete Arbeit. Und
 * der Tag eines Einwands ist der Berliner Kalendertag, an dem die Arbeit
 * begann (0052, K-11 — dieselbe Zuordnung wie beim Eintrag, dessen Tag der
 * seines Beginns ist). Bei „Eine Zeit fehlt" wählt die Kraft Tag UND Zeit
 * selbst, also muss der behauptete Beginn an diesem Tag liegen; beim Einwand
 * zu einem Eintrag nicht — dort kann gerade der Beginn falsch erfasst sein.
 */
export async function reicheEinwandEin(
  kontext: SchreibKontext, eingabe: EinwandEingabe,
): Promise<string> {
  const bezug = eingabe.zeiteintragId ?? null;
  if (bezug === null && eingabe.art !== 'eintrag_fehlt') throw new EinwandOhneBezugFehler();

  const beginn = eingabe.behauptetBeginn ?? null;
  const ende = eingabe.behauptetEnde ?? null;
  const [uhr] = await kontext.abfrage<{
    tag_zukunft: boolean; zeit_zukunft: boolean; beginn_tag: string | null;
  }>(
    `select ($1::date > app.berlin_heute())                              as tag_zukunft,
            (coalesce($2::timestamptz > now(), false)
             or coalesce($3::timestamptz > now(), false))                 as zeit_zukunft,
            to_char($2::timestamptz at time zone 'Europe/Berlin', 'YYYY-MM-DD') as beginn_tag`,
    [eingabe.betrifftDatum, beginn?.toISOString() ?? null, ende?.toISOString() ?? null],
  );
  if (uhr?.tag_zukunft === true) throw new EinwandZeitFehler('tag_in_zukunft');
  if (uhr?.zeit_zukunft === true) throw new EinwandZeitFehler('zeit_in_zukunft');
  if (eingabe.art === 'eintrag_fehlt' && beginn !== null
      && uhr?.beginn_tag !== eingabe.betrifftDatum) {
    throw new EinwandZeitFehler('beginn_nicht_am_tag');
  }

  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into zeit_einwand
       (mandant_id, anstellung_id, zeiteintrag_id, art, betrifft_datum,
        behauptet_beginn, behauptet_ende, behauptet_pause_minuten,
        begruendung, eingereicht_von_benutzer_id)
     values ($1, $2, $3::uuid, $4::einwand_art, $5::date,
             $6::timestamptz, $7::timestamptz, $8, $9, $10)
     returning id`,
    [
      kontext.aktiverMandantId, eingabe.anstellungId, bezug, eingabe.art,
      eingabe.betrifftDatum,
      eingabe.behauptetBeginn?.toISOString() ?? null,
      eingabe.behauptetEnde?.toISOString() ?? null,
      eingabe.behauptetPauseMinuten ?? null,
      eingabe.begruendung.trim(),
      eingabe.eingereichtVonBenutzerId,
    ],
  );
  if (zeile === undefined) throw new Error('Der Einwand wurde nicht geschrieben.');
  return zeile.id;
}

export interface EntscheidungEingabe {
  readonly einwandId: string;
  readonly status: Extract<EinwandStatus,
    'in_pruefung' | 'anerkannt' | 'teilweise_anerkannt' | 'abgelehnt' | 'zurueckgezogen'>;
  /** Pflicht ausser bei `in_pruefung` — eine Entscheidung ohne Grund ist keine. */
  readonly begruendung?: string;
  readonly entschiedenVon: string;
  /** Die Gegenbuchung, wenn der betroffene Monat gesperrt ist (PR 37, §12.2). */
  readonly korrekturBewegungId?: string | null;
}

/**
 * Die Entscheidung der Planung.
 *
 * Sie schreibt KEINE Korrektur — das tut `korrigiereZeiteintrag`, in
 * derselben Transaktion des Aufrufers. Zwei Schritte, weil es zwei Vorgaenge
 * sind: eine anerkannte Meldung ohne Korrektur ist ein Fehler, den man sehen
 * will, und eine Korrektur ohne anerkannte Meldung ebenso.
 */
export async function entscheideEinwand(
  kontext: SchreibKontext, eingabe: EntscheidungEingabe,
): Promise<void> {
  const [vorher] = await kontext.abfrage<{ status: EinwandStatus }>(
    `select status::text as status from zeit_einwand where id = $1`,
    [eingabe.einwandId],
  );
  if (vorher === undefined) throw new EinwandNichtGefundenFehler(eingabe.einwandId);
  if (ENTSCHIEDEN.includes(vorher.status)) {
    throw new EinwandBereitsEntschiedenFehler(vorher.status);
  }

  /*
   * Die Selbstentscheidung VOR dem `update` (EMP-07).
   *
   * Dieselbe Bedingung wie `kern.zeit_einwand_status`, Zeichen fuer Zeichen:
   * sie gilt fuer `anerkannt`, `teilweise_anerkannt` und `abgelehnt` — nicht
   * fuer `in_pruefung` (das ist keine Entscheidung) und nicht fuer
   * `zurueckgezogen` (das zieht die Person selbst zurueck, und genau das darf
   * sie). Eine strengere Pruefung hier waere schlimmer als keine: sie naehme
   * dem Menschen den einen Weg, den er hat.
   */
  if (ENTSCHEIDUNG.includes(eingabe.status)) {
    const [selbst] = await kontext.abfrage<{ eigener: boolean }>(
      `select exists (
                select 1
                  from zeit_einwand e
                  join anstellung a on a.mandant_id = e.mandant_id
                                   and a.id = e.anstellung_id
                  join benutzer b on b.person_id = a.person_id
                 where e.id = $1 and b.id = $2) as eigener`,
      [eingabe.einwandId, eingabe.entschiedenVon]);
    if (selbst?.eigener === true) throw new EinwandEigenerFehler();
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update zeit_einwand
        set status = $2::einwand_status,
            entscheidung_begruendung = $3,
            entschieden_von = case when $2 = 'in_pruefung' then entschieden_von else $4 end,
            entschieden_am  = case when $2 = 'in_pruefung' then entschieden_am
                                   else now() end,
            korrektur_bewegung_id = coalesce($5::uuid, korrektur_bewegung_id)
      where id = $1
      returning id`,
    [
      eingabe.einwandId, eingabe.status,
      eingabe.begruendung?.trim() ?? null,
      eingabe.entschiedenVon,
      eingabe.korrekturBewegungId ?? null,
    ],
  );
  // Kein Treffer heisst hier: die RLS hat die Zeile ausgeblendet, weil das
  // Recht `zeit.einwand_entscheiden` fehlt. Von aussen dieselbe Antwort wie
  // „gibt es nicht" (AUT-06).
  if (zeilen.length === 0) throw new EinwandNichtGefundenFehler(eingabe.einwandId);

  /*
   * ═════════════════════════════════════════════════════════════════════════
   * **Und jetzt erfaehrt es die Person** (V-051, NOT-01).
   * ═════════════════════════════════════════════════════════════════════════
   *
   * Bis hierher setzte diese Funktion Zustand, Zeitpunkt und Begruendung —
   * und danach passierte nichts. Die betroffene Person erfuhr es nur, wenn
   * sie von sich aus dieselbe Seite noch einmal oeffnete. Bei einer Meldung
   * ueber falsch erfasste ARBEITSZEIT ist das die eine Stelle, an der
   * Schweigen teuer ist.
   *
   * **`in_pruefung` meldet sich NICHT.** Das ist keine Entscheidung, sondern
   * die Auskunft, dass jemand hinsieht; 0377 liefert dafuer ohnehin NULL,
   * weil `entschieden_am` dabei ungesetzt bleibt. Eine Meldung „es wurde
   * entschieden", waehrend geprueft wird, waere falsch.
   *
   * **`zurueckgezogen` meldet sich auch nicht** — das tut die Person selbst,
   * und niemand muss sich selbst mitteilen, was er gerade getan hat.
   *
   * **Die Zustellung schreibt `cse_app` nicht selbst.** `benachrichtigung`
   * hat fuer diese Rolle keine INSERT-Policy, mit Absicht: wer dem
   * Posteingang eines anderen Menschen etwas hinzufuegen kann, kann ihm
   * alles hinzufuegen. Migration 0377 stellt dafuer
   * `app.einwand_entscheidung_melden` bereit — Empfaenger abgeleitet, Art
   * festgeschrieben, Ziel auf `/portal/mein/` begrenzt.
   *
   * **Ein Mensch ohne Zugang bekommt nichts, und das bricht nichts ab.** Die
   * Funktion liefert dann NULL (D-09). Die Entscheidung gilt trotzdem; sie
   * ist die Aufzeichnung, die Meldung ist ihr Weg. Beides zu verbinden
   * hiesse, eine Entscheidung daran scheitern zu lassen, dass die Kraft kein
   * Telefon hat.
   */
  if (!ENTSCHEIDUNG.includes(eingabe.status)) return;

  const [kopf] = await kontext.abfrage<{
    mandant_id: string; zeiteintrag_id: string | null; betrifft_datum: string;
    sprache: string | null;
  }>(
    /*
     * Die Sprache der Empfaengerin steht an der Person, nicht am Einwand
     * (V-102, O-889). Beide Verbuende sind LINKS: die Sprache ist ein
     * Zusatz, kein Filter. Ein innerer Verbund liesse die Meldung ausfallen,
     * sobald eine Policy `anstellung` oder `person` ausblendet — und eine
     * Entscheidung ueber die eigene Arbeitszeit, von der niemand erfaehrt,
     * ist genau der Befund, den V-051 geschlossen hat.
     */
    `select e.mandant_id, e.zeiteintrag_id,
            to_char(e.betrifft_datum, 'DD.MM.YYYY') as betrifft_datum,
            p.sprache
       from zeit_einwand e
       left join anstellung a on a.mandant_id = e.mandant_id and a.id = e.anstellung_id
       left join person     p on p.id = a.person_id
      where e.id = $1`,
    [eingabe.einwandId],
  );
  if (kopf === undefined) return;

  registriereZeitArten();
  const meldung = erzeuge(ART_EINWAND_ENTSCHIEDEN, {
    mandantId: kopf.mandant_id,
    sprache: kopf.sprache,
    objektTyp: 'zeit_einwand',
    objektId: eingabe.einwandId,
    daten: {
      status: eingabe.status,
      betrifftDatum: kopf.betrifft_datum,
      begruendung: eingabe.begruendung ?? '',
      zeiteintragId: kopf.zeiteintrag_id ?? '',
    },
  });

  await kontext.schreibe(
    `select app.einwand_entscheidung_melden($1::uuid, $2, $3, $4)`,
    [eingabe.einwandId, meldung.titel, meldung.text, meldung.ziel],
  );
}

const SPALTEN = `
  e.id, e.mandant_id, e.anstellung_id, a.person_id,
  (p.vorname || ' ' || p.nachname) as person_name,
  e.zeiteintrag_id, e.art::text as art, e.betrifft_datum,
  e.behauptet_beginn, e.behauptet_ende, e.behauptet_pause_minuten,
  e.begruendung, e.status::text as status, e.eingereicht_am,
  e.entschieden_am, e.entscheidung_begruendung`;

interface RohZeile {
  id: string; mandant_id: string; anstellung_id: string; person_id: string;
  person_name: string; zeiteintrag_id: string | null; art: EinwandArt;
  betrifft_datum: Date | string;
  behauptet_beginn: Date | null; behauptet_ende: Date | null;
  behauptet_pause_minuten: number | null; begruendung: string;
  status: EinwandStatus; eingereicht_am: Date;
  entschieden_am: Date | null; entscheidung_begruendung: string | null;
}

function abbilden(z: RohZeile): EinwandZeile {
  const datum = typeof z.betrifft_datum === 'string'
    ? z.betrifft_datum.slice(0, 10)
    : `${String(z.betrifft_datum.getUTCFullYear()).padStart(4, '0')}-${String(z.betrifft_datum.getUTCMonth() + 1).padStart(2, '0')}-${String(z.betrifft_datum.getUTCDate()).padStart(2, '0')}`;
  return {
    id: z.id,
    mandantId: z.mandant_id,
    anstellungId: z.anstellung_id,
    personId: z.person_id,
    personName: z.person_name,
    zeiteintragId: z.zeiteintrag_id,
    art: z.art,
    betrifftDatum: datum,
    behauptetBeginn: z.behauptet_beginn,
    behauptetEnde: z.behauptet_ende,
    behauptetPauseMinuten:
      z.behauptet_pause_minuten === null ? null : Number(z.behauptet_pause_minuten),
    begruendung: z.begruendung,
    status: z.status,
    eingereichtAm: z.eingereicht_am,
    entschiedenAm: z.entschieden_am,
    entscheidungBegruendung: z.entscheidung_begruendung,
  };
}

/**
 * Der Eingang der Planung (EMP-07 „reaching the planner").
 *
 * Ohne diese Liste waere „erreicht die Planung" eine Zeile in einer Tabelle,
 * die niemand ansieht — und der Mensch haette gemeldet und nie eine Antwort
 * bekommen. Sortiert nach Eingang, aelteste zuerst: eine Meldung, die liegen
 * bleibt, soll oben stehen und nicht unten.
 */
export async function listeOffeneEinwaende(
  kontext: LeseKontext,
): Promise<readonly EinwandZeile[]> {
  const zeilen = await kontext.abfrage<RohZeile>(
    `select ${SPALTEN}
       from zeit_einwand e
       join anstellung a on a.mandant_id = e.mandant_id and a.id = e.anstellung_id
       join person p on p.id = a.person_id
      where e.status in ('offen','in_pruefung')
      order by e.eingereicht_am asc`,
  );
  return zeilen.map(abbilden);
}

/** Die eigenen Einwaende — die Portalansicht des Menschen (EMP-07, EMP-14). */
export async function listeEigeneEinwaende(
  kontext: LeseKontext,
): Promise<readonly EinwandZeile[]> {
  const zeilen = await kontext.abfrage<RohZeile>(
    `select ${SPALTEN}
       from zeit_einwand e
       join anstellung a on a.mandant_id = e.mandant_id and a.id = e.anstellung_id
       join person p on p.id = a.person_id
      where a.person_id = app.aktuelle_person()
      order by e.betrifft_datum desc, e.eingereicht_am desc`,
  );
  return zeilen.map(abbilden);
}

/* ===========================================================================
 * Das Blatt EINES Einwands — lesend (EMP-07, TIM-08, TIM-11)
 * ======================================================================== */

/**
 * Der Zeiteintrag, um den es geht — **paarweise**.
 *
 * `zeiteintrag` traegt je zwei Werte, nicht je einen:
 * `geraete_zeit_beginn`/`geraete_zeit_ende`,
 * `zeitabweichung_beginn_sek`/`zeitabweichung_ende_sek`,
 * `dauer_brutto_minuten`/`dauer_netto_minuten`. Ein `zeitabweichung_sek`
 * gibt es NICHT — wer es so baut, zeigt eine Abweichung, die keine Spalte
 * hat, und die Seite bleibt an dieser Stelle fuer immer leer.
 *
 * Die Abweichung ist GERAET MINUS SERVER (0034, D-134): eine negative Zahl
 * heisst, die Telefonuhr lag HINTER der Serveruhr — das Geraet ging nach.
 */
export interface EinwandEintrag {
  readonly id: string;
  readonly beginnLokal: string;
  readonly endeLokal: string | null;
  readonly geraeteZeitBeginnLokal: string | null;
  readonly geraeteZeitEndeLokal: string | null;
  readonly abweichungBeginnSek: number | null;
  readonly abweichungEndeSek: number | null;
  readonly bruttoMinuten: number | null;
  readonly nettoMinuten: number | null;
  readonly pauseMinuten: number;
  readonly status: string;
  readonly objekt: string | null;
  readonly storniert: boolean;
  readonly ersetztDurchId: string | null;
}

/** Die Korrektur, die der Entscheidung gefolgt ist — oder eben keine. */
export interface EinwandKorrektur {
  readonly id: string;
  readonly art: string;
  readonly grundKategorie: string;
  readonly begruendung: string;
  readonly amLokal: string;
  readonly durchVon: string | null;
  readonly ersatzZeiteintragId: string | null;
}

export interface EinwandBlatt {
  readonly id: string;
  readonly anstellungId: string;
  readonly personId: string;
  readonly person: string;
  readonly art: EinwandArt;
  readonly status: EinwandStatus;
  /** Berliner Kalendertag `JJJJ-MM-TT` (K-11). */
  readonly betrifftDatum: string;
  readonly begruendung: string;
  /** Die ANGABE der Person, nie ein massgeblicher Zeitpunkt (Invariante 5). */
  readonly behauptetBeginnLokal: string | null;
  readonly behauptetEndeLokal: string | null;
  readonly behauptetPauseMinuten: number | null;
  readonly eingereichtLokal: string;
  readonly eingereichtVon: string | null;
  readonly entschiedenLokal: string | null;
  readonly entschiedenVon: string | null;
  readonly entscheidungBegruendung: string | null;
  readonly eintrag: EinwandEintrag | null;
  readonly korrektur: EinwandKorrektur | null;
  /**
   * Ist der angemeldete Mensch die betroffene Person?
   *
   * Dann darf er NICHT entscheiden (EMP-07), und die Seite zeigt statt des
   * Formulars den Grund — kein Knopf, der im Ausloeser endet.
   */
  readonly eigener: boolean;
}

/**
 * Ein Einwand — oder `null`, und das heisst nach aussen 404 und nie 403
 * (AUT-06).
 *
 * **Drei Rechte, nicht eines.** Das Routenmanifest tort `…/einwaende/[id]` auf
 * `zeit.einwand_entscheiden`. Die Policies fragen anderes: `zeit_einwand` ist
 * fuer `cse_app` nur mit `zeit.lesen` lesbar, `zeiteintrag` ebenso, und die
 * `zeiteintrag_korrektur` daneben mit `zeit.lesen`. Eine Sitzung, die das Tor
 * passiert und `zeit.lesen` nicht haelt, bekommt null Zeilen — von aussen ein
 * 404 ohne Grund. Die Seite verlangt `zeit.lesen` deshalb ausdruecklich mit.
 */
export async function leseEinwand(
  kontext: LeseKontext, id: string,
): Promise<EinwandBlatt | null> {
  const [z] = await kontext.abfrage<{
    id: string; anstellung_id: string; person_id: string; person: string;
    art: EinwandArt; status: EinwandStatus; betrifft_datum: string;
    begruendung: string;
    behauptet_beginn_lokal: string | null; behauptet_ende_lokal: string | null;
    behauptet_pause_minuten: number | null;
    eingereicht_lokal: string; eingereicht_von: string | null;
    entschieden_lokal: string | null; entschieden_von: string | null;
    entscheidung_begruendung: string | null;
    eigener: boolean;
    e_id: string | null; e_beginn_lokal: string | null; e_ende_lokal: string | null;
    e_geraete_beginn_lokal: string | null; e_geraete_ende_lokal: string | null;
    e_abweichung_beginn_sek: number | null; e_abweichung_ende_sek: number | null;
    e_brutto_minuten: number | null; e_netto_minuten: number | null;
    e_pause_minuten: number | null; e_status: string | null; e_objekt: string | null;
    e_storniert: boolean | null; e_ersetzt_durch_id: string | null;
    k_id: string | null; k_art: string | null; k_grund: string | null;
    k_begruendung: string | null; k_am_lokal: string | null; k_durch_von: string | null;
    k_ersatz_id: string | null;
  }>(
    `select ew.id, ew.anstellung_id, a.person_id,
            (p.vorname || ' ' || p.nachname) as person,
            ew.art::text as art, ew.status::text as status,
            to_char(ew.betrifft_datum, 'YYYY-MM-DD') as betrifft_datum,
            ew.begruendung,
            to_char((ew.behauptet_beginn at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as behauptet_beginn_lokal,
            to_char((ew.behauptet_ende   at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as behauptet_ende_lokal,
            ew.behauptet_pause_minuten,
            to_char((ew.eingereicht_am at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as eingereicht_lokal,
            eb.name as eingereicht_von,
            to_char((ew.entschieden_am at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as entschieden_lokal,
            db.name as entschieden_von,
            ew.entscheidung_begruendung,
            (a.person_id = app.aktuelle_person()) as eigener,
            ze.id as e_id,
            to_char((ze.beginn_zeitpunkt at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as e_beginn_lokal,
            to_char((ze.ende_zeitpunkt   at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as e_ende_lokal,
            to_char((ze.geraete_zeit_beginn at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as e_geraete_beginn_lokal,
            to_char((ze.geraete_zeit_ende   at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as e_geraete_ende_lokal,
            ze.zeitabweichung_beginn_sek as e_abweichung_beginn_sek,
            ze.zeitabweichung_ende_sek   as e_abweichung_ende_sek,
            ze.dauer_brutto_minuten      as e_brutto_minuten,
            ze.dauer_netto_minuten       as e_netto_minuten,
            ze.pause_minuten             as e_pause_minuten,
            ze.status::text              as e_status,
            zo.bezeichnung               as e_objekt,
            (ze.storniert_am is not null) as e_storniert,
            ze.ersetzt_durch_zeiteintrag_id as e_ersetzt_durch_id,
            kr.id as k_id, kr.art::text as k_art,
            kr.grund_kategorie::text as k_grund, kr.begruendung as k_begruendung,
            to_char((kr.durchgefuehrt_am at time zone 'Europe/Berlin'),
                    'DD.MM.YYYY HH24:MI') as k_am_lokal,
            kb.name as k_durch_von,
            kr.ersatz_zeiteintrag_id as k_ersatz_id
       from zeit_einwand ew
       join anstellung a on a.mandant_id = ew.mandant_id and a.id = ew.anstellung_id
       join person p on p.id = a.person_id
       left join benutzer eb on eb.id = ew.eingereicht_von_benutzer_id
       left join benutzer db on db.id = ew.entschieden_von
       left join zeiteintrag ze on ze.mandant_id = ew.mandant_id
                               and ze.id = ew.zeiteintrag_id
       left join objekt zo on zo.mandant_id = ze.mandant_id and zo.id = ze.objekt_id
       left join lateral (
              select k.* from zeiteintrag_korrektur k
               where k.zeit_einwand_id = ew.id
               order by k.durchgefuehrt_am desc
               limit 1
            ) kr on true
       left join benutzer kb on kb.id = kr.durchgefuehrt_von
      where ew.id = $1`,
    [id],
  );
  if (z === undefined) return null;

  return {
    id: z.id,
    anstellungId: z.anstellung_id,
    personId: z.person_id,
    person: z.person,
    art: z.art,
    status: z.status,
    betrifftDatum: z.betrifft_datum,
    begruendung: z.begruendung,
    behauptetBeginnLokal: z.behauptet_beginn_lokal,
    behauptetEndeLokal: z.behauptet_ende_lokal,
    behauptetPauseMinuten: z.behauptet_pause_minuten === null
      ? null : Number(z.behauptet_pause_minuten),
    eingereichtLokal: z.eingereicht_lokal,
    eingereichtVon: z.eingereicht_von,
    entschiedenLokal: z.entschieden_lokal,
    entschiedenVon: z.entschieden_von,
    entscheidungBegruendung: z.entscheidung_begruendung,
    eintrag: z.e_id === null ? null : {
      id: z.e_id,
      beginnLokal: z.e_beginn_lokal ?? '',
      endeLokal: z.e_ende_lokal,
      geraeteZeitBeginnLokal: z.e_geraete_beginn_lokal,
      geraeteZeitEndeLokal: z.e_geraete_ende_lokal,
      abweichungBeginnSek: z.e_abweichung_beginn_sek === null
        ? null : Number(z.e_abweichung_beginn_sek),
      abweichungEndeSek: z.e_abweichung_ende_sek === null
        ? null : Number(z.e_abweichung_ende_sek),
      bruttoMinuten: z.e_brutto_minuten === null ? null : Number(z.e_brutto_minuten),
      nettoMinuten: z.e_netto_minuten === null ? null : Number(z.e_netto_minuten),
      pauseMinuten: Number(z.e_pause_minuten ?? 0),
      status: z.e_status ?? '',
      objekt: z.e_objekt,
      storniert: z.e_storniert === true,
      ersetztDurchId: z.e_ersetzt_durch_id,
    },
    korrektur: z.k_id === null ? null : {
      id: z.k_id,
      art: z.k_art ?? '',
      grundKategorie: z.k_grund ?? '',
      begruendung: z.k_begruendung ?? '',
      amLokal: z.k_am_lokal ?? '',
      durchVon: z.k_durch_von,
      ersatzZeiteintragId: z.k_ersatz_id,
    },
    eigener: z.eigener === true,
  };
}
