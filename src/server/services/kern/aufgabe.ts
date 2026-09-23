import 'server-only';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import type { LeseKontext, SchreibKontext } from '@/server/kontext';

/**
 * Aufgaben — Liste, Detail und die vier Zustandsuebergaenge (OPS-11, DSH-01,
 * SPEC §14).
 *
 * **Die Frist rechnet DIESER Dienst, nicht die Seite.** `faellig_am` ist ein
 * Zeitpunkt in UTC, `faellig_datum` ein Berliner Kalendertag — und die Frage
 * „ist das ueberfaellig" wird fuer die beiden verschieden beantwortet. Ein Tag
 * endet um 24:00 Berliner Zeit, nicht um 24:00 UTC, und an den zwei
 * Umstellungsnaechten ist der Unterschied eine Stunde. In einer Komponente
 * gerechnet stuende dieselbe Regel in vier Dateien, und die vierte waere die
 * mit dem festen Versatz (Invariante 2).
 *
 * **Erledigt und abgebrochen sind Zustaende, keine Loeschung.** `aufgabe`
 * traegt die Loeschsperre aus 0230; `brichAb` verlangt einen Grund, weil eine
 * Aufgabe, die ohne Begruendung verschwindet, von einer erledigten nicht zu
 * unterscheiden ist.
 *
 * **Der Zeitstempel kommt von der Serveruhr** (Invariante 5). `erledige`
 * setzt `now()` in der Datenbank und uebernimmt keinen Zeitpunkt vom
 * Aufrufer — sonst schliesst ein Browser mit falscher Uhr eine Aufgabe
 * gestern.
 */

export type AufgabeStatus = 'offen' | 'in_arbeit' | 'wartend' | 'erledigt' | 'abgebrochen';
export type Prioritaet = 'niedrig' | 'normal' | 'hoch' | 'dringend';

/** Die Zustaende, die noch Arbeit bedeuten — die Liste sortiert sie nach oben. */
export const OFFENE_ZUSTAENDE: readonly AufgabeStatus[] = ['offen', 'in_arbeit', 'wartend'];

export function istOffen(status: string): boolean {
  return (OFFENE_ZUSTAENDE as readonly string[]).includes(status);
}

/* -------------------------------------------------------------- Fristenlage */

export type Fristlage = 'ohne' | 'ueberfaellig' | 'heute' | 'demnaechst';

export interface Frist {
  /** Ein Zeitpunkt in UTC, oder `null`. */
  readonly faelligAm: Date | null;
  /** Ein Berliner Kalendertag `JJJJ-MM-TT`, oder `null`. */
  readonly faelligDatum: string | null;
}

/**
 * Wo eine Frist relativ zu JETZT liegt — in Europe/Berlin gedacht.
 *
 * Zwei Faelle, und sie sind wirklich verschieden:
 *
 *  · **Zeitpunkt** (`faellig_am`): der Vergleich ist eine Differenz zweier
 *    Instants und braucht keine Zeitzone. „Heute" braucht sie doch — ob
 *    22:30 UTC noch heute ist, entscheidet der Berliner Kalendertag, und im
 *    Sommer ist das schon morgen.
 *  · **Tag** (`faellig_datum`): ein Tag ist kein Zeitpunkt. „Bis Freitag"
 *    laeuft um 24:00 Berliner Zeit ab, und ein Vergleich gegen einen
 *    UTC-Mitternachtsinstant markierte die Aufgabe im Sommer zwei Stunden zu
 *    frueh als ueberfaellig. Verglichen werden deshalb KALENDERTAGE — ISO-Tage
 *    sortieren lexikographisch, also ist der Vergleich exakt und
 *    umstellungsfest.
 *
 * Sind beide gesetzt, gewinnt der Zeitpunkt. Die Datenbank laesst das nicht
 * zu (`aufgabe_eine_frist`), aber ein Dienst, der bei widerspruechlichen
 * Eingaben abstuerzt, waere die schlechtere von zwei Antworten.
 */
export function fristlage(frist: Frist, jetzt: Date): Fristlage {
  if (frist.faelligAm !== null) {
    if (frist.faelligAm.getTime() <= jetzt.getTime()) return 'ueberfaellig';
    return berlinKalendertag(frist.faelligAm) === berlinKalendertag(jetzt)
      ? 'heute' : 'demnaechst';
  }
  if (frist.faelligDatum === null) return 'ohne';
  const heute = berlinKalendertag(jetzt);
  if (frist.faelligDatum < heute) return 'ueberfaellig';
  return frist.faelligDatum === heute ? 'heute' : 'demnaechst';
}

/* ------------------------------------------------------------------- Bezuege */

/**
 * Die Bezuege, die dieser Dienst AUFLOESEN kann — und die Liste ist bewusst
 * kurz.
 *
 * `bezug_typ` hat sechsundzwanzig Werte (§7.2); sechs davon haben heute eine
 * Detailseite im Portal, deren Adresse das Register fuehrt. Ein Typ ohne
 * Eintrag hier ergibt eine Zeile MIT Bezugsnamen und OHNE Verweis — nie eine
 * tote Verknuepfung und nie einen Fehler. Ein Verweis auf eine Adresse, die
 * es nicht gibt, ist der sichtbarste 404 im Portal.
 */
interface Aufloeser {
  readonly tabelle: string;
  /** SQL-Ausdruck fuer den Anzeigenamen, auf `z` aliasiert. */
  readonly titel: string;
  /** Der Pfad unter `/portal/<mandant>/`, ohne fuehrenden Schrägstrich. */
  readonly pfad: string;
}

const AUFLOESER: Readonly<Record<string, Aufloeser>> = {
  auftrag: { tabelle: 'auftrag', titel: `z.auftragsnummer || ' — ' || z.bezeichnung`, pfad: 'auftraege' },
  objekt: { tabelle: 'objekt', titel: 'z.bezeichnung', pfad: 'objekte' },
  lead: { tabelle: 'lead', titel: `z.leadnummer || coalesce(' — ' || z.betreff, '')`, pfad: 'crm/leads' },
  kunde: { tabelle: 'kunde', titel: `z.kundennummer || ' — ' || z.name`, pfad: 'crm/kunden' },
  rechnung: { tabelle: 'rechnung', titel: `coalesce(z.nummer, 'Entwurf')`, pfad: 'finanzen/rechnungen' },
  angebot: { tabelle: 'angebot', titel: `z.angebotsnummer || ' — ' || z.titel`, pfad: 'angebote' },
};

export interface Bezug {
  readonly typ: string;
  readonly id: string;
  /** Der aufgeloeste Name, oder `null` — dann steht nur die Art da. */
  readonly titel: string | null;
  /** Der Pfad unter `/portal/<mandant>/`, oder `null` — dann kein Verweis. */
  readonly pfad: string | null;
}

/** Ein waehlbarer Bezug fuer das Anlegeformular (V-096). */
export interface Bezugskandidat {
  readonly typ: string;
  readonly id: string;
  readonly titel: string;
}

/**
 * **Was sich an eine Aufgabe haengen laesst** (V-096).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `aufgabe` traegt fuenf Bezugsfelder — `auftrag_id`, `objekt_id`, `lead_id`
 * und das polymorphe Paar `bezug_typ`/`bezug_id` —, die Route nimmt alle
 * fuenf entgegen, `loeseBezugAuf` loest sechs Arten auf, und die Detailseite
 * zeigt den Verweis. **Das Anlegeformular schickte keines davon.** Jede von
 * Hand angelegte Aufgabe stand damit frei in der Luft: „Rechnung pruefen" —
 * welche?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Angeboten wird genau das, was zurueckfuehrt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `bezug_typ` hat sechsundzwanzig Werte; `AUFLOESER` kennt die sechs, die
 * eine Detailseite haben. Einen siebten anzubieten hiesse, eine Aufgabe an
 * etwas zu haengen, das die Aufgabenseite danach nur als Wort zeigen kann —
 * ein Bezug, dem man nicht folgen kann, ist eine Notiz mit Kennung.
 *
 * **Die RLS entscheidet, was ein Mensch waehlen kann.** Jede Abfrage laeuft
 * unter der Sitzung; wer `crm.lesen` nicht haelt, bekommt keine Kunden zur
 * Auswahl — und braucht dafuer keine zweite Rechtepruefung hier, die von der
 * ersten abweichen koennte.
 */
export async function bezugskandidaten(
  kontext: LeseKontext,
): Promise<readonly Bezugskandidat[]> {
  /*
   * Eine Abfrage je Art und ein Deckel je Art: eine Auswahlliste, die alle
   * Rechnungen eines Jahres traegt, ist keine Auswahl mehr. Sortiert wird
   * nach dem, was zuletzt bewegt wurde — die Aufgabe entsteht fast immer zu
   * etwas, das gerade auf dem Tisch liegt.
   */
  const je = 50;
  const gruppen: readonly { readonly typ: string; readonly sql: string }[] = [
    { typ: 'auftrag',
      sql: `select id, auftragsnummer || ' — ' || bezeichnung as titel
              from auftrag where archiviert_am is null
                and status not in ('abgeschlossen', 'storniert')
             order by erstellt_am desc limit ${String(je)}` },
    { typ: 'objekt',
      sql: `select id, bezeichnung as titel from objekt
             where archiviert_am is null order by bezeichnung limit ${String(je)}` },
    { typ: 'kunde',
      sql: `select id, kundennummer || ' — ' || name as titel from kunde
             where archiviert_am is null order by name limit ${String(je)}` },
    { typ: 'lead',
      sql: `select id, leadnummer || coalesce(' — ' || betreff, '') as titel
              from lead order by erstellt_am desc limit ${String(je)}` },
    { typ: 'angebot',
      sql: `select id, angebotsnummer || ' — ' || titel as titel from angebot
             where archiviert_am is null order by erstellt_am desc limit ${String(je)}` },
    { typ: 'rechnung',
      /*
       * Der Kundenname kommt ueber den Join und nicht aus einer Spalte auf
       * `rechnung`: die Tabelle fuehrt keine — der Empfaenger steht im
       * eingefrorenen Schnappschuss der Festschreibung, und den fuer eine
       * Auswahlliste aufzuschlagen waere teuer und fuer einen Entwurf leer.
       */
      sql: `select r.id, coalesce(r.nummer, 'Entwurf') || ' — ' || k.name as titel
              from rechnung r join kunde k on k.id = r.kunde_id
             order by r.erstellt_am desc limit ${String(je)}` },
  ];

  const alle: Bezugskandidat[] = [];
  for (const g of gruppen) {
    /*
     * Ein fehlendes Recht gibt null Zeilen (RLS), keinen Fehler — die Gruppe
     * fehlt dann in der Auswahl, und das ist die richtige Antwort. Ein
     * `catch` faengt trotzdem: eine Tabelle, die eine Sitzung gar nicht
     * SELECTen darf, wirft `42501`, und dann soll die halbe Auswahl stehen
     * und nicht die ganze Seite fallen.
     */
    try {
      const zeilen = await kontext.abfrage<{ id: string; titel: string }>(g.sql);
      for (const z of zeilen) alle.push({ typ: g.typ, id: z.id, titel: z.titel });
    } catch {
      continue;
    }
  }
  return alle;
}

/**
 * Loest einen polymorphen Bezug auf seinen Namen auf.
 *
 * Eine Abfrage je Aufruf und nur fuer EINE Zeile: das ist die Detailseite.
 * Die Liste loest nicht auf — sie zeigt `auftrag_id`, `objekt_id` und
 * `lead_id` ueber Joins, weil das die drei sind, die einen eigenen
 * Fremdschluessel tragen.
 */
export async function loeseBezugAuf(
  kontext: LeseKontext, typ: string | null, id: string | null,
): Promise<Bezug | null> {
  if (typ === null || id === null) return null;
  const a = AUFLOESER[typ];
  if (a === undefined) return { typ, id, titel: null, pfad: null };
  const zeilen = await kontext.abfrage<{ titel: string | null }>(
    `select ${a.titel} as titel from ${a.tabelle} z where z.id = $1`, [id],
  );
  const titel = zeilen[0]?.titel ?? null;
  // Keine Zeile heisst: die RLS gibt sie nicht her oder sie ist fort. Beides
  // ergibt eine Aufgabe ohne Verweis, nie einen Fehler und nie einen Link,
  // der 404 gibt.
  return { typ, id, titel, pfad: titel === null ? null : `${a.pfad}/${id}` };
}

/* ----------------------------------------------------------- Bezugsarten */

/**
 * Die 26 Werte des Aufzaehlungstyps `bezug_typ` aus 0230 — hier, weil ein
 * Cast keine Pruefung ist.
 *
 * `$n::bezug_typ` wirft bei einem unbekannten Wort `22P02` („invalid input
 * value for enum"), und das ist in einem Routenhandler eine 500 statt einer
 * 400 und auf einer Seite eine Fehlerseite statt einer leeren Liste. Beides
 * kam von aussen und war keine Stoerung, sondern eine Eingabe — also wird
 * sie geprueft, bevor sie in die Abfrage geht. Die Reihenfolge ist die des
 * Enums; wer dort einen Wert ergaenzt, ergaenzt ihn hier.
 */
export const BEZUG_TYPEN: readonly string[] = [
  'lead', 'angebot', 'auftrag', 'projekt', 'rechnung', 'eingangsrechnung',
  'objekt', 'einsatz', 'zeiteintrag', 'nachtrag', 'ausschreibung',
  'ausschreibung_vorgang', 'vergabemappe', 'bewerbung', 'kandidat',
  'gespraech', 'stelle', 'social_post', 'referenz', 'seite', 'person',
  'anstellung', 'kunde', 'freigabe', 'dokument', 'agent_aufgabe',
];

export function istBezugTyp(wert: string): boolean {
  return BEZUG_TYPEN.includes(wert);
}

/* --------------------------------------------------------------------- Liste */

export interface AufgabeFilter {
  /** Nur, was mir zugewiesen ist oder an einem meiner Teams haengt. */
  readonly nurMeine?: boolean;
  /** Nur offene, in Arbeit und wartende. */
  readonly nurOffene?: boolean;
  /** Einer der Werte aus `BEZUG_TYPEN` — sonst wirft der Dienst. */
  readonly bezugTyp?: string;
}

/**
 * Die WHERE-Bausteine des Filters — EINMAL, fuer Liste und Zaehlung.
 *
 * Getrennt geschrieben waren sie auseinandergelaufen, und zwar sichtbar: die
 * Kopfzeile zaehlte ungefiltert, die Liste darunter gefiltert, und ueber
 * einer einzeiligen Liste stand „12 offen". Die Kopfzahl ist die
 * DSH-01-Auskunft, auf die jemand reagiert; zwei Zahlen auf zwei
 * Grundmengen sind dort schlimmer als eine Zahl weniger.
 */
function filterBausteine(
  filter: AufgabeFilter, werte: unknown[],
): readonly string[] {
  const wo: string[] = ['a.geloescht_am is null'];
  if (filter.nurOffene === true) {
    wo.push(`a.status in ('offen','in_arbeit','wartend')`);
  }
  if (filter.nurMeine === true) {
    wo.push(`(a.zugewiesen_an = app.aktueller_benutzer()
              or a.zugewiesen_team_id in (select tm.team_id from team_mitglied tm
                                           where tm.person_id = app.aktuelle_person()))`);
  }
  if (filter.bezugTyp !== undefined) {
    // Der Cast liegt hinter der Whitelist, nicht davor.
    if (!istBezugTyp(filter.bezugTyp)) {
      throw new Error(`Unbekannte Bezugsart: ${filter.bezugTyp}`);
    }
    werte.push(filter.bezugTyp);
    wo.push(`a.bezug_typ = $${String(werte.length)}::bezug_typ`);
  }
  return wo;
}

export interface AufgabeZeile {
  readonly id: string;
  readonly titel: string;
  readonly status: AufgabeStatus;
  readonly prioritaet: Prioritaet;
  readonly faelligAm: Date | null;
  readonly faelligDatum: string | null;
  readonly zugewiesenAn: string | null;
  readonly team: string | null;
  readonly quelle: string;
  readonly quelleJob: string | null;
  /** Der Bezug mit Namen und Ziel, oder `null`. */
  readonly bezug: Bezug | null;
}

interface RohZeile {
  readonly id: string;
  readonly titel: string;
  readonly status: AufgabeStatus;
  readonly prioritaet: Prioritaet;
  readonly faellig_am: Date | string | null;
  readonly faellig_datum: Date | string | null;
  readonly zugewiesen_an: string | null;
  readonly team: string | null;
  readonly quelle: string;
  readonly quelle_job: string | null;
  readonly bezug_typ: string | null;
  readonly bezug_id: string | null;
  readonly bezug_titel: string | null;
  readonly bezug_pfad: string | null;
}

/** `date` kommt je Treiber als `Date` oder als String zurueck. */
function alsTag(wert: Date | string | null): string | null {
  if (wert === null) return null;
  return typeof wert === 'string' ? wert.slice(0, 10) : wert.toISOString().slice(0, 10);
}

function alsInstant(wert: Date | string | null): Date | null {
  if (wert === null) return null;
  return wert instanceof Date ? wert : new Date(wert);
}

/**
 * Die Liste — nach FRIST sortiert, offene zuerst.
 *
 * Nach Eingang sortiert sah sie ordentlich aus und liess die eilige Aufgabe
 * unten liegen; das ist dieselbe Begruendung wie beim Lead-Posteingang
 * (CRM-07).
 *
 * `coalesce(faellig_am, (faellig_datum + time '23:59') at time zone
 * 'Europe/Berlin')` bringt die zwei Fristarten in EINE Ordnung — und zwar
 * richtig: ein Tag endet zur Berliner Mitternacht, und `at time zone` rechnet
 * den Versatz des jeweiligen Datums, nicht den von heute.
 */
export async function listeAufgaben(
  kontext: LeseKontext, filter: AufgabeFilter = {},
): Promise<readonly AufgabeZeile[]> {
  const werte: unknown[] = [];
  const wo = filterBausteine(filter, werte);

  const zeilen = await kontext.abfrage<RohZeile>(
    `select a.id, a.titel, a.status::text as status, a.prioritaet::text as prioritaet,
            a.faellig_am, a.faellig_datum,
            b.name as zugewiesen_an, t.name as team,
            a.quelle::text as quelle, a.quelle_job,
            /*
             * Der Bezug der LISTE kommt aus den drei eigenen Schluesseln —
             * ein Join je polymorphem Typ waere sechsundzwanzig Joins fuer
             * eine Spalte. Steht nur bezug_typ, zeigt die Zeile die Art.
             */
            case when a.auftrag_id is not null then 'auftrag'
                 when a.objekt_id  is not null then 'objekt'
                 when a.lead_id    is not null then 'lead'
                 else a.bezug_typ::text end as bezug_typ,
            coalesce(a.auftrag_id, a.objekt_id, a.lead_id, a.bezug_id) as bezug_id,
            case when a.auftrag_id is not null
                   then auf.auftragsnummer || ' — ' || auf.bezeichnung
                 when a.objekt_id is not null then obj.bezeichnung
                 when a.lead_id   is not null
                   then le.leadnummer || coalesce(' — ' || le.betreff, '')
                 else null end as bezug_titel,
            /*
             * **Der Verweis entsteht nur, wenn die Zeile LESBAR ist.**
             *
             * Die drei Joins laufen unter RLS: fehlt der Sitzung
             * auftrag.lesen, kommt auf.id als NULL zurueck — und dann
             * steht in der Liste die Art ohne Verweis. Ein Verweis auf eine
             * Seite, die diese Sitzung nicht oeffnen darf, ist ein 404, der
             * die Existenz dessen verraet, was er nicht zeigen darf (AUT-06,
             * D-567). Geprueft wird das hier von der Datenbank und nicht von
             * einer zweiten Rechteabfrage, die auseinanderlaufen koennte.
             */
            case when auf.id is not null then 'auftraege/' || auf.id::text
                 when obj.id is not null then 'objekte/'   || obj.id::text
                 when le.id  is not null then 'crm/leads/' || le.id::text
                 else null end as bezug_pfad
       from aufgabe a
       left join benutzer b on b.id = a.zugewiesen_an
       left join team t     on t.mandant_id = a.mandant_id and t.id = a.zugewiesen_team_id
       left join auftrag auf on auf.mandant_id = a.mandant_id and auf.id = a.auftrag_id
       left join objekt  obj on obj.mandant_id = a.mandant_id and obj.id = a.objekt_id
       left join lead    le  on le.mandant_id  = a.mandant_id and le.id  = a.lead_id
      where ${wo.join(' and ')}
      order by (a.status not in ('offen','in_arbeit','wartend')),
               coalesce(a.faellig_am,
                        (a.faellig_datum + time '23:59') at time zone 'Europe/Berlin')
                 nulls last,
               case a.prioritaet when 'dringend' then 0 when 'hoch' then 1
                                 when 'normal' then 2 else 3 end,
               a.erstellt_am desc`,
    werte,
  );

  return zeilen.map((z) => ({
    id: z.id,
    titel: z.titel,
    status: z.status,
    prioritaet: z.prioritaet,
    faelligAm: alsInstant(z.faellig_am),
    faelligDatum: alsTag(z.faellig_datum),
    zugewiesenAn: z.zugewiesen_an,
    team: z.team,
    quelle: z.quelle,
    quelleJob: z.quelle_job,
    bezug: z.bezug_typ === null || z.bezug_id === null ? null : {
      typ: z.bezug_typ, id: z.bezug_id,
      titel: z.bezug_titel, pfad: z.bezug_pfad,
    },
  }));
}

/**
 * Wie viele je Zustand — fuer die Kopfzeile und DSH-01.
 *
 * **Derselbe Filter wie die Liste**, und das ist der ganze Punkt: die
 * Kopfzahl steht ueber der Liste, also muss sie dieselbe Grundmenge zaehlen.
 * `nurOffene` bleibt dabei aussen vor — die Zaehlung GRUPPIERT nach Zustand,
 * die Kopfzeile addiert daraus selbst, und ein `nurOffene` im WHERE machte
 * aus „3 offen, 12 erledigt" ein „3 offen" ohne Gegenzahl.
 */
export async function zaehleJeZustand(
  kontext: LeseKontext, filter: AufgabeFilter = {},
): Promise<Readonly<Record<string, number>>> {
  const werte: unknown[] = [];
  const wo = filterBausteine(
    {
      ...(filter.nurMeine === true ? { nurMeine: true } : {}),
      ...(filter.bezugTyp === undefined ? {} : { bezugTyp: filter.bezugTyp }),
    },
    werte,
  );
  const zeilen = await kontext.abfrage<{ status: string; anzahl: string }>(
    `select a.status::text as status, count(*)::text as anzahl
       from aufgabe a where ${wo.join(' and ')}
      group by 1`,
    werte,
  );
  return Object.fromEntries(zeilen.map((z) => [z.status, Number(z.anzahl)]));
}

/* -------------------------------------------------------------------- Detail */

export interface AufgabeDetail extends AufgabeZeile {
  readonly beschreibung: string | null;
  readonly erstelltAm: Date;
  readonly erstelltVon: string | null;
  readonly geaendertAm: Date | null;
  readonly erledigtAm: Date | null;
  readonly erledigtVon: string | null;
  readonly abgebrochenGrund: string | null;
  readonly jobLaufId: string | null;
  readonly zugewiesenAnId: string | null;
  readonly zugewiesenTeamId: string | null;
}

/**
 * Eine Aufgabe, oder `null`.
 *
 * `null` heisst „gibt es nicht ODER darf diese Sitzung nicht sehen", und die
 * Seite antwortet darauf mit 404 und nie mit 403: ein 403 bestaetigte die
 * Existenz (AUT-06).
 */
export async function ladeAufgabe(
  kontext: LeseKontext, id: string,
): Promise<AufgabeDetail | null> {
  interface Roh extends RohZeile {
    readonly beschreibung: string | null;
    readonly erstellt_am: Date | string;
    readonly erstellt_von: string | null;
    readonly geaendert_am: Date | string | null;
    readonly erledigt_am: Date | string | null;
    readonly erledigt_von: string | null;
    readonly abgebrochen_grund: string | null;
    readonly job_lauf_id: string | null;
    readonly zugewiesen_an_id: string | null;
    readonly zugewiesen_team_id: string | null;
  }
  const [z] = await kontext.abfrage<Roh>(
    `select a.id, a.titel, a.beschreibung,
            a.status::text as status, a.prioritaet::text as prioritaet,
            a.faellig_am, a.faellig_datum,
            a.quelle::text as quelle, a.quelle_job, a.job_lauf_id,
            a.erstellt_am, a.geaendert_am, a.erledigt_am, a.abgebrochen_grund,
            a.zugewiesen_an as zugewiesen_an_id, a.zugewiesen_team_id,
            b.name as zugewiesen_an, t.name as team,
            e.name as erstellt_von, f.name as erledigt_von,
            a.bezug_typ::text as bezug_typ, a.bezug_id,
            null::text as bezug_titel, null::text as bezug_pfad,
            a.auftrag_id, a.objekt_id, a.lead_id
       from aufgabe a
       left join benutzer b on b.id = a.zugewiesen_an
       left join benutzer e on e.id = a.erstellt_von
       left join benutzer f on f.id = a.erledigt_von
       left join team t     on t.mandant_id = a.mandant_id and t.id = a.zugewiesen_team_id
      where a.id = $1 and a.geloescht_am is null`,
    [id],
  );
  if (z === undefined) return null;

  /*
   * Der Bezug der DETAILseite wird wirklich aufgeloest — hier lohnt die
   * zweite Abfrage, und hier faellt ein fehlender Name auf.
   */
  const roh = z as Roh & {
    auftrag_id: string | null; objekt_id: string | null; lead_id: string | null;
  };
  const eigener: readonly [string, string | null][] = [
    ['auftrag', roh.auftrag_id], ['objekt', roh.objekt_id], ['lead', roh.lead_id],
  ];
  const treffer = eigener.find(([, wert]) => wert !== null);
  const bezug = treffer !== undefined
    ? await loeseBezugAuf(kontext, treffer[0], treffer[1])
    : await loeseBezugAuf(kontext, z.bezug_typ, z.bezug_id);

  return {
    id: z.id,
    titel: z.titel,
    beschreibung: z.beschreibung,
    status: z.status,
    prioritaet: z.prioritaet,
    faelligAm: alsInstant(z.faellig_am),
    faelligDatum: alsTag(z.faellig_datum),
    zugewiesenAn: z.zugewiesen_an,
    zugewiesenAnId: z.zugewiesen_an_id,
    zugewiesenTeamId: z.zugewiesen_team_id,
    team: z.team,
    quelle: z.quelle,
    quelleJob: z.quelle_job,
    jobLaufId: z.job_lauf_id,
    bezug,
    erstelltAm: alsInstant(z.erstellt_am) ?? new Date(0),
    erstelltVon: z.erstellt_von,
    geaendertAm: alsInstant(z.geaendert_am),
    erledigtAm: alsInstant(z.erledigt_am),
    erledigtVon: z.erledigt_von,
    abgebrochenGrund: z.abgebrochen_grund,
  };
}

/** Die Zuweisungsziele: Benutzer und Teams dieser Gesellschaft. */
export interface Zuweisungsziele {
  readonly benutzer: readonly { readonly id: string; readonly name: string }[];
  readonly teams: readonly { readonly id: string; readonly name: string }[];
}

export async function ladeZuweisungsziele(kontext: LeseKontext): Promise<Zuweisungsziele> {
  const benutzer = await kontext.abfrage<{ id: string; name: string }>(
    `select distinct b.id, b.name
       from benutzer b
       join benutzer_mandant bm on bm.benutzer_id = b.id
      where bm.mandant_id = app.aktiver_mandant() and b.status = 'aktiv'
      order by b.name`,
  );
  const teams = await kontext.abfrage<{ id: string; name: string }>(
    `select t.id, t.name from team t
      where t.geloescht_am is null order by t.name`,
  );
  return { benutzer, teams };
}

/* ------------------------------------------------------------------ Schreiben */

export interface NeueAufgabe {
  readonly titel: string;
  readonly beschreibung?: string | null;
  readonly prioritaet?: Prioritaet;
  /** Berliner Kalendertag `JJJJ-MM-TT`. Ein Zeitpunkt setzt `faelligAm`. */
  readonly faelligDatum?: string | null;
  readonly faelligAm?: Date | null;
  readonly zugewiesenAn?: string | null;
  readonly zugewiesenTeamId?: string | null;
  readonly auftragId?: string | null;
  readonly objektId?: string | null;
  readonly leadId?: string | null;
  readonly bezugTyp?: string | null;
  readonly bezugId?: string | null;
}

export async function legeAn(
  kontext: SchreibKontext, eingabe: NeueAufgabe,
): Promise<string> {
  /*
   * Die zwei Zusagen, die `$11::bezug_typ` und `aufgabe_bezug_paarweise`
   * sonst als 22P02 bzw. 23514 aus der Datenbank holen — und ein 22P02 aus
   * einem Routenhandler ist eine 500, wo eine 400 hingehoert.
   */
  if (eingabe.bezugTyp !== null && eingabe.bezugTyp !== undefined
      && !istBezugTyp(eingabe.bezugTyp)) {
    throw new Error(`Unbekannte Bezugsart: ${eingabe.bezugTyp}`);
  }
  const hatTyp = eingabe.bezugTyp !== null && eingabe.bezugTyp !== undefined;
  const hatId = eingabe.bezugId !== null && eingabe.bezugId !== undefined;
  if (hatTyp !== hatId) {
    throw new Error('Ein Bezug ist ein Paar: bezugTyp und bezugId, oder keines von beiden');
  }
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into aufgabe
       (mandant_id, titel, beschreibung, prioritaet, faellig_am, faellig_datum,
        zugewiesen_an, zugewiesen_team_id, auftrag_id, objekt_id, lead_id,
        bezug_typ, bezug_id, quelle, erstellt_von)
     values (app.aktiver_mandant(), $1, $2, coalesce($3::prioritaet, 'normal'),
             $4::timestamptz, $5::date, $6, $7, $8, $9, $10,
             $11::bezug_typ, $12, 'mensch', app.aktueller_benutzer())
     returning id`,
    [eingabe.titel, eingabe.beschreibung ?? null, eingabe.prioritaet ?? null,
     eingabe.faelligAm ?? null, eingabe.faelligDatum ?? null,
     eingabe.zugewiesenAn ?? null, eingabe.zugewiesenTeamId ?? null,
     eingabe.auftragId ?? null, eingabe.objektId ?? null, eingabe.leadId ?? null,
     eingabe.bezugTyp ?? null, eingabe.bezugId ?? null],
  );
  if (z === undefined) throw new Error('Aufgabe konnte nicht angelegt werden');
  return z.id;
}

/**
 * Status setzen — ohne `erledigt` und `abgebrochen`.
 *
 * Die beiden haben eigene Funktionen, weil sie Pflichtfelder mitbringen
 * (`erledigt_am`/`erledigt_von` bzw. ein Grund) und die Datenbank sonst mit
 * `23514` antwortet: richtig, und an der falschen Stelle erklaert.
 */
export async function setzeStatus(
  kontext: SchreibKontext, id: string, status: 'offen' | 'in_arbeit' | 'wartend',
): Promise<boolean> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update aufgabe set status = $2::aufgabe_status,
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and geloescht_am is null
        and status not in ('erledigt','abgebrochen')
      returning id`,
    [id, status],
  );
  return zeilen.length === 1;
}

export async function weiseZu(
  kontext: SchreibKontext, id: string,
  ziel: { readonly benutzerId?: string | null; readonly teamId?: string | null },
): Promise<boolean> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update aufgabe set zugewiesen_an = $2, zugewiesen_team_id = $3,
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and geloescht_am is null
      returning id`,
    [id, ziel.benutzerId ?? null, ziel.teamId ?? null],
  );
  return zeilen.length === 1;
}

/**
 * Erledigen — Zeitpunkt und Mensch von der SERVERUHR und aus der Sitzung.
 *
 * `now()` in der Datenbank, `app.aktueller_benutzer()` aus der gebundenen
 * Sitzung: beides kommt nicht vom Aufrufer. Ein Rumpf, der „erledigt von"
 * mitschickte, waere eine Erledigung im Namen eines anderen.
 */
export async function erledige(
  kontext: SchreibKontext, id: string,
): Promise<boolean> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update aufgabe
        set status = 'erledigt', erledigt_am = now(),
            erledigt_von = app.aktueller_benutzer(),
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and geloescht_am is null and status <> 'abgebrochen'
      returning id`,
    [id],
  );
  return zeilen.length === 1;
}

export async function brichAb(
  kontext: SchreibKontext, id: string, grund: string,
): Promise<boolean> {
  if (grund.trim() === '') throw new Error('Abbrechen verlangt einen Grund');
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update aufgabe
        set status = 'abgebrochen', abgebrochen_grund = $2,
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and geloescht_am is null and status <> 'erledigt'
      returning id`,
    [id, grund.trim()],
  );
  return zeilen.length === 1;
}
