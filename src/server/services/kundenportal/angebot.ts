import 'server-only';
import {
  GESELLSCHAFT_SPALTEN, GRENZE,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';
import { lebendeLeistungenZahl } from '../angebot/lebend.js';

/**
 * Die eigenen Angebote eines Kunden (OPS-08, OPS-09, 04-SEITENKARTE §8).
 *
 * ===========================================================================
 * Ein Entwurf ist hier strukturell unerreichbar
 * ===========================================================================
 *
 * `t_kunde` UND `p_kunde_decke` auf `angebot` verlangen beide
 * `versendet_am is not null` (0024) — und dieselbe Bedingung steht ueber
 * `angebotsposition` und `angebot_steuer`. Ein Angebot, das das Haus nie
 * verlassen hat, ist im Kunden-Scope keine Zeile, nicht eine Zeile mit
 * weniger Spalten. Nachgemessen gegen eine echte Kundensitzung: von zwei
 * Angeboten desselben Kunden — eines versendet, eines Entwurf — liefert
 * `select count(*) from angebot` genau 1.
 *
 * Das ist mehr wert als eine `where`-Bedingung in dieser Datei: ein Entwurf
 * ist ein Preis, an dem noch gerechnet wird. Ihn dem Kunden zu zeigen hiesse,
 * ein Angebot abzugeben, das niemand freigegeben hat — und Invariante 7 sagt,
 * dass nichts das Haus ohne benannte menschliche Freigabe verlaesst.
 *
 * **Und deshalb steht hier auch KEIN `where a.status = 'versendet'`.** Ein
 * versendetes Angebot, das der Kunde ABGELEHNT hat, traegt `status =
 * 'abgelehnt'` und bleibt sichtbar; ein zurueckgezogenes ebenso. Beides ist
 * Vorgangsgeschichte, die dem Kunden gehoert. Die Seite nennt den Zustand;
 * sie versteckt ihn nicht.
 *
 * ===========================================================================
 * Was NICHT in der Projektion steht
 * ===========================================================================
 *
 *  · **`entscheidung_notiz`** — der interne Vermerk zur Entscheidung („Kunde
 *    wollte 8 % runter, Leitung sagt nein"). Ein Vermerk ueber den Kunden ist
 *    kein Vermerk fuer den Kunden.
 *  · **`freigegeben_von`, `versendet_von`, `erstellt_von`** — Namen aus dem
 *    Haus (§8).
 *  · **`akteur_art`** — ob ein Agent den Entwurf geschrieben hat, ist eine
 *    interne Protokollangabe. Sie ist ausserdem irrefuehrend: freigegeben und
 *    versendet hat in jedem Fall ein Mensch (Invariante 7).
 *  · **`kalkulation`** — nirgends gelesen, in keiner Abfrage dieses Ordners.
 *    Dort stehen Stundenverrechnungssatz, Gemeinkosten- und Wagniszuschlag:
 *    die Marge in vier Spalten.
 *  · **`ersetzt_angebot_id` als Sprungziel** — die VORGAENGERnummer steht in
 *    der Projektion, weil „dies ist Fassung 2 von AN-2026-014" eine Auskunft
 *    ist, die der Kunde braucht. Ein Verweis auf die Detailseite der
 *    Vorgaengerfassung entsteht daraus trotzdem nicht: der Vorgaenger kann
 *    ein ENTWURF gewesen sein (eine interne Fassung, die nie hinausging), und
 *    dann stuende hinter dem Verweis 404. Die Nummer ist `null`, wenn der
 *    Vorgaenger keine trug — und dann steht auch nichts da.
 */

export interface Kundenangebot extends Gesellschaft {
  readonly id: string;
  /** NIE null in dieser Liste: `angebot_nummer_bei_versand` koppelt Nummer und Versand. */
  readonly angebotsnummer: string;
  readonly titel: string;
  readonly status: string;
  readonly version: number;
  readonly ersetztNummer: string | null;
  readonly objektBezeichnung: string | null;
  readonly versendetAmLokal: string;
  readonly gueltigBisLokal: string | null;
  /**
   * Tage bis zum Ende der Bindefrist, aus der Datenbank gegen
   * `app.berlin_heute()` gerechnet (K-11). Negativ heisst „vorbei".
   */
  readonly tageBisAblauf: number | null;
  readonly leistungVonLokal: string | null;
  readonly leistungBisLokal: string | null;
  /** Ganzzahltext in Cent (Invariante 1, K-16) — die Summe der Leistungspositionen. */
  readonly nettoCent: string;
  readonly entschiedenAmLokal: string | null;
  readonly positionen: number;
}

interface AngebotZeile extends GesellschaftRoh {
  readonly id: string;
  readonly angebotsnummer: string;
  readonly titel: string;
  readonly status: string;
  readonly version: number;
  readonly ersetzt_nummer: string | null;
  readonly objekt_bezeichnung: string | null;
  readonly versendet_lokal: string;
  readonly gueltig_bis_lokal: string | null;
  readonly tage_bis_ablauf: number | null;
  readonly leistung_von_lokal: string | null;
  readonly leistung_bis_lokal: string | null;
  readonly netto_cent: string;
  readonly entschieden_lokal: string | null;
  readonly positionen: number;
}

const SPALTEN = `
  a.id, a.angebotsnummer, a.titel, a.status::text as status, a.version,
  vor.angebotsnummer as ersetzt_nummer,
  o.bezeichnung as objekt_bezeichnung,
  to_char(a.versendet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as versendet_lokal,
  to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis_lokal,
  (a.gueltig_bis - app.berlin_heute())::int as tage_bis_ablauf,
  to_char(a.leistungszeitraum_von, 'DD.MM.YYYY') as leistung_von_lokal,
  to_char(a.leistungszeitraum_bis, 'DD.MM.YYYY') as leistung_bis_lokal,
  a.netto_cent::text as netto_cent,
  to_char(a.entschieden_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as entschieden_lokal,
  ${GESELLSCHAFT_SPALTEN},
  ${lebendeLeistungenZahl('a')}::int as positionen`;

/**
 * `left join angebot vor` — der Vorgaenger kann ein ENTWURF sein.
 *
 * Eine zweite Fassung entsteht, weil die erste geaendert werden musste; ob
 * die erste je versendet wurde, ist offen. Mit `join` verschwaende die ganze
 * Zeile, sobald der Vorgaenger im Kunden-Scope unsichtbar ist — das Angebot,
 * das der Kunde in der Hand haelt, waere nicht in seiner Liste.
 */
const QUELLE = `
  from angebot a
  join mandant m on m.id = a.mandant_id
  left join objekt o on o.mandant_id = a.mandant_id and o.id = a.objekt_id
  left join angebot vor on vor.mandant_id = a.mandant_id and vor.id = a.ersetzt_angebot_id`;

/** Die eigenen Angebote — das zuletzt versendete zuerst. */
export async function listeKundenangebote(
  kontext: KundenAbfrage, filter: { readonly mandantSlug?: string | null } = {},
): Promise<readonly Kundenangebot[]> {
  const slug = filter.mandantSlug ?? null;
  const zeilen = await kontext.abfrage<AngebotZeile>(
    `select ${SPALTEN} ${QUELLE}
      where a.archiviert_am is null
        and ($1::text is null or m.slug = $1::text)
      order by a.versendet_am desc, a.angebotsnummer desc
      limit ${GRENZE}`,
    [slug],
  );
  return zeilen.map(alsZeile);
}

/** Ein Angebot im Einzelnen — eine fremde Kennung liefert `null` (AUT-06). */
export async function findeKundenangebot(
  kontext: KundenAbfrage, id: string,
): Promise<Kundenangebot | null> {
  const [z] = await kontext.abfrage<AngebotZeile>(
    `select ${SPALTEN} ${QUELLE}
      where a.id = $1::uuid and a.archiviert_am is null`,
    [id],
  );
  return z === undefined ? null : alsZeile(z);
}

/** Der begleitende Text des Angebots — getrennt geholt, weil nur das Blatt ihn braucht. */
export async function angebotsTexte(
  kontext: KundenAbfrage, id: string,
): Promise<{ readonly einleitung: string | null; readonly schluss: string | null } | null> {
  const [z] = await kontext.abfrage<{
    einleitungstext: string | null; schlusstext: string | null;
  }>(
    `select a.einleitungstext, a.schlusstext from angebot a where a.id = $1::uuid`,
    [id],
  );
  return z === undefined ? null : { einleitung: z.einleitungstext, schluss: z.schlusstext };
}

/** Die Gesellschaften, aus denen ueberhaupt ein Angebot vorliegt — fuer den Filter. */
export async function angebotsGesellschaften(
  kontext: KundenAbfrage,
): Promise<readonly Gesellschaft[]> {
  const zeilen = await kontext.abfrage<GesellschaftRoh>(
    `select distinct ${GESELLSCHAFT_SPALTEN}
       from angebot a join mandant m on m.id = a.mandant_id
      where a.archiviert_am is null
      order by m.name`,
  );
  return zeilen.map((z) => ({ mandantSlug: z.mandant_slug, mandantName: z.mandant_name }));
}

/* ---------------------------------------------------------------------------
 * Positionen und Steuerzeilen
 * ------------------------------------------------------------------------ */

export interface Angebotsposition {
  readonly id: string;
  readonly positionNr: number;
  readonly oz: string | null;
  readonly typ: string;
  readonly kurztext: string;
  readonly langtext: string | null;
  /** `numeric(12,3)` als TEXT (R-15). */
  readonly menge: string | null;
  readonly einheit: string | null;
  /** Ganzzahltext in Cent (Invariante 1). */
  readonly einzelpreisCent: string | null;
  readonly gesamtpreisCent: string | null;
  readonly steuersatzBp: number;
  readonly steuerKennzeichen: string;
  readonly steuerbefreiungGrund: string | null;
  readonly objektBezeichnung: string | null;
}

interface PositionZeile {
  readonly id: string;
  readonly position_nr: number;
  readonly oz: string | null;
  readonly typ: string;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelpreis_cent: string | null;
  readonly gesamtpreis_cent: string | null;
  readonly steuersatz_bp: number;
  readonly steuer_kennzeichen: string;
  readonly steuerbefreiung_grund: string | null;
  readonly objekt_bezeichnung: string | null;
}

/**
 * Die Positionen — in der Reihenfolge des Angebots.
 *
 * `order by p.sortierung, p.position_nr`: `sortierung` ist die Reihenfolge,
 * die der Verfasser gesetzt hat, `position_nr` die stabile Nummer darunter.
 * Nur nach der Nummer sortiert stuende eine nachtraeglich eingeschobene
 * Position am Ende — auf dem Papier, das der Kunde bekommen hat, steht sie
 * aber in der Mitte, und zwei Reihenfolgen fuer dasselbe Angebot sind eine zu
 * viel.
 *
 * `leistungskatalog_position_id` bleibt weg: welche Katalogzeile intern
 * dahintersteht, ist Kalkulationsgrundlage und keine Vertragsangabe. Der
 * Kunde liest `kurztext` und `langtext` — genau das, was im Angebot stand.
 */
export async function positionenZumAngebot(
  kontext: KundenAbfrage, angebotId: string,
): Promise<readonly Angebotsposition[]> {
  const zeilen = await kontext.abfrage<PositionZeile>(
    `select p.id, p.position_nr, p.oz, p.typ::text as typ, p.kurztext, p.langtext,
            p.menge::text as menge, p.einheit,
            p.einzelpreis_cent::text as einzelpreis_cent,
            p.gesamtpreis_cent::text as gesamtpreis_cent,
            p.steuersatz_bp, p.steuer_kennzeichen::text as steuer_kennzeichen,
            p.steuerbefreiung_grund,
            o.bezeichnung as objekt_bezeichnung
       from angebotsposition p
       left join objekt o on o.mandant_id = p.mandant_id and o.id = p.objekt_id
      where p.angebot_id = $1::uuid and p.entfernt_am is null
      order by p.sortierung, p.position_nr
      limit ${GRENZE}`,
    [angebotId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    positionNr: Number(z.position_nr),
    oz: z.oz,
    typ: z.typ,
    kurztext: z.kurztext,
    langtext: z.langtext,
    menge: z.menge,
    einheit: z.einheit,
    einzelpreisCent: z.einzelpreis_cent,
    gesamtpreisCent: z.gesamtpreis_cent,
    steuersatzBp: Number(z.steuersatz_bp),
    steuerKennzeichen: z.steuer_kennzeichen,
    steuerbefreiungGrund: z.steuerbefreiung_grund,
    objektBezeichnung: z.objekt_bezeichnung,
  }));
}

export interface Angebotssteuer {
  readonly steuersatzBp: number;
  readonly steuerKennzeichen: string;
  /** Ganzzahltext in Cent (Invariante 1). */
  readonly nettoCent: string;
  readonly steuerCent: string;
  readonly hinweistext: string | null;
}

/**
 * Die Steuerzeilen — GELESEN, nie gerechnet.
 *
 * Sie entstehen beim Versand (`kern.angebot_versand_festschreiben`, 0024) und
 * sind danach unveraenderlich. Die Umsatzsteuer steht JE STEUERSATZGRUPPE;
 * sie hier aus der Nettosumme nachzubilden waere genau der Weg, den
 * Invariante 1 ausschliesst — und obendrein eine zweite Wahrheit neben der
 * festgeschriebenen.
 *
 * Es gibt auf dem Angebot bewusst KEIN `brutto_cent` (0024). Die Bruttosumme
 * ist die Summe aus `netto_cent` und den `steuer_cent` dieser Zeilen; sie
 * wird in der Datenbank gebildet (`angebotsSummen`), nicht in der Seite —
 * CLAUDE.md: „No calculation in a component, ever".
 */
export async function steuernZumAngebot(
  kontext: KundenAbfrage, angebotId: string,
): Promise<readonly Angebotssteuer[]> {
  const zeilen = await kontext.abfrage<{
    steuersatz_bp: number; steuer_kennzeichen: string;
    netto_cent: string; steuer_cent: string; hinweistext: string | null;
  }>(
    `select s.steuersatz_bp, s.steuer_kennzeichen::text as steuer_kennzeichen,
            s.netto_cent::text as netto_cent, s.steuer_cent::text as steuer_cent,
            s.hinweistext
       from angebot_steuer s
      where s.angebot_id = $1::uuid
      order by s.steuersatz_bp desc, s.steuer_kennzeichen`,
    [angebotId],
  );
  return zeilen.map((z) => ({
    steuersatzBp: Number(z.steuersatz_bp),
    steuerKennzeichen: z.steuer_kennzeichen,
    nettoCent: z.netto_cent,
    steuerCent: z.steuer_cent,
    hinweistext: z.hinweistext,
  }));
}

export interface Angebotssummen {
  /** Ganzzahltext in Cent (Invariante 1). */
  readonly nettoCent: string;
  readonly steuerCent: string;
  readonly bruttoCent: string;
}

/**
 * Netto, Steuer und Brutto — in der Datenbank gebildet, in `bigint`.
 *
 * **Warum nicht in TypeScript ueber die Steuerzeilen summiert.** Es ginge mit
 * `BigInt`, und es waere trotzdem eine zweite Stelle, an der eine Summe
 * entsteht. Die Steuerzeilen kommen bereits gruppiert aus der Datenbank; die
 * Summe darueber gehoert dorthin, wo auch die Gruppierung entstand. Ein
 * `sum()` in Postgres ueber `bigint` ist exakt — es gibt keinen Zwischenwert
 * in einer Gleitkommazahl.
 *
 * `coalesce(..., 0)`: ein Angebot ohne Steuerzeile ist moeglich (alle
 * Positionen sind Textzeilen), und `sum()` ueber die leere Menge ist NULL,
 * nicht 0. Ohne das `coalesce` stuende auf dem Blatt „NaN EUR" — oder die
 * Seite fiele an `BigInt(null)`.
 */
export async function angebotsSummen(
  kontext: KundenAbfrage, angebotId: string,
): Promise<Angebotssummen> {
  const [z] = await kontext.abfrage<{
    netto: string; steuer: string; brutto: string;
  }>(
    `select a.netto_cent::text as netto,
            coalesce(s.steuer, 0)::text as steuer,
            (a.netto_cent + coalesce(s.steuer, 0))::text as brutto
       from angebot a
       left join (select angebot_steuer.angebot_id, sum(angebot_steuer.steuer_cent) as steuer
                    from angebot_steuer
                   where angebot_steuer.angebot_id = $1::uuid
                   group by angebot_steuer.angebot_id) s on s.angebot_id = a.id
      where a.id = $1::uuid`,
    [angebotId],
  );
  return {
    nettoCent: z?.netto ?? '0',
    steuerCent: z?.steuer ?? '0',
    bruttoCent: z?.brutto ?? '0',
  };
}

/* ---------------------------------------------------------------------------
 * Die Bindefrist als Satz
 * ------------------------------------------------------------------------ */

/**
 * „Noch 12 Tage" / „Heute letzter Tag" / „Seit 3 Tagen abgelaufen".
 *
 * **Eine reine Funktion, und deshalb geprueft** (`tests/kern/`). Die ZAHL
 * kommt aus der Datenbank (`a.gueltig_bis - app.berlin_heute()`), weil ein
 * Kalendertag in Berlin nicht der Kalendertag des Node-Prozesses ist, der in
 * UTC laeuft (K-11): am 1. eines Monats um 00:30 Berliner Zeit waere „heute"
 * der Vortag, und die Bindefrist um einen Tag falsch.
 *
 * **Was dieser Satz NICHT tut: er aendert keinen Zustand.** `angebot_status`
 * kennt `abgelaufen` als eigenen Wert; ob ein versendetes Angebot nach
 * `gueltig_bis` von selbst dorthin wandert, ist nicht entschieden — es gibt
 * heute keinen Lauf, der das tut (nachgesehen in `src/server/jobs/`). Die
 * Seite zeigt den gespeicherten Zustand UND diesen Satz nebeneinander; sie
 * leitet aus dem Datum keinen Zustand ab.
 *
 * // TODO(client, O-842): Gilt ein versendetes Angebot nach Ablauf von
 * `gueltig_bis` automatisch als `abgelaufen` — und wer stellt das fest, ein
 * naechtlicher Lauf oder die Sachbearbeitung? Solange die Frage offen ist,
 * bleibt der Zustand in der Datenbank stehen, wie ein Mensch ihn gesetzt hat,
 * und der Kunde liest das Datum daneben.
 */
export function bindefristText(tage: number | null): string | null {
  if (tage === null) return null;
  if (tage > 1) return `noch ${String(tage)} Tage`;
  if (tage === 1) return 'noch 1 Tag';
  if (tage === 0) return 'heute letzter Tag';
  if (tage === -1) return 'seit 1 Tag abgelaufen';
  return `seit ${String(-tage)} Tagen abgelaufen`;
}

/** Ist die Bindefrist vorbei? `null` heisst „keine Frist vereinbart", nicht „vorbei". */
export function bindefristVorbei(tage: number | null): boolean {
  return tage !== null && tage < 0;
}

function alsZeile(z: AngebotZeile): Kundenangebot {
  return {
    id: z.id,
    angebotsnummer: z.angebotsnummer,
    titel: z.titel,
    status: z.status,
    version: Number(z.version),
    ersetztNummer: z.ersetzt_nummer,
    objektBezeichnung: z.objekt_bezeichnung,
    versendetAmLokal: z.versendet_lokal,
    gueltigBisLokal: z.gueltig_bis_lokal,
    tageBisAblauf: z.tage_bis_ablauf === null ? null : Number(z.tage_bis_ablauf),
    leistungVonLokal: z.leistung_von_lokal,
    leistungBisLokal: z.leistung_bis_lokal,
    nettoCent: z.netto_cent,
    entschiedenAmLokal: z.entschieden_lokal,
    positionen: Number(z.positionen),
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
  };
}
