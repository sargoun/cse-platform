import 'server-only';
import { cent, NULL_CENT, type Cent } from './geld.js';

/**
 * Ausgaben: der Aufwand einer Gesellschaft, der keine Lieferantenrechnung ist
 * (`05-FINANZEN.md` §8.5, FIN-14, FIN-17, REP-05, ACC-01, ACC-03).
 *
 * **Dieser Dienst liest. Er rechnet nichts zurück.** Netto, Steuer und Brutto
 * stehen auf der Zeile, die Aufteilung je Steuersatzgruppe in
 * `ausgabe_steuer` — und beide kommen so, wie sie gespeichert sind. Aus einem
 * Bruttobetrag einen Satz herzuleiten wäre ein Mischsatz, und Invariante 1
 * verbietet ihn: die Umsatzsteuer entsteht je Steuersatzgruppe.
 *
 * **`anstellung_id` kommt hier nirgends vor**, und das ist keine Auslassung.
 * Die Spalte fehlt im `GRANT` für `cse_app` (0180, K-05); eine Abfrage, die
 * sie nennt, scheitert mit `permission denied`. Wer wissen darf, welche
 * Beschäftigte welche Erstattung bekommen hat, fragt {@link erstattung} — und
 * dieser Zugriff steht anschliessend im `audit_log`.
 *
 * **Was hier nicht entschieden ist, steht als Frage da.** Ob es Ausgaben gibt,
 * für die belegfrei gebucht werden darf (O-185), und ob eine TSE-Kasse nach
 * §146a AO im Einsatz ist (O-186), ist offen. Der Dienst behauptet keine
 * Antwort: er gibt `belegPflichtVerletzt` zurück, wo eine Ausgabe ohne Beleg
 * auf Freigabe wartet, und die Oberfläche benennt die Frage.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type AusgabeStatus = 'erfasst' | 'freigegeben' | 'gebucht' | 'abgelehnt';

export const AUSGABE_STATUS: readonly AusgabeStatus[] = [
  'erfasst', 'freigegeben', 'gebucht', 'abgelehnt',
];

export function istAusgabeStatus(wert: unknown): wert is AusgabeStatus {
  return typeof wert === 'string'
    && (AUSGABE_STATUS as readonly string[]).includes(wert);
}

export type Zahlungsmittel =
  'ueberweisung' | 'lastschrift' | 'bar' | 'karte' | 'verrechnung';

/**
 * Die offene Frage zum belegfreien Buchen, wörtlich — damit die Oberfläche sie
 * anzeigen kann, statt eine Grenze zu nennen, die niemand entschieden hat.
 *
 * `grenzeCent: null` heisst: es gibt keine Bagatellgrenze für Eigenbelege, und
 * deshalb gilt die harte Regel aus 0180 — ohne Beleg keine Freigabe. Das ist
 * die haftungsfreie Richtung, nicht die Antwort.
 */
export interface EigenbelegLage {
  readonly grenzeCent: bigint | null;
  readonly herkunft: string;
  readonly istPlatzhalter: boolean;
}

export const EIGENBELEG_PLATZHALTER: EigenbelegLage = {
  grenzeCent: null,
  herkunft:
    'Nicht entschieden (O-185). Solange keine Grenze für Eigenbelege feststeht, '
    + 'verlangt die Datenbank vor jeder Freigabe einen Beleg — „keine Buchung '
    + 'ohne Beleg" (ACC-03). Das ist die haftungsfreie Richtung und keine Antwort.',
  istPlatzhalter: true,
};

// TODO(client, O-185): Gibt es Ausgaben, für die belegfrei gebucht werden darf (Eigenbeleg für Trinkgeld oder Parkgebühr ohne Quittung), und bis zu welchem Betrag?
// TODO(client, O-186): Wird eine elektronische Registrierkasse mit TSE nach §146a AO eingesetzt, oder ausschliesslich eine offene Ladenkasse mit Kassenbuch? Davon hängt ab, welche Angaben eine Barausgabe tragen muss.

// ---------------------------------------------------------------------------
// Die Liste
// ---------------------------------------------------------------------------

export interface AusgabeZeile {
  readonly id: string;
  readonly ausgabedatum: string;
  /** Der Berliner Kalendertag als `YYYY-MM-DD` — für Filter und Sortierung. */
  readonly ausgabedatumIso: string;
  readonly kategorieId: string;
  readonly kategorie: string;
  readonly kategorieIstPlatzhalter: boolean;
  readonly bezeichnung: string;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
  readonly bruttoCent: Cent;
  readonly zahlungsmittel: Zahlungsmittel;
  readonly status: AusgabeStatus;
  readonly weiterberechenbar: boolean;
  readonly belegId: string | null;
  readonly belegnummer: string | null;
  /** Ohne Beleg und schon freigegeben — kann nach 0180 nicht vorkommen. */
  readonly belegPflichtVerletzt: boolean;
  readonly kasse: string | null;
  readonly eingangsrechnungId: string | null;
  readonly auftragId: string | null;
  readonly auftragsnummer: string | null;
  readonly projektId: string | null;
  readonly objektId: string | null;
  readonly abgelehntGrund: string | null;
  /**
   * Trägt diese Ausgabe Personenbezug — ist sie also eine Erstattung?
   *
   * **Abgeleitet und nicht gelesen.** `anstellung_id` selbst ist gesperrt
   * (K-05); ob sie gesetzt IST, sagt die Datenbank über einen Definer, weil
   * sonst die Liste nicht sagen könnte, welche Zeile hinter dem schmalen Tor
   * liegt. Das ist kein Personendatum — es ist die Auskunft, dass eines
   * existiert.
   */
  readonly istErstattung: boolean;
}

export interface AusgabeFilter {
  readonly jahr?: number | null;
  /**
   * `YYYY-MM` — der Monat nach Belegdatum, wie ihn die Monatszahlen
   * verlinken (V-215). Dieselbe Lesart wie `app.ausgaben_aufwand`.
   */
  readonly monat?: string | null;
  readonly status?: AusgabeStatus | null;
  readonly kategorieId?: string | null;
  readonly nurWeiterberechenbar?: boolean;
}

interface RohZeile {
  readonly id: string;
  readonly ausgabedatum: string;
  readonly ausgabedatum_iso: string;
  readonly kategorie_id: string;
  readonly kategorie: string;
  readonly kategorie_platzhalter: boolean;
  readonly bezeichnung: string;
  readonly netto_cent: string;
  readonly steuer_cent: string;
  readonly brutto_cent: string;
  readonly zahlungsmittel: Zahlungsmittel;
  readonly status: AusgabeStatus;
  readonly weiterberechenbar: boolean;
  readonly beleg_id: string | null;
  readonly belegnummer: string | null;
  readonly kasse: string | null;
  readonly eingangsrechnung_id: string | null;
  readonly auftrag_id: string | null;
  readonly auftragsnummer: string | null;
  readonly projekt_id: string | null;
  readonly objekt_id: string | null;
  readonly abgelehnt_grund: string | null;
  readonly ist_erstattung: boolean;
}

/**
 * `ist_erstattung` kommt über einen Definer und nicht über
 * `anstellung_id is not null`: die Spalte steht nicht im Grant, und ein
 * `is not null` darauf ist derselbe `permission denied` wie ein `select`.
 *
 * **Und zwar über `app.ausgabe_ist_erstattung()` (0184), nicht über
 * `app.ausgabe_erstattung_lesen()`.**
 *
 * Hier stand vorher `exists (select 1 from app.ausgabe_erstattung_lesen(a.id))`.
 * Diese Spaltenliste benutzen `ausgaben()` UND `leseAusgabe()`, und der
 * gerufene Definer schreibt bei jedem Aufruf `ausgabe.erstattung_gelesen` ins
 * `audit_log`. Die Liste protokollierte damit bei JEDEM Seitenaufruf eine
 * Zeile je Erstattungsausgabe, die Einzelseite zwei — obwohl hier nur ein
 * Ja/Nein angezeigt wird. Ein überlaufendes Zugriffsprotokoll auf
 * Personenbezug macht den ECHTEN Zugriff nicht mehr auffindbar (SEC-A9), und
 * genau der ist der Grund, warum es existiert.
 *
 * `app.ausgabe_ist_erstattung()` gibt ein Bit heraus und keinen Personenbezug
 * — also auch keinen Protokolleintrag. Der protokollierte Weg zur PERSON
 * bleibt `app.ausgabe_erstattung_lesen()` und wird nur noch von
 * {@link erstattung} gerufen: dort, wo jemand wirklich wissen will, WER.
 *
 * Das Bit sagt nichts über das Recht: es ist `true`, sobald eine Anstellung
 * dranhängt, auch ohne `personal.erstattung_lesen`. Wer sie sehen will,
 * bekommt dann auf der Einzelseite den Rechtehinweis statt eines Namens —
 * das ist die Unterscheidung an der richtigen Stelle. Vorher las die Liste
 * „keine Erstattung", wo „darfst du nicht wissen" gemeint war.
 */
const SPALTEN = `
  a.id,
  to_char(a.ausgabedatum, 'DD.MM.YYYY') as ausgabedatum,
  to_char(a.ausgabedatum, 'YYYY-MM-DD') as ausgabedatum_iso,
  a.kategorie_id, k.bezeichnung as kategorie,
  k.ist_platzhalter as kategorie_platzhalter,
  a.bezeichnung, a.netto_cent::text, a.steuer_cent::text, a.brutto_cent::text,
  a.zahlungsmittel::text as zahlungsmittel, a.status::text as status,
  a.weiterberechenbar, a.beleg_id, b.belegnummer, ka.bezeichnung as kasse,
  a.eingangsrechnung_id, a.auftrag_id, auf.auftragsnummer,
  a.projekt_id, a.objekt_id, a.abgelehnt_grund,
  app.ausgabe_ist_erstattung(a.id) as ist_erstattung`;

const QUELLE = `
  from ausgabe a
  join ausgabe_kategorie k on k.mandant_id = a.mandant_id and k.id = a.kategorie_id
  left join beleg b   on b.mandant_id  = a.mandant_id and b.id  = a.beleg_id
  left join kasse ka  on ka.mandant_id = a.mandant_id and ka.id = a.kasse_id
  left join auftrag auf on auf.mandant_id = a.mandant_id and auf.id = a.auftrag_id`;

function zuZeile(z: RohZeile): AusgabeZeile {
  return {
    id: z.id,
    ausgabedatum: z.ausgabedatum,
    ausgabedatumIso: z.ausgabedatum_iso,
    kategorieId: z.kategorie_id,
    kategorie: z.kategorie,
    kategorieIstPlatzhalter: z.kategorie_platzhalter,
    bezeichnung: z.bezeichnung,
    nettoCent: cent(BigInt(z.netto_cent)),
    steuerCent: cent(BigInt(z.steuer_cent)),
    bruttoCent: cent(BigInt(z.brutto_cent)),
    zahlungsmittel: z.zahlungsmittel,
    status: z.status,
    weiterberechenbar: z.weiterberechenbar,
    belegId: z.beleg_id,
    belegnummer: z.belegnummer,
    belegPflichtVerletzt:
      z.beleg_id === null && (z.status === 'freigegeben' || z.status === 'gebucht'),
    kasse: z.kasse,
    eingangsrechnungId: z.eingangsrechnung_id,
    auftragId: z.auftrag_id,
    auftragsnummer: z.auftragsnummer,
    projektId: z.projekt_id,
    objektId: z.objekt_id,
    abgelehntGrund: z.abgelehnt_grund,
    istErstattung: z.ist_erstattung,
  };
}

export async function ausgaben(
  db: Abfrage, filter: AusgabeFilter = {},
): Promise<readonly AusgabeZeile[]> {
  const zeilen = await db.abfrage<RohZeile>(
    `select ${SPALTEN} ${QUELLE}
      where ($1::int  is null or extract(year from a.ausgabedatum) = $1::int)
        and ($2::text is null or a.status = $2::ausgabe_status)
        and ($3::uuid is null or a.kategorie_id = $3::uuid)
        and ($4::bool is not true or a.weiterberechenbar)
        and ($5::text is null or to_char(a.ausgabedatum, 'YYYY-MM') = $5::text)
      order by a.ausgabedatum desc, a.erstellt_am desc`,
    [filter.jahr ?? null, filter.status ?? null, filter.kategorieId ?? null,
      filter.nurWeiterberechenbar === true, filter.monat ?? null]);
  return zeilen.map(zuZeile);
}

export async function leseAusgabe(
  db: Abfrage, id: string,
): Promise<AusgabeZeile | null> {
  const [z] = await db.abfrage<RohZeile>(
    `select ${SPALTEN} ${QUELLE} where a.id = $1`, [id]);
  return z === undefined ? null : zuZeile(z);
}

// ---------------------------------------------------------------------------
// Die Summen je Zustand
// ---------------------------------------------------------------------------

export interface StatusSumme {
  readonly status: AusgabeStatus;
  readonly anzahl: number;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
  readonly bruttoCent: Cent;
}

export interface Summen {
  readonly jeStatus: readonly StatusSumme[];
  readonly anzahl: number;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
  readonly bruttoCent: Cent;
}

/**
 * Die Summen kommen aus DERSELBEN Abfrage wie die Liste, nur aggregiert — und
 * nicht aus einem `reduce` über die gelesenen Zeilen.
 *
 * Der Grund ist nicht Geschwindigkeit: die Liste kann gefiltert oder gekürzt
 * sein, und eine Summe unter einer gekürzten Liste, die sich „Summe" nennt,
 * ist die Zahl, an der jemand später eine Abweichung sucht. Gezählt wird in
 * der Datenbank, unter derselben Policy — was eine Sitzung nicht sehen darf,
 * zählt für sie auch nicht mit.
 */
export async function summen(
  db: Abfrage, filter: AusgabeFilter = {},
): Promise<Summen> {
  const zeilen = await db.abfrage<{
    status: AusgabeStatus; anzahl: string;
    netto_cent: string; steuer_cent: string; brutto_cent: string;
  }>(
    `select a.status::text as status, count(*)::text as anzahl,
            coalesce(sum(a.netto_cent), 0)::text  as netto_cent,
            coalesce(sum(a.steuer_cent), 0)::text as steuer_cent,
            coalesce(sum(a.brutto_cent), 0)::text as brutto_cent
       from ausgabe a
      where ($1::int  is null or extract(year from a.ausgabedatum) = $1::int)
        and ($2::text is null or a.status = $2::ausgabe_status)
        and ($3::uuid is null or a.kategorie_id = $3::uuid)
        and ($4::bool is not true or a.weiterberechenbar)
        and ($5::text is null or to_char(a.ausgabedatum, 'YYYY-MM') = $5::text)
      group by a.status
      order by a.status`,
    [filter.jahr ?? null, filter.status ?? null, filter.kategorieId ?? null,
      filter.nurWeiterberechenbar === true, filter.monat ?? null]);

  const jeStatus = zeilen.map((z) => ({
    status: z.status,
    anzahl: Number(z.anzahl),
    nettoCent: cent(BigInt(z.netto_cent)),
    steuerCent: cent(BigInt(z.steuer_cent)),
    bruttoCent: cent(BigInt(z.brutto_cent)),
  }));

  return {
    jeStatus,
    anzahl: jeStatus.reduce((s, z) => s + z.anzahl, 0),
    nettoCent: jeStatus.reduce<Cent>((s, z) => cent(s + z.nettoCent), NULL_CENT),
    steuerCent: jeStatus.reduce<Cent>((s, z) => cent(s + z.steuerCent), NULL_CENT),
    bruttoCent: jeStatus.reduce<Cent>((s, z) => cent(s + z.bruttoCent), NULL_CENT),
  };
}

// ---------------------------------------------------------------------------
// Die Steuerzeilen — je Steuersatzgruppe, nie ein Mischsatz
// ---------------------------------------------------------------------------

export interface SteuerZeile {
  readonly steuersatzGruppeId: string;
  readonly gruppe: string;
  readonly satzBp: number;
  readonly kategorie: string;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
}

export interface SteuerLage {
  readonly zeilen: readonly SteuerZeile[];
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
  /** Stimmen die Zeilen mit dem Kopf überein? */
  readonly stimmtMitKopf: boolean;
}

/**
 * Die Aufteilung einer Ausgabe je Steuersatzgruppe — und die Probe dagegen.
 *
 * `stimmtMitKopf` ist `false`, solange die Erfassung noch läuft (die Zeilen
 * dürfen bis zum Buchen nachkommen, ACC-05) UND wenn wirklich etwas nicht
 * zusammenpasst. Die Oberfläche unterscheidet die beiden Fälle am Zustand,
 * nicht an dieser Zahl — hier steht nur, ob die Summen gleich sind.
 */
export async function steuerzeilen(
  db: Abfrage, ausgabeId: string,
): Promise<SteuerLage> {
  const [kopf] = await db.abfrage<{ netto_cent: string; steuer_cent: string }>(
    `select a.netto_cent::text, a.steuer_cent::text from ausgabe a where a.id = $1`,
    [ausgabeId]);

  const zeilen = await db.abfrage<{
    steuersatz_gruppe_id: string; gruppe: string; satz_bp: number;
    kategorie: string; netto_cent: string; steuer_cent: string;
  }>(
    `select s.steuersatz_gruppe_id, g.bezeichnung as gruppe, s.satz_bp,
            s.kategorie::text as kategorie,
            s.netto_cent::text, s.steuer_cent::text
       from ausgabe_steuer s
       join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
      where s.ausgabe_id = $1
      order by s.satz_bp desc, g.bezeichnung`,
    [ausgabeId]);

  const abgebildet = zeilen.map((z) => ({
    steuersatzGruppeId: z.steuersatz_gruppe_id,
    gruppe: z.gruppe,
    satzBp: z.satz_bp,
    kategorie: z.kategorie,
    nettoCent: cent(BigInt(z.netto_cent)),
    steuerCent: cent(BigInt(z.steuer_cent)),
  }));
  const netto = abgebildet.reduce<Cent>((s, z) => cent(s + z.nettoCent), NULL_CENT);
  const steuer = abgebildet.reduce<Cent>((s, z) => cent(s + z.steuerCent), NULL_CENT);

  return {
    zeilen: abgebildet,
    nettoCent: netto,
    steuerCent: steuer,
    stimmtMitKopf: kopf !== undefined
      && abgebildet.length > 0
      && netto === BigInt(kopf.netto_cent)
      && steuer === BigInt(kopf.steuer_cent),
  };
}

// ---------------------------------------------------------------------------
// Das schmale Tor auf die Erstattung (K-05)
// ---------------------------------------------------------------------------

export interface Erstattung {
  readonly anstellungId: string;
  readonly personId: string;
  readonly personalnummer: string | null;
}

/**
 * Wem eine Erstattung zusteht — oder `null`.
 *
 * `null` heisst zweierlei, und das ist gewollt (AUT-06): die Ausgabe ist keine
 * Erstattung, ODER diese Sitzung hält `personal.erstattung_lesen` nicht. Ein
 * unterscheidbarer Rückgabewert wäre die Auskunft, die das Recht verweigert.
 *
 * Wo die Antwort kommt, steht sie anschliessend im `audit_log`
 * (`ausgabe.erstattung_gelesen`) — ein Lesezugriff auf Personenbezug in einer
 * Finanztabelle ist nachvollziehbar oder er ist ein Loch (SEC-A9).
 */
export async function erstattung(
  db: Abfrage, ausgabeId: string,
): Promise<Erstattung | null> {
  const [z] = await db.abfrage<{
    anstellung_id: string; person_id: string; personalnummer: string | null;
  }>(
    `select anstellung_id, person_id, personalnummer
       from app.ausgabe_erstattung_lesen($1)`, [ausgabeId]);
  return z === undefined
    ? null
    : { anstellungId: z.anstellung_id, personId: z.person_id, personalnummer: z.personalnummer };
}

// ---------------------------------------------------------------------------
// Kategorien — für den Filter
// ---------------------------------------------------------------------------

export interface Kategorie {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly istPlatzhalter: boolean;
}

export async function kategorien(db: Abfrage): Promise<readonly Kategorie[]> {
  const zeilen = await db.abfrage<{
    id: string; schluessel: string; bezeichnung: string; ist_platzhalter: boolean;
  }>(
    `select k.id, k.schluessel, k.bezeichnung, k.ist_platzhalter
       from ausgabe_kategorie k
      where k.archiviert_am is null
      order by k.bezeichnung`);
  return zeilen.map((z) => ({
    id: z.id,
    schluessel: z.schluessel,
    bezeichnung: z.bezeichnung,
    istPlatzhalter: z.ist_platzhalter,
  }));
}

// ---------------------------------------------------------------------------
// Die weiterberechnete Ausgabe und ihre Rechnungszeile (FIN-07)
// ---------------------------------------------------------------------------

export interface Weiterberechnung {
  readonly rechnungId: string;
  readonly rechnungNummer: string | null;
  readonly rechnungStatus: string;
  readonly positionNr: number;
  readonly positionBezeichnung: string;
  readonly wirksam: boolean;
}

/**
 * Die EINE Rechnungszeile, auf der diese Ausgabe weiterberechnet ist.
 *
 * Genau eine, und das ist eine Zusicherung der Datenbank, nicht dieses
 * Dienstes: `quelle_ausgabe_uk` aus 0107 ist ein Teilindex auf `(ausgabe_id)`
 * mit `WHERE quelle_typ = 'material' AND wirksam` — eine weiterberechnete
 * Ausgabe wird EINMAL weiterberechnet. Unwirksame Zeilen (aus einem Storno)
 * stehen daneben, damit sichtbar bleibt, dass es einen Versuch gab.
 */
export async function weiterberechnungen(
  db: Abfrage, ausgabeId: string,
): Promise<readonly Weiterberechnung[]> {
  const zeilen = await db.abfrage<{
    rechnung_id: string; nummer: string | null; status: string;
    position_nr: number; bezeichnung: string; wirksam: boolean;
  }>(
    `select q.rechnung_id, r.nummer, r.status::text as status,
            p.position_nr, p.bezeichnung, q.wirksam
       from rechnungsposition_quelle q
       join rechnung r on r.mandant_id = q.mandant_id and r.id = q.rechnung_id
       join rechnungsposition p
         on p.mandant_id = q.mandant_id and p.id = q.rechnungsposition_id
      where q.quelle_typ = 'material' and q.ausgabe_id = $1
      order by q.wirksam desc, r.nummer nulls last`,
    [ausgabeId]);
  return zeilen.map((z) => ({
    rechnungId: z.rechnung_id,
    rechnungNummer: z.nummer,
    rechnungStatus: z.status,
    positionNr: z.position_nr,
    positionBezeichnung: z.bezeichnung,
    wirksam: z.wirksam,
  }));
}

/**
 * Die Steuersatzgruppen, die eine Ausgabe heute tragen kann (V-011).
 *
 * **Nur die gültigen.** `gueltig_bis is null` — eine abgelaufene Gruppe steht
 * auf alten Belegen und gehört nicht in ein Formular für einen neuen: der
 * Satz von 2020 auf eine Quittung von heute zu schreiben, wäre eine
 * Behauptung über eine Steuer, die so nicht entstanden ist.
 */
export interface Steuergruppe {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly satzBp: number;
}

export async function steuergruppen(db: Abfrage): Promise<readonly Steuergruppe[]> {
  const zeilen = await db.abfrage<{
    schluessel: string; bezeichnung: string; satz_bp: number;
  }>(
    `select schluessel, bezeichnung, satz_bp from steuersatz_gruppe
      where gueltig_bis is null order by satz_bp desc, schluessel`);
  return zeilen.map((z) => ({
    schluessel: z.schluessel, bezeichnung: z.bezeichnung, satzBp: z.satz_bp,
  }));
}

/** Die Kassen dieser Gesellschaft — für `zahlungsmittel = 'bar'` (GoBD). */
export interface KasseZeile {
  readonly id: string;
  readonly bezeichnung: string;
}

export async function kassen(db: Abfrage): Promise<readonly KasseZeile[]> {
  const zeilen = await db.abfrage<{ id: string; bezeichnung: string }>(
    `select id, bezeichnung from kasse
      where mandant_id = app.aktiver_mandant() and archiviert_am is null
      order by bezeichnung`);
  return zeilen.map((z) => ({ id: z.id, bezeichnung: z.bezeichnung }));
}
