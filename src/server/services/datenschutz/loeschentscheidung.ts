/**
 * **Art. 17 DSGVO gegen die Aufbewahrungspflicht — eine Entscheidung, keine
 * Löschung** (LEG-09, LEG-01, LEG-02, Phase 7).
 *
 * `04-SEITENKARTE.md` §5.25 sagt es in einem Satz:
 * „`datenschutz.loeschung_pruefen` **does not delete**: it produces a decision
 * record naming, per field and per table, whether erasure is owed or
 * overridden by a retention obligation (§17 MiLoG two years, §147 AO ten
 * years, audit immutability, the invoice hash chain). Execution is
 * anonymisation plus tombstoning, and the hours themselves survive because the
 * law requires them to exist."
 *
 * **Und hier ist der Befund, der diesen Dienst ehrlich macht.** Den Vollzug,
 * auf den dieser Satz verweist, gibt es heute NICHT. Nachgemessen in der
 * lebenden Datenbank: es existiert genau EIN löschender Lauf
 * (`bewerber_loeschung`, und der betrifft nur abgelaufene Bewerbungen), keine
 * Funktion mit `anonymisier` im Namen, und kein Codepfad, der
 * `anonymisiert_am` schreibt. Für eine Beschäftigte, einen Kundenkontakt oder
 * eine Firma gibt es also weder Anonymisierung noch Tombstone.
 *
 * Eine Seite, die trotzdem „freigegeben" sagt, erzeugt eine unterschriebene
 * Freigabe für eine Ausführung, die niemand ausführt — genau das, wogegen
 * `loeschkonzept.ts` seine eigene Registerabfrage begründet („statt eine
 * Löschung zu behaupten, die niemand ausführt"). Deshalb heisst das Ergebnis
 * dieses Dienstes **Vormerkung** und nicht Vollzug, und `VOLLZUG` sagt in
 * Worten, was noch fehlt.
 *
 * // TODO(client, O-644): Wer führt die Löschvormerkung aus — Anonymisierungsprozedur, Nachtlauf, oder ein Mensch mit Protokollpflicht?
 *
 * **Die Fristen rechnet eine getestete Funktion, kein Modell** (Invariante 6).
 * `aoFrist` und `milogFrist` rechnen im Berliner KALENDER auf Datumszahlen und
 * berühren keinen Zeitpunkt — deshalb kann keine Sommerzeit sie um einen Tag
 * verschieben.
 */
import { KEIN_HARD_DELETE, type Loeschart } from '@/server/db/schema/rls';
import { LOESCHART_LABEL } from './loeschkonzept.js';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import type { Zuordnung, ZuordnungArt } from './anfrage.js';

export class LoeschFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'LoeschFehler';
  }
}

/* =========================================================================
 * Die Fristen — im Kalender, nicht auf der Uhr
 * ========================================================================= */

/** Ein Kalendertag in Berlin, als `YYYY-MM-DD`. */
export type Kalendertag = string;

const BERLIN_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Der Berliner Kalendertag eines Zeitpunkts.
 *
 * **Der Umweg über `Intl` ist der Punkt, nicht der Umstand.**
 * `date.getFullYear()` gäbe das Jahr der Zone, in der der Server läuft — und
 * ein Zeiteintrag vom 1. Januar 00:30 Berliner Zeit liegt in UTC noch im
 * Dezember. Eine Zehnjahresfrist, die davon abhängt, wo der Server steht, ist
 * keine Frist (Invariante 2).
 */
export function berlinTag(zeitpunkt: Date): Kalendertag {
  return BERLIN_ISO.format(zeitpunkt);
}

function teile(tag: Kalendertag): { j: number; m: number; t: number } {
  const [j, m, t] = tag.split('-').map((x) => Number.parseInt(x, 10));
  if (j === undefined || m === undefined || t === undefined
      || Number.isNaN(j) || Number.isNaN(m) || Number.isNaN(t)) {
    throw new LoeschFehler(`Kein Kalendertag: „${tag}"`, 'kein_tag');
  }
  return { j, m, t };
}

const ZWEI = (n: number): string => String(n).padStart(2, '0');

/** Der letzte Tag eines Monats — im Kalender, ohne Zeitzone. */
function monatsletzter(j: number, m: number): number {
  return [31, (j % 4 === 0 && j % 100 !== 0) || j % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 31;
}

/**
 * § 147 Abs. 3 und 4 AO: **zehn Jahre, gerechnet ab Ende des Kalenderjahres**,
 * in dem die Unterlage entstanden ist. Die Sperre fällt am 1. Januar danach.
 *
 * Ein Beleg vom 3. März 2026 ist damit bis zum 31. Dezember 2036
 * aufzubewahren; am 1. Januar 2037 darf er gelöscht werden.
 *
 * **Nicht „Datum plus zehn Jahre".** Das wäre der 3. März 2036 — zehn Monate
 * zu früh, und zehn Monate sind der Unterschied zwischen einer Löschung und
 * einer Verletzung der Aufbewahrungspflicht.
 */
export function aoFrist(entstanden: Kalendertag): Kalendertag {
  const { j } = teile(entstanden);
  return `${String(j + 11)}-01-01`;
}

/**
 * § 17 Abs. 2 MiLoG: die Arbeitszeitaufzeichnung ist **zwei Jahre** ab dem für
 * die Aufzeichnung maßgeblichen Zeitpunkt aufzubewahren. Die Sperre fällt am
 * Tag danach.
 *
 * **Kalendarisch, nicht 730 Tage.** Der 29. Februar hat in zwei Jahren keinen
 * Nachfolger; er fällt auf den 28. Februar, und das ist der frühere der beiden
 * möglichen Tage — die für den Betroffenen ungünstigere Wahl wäre der 1. März.
 */
export function milogFrist(aufgezeichnet: Kalendertag): Kalendertag {
  const { j, m, t } = teile(aufgezeichnet);
  const zielJahr = j + 2;
  const tag = Math.min(t, monatsletzter(zielJahr, m));
  return `${String(zielJahr)}-${ZWEI(m)}-${ZWEI(tag)}`;
}

/* =========================================================================
 * Die Orte, an denen etwas über diesen Menschen steht
 * ========================================================================= */

/** Woher die Sperre kommt — oder dass es keine gibt. */
export type Sperrgrund =
  | { readonly art: 'gesetz'; readonly fundstelle: string;
      readonly frist: 'ao' | 'milog' | null }
  | { readonly art: 'unveraenderlich'; readonly fundstelle: string }
  | { readonly art: 'offen'; readonly frage: string }
  | { readonly art: 'keine' };

interface OrtDefinition {
  readonly tabelle: string;
  readonly titel: string;
  readonly fuer: readonly Exclude<ZuordnungArt, 'keine'>[];
  /** Das Recht, ohne das die Zählung null ergibt — und das ist nicht null. */
  readonly recht: string | null;
  readonly sperre: Sperrgrund;
  /** Zählt die Zeilen und nennt den frühesten Anker für die Frist. */
  readonly sql: string;
}

/**
 * Die Orte, gezählt in der lebenden Datenbank und nicht geraten.
 *
 * **Jeder Ort nennt sein Recht.** Ein Ort, den die erteilten Rechte nicht
 * öffnen, zählt null Zeilen — und „null Zeilen" heisst dann NICHT „hier steht
 * nichts über diesen Menschen", sondern „ich durfte nicht nachsehen". Eine
 * Löschentscheidung auf dieser Grundlage wäre eine Entscheidung über
 * Ungelesenes. Der Ort erscheint deshalb als `ungelesen` in der Matrix, nicht
 * als leer — derselbe Fehler, der bei der Art.-15-Auskunft eine halbe Antwort
 * erzeugt.
 */
const ORTE: readonly OrtDefinition[] = [
  {
    tabelle: 'person',
    titel: 'Stammdaten der Person',
    fuer: ['person'],
    recht: null,
    sperre: { art: 'offen', frage: 'O-514' },
    sql: `select count(*)::int as zeilen, min(erstellt_am) as anker
            from person where id = $1::uuid and geloescht_am is null`,
  },
  {
    tabelle: 'anstellung',
    titel: 'Anstellungen',
    fuer: ['person'],
    recht: null,
    sperre: { art: 'offen', frage: 'O-514' },
    sql: `select count(*)::int as zeilen, min(erstellt_am) as anker
            from anstellung
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
             and geloescht_am is null`,
  },
  {
    tabelle: 'zeiteintrag',
    titel: 'Arbeitszeitaufzeichnungen',
    fuer: ['person'],
    recht: 'zeit.lesen',
    sperre: { art: 'gesetz', fundstelle: '§ 17 Abs. 2 MiLoG — zwei Jahre',
              frist: 'milog' },
    sql: `select count(*)::int as zeilen, max(beginn_zeitpunkt) as anker
            from zeiteintrag
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
             and ersetzt_am is null`,
  },
  {
    tabelle: 'abwesenheit',
    titel: 'Abwesenheiten',
    fuer: ['person'],
    recht: 'zeit.abwesenheit_lesen',
    sperre: { art: 'offen', frage: 'O-71' },
    sql: `select count(*)::int as zeilen, max(a.erstellt_am) as anker
            from abwesenheit a
            join anstellung an on an.id = a.anstellung_id
             and an.mandant_id = a.mandant_id
           where an.person_id = $1::uuid and a.mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'stundenkonto',
    titel: 'Stundenkonten',
    fuer: ['person'],
    recht: 'zeit.konto_lesen',
    sperre: { art: 'gesetz', fundstelle: '§ 147 Abs. 1 AO — Lohnunterlage, zehn Jahre',
              frist: 'ao' },
    sql: `select count(*)::int as zeilen, max(k.erstellt_am) as anker
            from stundenkonto k
            join anstellung an on an.id = k.anstellung_id
             and an.mandant_id = k.mandant_id
           where an.person_id = $1::uuid and k.mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'nachweis',
    titel: 'Qualifikationsnachweise',
    fuer: ['person'],
    recht: 'personal.nachweis_lesen',
    sperre: { art: 'offen', frage: 'O-46' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from nachweis where person_id = $1::uuid`,
  },
  {
    tabelle: 'da_kenntnisnahme',
    titel: 'Bestätigte Dienstanweisungen',
    fuer: ['person'],
    recht: 'dienstanweisung.lesen',
    sperre: { art: 'unveraenderlich',
              fundstelle: 'Nur Anfügen: die Bestätigung IST der Nachweis (GewO, § 6 ArbSchG)' },
    sql: `select count(*)::int as zeilen, max(bestaetigt_am) as anker
            from da_kenntnisnahme
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'wachbuch_eintrag',
    titel: 'Wachbucheinträge',
    fuer: ['person'],
    recht: 'wachbuch.lesen',
    sperre: { art: 'unveraenderlich',
              fundstelle: 'Hashkette des Wachbuchs — ein entfernter Eintrag bricht sie (§ 34a GewO)' },
    sql: `select count(*)::int as zeilen, max(erfasst_am) as anker
            from wachbuch_eintrag
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'schluessel_quittung',
    titel: 'Schlüsselquittungen',
    fuer: ['person'],
    recht: 'schluessel.lesen',
    sperre: { art: 'unveraenderlich',
              fundstelle: 'Nur Anfügen: die Quittung belegt die Übergabe (Haftung)' },
    sql: `select count(*)::int as zeilen, max(quittiert_am) as anker
            from schluessel_quittung
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'mitarbeiter_zugang',
    titel: 'Mitarbeiterzugang',
    fuer: ['person'],
    recht: null,
    sperre: { art: 'keine' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from mitarbeiter_zugang where person_id = $1::uuid`,
  },
  {
    tabelle: 'benachrichtigung',
    titel: 'Benachrichtigungen im Portal',
    fuer: ['person'],
    recht: 'datenschutz.auskunft_erstellen',
    sperre: { art: 'keine' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from app.benachrichtigung_auskunft($1::uuid)`,
  },
  {
    tabelle: 'ansprechpartner',
    titel: 'Kontaktdaten und werberechtliche Einstufung',
    fuer: ['ansprechpartner'],
    recht: 'crm.lesen',
    sperre: { art: 'gesetz',
              fundstelle: '§ 7 UWG — der Widerspruch IST der Beweis; Löschung über anonymisiert_am',
              frist: null },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from ansprechpartner
           where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'werbewiderspruch',
    titel: 'Protokoll der Widersprüche',
    fuer: ['ansprechpartner'],
    recht: 'crm.rechtsgrundlage_lesen',
    sperre: { art: 'gesetz',
              fundstelle: '§ 7 UWG — ohne das Protokoll ist die Abmahnung nicht abwehrbar',
              frist: null },
    sql: `select count(*)::int as zeilen, max(eingegangen_am) as anker
            from werbewiderspruch
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'bewerbung',
    titel: 'Bewerbung',
    fuer: ['bewerbung'],
    recht: 'recruiting.bewerbung_lesen',
    sperre: { art: 'offen', frage: 'O-373' },
    sql: `select count(*)::int as zeilen, max(eingegangen_am) as anker
            from bewerbung
           where id = $1::uuid and mandant_id = app.aktiver_mandant()
             and geloescht_am is null`,
  },
  {
    tabelle: 'bewerbung_bewertung',
    titel: 'Bewertungen der Bewerbung',
    fuer: ['bewerbung'],
    recht: 'recruiting.bewerbung_lesen',
    sperre: { art: 'offen', frage: 'O-373' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from bewerbung_bewertung
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'gespraech',
    titel: 'Gespräche und Notizen',
    fuer: ['bewerbung'],
    recht: 'recruiting.bewerbung_lesen',
    sperre: { art: 'offen', frage: 'O-373' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from gespraech
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'betroffenenanfrage',
    titel: 'Diese und frühere Betroffenenanfragen',
    fuer: ['person', 'ansprechpartner', 'bewerbung'],
    recht: null,
    sperre: { art: 'unveraenderlich',
              fundstelle: 'Art. 12 Abs. 3: der Nachweis, DASS eine Anfrage einging, ist das, '
                + 'was eine Aufsicht sehen will' },
    sql: `select count(*)::int as zeilen, max(eingegangen_am) as anker
            from betroffenenanfrage
           where mandant_id = app.aktiver_mandant()
             and (person_id = $1::uuid or ansprechpartner_id = $1::uuid
                  or bewerbung_id = $1::uuid)`,
  },
  {
    tabelle: 'audit_log',
    titel: 'Prüfprotokoll (Einträge über diesen Datensatz)',
    fuer: ['person', 'ansprechpartner', 'bewerbung'],
    /*
     * **Kein Recht, und das ist nachgemessen.** `t_audit_lesen` verlangt nur
     * `mandant_id is null or mandant_id = any(app.sichtbare_mandanten())` —
     * `system.audit_lesen` bewacht die SEITE, nicht die Zeile. Hier ein Recht
     * zu behaupten, das die Policy nicht fragt, hiesse „ungelesen" zu
     * schreiben, wo gelesen wurde: eine Aussage ueber die Berechtigung statt
     * ueber die Daten, und damit derselbe Fehler in die andere Richtung.
     * Gezaehlt wird ohnehin nur; die Nutzlast liegt hinter
     * `app.audit_nutzlast_lesen`.
     */
    recht: null,
    sperre: { art: 'unveraenderlich',
              fundstelle: 'SEC-A9, GoBD: ein löschbares Protokoll ist keines' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from audit_log
           where mandant_id = app.aktiver_mandant() and objekt_id = $1::text`,
  },
];

/** Eine Zeile der Entscheidungsmatrix. */
export interface Ort {
  readonly tabelle: string;
  readonly titel: string;
  /** Wie die Tabelle gegen harte Löschung gesichert ist — aus `rls.ts`. */
  readonly loeschart: Loeschart | null;
  readonly loeschartText: string;
  readonly sperre: Sperrgrund;
  readonly sperreText: string;
  /** Der Tag, an dem die Sperre fällt — `null`, wo keine Frist bekannt ist. */
  readonly sperreFaelltAm: Kalendertag | null;
  readonly zeilen: number;
  readonly recht: string | null;
  /** `true` heisst: das Recht fehlt, die Zahl ist KEINE Aussage. */
  readonly ungelesen: boolean;
  /** Die bereits getroffene Entscheidung, wenn es eine gibt. */
  readonly entscheidung: Entscheidungszeile | null;
}

export interface Entscheidungszeile {
  readonly id: string;
  readonly tabelle: string;
  readonly feld: string | null;
  readonly ergebnis: 'geschuldet' | 'ueberlagert' | 'offen' | 'anonymisierung';
  readonly rechtsgrundlage: string | null;
  readonly sperreFaelltAm: string | null;
  readonly offeneFrage: string | null;
  readonly bemerkung: string | null;
  readonly zeilen: number;
  readonly entschiedenAm: Date;
  readonly entschiedenVon: string | null;
}

export const ERGEBNIS_TEXT: Readonly<Record<Entscheidungszeile['ergebnis'], string>> = {
  geschuldet: 'Löschung geschuldet',
  ueberlagert: 'überlagert von einer Aufbewahrungspflicht',
  anonymisierung: 'Anonymisierung statt Löschung',
  offen: 'noch nicht entschieden',
};

/**
 * Was die Plattform heute wirklich ausführt — und was nicht.
 *
 * Gelesen aus `loeschkonzept.ts`: dort steht die EINE Wahrheit über die
 * löschenden Läufe, und sie wird aus dem Jobregister gefaltet. Hier steht der
 * Satz, den die Seite darüber sagt.
 */
export const VOLLZUG = {
  vorhanden: ['bewerber_loeschung — anonymisiert abgelaufene Bewerbungen (REC-07)'],
  fehlend: [
    'Keine Anonymisierungsprozedur für eine Person (`app.person_anonymisieren` '
    + 'ist in 02-CRM-OPERATIONS.md beschrieben und in der Datenbank nicht vorhanden)',
    'Kein Lauf, der `anonymisiert_am` auf `ansprechpartner` oder `kunde` setzt',
    'Kein Tombstone-Verfahren für eine Beschäftigte',
  ],
} as const;

function loeschartVon(tabelle: string): Loeschart | null {
  return KEIN_HARD_DELETE.find((l) => l.tabelle === tabelle)?.art ?? null;
}

function sperreText(s: Sperrgrund): string {
  switch (s.art) {
    case 'gesetz': return s.fundstelle;
    case 'unveraenderlich': return s.fundstelle;
    case 'offen': return `noch nicht entschieden (${s.frage})`;
    case 'keine': return 'keine Aufbewahrungspflicht bekannt';
  }
}

function faelltAm(s: Sperrgrund, anker: Date | null): Kalendertag | null {
  if (s.art !== 'gesetz' || s.frist === null || anker === null) return null;
  const tag = berlinTag(anker);
  return s.frist === 'ao' ? aoFrist(tag) : milogFrist(tag);
}

/**
 * Die Matrix: je Ort, was dort steht und was der Löschung entgegensteht.
 *
 * Sie LÖSCHT nichts und schlägt nichts vor, was das Gesetz nicht nennt. Wo
 * keine Frist entschieden ist, steht die offene Frage — und die Zeile bleibt
 * ohne Ergebnis, bis ein Mensch sie setzt.
 */
export async function matrix(
  kontext: LeseKontext, anfrageId: string, zuordnung: Zuordnung,
): Promise<readonly Ort[]> {
  const art = zuordnung.art;
  if (art === 'keine' || zuordnung.id === null) return [];
  const anwendbar = ORTE.filter((o) => o.fuer.includes(art));

  const noetig = [...new Set(anwendbar
    .map((o) => o.recht).filter((r): r is string => r !== null))];
  const gehalten = new Map<string, boolean>();
  if (noetig.length > 0) {
    const zeilen = await kontext.abfrage<{ recht: string; ok: boolean }>(
      `select r as recht, app.hat_recht(r, app.aktiver_mandant()) as ok
         from unnest($1::text[]) as r`, [noetig]);
    for (const z of zeilen) gehalten.set(z.recht, z.ok);
  }

  const getroffen = new Map<string, Entscheidungszeile>();
  for (const e of await liste(kontext, anfrageId)) {
    if (e.feld === null) getroffen.set(e.tabelle, e);
  }

  const aus: Ort[] = [];
  for (const o of anwendbar) {
    const ungelesen = o.recht !== null && gehalten.get(o.recht) !== true;
    const [z] = ungelesen
      ? [{ zeilen: 0, anker: null }]
      : await kontext.abfrage<{ zeilen: number; anker: Date | null }>(
        o.sql, [zuordnung.id]);
    const art = loeschartVon(o.tabelle);
    aus.push({
      tabelle: o.tabelle,
      titel: o.titel,
      loeschart: art,
      loeschartText: art === null
        ? 'keine Löschsperre registriert' : LOESCHART_LABEL[art],
      sperre: o.sperre,
      sperreText: sperreText(o.sperre),
      sperreFaelltAm: faelltAm(o.sperre, z?.anker ?? null),
      zeilen: z?.zeilen ?? 0,
      recht: o.recht,
      ungelesen,
      entscheidung: getroffen.get(o.tabelle) ?? null,
    });
  }
  return aus;
}

/** Die getroffenen Entscheidungen eines Vorgangs. */
export async function liste(
  kontext: LeseKontext, anfrageId: string,
): Promise<readonly Entscheidungszeile[]> {
  return kontext.abfrage<Entscheidungszeile>(
    `select l.id, l.tabelle, l.feld, l.ergebnis::text as ergebnis,
            l.rechtsgrundlage,
            to_char(l.sperre_faellt_am, 'YYYY-MM-DD') as "sperreFaelltAm",
            l.offene_frage as "offeneFrage", l.bemerkung, l.zeilen,
            l.entschieden_am as "entschiedenAm", b.name as "entschiedenVon"
       from loeschentscheidung l
       left join benutzer b on b.id = l.entschieden_von
      where l.mandant_id = app.aktiver_mandant() and l.anfrage_id = $1::uuid
      order by l.tabelle, l.feld nulls first`, [anfrageId]);
}

export interface NeueEntscheidung {
  readonly tabelle: string;
  readonly feld?: string | null;
  readonly ergebnis: Entscheidungszeile['ergebnis'];
  readonly rechtsgrundlage?: string | null;
  readonly sperreFaelltAm?: string | null;
  readonly offeneFrage?: string | null;
  readonly bemerkung?: string | null;
  readonly zeilen?: number;
}

/**
 * Eine Entscheidung festhalten — je Tabelle und Feld genau eine.
 *
 * **Sie schreibt `on conflict … do update`, und das ist keine Bequemlichkeit.**
 * Eine Prüfung ist ein Vorgang über Tage: man entscheidet `zeiteintrag`, liest
 * nach, korrigiert. Zwei Zeilen zu derselben Tabelle wären zwei Entscheidungen,
 * und welche gilt, sagte die Sortierung. Die Spur der Änderung liegt im
 * `audit_log`; die Zeile hier ist der Stand.
 *
 * Die beiden Bedingungen der Tabelle (`ueberlagert` braucht eine Fundstelle,
 * `offen` eine benannte Frage) stehen hier noch einmal in Worten — damit die
 * Oberfläche einen Satz bekommt statt einer Constraint-Verletzung.
 */
export async function entscheide(
  kontext: SchreibKontext, anfrageId: string, e: NeueEntscheidung,
): Promise<void> {
  if (e.tabelle.trim() === '') {
    throw new LoeschFehler('Ohne Tabelle gibt es keine Entscheidung.', 'ohne_ort');
  }
  if (e.ergebnis === 'ueberlagert'
      && (e.rechtsgrundlage ?? '').trim() === '') {
    throw new LoeschFehler(
      'Eine überlagerte Löschung braucht die Fundstelle, die sie überlagert. '
      + '„Wir behalten das" ohne Grund ist vor einer Aufsicht dasselbe wie '
      + '„wir wissen es nicht".', 'ohne_fundstelle');
  }
  if (e.ergebnis === 'offen' && (e.offeneFrage ?? '').trim() === '') {
    throw new LoeschFehler(
      'Offen heisst: mit benannter offener Frage. Ohne sie ist es Schweigen.',
      'ohne_frage');
  }

  await kontext.schreibe(
    `insert into loeschentscheidung
       (mandant_id, anfrage_id, tabelle, feld, zeilen, ergebnis, rechtsgrundlage,
        sperre_faellt_am, offene_frage, bemerkung, entschieden_von)
     values (app.aktiver_mandant(), $1::uuid, $2, $3, $4,
             $5::loeschentscheidung_ergebnis, $6, $7::date, $8, $9,
             app.aktueller_benutzer())
     on conflict (mandant_id, anfrage_id, tabelle, coalesce(feld, ''))
     do update set zeilen = excluded.zeilen, ergebnis = excluded.ergebnis,
                   rechtsgrundlage = excluded.rechtsgrundlage,
                   sperre_faellt_am = excluded.sperre_faellt_am,
                   offene_frage = excluded.offene_frage,
                   bemerkung = excluded.bemerkung,
                   entschieden_am = now(),
                   entschieden_von = app.aktueller_benutzer()`,
    [anfrageId, e.tabelle.trim(),
      e.feld === undefined || e.feld === null || e.feld.trim() === ''
        ? null : e.feld.trim(),
      e.zeilen ?? 0, e.ergebnis,
      (e.rechtsgrundlage ?? '').trim() === '' ? null : (e.rechtsgrundlage ?? '').trim(),
      (e.sperreFaelltAm ?? '') === '' ? null : e.sperreFaelltAm,
      (e.offeneFrage ?? '').trim() === '' ? null : (e.offeneFrage ?? '').trim(),
      (e.bemerkung ?? '').trim() === '' ? null : (e.bemerkung ?? '').trim()]);
}
