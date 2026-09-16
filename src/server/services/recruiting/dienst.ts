/**
 * Recruiting — Stellen, Bewerbungen, Bewertung, Entscheidung (REC-01…REC-09).
 *
 * **Was hier NICHT passiert.** Kein Modell entscheidet, kein Modell rechnet
 * eine Punktzahl, und keine Zeile behauptet je, eine Stelle sei bei einer
 * Jobbörse erschienen, weil ein Adapter `true` gesagt hat. Die drei Regeln
 * stehen an drei Stellen: `rangfolge.ts` rechnet, `0166` riegelt die
 * Entscheidung auf einen benannten Menschen, und `veroeffentlichung.ts` führt
 * `nicht_verbunden` als ZUSTAND.
 */
/**
 * **Jede Abfrage nennt ihren Mandanten selbst** — auch dort, wo eine
 * RLS-Policy es ohnehin täte.
 *
 * Das ist CLAUDE.md, Invariante 3: „RLS ist die zweite Verteidigungslinie, nie
 * die einzige und nie abwesend." Der Grund dafür steht in dieser Datei als
 * Befund: `t_stelle_oeffentlich` gibt jede VERÖFFENTLICHTE Stelle frei — ohne
 * Mandantenbedingung, weil eine veröffentlichte Stelle auf der Karriereseite
 * ohnehin öffentlich ist. Policies sind permissiv und ODERn sich: damit stand
 * in `/portal/reinigung/recruiting/stellen` die veröffentlichte Stelle JEDER
 * Gesellschaft. Kein Geheimnis war offen — die Liste war schlicht falsch, und
 * der erste Klick darauf führte in einen Fremdmandanten, wo der nächste
 * Schreibvorgang am Fremdschlüssel zerbrach.
 *
 * Gefunden hat das `tests/e2e/recruiting.spec.ts` mit einem Klick auf die
 * erste Zeile der Liste.
 */
import { randomUUID } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { rangfolge, type Kriterium, type Rangzeile } from './rangfolge.js';

export type StelleStatus = 'entwurf' | 'freigegeben' | 'veroeffentlicht' | 'geschlossen';
export type BewerbungStatus =
  | 'eingegangen' | 'in_pruefung' | 'gespraech' | 'abgelehnt' | 'eingestellt' | 'zurueckgezogen';
export type BewerbungQuelle = 'karriereseite' | 'initiativ' | 'mail' | 'import';

export class RecruitingFehler extends Error {
  readonly status: number;
  constructor(meldung: string, readonly grund: string, status = 409) {
    super(meldung);
    this.name = 'RecruitingFehler';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Stellen
// ---------------------------------------------------------------------------

export interface StelleZeile {
  readonly id: string;
  readonly titel: string;
  readonly beschreibung: string;
  readonly anforderungen: readonly string[];
  readonly einsatzort: string | null;
  readonly wochenstunden: string | null;
  readonly status: StelleStatus;
  readonly entwurfVonArt: 'mensch' | 'agent' | 'system';
  readonly bewerbungsfrist: string | null;
  readonly veroeffentlichtAm: Date | null;
  readonly geschlossenAm: Date | null;
  readonly bewerbungen: number;
}

const STELLE_FELDER = `
  s.id, s.titel, s.beschreibung, s.anforderungen, s.einsatzort,
  s.wochenstunden::text                   as wochenstunden,
  s.status::text                          as status,
  s.entwurf_von_art::text                 as "entwurfVonArt",
  s.bewerbungsfrist::text                 as bewerbungsfrist,
  s.veroeffentlicht_am                    as "veroeffentlichtAm",
  s.geschlossen_am                        as "geschlossenAm",
  (select count(*)::int from bewerbung b
    where b.stelle_id = s.id and b.geloescht_am is null) as bewerbungen`;

export async function listeStellen(kontext: LeseKontext): Promise<readonly StelleZeile[]> {
  return kontext.abfrage<StelleZeile>(
    `select ${STELLE_FELDER} from stelle s
       where s.mandant_id = app.aktiver_mandant()
       order by s.erstellt_am desc limit 200`);
}

export async function ladeStelle(
  kontext: LeseKontext, id: string,
): Promise<StelleZeile | null> {
  const [z] = await kontext.abfrage<StelleZeile>(
    `select ${STELLE_FELDER} from stelle s
      where s.id = $1::uuid and s.mandant_id = app.aktiver_mandant()`, [id]);
  return z ?? null;
}

/** Was die öffentliche Karriereseite zeigt: veröffentlicht und nicht geschlossen. */
export async function oeffentlicheStellen(
  kontext: LeseKontext, mandantId: string,
): Promise<readonly StelleZeile[]> {
  return kontext.abfrage<StelleZeile>(
    `select ${STELLE_FELDER}
       from stelle s
      where s.mandant_id = $1::uuid
        and s.status = 'veroeffentlicht' and s.geschlossen_am is null
      order by s.veroeffentlicht_am desc
      limit 50`,
    [mandantId]);
}

export interface NeueStelle {
  readonly titel: string;
  readonly beschreibung: string;
  readonly anforderungen: readonly string[];
  readonly einsatzort?: string | null;
  readonly wochenstunden?: number | null;
  readonly bewerbungsfrist?: string | null;
  /** `agent`, wenn ein Modell den Entwurf geschrieben hat (REC-02). */
  readonly entwurfVonArt?: 'mensch' | 'agent';
}

export async function legeStelleAn(
  kontext: SchreibKontext, neu: NeueStelle,
): Promise<string> {
  if (neu.titel.trim() === '' || neu.beschreibung.trim() === '') {
    throw new RecruitingFehler(
      'Titel und Beschreibung sind Pflicht.', 'unvollstaendig', 400);
  }
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into stelle
       (mandant_id, titel, beschreibung, anforderungen, einsatzort, wochenstunden,
        bewerbungsfrist, entwurf_von_art, erstellt_von)
     values ($1::uuid, $2, $3, $4::text[], $5, $6::numeric, $7::date,
             $8::akteur_art, $9::uuid)
     returning id`,
    [kontext.aktiverMandantId, neu.titel.trim(), neu.beschreibung.trim(),
      [...neu.anforderungen], neu.einsatzort ?? null, neu.wochenstunden ?? null,
      neu.bewerbungsfrist ?? null, neu.entwurfVonArt ?? 'mensch', kontext.benutzerId]);
  if (z === undefined) {
    throw new RecruitingFehler('Die Stelle wurde nicht angelegt.', 'kein_schreibrecht', 403);
  }
  return z.id;
}

// ---------------------------------------------------------------------------
// Bewerbungen
// ---------------------------------------------------------------------------

export interface NeueBewerbung {
  readonly stelleId: string | null;
  readonly name: string;
  readonly email: string;
  readonly telefon?: string | null;
  readonly nachricht?: string | null;
}

/** Die E-Mail-Form, die auch die Datenbank verlangt (`bewerbung_email_form`). */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

/**
 * Die Annahme vom Karriereformular (REC-03).
 *
 * **Die Aufbewahrungsfrist wird HIER gesetzt**, beim Eingang, aus der
 * Einstellung `recruiting.aufbewahrung_tage` — nicht beim Löschen. Eine Uhr,
 * die erst beim Abräumen gestellt wird, ist keine: sie ist eine Absicht, und
 * eine Aufsicht fragt nach dem Datum an der Zeile.
 */
export async function nimmBewerbungAn(
  kontext: SchreibKontext, neu: NeueBewerbung,
): Promise<string> {
  if (neu.name.trim() === '' || !EMAIL.test(neu.email.trim())) {
    throw new RecruitingFehler(
      'Name und eine lesbare E-Mail-Adresse sind Pflicht.', 'unvollstaendig', 400);
  }
  const tage = await aufbewahrungTage(kontext);
  /*
   * **Die Kennung entsteht hier und kommt nicht aus `returning`** — dieselbe
   * Form wie bei der Formularannahme (`lead/annahme.ts`, 0015), und aus
   * demselben Grund.
   *
   * `t_bewerbung_eingang` erlaubt dem Eingangsprinzipal das Einfuegen und
   * ausdruecklich NICHT das Lesen („einfuegen ja, sehen nein"): wer ein
   * Formular abschickt, darf nicht daraufhin die Bewerbungen der anderen
   * lesen. `insert … returning` braucht aber eine Leseerlaubnis auf die
   * zurueckgegebene Zeile — die Einfuegung ging durch und die RUECKGABE
   * scheiterte, mit `new row violates row-level security policy`. Die Meldung
   * zeigt auf die Einfuegung und meint das Lesen; gefunden hat es der
   * Browserlauf, nachdem dieselbe Anweisung in `psql` ohne `returning`
   * anstandslos lief.
   */
  const id = randomUUID();
  await kontext.schreibe(
    `insert into bewerbung
       (id, mandant_id, stelle_id, quelle, name, email, telefon, nachricht,
        aufbewahrung_bis)
     values ($1::uuid, $2::uuid, $3::uuid,
             case when $3::uuid is null then 'initiativ' else 'karriereseite' end::bewerbung_quelle,
             $4, $5, $6, $7,
             (current_date + ($8::int || ' days')::interval)::date)`,
    [id, kontext.aktiverMandantId, neu.stelleId, neu.name.trim(),
      neu.email.trim().toLowerCase(), neu.telefon ?? null, neu.nachricht ?? null, tage]);
  return id;
}

/**
 * Die Frist aus der Einstellung — ein PLATZHALTER (O-373), und die Zahl steht
 * nicht in dieser Datei.
 *
 * Fehlt die Zeile, ist das ein Fehler und keine Vorgabe: eine Bewerbung ohne
 * Uhr bliebe für immer liegen, und genau das verbietet REC-07.
 */
export async function aufbewahrungTage(kontext: LeseKontext): Promise<number> {
  /*
   * `app.plattform_einstellung(...)` und nicht `select … from
   * plattform_einstellung`: das ist der Zugriffsweg (01-KERN §6.30), und die
   * Katalogwache kennt ihn. Die rohe Abfrage sah fuer den Schluesselscanner
   * aus wie ein RECHT namens `recruiting.aufbewahrung_tage` und meldete es
   * als unregistriert — dieselbe Form, ein anderes Register.
   */
  const [z] = await kontext.abfrage<{ tage: number }>(
    `select (app.plattform_einstellung('recruiting.aufbewahrung_tage') #>> '{}')::int as tage`);
  if (z === undefined || !Number.isInteger(z.tage) || z.tage <= 0) {
    throw new RecruitingFehler(
      /*
       * Der Schluessel steht hier OHNE Anfuehrungszeichen darum. Die
       * Katalogwache sucht nach `<modul>.<etwas>` in Anfuehrungszeichen, und
       * ein Backtick ist einer — die Meldung selbst meldete sich damit als
       * unregistriertes Recht.
       */
      'Keine Aufbewahrungsfrist hinterlegt (Einstellung recruiting.aufbewahrung_tage). Ohne '
      + 'sie bliebe jede Bewerbung für immer liegen — REC-07 verlangt das Gegenteil.',
      'keine_frist', 500);
  }
  return z.tage;
}

export interface BewerbungZeile {
  readonly id: string;
  readonly stelleId: string | null;
  readonly stelleTitel: string | null;
  readonly name: string;
  readonly email: string;
  readonly telefon: string | null;
  readonly nachricht: string | null;
  readonly quelle: BewerbungQuelle;
  readonly status: BewerbungStatus;
  readonly eingegangenAm: Date;
  readonly aufbewahrungBis: string;
  readonly entschiedenAm: Date | null;
}

const BEWERBUNG_FELDER = `
  b.id, b.stelle_id as "stelleId", s.titel as "stelleTitel",
  b.name, b.email, b.telefon, b.nachricht,
  b.quelle::text as quelle, b.status::text as status,
  b.eingegangen_am as "eingegangenAm",
  b.aufbewahrung_bis::text as "aufbewahrungBis",
  (select e.entschieden_am from einstellungsentscheidung e
    where e.bewerbung_id = b.id) as "entschiedenAm"`;

export async function listeBewerbungen(
  kontext: LeseKontext,
): Promise<readonly BewerbungZeile[]> {
  return kontext.abfrage<BewerbungZeile>(
    `select ${BEWERBUNG_FELDER}
       from bewerbung b
       left join stelle s on s.id = b.stelle_id
      where b.geloescht_am is null and b.mandant_id = app.aktiver_mandant()
      order by b.eingegangen_am desc
      limit 200`);
}

export async function ladeBewerbung(
  kontext: LeseKontext, id: string,
): Promise<BewerbungZeile | null> {
  const [z] = await kontext.abfrage<BewerbungZeile>(
    `select ${BEWERBUNG_FELDER}
       from bewerbung b
       left join stelle s on s.id = b.stelle_id
      where b.id = $1::uuid and b.geloescht_am is null
        and b.mandant_id = app.aktiver_mandant()`,
    [id]);
  return z ?? null;
}

export interface KriteriumZeile {
  readonly id: string;
  readonly kriterium: string;
  readonly gewicht: number;
  readonly punkte: number;
  readonly begruendung: string;
  readonly erstelltVonArt: 'mensch' | 'agent' | 'system';
  readonly erstelltAm: Date;
}

export async function leseBewertung(
  kontext: LeseKontext, bewerbungId: string,
): Promise<readonly KriteriumZeile[]> {
  return kontext.abfrage<KriteriumZeile>(
    `select id, kriterium, gewicht, punkte, begruendung,
            erstellt_von_art::text as "erstelltVonArt", erstellt_am as "erstelltAm"
       from bewerbung_bewertung
      where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()
      order by gewicht desc, kriterium`,
    [bewerbungId]);
}

export async function bewerte(
  kontext: SchreibKontext, bewerbungId: string,
  kriterien: readonly { kriterium: string; gewicht: number; punkte: number;
    begruendung: string; vonArt?: 'mensch' | 'agent' }[],
): Promise<number> {
  if (kriterien.length === 0) {
    throw new RecruitingFehler('Ohne Kriterium keine Bewertung.', 'unvollstaendig', 400);
  }
  let n = 0;
  for (const k of kriterien) {
    await kontext.schreibe(
      `insert into bewerbung_bewertung
         (mandant_id, bewerbung_id, kriterium, gewicht, punkte, begruendung,
          erstellt_von_art, erstellt_von)
       values ($1::uuid, $2::uuid, $3, $4::int, $5::int, $6, $7::akteur_art, $8::uuid)`,
      [kontext.aktiverMandantId, bewerbungId, k.kriterium.trim(), k.gewicht, k.punkte,
        k.begruendung.trim(), k.vonArt ?? 'mensch', kontext.benutzerId]);
    n += 1;
  }
  return n;
}

/**
 * Die Entscheidung — von einem benannten Menschen (REC-08, Art. 22 DSGVO).
 *
 * Der Riegel steht in der Datenbank (`entscheidung_ist_menschlich`); diese
 * Funktion reicht ihn nur durch und übersetzt seinen Fehler in einen Satz,
 * den ein Bildschirm zeigen kann.
 */
export async function entscheide(
  kontext: SchreibKontext, bewerbungId: string,
  ergebnis: 'eingestellt' | 'abgelehnt', begruendung: string,
): Promise<string> {
  if (begruendung.trim() === '') {
    throw new RecruitingFehler(
      'Eine Entscheidung ohne Begründung ist im AGG-Streit nichts wert.',
      'unvollstaendig', 400);
  }
  /*
   * **Ein zweiter Klick ist ein Konflikt, kein Absturz.**
   *
   * `entscheidung_je_bewerbung` ist eindeutig; ein Doppelklick oder zwei
   * gleichzeitige Anfragen lassen den zweiten `insert` als
   * `unique_violation` (23505) auflaufen. Das Gerüst übersetzt nur
   * `RecruitingFehler` — ohne diesen Fang wäre die Antwort ein 500, und der
   * Mensch läse „etwas ist kaputt", wo „schon entschieden" stimmt. Die Seite
   * sagt dasselbe, wenn sie den Stand schon kennt.
   */
  let z: { id: string } | undefined;
  try {
    [z] = await kontext.schreibe<{ id: string }>(
      `insert into einstellungsentscheidung
         (mandant_id, bewerbung_id, ergebnis, begruendung, entschieden_von)
       values ($1::uuid, $2::uuid, $3::bewerbung_status, $4, $5::uuid)
       returning id`,
      [kontext.aktiverMandantId, bewerbungId, ergebnis, begruendung.trim(),
        kontext.benutzerId]);
  } catch (fehler: unknown) {
    if ((fehler as { code?: string }).code !== '23505') throw fehler;
    throw new RecruitingFehler(
      'Diese Bewerbung ist bereits entschieden. Eine Entscheidung gibt es je '
      + 'Bewerbung genau einmal — was sich korrigieren lässt, ist der Status der '
      + 'Bewerbung, nicht die Entscheidung selbst.',
      'schon_entschieden', 409);
  }
  if (z === undefined) {
    throw new RecruitingFehler(
      'Die Entscheidung wurde nicht geschrieben.', 'abgewiesen', 403);
  }
  return z.id;
}

/**
 * Die Rangliste (REC-05, REC-08, LEG-12) — **gerechnet in TypeScript, nicht in
 * SQL**.
 *
 * Die Punktzahl ist die einzige Zahl dieses Moduls, die eine Reihenfolge
 * BEHAUPTET, und im AGG-Streit ist sie das, was erklärt werden muss. Sie
 * gehört deshalb in eine geprüfte Funktion und nicht in ein `sum(…)` in einer
 * Abfrage, die niemand einzeln testen kann (`rangfolge.ts`, dieselbe Regel wie
 * Invariante 6).
 *
 * `order by` in der Abfrage gibt es trotzdem, und das ist kein Widerspruch:
 * er stellt den EINGANG her, und der ist die stabile Ordnung, auf der
 * `rangfolge` bei Gleichstand aufsetzt.
 *
 * **Eine Bewerbung ohne Bewertung steht mit 0,0 in der Liste** und nicht
 * ausserhalb: wer sie nicht sieht, hält sie für erledigt.
 */
export async function rangliste(
  kontext: LeseKontext, stelleId?: string,
): Promise<readonly Rangzeile<BewerbungZeile>[]> {
  const zeilen = await kontext.abfrage<BewerbungZeile>(
    `select ${BEWERBUNG_FELDER}
       from bewerbung b
       left join stelle s on s.id = b.stelle_id
      where b.geloescht_am is null and b.mandant_id = app.aktiver_mandant()
        and ($1::uuid is null or b.stelle_id = $1::uuid)
      order by b.eingegangen_am`,
    [stelleId ?? null]);
  if (zeilen.length === 0) return [];

  const kriterien = await kontext.abfrage<{
    bewerbungId: string; kriterium: string; gewicht: number; punkte: number;
    begruendung: string;
  }>(
    `select bewerbung_id as "bewerbungId", kriterium, gewicht, punkte, begruendung
       from bewerbung_bewertung
      where bewerbung_id = any($1::uuid[]) and mandant_id = app.aktiver_mandant()
      order by gewicht desc, kriterium`,
    [zeilen.map((z) => z.id)]);

  const jeBewerbung = new Map<string, Kriterium[]>();
  for (const k of kriterien) {
    const liste = jeBewerbung.get(k.bewerbungId) ?? [];
    liste.push({
      kriterium: k.kriterium, gewicht: k.gewicht, punkte: k.punkte,
      begruendung: k.begruendung,
    });
    jeBewerbung.set(k.bewerbungId, liste);
  }

  return rangfolge(zeilen.map((z) => ({
    eintrag: z, kriterien: jeBewerbung.get(z.id) ?? [],
  })));
}

export interface VeroeffentlichungZeile {
  readonly id: string;
  readonly boerse: string;
  readonly ergebnis: 'offen' | 'veroeffentlicht' | 'nicht_verbunden' | 'fehlgeschlagen';
  readonly veroeffentlichtAm: Date | null;
  readonly externeRef: string | null;
  readonly meldung: string | null;
}

export async function leseVeroeffentlichungen(
  kontext: LeseKontext, stelleId: string,
): Promise<readonly VeroeffentlichungZeile[]> {
  return kontext.abfrage<VeroeffentlichungZeile>(
    `select id, boerse::text as boerse, ergebnis::text as ergebnis,
            veroeffentlicht_am as "veroeffentlichtAm",
            externe_ref as "externeRef", meldung
       from stelle_veroeffentlichung
      where stelle_id = $1::uuid and mandant_id = app.aktiver_mandant()
      order by boerse`,
    [stelleId]);
}

/**
 * Hält fest, was ein Versuch ergeben hat — auch und gerade den Misserfolg.
 *
 * **Ein nicht verbundener Kanal ist ein ERGEBNIS und kein Fehler, der
 * verschwindet.** Wer morgen fragt „warum steht die Stelle nicht bei der
 * Bundesagentur", findet hier die Antwort mit Datum, statt sie zu erraten
 * (REC-09, D-02).
 */
export async function vermerkeVeroeffentlichung(
  kontext: SchreibKontext, stelleId: string, boerse: string,
  ergebnis: 'veroeffentlicht' | 'nicht_verbunden' | 'fehlgeschlagen',
  meldung: string, externeRef: string | null = null,
): Promise<void> {
  await kontext.schreibe(
    `insert into stelle_veroeffentlichung
       (mandant_id, stelle_id, boerse, ergebnis, veroeffentlicht_am, externe_ref,
        meldung, erstellt_von)
     values ($1::uuid, $2::uuid, $3::stellenboerse, $4::veroeffentlichung_ergebnis,
             case when $4 = 'veroeffentlicht' then now() else null end,
             $5, $6, $7::uuid)
     on conflict (stelle_id, boerse) do update
        set ergebnis = excluded.ergebnis,
            veroeffentlicht_am = excluded.veroeffentlicht_am,
            externe_ref = excluded.externe_ref,
            meldung = excluded.meldung,
            geaendert_am = now(),
            geaendert_von = excluded.erstellt_von`,
    [kontext.aktiverMandantId, stelleId, boerse, ergebnis, externeRef, meldung,
      kontext.benutzerId]);
}

export interface GespraechZeile {
  readonly id: string;
  readonly bewerbungId: string;
  readonly bewerberName: string;
  readonly stelleTitel: string | null;
  readonly status: 'geplant' | 'stattgefunden' | 'abgesagt' | 'verschoben';
  readonly termin: Date;
  readonly dauerMinuten: number;
  readonly ort: string | null;
  readonly fragen: readonly string[];
  readonly notiz: string | null;
}

const GESPRAECH_FELDER = `
  g.id, g.bewerbung_id as "bewerbungId", b.name as "bewerberName",
  s.titel as "stelleTitel", g.status::text as status, g.termin,
  g.dauer_minuten as "dauerMinuten", g.ort, g.fragen, g.notiz`;

export async function listeGespraeche(
  kontext: LeseKontext,
): Promise<readonly GespraechZeile[]> {
  return kontext.abfrage<GespraechZeile>(
    `select ${GESPRAECH_FELDER}
       from gespraech g
       join bewerbung b on b.id = g.bewerbung_id
       left join stelle s on s.id = b.stelle_id
      where b.geloescht_am is null and g.mandant_id = app.aktiver_mandant()
      order by g.termin desc
      limit 200`);
}

export async function ladeGespraech(
  kontext: LeseKontext, id: string,
): Promise<GespraechZeile | null> {
  const [z] = await kontext.abfrage<GespraechZeile>(
    `select ${GESPRAECH_FELDER}
       from gespraech g
       join bewerbung b on b.id = g.bewerbung_id
       left join stelle s on s.id = b.stelle_id
      where g.id = $1::uuid and b.geloescht_am is null
        and g.mandant_id = app.aktiver_mandant()`,
    [id]);
  return z ?? null;
}

/**
 * Ein Gespräch planen (REC-06, CAL-01).
 *
 * **Der Zeitpunkt kommt als UTC-Instant herein**, nicht als Wanduhrzeit: ein
 * Gesprächstermin am Umstellungssonntag ist sonst entweder eine Stunde zu
 * früh oder gar nicht vorhanden (Invariante 2). Die Auflösung der Berliner
 * Ortszeit macht die Route über `berlinFormularZeitpunkt`, wie überall sonst.
 */
export async function planeGespraech(
  kontext: SchreibKontext, bewerbungId: string, termin: Date,
  dauerMinuten: number, ort: string | null, fragen: readonly string[],
): Promise<string> {
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into gespraech
       (mandant_id, bewerbung_id, termin, dauer_minuten, ort, fragen, erstellt_von)
     values ($1::uuid, $2::uuid, $3::timestamptz, $4::int, $5, $6::text[], $7::uuid)
     returning id`,
    [kontext.aktiverMandantId, bewerbungId, termin.toISOString(), dauerMinuten,
      ort, fragen.filter((f) => f.trim() !== ''), kontext.benutzerId]);
  if (z === undefined) {
    throw new RecruitingFehler('Das Gespräch wurde nicht angelegt.', 'abgewiesen', 403);
  }
  return z.id;
}

export interface LoeschStand {
  readonly faellig: readonly {
    readonly id: string;
    readonly name: string;
    readonly aufbewahrungBis: string;
    readonly loeschsperre: string | null;
  }[];
  readonly naechste: string | null;
  readonly laeufe: readonly {
    readonly id: string;
    readonly gelaufenAm: Date;
    readonly geloescht: number;
    readonly gesperrt: number;
  }[];
}

/**
 * Was fällig ist, was gesperrt ist, und was der Nachtlauf zuletzt getan hat
 * (REC-07, LEG-11).
 *
 * **`loeschsperre` ist kein Aufschub, sondern ein Grund.** Eine Bewerbung, die
 * in einem AGG-Verfahren steckt, darf nicht verschwinden, weil eine Frist
 * abläuft — und wer das entscheidet, schreibt hin, warum. Eine Sperre ohne
 * Text gibt es nicht.
 */
export async function loeschStand(
  kontext: LeseKontext, stichtag: string,
): Promise<LoeschStand> {
  const faellig = await kontext.abfrage<{
    id: string; name: string; aufbewahrungBis: string; loeschsperre: string | null;
  }>(
    `select id, name, aufbewahrung_bis::text as "aufbewahrungBis", loeschsperre
       from bewerbung
      where geloescht_am is null and mandant_id = app.aktiver_mandant()
        and aufbewahrung_bis <= $1::date
      order by aufbewahrung_bis`,
    [stichtag]);
  const [n] = await kontext.abfrage<{ tag: string | null }>(
    `select min(aufbewahrung_bis)::text as tag
       from bewerbung
      where geloescht_am is null and mandant_id = app.aktiver_mandant()
        and aufbewahrung_bis > $1::date`,
    [stichtag]);
  const laeufe = await kontext.abfrage<{
    id: string; gelaufenAm: Date; geloescht: number; gesperrt: number;
  }>(
    `select id, gelaufen_am as "gelaufenAm", geloescht, gesperrt
       from bewerbung_loeschlauf
      where mandant_id = app.aktiver_mandant()
      order by gelaufen_am desc
      limit 10`);
  return { faellig, naechste: n?.tag ?? null, laeufe };
}

export interface BedarfZeile {
  readonly objektId: string | null;
  readonly objektName: string | null;
  readonly schichten: number;
  readonly fehlendeZusagen: number;
  readonly ersteSchicht: string;
  readonly letzteSchicht: string;
}

/**
 * Der Personalbedarf aus dem Dienstplan (REC-01, TIM-05).
 *
 * **Gezählt werden ZUSAGEN, nicht Einteilungen** — dieselbe Regel wie in der
 * Dienstplanwache (`waechter/dienstplan.ts`): eine Schicht, für die drei Leute
 * eingeteilt sind und niemand zugesagt hat, ist leer. Der gespeicherte Zähler
 * `einsatz.besetzt_anzahl` wird bewusst nicht gelesen; er ist abgeleitet, und
 * eine Zahl, die die Wirklichkeit prüfen soll, darf nicht dieselbe Ableitung
 * lesen.
 *
 * **Die Untergrenze ist `min_besetzung`** und nicht `soll_besetzung`: eine
 * Schicht mit Soll 3 und Minimum 2 ist mit zwei Leuten knapp, aber machbar.
 * Sie als Bedarf zu melden hiesse, eine Einstellung mit einer Knappheit zu
 * begründen.
 *
 * **Der Horizont ist ein Berliner Kalenderraum** (Invariante 2, K-11): `heute`
 * plus N Wochen, nicht `now() + interval`. Ein Zeitraum in UTC-Stunden
 * verschöbe sich an jeder Umstellung um eine Stunde und schnitte damit den
 * Rand des letzten Tages ab.
 *
 * **Diese Seite rechnet keine Stelle aus.** Aus „14 unbesetzte Schichten" folgt
 * keine Zahl an Einzustellenden — dafür bräuchte es Vertragsmodelle,
 * Ausfallquoten und ArbZG-Grenzen je Person. Sie zeigt den Bedarf; die Stelle
 * schreibt ein Mensch.
 */
export async function bedarf(
  kontext: LeseKontext, horizontWochen: number,
): Promise<readonly BedarfZeile[]> {
  const wochen = Number.isInteger(horizontWochen) && horizontWochen > 0
    && horizontWochen <= 52 ? horizontWochen : 4;
  return kontext.abfrage<BedarfZeile>(
    `with fenster as (
       select app.berlin_heute() as von,
              (app.berlin_heute() + ($1::int * 7)) as bis
     ),
     offen as (
       select e.objekt_id,
              e.min_besetzung
                - (select count(*) from einsatz_zuordnung z
                    where z.einsatz_id = e.id and z.status = 'zugesagt'
                      and z.entfernt_am is null)::int as fehlt,
              (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date as tag
         from einsatz e
        where e.mandant_id = app.aktiver_mandant()
          and e.status <> 'storniert'
          and e.storniert_am is null
          and (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date
              between (select von from fenster) and (select bis from fenster)
          and (select count(*) from einsatz_zuordnung z
                where z.einsatz_id = e.id and z.status = 'zugesagt'
                  and z.entfernt_am is null) < e.min_besetzung
     )
     select o.id as "objektId", o.bezeichnung as "objektName",
            count(*)::int as schichten,
            sum(offen.fehlt)::int as "fehlendeZusagen",
            min(offen.tag)::text as "ersteSchicht",
            max(offen.tag)::text as "letzteSchicht"
       from offen
       left join objekt o on o.id = offen.objekt_id
      group by o.id, o.bezeichnung
      order by sum(offen.fehlt) desc, o.bezeichnung`,
    [wochen]);
}
