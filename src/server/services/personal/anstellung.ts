/**
 * Die Beschaeftigung — Vertragseckdaten, Konditionen, Beendigung
 * (D-09, EMP-04, EMP-14, K-05, K-14, Invariante 1, Invariante 8).
 *
 * **Drei Routen, ein Dienst.** `/anstellungen/[id]/vertrag`,
 * `…/entgelt` und `…/beenden` fragen dieselbe Zeile und schreiben in dieselbe
 * Tabelle. Dreimal dieselbe Abfrage in drei Seiten waere dreimal die Chance,
 * die Mandantenbedingung oder `geloescht_am` zu vergessen.
 *
 * **Was dieser Dienst NICHT tut: den Stundensatz lesen.**
 * `anstellung.stundensatz_intern` und `anstellung.tarifgruppe` sind `cse_app`
 * als SELECT entzogen (K-05), ebenso
 * `anstellung_kondition.stundensatz_intern_cent`. Der eine Weg dorthin ist
 * `app.entgelt_lesen` — mit eigenem Recht und einer Auditzeile je Zugriff. Ein
 * `select stundensatz_intern` in einer dieser Funktionen scheitert mit
 * „permission denied for table anstellung", und das ist die gewuenschte
 * Antwort: es gibt keinen zweiten Lesepfad.
 *
 * **Und er schreibt den Spiegel nicht.** `arbeitszeitmodell`,
 * `wochenstunden`, `arbeitstage_woche`, `stundensatz_intern`, `tarifgruppe`
 * und `kostenstelle` sind ein Spiegel der datierten `anstellung_kondition` mit
 * genau EINEM Schreiber (`kern.anstellung_kondition_spiegeln`, 0192); `cse_app`
 * hat auf ihnen kein UPDATE (0191). Wer den Satz aendern will, legt eine
 * KONDITION an — sonst bewertet eine Lohnerhoehung stillschweigend jede
 * vergangene Kalkulation neu (01-KERN §6.14).
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { cent, type Cent } from '../finanz/geld.js';

export type AnstellungStatus = 'geplant' | 'aktiv' | 'ruhend' | 'beendet';

export interface AnstellungZeile {
  readonly id: string;
  readonly mandantId: string;
  readonly personId: string;
  readonly personName: string;
  readonly personalnummer: string;
  /** `JJJJ-MM-TT` — ein Kalendertag, kein Zeitpunkt (§5.12.1, Invariante 2). */
  readonly eintritt: string;
  readonly austritt: string | null;
  readonly austrittGrund: string | null;
  readonly status: AnstellungStatus;
  /** Spiegel der heute gueltigen Kondition — nur lesend (§6.14). */
  readonly arbeitszeitmodell: string | null;
  readonly wochenstunden: string | null;
  readonly arbeitstageWoche: string | null;
  readonly kostenstelle: string | null;
}

export interface KonditionZeile {
  readonly id: string;
  readonly giltAb: string;
  readonly giltBis: string | null;
  readonly arbeitszeitmodell: string;
  readonly wochenstunden: string | null;
  readonly arbeitstageWoche: string | null;
  readonly kostenstelle: string | null;
  readonly grund: string | null;
  readonly erstelltAm: Date;
}

export class AnstellungNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Beschäftigung ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'AnstellungNichtGefunden';
  }
}

export class PersonalnummerVergeben extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 409;
  constructor(nummer: string) {
    super(
      `Die Personalnummer „${nummer}" ist in dieser Gesellschaft schon vergeben. `
      + 'Jede Gesellschaft führt ihre eigene Systematik (D-09) — dieselbe Nummer '
      + 'in der Schwestergesellschaft wäre in Ordnung, hier nicht.',
    );
    this.name = 'PersonalnummerVergeben';
  }
}

export class VertragEingabeFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'VertragEingabeFehler';
  }
}

export class BeendigungFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'BeendigungFehler';
  }
}

/**
 * Das Recht auf Entgeltdaten fehlt — und das ist etwas anderes als „kein Satz
 * hinterlegt".
 *
 * `app.entgelt_lesen` wirft `42501`, statt `null` zu liefern, damit die
 * Oberflaeche den Unterschied aussprechen kann. Diese Klasse traegt ihn nach
 * oben, ohne dass eine Seite einen Postgres-Fehlercode auswerten muss.
 */
export class KeinEntgeltRecht extends Error {
  readonly code = 'kein_recht';
  readonly status = 404;
  constructor() {
    super(
      'Kein Recht auf Entgeltdaten in dieser Gesellschaft '
      + '(`personal.entgelt_lesen`, K-05).',
    );
    this.name = 'KeinEntgeltRecht';
  }
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

const ZEILE = `
  select a.id, a.mandant_id, a.person_id,
         (p.vorname || ' ' || p.nachname)     as person_name,
         a.personalnummer,
         to_char(a.eintritt, 'YYYY-MM-DD')    as eintritt,
         to_char(a.austritt, 'YYYY-MM-DD')    as austritt,
         a.austritt_grund,
         a.status::text                       as status,
         a.arbeitszeitmodell,
         a.wochenstunden::text                as wochenstunden,
         a.arbeitstage_woche::text            as arbeitstage_woche,
         a.kostenstelle
    from anstellung a
    join person p on p.id = a.person_id`;

interface RohZeile {
  readonly id: string; readonly mandant_id: string; readonly person_id: string;
  readonly person_name: string; readonly personalnummer: string;
  readonly eintritt: string; readonly austritt: string | null;
  readonly austritt_grund: string | null; readonly status: AnstellungStatus;
  readonly arbeitszeitmodell: string | null; readonly wochenstunden: string | null;
  readonly arbeitstage_woche: string | null; readonly kostenstelle: string | null;
}

function zeile(z: RohZeile): AnstellungZeile {
  return {
    id: z.id,
    mandantId: z.mandant_id,
    personId: z.person_id,
    personName: z.person_name,
    personalnummer: z.personalnummer,
    eintritt: z.eintritt,
    austritt: z.austritt,
    austrittGrund: z.austritt_grund,
    status: z.status,
    arbeitszeitmodell: z.arbeitszeitmodell,
    wochenstunden: z.wochenstunden,
    arbeitstageWoche: z.arbeitstage_woche,
    kostenstelle: z.kostenstelle,
  };
}

export async function findeAnstellung(
  kontext: LeseKontext, id: string,
): Promise<AnstellungZeile | null> {
  const [z] = await kontext.abfrage<RohZeile>(
    `${ZEILE} where a.id = $1::uuid and a.geloescht_am is null`, [id]);
  return z === undefined ? null : zeile(z);
}

// ---------------------------------------------------------------------------
// Vertragseckdaten
// ---------------------------------------------------------------------------

export interface VertragEingabe {
  readonly anstellungId: string;
  readonly personalnummer: string;
  /** `JJJJ-MM-TT`. */
  readonly eintritt: string;
}

/**
 * Aendert Personalnummer und Eintritt — und NUR die.
 *
 * **Warum nicht auch Arbeitszeitmodell und Wochenstunden.** Beide sind nach
 * §6.14 ein abgeleiteter Spiegel der datierten `anstellung_kondition`, und
 * 05-API-KARTE fuehrt sie unter `…/konditionen` mit dem strengeren Recht
 * `personal.entgelt_schreiben`. Zwei Schreibflaechen ueber einer Spalte, mit
 * zwei verschiedenen Rechten, sind genau der Defekt, den §5.12.1 bei Zugang
 * und Nachweisen beschreibt: der schwaechere Weg gewinnt, und niemand merkt
 * es. Der Grant sagt dasselbe — `cse_app` hat auf diesen Spalten kein UPDATE.
 *
 * **Und warum nicht `austritt`.** Der gehoert `/beenden`: eine Spalte, ein
 * Schreiber. Ein Austrittsdatum, das hier nebenbei gesetzt wird, entzieht
 * nach K-14 den Portalzugang — ohne Grund, ohne Warnung, ohne den Blick auf
 * die offenen Folgen.
 */
export async function aendereVertrag(
  kontext: SchreibKontext, eingabe: VertragEingabe,
): Promise<AnstellungZeile> {
  const nummer = eingabe.personalnummer.trim();
  if (nummer === '') {
    throw new VertragEingabeFehler(
      'Die Personalnummer ist Pflicht — sie ist der Schlüssel, unter dem diese '
      + 'Gesellschaft die Beschäftigung führt.');
  }
  if (!DATUM.test(eingabe.eintritt)) {
    throw new VertragEingabeFehler('Der Eintritt erwartet einen Kalendertag als JJJJ-MM-TT.');
  }

  const vorher = await findeAnstellung(kontext, eingabe.anstellungId);
  if (vorher === null) throw new AnstellungNichtGefunden(eingabe.anstellungId);
  if (vorher.austritt !== null && eingabe.eintritt > vorher.austritt) {
    throw new VertragEingabeFehler(
      `Der Eintritt läge nach dem Austritt (${vorher.austritt}). Erst das `
      + 'Austrittsdatum korrigieren, dann den Eintritt.');
  }

  /*
   * Die Kollision wird als SATZ beantwortet und nicht als 23505. `unique
   * (mandant_id, personalnummer)` ist die Wahrheit; diese Vorabfrage ist die
   * Hoeflichkeit. Sie ersetzt die Wache nicht — zwei gleichzeitige
   * Schreibvorgaenge laufen weiter in den Constraint, und das ist richtig.
   */
  const [kollision] = await kontext.abfrage<{ id: string }>(
    `select id from anstellung
      where mandant_id = $1::uuid and personalnummer = $2 and id <> $3::uuid`,
    [kontext.aktiverMandantId, nummer, eingabe.anstellungId],
  );
  if (kollision !== undefined) throw new PersonalnummerVergeben(nummer);

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update anstellung
        set personalnummer = $2, eintritt = $3::date,
            geaendert_am = now(), geaendert_von = $4::uuid
      where id = $1::uuid and geloescht_am is null
      returning id`,
    [eingabe.anstellungId, nummer, eingabe.eintritt, kontext.benutzerId],
  );
  if (zeilen.length === 0) throw new AnstellungNichtGefunden(eingabe.anstellungId);

  const gelesen = await findeAnstellung(kontext, eingabe.anstellungId);
  if (gelesen === null) throw new AnstellungNichtGefunden(eingabe.anstellungId);
  return gelesen;
}

// ---------------------------------------------------------------------------
// Beenden
// ---------------------------------------------------------------------------

/**
 * Was ein Austritt offen laesst.
 *
 * **`null` heisst „nicht pruefbar" und nicht „nichts offen".** Jeder Posten
 * haengt an einem ANDEREN Recht als `personal.anstellung_beenden`: Einsaetze
 * an `dienstplan.lesen`, Konten an `zeit.konto_lesen`, Antraege an
 * `zeit.abwesenheit_lesen`, Quittungen an `schluessel.lesen`. Ohne das Recht
 * liefert die Datenbank null Zeilen — und „0 offene Einsätze" ist die
 * gefaehrlichste Antwort, die eine Seite vor einer folgenschweren
 * Bestaetigung geben kann.
 */
export interface Beendigungsfolgen {
  readonly einsaetzeNachAustritt: number | null;
  readonly offeneStundenkonten: number | null;
  /** `numeric(12,3)` als Text — Resturlaub der offenen Jahre. */
  readonly urlaubsrestTage: string | null;
  readonly urlaubskontoPruefbar: boolean;
  readonly offeneAntraege: number | null;
  readonly offeneSchluessel: number | null;
}

export async function beendigungsfolgen(
  kontext: LeseKontext, anstellungId: string, austritt: string,
): Promise<Beendigungsfolgen> {
  if (!DATUM.test(austritt)) {
    throw new VertragEingabeFehler('Der Austritt erwartet einen Kalendertag als JJJJ-MM-TT.');
  }
  const [rechte] = await kontext.abfrage<{
    dienstplan: boolean; konto: boolean; abwesenheit: boolean; schluessel: boolean;
  }>(
    `select app.hat_recht('dienstplan.lesen', app.aktiver_mandant())      as dienstplan,
            app.hat_recht('zeit.konto_lesen', app.aktiver_mandant())      as konto,
            app.hat_recht('zeit.abwesenheit_lesen', app.aktiver_mandant()) as abwesenheit,
            app.hat_recht('schluessel.lesen', app.aktiver_mandant())      as schluessel`,
  );

  const zahl = async (sql: string, werte: readonly unknown[]): Promise<number> => {
    const [z] = await kontext.abfrage<{ n: string }>(sql, werte);
    return Number(z?.n ?? '0');
  };

  /*
   * **Die Tagesgrenze steht in Berlin, nicht in UTC.**
   *
   * `$2::date + interval '1 day'` ergibt einen `timestamp without time zone`;
   * im Vergleich mit der `timestamptz`-Spalte legt Postgres die SITZUNGSzone
   * darunter, und die ist UTC. Die Grenze laege damit im Sommer zwei und im
   * Winter eine Stunde zu spaet — und was herausfiele, waere genau die
   * Nachtschicht (Invariante 2, Guard 5b in scripts/guards/run-all.ts). Die
   * Seite meldete „0 Einsätze nach dem Austritt" vor einer Bestaetigung, die
   * sich nicht zuruecknehmen laesst.
   *
   * `::timestamp at time zone 'Europe/Berlin'` macht aus dem Kalendertag den
   * Instant seiner Berliner Mitternacht — daher `>=` und nicht `>`.
   *
   * **`abgesagt` und `ersetzt` binden niemanden mehr.** Sie hier mitzuzaehlen
   * hiesse, in einer sauberen Lage Alarm zu schlagen; eine Warnung, die immer
   * steht, wird nicht mehr gelesen. Dasselbe Praedikat wie in
   * `dienstplan/einteilung.ts` — zwei Stellen duerfen nicht zwei Zahlen nennen.
   */
  const einsaetze = rechte?.dienstplan === true
    ? await zahl(
      `select count(*)::text as n from einsatz_zuordnung
        where anstellung_id = $1::uuid and entfernt_am is null
          and status not in ('abgesagt','ersetzt')
          and beginn_zeitpunkt >= (($2::date + 1)::timestamp at time zone 'Europe/Berlin')`,
      [anstellungId, austritt])
    : null;

  const konten = rechte?.konto === true
    ? await zahl(
      `select count(*)::text as n from stundenkonto
        where anstellung_id = $1::uuid and status <> 'gesperrt'`,
      [anstellungId])
    : null;

  const urlaub = rechte?.konto === true
    ? (await kontext.abfrage<{ rest: string | null }>(
      `select coalesce(sum(rest_tage), 0)::text as rest from urlaubskonto
        where anstellung_id = $1::uuid and abgeschlossen_am is null`,
      [anstellungId]))[0]?.rest ?? '0'
    : null;

  const antraege = rechte?.abwesenheit === true
    ? await zahl(
      `select count(*)::text as n from antrag
        where anstellung_id = $1::uuid and status in ('eingereicht','in_pruefung')`,
      [anstellungId])
    : null;

  const schluessel = rechte?.schluessel === true
    ? await zahl(
      `select count(*)::text as n from schluessel_quittung
        where anstellung_id = $1::uuid and art = 'ausgabe'
          and geschlossen_durch_quittung_id is null`,
      [anstellungId])
    : null;

  return {
    einsaetzeNachAustritt: einsaetze,
    offeneStundenkonten: konten,
    urlaubsrestTage: urlaub,
    urlaubskontoPruefbar: rechte?.konto === true,
    offeneAntraege: antraege,
    offeneSchluessel: schluessel,
  };
}

export interface BeendenEingabe {
  readonly anstellungId: string;
  /** `JJJJ-MM-TT`. */
  readonly austritt: string;
  readonly grund: string;
}

/**
 * Beendet eine Beschaeftigung — mit Datum, mit Grund, ohne Loeschung.
 *
 * **Der Status folgt dem KALENDER, nicht dem Klick.** Liegt der Austritt in
 * der Zukunft, bleibt `status` stehen; `app.anstellung_status_nachziehen`
 * (0191) setzt `beendet`, sobald der Tag da ist. Sofort zu beenden hiesse, den
 * Portalzugang eines Menschen zu entziehen, der morgen noch arbeitet — denn
 * am Statuswechsel haengt der K-14-Entzug der abgeleiteten Mitgliedschaft.
 *
 * **Nie ein DELETE** (Invariante 8): Zeit- und Rechnungsdaten haengen an
 * dieser Zeile, und „wer war wann beschaeftigt" ist im Streit die Tatsache
 * selbst.
 */
export async function beendeAnstellung(
  kontext: SchreibKontext, eingabe: BeendenEingabe,
): Promise<AnstellungZeile> {
  if (!DATUM.test(eingabe.austritt)) {
    throw new VertragEingabeFehler('Der Austritt erwartet einen Kalendertag als JJJJ-MM-TT.');
  }
  const grund = eingabe.grund.trim();
  if (grund === '') {
    throw new VertragEingabeFehler(
      'Eine Beendigung ohne Begründung ist kein Vorgang, sondern ein Klick. Der '
      + 'Grund steht später in der Personalakte und in jeder Rückfrage.');
  }

  const vorher = await findeAnstellung(kontext, eingabe.anstellungId);
  if (vorher === null) throw new AnstellungNichtGefunden(eingabe.anstellungId);
  if (vorher.status === 'beendet') {
    throw new BeendigungFehler(
      `Diese Beschäftigung ist bereits beendet (Austritt ${vorher.austritt ?? '—'}). `
      + 'Eine Beendigung wird nicht überschrieben.');
  }
  if (eingabe.austritt < vorher.eintritt) {
    throw new BeendigungFehler(
      `Der Austritt läge vor dem Eintritt (${vorher.eintritt}).`);
  }

  /*
   * **Der Austritt ist der LETZTE Arbeitstag, nicht der erste danach.** Der
   * Status wechselt deshalb erst, wenn der Tag VORBEI ist — mit `<=` waere
   * eine am letzten Arbeitstag eingetragene Beendigung sofort wirksam und
   * naehme dem Menschen den Portalzugang, mit dem er an diesem Tag noch
   * eincheckt (K-14). `app.anstellung_status_nachziehen` (0191) verwendet
   * dieselbe Grenze; zwei verschiedene waeren der Grund, warum der Status je
   * nach Weg um einen Tag abweicht.
   */
  const [heute] = await kontext.abfrage<{ tag: string }>(
    `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as tag`);
  const sofort = eingabe.austritt < (heute?.tag ?? eingabe.austritt);

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update anstellung
        set austritt = $2::date, austritt_grund = $3,
            status = case when $4 then 'beendet' else status end,
            geaendert_am = now(), geaendert_von = $5::uuid
      where id = $1::uuid and geloescht_am is null and status <> 'beendet'
      returning id`,
    [eingabe.anstellungId, eingabe.austritt, grund, sofort, kontext.benutzerId],
  );
  if (zeilen.length === 0) throw new AnstellungNichtGefunden(eingabe.anstellungId);

  /*
   * Die Auditzeile traegt den Grund ZUSAETZLICH zur Spalte. Die Spalte sagt
   * „warum ist diese Beschaeftigung beendet", das Protokoll sagt „wer hat das
   * wann eingetragen" — zwei Fragen, und im Streit zaehlt die zweite.
   */
  await kontext.schreibe(
    `select app.protokolliere('personal.anstellung_beendet', 'anstellung', $1,
                              null, jsonb_build_object(
                                'austritt', $2::date,
                                'grund', $3::text,
                                'status_sofort', $4::boolean))`,
    [eingabe.anstellungId, eingabe.austritt, grund, sofort],
  );

  const gelesen = await findeAnstellung(kontext, eingabe.anstellungId);
  if (gelesen === null) throw new AnstellungNichtGefunden(eingabe.anstellungId);
  return gelesen;
}

// ---------------------------------------------------------------------------
// Entgelt und Konditionen
// ---------------------------------------------------------------------------

/**
 * Der interne Stundensatz am Stichtag — in CENT.
 *
 * `null` heisst „fuer diesen Tag ist kein Satz hinterlegt". Fehlt das Recht,
 * wirft `app.entgelt_lesen` mit `42501`; das wird hier zu
 * `KeinEntgeltRecht` — die Seite soll „kein Recht" sagen koennen und nicht
 * ein leeres Feld zeigen (AUT-06 gilt nach aussen, nicht gegenueber der
 * eigenen Sitzung).
 */
export async function leseEntgelt(
  kontext: LeseKontext, anstellungId: string, stichtag?: string,
): Promise<Cent | null> {
  if (stichtag !== undefined && !DATUM.test(stichtag)) {
    throw new VertragEingabeFehler('Der Stichtag erwartet einen Kalendertag als JJJJ-MM-TT.');
  }
  try {
    const [z] = await kontext.abfrage<{ satz: string | null }>(
      `select app.entgelt_lesen($1::uuid, $2::date)::text as satz`,
      [anstellungId, stichtag ?? null],
    );
    const roh = z?.satz ?? null;
    return roh === null ? null : cent(BigInt(roh));
  } catch (fehler) {
    if ((fehler as { code?: string }).code === '42501') throw new KeinEntgeltRecht();
    throw fehler;
  }
}

/**
 * Die Konditionshistorie — OHNE Satz und Tarifgruppe.
 *
 * Die beiden Spalten sind `cse_app` entzogen; sie hier „zur Anzeige"
 * mitzulesen ist nicht moeglich, und das ist der Sinn. Die Seite holt den Satz
 * je Zeile einzeln ueber `leseEntgelt(…, giltAb)` — mit Recht und mit Spur.
 */
export async function leseKonditionen(
  kontext: LeseKontext, anstellungId: string,
): Promise<readonly KonditionZeile[]> {
  const roh = await kontext.abfrage<{
    id: string; gilt_ab: string; gilt_bis: string | null; arbeitszeitmodell: string;
    wochenstunden: string | null; arbeitstage_woche: string | null;
    kostenstelle: string | null; grund: string | null; erstellt_am: Date;
  }>(
    `select k.id,
            to_char(k.gilt_ab, 'YYYY-MM-DD')  as gilt_ab,
            to_char(k.gilt_bis, 'YYYY-MM-DD') as gilt_bis,
            k.arbeitszeitmodell,
            k.wochenstunden::text     as wochenstunden,
            k.arbeitstage_woche::text as arbeitstage_woche,
            k.kostenstelle, k.grund, k.erstellt_am
       from anstellung_kondition k
      where k.anstellung_id = $1::uuid
      order by k.gilt_ab desc`,
    [anstellungId],
  );
  return roh.map((z) => ({
    id: z.id,
    giltAb: z.gilt_ab,
    giltBis: z.gilt_bis,
    arbeitszeitmodell: z.arbeitszeitmodell,
    wochenstunden: z.wochenstunden,
    arbeitstageWoche: z.arbeitstage_woche,
    kostenstelle: z.kostenstelle,
    grund: z.grund,
    erstelltAm: z.erstellt_am,
  }));
}

export interface KonditionEingabe {
  readonly anstellungId: string;
  /** `JJJJ-MM-TT` — der Vertragsbeginn dieser Kondition, nie „heute". */
  readonly giltAb: string;
  /** Ganze Cent (Invariante 1) — `null` heisst „kein Satz hinterlegt". */
  readonly stundensatzCent: Cent | null;
  readonly arbeitszeitmodell?: string;
  readonly wochenstunden?: string | null;
  readonly arbeitstageWoche?: string | null;
  readonly tarifgruppe?: string | null;
  readonly kostenstelle?: string | null;
  readonly grund?: string | null;
}

/**
 * Legt eine datierte Kondition an — und schliesst die offene davor.
 *
 * **Das Schliessen ist Mechanik und keine Regel.** `ak_kein_ueberlapp`
 * verbietet zwei gleichzeitig gueltige Konditionen; ohne das Schliessen
 * scheiterte jede zweite Eintragung an einem GIST-Fehler, den niemand liest.
 * Der Tag davor und nicht derselbe Tag: zwei Konditionen mit demselben
 * Gueltigkeitsbeginn waeren wieder die Frage, welche gilt.
 */
export async function setzeKondition(
  kontext: SchreibKontext, eingabe: KonditionEingabe,
): Promise<void> {
  if (!DATUM.test(eingabe.giltAb)) {
    throw new VertragEingabeFehler('„Gilt ab" erwartet einen Kalendertag als JJJJ-MM-TT.');
  }
  if (eingabe.stundensatzCent !== null && eingabe.stundensatzCent < 0n) {
    throw new VertragEingabeFehler('Ein negativer Stundensatz ist kein Kostensatz.');
  }

  const vorher = await findeAnstellung(kontext, eingabe.anstellungId);
  if (vorher === null) throw new AnstellungNichtGefunden(eingabe.anstellungId);
  if (eingabe.giltAb < vorher.eintritt) {
    throw new VertragEingabeFehler(
      `Eine Kondition kann nicht vor dem Eintritt (${vorher.eintritt}) gelten.`);
  }

  /*
   * **Erst die GESCHLOSSENEN Perioden, dann die offene.**
   *
   * `ak_kein_ueberlapp` ist eine GIST-Ausschlussbedingung ueber
   * `daterange(gilt_ab, gilt_bis, '[]')`. Das Schliessen der offenen Kondition
   * (unten) faengt nur den Regelfall „die naechste Kondition ab morgen". Wird
   * eine Kondition RUECKWIRKEND nachgetragen und faellt ihr `gilt_ab` in eine
   * bereits geschlossene Periode, lief der Insert in den rohen
   * Datenbankfehler: „conflicting key value violates exclusion constraint
   * ak_kein_ueberlapp". Die Personalnummernkollision beantwortet dieser Dienst
   * ausdruecklich mit einem Satz statt mit `23505`; hier fehlte dieselbe
   * Hoeflichkeit. Der Satz nennt den Zeitraum, der im Weg steht — sonst weiss
   * niemand, welche Zeile zu schliessen waere.
   */
  const [kollision] = await kontext.abfrage<{ gilt_ab: string; gilt_bis: string | null }>(
    `select to_char(gilt_ab, 'YYYY-MM-DD')  as gilt_ab,
            to_char(gilt_bis, 'YYYY-MM-DD') as gilt_bis
       from anstellung_kondition
      where anstellung_id = $1::uuid
        and gilt_bis is not null
        and daterange(gilt_ab, gilt_bis, '[]') @> $2::date
      order by gilt_ab
      limit 1`,
    [eingabe.anstellungId, eingabe.giltAb],
  );
  if (kollision !== undefined) {
    throw new VertragEingabeFehler(
      `Für den ${eingabe.giltAb} gilt bereits die Kondition vom `
      + `${kollision.gilt_ab} bis ${kollision.gilt_bis ?? 'offen'}. Zwei `
      + 'gleichzeitig gültige Sätze wären die Frage, welcher gilt. Eine '
      + 'rückwirkende Korrektur schliesst zuerst die betroffene Periode — sie '
      + 'wird nicht überschrieben und nicht gelöscht (Invariante 8).');
  }

  const [offen] = await kontext.abfrage<{ id: string; gilt_ab: string }>(
    `select id, to_char(gilt_ab, 'YYYY-MM-DD') as gilt_ab
       from anstellung_kondition
      where anstellung_id = $1::uuid and gilt_bis is null`,
    [eingabe.anstellungId],
  );
  if (offen !== undefined) {
    if (eingabe.giltAb <= offen.gilt_ab) {
      throw new VertragEingabeFehler(
        `Die laufende Kondition gilt ab ${offen.gilt_ab}. Eine neue Kondition muss `
        + 'später beginnen — zwei gleichzeitig gültige Sätze wären die Frage, '
        + 'welcher gilt, und jede Abfrage beantwortete sie anders.');
    }
    await kontext.schreibe(
      `update anstellung_kondition set gilt_bis = ($2::date - 1)
        where id = $1::uuid`,
      [offen.id, eingabe.giltAb],
    );
  }

  await kontext.schreibe(
    `insert into anstellung_kondition
       (mandant_id, anstellung_id, gilt_ab, arbeitszeitmodell, wochenstunden,
        arbeitstage_woche, stundensatz_intern_cent, tarifgruppe, kostenstelle,
        grund, erstellt_von)
     values ($1::uuid, $2::uuid, $3::date, coalesce($4, 'unbekannt'), $5::numeric,
             $6::numeric, $7::bigint, $8, $9, $10, $11::uuid)`,
    [
      kontext.aktiverMandantId, eingabe.anstellungId, eingabe.giltAb,
      eingabe.arbeitszeitmodell ?? null,
      eingabe.wochenstunden ?? null, eingabe.arbeitstageWoche ?? null,
      eingabe.stundensatzCent === null ? null : String(eingabe.stundensatzCent),
      eingabe.tarifgruppe ?? null, eingabe.kostenstelle ?? null,
      eingabe.grund ?? null, kontext.benutzerId,
    ],
  );
}
