/**
 * Die versionierte Dienstanweisung und ihre Kenntnisnahme (SEC-06, EMP-09,
 * EMP-12, DOC-05, LEG-04).
 *
 * **Die harten Zusagen stehen in `0078`, nicht hier.** Die Fassungsnummer
 * unter Kopfsperre, der Inhalts-Hash, die Serverzeit der Bestaetigung, die
 * Kopie des Fassungs-Hashes, die Unveraenderlichkeit veroeffentlichter
 * Fassungen und das Loeschverbot sind Ausloeser und Bedingungen. Dieser Dienst
 * schickt sie nicht einmal mit — was er nicht sendet, kann er auch nicht falsch
 * senden.
 *
 * Was er dazugibt, ist das, was eine Datenbank schlecht kann:
 *
 *  - **Er macht aus „veroeffentlichen" EINEN Vorgang.** Kopf und erste Fassung
 *    entstehen in derselben Transaktion (`da_aktive_version_fk` ist
 *    `deferrable initially deferred`, genau dafuer), und die Veroeffentlichung
 *    ist ein Feld, kein zweiter Aufruf, den jemand vergisst.
 *
 *  - **Er leitet „veraltet" beim LESEN ab.** Fassung 3 zu veroeffentlichen
 *    aendert keine einzige alte Kenntnisnahme — sie zeigt weiter auf Fassung 2,
 *    und dass sie nicht mehr genuegt, ist der Vergleich mit
 *    `dienstanweisung.aktive_version_id`. Ein Lauf, der alte Zeilen
 *    „veraltet" stempelte, aenderte Beweiszeilen, und „was hat Fatima am
 *    3. Maerz bestaetigt" waere danach nicht mehr beantwortbar.
 *
 *  - **Er loest den Urheber serverseitig auf.** Wer bestaetigt, steht in der
 *    Sitzung — nie in der Anfrage. Eine `anstellung_id` aus dem Formular waere
 *    eine Unterschrift, die jemand einem Kollegen unterschiebt.
 *
 * **`neue_version_oeffnet_pflicht` steuert genau diese Ableitung** (§6.7,
 * O-153) und keinen Ausloeser: bei `true` — der ausgelieferten strengen
 * Lesart — zaehlt nur die Bestaetigung der AKTIVEN Fassung; bei `false` zaehlt
 * die Bestaetigung irgendeiner veroeffentlichten Fassung weiter.
 *
 * **Was dieser Dienst NICHT tut: sperren.** SEC-06 verlangt die Kenntnisnahme
 * und nennt keine Folge, wenn sie ausbleibt — anders als SEC-04, wo ein
 * abgelaufener Nachweis die Einteilung hart sperrt. Eine Sperre hier waere
 * eine erfundene Rechtsfolge (K-17), eine Frist ebenso.
 */
// TODO(client, O-241): Sperrt eine unbestaetigte Dienstanweisung die Einteilung, und ab wann gilt die Unterweisung als versaeumt (SEC-06, EMP-09)?

import { randomUUID } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

/** Der Aufzaehlungstyp `kenntnisnahme_art` (0078 §1). */
export const KENNTNISNAHME_ARTEN = [
  'portal_klick', 'canvas_signatur', 'papier_erfassung',
] as const;
export type KenntnisnahmeArt = (typeof KENNTNISNAHME_ARTEN)[number];

/** Der Aufzaehlungstyp `dienstanweisung_status` (0078 §1). */
export const DA_STATUS = ['entwurf', 'veroeffentlicht', 'archiviert'] as const;
export type DaStatus = (typeof DA_STATUS)[number];

export const STATUS_TEXT: Readonly<Record<DaStatus, string>> = {
  entwurf: 'Entwurf',
  veroeffentlicht: 'Veröffentlicht',
  archiviert: 'Archiviert',
};

/** Die vier Sprachen aus EMP-12 — der Aufzaehlungstyp `sprache`. */
export const DA_SPRACHEN = ['de', 'en', 'ar', 'tr'] as const;
export type DaSprache = (typeof DA_SPRACHEN)[number];

export function istDaSprache(wert: unknown): wert is DaSprache {
  return typeof wert === 'string' && (DA_SPRACHEN as readonly string[]).includes(wert);
}

export class DienstanweisungEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'DienstanweisungEingabeFehlt';
  }
}

export class AnweisungNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    // 404 und nicht 403: dass es die Anweisung anderswo gibt, ist selbst eine
    // Auskunft (AUT-06).
    super(`Die Dienstanweisung ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'AnweisungNichtGefunden';
  }
}

export class FassungNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Die Fassung ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'FassungNichtGefunden';
  }
}

export class FassungSchonVeroeffentlicht extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor() {
    super(
      'Diese Fassung ist bereits veröffentlicht. Eine Änderung ist eine NEUE '
      + 'Fassung — sie bekommt die nächste Nummer und verlangt eine neue '
      + 'Bestätigung.',
    );
    this.name = 'FassungSchonVeroeffentlicht';
  }
}

export class SchonBestaetigt extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor() {
    super(
      'Diese Fassung ist bereits bestätigt. Eine zweite Bestätigung derselben '
      + 'Fassung wäre kein zweiter Vorgang, sondern ein zweiter Eintrag über '
      + 'denselben.',
    );
    this.name = 'SchonBestaetigt';
  }
}

export class KeinUrheber extends Error {
  readonly code = 'kein_urheber';
  readonly status = 422;
  constructor() {
    super(
      'Eine Kenntnisnahme hängt an einer Beschäftigung in dieser Gesellschaft '
      + '(§10.5, D-09) — dieses Konto hat hier keine. Bestätigen kann nur, wer '
      + 'angestellt ist.',
    );
    this.name = 'KeinUrheber';
  }
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------

export interface FassungEingabe {
  /** Der Text der Anweisung. Ohne ihn braucht es ein Dokument (§6.8). */
  readonly inhalt?: string | null;
  readonly dokumentId?: string | null;
  /** Uebersetzungen, `de` · `en` · `ar` · `tr` (EMP-12). */
  readonly inhaltI18n?: Readonly<Partial<Record<DaSprache, string>>> | null;
  /** Berliner Kalendertag, `YYYY-MM-DD`. */
  readonly gueltigAb: string;
  readonly aenderungshinweis?: string | null;
  /** Sofort freigeben? Sonst entsteht ein Entwurf, den niemand bestätigt. */
  readonly veroeffentlichen?: boolean;
}

export interface AnweisungEingabe extends FassungEingabe {
  readonly titel: string;
  readonly objektId?: string | null;
  readonly postenId?: string | null;
  readonly kenntnisnahmePflicht?: boolean;
}

export interface AngelegteAnweisung {
  readonly anweisungId: string;
  readonly versionId: string;
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

function pruefeFassung(eingabe: FassungEingabe): void {
  const hatText = (eingabe.inhalt ?? '').trim() !== '';
  const hatDokument = (eingabe.dokumentId ?? '') !== '';
  if (!hatText && !hatDokument) {
    // Dieselbe Regel wie `da_version_hat_inhalt` — hier mit einem Satz, der
    // sagt, was fehlt, statt mit einer Bedingungsverletzung.
    throw new DienstanweisungEingabeFehlt(
      'Eine Fassung ohne Text und ohne Dokument ist keine. Was soll die Wache lesen?',
    );
  }
  if (!DATUM.test(eingabe.gueltigAb)) {
    throw new DienstanweisungEingabeFehlt(
      'Eine Fassung braucht einen Tag, ab dem sie gilt (JJJJ-MM-TT).',
    );
  }
}

/**
 * Die Sprachfassungen als jsonb — und zwar als `$n::text::jsonb`.
 *
 * `JSON.stringify(obj)` in einem blossen `$n::jsonb` legt eine JSON-
 * ZEICHENKETTE in die Spalte (`jsonb_typeof` = `string`); jeder spaetere
 * `->>`-Zugriff liefert danach NULL, und zwar ohne Fehler. Der Doppelcast
 * macht aus dem Text wieder ein Objekt.
 */
function i18nText(
  werte: Readonly<Partial<Record<DaSprache, string>>> | null | undefined,
): string | null {
  if (werte === null || werte === undefined) return null;
  const gefuellt = Object.entries(werte)
    .filter(([s, t]) => istDaSprache(s) && typeof t === 'string' && t.trim() !== '');
  if (gefuellt.length === 0) return null;
  return JSON.stringify(Object.fromEntries(gefuellt));
}

/**
 * Kopf und erste Fassung — in EINER Transaktion.
 *
 * Die `id`s entstehen in der Anwendung und nicht ueber `returning`: `insert …
 * returning` zieht die SELECT-Policy der Tabelle mit hinein, und ein Weg, der
 * beim Zurueckgeben scheitert, sieht aus wie ein Rechtefehler an einer Stelle,
 * an der es um Schreiben ging. Dieselbe Bauart wie im Wachbuch.
 */
export async function legeAnweisungAn(
  kontext: SchreibKontext, eingabe: AnweisungEingabe,
): Promise<AngelegteAnweisung> {
  if (eingabe.titel.trim() === '') {
    throw new DienstanweisungEingabeFehlt('Eine Dienstanweisung braucht einen Titel.');
  }
  pruefeFassung(eingabe);

  const anweisungId = randomUUID();
  const versionId = randomUUID();

  await kontext.schreibe(
    `insert into dienstanweisung
       (id, mandant_id, objekt_id, posten_id, titel, kenntnisnahme_pflicht,
        erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::boolean, 'mensch', $7::uuid)`,
    [
      anweisungId, kontext.aktiverMandantId,
      eingabe.objektId ?? null, eingabe.postenId ?? null,
      eingabe.titel.trim(), eingabe.kenntnisnahmePflicht !== false,
      kontext.benutzerId,
    ],
  );

  await schreibeFassung(kontext, anweisungId, versionId, eingabe);
  return { anweisungId, versionId };
}

/** Eine weitere Fassung an einem bestehenden Kopf (§6.8, DOC-05). */
export async function neueFassung(
  kontext: SchreibKontext, anweisungId: string, eingabe: FassungEingabe,
): Promise<string> {
  pruefeFassung(eingabe);

  const [kopf] = await kontext.abfrage<{ id: string }>(
    `select id from dienstanweisung where id = $1::uuid`, [anweisungId],
  );
  if (kopf === undefined) throw new AnweisungNichtGefunden(anweisungId);

  const versionId = randomUUID();
  await schreibeFassung(kontext, anweisungId, versionId, eingabe);
  return versionId;
}

/**
 * Die eigentliche Einfuegung.
 *
 * **`version` und `inhalt_hash` werden NICHT mitgeschickt.** Der Ausloeser
 * `a_da_version_vorbereiten` zieht die Nummer unter einer Sperre auf dem Kopf
 * und rechnet den Hash; ein mitgeschickter Hash waere eine Pruefsumme, die der
 * Geprueftere selbst bestimmt.
 *
 * **`veroeffentlicht_am` wird als `now()` gesetzt und vom Ausloeser mit der
 * Serverzeit ueberschrieben** — der Wert im `values` ist nur das Signal
 * „jetzt freigeben", nicht die Behauptung eines Zeitpunkts (§1.11,
 * Invariante 5).
 */
async function schreibeFassung(
  kontext: SchreibKontext, anweisungId: string, versionId: string, eingabe: FassungEingabe,
): Promise<void> {
  const inhalt = (eingabe.inhalt ?? '').trim();
  await kontext.schreibe(
    `insert into dienstanweisung_version
       (id, mandant_id, dienstanweisung_id, inhalt, inhalt_i18n, dokument_id,
        aenderungshinweis, gueltig_ab, veroeffentlicht_am, veroeffentlicht_von,
        erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5::text::jsonb, $6::uuid,
             $7, $8::date,
             case when $9::boolean then now() else null end,
             case when $9::boolean then $10::uuid else null end,
             'mensch', $10::uuid)`,
    [
      versionId, kontext.aktiverMandantId, anweisungId,
      inhalt === '' ? null : inhalt,
      i18nText(eingabe.inhaltI18n),
      eingabe.dokumentId ?? null,
      (eingabe.aenderungshinweis ?? '').trim() === ''
        ? null : (eingabe.aenderungshinweis ?? '').trim(),
      eingabe.gueltigAb,
      eingabe.veroeffentlichen === true,
      kontext.benutzerId,
    ],
  );
}

/**
 * Eine Entwurfsfassung freigeben (Abnahme 1).
 *
 * Der Dienst setzt genau ein Feld. Alles Weitere — Kopf fortschreiben, Status
 * auf `veroeffentlicht`, Pflichtpopulation vervollstaendigen — tut
 * `kern.oeffne_kenntnisnahme_pflicht` (0078 §8), und zwar auch fuer einen
 * Import, der diesen Dienst nicht kennt.
 */
export async function veroeffentlicheFassung(
  kontext: SchreibKontext, versionId: string,
): Promise<void> {
  const [fassung] = await kontext.abfrage<{ veroeffentlicht: boolean }>(
    `select (veroeffentlicht_am is not null) as veroeffentlicht
       from dienstanweisung_version where id = $1::uuid`,
    [versionId],
  );
  if (fassung === undefined) throw new FassungNichtGefunden(versionId);
  if (fassung.veroeffentlicht) throw new FassungSchonVeroeffentlicht();

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update dienstanweisung_version
        set veroeffentlicht_am = now(), veroeffentlicht_von = $2::uuid
      where id = $1::uuid and veroeffentlicht_am is null
      returning id`,
    [versionId, kontext.benutzerId],
  );
  // Null Zeilen heisst: zwischen Lesen und Schreiben hat jemand anderes
  // freigegeben. Werfen, statt Erfolg zu melden.
  if (zeilen.length === 0) throw new FassungSchonVeroeffentlicht();
}

// ---------------------------------------------------------------------------
// Die Kenntnisnahme (EMP-09)
// ---------------------------------------------------------------------------

export interface KenntnisnahmeEingabe {
  /** Die FASSUNG, nicht der Kopf — das ist der ganze Punkt (§6.10). */
  readonly versionId: string;
  readonly art?: KenntnisnahmeArt;
  /** Die Uhr des Geraets als BEHAUPTUNG (TIM-08). Massgeblich ist sie nie. */
  readonly geraeteZeit?: string | null;
  /** In welcher Sprache der Text auf dem Bildschirm stand (EMP-12). */
  readonly sprache?: DaSprache | null;
}

interface UrheberZeile {
  readonly anstellung_id: string;
  readonly person_id: string;
}

/**
 * Wer bestaetigt — aus der SITZUNG, nie aus der Anfrage.
 *
 * Mehrere aktive Beschaeftigungen im selben Mandanten sind nicht vorgesehen;
 * gaebe es sie, gewinnt die aelteste — eine willkuerliche, aber STABILE Wahl.
 * Eine zufaellige waere die schlechtere: derselbe Mensch stuende dann mal
 * unter der einen, mal unter der anderen Nummer im Nachweis.
 */
async function urheber(kontext: SchreibKontext): Promise<UrheberZeile> {
  const [zeile] = await kontext.abfrage<UrheberZeile>(
    `select a.id as anstellung_id, a.person_id
       from anstellung a
      where a.person_id = app.aktuelle_person()
        and a.mandant_id = app.aktiver_mandant()
        and a.geloescht_am is null
        and a.status = 'aktiv'
      order by a.eintritt, a.id
      limit 1`,
  );
  if (zeile === undefined) throw new KeinUrheber();
  return zeile;
}

/**
 * Eine Fassung bestaetigen — der EINE Tipp aus EMP-09.
 *
 * **`bestaetigter_inhalt_hash` steht nicht im `insert`.** Die Spalte ist
 * `not null`, und das ist kein Hindernis: PostgreSQL prueft NOT NULL und CHECK
 * NACH den BEFORE-Ausloesern, und `kern.da_kenntnisnahme_vorbereiten` setzt
 * den Hash aus der Fassung. Ein mitgeschickter Wert waere die Antwort des
 * Bestaetigenden auf die Frage, was er bestaetigt hat.
 *
 * Dasselbe gilt fuer `bestaetigt_am` (Serverzeit), `zeitabweichung_sek`
 * (abgeleitet) und `da_pflicht_id` (vom Ausloeser aufgeloest).
 *
 * **Der Doppeltipp wird hier freundlich abgefangen und in der Datenbank
 * hart**: `da_kenntnis_uk` ist der Traeger, dieser Zweig nur die Meldung.
 */
export async function bestaetigeKenntnisnahme(
  kontext: SchreibKontext, eingabe: KenntnisnahmeEingabe,
): Promise<string> {
  const wer = await urheber(kontext);

  const [schon] = await kontext.abfrage<{ id: string }>(
    `select id from da_kenntnisnahme
      where dienstanweisung_version_id = $1::uuid and anstellung_id = $2::uuid`,
    [eingabe.versionId, wer.anstellung_id],
  );
  if (schon !== undefined) throw new SchonBestaetigt();

  const id = randomUUID();
  await kontext.schreibe(
    `insert into da_kenntnisnahme
       (id, mandant_id, dienstanweisung_version_id, anstellung_id, person_id,
        art, geraete_zeit, sprache, erstellt_von_art, erstellt_von,
        erstellt_von_person_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6::kenntnisnahme_art, $7::timestamptz, $8::sprache, 'mensch',
             $9::uuid, $5::uuid)`,
    [
      id, kontext.aktiverMandantId, eingabe.versionId,
      wer.anstellung_id, wer.person_id,
      eingabe.art ?? 'portal_klick',
      eingabe.geraeteZeit ?? null,
      eingabe.sprache ?? null,
      kontext.benutzerId,
    ],
  );
  return id;
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/** Eine Anweisung, wie die Liste sie zeigt. */
export interface AnweisungZeile {
  readonly id: string;
  readonly titel: string;
  readonly status: DaStatus;
  readonly objektId: string | null;
  readonly objekt: string | null;
  readonly postenId: string | null;
  readonly posten: string | null;
  readonly kenntnisnahmePflicht: boolean;
  readonly neueVersionOeffnetPflicht: boolean;
  readonly aktiveVersionId: string | null;
  readonly aktiveVersion: number | null;
  readonly aktivGueltigAb: string | null;
  readonly fassungen: number;
  /** Wie viele lebende Pflichten es gibt und wie viele davon erfüllt sind. */
  readonly pflichtig: number;
  readonly bestaetigt: number;
  readonly archiviert: boolean;
}

interface AnweisungRoh {
  readonly id: string;
  readonly titel: string;
  readonly status: DaStatus;
  readonly objekt_id: string | null;
  readonly objekt: string | null;
  readonly posten_id: string | null;
  readonly posten: string | null;
  readonly kenntnisnahme_pflicht: boolean;
  readonly neue_version_oeffnet_pflicht: boolean;
  readonly aktive_version_id: string | null;
  readonly aktive_version: number | null;
  readonly aktiv_gueltig_ab: string | null;
  readonly fassungen: string;
  readonly pflichtig: string;
  readonly bestaetigt: string;
  readonly archiviert: boolean;
}

/**
 * Die Zaehlung „wer fehlt noch" — gegen eine ECHTE Population.
 *
 * `da_pflicht` ist eine Tabelle und kein Anti-Join gegen den Dienstplan
 * (§6.9): eine neu eingestellte Wache, die einem Objekt zugeordnet, aber noch
 * nicht verplant ist, taucht damit als offen auf statt gar nicht.
 *
 * Die Bedingung, wann eine Bestaetigung noch zaehlt, steht hier EINMAL und
 * wird von Liste, Einzelansicht und Kenntnisstand benutzt: entweder sie zeigt
 * auf die aktive Fassung, oder der Kopf verlangt bei neuen Fassungen keine
 * neue Bestaetigung (O-153).
 *
 * **`k.id is not null` steht vorn und ist nicht ueberfluessig.** Ohne diese
 * Haelfte waere der Ausdruck fuer einen Kopf mit
 * `neue_version_oeffnet_pflicht = false` auch dann wahr, wenn es gar KEINE
 * Bestaetigung gibt — der zweite Zweig haengt an keiner Zeile. Die Liste
 * meldete dann „alle bestaetigt" fuer eine Anweisung, die niemand gelesen hat.
 */
const ZAEHLT_NOCH = `
  (k.id is not null
   and (k.dienstanweisung_version_id = d.aktive_version_id
        or not d.neue_version_oeffnet_pflicht))`;

const ANWEISUNG_FELDER = `
  d.id, d.titel, d.status::text as status,
  d.objekt_id, o.bezeichnung as objekt,
  d.posten_id, pn.bezeichnung as posten,
  d.kenntnisnahme_pflicht, d.neue_version_oeffnet_pflicht,
  d.aktive_version_id,
  av.version                              as aktive_version,
  to_char(av.gueltig_ab, 'YYYY-MM-DD')    as aktiv_gueltig_ab,
  (d.archiviert_am is not null)           as archiviert,
  (select count(*) from dienstanweisung_version v
    where v.dienstanweisung_id = d.id)    as fassungen,
  (select count(*) from da_pflicht p
    where p.dienstanweisung_id = d.id and p.entfallen_am is null) as pflichtig,
  (select count(*) from da_pflicht p
     where p.dienstanweisung_id = d.id and p.entfallen_am is null
       and exists (select 1 from da_kenntnisnahme k
                    where k.anstellung_id = p.anstellung_id
                      and ${ZAEHLT_NOCH}
                      and k.dienstanweisung_version_id in
                          (select v.id from dienstanweisung_version v
                            where v.dienstanweisung_id = d.id)))  as bestaetigt
  from dienstanweisung d
  left join objekt o on o.id = d.objekt_id and o.mandant_id = d.mandant_id
  left join posten pn on pn.id = d.posten_id and pn.mandant_id = d.mandant_id
  left join dienstanweisung_version av
         on av.id = d.aktive_version_id and av.mandant_id = d.mandant_id`;

function ausAnweisung(z: AnweisungRoh): AnweisungZeile {
  return {
    id: z.id,
    titel: z.titel,
    status: z.status,
    objektId: z.objekt_id,
    objekt: z.objekt,
    postenId: z.posten_id,
    posten: z.posten,
    kenntnisnahmePflicht: z.kenntnisnahme_pflicht,
    neueVersionOeffnetPflicht: z.neue_version_oeffnet_pflicht,
    aktiveVersionId: z.aktive_version_id,
    aktiveVersion: z.aktive_version === null ? null : Number(z.aktive_version),
    aktivGueltigAb: z.aktiv_gueltig_ab,
    fassungen: Number(z.fassungen),
    pflichtig: Number(z.pflichtig),
    bestaetigt: Number(z.bestaetigt),
    archiviert: z.archiviert,
  };
}

export interface AnweisungFilter {
  readonly objektId?: string | null;
  readonly status?: DaStatus | null;
}

/** Die Anweisungen der Gesellschaft (SEITENKARTE §5.8). */
export async function leseAnweisungen(
  kontext: LeseKontext, filter: AnweisungFilter = {},
): Promise<readonly AnweisungZeile[]> {
  const zeilen = await kontext.abfrage<AnweisungRoh>(
    `select ${ANWEISUNG_FELDER}
      where ($1::uuid is null or d.objekt_id = $1::uuid)
        and ($2::text is null or d.status::text = $2::text)
      order by d.archiviert_am nulls first, o.bezeichnung nulls first, d.titel`,
    [filter.objektId ?? null, filter.status ?? null],
  );
  return zeilen.map(ausAnweisung);
}

export async function leseAnweisung(
  kontext: LeseKontext, id: string,
): Promise<AnweisungZeile | null> {
  const [z] = await kontext.abfrage<AnweisungRoh>(
    `select ${ANWEISUNG_FELDER} where d.id = $1::uuid`, [id],
  );
  return z === undefined ? null : ausAnweisung(z);
}

/** Eine Fassung, wie die Detailseite sie zeigt. */
export interface FassungZeile {
  readonly id: string;
  readonly version: number;
  readonly inhalt: string | null;
  readonly sprachen: readonly DaSprache[];
  readonly dokumentId: string | null;
  /** `sha256(inhalt ‖ dokument)`, hex — der Digest, auf den jede Bestätigung zeigt. */
  readonly inhaltHash: string;
  readonly aenderungshinweis: string | null;
  readonly gueltigAb: string;
  readonly veroeffentlicht: boolean;
  /** Berliner Ortszeit, fertig aus der Datenbank (Invariante 2). */
  readonly veroeffentlichtLokal: string | null;
  readonly istAktiv: boolean;
  readonly kenntnisnahmen: number;
}

interface FassungRoh {
  readonly id: string;
  readonly version: number;
  readonly inhalt: string | null;
  readonly sprachen: readonly string[] | null;
  readonly dokument_id: string | null;
  readonly inhalt_hash: string;
  readonly aenderungshinweis: string | null;
  readonly gueltig_ab: string;
  readonly veroeffentlicht: boolean;
  readonly veroeffentlicht_lokal: string | null;
  readonly ist_aktiv: boolean;
  readonly kenntnisnahmen: string;
}

/**
 * Die Fassungen einer Anweisung, neueste zuerst.
 *
 * `jsonb_object_keys` statt des Textes: welche SPRACHEN es gibt, ist die
 * Auskunft der Uebersichtsseite; der Text selbst haengt an der Sprache des
 * Lesenden und wird dort geholt, wo er gelesen wird.
 */
export async function leseFassungen(
  kontext: LeseKontext, anweisungId: string,
): Promise<readonly FassungZeile[]> {
  const zeilen = await kontext.abfrage<FassungRoh>(
    `select v.id, v.version, v.inhalt, v.dokument_id, v.inhalt_hash,
            v.aenderungshinweis,
            to_char(v.gueltig_ab, 'YYYY-MM-DD') as gueltig_ab,
            (v.veroeffentlicht_am is not null)  as veroeffentlicht,
            to_char(v.veroeffentlicht_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI')       as veroeffentlicht_lokal,
            (v.id = d.aktive_version_id)        as ist_aktiv,
            (select array_agg(s order by s)
               from jsonb_object_keys(coalesce(v.inhalt_i18n, '{}'::jsonb)) as s)
                                                as sprachen,
            (select count(*) from da_kenntnisnahme k
              where k.dienstanweisung_version_id = v.id) as kenntnisnahmen
       from dienstanweisung_version v
       join dienstanweisung d on d.id = v.dienstanweisung_id and d.mandant_id = v.mandant_id
      where v.dienstanweisung_id = $1::uuid
      order by v.version desc`,
    [anweisungId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    version: Number(z.version),
    inhalt: z.inhalt,
    sprachen: (z.sprachen ?? []).filter(istDaSprache),
    dokumentId: z.dokument_id,
    inhaltHash: z.inhalt_hash,
    aenderungshinweis: z.aenderungshinweis,
    gueltigAb: z.gueltig_ab,
    veroeffentlicht: z.veroeffentlicht,
    veroeffentlichtLokal: z.veroeffentlicht_lokal,
    istAktiv: z.ist_aktiv,
    kenntnisnahmen: Number(z.kenntnisnahmen),
  }));
}

/** Eine Zeile der Kenntnisstandsliste (SEITENKARTE §5.8, EMP-09). */
export interface KenntnisstandZeile {
  readonly anstellungId: string;
  readonly personId: string;
  readonly name: string;
  readonly quelle: string;
  /** Die zuletzt bestätigte Fassung dieses Kopfes — oder `null`. */
  readonly bestaetigteVersion: number | null;
  readonly bestaetigtLokal: string | null;
  readonly bestaetigterHash: string | null;
  readonly art: KenntnisnahmeArt | null;
  readonly sprache: DaSprache | null;
  /** Zählt die Bestätigung noch? `false` heisst: veraltet oder gar keine. */
  readonly aktuell: boolean;
}

/**
 * Wer bestaetigen muss, und was er bestaetigt hat (Abnahme 1).
 *
 * Der seitliche Verbund holt die HOECHSTE bestaetigte Fassung dieses Kopfes —
 * nicht die aktive: nach der Freigabe von Fassung 3 soll dastehen, dass Fatima
 * Fassung 2 bestaetigt hat, und dass das nicht mehr genuegt. Die alte Zeile
 * bleibt dabei unveraendert; „veraltet" ist ein Vergleich, kein Stempel.
 */
export async function leseKenntnisstand(
  kontext: LeseKontext, anweisungId: string,
): Promise<readonly KenntnisstandZeile[]> {
  const zeilen = await kontext.abfrage<{
    anstellung_id: string; person_id: string; name: string; quelle: string;
    bestaetigte_version: number | null; bestaetigt_lokal: string | null;
    bestaetigter_hash: string | null; art: string | null; sprache: string | null;
    aktuell: boolean;
  }>(
    `select p.anstellung_id, p.person_id,
            (pe.vorname || ' ' || pe.nachname)   as name,
            p.quelle::text                       as quelle,
            kv.version                           as bestaetigte_version,
            to_char(k.bestaetigt_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI')        as bestaetigt_lokal,
            k.bestaetigter_inhalt_hash           as bestaetigter_hash,
            k.art::text                          as art,
            k.sprache::text                      as sprache,
            coalesce(${ZAEHLT_NOCH}, false)      as aktuell
       from da_pflicht p
       join dienstanweisung d on d.id = p.dienstanweisung_id and d.mandant_id = p.mandant_id
       join person pe on pe.id = p.person_id
       left join lateral (
         select kk.*
           from da_kenntnisnahme kk
           join dienstanweisung_version vv on vv.id = kk.dienstanweisung_version_id
          where kk.anstellung_id = p.anstellung_id
            and vv.dienstanweisung_id = p.dienstanweisung_id
          order by vv.version desc
          limit 1) k on true
       left join dienstanweisung_version kv on kv.id = k.dienstanweisung_version_id
      where p.dienstanweisung_id = $1::uuid
        and p.entfallen_am is null
      order by pe.nachname, pe.vorname`,
    [anweisungId],
  );
  return zeilen.map((z) => ({
    anstellungId: z.anstellung_id,
    personId: z.person_id,
    name: z.name,
    quelle: z.quelle,
    bestaetigteVersion: z.bestaetigte_version === null ? null : Number(z.bestaetigte_version),
    bestaetigtLokal: z.bestaetigt_lokal,
    bestaetigterHash: z.bestaetigter_hash,
    art: (KENNTNISNAHME_ARTEN as readonly string[]).includes(z.art ?? '')
      ? (z.art as KenntnisnahmeArt) : null,
    sprache: istDaSprache(z.sprache) ? z.sprache : null,
    aktuell: z.aktuell,
  }));
}
