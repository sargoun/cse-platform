import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { CrmFehler } from './anlegen.js';
import { istUuid } from '../../../lib/uuid.js';

/**
 * Der Kommunikationsverlauf eines Kunden und eines Ansprechpartners
 * (CRM-03, 04-SEITENKARTE Reiter „Kommunikation", V-147, D-641).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Kommunikation lag an zwei Stellen, und keine Seite las beide:
 *
 *  - `lead_aktivitaet` — Notizen, Anrufe, E-Mails, Termine, Wiedervorlagen;
 *    mit `kunde_id`, `lead_id` oder `ansprechpartner_id`. `0017` legte eigens
 *    `lead_aktivitaet_kunde_idx` an — und das Kundenblatt zeigte gar keinen
 *    Verlauf.
 *  - `nachricht` — was über „Nachricht senden" hinausgeht
 *    (`rechtsgrundlage_kontakt_id`, Empfänger `ansprechpartner`) und was im
 *    Kundenportal am Kunden hängt (`kunde_id`, 0255). Das Kontaktblatt las nur
 *    die Aktivitäten: sobald ein Versender verbunden ist, fehlte jede
 *    versendete Nachricht genau in dem Verlauf, der sie belegen soll.
 *
 * Hier stehen beide in EINER Liste, nach der Zeit sortiert, mit Richtung,
 * Kanal, Zweck und — bei allem, was hinausging — der Rechtsgrundlage IM
 * MOMENT DES SENDENS (dem Schnappschuss, nicht dem heutigen Stand).
 *
 * **Die Rechte entscheidet die Datenbank, nicht diese Datei.**
 * `lead_aktivitaet` steht hinter `crm.lesen`, `nachricht` hinter
 * `nachricht.lesen` (oder: selbst geschrieben, selbst adressiert). Wem das
 * zweite fehlt, dem antwortet die Policy mit weniger Zeilen — und die Seite
 * sagt dann, dass Nachrichten fehlen KÖNNEN, statt so zu tun, als gäbe es
 * keine.
 */

/** Wie viele Einträge ein Blatt zeigt — die jüngsten. */
export const VERLAUF_GRENZE = 50;

export type VerlaufQuelle = 'aktivitaet' | 'nachricht';

export interface VerlaufEintrag {
  readonly quelle: VerlaufQuelle;
  readonly id: string;
  /** `aktivitaet_typ` (notiz, anruf, …) oder `nachricht`. Ein SCHLÜSSEL — die Seite übersetzt. */
  readonly art: string;
  /** intern · eingehend · ausgehend. */
  readonly richtung: string;
  readonly kanal: string | null;
  readonly zweck: string | null;
  readonly betreff: string | null;
  readonly inhalt: string | null;
  /** Berliner Ortszeit, in der Datenbank formatiert (Invariante 2). */
  readonly zeitpunkt: string;
  /** Der Name des Handelnden — NULL ohne `system.benutzer_lesen` oder bei System/Agent. */
  readonly wer: string | null;
  /** Die Rechtsgrundlage zum Zeitpunkt des Sendens; nur bei ausgehend gesetzt. */
  readonly grundlage: string | null;
  /** Nur bei Nachrichten: `zustell_status`. */
  readonly zustellung: string | null;
  /** Wiedervorlage: Fälligkeit (Berliner Ortszeit) und ob sie erledigt ist. */
  readonly faellig: string | null;
  readonly erledigt: boolean;
  readonly leadId: string | null;
  readonly leadnummer: string | null;
  readonly ansprechpartnerId: string | null;
  readonly ansprechpartner: string | null;
  /** Der Kunde — NULL ohne Bezug oder ohne Leserecht auf ihn. */
  readonly kundeId: string | null;
  readonly kunde: string | null;
}

interface Roh {
  readonly quelle: VerlaufQuelle;
  readonly id: string;
  readonly art: string;
  readonly richtung: string;
  readonly kanal: string | null;
  readonly zweck: string | null;
  readonly betreff: string | null;
  readonly inhalt: string | null;
  readonly zeitpunkt: string;
  readonly wer: string | null;
  readonly grundlage: string | null;
  readonly zustellung: string | null;
  readonly faellig: string | null;
  readonly erledigt: boolean;
  readonly lead_id: string | null;
  readonly leadnummer: string | null;
  readonly ansprechpartner_id: string | null;
  readonly ansprechpartner: string | null;
  readonly kunde_id: string | null;
  readonly kunde: string | null;
}

const alsEintrag = (z: Roh): VerlaufEintrag => ({
  quelle: z.quelle, id: z.id, art: z.art, richtung: z.richtung, kanal: z.kanal,
  zweck: z.zweck, betreff: z.betreff, inhalt: z.inhalt, zeitpunkt: z.zeitpunkt,
  wer: z.wer, grundlage: z.grundlage, zustellung: z.zustellung, faellig: z.faellig,
  erledigt: z.erledigt, leadId: z.lead_id, leadnummer: z.leadnummer,
  ansprechpartnerId: z.ansprechpartner_id, ansprechpartner: z.ansprechpartner,
  kundeId: z.kunde_id, kunde: z.kunde,
});

/*
 * Die beiden Hälften der Vereinigung. Dieselben Spalten in derselben
 * Reihenfolge, Aufzählungen als Text: `union all` verlangt gleiche Typen, und
 * `aktivitaet_richtung` ist ein anderer Typ als `nachricht_richtung`.
 *
 * `sortier` ist der UTC-Zeitpunkt und nur für die Reihenfolge da; angezeigt
 * wird `zeitpunkt`, in Berliner Zeit formatiert.
 */
const AKTIVITAET_SPALTEN = `
  'aktivitaet'::text as quelle, la.id, la.typ::text as art, la.richtung::text as richtung,
  la.kanal, la.zweck::text as zweck, la.betreff, la.inhalt,
  la.geschehen_am as sortier,
  to_char(la.geschehen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as zeitpunkt,
  b.name as wer,
  case when la.richtung = 'ausgehend' then la.rechtsgrundlage_snapshot::text end as grundlage,
  null::text as zustellung,
  case when la.faellig_am is null then null
       else to_char(la.faellig_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') end
    as faellig,
  (la.erledigt_am is not null) as erledigt,
  la.lead_id, l.leadnummer,
  la.ansprechpartner_id,
  case when ap.id is null then null
       else btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) end as ansprechpartner,
  kd.id as kunde_id, kd.name as kunde`;

/*
 * Der Kunde der Zeile — am Kunden selbst, sonst über den Lead. `kd.id` und
 * nicht `la.kunde_id`: ist der Kunde nicht lesbar, soll kein Verweis entstehen,
 * der auf ein 404 führt (AUT-06).
 */
const AKTIVITAET_QUELLE = `
  from lead_aktivitaet la
  left join lead l on l.mandant_id = la.mandant_id and l.id = la.lead_id
  left join ansprechpartner ap on ap.mandant_id = la.mandant_id and ap.id = la.ansprechpartner_id
  left join kunde kd on kd.mandant_id = la.mandant_id
                    and kd.id = coalesce(la.kunde_id, l.kunde_id)
  left join benutzer b on b.id = la.benutzer_id`;

/*
 * `coalesce(gesendet_am, erstellt_am)`: `gesendet_am` steht erst, wenn etwas
 * WIRKLICH hinausging (0231); eine Portalnachricht und eine noch nicht
 * zugestellte stünden sonst ohne Zeit da. Derselbe Rückfall wie im
 * Kundenportal (`kundenportal/nachricht.ts`).
 */
const NACHRICHT_SPALTEN = `
  'nachricht'::text as quelle, n.id, 'nachricht'::text as art, n.richtung::text as richtung,
  n.kanal::text as kanal, n.zweck::text as zweck, n.betreff, n.koerper as inhalt,
  coalesce(n.gesendet_am, n.erstellt_am) as sortier,
  to_char(coalesce(n.gesendet_am, n.erstellt_am) at time zone 'Europe/Berlin',
          'DD.MM.YYYY HH24:MI') as zeitpunkt,
  b.name as wer,
  case when n.richtung = 'ausgehend' then n.rechtsgrundlage::text end as grundlage,
  n.zustell_status::text as zustellung,
  null::text as faellig,
  false as erledigt,
  null::uuid as lead_id, null::text as leadnummer,
  ap.id as ansprechpartner_id,
  case when ap.id is null then null
       else btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) end as ansprechpartner,
  kd.id as kunde_id, kd.name as kunde`;

const NACHRICHT_QUELLE = `
  from nachricht n
  left join ansprechpartner ap
    on ap.mandant_id = n.mandant_id and ap.id = n.rechtsgrundlage_kontakt_id
  left join kunde kd on kd.mandant_id = n.mandant_id
                    and kd.id = coalesce(n.kunde_id, ap.kunde_id)
  left join benutzer b on b.id = n.absender_benutzer_id`;

/**
 * Der Verlauf eines KUNDEN — alles, was an ihm, an einem seiner Leads oder an
 * einem seiner Ansprechpartner hängt.
 *
 * `lead.kunde_id` und `ansprechpartner.kunde_id` gehören dazu: ein Anruf beim
 * Objektleiter ist Kommunikation mit dem Kunden, auch wenn die Zeile den
 * Kunden nicht selbst nennt.
 */
export async function leseKundenVerlauf(
  kontext: LeseKontext, kundeId: string, grenze: number = VERLAUF_GRENZE,
): Promise<readonly VerlaufEintrag[]> {
  const zeilen = await kontext.abfrage<Roh>(
    `select quelle, id, art, richtung, kanal, zweck, betreff, inhalt, zeitpunkt, wer,
            grundlage, zustellung, faellig, erledigt, lead_id, leadnummer,
            ansprechpartner_id, ansprechpartner, kunde_id, kunde
       from (
         select ${AKTIVITAET_SPALTEN} ${AKTIVITAET_QUELLE}
          where la.mandant_id = app.aktiver_mandant()
            and (la.kunde_id = $1::uuid
                 or la.lead_id in (select x.id from lead x
                                    where x.mandant_id = app.aktiver_mandant()
                                      and x.kunde_id = $1::uuid)
                 or la.ansprechpartner_id in (select a.id from ansprechpartner a
                                               where a.mandant_id = app.aktiver_mandant()
                                                 and a.kunde_id = $1::uuid))
         union all
         select ${NACHRICHT_SPALTEN} ${NACHRICHT_QUELLE}
          where n.mandant_id = app.aktiver_mandant()
            and n.geloescht_am is null
            and (n.kunde_id = $1::uuid
                 or n.rechtsgrundlage_kontakt_id in (
                      select a.id from ansprechpartner a
                       where a.mandant_id = app.aktiver_mandant() and a.kunde_id = $1::uuid)
                 or exists (select 1 from nachricht_empfaenger e
                             join ansprechpartner a
                               on a.mandant_id = e.mandant_id and a.id = e.empfaenger_id
                            where e.mandant_id = n.mandant_id and e.nachricht_id = n.id
                              and e.empfaenger_typ = 'ansprechpartner'
                              and a.kunde_id = $1::uuid))
       ) v
      order by sortier desc, id
      limit $2::int`,
    [kundeId, grenze]);
  return zeilen.map(alsEintrag);
}

/**
 * Der Verlauf eines ANSPRECHPARTNERS — seine Aktivitäten und jede Nachricht,
 * die an ihn ging oder deren Rechtsgrundlage an ihm hängt.
 */
export async function leseKontaktVerlauf(
  kontext: LeseKontext, ansprechpartnerId: string, grenze: number = VERLAUF_GRENZE,
): Promise<readonly VerlaufEintrag[]> {
  const zeilen = await kontext.abfrage<Roh>(
    `select quelle, id, art, richtung, kanal, zweck, betreff, inhalt, zeitpunkt, wer,
            grundlage, zustellung, faellig, erledigt, lead_id, leadnummer,
            ansprechpartner_id, ansprechpartner, kunde_id, kunde
       from (
         select ${AKTIVITAET_SPALTEN} ${AKTIVITAET_QUELLE}
          where la.mandant_id = app.aktiver_mandant()
            and la.ansprechpartner_id = $1::uuid
         union all
         select ${NACHRICHT_SPALTEN} ${NACHRICHT_QUELLE}
          where n.mandant_id = app.aktiver_mandant()
            and n.geloescht_am is null
            and (n.rechtsgrundlage_kontakt_id = $1::uuid
                 or exists (select 1 from nachricht_empfaenger e
                             where e.mandant_id = n.mandant_id and e.nachricht_id = n.id
                               and e.empfaenger_typ = 'ansprechpartner'
                               and e.empfaenger_id = $1::uuid))
       ) v
      order by sortier desc, id
      limit $2::int`,
    [ansprechpartnerId, grenze]);
  return zeilen.map(alsEintrag);
}

/** Wie weit die Aktivitätsliste zurückreicht — dieselbe Frist wie die Kachel. */
export const AKTIVITAET_TAGE = 7;
/** Die Obergrenze der Liste; darüber sagt die Seite, dass sie kürzt. */
export const AKTIVITAET_GRENZE = 500;

/**
 * Die Aktivitäten der letzten sieben Tage — die Liste hinter der Kachel
 * „Aktivität (7 Tage)" (V-149, DSH-04).
 *
 * **Dieselbe Tabelle, dieselbe Frist wie die Kachel** (`bericht/kacheln.ts`,
 * `letzte_aktivitaet`): `lead_aktivitaet`, `geschehen_am > now() - 7 Tage`,
 * und keine Nachrichten — die zählt die Kachel nicht, und eine Liste, die
 * mehr zeigt als die Zahl, ist dieselbe tote Zahl andersherum. Die Kachel
 * führte auf die Kundenliste, auf der keine einzige Aktivität steht.
 */
export async function leseAktivitaeten(
  kontext: LeseKontext, grenze: number = AKTIVITAET_GRENZE,
): Promise<readonly VerlaufEintrag[]> {
  const zeilen = await kontext.abfrage<Roh>(
    `select ${AKTIVITAET_SPALTEN} ${AKTIVITAET_QUELLE}
      where la.mandant_id = app.aktiver_mandant()
        and la.geschehen_am > now() - make_interval(days => $1::int)
      order by la.geschehen_am desc, la.id
      limit $2::int`,
    [AKTIVITAET_TAGE, grenze]);
  return zeilen.map(alsEintrag);
}

/* ---------------------------------------------------------------- Schreiben */

export const NOTIZ_ARTEN = ['notiz', 'anruf', 'email', 'termin'] as const;
export type NotizArt = (typeof NOTIZ_ARTEN)[number];
export const RICHTUNGEN = ['intern', 'eingehend', 'ausgehend'] as const;
export type Richtung = (typeof RICHTUNGEN)[number];
export const ZWECKE = ['vertraglich', 'transaktional', 'werbung'] as const;
export type Zweck = (typeof ZWECKE)[number];

/**
 * Der Kanal einer Art — dieselbe Abbildung wie auf dem Leadblatt
 * (`api/lead`, V-137): ein Anruf geht übers Telefon, eine E-Mail per E-Mail,
 * ein Termin vor Ort. Eine Notiz hat keinen Weg nach draussen und bleibt
 * `intern`, gleich was das Formular schickt.
 */
export const KANAL_DER_ART: Readonly<Record<NotizArt, string | null>> = {
  notiz: null, anruf: 'telefon', email: 'email', termin: 'vor_ort',
};

export interface NeueNotiz {
  readonly kundeId?: string | undefined;
  readonly ansprechpartnerId?: string | undefined;
  readonly art: string;
  readonly richtung: string;
  /** Nur bei ein- und ausgehend — und dort Pflicht, ohne Vorgabe (V-153, D-647). */
  readonly zweck?: string | undefined;
  readonly betreff?: string | undefined;
  readonly inhalt: string;
}

/** Was aus der Eingabe wird — rein, ohne Datenbank, deshalb eigens prüfbar. */
export interface NotizPlan {
  readonly art: NotizArt;
  readonly richtung: Richtung;
  readonly kanal: string | null;
  readonly zweck: 'intern' | Zweck;
  readonly betreff: string;
  readonly inhalt: string;
}

const istAus = <T extends string>(liste: readonly T[], wert: string): wert is T =>
  (liste as readonly string[]).includes(wert);

/**
 * Die Eingabe in eine Zeile übersetzen — und alles abweisen, was ein Mensch
 * lesen können muss, BEVOR die Datenbank es mit einem Code tut.
 *
 * **Der Betreff ist die erste Zeile der Notiz, wenn keiner kam.** `betreff`
 * ist NOT NULL; das Formular fragt ihn als freiwilliges Feld, und in der Liste
 * wird die erste Zeile gelesen (dieselbe Regel wie `api/lead`).
 */
export function planeNotiz(eingabe: NeueNotiz): NotizPlan {
  const inhalt = eingabe.inhalt.trim();
  if (inhalt === '') {
    throw new CrmFehler('Was ist passiert? Ohne Text gibt es nichts festzuhalten.',
      'ohne_inhalt');
  }
  if (!istAus(NOTIZ_ARTEN, eingabe.art)) {
    throw new CrmFehler('Diese Art gibt es nicht.', 'unbekannte_art');
  }
  if (!istAus(RICHTUNGEN, eingabe.richtung)) {
    throw new CrmFehler('Diese Richtung gibt es nicht.', 'unbekannte_richtung');
  }
  const kanal = KANAL_DER_ART[eingabe.art];
  const richtung: Richtung = kanal === null ? 'intern' : eingabe.richtung;
  /*
   * **Der Zweck ist eine Wahl, keine Vorgabe** (V-153, D-647). Hier stand
   * `eingabe.zweck ?? 'vertraglich'`, und das Formular wählte `vertraglich`
   * vor — die offenste Klasse des UWG-Tors, denn `vertraglich` sperrt es nie.
   * Wer nicht aktiv „Werbung" wählte, erzeugte einen § 7-Beleg „vertraglich".
   * Bei ein- und ausgehenden Einträgen muss der Mensch den Zweck nennen.
   */
  if (richtung !== 'intern' && eingabe.zweck === undefined) {
    throw new CrmFehler('Wählen Sie den Zweck — bei ein- und ausgehenden Einträgen steht er '
      + 'im § 7-Beleg, und eine Vorgabe entscheidet ihn nicht.', 'ohne_zweck');
  }
  const zweckRoh = eingabe.zweck ?? '';
  if (richtung !== 'intern' && !istAus(ZWECKE, zweckRoh)) {
    throw new CrmFehler('Diesen Zweck gibt es nicht.', 'unbekannter_zweck');
  }
  const ersteZeile = inhalt.split('\n')[0] ?? inhalt;
  const betreff = eingabe.betreff?.trim()
    || (ersteZeile.length > 80 ? `${ersteZeile.slice(0, 79)}…` : ersteZeile);
  return {
    art: eingabe.art,
    richtung,
    kanal: richtung === 'intern' ? null : kanal,
    zweck: richtung === 'intern' ? 'intern' : (zweckRoh as Zweck),
    betreff,
    inhalt,
  };
}

/**
 * Eine Notiz, einen Anruf, eine E-Mail oder einen Termin am Kunden oder am
 * Ansprechpartner festhalten (CRM-03).
 *
 * **Angelegt, nie geändert** — derselbe Grundsatz wie auf dem Leadblatt: ein
 * Verlauf, den man umschreiben kann, ist eine Erzählung. `geschehen_am` setzt
 * der Server (`kern.erzwinge_serverzeit_geschehen`, Invariante 5).
 *
 * **Ausgehend geht durch das UWG-Tor** (`kern.uwg_sendetor`, 0020): ein
 * ausgehender Anruf oder eine ausgehende E-Mail verlangt einen
 * Ansprechpartner, einen Zweck ausser `intern` und eine Rechtsgrundlage für
 * genau diesen Kanal und Zweck. Die Datenbank prüft es gegen den LEBENDEN
 * Kontakt und schreibt den Schnappschuss selbst. Hier steht nur der Satz, den
 * ein Mensch lesen kann, wenn sie Nein sagt.
 *
 * **Eine Aktivität hängt an einem Lead oder an einem Kunden**
 * (`lead_aktivitaet_hat_bezug`). Ein Ansprechpartner ohne Kunden (etwa aus
 * einer Web-Anfrage) hat hier deshalb keinen Weg — seine Kommunikation hält
 * das Leadblatt fest, an dem er hängt.
 */
export async function halteFest(
  kontext: SchreibKontext, eingabe: NeueNotiz,
): Promise<string> {
  const plan = planeNotiz(eingabe);
  if (eingabe.kundeId === undefined && eingabe.ansprechpartnerId === undefined) {
    throw new CrmFehler('Eine Notiz hängt an einem Kunden oder an einem Ansprechpartner.',
      'ohne_bezug');
  }
  /*
   * **Die Kennungen kommen aus versteckten Feldern** (V-153). Eine, die keine
   * UUID ist, endete am `::uuid` als 22P02 und damit als 500; jetzt ist sie
   * ein Satz auf dem Blatt.
   */
  for (const kennung of [eingabe.kundeId, eingabe.ansprechpartnerId]) {
    if (kennung !== undefined && !istUuid(kennung)) {
      throw new CrmFehler('Dieser Bezug ist ungültig.', 'ungueltiger_bezug', 400);
    }
  }

  let kundeId = eingabe.kundeId ?? null;
  const ansprechpartnerId = eingabe.ansprechpartnerId ?? null;
  /*
   * **Der Kunde muss in DIESEM Bereich stehen** (V-153). `lead_aktivitaet.
   * kunde_id` trägt keinen Fremdschlüssel (0017); ein verändertes Feld legte
   * eine Notiz mit der Kennung eines fremden oder gar keines Kunden an —
   * unsichtbar für beide, und doch ein Eintrag im § 7-Beleg. Gefragt wird mit
   * dem Mandanten der Sitzung, nicht nur über die Policy (Invariante 3).
   */
  if (kundeId !== null) {
    const [k] = await kontext.abfrage<{ id: string }>(
      `select id from kunde
        where mandant_id = app.aktiver_mandant() and id = $1::uuid
          and archiviert_am is null`, [kundeId]);
    if (k === undefined) {
      throw new CrmFehler('Diesen Kunden gibt es hier nicht.', 'kein_kunde', 404);
    }
  }
  if (ansprechpartnerId !== null) {
    const [ap] = await kontext.abfrage<{ kunde_id: string | null }>(
      `select kunde_id from ansprechpartner
        where mandant_id = app.aktiver_mandant() and id = $1::uuid
          and archiviert_am is null`, [ansprechpartnerId]);
    if (ap === undefined) {
      throw new CrmFehler('Diesen Ansprechpartner gibt es hier nicht.', 'kein_kontakt', 404);
    }
    if (ap.kunde_id === null) {
      throw new CrmFehler('Dieser Ansprechpartner hängt an keinem Kunden. Eine Notiz hängt '
        + 'aber an einem Lead oder an einem Kunden — halten Sie sie am Lead fest oder '
        + 'ordnen Sie ihn zuerst einem Kunden zu.', 'kontakt_ohne_kunde');
    }
    if (kundeId !== null && kundeId !== ap.kunde_id) {
      throw new CrmFehler('Dieser Ansprechpartner gehört zu einem anderen Kunden.',
        'fremder_kontakt');
    }
    kundeId = ap.kunde_id;
  }

  if (plan.richtung === 'ausgehend' && ansprechpartnerId === null
      && (plan.art === 'anruf' || plan.art === 'email')) {
    throw new CrmFehler('Ein ausgehender Anruf oder eine ausgehende E-Mail geht an einen '
      + 'Menschen. Wählen Sie den Ansprechpartner — sonst lässt sich nicht belegen, dass '
      + 'er kontaktiert werden durfte (§ 7 UWG).', 'ohne_ansprechpartner');
  }

  try {
    const [z] = await kontext.schreibe<{ id: string }>(
      `insert into lead_aktivitaet
         (mandant_id, kunde_id, ansprechpartner_id, typ, richtung, zweck, kanal,
          betreff, inhalt, akteur_art, benutzer_id)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::aktivitaet_typ,
               $4::aktivitaet_richtung, $5::kommunikationszweck, $6, $7, $8, 'mensch',
               app.aktueller_benutzer())
       returning id`,
      [kundeId, ansprechpartnerId, plan.art, plan.richtung, plan.zweck, plan.kanal,
        plan.betreff, plan.inhalt]);
    if (z === undefined) {
      throw new CrmFehler('Die Notiz wurde nicht festgehalten — fehlt `crm.schreiben`?',
        'kein_schreibrecht', 403);
    }
    return z.id;
  } catch (grund: unknown) {
    /*
     * Das UWG-Tor spricht als `insufficient_privilege` (42501) — und nennt
     * sich dabei. Eine abgewiesene Policy trägt denselben Code; sie ist KEIN
     * Widerspruch des Kontakts und wird deshalb nicht als einer gemeldet.
     */
    const fehler = grund as { code?: string; message?: string } | null;
    if (typeof fehler === 'object' && fehler !== null && fehler.code === '42501'
        && (fehler.message ?? '').includes('UWG')) {
      throw new CrmFehler('Für diesen Kanal und diesen Zweck ist keine Rechtsgrundlage '
        + 'aufgezeichnet, oder der Kontakt hat widersprochen (§ 7 UWG). Es wurde nichts '
        + 'festgehalten.', 'uwg', 403);
    }
    throw grund;
  }
}
