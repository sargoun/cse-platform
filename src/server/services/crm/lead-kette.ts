/**
 * **Die Kette Lead → Angebot → Auftrag → Rechnung** (V-138, CRM-05, REQ-07,
 * REP-03, D-632).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `angebot.lead_id` und `auftrag.lead_id` standen seit `0024`/`0025` da, und
 * kein Weg schrieb sie. `lead.kunde_id` liess sich nach der Anlage nicht mehr
 * setzen, also war ein Web-Lead nie an einen Kunden, ein Angebot oder einen
 * Auftrag zu binden. Der Herkunftsbericht (REP-03) zählt Aufträge über
 * `auftrag.lead_id` — und zeigte für jeden Kanal „0 Aufträge, 0,00 €". Das
 * sah aus wie eine Aussage über die Kanäle und war keine.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was dieses Modul tut.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - Es bindet einen Lead an einen Kunden: als NEUEN Kunden übernommen oder
 *    einem BESTEHENDEN zugeordnet. Der Anfragende wandert dabei mit.
 *  - Es prüft, ob ein Angebot oder Auftrag an einem Lead hängen darf
 *    (`pruefeLeadBindung`): der Lead steht in dieser Gesellschaft und gehört
 *    DEMSELBEN Kunden. Dieselbe Regel steht als Auslöser in `0400` — hier
 *    steht sie, damit der Mensch einen Satz liest statt eines `23514`.
 *  - Es liest die Kette für das Leadblatt und das Kundenblatt, jeweils nur
 *    mit dem Recht, das die Zielseite verlangt (AUT-06).
 *
 * **Gerechnet wird hier nichts** (Invariante 6). Beträge kommen als Cent aus
 * der Datenbank und werden im Blatt nur formatiert.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { CrmFehler, legeKundeAn, type KundeTyp } from './anlegen.js';

/** Der schmale Ausschnitt, den auch `angebot/index.ts` hat. */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function istKennung(wert: string | null | undefined): wert is string {
  return typeof wert === 'string' && UUID.test(wert);
}

function leer(wert: string | null | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

// ---------------------------------------------------------------------------
// 1. Darf ein Vorgang an diesem Lead hängen?
// ---------------------------------------------------------------------------

export type LeadBindungGrund = 'lead_unbekannt' | 'lead_ohne_kunde' | 'lead_kunde_abweichend';

export type LeadBindung =
  | { readonly ok: true; readonly leadnummer: string }
  | { readonly ok: false; readonly grund: LeadBindungGrund };

/**
 * Ein Angebot oder Auftrag darf an einem Lead hängen, wenn der Lead in DIESER
 * Gesellschaft steht, nicht archiviert ist und DEMSELBEN Kunden gehört.
 *
 * **Ein Lead ohne Kunden wird nicht nebenbei zugeordnet.** Das Angebot nennt
 * einen Kunden, der Lead keinen — daraus still den Kunden des Angebots zu
 * übernehmen hiesse, eine Zuordnung zu treffen, die niemand getroffen hat.
 * Das Leadblatt bietet dafür „Als Kunde übernehmen" und „Kunden zuordnen" an.
 *
 * Ein fremder Lead und ein nicht lesbarer Lead sehen gleich aus
 * (`lead_unbekannt`): eine unterschiedliche Antwort wäre ein Orakel über
 * fremde Kennungen (AUT-06).
 */
export async function pruefeLeadBindung(
  db: Abfrage, leadId: string, kundeId: string,
): Promise<LeadBindung> {
  if (!istKennung(leadId)) return { ok: false, grund: 'lead_unbekannt' };
  const [lead] = await db.abfrage<{ leadnummer: string; kunde_id: string | null }>(
    `select leadnummer, kunde_id::text as kunde_id from lead
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null`, [leadId]);
  if (lead === undefined) return { ok: false, grund: 'lead_unbekannt' };
  if (lead.kunde_id === null) return { ok: false, grund: 'lead_ohne_kunde' };
  if (lead.kunde_id !== kundeId) return { ok: false, grund: 'lead_kunde_abweichend' };
  return { ok: true, leadnummer: lead.leadnummer };
}

export const LEAD_BINDUNG_SATZ: Readonly<Record<LeadBindungGrund, string>> = {
  lead_unbekannt: 'Diese Anfrage ist in dieser Gesellschaft nicht erreichbar.',
  lead_ohne_kunde:
    'Die Anfrage hat noch keinen Kunden. Übernehmen Sie sie zuerst als Kunden oder ordnen '
    + 'Sie einen bestehenden zu — ein Angebot braucht einen Empfänger.',
  lead_kunde_abweichend:
    'Die Anfrage gehört einem anderen Kunden als der Vorgang. Ein Angebot für Kunde B zählte '
    + 'sonst im Herkunftsbericht für eine Anfrage von Kunde A.',
};

// ---------------------------------------------------------------------------
// 2. Einen Lead an einen Kunden binden.
// ---------------------------------------------------------------------------

interface LeadKopf {
  readonly id: string;
  readonly leadnummer: string;
  readonly quelle: string;
  readonly kunde_id: string | null;
  readonly firma_name: string | null;
  readonly ansprechpartner_id: string | null;
}

async function sperreLead(kontext: SchreibKontext, leadId: string): Promise<LeadKopf> {
  if (!istKennung(leadId)) {
    throw new CrmFehler('Diese Anfrage gibt es nicht.', 'nicht_gefunden', 404);
  }
  /*
   * `for update` — zwei gleichzeitige Übernahmen legten sonst zwei Kunden an
   * und der zweite Klick überschriebe den ersten.
   */
  const [lead] = await kontext.abfrage<LeadKopf>(
    `select id::text as id, leadnummer, quelle::text as quelle, kunde_id::text as kunde_id,
            firma_name, ansprechpartner_id::text as ansprechpartner_id
       from lead
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null
      for update`, [leadId]);
  if (lead === undefined) {
    throw new CrmFehler('Diese Anfrage gibt es nicht.', 'nicht_gefunden', 404);
  }
  return lead;
}

/**
 * **Der Anfragende wandert mit** — sonst bleibt er am Kunden unsichtbar und
 * lässt sich nicht als Ansprechpartner eines Angebots wählen
 * (`angebot_ansprechpartner_fk` schliesst über `(mandant_id, kunde_id, id)`).
 *
 * Nur ein Kontakt OHNE Kunden wandert; einer, der schon einem anderen Kunden
 * gehört, bleibt, wo er ist. Führt der Kunde schon einen Kontakt mit derselben
 * E-Mail, gilt dieselbe Regel wie in der Annahme (D-631): ein Mensch, ein
 * Kontakt — der Lead zeigt dann auf DEN, und der Eindeutigkeitsschlüssel
 * `ansprechpartner_email_uk` bleibt unberührt.
 */
async function nimmKontaktMit(
  kontext: SchreibKontext, lead: LeadKopf, kundeId: string,
): Promise<void> {
  if (lead.ansprechpartner_id === null) return;
  const [kontakt] = await kontext.abfrage<{ kunde_id: string | null; email: string | null }>(
    `select kunde_id::text as kunde_id, email from ansprechpartner
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [lead.ansprechpartner_id]);
  if (kontakt === undefined || kontakt.kunde_id !== null) return;

  const [zwilling] = kontakt.email === null ? [] : await kontext.abfrage<{ id: string }>(
    `select id::text as id from ansprechpartner
      where mandant_id = app.aktiver_mandant() and kunde_id = $1::uuid
        and lower(email) = lower($2) and archiviert_am is null and anonymisiert_am is null
      limit 1`, [kundeId, kontakt.email]);
  if (zwilling !== undefined) {
    await kontext.schreibe(
      `update lead set ansprechpartner_id = $2::uuid, geaendert_von = app.aktueller_benutzer()
        where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
      [lead.id, zwilling.id]);
    return;
  }
  await kontext.schreibe(
    `update ansprechpartner set kunde_id = $2::uuid, geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant() and kunde_id is null`,
    [lead.ansprechpartner_id, kundeId]);
}

async function bindeKunde(
  kontext: SchreibKontext, lead: LeadKopf, kundeId: string, notiz: string,
): Promise<void> {
  /*
   * Eine NEUE Anfrage ist mit dem Kunden in Arbeit; ein Stand, den ein
   * Mensch schon weitergestellt hat, bleibt stehen.
   */
  await kontext.schreibe(
    `update lead
        set kunde_id = $2::uuid,
            status = case when status = 'neu' then 'in_bearbeitung'::lead_status
                          else status end,
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [lead.id, kundeId]);
  await nimmKontaktMit(kontext, lead, kundeId);
  await kontext.schreibe(
    `insert into lead_aktivitaet
       (mandant_id, lead_id, kunde_id, typ, richtung, zweck, kanal, betreff,
        akteur_art, benutzer_id, rechtsgrundlage_snapshot)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, 'system', 'intern', 'intern',
             'portal', $3, 'mensch', app.aktueller_benutzer(), 'keine')`,
    [lead.id, kundeId, notiz]);
}

export interface LeadAlsKunde {
  /** Leer heisst: der Firmenname der Anfrage. */
  readonly name?: string | undefined;
  readonly typ: KundeTyp;
  readonly ustId?: string | undefined;
}

/**
 * **Als Kunde übernehmen** — der Lead wird zum Kunden, und der Kunde entsteht
 * über denselben Dienst wie jeder andere (`legeKundeAn`: Kundennummer,
 * Firmenidentität über die USt-IdNr., CRM-06).
 *
 * **Die Rechtsgrundlage des neuen Kunden ist `keine`.** Eine Anfrage erlaubt
 * die Antwort auf die Anfrage (Zweck `vertraglich`, D-631) — die läuft am
 * Werbetor nicht über die Grundlage des Kunden und bleibt deshalb offen. Ob
 * der Kunde darüber hinaus Werbung bekommen darf, ist eine Feststellung mit
 * Quelle und Datum (§ 7 UWG, LEG-08), die ein Mensch trifft. Sie hier zu
 * erschliessen, wäre eine Rechtsauffassung im Vorbeigehen; `keine` ist der
 * sichere Zweig.
 */
export async function uebernehmeLeadAlsKunde(
  kontext: SchreibKontext, leadId: string, eingabe: LeadAlsKunde,
): Promise<{ readonly kundeId: string; readonly kundennummer: string }> {
  const lead = await sperreLead(kontext, leadId);
  if (lead.kunde_id !== null) {
    throw new CrmFehler(
      'Diese Anfrage hat schon einen Kunden. Ein zweiter Kunde aus derselben Anfrage '
      + 'wäre eine Dublette.', 'lead_hat_kunde');
  }
  const name = leer(eingabe.name) ?? leer(lead.firma_name);
  if (name === null) {
    throw new CrmFehler('Ein Kunde braucht einen Namen.', 'name_fehlt');
  }
  const kunde = await legeKundeAn(kontext, {
    name, typ: eingabe.typ, ustId: eingabe.ustId, rechtsgrundlage: 'keine',
  });
  await bindeKunde(kontext, lead, kunde.id,
    `Als Kunde ${kunde.kundennummer} übernommen`);
  return { kundeId: kunde.id, kundennummer: kunde.kundennummer };
}

/**
 * **Einem bestehenden Kunden zuordnen** — für die Anfrage eines Kunden, den es
 * schon gibt.
 *
 * Ein Kunde, der schon zugeordnet ist, wird nicht getauscht, sobald ein
 * Angebot oder Auftrag an der Anfrage hängt: sonst stünde das Angebot beim
 * einen Kunden und seine Herkunft beim anderen. Die Datenbank hält dasselbe
 * (`kern.lead_kunde_bleibt`, 0400) — auch für eine Rolle, die die Angebote
 * gar nicht sehen darf.
 */
export async function ordneLeadKundeZu(
  kontext: SchreibKontext, leadId: string, kundeId: string,
): Promise<void> {
  const lead = await sperreLead(kontext, leadId);
  if (!istKennung(kundeId)) {
    throw new CrmFehler('Diesen Kunden gibt es in dieser Gesellschaft nicht.', 'kunde_unbekannt');
  }
  const [kunde] = await kontext.abfrage<{ id: string; kundennummer: string }>(
    `select id::text as id, kundennummer from kunde
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null`, [kundeId]);
  if (kunde === undefined) {
    throw new CrmFehler('Diesen Kunden gibt es in dieser Gesellschaft nicht.', 'kunde_unbekannt');
  }
  if (lead.kunde_id === kunde.id) return;
  if (lead.kunde_id !== null) {
    const [haengt] = await kontext.abfrage<{ ja: boolean }>(
      `select exists (select 1 from angebot where lead_id = $1::uuid)
              or exists (select 1 from auftrag where lead_id = $1::uuid) as ja`, [lead.id]);
    if (haengt?.ja === true) {
      throw new CrmFehler(
        'An dieser Anfrage hängt schon ein Angebot oder Auftrag. Ihr Kunde bleibt.',
        'lead_hat_vorgaenge');
    }
  }
  try {
    await bindeKunde(kontext, lead, kunde.id, `Dem Kunden ${kunde.kundennummer} zugeordnet`);
  } catch (fehler) {
    /*
     * Der Auslöser `kern.lead_kunde_bleibt` sieht, was diese Rolle nicht
     * sieht — ein Angebot ohne `angebot.lesen`. Er antwortet mit `23514`; der
     * Satz dazu steht hier.
     */
    if ((fehler as { code?: unknown }).code === '23514') {
      throw new CrmFehler(
        'An dieser Anfrage hängt schon ein Angebot oder Auftrag. Ihr Kunde bleibt.',
        'lead_hat_vorgaenge');
    }
    throw fehler;
  }
}

// ---------------------------------------------------------------------------
// 3. Die Kette lesen — für das Leadblatt und das Kundenblatt.
// ---------------------------------------------------------------------------

export interface KetteRechte {
  readonly angebotLesen: boolean;
  readonly angebotSchreiben: boolean;
  readonly auftragLesen: boolean;
  readonly auftragSchreiben: boolean;
  readonly finanzenLesen: boolean;
  readonly radarLesen: boolean;
  readonly dokumentLesen: boolean;
  readonly objektLesen: boolean;
}

export interface AngebotZeile {
  readonly id: string;
  readonly angebotsnummer: string | null;
  readonly titel: string;
  readonly status: string;
  readonly netto_cent: string;
  readonly angelegt: string;
}

export interface AuftragZeile {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly status: string;
  readonly wert_cent: string | null;
  readonly start: string | null;
}

export interface RechnungZeile {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly datum: string | null;
  readonly brutto_cent: string;
}

async function rechte(db: Abfrage): Promise<KetteRechte> {
  const [r] = await db.abfrage<{
    al: boolean; aschr: boolean; tl: boolean; ts: boolean; fl: boolean; rl: boolean;
    dl: boolean; ol: boolean;
  }>(
    `select app.hat_recht('angebot.lesen', app.aktiver_mandant()) as al,
            app.hat_recht('angebot.schreiben', app.aktiver_mandant()) as aschr,
            app.hat_recht('auftrag.lesen', app.aktiver_mandant()) as tl,
            app.hat_recht('auftrag.schreiben', app.aktiver_mandant()) as ts,
            app.hat_recht('finanzen.lesen', app.aktiver_mandant()) as fl,
            app.hat_recht('radar.lesen', app.aktiver_mandant()) as rl,
            app.hat_recht('dokument.lesen', app.aktiver_mandant()) as dl,
            app.hat_recht('objekt.lesen', app.aktiver_mandant()) as ol`);
  return {
    angebotLesen: r?.al === true, angebotSchreiben: r?.aschr === true,
    auftragLesen: r?.tl === true, auftragSchreiben: r?.ts === true,
    finanzenLesen: r?.fl === true, radarLesen: r?.rl === true,
    dokumentLesen: r?.dl === true, objektLesen: r?.ol === true,
  };
}

export interface LeadKette {
  readonly rechte: KetteRechte;
  readonly kunde: { readonly id: string; readonly name: string; readonly kundennummer: string } | null;
  readonly empfehlung: { readonly id: string; readonly name: string } | null;
  readonly ausschreibung: { readonly id: string; readonly titel: string } | null;
  readonly angebote: readonly AngebotZeile[];
  readonly auftraege: readonly AuftragZeile[];
  readonly rechnungen: readonly RechnungZeile[];
  /** Die Objekte des Kunden — für „Angebot aus dem Raumbuch" (nur mit `objekt.lesen`). */
  readonly objekte: readonly { readonly id: string; readonly bezeichnung: string }[];
}

/**
 * Was an einer Anfrage hängt — je Stufe nur mit dem Recht, das die
 * verlinkte Seite verlangt. Ohne Recht ist die Liste LEER und der Merker
 * sagt, warum; das Blatt macht daraus „dafür fehlt …", nicht „es gibt keine".
 */
export async function leseLeadKette(kontext: LeseKontext, leadId: string): Promise<LeadKette | null> {
  if (!istKennung(leadId)) return null;
  const [lead] = await kontext.abfrage<{
    kunde_id: string | null; empfehlung_von_kunde_id: string | null;
    ausschreibung_id: string | null;
  }>(
    `select kunde_id::text as kunde_id, empfehlung_von_kunde_id::text as empfehlung_von_kunde_id,
            ausschreibung_id::text as ausschreibung_id
       from lead where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [leadId]);
  if (lead === undefined) return null;
  const r = await rechte(kontext);

  const [kunde] = lead.kunde_id === null ? [] : await kontext.abfrage<{
    id: string; name: string; kundennummer: string;
  }>(`select id::text as id, name, kundennummer from kunde where id = $1::uuid`,
    [lead.kunde_id]);
  const [empfehlung] = lead.empfehlung_von_kunde_id === null ? []
    : await kontext.abfrage<{ id: string; name: string }>(
      `select id::text as id, name from kunde where id = $1::uuid`,
      [lead.empfehlung_von_kunde_id]);
  const [ausschreibung] = lead.ausschreibung_id === null || !r.radarLesen ? []
    : await kontext.abfrage<{ id: string; titel: string }>(
      `select id::text as id, titel from ausschreibung where id = $1::uuid`,
      [lead.ausschreibung_id]);

  const angebote = !r.angebotLesen ? [] : await kontext.abfrage<AngebotZeile>(
    `select a.id::text as id, a.angebotsnummer, a.titel, a.status::text as status,
            a.netto_cent::text as netto_cent,
            to_char(a.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as angelegt
       from angebot a
      where a.lead_id = $1::uuid and a.mandant_id = app.aktiver_mandant()
      order by a.erstellt_am desc`, [leadId]);
  const auftraege = !r.auftragLesen ? [] : await kontext.abfrage<AuftragZeile>(
    `select t.id::text as id, t.auftragsnummer, t.bezeichnung, t.status::text as status,
            t.auftragswert_netto_cent::text as wert_cent,
            to_char(t.start_datum, 'DD.MM.YYYY') as start
       from auftrag t
      where t.lead_id = $1::uuid and t.mandant_id = app.aktiver_mandant()
      order by t.start_datum desc`, [leadId]);
  /*
   * Die Rechnungen hängen am AUFTRAG, nicht am Lead: gelesen werden nur die
   * der Aufträge, die diese Sitzung sehen darf.
   */
  const rechnungen = !r.finanzenLesen || auftraege.length === 0 ? []
    : await kontext.abfrage<RechnungZeile>(
      `select r.id::text as id, r.nummer, r.status::text as status,
              to_char(r.rechnungsdatum, 'DD.MM.YYYY') as datum,
              r.brutto_cent::text as brutto_cent
         from rechnung r
        where r.auftrag_id = any($1::uuid[]) and r.mandant_id = app.aktiver_mandant()
        order by r.erstellt_am desc`, [auftraege.map((a) => a.id)]);
  const objekte = kunde === undefined || !r.objektLesen ? []
    : await kontext.abfrage<{ id: string; bezeichnung: string }>(
      `select id::text as id, bezeichnung from objekt
        where kunde_id = $1::uuid and mandant_id = app.aktiver_mandant()
          and archiviert_am is null
        order by bezeichnung limit 20`, [kunde.id]);

  return {
    rechte: r,
    objekte,
    kunde: kunde ?? null,
    empfehlung: empfehlung ?? null,
    ausschreibung: ausschreibung ?? null,
    angebote, auftraege, rechnungen,
  };
}

export interface AnfrageZeile {
  readonly id: string;
  readonly leadnummer: string;
  readonly betreff: string;
  readonly quelle: string;
  readonly status: string;
  readonly angelegt: string;
}

export interface DokumentZeile {
  readonly id: string;
  readonly titel: string;
  readonly kategorie: string;
  readonly datum: string | null;
}

export interface VerlaufZeile {
  readonly id: string;
  readonly typ: string;
  readonly richtung: string;
  readonly betreff: string;
  readonly geschehen: string;
  readonly lead_id: string | null;
}

export interface KundeVorgaenge {
  readonly rechte: KetteRechte;
  readonly anfragen: readonly AnfrageZeile[];
  readonly angebote: readonly AngebotZeile[];
  readonly rechnungen: readonly RechnungZeile[];
  readonly dokumente: readonly DokumentZeile[];
  readonly verlauf: readonly VerlaufZeile[];
}

/**
 * Was am Kundenblatt fehlte (04-SEITENKARTE §5.2): Anfragen, Angebote,
 * Rechnungen, Dokumente und der Verlauf der Kommunikation. Die Aufträge
 * liest das Blatt wie bisher selbst.
 *
 * Die Anfragen und der Verlauf stehen unter `crm.lesen` — dem Recht des
 * Blattes selbst; alles andere unter dem Recht seiner Zielseite.
 */
export async function leseKundeVorgaenge(
  kontext: LeseKontext, kundeId: string,
): Promise<KundeVorgaenge> {
  const r = await rechte(kontext);
  const anfragen = await kontext.abfrage<AnfrageZeile>(
    `select l.id::text as id, l.leadnummer, l.betreff, l.quelle::text as quelle,
            l.status::text as status,
            to_char(l.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as angelegt
       from lead l
      where l.kunde_id = $1::uuid and l.mandant_id = app.aktiver_mandant()
        and l.archiviert_am is null
      order by l.erstellt_am desc limit 50`, [kundeId]);
  const angebote = !r.angebotLesen ? [] : await kontext.abfrage<AngebotZeile>(
    `select a.id::text as id, a.angebotsnummer, a.titel, a.status::text as status,
            a.netto_cent::text as netto_cent,
            to_char(a.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as angelegt
       from angebot a
      where a.kunde_id = $1::uuid and a.mandant_id = app.aktiver_mandant()
      order by a.erstellt_am desc limit 50`, [kundeId]);
  const rechnungen = !r.finanzenLesen ? [] : await kontext.abfrage<RechnungZeile>(
    `select r.id::text as id, r.nummer, r.status::text as status,
            to_char(r.rechnungsdatum, 'DD.MM.YYYY') as datum,
            r.brutto_cent::text as brutto_cent
       from rechnung r
      where r.kunde_id = $1::uuid and r.mandant_id = app.aktiver_mandant()
      order by r.erstellt_am desc limit 50`, [kundeId]);
  const dokumente = !r.dokumentLesen ? [] : await kontext.abfrage<DokumentZeile>(
    `select d.id::text as id, d.titel, d.kategorie::text as kategorie,
            to_char(coalesce(d.entstanden_am, (d.erstellt_am at time zone 'Europe/Berlin')::date),
                    'DD.MM.YYYY') as datum
       from dokument d
      where d.kunde_id = $1::uuid and d.mandant_id = app.aktiver_mandant()
        and d.geloescht_am is null
      order by d.erstellt_am desc limit 50`, [kundeId]);
  /*
   * Der Verlauf: was am Kunden selbst festgehalten wurde UND was an seinen
   * Anfragen geschah — der Kunde ist derselbe, ob die Zeile am Lead oder am
   * Kunden hängt.
   */
  const verlauf = await kontext.abfrage<VerlaufZeile>(
    `select a.id::text as id, a.typ::text as typ, a.richtung::text as richtung, a.betreff,
            to_char(a.geschehen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as geschehen,
            a.lead_id::text as lead_id
       from lead_aktivitaet a
      where a.mandant_id = app.aktiver_mandant()
        and (a.kunde_id = $1::uuid
             or a.lead_id in (select l.id from lead l
                               where l.kunde_id = $1::uuid
                                 and l.mandant_id = app.aktiver_mandant()))
      order by a.geschehen_am desc limit 20`, [kundeId]);
  return { rechte: r, anfragen, angebote, rechnungen, dokumente, verlauf };
}
