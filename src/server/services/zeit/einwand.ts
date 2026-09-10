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

export type EinwandArt =
  'eintrag_fehlt' | 'zeit_falsch' | 'pause_falsch' | 'zuordnung_falsch' | 'sonstiges';

export type EinwandStatus =
  | 'offen' | 'in_pruefung'
  | 'anerkannt' | 'teilweise_anerkannt' | 'abgelehnt' | 'zurueckgezogen';

/** Die Zustaende, die einen Vorgang abschliessen. */
export const ENTSCHIEDEN: readonly EinwandStatus[] = [
  'anerkannt', 'teilweise_anerkannt', 'abgelehnt', 'zurueckgezogen',
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
 * Der Einwand wird eingereicht.
 *
 * Kein Rechteschluessel: EMP-07 fuehrt das Einreichen als Selbstzugriff (`S`)
 * und nicht als Modulrecht. Die Wache ist die Policy
 * `t_selbst_einreichen` — sie trifft nur Zeilen, deren Anstellung dem
 * angemeldeten Menschen gehoert, und sie ist die einzige Schreiboperation,
 * die ein Mitarbeitender in dieser Domaene besitzt.
 */
export async function reicheEinwandEin(
  kontext: SchreibKontext, eingabe: EinwandEingabe,
): Promise<string> {
  const bezug = eingabe.zeiteintragId ?? null;
  if (bezug === null && eingabe.art !== 'eintrag_fehlt') throw new EinwandOhneBezugFehler();

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
