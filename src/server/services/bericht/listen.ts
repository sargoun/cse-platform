import type { LeseKontext } from '../../kontext/index.js';
import {
  angebotStaende, fristUeberschrittenSql, type AngebotStatus, type AuftragStatus,
  type LeadFrist, type LeadStatus,
} from './mengen.js';

/**
 * Die Listen hinter den Kennzahlen — im Bereich und in der Gruppe
 * (DSH-01, DSH-04, V-149, V-150, V-152, D-643, D-644, D-646).
 *
 * **Warum ein Dienst und nicht die Abfrage in der Seite.** Die Zusage einer
 * Kachel ist „die Liste dahinter zeigt genau diese Zeilen". Stand die Abfrage
 * in der Seite, ließ sich das nur am Quelltext prüfen — an einem Satz wie
 * `left join kunde`, nicht an Zeilen. Hier stehen die Listen, auf die eine
 * Kachel oder eine Zelle der Gruppenübersicht führt, damit
 * `tests/isolation/kennzahlen-listen.test.ts` Zahl und Liste an echten Zeilen
 * vergleicht, als `cse_app` mit den Rechten der Sitzung.
 *
 * **Der Filter kommt geprüft an.** Jede Funktion nimmt einen Stand aus der
 * Werteliste (`mengen.ts`), nie Text aus der Adresse; `null` heißt: alle.
 *
 * **Im Bereich steht der Mandant in der Abfrage**, nicht nur in der Policy:
 * RLS ist die zweite Linie, nie die einzige (Invariante 3). In der Gruppe
 * nimmt jede Funktion die sichtbaren Mandanten als Liste; gelesen wird über
 * die `t_gruppe`-Policies, nie schreibend (Invariante 10).
 *
 * **Der Kunde kommt per LEFT JOIN** (D-644 Punkt 2): die Kachel zählt die
 * Hauptzeile allein; ein innerer Join ließe eine Zeile ohne lesbaren Kunden
 * aus der Liste fallen, die die Kachel zählt.
 */

/** Wie viele Zeilen eine Gruppenliste höchstens zeigt — wie die übrigen Gruppenlisten. */
export const GRUPPEN_LISTEN_GRENZE = 500;

/* ------------------------------------------------------------- Aufträge */

export interface AuftragZeile {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly kunde: string | null;
  readonly objekt: string | null;
  readonly art: string;
  readonly status: string;
  readonly wert: string | null;
  readonly start: string | null;
  readonly laufzeit_bis: string | null;
}

/** `/portal/[mandant]/auftraege` — Ziel von „Aktive Aufträge" mit `?status=aktiv`. */
export async function listeAuftraege(
  kontext: LeseKontext, status: AuftragStatus | null,
): Promise<readonly AuftragZeile[]> {
  return kontext.abfrage<AuftragZeile>(
    `select a.id, a.auftragsnummer, a.bezeichnung, k.name as kunde,
            o.bezeichnung as objekt, a.art::text as art, a.status::text as status,
            a.auftragswert_netto_cent::text as wert,
            to_char(a.start_datum, 'DD.MM.YYYY') as start,
            to_char(a.laufzeit_bis, 'DD.MM.YYYY') as laufzeit_bis
       from auftrag a
       left join kunde k on k.id = a.kunde_id
       left join objekt o on o.id = a.objekt_id
      where a.mandant_id = app.aktiver_mandant()
        and a.archiviert_am is null
        and ($1::text is null or a.status::text = $1)
      order by a.start_datum desc`,
    [status]);
}

export interface GruppenAuftragZeile extends AuftragZeile {
  readonly slug: string;
  readonly bereich_name: string;
}

/** `/portal/gruppe/auftraege` — Ziel von „Aufträge aktiv" (Summe und Zelle). */
export async function gruppenAuftraege(
  kontext: LeseKontext, mandantIds: readonly string[], status: AuftragStatus | null,
): Promise<readonly GruppenAuftragZeile[]> {
  return kontext.abfrage<GruppenAuftragZeile>(
    `select a.id, m.slug, m.name as bereich_name, a.auftragsnummer, a.bezeichnung,
            k.name as kunde, o.bezeichnung as objekt, a.art::text as art,
            a.status::text as status, a.auftragswert_netto_cent::text as wert,
            to_char(a.start_datum, 'DD.MM.YYYY') as start,
            to_char(a.laufzeit_bis, 'DD.MM.YYYY') as laufzeit_bis
       from auftrag a
       join mandant m on m.id = a.mandant_id
       left join kunde k on k.id = a.kunde_id
       left join objekt o on o.id = a.objekt_id
      where a.archiviert_am is null and a.mandant_id = any($1::uuid[])
        and ($2::text is null or a.status::text = $2)
      order by a.start_datum desc nulls last, m.sortierung, a.auftragsnummer
      limit $3::int`,
    [mandantIds, status, GRUPPEN_LISTEN_GRENZE]);
}

/* ------------------------------------------------------------- Angebote */

export interface AngebotZeile {
  readonly id: string;
  readonly angebotsnummer: string | null;
  readonly titel: string;
  readonly kunde: string | null;
  readonly status: string;
  readonly netto_cent: string;
  readonly gueltig_bis: string | null;
}

export interface BereichAngebotZeile extends AngebotZeile {
  readonly hat_auftrag: boolean;
}

/** `/portal/[mandant]/angebote` — Ziel von „Offene Angebote" mit `?status=offen`. */
export async function listeAngebote(
  kontext: LeseKontext, filter: 'offen' | AngebotStatus | null,
): Promise<readonly BereichAngebotZeile[]> {
  return kontext.abfrage<BereichAngebotZeile>(
    `select a.id, a.angebotsnummer, a.titel, k.name as kunde, a.status::text as status,
            a.netto_cent::text as netto_cent,
            to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
            exists (select 1 from auftrag t where t.angebot_id = a.id) as hat_auftrag
       from angebot a left join kunde k on k.id = a.kunde_id
      where a.mandant_id = app.aktiver_mandant()
        and a.archiviert_am is null
        and ($1::text[] is null or a.status::text = any($1::text[]))
      order by a.erstellt_am desc`,
    [angebotStaende(filter)]);
}

export interface GruppenAngebotZeile extends AngebotZeile {
  readonly slug: string;
  readonly bereich_name: string;
}

/** `/portal/gruppe/angebote` — Ziel der Zelle „Angebote offen" (V-149). */
export async function gruppenAngebote(
  kontext: LeseKontext, mandantIds: readonly string[], filter: 'offen' | AngebotStatus | null,
): Promise<readonly GruppenAngebotZeile[]> {
  return kontext.abfrage<GruppenAngebotZeile>(
    `select a.id, m.slug, m.name as bereich_name, a.angebotsnummer, a.titel,
            k.name as kunde, a.status::text as status, a.netto_cent::text as netto_cent,
            to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis
       from angebot a
       join mandant m on m.id = a.mandant_id
       left join kunde k on k.id = a.kunde_id
      where a.archiviert_am is null and a.mandant_id = any($1::uuid[])
        and ($2::text[] is null or a.status::text = any($2::text[]))
      order by a.erstellt_am desc, m.sortierung
      limit $3::int`,
    [mandantIds, angebotStaende(filter), GRUPPEN_LISTEN_GRENZE]);
}

/* ---------------------------------------------------------------- Leads */

/** Die zwei Filter der Leadliste: ein Stand, oder „Reaktionsfrist überschritten". */
export interface LeadFilter {
  readonly status: LeadStatus | null;
  readonly frist: LeadFrist | null;
}

export interface LeadZeile {
  readonly id: string;
  readonly leadnummer: string;
  readonly betreff: string | null;
  readonly firma_name: string | null;
  readonly quelle: string;
  readonly status: string;
  readonly prioritaet: string;
  readonly punktzahl: number | null;
  readonly punktzahl_begruendung: string | null;
  readonly wert: string | null;
  readonly frist: string | null;
  readonly frist_ueberschritten: boolean;
  readonly naechste_aktion_text: string | null;
  readonly naechste_aktion_am: string | null;
  readonly besitzer: string | null;
}

/**
 * `/portal/[mandant]/crm/leads` — der Posteingang, nach Frist, offene zuerst.
 * Ziel von „Neue Anfragen" (`?status=neu`) und „Frist überschritten"
 * (`?frist=ueberschritten`, dasselbe Prädikat wie die Kachel, V-152).
 */
export async function listeLeads(
  kontext: LeseKontext, filter: LeadFilter,
): Promise<readonly LeadZeile[]> {
  return kontext.abfrage<LeadZeile>(
    `select l.id, l.leadnummer, l.betreff, l.firma_name, l.quelle::text as quelle,
            l.status::text as status, l.prioritaet::text as prioritaet,
            l.punktzahl, l.punktzahl_begruendung,
            l.geschaetzter_wert_cent::text as wert,
            to_char(l.sla_frist_am at time zone 'Europe/Berlin', 'DD.MM. HH24:MI') as frist,
            (${fristUeberschrittenSql('l.')}) as frist_ueberschritten,
            l.naechste_aktion_text,
            to_char(l.naechste_aktion_am at time zone 'Europe/Berlin', 'DD.MM.YYYY')
              as naechste_aktion_am,
            b.name as besitzer
       from lead l
       left join benutzer b on b.id = l.besitzer_benutzer_id
      where l.mandant_id = app.aktiver_mandant()
        and l.archiviert_am is null
        and ($1::text is null or l.status::text = $1)
        and (not $2::boolean or (${fristUeberschrittenSql('l.')}))
      order by (l.status in ('gewonnen','verloren','kein_bedarf')),
               l.sla_frist_am nulls last, l.erstellt_am desc`,
    [filter.status, filter.frist !== null]);
}

export interface GruppenLeadZeile {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly leadnummer: string;
  readonly betreff: string;
  readonly firma_name: string | null;
  readonly quelle: string;
  readonly status: string;
  readonly prioritaet: string;
  readonly sla: string | null;
  readonly sla_verletzt: boolean;
  readonly wert: string | null;
}

/** `/portal/gruppe/leads` — Ziel von „Neue Anfragen" der Gruppenübersicht (V-152). */
export async function gruppenLeads(
  kontext: LeseKontext, mandantIds: readonly string[], filter: LeadFilter,
): Promise<readonly GruppenLeadZeile[]> {
  return kontext.abfrage<GruppenLeadZeile>(
    `select l.id, m.slug, m.name as bereich_name, l.leadnummer, l.betreff, l.firma_name,
            l.quelle::text as quelle, l.status::text as status,
            l.prioritaet::text as prioritaet,
            to_char(l.sla_frist_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as sla,
            (${fristUeberschrittenSql('l.')}) as sla_verletzt,
            l.geschaetzter_wert_cent::text as wert
       from lead l
       join mandant m on m.id = l.mandant_id
      where l.archiviert_am is null and l.mandant_id = any($1::uuid[])
        and ($2::text is null or l.status::text = $2)
        and (not $3::boolean or (${fristUeberschrittenSql('l.')}))
      order by (l.status = 'neu') desc, l.sla_frist_am nulls last, l.erstellt_am desc
      limit $4::int`,
    [mandantIds, filter.status, filter.frist !== null, GRUPPEN_LISTEN_GRENZE]);
}
