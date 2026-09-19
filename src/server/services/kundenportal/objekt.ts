import 'server-only';
import {
  GESELLSCHAFT_SPALTEN, GRENZE,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';

/**
 * Die eigenen Liegenschaften eines Kunden und ihr Raumbuch (OPS-01, OPS-02,
 * 04-SEITENKARTE §8: „their objects, Raumbuch read-only").
 *
 * ===========================================================================
 * Warum `belagsart` und `reinigungsklasse` NICHT mitkommen
 * ===========================================================================
 *
 * Das Raumbuch fuehrt je Raum eine `belagsart_id` und eine
 * `reinigungsklasse_id`. Der naheliegende `left join` auf die beiden Kataloge
 * waere hier ein Fehler mit zwei Schichten:
 *
 *  1. **Die Zeilen kaemen nicht.** Beide Kataloge tragen eine RESTRIKTIVE
 *     Decke, die sie aus dem Kundenportal heraushaelt, und kein `t_kunde`
 *     (0021). Nachgemessen in einer echten Kundensitzung: `select count(*)
 *     from belagsart` liefert 0. Ein `left join` ergaebe also fuer JEDEN Raum
 *     „—" in der Spalte „Belag" — und das liest sich wie „kein Belag
 *     erfasst", obwohl das Raumbuch vollstaendig gepflegt ist. Genau der
 *     Fehlermodus, vor dem K-18 warnt: eine leere Zelle, die eine Policy ist
 *     und wie eine Tatsache aussieht.
 *  2. **Sie sollen auch nicht kommen.** 0021 sagt es woertlich: der Katalog
 *     ist die Kalkulationsgrundlage, „welcher Belag in welcher Klasse liegt
 *     und mit welchem Wert gerechnet wird, ist Verhandlungsstoff — im
 *     Kundenportal ist er es gegen uns". `leistungswert_qm_pro_stunde` ist
 *     dem `cse_app` sogar SPALTENWEISE entzogen.
 *
 * Die Spalten stehen deshalb in keiner Abfrage dieser Datei, und die Seite
 * behauptet nicht, es gaebe sie nicht — sie zeigt sie schlicht nicht.
 *
 * ===========================================================================
 * Was am Objekt selbst wegbleibt
 * ===========================================================================
 *
 *  · **`zutritt_hinweis`** — die Zutrittsanweisung fuer die Kolonne
 *    („Schluessel im Schluesselkasten, Code beim Objektleiter"). Das ist eine
 *    Sicherheitsangabe des Hauses; sie im Portal auszugeben hiesse, sie an
 *    jeden Kundenzugang zu geben, der je ausgestellt wird.
 *  · **`bemerkung`** — der interne Vermerk am Objekt.
 *  · **`ansprechpartner_id`** — die Kontaktzeile des Kunden gehoert ihm zwar,
 *    aber sie steht im CRM und nicht in einer Objektliste; ein Name in einer
 *    Objektzeile ist eine Auskunft, die ohne Zusammenhang dasteht.
 *  · **`geo_lat` / `geo_lon`** — die Koordinaten dienen der Einsatzsteuerung
 *    (Anfahrt, Geofence beim Check-in). Die ANSCHRIFT steht in der
 *    Projektion; sie ist es, was der Kunde wiedererkennt.
 *  · **`erstellt_von`, `geaendert_von`** — Akteure des Hauses (§8).
 *
 * `raum.bemerkung` faellt aus demselben Grund weg wie `objekt.bemerkung`, und
 * `raum.quell_schluessel` ist der Idempotenzschluessel des Importeurs — eine
 * technische Angabe ohne Bedeutung ausserhalb des Imports.
 */

export interface Kundenobjekt extends Gesellschaft {
  readonly id: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly gebaeudetyp: string | null;
  readonly strasse: string;
  readonly hausnummer: string | null;
  readonly adresszusatz: string | null;
  readonly plz: string;
  readonly ort: string;
  readonly etagenAnzahl: number | null;
  readonly raeume: number;
  /** `numeric(12,3)` als TEXT (R-15) — die Summe entsteht in der Datenbank. */
  readonly flaecheQm: string;
  readonly fensterFlaecheQm: string | null;
  readonly auftraegeAktiv: number;
}

interface ObjektZeile extends GesellschaftRoh {
  readonly id: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly gebaeudetyp: string | null;
  readonly strasse: string;
  readonly hausnummer: string | null;
  readonly adresszusatz: string | null;
  readonly plz: string;
  readonly ort: string;
  readonly etagen_anzahl: number | null;
  readonly raeume: number;
  readonly flaeche_qm: string;
  readonly fenster_flaeche_qm: string | null;
  readonly auftraege_aktiv: number;
}

/**
 * **Die Flaechensumme entsteht in Postgres, nicht in der Seite.**
 *
 * `flaeche_qm` ist `numeric(12,3)`; die Summe in JavaScript zu bilden hiesse,
 * die Werte durch `Number` zu drehen — und 24,5 + 0,1 ist dort nicht 24,6
 * (K-16, R-15). `sum()` ueber `numeric` ist exakte Dezimalarithmetik. Der
 * Rueckweg ist Text, und die Seite laesst ihn durch
 * `formatiereMenge(mengeAusPostgres(...))` laufen.
 *
 * `coalesce(..., 0)` auf der Bodenflaeche: ein Objekt ohne Raumbuch ist
 * moeglich (es wurde noch nicht aufgenommen), und `sum()` ueber die leere
 * Menge ist NULL. Ohne das `coalesce` fiele `mengeAusPostgres(null)`.
 *
 * Auf der FENSTERflaeche steht bewusst KEIN `coalesce`: `fenster_flaeche_qm`
 * ist nullbar, weil sie nur dort gepflegt wird, wo Glasreinigung vereinbart
 * ist (CLN-05). „0,000 m² Glas" und „Glas nicht erfasst" sind zwei
 * verschiedene Auskuenfte, und die erste waere hier gelogen.
 */
const SPALTEN = `
  o.id, o.objektnummer, o.bezeichnung, o.gebaeudetyp,
  o.strasse, o.hausnummer, o.adresszusatz, o.plz, o.ort, o.etagen_anzahl,
  ${GESELLSCHAFT_SPALTEN},
  (select count(*) from raum r
    where r.mandant_id = o.mandant_id and r.objekt_id = o.id
      and r.archiviert_am is null)::int as raeume,
  (select coalesce(sum(r.flaeche_qm), 0)::text from raum r
    where r.mandant_id = o.mandant_id and r.objekt_id = o.id
      and r.archiviert_am is null) as flaeche_qm,
  (select sum(r.fenster_flaeche_qm)::text from raum r
    where r.mandant_id = o.mandant_id and r.objekt_id = o.id
      and r.archiviert_am is null) as fenster_flaeche_qm,
  (select count(*) from auftrag a
    where a.mandant_id = o.mandant_id and a.objekt_id = o.id
      and a.archiviert_am is null and a.status in ('angelegt','aktiv','pausiert'))::int
    as auftraege_aktiv`;

const QUELLE = `
  from objekt o
  join mandant m on m.id = o.mandant_id`;

/**
 * Die eigenen Objekte — nach Ort und Bezeichnung.
 *
 * Nicht nach `objektnummer`: die Nummer ist der Schluessel des Hauses
 * („O-2026-014"), und eine Liste danach sortiert steht in einer Reihenfolge,
 * die der Kunde nicht kennt. Er sucht „Friedrichstrasse" oder „Bürohaus
 * Mitte".
 */
export async function listeKundenobjekte(
  kontext: KundenAbfrage, filter: { readonly mandantSlug?: string | null } = {},
): Promise<readonly Kundenobjekt[]> {
  const slug = filter.mandantSlug ?? null;
  const zeilen = await kontext.abfrage<ObjektZeile>(
    `select ${SPALTEN} ${QUELLE}
      where o.archiviert_am is null
        and ($1::text is null or m.slug = $1::text)
      order by o.ort, o.bezeichnung, o.objektnummer
      limit ${GRENZE}`,
    [slug],
  );
  return zeilen.map(alsZeile);
}

/** Ein Objekt im Einzelnen — eine fremde Kennung liefert `null` (AUT-06). */
export async function findeKundenobjekt(
  kontext: KundenAbfrage, id: string,
): Promise<Kundenobjekt | null> {
  const [z] = await kontext.abfrage<ObjektZeile>(
    `select ${SPALTEN} ${QUELLE}
      where o.id = $1::uuid and o.archiviert_am is null`,
    [id],
  );
  return z === undefined ? null : alsZeile(z);
}

/** Die Gesellschaften, die an diesem Zugang ueberhaupt ein Objekt betreuen. */
export async function objektGesellschaften(
  kontext: KundenAbfrage,
): Promise<readonly Gesellschaft[]> {
  const zeilen = await kontext.abfrage<GesellschaftRoh>(
    `select distinct ${GESELLSCHAFT_SPALTEN}
       from objekt o join mandant m on m.id = o.mandant_id
      where o.archiviert_am is null
      order by m.name`,
  );
  return zeilen.map((z) => ({ mandantSlug: z.mandant_slug, mandantName: z.mandant_name }));
}

/* ---------------------------------------------------------------------------
 * Das Raumbuch
 * ------------------------------------------------------------------------ */

export interface Kundenraum {
  readonly id: string;
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly nutzungsart: string | null;
  /** `numeric(12,3)` als TEXT (R-15). */
  readonly flaecheQm: string;
  readonly fensterFlaecheQm: string | null;
}

/**
 * Das Raumbuch eines Objekts — lesend, vollstaendig, ohne Katalogspalten.
 *
 * **Die Sortierung ist die des Raumbuchs und nicht die der Datenbank.**
 * `sortierung` setzt der Importeur oder die Objektleitung; darunter die Etage
 * und die Raumnummer. Eine Liste, die nach `id` oder `erstellt_am` kaeme,
 * saehe bei jedem Neuladen gleich aus und trotzdem zufaellig — und ein
 * Raumbuch liest man nicht am Stueck, sondern Etage fuer Etage.
 *
 * **`nulls first` auf der Etage** ist Absicht: das Untergeschoss traegt „UG",
 * nicht NULL — ein Raum OHNE Etage ist der, den niemand zugeordnet hat, und
 * der gehoert nach oben, wo er auffaellt, nicht ans Ende, wo er untergeht.
 */
export async function raeumeZumObjekt(
  kontext: KundenAbfrage, objektId: string,
): Promise<readonly Kundenraum[]> {
  const zeilen = await kontext.abfrage<{
    id: string; raumnummer: string | null; bezeichnung: string | null;
    etage: string | null; nutzungsart: string | null;
    flaeche_qm: string; fenster_flaeche_qm: string | null;
  }>(
    `select r.id, r.raumnummer, r.bezeichnung, r.etage, r.nutzungsart,
            r.flaeche_qm::text as flaeche_qm,
            r.fenster_flaeche_qm::text as fenster_flaeche_qm
       from raum r
      where r.objekt_id = $1::uuid and r.archiviert_am is null
      order by r.sortierung, r.etage nulls first, r.raumnummer nulls last, r.bezeichnung
      limit ${GRENZE}`,
    [objektId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    raumnummer: z.raumnummer,
    bezeichnung: z.bezeichnung,
    etage: z.etage,
    nutzungsart: z.nutzungsart,
    flaecheQm: z.flaeche_qm,
    fensterFlaecheQm: z.fenster_flaeche_qm,
  }));
}

/* ---------------------------------------------------------------------------
 * Die Auftraege an diesem Objekt
 * ------------------------------------------------------------------------ */

export interface ObjektAuftrag {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly art: string;
  readonly status: string;
  readonly startDatumLokal: string;
  readonly laufzeitBisLokal: string | null;
}

/**
 * Welche Auftraege an diesem Standort laufen — der Weg von der Liegenschaft
 * zum Vertrag.
 *
 * Zwei Wege fuehren hierher, und beide zaehlen: `auftrag.objekt_id` (der
 * Einzelauftrag an genau diesem Haus) und `auftrag_leistung.objekt_id` (der
 * Rahmenvertrag ueber mehrere Liegenschaften, der seine Standorte an den
 * Zeilen fuehrt — 0050 sagt das ausdruecklich). Nur der erste gefragt, fehlte
 * dem Kunden mit einem Rahmenvertrag auf jeder Objektseite der Vertrag, unter
 * dem sein Haus betreut wird.
 *
 * **Ein `or` mit `exists`, kein `union` und kein `join`.** Ein Auftrag kann
 * beide Wege zugleich gehen — Kopf am Objekt UND eine Leistungszeile darauf,
 * und bei einem Rahmenvertrag sogar mehrere Zeilen. Ein `join` auf
 * `auftrag_leistung` gaebe denselben Auftrag dann so oft, wie er Zeilen an
 * diesem Standort hat; ein `union` brauchte zwei Abfragen mit zwei
 * Projektionen, die auseinanderlaufen koennen. `exists` ist ein Praedikat
 * ueber EINE Zeile und vervielfacht nichts — deshalb steht hier auch kein
 * `distinct`, das den Fehler nur zudecken wuerde.
 */
export async function auftraegeZumObjekt(
  kontext: KundenAbfrage, objektId: string,
): Promise<readonly ObjektAuftrag[]> {
  const zeilen = await kontext.abfrage<{
    id: string; auftragsnummer: string; bezeichnung: string;
    art: string; status: string;
    start_lokal: string; laufzeit_lokal: string | null;
  }>(
    `select a.id, a.auftragsnummer, a.bezeichnung,
            a.art::text as art, a.status::text as status,
            to_char(a.start_datum, 'DD.MM.YYYY') as start_lokal,
            to_char(a.laufzeit_bis, 'DD.MM.YYYY') as laufzeit_lokal
       from auftrag a
      where a.archiviert_am is null
        and (a.objekt_id = $1::uuid
             or exists (select 1 from auftrag_leistung al
                         where al.mandant_id = a.mandant_id and al.auftrag_id = a.id
                           and al.objekt_id = $1::uuid))
      order by a.start_datum desc, a.auftragsnummer desc
      limit ${GRENZE}`,
    [objektId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    auftragsnummer: z.auftragsnummer,
    bezeichnung: z.bezeichnung,
    art: z.art,
    status: z.status,
    startDatumLokal: z.start_lokal,
    laufzeitBisLokal: z.laufzeit_lokal,
  }));
}

function alsZeile(z: ObjektZeile): Kundenobjekt {
  return {
    id: z.id,
    objektnummer: z.objektnummer,
    bezeichnung: z.bezeichnung,
    gebaeudetyp: z.gebaeudetyp,
    strasse: z.strasse,
    hausnummer: z.hausnummer,
    adresszusatz: z.adresszusatz,
    plz: z.plz,
    ort: z.ort,
    etagenAnzahl: z.etagen_anzahl === null ? null : Number(z.etagen_anzahl),
    raeume: Number(z.raeume),
    flaecheQm: z.flaeche_qm,
    fensterFlaecheQm: z.fenster_flaeche_qm,
    auftraegeAktiv: Number(z.auftraege_aktiv),
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
  };
}
