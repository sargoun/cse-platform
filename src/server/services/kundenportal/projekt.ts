import 'server-only';
import {
  GESELLSCHAFT_SPALTEN, GRENZE,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';

/**
 * Die Bauprojekte eines Kunden (OPS-05, REP-05, 04-SEITENKARTE §8).
 *
 * **Warum nicht `listeProjekte` aus `services/bau/lv.ts`.** Der Dienst
 * projiziert schon kundensicher (keine `auftragssumme_netto_cent`, kein
 * `verantwortlich_benutzer_id`) — es fehlt ihm die Gesellschaft an der Zeile,
 * und er fuehrt eine Spalte mit, die im Kunden-Scope STILL FALSCH ist:
 *
 * `lv_anzahl` zaehlt `leistungsverzeichnis`, und diese Tabelle traegt kein
 * `t_kunde`. Im Kunden-Scope zaehlt die Unterabfrage deshalb 0 — nicht „kein
 * Leistungsverzeichnis", sondern „nicht sichtbar", und die beiden sehen auf
 * dem Bildschirm identisch aus. Eine Null, die nach einer Tatsache aussieht
 * und eine Policy ist, ist schlimmer als eine fehlende Spalte. Sie faellt
 * hier weg (nachgemessen: in der Kundensitzung liefert
 * `select count(*) from leistungsverzeichnis` tatsaechlich 0).
 *
 * `aufmass_anzahl` bleibt, denn `aufmass` TRAEGT `t_kunde` plus
 * `p_portal_decke` — die Zahl ist dort echt. Sie wird gegen dieselbe Decke
 * gezaehlt, die die Nachweisliste benutzt (`status <> 'entwurf'`,
 * `storniert_am is null`), damit die Zahl auf der Uebersicht und die Laenge
 * der Liste dahinter uebereinstimmen.
 *
 * **Was der Kunde auf einem Bauprojekt NICHT sieht, und warum:**
 *
 *  · **Bautagebuch** — `bautagebuch` traegt `p_intern_einsatz_decke` und kein
 *    `t_kunde`; die Abfrage liefe ohnehin leer. Sie wird deshalb gar nicht
 *    erst gestellt: eine leere Liste auf dem Bildschirm behauptet, es sei
 *    nichts geschrieben worden.
 *    // TODO(client, O-78): Bleiben Bautagebuch und Wachbuch dem Kunden
 *    dauerhaft verschlossen, oder gibt es einen kundensichtbaren Auszug
 *    (Wetter, Anwesenheit, Behinderungen) ohne Personenbezug?
 *  · **Nachtraege und Behinderungen** — beide tragen die RESTRIKTIVE Policy
 *    `p_intern_decke` mit `app.portal() = 'intern'` und kein `t_kunde`
 *    (nachgesehen in `pg_policies`, nicht vermutet). Die Datenbank hat die
 *    Frage also schon entschieden, genauso wie beim Bautagebuch — die offene
 *    Frage ist nicht „anschliessen oder nicht", sondern „soll eine Migration
 *    die Decke oeffnen".
 *    // TODO(client, O-674): Sieht der Auftraggeber seine eigenen Nachtraege
 *    (VOB/B § 2) und die an ihn gerichteten Behinderungsanzeigen (VOB/B § 6)
 *    im Portal? Ein Nachtrag beruehrt Geld, eine Behinderungsanzeige ist eine
 *    empfangsbeduerftige Erklaerung — beides braucht eine Entscheidung, bevor
 *    eine Decke geoeffnet wird.
 *  · **Kalkulation, Marge, Stundensaetze, Sicherheitseinbehalt** — nirgends
 *    gelesen. `projekt` fuehrt `auftragssumme_netto_cent`; die Spalte steht
 *    nicht in dieser Abfrage, und RLS wirkt zeilenweise.
 */

export interface Kundenprojekt extends Gesellschaft {
  readonly id: string;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly art: string;
  readonly status: string;
  readonly vertragsgrundlage: string;
  readonly sollBeginnLokal: string | null;
  readonly sollEndeLokal: string | null;
  readonly istBeginnLokal: string | null;
  readonly istEndeLokal: string | null;
  readonly aufmassAnzahl: number;
}

interface ProjektZeile extends GesellschaftRoh {
  readonly id: string;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly art: string;
  readonly status: string;
  readonly vertragsgrundlage: string;
  readonly soll_beginn_lokal: string | null;
  readonly soll_ende_lokal: string | null;
  readonly ist_beginn_lokal: string | null;
  readonly ist_ende_lokal: string | null;
  readonly aufmass_anzahl: number;
}

const SPALTEN = `
  p.id, p.nummer, p.bezeichnung, p.art::text as art, p.status::text as status,
  p.vertragsgrundlage::text as vertragsgrundlage,
  to_char(p.soll_beginn, 'DD.MM.YYYY') as soll_beginn_lokal,
  to_char(p.soll_ende, 'DD.MM.YYYY') as soll_ende_lokal,
  to_char(p.ist_beginn, 'DD.MM.YYYY') as ist_beginn_lokal,
  to_char(p.ist_ende, 'DD.MM.YYYY') as ist_ende_lokal,
  ${GESELLSCHAFT_SPALTEN},
  (select count(*) from aufmass a
    where a.mandant_id = p.mandant_id and a.projekt_id = p.id
      and a.storniert_am is null and a.status <> 'entwurf')::int as aufmass_anzahl`;

const QUELLE = `
  from projekt p
  join mandant m on m.id = p.mandant_id`;

/**
 * Die eigenen Projekte — die naechste Frist zuerst.
 *
 * `soll_ende` ist ein `date` im Berliner Kalender (K-11), also wird es als
 * `date` sortiert und nur fuer die Anzeige formatiert. Nach der Anzeigeform
 * („01.08.2026") sortiert stuende der August vor dem Februar.
 */
export async function listeKundenprojekte(
  kontext: KundenAbfrage,
): Promise<readonly Kundenprojekt[]> {
  const zeilen = await kontext.abfrage<ProjektZeile>(
    `select ${SPALTEN} ${QUELLE}
      where p.archiviert_am is null
      order by p.soll_ende nulls last, p.nummer
      limit ${GRENZE}`,
  );
  return zeilen.map(alsZeile);
}

/**
 * Ein Projekt im Einzelnen.
 *
 * Ein fremdes Projekt liefert `null` — `t_kunde` auf `projekt` bindet die
 * Zeile an `app.aktuelle_kunden()`, und die Seite antwortet `notFound()`,
 * nie 403 (AUT-06, SEC-A3).
 */
export async function findeKundenprojekt(
  kontext: KundenAbfrage, id: string,
): Promise<Kundenprojekt | null> {
  const [z] = await kontext.abfrage<ProjektZeile>(
    `select ${SPALTEN} ${QUELLE}
      where p.id = $1::uuid and p.archiviert_am is null`,
    [id],
  );
  return z === undefined ? null : alsZeile(z);
}

function alsZeile(z: ProjektZeile): Kundenprojekt {
  return {
    id: z.id,
    nummer: z.nummer,
    bezeichnung: z.bezeichnung,
    art: z.art,
    status: z.status,
    vertragsgrundlage: z.vertragsgrundlage,
    sollBeginnLokal: z.soll_beginn_lokal,
    sollEndeLokal: z.soll_ende_lokal,
    istBeginnLokal: z.ist_beginn_lokal,
    istEndeLokal: z.ist_ende_lokal,
    aufmassAnzahl: Number(z.aufmass_anzahl),
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
  };
}
