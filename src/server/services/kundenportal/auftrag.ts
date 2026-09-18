import 'server-only';
import {
  GESELLSCHAFT_SPALTEN, GRENZE,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';

/**
 * Die eigenen Auftraege eines Kunden (OPS-05, OPS-11, CRM-06,
 * 04-SEITENKARTE §8).
 *
 * ===========================================================================
 * Was der Kunde auf seinem Auftrag NICHT sieht — und warum je Spalte
 * ===========================================================================
 *
 * `auftrag` traegt 36 Spalten. Die Policy `t_kunde` (0025) laesst die ZEILE
 * durch, weil sie zu diesem Kunden gehoert; welche SPALTEN daraus
 * herauskommen, entscheidet allein diese Projektion — RLS wirkt zeilen-,
 * nicht spaltenweise. Deshalb steht hier jede Auslassung mit ihrem Grund:
 *
 *  · **`verantwortlich_benutzer_id`** — ein NAME aus dem Haus.
 *    04-SEITENKARTE §8 verschliesst dem Kunden das ganze `personal`-Modul
 *    („no names, no schedules"), und `tests/kern/kundenportal.test.ts` haelt
 *    die Spalte namentlich fern. Wer der Ansprechpartner ist, sagt die
 *    Verwaltung — nicht eine Benutzerkennung.
 *  · **`personalbedarf_anzahl`, `wochenstunden_soll`** — die Besetzung. Das
 *    ist Einsatzplanung und faellt unter dieselbe Zeile von §8. Ausserdem ist
 *    es die Rechengroesse, aus der sich der Stundenansatz ergibt: wer sie
 *    kennt, rechnet die Kalkulation nach.
 *  · **`ausstattung_hinweis`** — ein interner Vermerk fuer die Kolonne
 *    („Schluessel im Hausmeisterbuero, Wagen 3").
 *  · **`sicherheitseinbehalt_bp`, `sicherheitseinbehalt_cent`** — offen
 *    (O-20) und obendrein eine Zahl, die ohne die Vertragsklausel danebensteht
 *    wie ein Abzug ohne Grund.
 *  · **`lead_id`, `erstellt_von`, `geaendert_von`** — Herkunft und Akteure
 *    des Hauses.
 *  · **`auftragswert_netto_cent`** — siehe O-840 unten.
 *
 * // TODO(client, O-840): Sieht ein Kundenzugang die Auftragssumme
 * (`auftrag.auftragswert_netto_cent`) im Portal? Sie steht im
 * unterschriebenen Vertrag, ist also keine Neuigkeit — aber im Portal ist sie
 * eine gepflegte Zahl neben den Rechnungen, und bei einem Rahmenvertrag mit
 * Abrufen bedeutet sie etwas anderes als die Summe der Belege. Bis zur
 * Antwort steht sie in KEINER Abfrage dieser Datei; die Seite nennt
 * stattdessen die Rechnungen, die tatsaechlich gestellt wurden. Dieselbe
 * Zurueckhaltung wie bei `projekt.auftragssumme_netto_cent` (`projekt.ts`).
 *
 * ===========================================================================
 * Was der Kunde SEHR WOHL sieht
 * ===========================================================================
 *
 * Die Leistungszeilen mit ihren vereinbarten Preisen (`auftrag_leistung`,
 * 0050). Das ist kein Widerspruch zu O-840: eine Leistungszeile IST der
 * Vertragsinhalt, Position fuer Position, und der Kunde hat sie
 * unterschrieben. Ein Einkaufspreis oder eine Marge steht dort nicht — die
 * Kalkulation liegt in `kalkulation`, und diese Tabelle wird in diesem Ordner
 * nirgends gelesen (`tests/kern/kundenportal.test.ts` haelt das fest).
 *
 * **`abnahme_am` und `gewaehrleistung_bis` stehen mit Absicht darin.** Die
 * Gewaehrleistungsfrist ist das Recht des Kunden; sie ihm vorzuenthalten
 * waere die falsche Richtung von Zurueckhaltung. Ihre Laenge ist offen
 * (O-68) — die Spalte zeigt, was vereinbart WURDE, und erfindet nichts.
 */

export interface Kundenauftrag extends Gesellschaft {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly art: string;
  readonly status: string;
  readonly objektId: string | null;
  readonly objektBezeichnung: string | null;
  readonly angebotId: string | null;
  readonly angebotsnummer: string | null;
  readonly startDatumLokal: string;
  readonly laufzeitBisLokal: string | null;
  readonly kuendigungsfristTage: number | null;
  readonly verlaengerungAutomatisch: boolean;
  readonly abnahmeAmLokal: string | null;
  readonly gewaehrleistungBisLokal: string | null;
  readonly abgeschlossenAmLokal: string | null;
  /** Wie viele Leistungszeilen sind zum Stichtag in Kraft? */
  readonly leistungenAktiv: number;
}

interface AuftragZeile extends GesellschaftRoh {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly art: string;
  readonly status: string;
  readonly objekt_id: string | null;
  readonly objekt_bezeichnung: string | null;
  readonly angebot_id: string | null;
  readonly angebotsnummer: string | null;
  readonly start_lokal: string;
  readonly laufzeit_lokal: string | null;
  readonly kuendigungsfrist_tage: number | null;
  readonly verlaengerung_automatisch: boolean;
  readonly abnahme_lokal: string | null;
  readonly gewaehrleistung_lokal: string | null;
  readonly abgeschlossen_lokal: string | null;
  readonly leistungen_aktiv: number;
}

/**
 * **`left join angebot`, nicht `join`** — und das ist kein Stilgeschmack.
 *
 * `auftrag.angebot_id` ist nullbar (ein nachtraeglich vereinbarter Auftrag hat
 * keins), UND die Kundendecke auf `angebot` verlangt zusaetzlich
 * `versendet_am is not null` (0024). Ein Auftrag aus einem Angebot, das der
 * Kunde nie bekommen hat — der interne Direktauftrag — traegt also eine
 * `angebot_id`, deren Zeile im Kunden-Scope unsichtbar ist. Mit `join` fiele
 * dieser Auftrag aus der LISTE, nicht bloss aus einer Spalte: der Kunde saehe
 * seinen eigenen laufenden Vertrag nicht, weil ein Angebot dazu nicht
 * versendet wurde. Genau der Fehlermodus, vor dem K-18 warnt.
 *
 * Dasselbe fuer `objekt`: `objekt_id` ist nullbar (ein Rahmenvertrag ueber
 * mehrere Liegenschaften fuehrt seine Standorte an den Leistungszeilen), und
 * `t_kunde` auf `objekt` verlangt `kunde_id = any(app.aktuelle_kunden())` —
 * ein Objekt ohne Kundenzuordnung faellt dort heraus.
 */
const SPALTEN = `
  a.id, a.auftragsnummer, a.bezeichnung, a.beschreibung,
  a.art::text as art, a.status::text as status,
  a.objekt_id, o.bezeichnung as objekt_bezeichnung,
  a.angebot_id, ang.angebotsnummer,
  to_char(a.start_datum, 'DD.MM.YYYY') as start_lokal,
  to_char(a.laufzeit_bis, 'DD.MM.YYYY') as laufzeit_lokal,
  a.kuendigungsfrist_tage, a.verlaengerung_automatisch,
  to_char(a.abnahme_am, 'DD.MM.YYYY') as abnahme_lokal,
  to_char(a.gewaehrleistung_bis, 'DD.MM.YYYY') as gewaehrleistung_lokal,
  to_char(a.abgeschlossen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as abgeschlossen_lokal,
  ${GESELLSCHAFT_SPALTEN},
  /*
   * Die LEBENDEN Leistungszeilen, gegen den Berliner Kalendertag aus der
   * Datenbank (K-11) — nicht gegen current_date der Sitzung und schon gar
   * nicht gegen die Uhr des Node-Prozesses, der in UTC laeuft. gueltig_bis
   * ist EINSCHLIESSLICH (0050 §0.5): >= heute, nicht > heute, sonst
   * verschwindet eine Leistung am Tag ihres letzten Gueltigkeitstages.
   */
  (select count(*) from auftrag_leistung al
    where al.mandant_id = a.mandant_id and al.auftrag_id = a.id
      and al.gueltig_ab <= app.berlin_heute()
      and (al.gueltig_bis is null or al.gueltig_bis >= app.berlin_heute()))::int
    as leistungen_aktiv`;

const QUELLE = `
  from auftrag a
  join mandant m on m.id = a.mandant_id
  left join objekt o on o.mandant_id = a.mandant_id and o.id = a.objekt_id
  left join angebot ang on ang.mandant_id = a.mandant_id and ang.id = a.angebot_id`;

/**
 * Die eigenen Auftraege — der juengste Beginn zuerst.
 *
 * **Kein `where` auf den Kunden.** Der steht in `t_kunde` UND in
 * `p_kunde_decke`; eine dritte Fassung derselben Bedingung hier waere eine,
 * die beim naechsten Umbau von den beiden anderen abweicht.
 *
 * `archiviert_am is null`: ein archivierter Auftrag ist fuer den Kunden
 * beendet. Er wird nicht geloescht (Invariante 8) und er verschwindet auch
 * nicht aus der Datenbank — er verschwindet aus DIESER Liste.
 *
 * Sortiert wird nach dem `date`, nicht nach seiner Anzeigeform: nach
 * „01.08.2026" als Text stuende der August vor dem Februar.
 */
export async function listeKundenauftraege(
  kontext: KundenAbfrage, filter: { readonly mandantSlug?: string | null } = {},
): Promise<readonly Kundenauftrag[]> {
  const slug = filter.mandantSlug ?? null;
  const zeilen = await kontext.abfrage<AuftragZeile>(
    `select ${SPALTEN} ${QUELLE}
      where a.archiviert_am is null
        and ($1::text is null or m.slug = $1::text)
      order by a.start_datum desc, a.auftragsnummer desc
      limit ${GRENZE}`,
    [slug],
  );
  return zeilen.map(alsZeile);
}

/**
 * Ein Auftrag im Einzelnen — oder `null`.
 *
 * Eine fremde Kennung liefert `null`, und die Seite antwortet `notFound()`,
 * nie 403 (AUT-06, SEC-A3): „nicht da" und „nicht erlaubt" muessen von aussen
 * byte-gleich aussehen, sonst ist die Kennung selbst die Auskunft.
 */
export async function findeKundenauftrag(
  kontext: KundenAbfrage, id: string,
): Promise<Kundenauftrag | null> {
  const [z] = await kontext.abfrage<AuftragZeile>(
    `select ${SPALTEN} ${QUELLE}
      where a.id = $1::uuid and a.archiviert_am is null`,
    [id],
  );
  return z === undefined ? null : alsZeile(z);
}

/** Die Gesellschaften, aus denen ueberhaupt ein Auftrag vorliegt — fuer den Filter. */
export async function auftragsGesellschaften(
  kontext: KundenAbfrage,
): Promise<readonly Gesellschaft[]> {
  const zeilen = await kontext.abfrage<GesellschaftRoh>(
    `select distinct ${GESELLSCHAFT_SPALTEN}
       from auftrag a join mandant m on m.id = a.mandant_id
      where a.archiviert_am is null
      order by m.name`,
  );
  return zeilen.map((z) => ({ mandantSlug: z.mandant_slug, mandantName: z.mandant_name }));
}

/* ---------------------------------------------------------------------------
 * Die Leistungszeilen eines Auftrags
 * ------------------------------------------------------------------------ */

export interface Auftragsleistung {
  readonly id: string;
  readonly positionNr: number;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  /** `numeric(12,3)` als TEXT (R-15) — nie durch `Number` gedreht. */
  readonly menge: string | null;
  readonly einheit: string | null;
  /** Ganzzahltext in Cent (Invariante 1, K-16). */
  readonly einzelpreisCent: string | null;
  readonly gesamtpreisCent: string | null;
  readonly steuersatzBp: number;
  readonly steuerKennzeichen: string;
  readonly steuerbefreiungGrund: string | null;
  readonly frequenzText: string | null;
  readonly objektBezeichnung: string | null;
  readonly gueltigAbLokal: string;
  readonly gueltigBisLokal: string | null;
  /** Gilt die Zeile am heutigen Berliner Kalendertag? Aus der Datenbank, nicht gerechnet. */
  readonly inKraft: boolean;
}

interface LeistungZeile {
  readonly id: string;
  readonly position_nr: number;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelpreis_cent: string | null;
  readonly gesamtpreis_cent: string | null;
  readonly steuersatz_bp: number;
  readonly steuer_kennzeichen: string;
  readonly steuerbefreiung_grund: string | null;
  readonly frequenz_text: string | null;
  readonly objekt_bezeichnung: string | null;
  readonly gueltig_ab_lokal: string;
  readonly gueltig_bis_lokal: string | null;
  readonly in_kraft: boolean;
}

/**
 * Was auf diesem Auftrag geschuldet ist — alle Zeilen, auch die abgeloesten.
 *
 * **Und ausdruecklich nicht nur die lebenden.** Eine Preisaenderung ist eine
 * neue Zeile mit neuem `gueltig_ab`; die alte bleibt stehen (0050: „Beendet
 * wird eine Zeile durch `gueltig_bis`, nicht durch DELETE"). Zeigte die
 * Seite nur die heute gueltigen, saehe der Kunde nach einer Anpassung seinen
 * frueheren Preis nirgends mehr — und genau den braucht er, wenn er eine
 * Rechnung aus dem Vorjahr prueft. Die Spalte `in_kraft` trennt die beiden
 * auf dem Bildschirm, statt die eine Haelfte wegzulassen.
 *
 * `erloeskonto_schluessel` bleibt weg: das ist die Kontenzuordnung des Hauses
 * (ACC-01, offen unter O-05) und sagt dem Kunden nichts.
 */
export async function leistungenZumAuftrag(
  kontext: KundenAbfrage, auftragId: string,
): Promise<readonly Auftragsleistung[]> {
  const zeilen = await kontext.abfrage<LeistungZeile>(
    `select al.id, al.position_nr, al.bezeichnung, al.beschreibung,
            al.menge::text as menge, al.einheit,
            al.einzelpreis_cent::text as einzelpreis_cent,
            al.gesamtpreis_cent::text as gesamtpreis_cent,
            al.steuersatz_bp, al.steuer_kennzeichen::text as steuer_kennzeichen,
            al.steuerbefreiung_grund,
            al.leistungsfrequenz_text as frequenz_text,
            o.bezeichnung as objekt_bezeichnung,
            to_char(al.gueltig_ab, 'DD.MM.YYYY') as gueltig_ab_lokal,
            to_char(al.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis_lokal,
            (al.gueltig_ab <= app.berlin_heute()
             and (al.gueltig_bis is null or al.gueltig_bis >= app.berlin_heute()))
              as in_kraft
       from auftrag_leistung al
       left join objekt o on o.mandant_id = al.mandant_id and o.id = al.objekt_id
      where al.auftrag_id = $1::uuid
      order by al.position_nr
      limit ${GRENZE}`,
    [auftragId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    positionNr: Number(z.position_nr),
    bezeichnung: z.bezeichnung,
    beschreibung: z.beschreibung,
    menge: z.menge,
    einheit: z.einheit,
    einzelpreisCent: z.einzelpreis_cent,
    gesamtpreisCent: z.gesamtpreis_cent,
    steuersatzBp: Number(z.steuersatz_bp),
    steuerKennzeichen: z.steuer_kennzeichen,
    steuerbefreiungGrund: z.steuerbefreiung_grund,
    frequenzText: z.frequenz_text,
    objektBezeichnung: z.objekt_bezeichnung,
    gueltigAbLokal: z.gueltig_ab_lokal,
    gueltigBisLokal: z.gueltig_bis_lokal,
    inKraft: z.in_kraft,
  }));
}

function alsZeile(z: AuftragZeile): Kundenauftrag {
  return {
    id: z.id,
    auftragsnummer: z.auftragsnummer,
    bezeichnung: z.bezeichnung,
    beschreibung: z.beschreibung,
    art: z.art,
    status: z.status,
    objektId: z.objekt_id,
    objektBezeichnung: z.objekt_bezeichnung,
    angebotId: z.angebot_id,
    angebotsnummer: z.angebotsnummer,
    startDatumLokal: z.start_lokal,
    laufzeitBisLokal: z.laufzeit_lokal,
    kuendigungsfristTage: z.kuendigungsfrist_tage === null
      ? null : Number(z.kuendigungsfrist_tage),
    verlaengerungAutomatisch: z.verlaengerung_automatisch,
    abnahmeAmLokal: z.abnahme_lokal,
    gewaehrleistungBisLokal: z.gewaehrleistung_lokal,
    abgeschlossenAmLokal: z.abgeschlossen_lokal,
    leistungenAktiv: Number(z.leistungen_aktiv),
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
  };
}
