/**
 * Die Schluesselverwaltung und ihr Journal (SEC-07, TIM-08, TIM-09, LEG-01).
 *
 * **Ein Schluessel kann nie an zwei Orten sein — und das ist ein INDEX, kein
 * Dienst** (0079, Abnahme 4). `sq_offene_ausgabe_uk` liegt auf der generierten
 * Spalte `offen_schluessel_id` und weist die zweite Uebergabe ohne Ruecknahme
 * ab, auch fuer einen Import, ein Skript oder einen kuenftigen Dienst, der
 * diesen hier nicht aufruft. Was dieser Dienst beitraegt, ist die UEBERSETZUNG
 * von `23505` in einen Satz, den ein Mensch liest — nicht eine zweite,
 * freundlichere Fassung derselben Regel.
 *
 * Ebenso liegen in der Datenbank: die Serverzeit (`quittiert_am`), die
 * Geraeteabweichung, der abgeleitete Zustand des Schluessels, die
 * Endgueltigkeit der Vernichtung und das Loeschverbot.
 *
 * Was dieser Dienst dazugibt:
 *
 *  - **Den unveraenderlichen Abzug.** `snapshot` und `snapshot_hash` schreibt
 *    kein Ausloeser: sie sind der Quittungstext, WIE ANGEZEIGT, und die
 *    Anzeige kennt nur die Anwendung. Gehasht wird mit dem EINEN Kanonisierer
 *    (`finanz/kanonisch.ts`, D-181) — eine zweite Fassung meldete beim ersten
 *    Umlaut einen Bruch, den es nicht gibt.
 *
 *  - **Die Serverzeit IM Abzug.** Sie kommt aus `now()` derselben Transaktion,
 *    also aus demselben Wert, den der Ausloeser gleich stempelt — `now()` ist
 *    in PostgreSQL die Transaktionszeit und aendert sich innerhalb der
 *    Transaktion nicht. Keine Prozessuhr, nirgends (Invariante 5).
 *
 *  - **Die Pruefung des Abzugs.** `pruefeQuittung` rechnet den Hash aus der
 *    gespeicherten Nutzlast neu. Eine Quittung, deren Abzug nachtraeglich
 *    veraendert waere, faellt damit auf — und nicht erst im Streitfall.
 *
 * **Wer quittiert, ist offen.** `schluessel.schreiben` ist an die Rolle
 * `mitarbeiter` gebunden und `0079` gibt der Tabelle die Einsatzdecke, aber
 * `04-SEITENKARTE.md` fuehrt die Quittungsseite nur unter `/portal/[mandant]`.
 * Gebaut ist deshalb der interne Weg (D-235).
 */
// TODO(client, O-240): Darf die Wache vor Ort einen Schluessel selbst quittieren, und auf welchem Bildschirm (SEC-07)?

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { kanonisiere, type KanonischerWert } from '../finanz/kanonisch.js';

/** Die acht Lebenszyklusereignisse (`schluessel_ereignis_art`, 0079 §1). */
export const SCHLUESSEL_EREIGNISSE = [
  'ausgabe', 'ruecknahme', 'verlustmeldung', 'wiedergefunden',
  'sperrung', 'entsperrung', 'vernichtung', 'inventur',
] as const;
export type SchluesselEreignis = (typeof SCHLUESSEL_EREIGNISSE)[number];

export const EREIGNIS_TEXT: Readonly<Record<SchluesselEreignis, string>> = {
  ausgabe: 'Ausgabe',
  ruecknahme: 'Rücknahme',
  verlustmeldung: 'Verlustmeldung',
  wiedergefunden: 'Wiedergefunden',
  sperrung: 'Sperrung',
  entsperrung: 'Entsperrung',
  vernichtung: 'Vernichtung',
  inventur: 'Inventur',
};

/** Die fuenf Zustaende (`schluessel_status`, 0079 §1). */
export const SCHLUESSEL_ZUSTAENDE = [
  'im_depot', 'ausgegeben', 'verloren', 'gesperrt', 'vernichtet',
] as const;
export type SchluesselZustand = (typeof SCHLUESSEL_ZUSTAENDE)[number];

export const ZUSTAND_TEXT: Readonly<Record<SchluesselZustand, string>> = {
  im_depot: 'Im Depot',
  ausgegeben: 'Ausgegeben',
  verloren: 'Verloren',
  gesperrt: 'Gesperrt',
  vernichtet: 'Vernichtet',
};

/** An wen ausgegeben wurde (`schluessel_empfaenger_art`, 0079 §1). */
export const EMPFAENGER_ARTEN = ['mitarbeiter', 'kunde', 'fremdfirma'] as const;
export type EmpfaengerArt = (typeof EMPFAENGER_ARTEN)[number];

export const EMPFAENGER_TEXT: Readonly<Record<EmpfaengerArt, string>> = {
  mitarbeiter: 'Mitarbeitende',
  kunde: 'Kunde',
  fremdfirma: 'Fremdfirma',
};

export function istEreignis(wert: unknown): wert is SchluesselEreignis {
  return typeof wert === 'string' && (SCHLUESSEL_EREIGNISSE as readonly string[]).includes(wert);
}

export function istEmpfaengerArt(wert: unknown): wert is EmpfaengerArt {
  return typeof wert === 'string' && (EMPFAENGER_ARTEN as readonly string[]).includes(wert);
}

/** Die Gestalt des Quittungsabzugs. Sie wird erhoeht, BEVOR sie sich aendert. */
export const QUITTUNG_SCHEMA = 'cse.schluesselquittung.v1' as const;

export class SchluesselEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'SchluesselEingabeFehlt';
  }
}

export class SchluesselNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    // 404 und nicht 403 — dass es den Schluessel anderswo gibt, ist selbst
    // eine Auskunft (AUT-06).
    super(`Den Schlüssel ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'SchluesselNichtGefunden';
  }
}

/**
 * Die Beschaeftigung gehoert nicht in diese Gesellschaft (D-09, review B8).
 *
 * 404 und nicht 403: eine Quittung haengt an der BESCHAEFTIGUNG, nicht am
 * Menschen — sie ist betrieblicher Nachweis EINER GmbH ueber EIN Objekt. Dass
 * es die Beschaeftigung anderswo gibt, ist selbst eine Auskunft (AUT-06).
 */
export class EmpfaengerNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor() {
    super(
      'Diese Beschäftigung gibt es in dieser Gesellschaft nicht. Eine '
      + 'Schlüsselquittung hängt an der Beschäftigung, nicht am Menschen — sie '
      + 'ist der Nachweis DIESER Gesellschaft über IHR Objekt.',
    );
    this.name = 'EmpfaengerNichtGefunden';
  }
}

/**
 * Abnahme 4, uebersetzt. Die Ablehnung selbst kommt aus dem Index.
 */
export class SchonAusgegeben extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor() {
    super(
      'Dieser Schlüssel ist bereits ausgegeben und nicht zurückgenommen. Ein '
      + 'Schlüssel kann nicht an zwei Orten sein — erst die Rücknahme schliesst '
      + 'die offene Übergabe, dann ist eine neue möglich.',
    );
    this.name = 'SchonAusgegeben';
  }
}

/**
 * Ein Verstoss GEGEN GENAU DIESEN eindeutigen Index — nicht irgendeiner.
 *
 * `23505` allein zu pruefen faenge auch `schluessel_nummer_uk` mit ein und
 * uebersetzte eine doppelte Schluesselnummer in „bereits ausgegeben".
 */
function istOffeneAusgabeVerstoss(fehler: unknown): boolean {
  if (typeof fehler !== 'object' || fehler === null) return false;
  const f = fehler as { code?: unknown; constraint_name?: unknown };
  return f.code === '23505' && f.constraint_name === 'sq_offene_ausgabe_uk';
}

// ---------------------------------------------------------------------------
// Der Gegenstand
// ---------------------------------------------------------------------------

export interface SchluesselEingabe {
  readonly objektId: string;
  readonly bezeichnung: string;
  readonly schluesselartId?: string | null;
  readonly schluesselNummer?: string | null;
  readonly schliessanlage?: string | null;
  readonly sicherungskarteNummer?: string | null;
}

/**
 * Einen Schluessel anlegen.
 *
 * `status` wird NICHT gesetzt: er ist aus dem Journal abgeleitet (§6.13), und
 * `s_status_abgeleitet` weist jede direkte Aenderung ab. Der Vorgabewert
 * `im_depot` ist damit keine Behauptung, sondern der Zustand eines Journals,
 * in dem noch nichts steht.
 */
export async function legeSchluesselAn(
  kontext: SchreibKontext, eingabe: SchluesselEingabe,
): Promise<string> {
  if (eingabe.bezeichnung.trim() === '') {
    throw new SchluesselEingabeFehlt('Ein Schlüssel braucht eine Bezeichnung.');
  }
  const id = randomUUID();
  await kontext.schreibe(
    `insert into schluessel
       (id, mandant_id, objekt_id, schluesselart_id, bezeichnung, schluessel_nummer,
        schliessanlage, sicherungskarte_nummer, erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, 'mensch', $9::uuid)`,
    [
      id, kontext.aktiverMandantId, eingabe.objektId,
      eingabe.schluesselartId ?? null,
      eingabe.bezeichnung.trim(),
      leer(eingabe.schluesselNummer),
      leer(eingabe.schliessanlage),
      leer(eingabe.sicherungskarteNummer),
      kontext.benutzerId,
    ],
  );
  return id;
}

function leer(wert: string | null | undefined): string | null {
  const t = (wert ?? '').trim();
  return t === '' ? null : t;
}

// ---------------------------------------------------------------------------
// Das Journal
// ---------------------------------------------------------------------------

export interface QuittungEingabe {
  readonly schluesselId: string;
  readonly art: SchluesselEreignis;
  /** Pflicht bei Ausgabe und Ruecknahme (§6.14) — sonst verboten. */
  readonly empfaengerArt?: EmpfaengerArt | null;
  readonly anstellungId?: string | null;
  readonly kundeId?: string | null;
  readonly firmaId?: string | null;
  /** Der Name, der auf der Quittung steht — unabhaengig von spaeteren Stammdaten. */
  readonly empfaengerName?: string | null;
  /** Die Unterschrift: heute ein NAME. Pflicht bei Ausgabe und Ruecknahme. */
  readonly unterzeichnerName?: string | null;
  readonly geplanteRueckgabe?: string | null;
  /** Nur bei `entsperrung`: welche Sperre wird aufgehoben (§6.14)? */
  readonly aufhebtQuittungId?: string | null;
  readonly bemerkung?: string | null;
  /** Die Uhr des Geraets als BEHAUPTUNG (TIM-08). Massgeblich ist sie nie. */
  readonly geraeteZeit?: string | null;
  /** Die Zeile lag offline in der Warteschlange (TIM-09). */
  readonly nachgetragen?: boolean;
}

interface QuittungKopf {
  readonly schluessel_id: string;
  readonly objekt_id: string;
  readonly bezeichnung: string;
  readonly schluessel_nummer: string | null;
  readonly schliessanlage: string | null;
  readonly art_bezeichnung: string | null;
  readonly objekt: string;
  readonly objektnummer: string;
  readonly anschrift: string;
  readonly mandant_name: string;
  /** Die SERVERZEIT dieser Transaktion — derselbe Wert, den der Ausloeser stempelt. */
  readonly server_utc: string;
  readonly server_lokal: string;
  readonly ausgeber: string | null;
}

const BEWEGUNGEN: readonly SchluesselEreignis[] = ['ausgabe', 'ruecknahme'];

function pruefeQuittungEingabe(eingabe: QuittungEingabe): void {
  const istBewegung = BEWEGUNGEN.includes(eingabe.art);
  if (istBewegung) {
    if (!istEmpfaengerArt(eingabe.empfaengerArt)) {
      throw new SchluesselEingabeFehlt(
        'Eine Übergabe oder Rücknahme nennt, an wen der Schlüssel geht: '
        + 'Mitarbeitende, Kunde oder Fremdfirma.',
      );
    }
    if (leer(eingabe.unterzeichnerName) === null) {
      // Dieselbe Regel wie `sq_unterzeichner` — hier mit einem Satz, der den
      // Grund nennt, statt mit einer Bedingungsverletzung.
      throw new SchluesselEingabeFehlt(
        'Eine Übergabe ohne Unterschrift ist keine Quittung. Wer quittiert?',
      );
    }
    const traeger = [
      eingabe.empfaengerArt === 'mitarbeiter' ? eingabe.anstellungId : null,
      eingabe.empfaengerArt === 'kunde' ? eingabe.kundeId : null,
      eingabe.empfaengerArt === 'fremdfirma' ? eingabe.firmaId : null,
    ].filter((x) => (x ?? '') !== '');
    if (traeger.length === 0) {
      throw new SchluesselEingabeFehlt(
        'Zu der gewählten Empfängerart fehlt der Empfänger selbst.',
      );
    }
  } else if (eingabe.empfaengerArt != null) {
    throw new SchluesselEingabeFehlt(
      'Einen Empfänger haben genau Ausgabe und Rücknahme — ein Verlust, eine '
      + 'Sperrung oder eine Inventur gehen an niemanden.',
    );
  }
  if (eingabe.art === 'entsperrung' && (eingabe.aufhebtQuittungId ?? '') === '') {
    throw new SchluesselEingabeFehlt(
      'Eine Entsperrung nennt die Sperrung, die sie aufhebt — sonst weiss '
      + 'niemand, welcher Zustand davor galt.',
    );
  }
}

/**
 * Eine Journalzeile schreiben — Ausgabe, Ruecknahme oder eines der sechs
 * uebrigen Ereignisse.
 *
 * Die Reihenfolge ist tragend: erst den Kopf UND die Serverzeit in EINER
 * Abfrage holen, dann den Abzug daraus bauen, dann schreiben. Wer die Zeit
 * nach dem Schreiben holte, schriebe einen Abzug, der eine andere Zeit nennt
 * als die Zeile.
 */
export async function buche(
  kontext: SchreibKontext, eingabe: QuittungEingabe,
): Promise<string> {
  pruefeQuittungEingabe(eingabe);

  const [kopf] = await kontext.abfrage<QuittungKopf>(
    `select s.id                                   as schluessel_id,
            s.objekt_id, s.bezeichnung, s.schluessel_nummer, s.schliessanlage,
            sa.bezeichnung                         as art_bezeichnung,
            o.bezeichnung                          as objekt,
            o.objektnummer,
            (o.strasse || ', ' || o.plz || ' ' || o.ort) as anschrift,
            m.name                                 as mandant_name,
            to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as server_utc,
            to_char(now() at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI:SS')
                                                   as server_lokal,
            (select b.name from benutzer b where b.id = app.aktueller_benutzer())
                                                   as ausgeber
       from schluessel s
       join objekt o on o.id = s.objekt_id and o.mandant_id = s.mandant_id
       join mandant m on m.id = s.mandant_id
       left join schluesselart sa
              on sa.id = s.schluesselart_id and sa.mandant_id = s.mandant_id
      where s.id = $1::uuid`,
    [eingabe.schluesselId],
  );
  if (kopf === undefined) throw new SchluesselNichtGefunden(eingabe.schluesselId);

  /**
   * **Der Mensch hinter der Beschaeftigung wird HIER aufgeloest, nicht in der
   * Einfuegung.**
   *
   * Vorher stand dort eine Unterabfrage `(select a.person_id from anstellung a
   * where a.id = $n)`. Sie ist der Zeilenpolitik von `anstellung` unterworfen
   * und liefert NULL, sobald die Beschaeftigung einer anderen Gesellschaft
   * gehoert — die Zeile scheiterte dann an `sq_person_bei_anstellung`, also an
   * einer Bedingung, die mit dem Fehler nichts zu tun zu haben scheint. Jetzt
   * faellt die Antwort dort, wo die Frage gestellt wurde: die Beschaeftigung
   * gibt es in dieser Gesellschaft nicht (D-09).
   */
  let personId: string | null = null;
  if (eingabe.empfaengerArt === 'mitarbeiter' && (eingabe.anstellungId ?? '') !== '') {
    const [a] = await kontext.abfrage<{ person_id: string }>(
      `select a.person_id from anstellung a where a.id = $1::uuid`,
      [eingabe.anstellungId],
    );
    if (a === undefined) throw new EmpfaengerNichtGefunden();
    personId = a.person_id;
  }

  const empfaengerName = leer(eingabe.empfaengerName);
  const abzug = baueAbzug(kopf, eingabe, empfaengerName);
  const hash = createHash('sha256').update(kanonisiere(abzug)).digest('hex');

  const id = randomUUID();
  try {
    await kontext.schreibe(
      `insert into schluessel_quittung
         (id, mandant_id, schluessel_id, objekt_id, art, aufhebt_quittung_id,
          empfaenger_art, anstellung_id, person_id, kunde_id, firma_id,
          empfaenger_name, geraete_zeit, nachgetragen, ausgegeben_von_benutzer_id,
          geplante_rueckgabe, unterzeichner_name, snapshot, snapshot_hash,
          bemerkung, erstellt_von_art, erstellt_von)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::schluessel_ereignis_art,
               $6::uuid, $7::schluessel_empfaenger_art, $8::uuid, $20::uuid,
               $9::uuid, $10::uuid, $11, $12::timestamptz, $13::boolean, $14::uuid,
               $15::date, $16, $17::text::jsonb, $18, $19, 'mensch', $14::uuid)`,
      [
        id, kontext.aktiverMandantId, eingabe.schluesselId, kopf.objekt_id,
        eingabe.art,
        eingabe.aufhebtQuittungId ?? null,
        eingabe.empfaengerArt ?? null,
        eingabe.empfaengerArt === 'mitarbeiter' ? (eingabe.anstellungId ?? null) : null,
        eingabe.empfaengerArt === 'kunde' ? (eingabe.kundeId ?? null) : null,
        eingabe.empfaengerArt === 'fremdfirma' ? (eingabe.firmaId ?? null) : null,
        empfaengerName,
        eingabe.geraeteZeit ?? null,
        eingabe.nachgetragen === true,
        kontext.benutzerId,
        leer(eingabe.geplanteRueckgabe),
        leer(eingabe.unterzeichnerName),
        JSON.stringify(abzug),
        hash,
        leer(eingabe.bemerkung),
        personId,
      ],
    );
  } catch (fehler) {
    if (istOffeneAusgabeVerstoss(fehler)) throw new SchonAusgegeben();
    throw fehler;
  }
  return id;
}

/**
 * Der Abzug — Schluessel, Objekt, Empfaenger, Zeitpunkt, wie angezeigt (§6.14).
 *
 * Er traegt NUR Zeichenketten, `null` und Wahrheitswerte: die Nutzlast muss
 * die Rundreise durch `jsonb` byte-genau ueberstehen, damit `pruefeQuittung`
 * den Hash nachrechnen kann. Eine Zahl waere dieselbe Falle wie beim
 * Rechnungshash (§5.3).
 */
function baueAbzug(
  kopf: QuittungKopf, eingabe: QuittungEingabe, empfaengerName: string | null,
): KanonischerWert {
  return {
    schema: QUITTUNG_SCHEMA,
    art: eingabe.art,
    gesellschaft: kopf.mandant_name,
    objekt: {
      id: kopf.objekt_id,
      nummer: kopf.objektnummer,
      bezeichnung: kopf.objekt,
      anschrift: kopf.anschrift,
    },
    schluessel: {
      id: kopf.schluessel_id,
      bezeichnung: kopf.bezeichnung,
      nummer: kopf.schluessel_nummer,
      schliessanlage: kopf.schliessanlage,
      art: kopf.art_bezeichnung,
    },
    empfaenger: {
      art: eingabe.empfaengerArt ?? null,
      name: empfaengerName,
      anstellung_id: eingabe.empfaengerArt === 'mitarbeiter'
        ? (eingabe.anstellungId ?? null) : null,
      kunde_id: eingabe.empfaengerArt === 'kunde' ? (eingabe.kundeId ?? null) : null,
      firma_id: eingabe.empfaengerArt === 'fremdfirma' ? (eingabe.firmaId ?? null) : null,
    },
    uebergeben_von: kopf.ausgeber,
    unterzeichner: leer(eingabe.unterzeichnerName),
    // DIE SERVERZEIT, beide Male (Invariante 5, Invariante 2).
    quittiert_am_utc: kopf.server_utc,
    quittiert_lokal: kopf.server_lokal,
    geplante_rueckgabe: leer(eingabe.geplanteRueckgabe),
    nachgetragen: eingabe.nachgetragen === true,
    bemerkung: leer(eingabe.bemerkung),
  };
}

/** Die Uebergabe (Abnahme 3) — eine Journalzeile der Art `ausgabe`. */
export async function uebergib(
  kontext: SchreibKontext,
  eingabe: Omit<QuittungEingabe, 'art'>,
): Promise<string> {
  return buche(kontext, { ...eingabe, art: 'ausgabe' });
}

/**
 * Die Ruecknahme (Abnahme 3) — sie SCHLIESST die offene Ausgabe.
 *
 * Den Abschlussverweis setzt `kern.refresh_schluessel_status` (0079 §6), und
 * zwar NACH dem Einfuegen: die schliessende Zeile muss existieren, bevor
 * jemand auf sie zeigen kann. Beide Zustaende bleiben damit protokolliert —
 * die Ausgabe verschwindet nicht, sie bekommt ein Ende.
 */
export async function nimmZurueck(
  kontext: SchreibKontext,
  eingabe: Omit<QuittungEingabe, 'art'>,
): Promise<string> {
  return buche(kontext, { ...eingabe, art: 'ruecknahme' });
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

export interface SchluesselZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly nummer: string | null;
  readonly schliessanlage: string | null;
  readonly sicherungskarteNummer: string | null;
  readonly artBezeichnung: string | null;
  readonly objektId: string;
  readonly objekt: string;
  readonly status: SchluesselZustand;
  readonly besitzer: string | null;
  /** Berliner Ortszeit, fertig aus der Datenbank (Invariante 2). */
  readonly letzteBewegungLokal: string | null;
  readonly geplanteRueckgabe: string | null;
  readonly ueberfaellig: boolean;
  readonly archiviert: boolean;
}

interface SchluesselRoh {
  readonly id: string;
  readonly bezeichnung: string;
  readonly nummer: string | null;
  readonly schliessanlage: string | null;
  readonly sicherungskarte_nummer: string | null;
  readonly art_bezeichnung: string | null;
  readonly objekt_id: string;
  readonly objekt: string;
  readonly status: SchluesselZustand;
  readonly besitzer: string | null;
  readonly letzte_bewegung_lokal: string | null;
  readonly geplante_rueckgabe: string | null;
  readonly ueberfaellig: boolean;
  readonly archiviert: boolean;
}

/**
 * `ueberfaellig` kommt aus der DATENBANK und nicht aus einem Vergleich im
 * Node-Prozess: zwischen Mitternacht und 02:00 Berliner Zeit ist der UTC-Tag
 * der gestrige, und ein Schluessel, der heute faellig ist, saehe dann noch
 * puenktlich aus (K-11, Invariante 5).
 */
const SCHLUESSEL_FELDER = `
  s.id, s.bezeichnung, s.schluessel_nummer as nummer, s.schliessanlage,
  s.sicherungskarte_nummer,
  sa.bezeichnung                          as art_bezeichnung,
  s.objekt_id, o.bezeichnung              as objekt,
  s.status::text                          as status,
  s.aktueller_besitzer_text               as besitzer,
  to_char(q.quittiert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                          as letzte_bewegung_lokal,
  to_char(offen.geplante_rueckgabe, 'YYYY-MM-DD') as geplante_rueckgabe,
  (offen.geplante_rueckgabe is not null
   and offen.geplante_rueckgabe < (now() at time zone 'Europe/Berlin')::date)
                                          as ueberfaellig,
  (s.archiviert_am is not null)           as archiviert
  from schluessel s
  join objekt o on o.id = s.objekt_id and o.mandant_id = s.mandant_id
  left join schluesselart sa on sa.id = s.schluesselart_id and sa.mandant_id = s.mandant_id
  left join schluessel_quittung q on q.id = s.letzte_quittung_id and q.mandant_id = s.mandant_id
  left join schluessel_quittung offen
         on offen.offen_schluessel_id = s.id`;

function ausSchluessel(z: SchluesselRoh): SchluesselZeile {
  return {
    id: z.id,
    bezeichnung: z.bezeichnung,
    nummer: z.nummer,
    schliessanlage: z.schliessanlage,
    sicherungskarteNummer: z.sicherungskarte_nummer,
    artBezeichnung: z.art_bezeichnung,
    objektId: z.objekt_id,
    objekt: z.objekt,
    status: z.status,
    besitzer: z.besitzer,
    letzteBewegungLokal: z.letzte_bewegung_lokal,
    geplanteRueckgabe: z.geplante_rueckgabe,
    ueberfaellig: z.ueberfaellig,
    archiviert: z.archiviert,
  };
}

export interface SchluesselFilter {
  readonly objektId?: string | null;
  readonly status?: SchluesselZustand | null;
}

export async function leseSchluessel(
  kontext: LeseKontext, filter: SchluesselFilter = {},
): Promise<readonly SchluesselZeile[]> {
  const zeilen = await kontext.abfrage<SchluesselRoh>(
    `select ${SCHLUESSEL_FELDER}
      where ($1::uuid is null or s.objekt_id = $1::uuid)
        and ($2::text is null or s.status::text = $2::text)
      order by s.archiviert_am nulls first, o.bezeichnung, s.bezeichnung`,
    [filter.objektId ?? null, filter.status ?? null],
  );
  return zeilen.map(ausSchluessel);
}

export async function findeSchluessel(
  kontext: LeseKontext, id: string,
): Promise<SchluesselZeile | null> {
  const [z] = await kontext.abfrage<SchluesselRoh>(
    `select ${SCHLUESSEL_FELDER} where s.id = $1::uuid`, [id],
  );
  return z === undefined ? null : ausSchluessel(z);
}

/** Eine Journalzeile, wie die Historie sie zeigt. */
export interface QuittungZeile {
  readonly id: string;
  readonly art: SchluesselEreignis;
  readonly quittiertLokal: string;
  readonly empfaengerArt: EmpfaengerArt | null;
  readonly empfaengerName: string | null;
  readonly unterzeichnerName: string | null;
  readonly uebergebenVon: string | null;
  readonly geplanteRueckgabe: string | null;
  readonly zeitabweichungSek: number | null;
  readonly nachgetragen: boolean;
  readonly bemerkung: string | null;
  readonly snapshotHash: string;
  /** Bei einer Ausgabe: welche Zeile sie geschlossen hat — oder `null`. */
  readonly geschlossenDurchId: string | null;
  readonly geschlossenLokal: string | null;
  /** Wahr, solange die Ausgabe offen ist (die Spalte von Abnahme 4). */
  readonly offen: boolean;
  /** Ob die Unterschrift als BILD hinterlegt ist — heute nie (DOC-06). */
  readonly signaturHinterlegt: boolean;
}

export async function leseQuittungen(
  kontext: LeseKontext, schluesselId: string,
): Promise<readonly QuittungZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; art: SchluesselEreignis; quittiert_lokal: string;
    empfaenger_art: string | null; empfaenger_name: string | null;
    unterzeichner_name: string | null; uebergeben_von: string | null;
    geplante_rueckgabe: string | null; zeitabweichung_sek: number | null;
    nachgetragen: boolean; bemerkung: string | null; snapshot_hash: string;
    geschlossen_durch_id: string | null; geschlossen_lokal: string | null;
    offen: boolean; signatur_hinterlegt: boolean;
  }>(
    `select q.id, q.art::text as art,
            to_char(q.quittiert_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI')            as quittiert_lokal,
            q.empfaenger_art::text                   as empfaenger_art,
            q.empfaenger_name, q.unterzeichner_name,
            b.name                                   as uebergeben_von,
            to_char(q.geplante_rueckgabe, 'YYYY-MM-DD') as geplante_rueckgabe,
            q.zeitabweichung_sek, q.nachgetragen, q.bemerkung, q.snapshot_hash,
            q.geschlossen_durch_quittung_id          as geschlossen_durch_id,
            to_char(g.quittiert_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI')            as geschlossen_lokal,
            (q.offen_schluessel_id is not null)      as offen,
            (q.signatur_medien_id is not null)       as signatur_hinterlegt
       from schluessel_quittung q
       left join benutzer b on b.id = q.ausgegeben_von_benutzer_id
       left join schluessel_quittung g
              on g.id = q.geschlossen_durch_quittung_id and g.mandant_id = q.mandant_id
      where q.schluessel_id = $1::uuid
      order by q.quittiert_am desc, q.id desc`,
    [schluesselId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    art: z.art,
    quittiertLokal: z.quittiert_lokal,
    empfaengerArt: istEmpfaengerArt(z.empfaenger_art) ? z.empfaenger_art : null,
    empfaengerName: z.empfaenger_name,
    unterzeichnerName: z.unterzeichner_name,
    uebergebenVon: z.uebergeben_von,
    geplanteRueckgabe: z.geplante_rueckgabe,
    zeitabweichungSek: z.zeitabweichung_sek === null ? null : Number(z.zeitabweichung_sek),
    nachgetragen: z.nachgetragen,
    bemerkung: z.bemerkung,
    snapshotHash: z.snapshot_hash,
    geschlossenDurchId: z.geschlossen_durch_id,
    geschlossenLokal: z.geschlossen_lokal,
    offen: z.offen,
    signaturHinterlegt: z.signatur_hinterlegt,
  }));
}

/** Was die Abzugspruefung ueber ein Journal sagt. */
export interface Abzugsbefund {
  readonly geprueft: number;
  readonly intakt: boolean;
  readonly brueche: readonly { readonly quittungId: string; readonly lokal: string }[];
}

/**
 * Rechnet den Abzugshash jeder Quittung eines Schluessels neu (LEG-01).
 *
 * Sie liest die gespeicherte Nutzlast, kanonisiert sie mit DEMSELBEN
 * Kanonisierer, der sie erzeugt hat, und vergleicht. Eine zweite Fassung des
 * Kanonisierers meldete beim ersten Unterschied im Umgang mit Sonderzeichen
 * einen Bruch, den es nicht gibt — deshalb gibt es genau einen (D-181).
 */
export async function pruefeQuittungen(
  kontext: LeseKontext, schluesselId: string,
): Promise<Abzugsbefund> {
  const zeilen = await kontext.abfrage<{
    id: string; lokal: string; snapshot: unknown; snapshot_hash: string;
  }>(
    `select q.id,
            to_char(q.quittiert_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as lokal,
            q.snapshot, q.snapshot_hash
       from schluessel_quittung q
      where q.schluessel_id = $1::uuid
      order by q.quittiert_am, q.id`,
    [schluesselId],
  );
  const brueche = zeilen
    .filter((z) => {
      const neu = createHash('sha256')
        .update(kanonisiere(z.snapshot as KanonischerWert)).digest('hex');
      return neu !== z.snapshot_hash;
    })
    .map((z) => ({ quittungId: z.id, lokal: z.lokal }));
  return { geprueft: zeilen.length, intakt: brueche.length === 0, brueche };
}
