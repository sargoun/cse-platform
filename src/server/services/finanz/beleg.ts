import 'server-only';
import { cent, type Cent } from './geld.js';

/**
 * Buchungsbelege lesen (`05-FINANZEN.md` §8.5, ACC-03, ACC-06, ACC-09,
 * DOC-01, DOC-03, DOC-05…DOC-08, LEG-01, §147 AO).
 *
 * **Der Beleg ist der Nachweis zur Buchung, nicht die Datei.** Er nennt eine
 * bestimmte Dokument-VERSION und ihren SHA-256 — deshalb kann eine spätere
 * Fassung des Dokuments nicht stillschweigend zum Beleg werden. Dieser Dienst
 * gibt den Hash mit heraus, damit die Oberfläche belegen kann, dass es
 * dieselbe Datei ist, ohne sie zu öffnen.
 *
 * **Er liefert keine Datei und keine URL.** Der Zugriff läuft über
 * `/api/dokumente/[id]/datei` (Recht `dokument.lesen`), der die kurzlebige
 * signierte URL erst NACH seiner eigenen Rechteentscheidung zieht (DOC-03,
 * SEC-A6). Eine URL, die dieser Dienst zurückgäbe, wäre eine, die im
 * Serverprotokoll und im HTML landet.
 *
 * **Die Aufbewahrungsfrist wird nicht geraten.** `aufbewahrung_bis` steht auf
 * der Zeile, wo `app.aufbewahrung_regel` beim Anlegen eine Frist kannte. Wo
 * sie `null` ist, ist die Frist für diese Kategorie nicht entschieden (O-46)
 * — und dann sagt {@link BelegZeile.fristOffen} das, statt zehn Jahre zu
 * behaupten.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type BelegTyp =
  | 'ausgangsrechnung' | 'eingangsrechnung' | 'gutschrift' | 'kassenbeleg'
  | 'bankbeleg' | 'vertrag' | 'sonstiges';

/**
 * **Fünf Werte, nicht vier.** `eingangsrechnung.ts` führt `BelegQuelle` ohne
 * `erzeugt` — und das DB-Enum `beleg_quelle` hat es. Ein Filter über den
 * engeren Typ liess jeden erzeugten Beleg (also jede Ausgangsrechnung)
 * lautlos verschwinden: nicht als Fehler, sondern als Liste, in der etwas
 * fehlt, das niemand zählt.
 */
export type BelegQuelle = 'upload' | 'email' | 'scan' | 'api' | 'erzeugt';

export const BELEG_TYPEN: readonly BelegTyp[] = [
  'ausgangsrechnung', 'eingangsrechnung', 'gutschrift', 'kassenbeleg',
  'bankbeleg', 'vertrag', 'sonstiges',
];

export const BELEG_QUELLEN: readonly BelegQuelle[] = [
  'upload', 'email', 'scan', 'api', 'erzeugt',
];

export function istBelegTyp(wert: unknown): wert is BelegTyp {
  return typeof wert === 'string' && (BELEG_TYPEN as readonly string[]).includes(wert);
}

export function istBelegQuelle(wert: unknown): wert is BelegQuelle {
  return typeof wert === 'string' && (BELEG_QUELLEN as readonly string[]).includes(wert);
}

/** Deutsche Beschriftung je Typ — DESIGN führt kein Pillenwort dafür. */
export const TYP_TEXT: Readonly<Record<BelegTyp, string>> = {
  ausgangsrechnung: 'Ausgangsrechnung',
  eingangsrechnung: 'Eingangsrechnung',
  gutschrift: 'Gutschrift',
  kassenbeleg: 'Kassenbeleg',
  bankbeleg: 'Bankbeleg',
  vertrag: 'Vertrag',
  sonstiges: 'Sonstiges',
};

export const QUELLE_TEXT: Readonly<Record<BelegQuelle, string>> = {
  upload: 'hochgeladen',
  email: 'per E-Mail eingegangen',
  scan: 'gescannt',
  api: 'über eine Schnittstelle',
  erzeugt: 'von der Plattform erzeugt',
};

// ---------------------------------------------------------------------------
// Die Liste
// ---------------------------------------------------------------------------

export interface BelegZeile {
  readonly id: string;
  readonly belegnummer: string | null;
  readonly typ: BelegTyp;
  readonly quelle: BelegQuelle;
  readonly belegdatum: string | null;
  readonly belegdatumIso: string | null;
  readonly bruttoCent: Cent | null;
  readonly seiten: number | null;
  /** Der Eingangszeitpunkt in `Europe/Berlin` (Invariante 2). */
  readonly eingegangenAm: string;
  readonly aufbewahrungKlasse: string;
  readonly aufbewahrungBis: string | null;
  /** `true` ⇒ die Frist dieser Klasse ist nicht entschieden (O-46). */
  readonly fristOffen: boolean;
  readonly loeschsperre: boolean;
  readonly dokumentId: string;
  readonly dateiSha256: string;
}

export interface BelegFilter {
  readonly typ?: BelegTyp | null;
  readonly quelle?: BelegQuelle | null;
  readonly jahr?: number | null;
}

interface RohBeleg {
  readonly id: string;
  readonly belegnummer: string | null;
  readonly typ: BelegTyp;
  readonly quelle: BelegQuelle;
  readonly belegdatum: string | null;
  readonly belegdatum_iso: string | null;
  readonly betrag_brutto_cent: string | null;
  readonly seiten: number | null;
  readonly eingegangen_am: string;
  readonly aufbewahrung_klasse: string;
  readonly aufbewahrung_bis: string | null;
  readonly loeschsperre: boolean;
  readonly dokument_id: string;
  readonly datei_sha256: string;
}

/*
 * `eingegangen_am` wird in der DATENBANK nach Berlin gedreht und nicht in der
 * Seite. Invariante 2: gespeichert in UTC, angezeigt in `Europe/Berlin` — und
 * eine Umrechnung im Browser hängt an der Zeitzone des Geräts, nicht an der
 * des Betriebs. Ein Beleg, der um 23:40 Berliner Zeit eingeht, gehört in den
 * Berliner Tag und nicht in den davor.
 */
const SPALTEN = `
  b.id, b.belegnummer, b.typ::text as typ, b.quelle::text as quelle,
  to_char(b.belegdatum, 'DD.MM.YYYY') as belegdatum,
  to_char(b.belegdatum, 'YYYY-MM-DD') as belegdatum_iso,
  b.betrag_brutto_cent::text, b.seiten,
  to_char(b.eingegangen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
    as eingegangen_am,
  b.aufbewahrung_klasse,
  to_char(b.aufbewahrung_bis, 'DD.MM.YYYY') as aufbewahrung_bis,
  b.loeschsperre, b.dokument_id, b.datei_sha256`;

function zuZeile(z: RohBeleg): BelegZeile {
  return {
    id: z.id,
    belegnummer: z.belegnummer,
    typ: z.typ,
    quelle: z.quelle,
    belegdatum: z.belegdatum,
    belegdatumIso: z.belegdatum_iso,
    bruttoCent: z.betrag_brutto_cent === null
      ? null : cent(BigInt(z.betrag_brutto_cent)),
    seiten: z.seiten,
    eingegangenAm: z.eingegangen_am,
    aufbewahrungKlasse: z.aufbewahrung_klasse,
    aufbewahrungBis: z.aufbewahrung_bis,
    fristOffen: z.aufbewahrung_bis === null,
    loeschsperre: z.loeschsperre,
    dokumentId: z.dokument_id,
    dateiSha256: z.datei_sha256,
  };
}

export async function belege(
  db: Abfrage, filter: BelegFilter = {},
): Promise<readonly BelegZeile[]> {
  const zeilen = await db.abfrage<RohBeleg>(
    `select ${SPALTEN}
       from beleg b
      where ($1::text is null or b.typ = $1::beleg_typ)
        and ($2::text is null or b.quelle = $2::beleg_quelle)
        and ($3::int  is null
             or extract(year from coalesce(b.belegdatum,
                  (b.eingegangen_am at time zone 'Europe/Berlin')::date)) = $3::int)
      order by coalesce(b.belegdatum,
                        (b.eingegangen_am at time zone 'Europe/Berlin')::date) desc,
               b.eingegangen_am desc`,
    [filter.typ ?? null, filter.quelle ?? null, filter.jahr ?? null]);
  return zeilen.map(zuZeile);
}

export async function leseBeleg(db: Abfrage, id: string): Promise<BelegZeile | null> {
  const [z] = await db.abfrage<RohBeleg>(
    `select ${SPALTEN} from beleg b where b.id = $1`, [id]);
  return z === undefined ? null : zuZeile(z);
}

// ---------------------------------------------------------------------------
// Die Zähler über der Liste
// ---------------------------------------------------------------------------

export interface TypZaehler {
  readonly typ: BelegTyp;
  readonly anzahl: number;
}

export interface BelegZaehler {
  readonly gesamt: number;
  readonly jeTyp: readonly TypZaehler[];
  /** Belege, deren Aufbewahrungsfrist nicht feststeht (O-46). */
  readonly ohneFrist: number;
  readonly mitLoeschsperre: number;
}

export async function belegZaehler(
  db: Abfrage, filter: BelegFilter = {},
): Promise<BelegZaehler> {
  const [gesamt] = await db.abfrage<{
    gesamt: string; ohne_frist: string; mit_sperre: string;
  }>(
    `select count(*)::text as gesamt,
            count(*) filter (where b.aufbewahrung_bis is null)::text as ohne_frist,
            count(*) filter (where b.loeschsperre)::text as mit_sperre
       from beleg b
      where ($1::text is null or b.typ = $1::beleg_typ)
        and ($2::text is null or b.quelle = $2::beleg_quelle)
        and ($3::int  is null
             or extract(year from coalesce(b.belegdatum,
                  (b.eingegangen_am at time zone 'Europe/Berlin')::date)) = $3::int)`,
    [filter.typ ?? null, filter.quelle ?? null, filter.jahr ?? null]);

  const jeTyp = await db.abfrage<{ typ: BelegTyp; anzahl: string }>(
    `select b.typ::text as typ, count(*)::text as anzahl
       from beleg b
      where ($1::text is null or b.quelle = $1::beleg_quelle)
        and ($2::int  is null
             or extract(year from coalesce(b.belegdatum,
                  (b.eingegangen_am at time zone 'Europe/Berlin')::date)) = $2::int)
      group by b.typ order by count(*) desc, b.typ`,
    [filter.quelle ?? null, filter.jahr ?? null]);

  return {
    gesamt: Number(gesamt?.gesamt ?? '0'),
    ohneFrist: Number(gesamt?.ohne_frist ?? '0'),
    mitLoeschsperre: Number(gesamt?.mit_sperre ?? '0'),
    jeTyp: jeTyp.map((z) => ({ typ: z.typ, anzahl: Number(z.anzahl) })),
  };
}

// ---------------------------------------------------------------------------
// Woran ein Beleg hängt (ACC-03: der Beleg reist mit der Buchung)
// ---------------------------------------------------------------------------

export interface Verwendung {
  /** Wo diese Zeile lebt — das Sprungziel entscheidet die Seite. */
  readonly art: 'eingangsrechnung' | 'ausgabe' | 'buchungssatz' | 'rechnung';
  readonly id: string;
  /** Die Beschriftung, unter der ein Mensch sie kennt. */
  readonly bezeichnung: string;
  readonly zustand: string | null;
}

/**
 * Jede Zeile, die sich auf diesen Beleg beruft.
 *
 * **Das ist der Grund, warum er nicht gelöscht werden kann** (Invariante 8):
 * ein gelöschter Beleg liesse eine Buchung ohne Nachweis zurück, und genau
 * das ist der Mangel, den eine Betriebsprüfung zuerst feststellt. Die Seite
 * zeigt diese Liste, statt einen ausgegrauten Löschknopf anzubieten — ein
 * gesperrter Knopf erklärt nichts.
 *
 * **Die Ausgangsrechnung steht mit drin, über `rechnung.beleg_id`.**
 * Hier stand vorher, `rechnung` komme über ein `rechnung_dokument`, das es
 * noch nicht gebe — dabei trägt `rechnung` seit 0132 selbst `beleg_id` (das
 * archivierte Rechnungs-PDF, „das PDF, das der Kunde bekommen hat"). Der
 * Rückgabetyp führte `'rechnung'` also, und die `union all` erzeugte den
 * Zweig nie: für genau den Beleg, an dem eine Rechnung hängt, sagte diese
 * Liste „daran hängt niemand" — auf dem Bildschirm, der die Begründung ist,
 * warum der Beleg nicht löschbar ist.
 */
export async function verwendungen(
  db: Abfrage, belegId: string,
): Promise<readonly Verwendung[]> {
  const zeilen = await db.abfrage<{
    art: Verwendung['art']; id: string; bezeichnung: string; zustand: string | null;
  }>(
    `select 'eingangsrechnung' as art, er.id,
            coalesce(er.interne_belegnummer,
                     'Eingangsrechnung ohne Belegnummer') as bezeichnung,
            er.status::text as zustand
       from eingangsrechnung er where er.beleg_id = $1
     union all
     select 'ausgabe' as art, a.id, a.bezeichnung, a.status::text as zustand
       from ausgabe a where a.beleg_id = $1
     union all
     select 'buchungssatz' as art, bs.id,
            coalesce(bs.buchungstext, 'Buchung ohne Text') as bezeichnung,
            case when bs.festgeschrieben then 'festgeschrieben' else 'offen' end as zustand
       from buchungssatz bs where bs.beleg_id = $1
     union all
     select 'rechnung' as art, r.id,
            coalesce(r.nummer, 'Rechnungsentwurf') as bezeichnung,
            r.status::text as zustand
       from rechnung r where r.beleg_id = $1
     order by 1, 3`,
    [belegId]);
  return zeilen;
}

// ---------------------------------------------------------------------------
// Die Dokumentversion und die Zugriffshistorie
// ---------------------------------------------------------------------------

export interface Dokumentstand {
  readonly dokumentId: string;
  readonly titel: string;
  readonly versionId: string;
  readonly version: number;
  readonly mimeTyp: string;
  readonly groesseBytes: number;
  readonly sha256: string;
  /** Weicht der Hash des Belegs von dem der Version ab? Dann wurde getauscht. */
  readonly hashStimmt: boolean;
  readonly geloeschtAm: string | null;
  /** Gibt es eine NEUERE Version als die, die der Beleg bezeugt? */
  readonly neuereVersion: number | null;
}

export async function dokumentstand(
  db: Abfrage, belegId: string,
): Promise<Dokumentstand | null> {
  const [z] = await db.abfrage<{
    dokument_id: string; titel: string; version_id: string; version: number;
    mime_typ: string; groesse_bytes: string; sha256: string;
    beleg_sha256: string; geloescht_am: string | null; neuere_version: number | null;
  }>(
    `select b.dokument_id, d.titel, dv.id as version_id, dv.version,
            dv.mime_typ, dv.groesse_bytes::text, dv.sha256,
            b.datei_sha256 as beleg_sha256,
            to_char(d.geloescht_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as geloescht_am,
            (select max(v2.version) from dokument_version v2
              where v2.mandant_id = d.mandant_id and v2.dokument_id = d.id
                and v2.version > dv.version) as neuere_version
       from beleg b
       join dokument d on d.mandant_id = b.mandant_id and d.id = b.dokument_id
       join dokument_version dv
         on dv.mandant_id = b.mandant_id and dv.id = b.dokument_version_id
      where b.id = $1`,
    [belegId]);
  if (z === undefined) return null;
  return {
    dokumentId: z.dokument_id,
    titel: z.titel,
    versionId: z.version_id,
    version: z.version,
    mimeTyp: z.mime_typ,
    groesseBytes: Number(z.groesse_bytes),
    sha256: z.sha256,
    hashStimmt: z.sha256 === z.beleg_sha256,
    geloeschtAm: z.geloescht_am,
    neuereVersion: z.neuere_version,
  };
}

export interface Zugriff {
  readonly art: string;
  readonly benutzer: string | null;
  readonly zeitpunkt: string;
}

/**
 * Wer den Beleg wann geöffnet hat (DOC-05).
 *
 * Bewusst die letzten fünfzig und nicht alles: eine Liste, die nach dem
 * zwanzigsten Eintrag weiterläuft, wird nicht gelesen — und die Frage, die
 * sie beantwortet („hat jemand ausser mir hier hineingesehen"), betrifft die
 * letzten Zugriffe.
 */
export async function zugriffe(
  db: Abfrage, dokumentId: string, grenze = 50,
): Promise<readonly Zugriff[]> {
  return db.abfrage<Zugriff>(
    `select z.art::text as art, bn.name as benutzer,
            to_char(z.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as zeitpunkt
       from dokument_zugriff z
       left join benutzer bn on bn.id = z.benutzer_id
      where z.dokument_id = $1
      order by z.erstellt_am desc
      limit $2`,
    [dokumentId, grenze]);
}

// ---------------------------------------------------------------------------
// Die Aufbewahrungsregel dieser Klasse (O-46)
// ---------------------------------------------------------------------------

export interface Aufbewahrung {
  readonly klasse: string;
  readonly jahre: number | null;
  readonly loeschsperre: boolean;
  /** `true` ⇒ der Wert ist unbestätigt oder es gibt keinen (O-46). */
  readonly istPlatzhalter: boolean;
}

/**
 * Die Regel hinter `aufbewahrung_bis` — gelesen, nicht gerechnet.
 *
 * Ohne Zeile in `dokument_aufbewahrung` gibt es keine Frist, und dann sagt
 * `jahre: null` das: die Aufbewahrungsdauer dieser Kategorie ist nicht
 * entschieden (O-46). Zehn Jahre einzusetzen, weil §147 AO für
 * Buchungsbelege zehn nennt, wäre für die MEISTEN Klassen richtig und für
 * einige falsch — und falsch heisst hier: ein Dokument wird zu früh oder zu
 * spät ausgesondert.
 */
export async function aufbewahrung(
  db: Abfrage, mandantId: string, klasse: string,
): Promise<Aufbewahrung> {
  const [z] = await db.abfrage<{
    jahre: number | null; loeschsperre: boolean; ist_platzhalter: boolean;
  }>(
    `select jahre, loeschsperre, ist_platzhalter
       from app.aufbewahrung_regel($1, $2)`,
    [mandantId, klasse]);
  return {
    klasse,
    jahre: z?.jahre ?? null,
    loeschsperre: z?.loeschsperre ?? true,
    istPlatzhalter: z === undefined || z.ist_platzhalter,
  };
}

// TODO(client, O-46): Wie lange wird je Belegklasse aufbewahrt? §147 AO nennt zehn Jahre für Buchungsbelege und sechs für Handelsbriefe; welche Klasse dieser Plattform welche Frist trägt, ist je Gesellschaft zu bestätigen.
