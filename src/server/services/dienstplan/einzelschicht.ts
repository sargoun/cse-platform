import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { MAX_DAUER_MINUTEN } from './vorkommnisse.js';
import { LeistungsankerFehler, pruefeLeistungsanker } from './leistungsanker.js';

/**
 * **Eine einzelne Schicht — angelegt und wieder abgesagt** (V-013, TIM-01,
 * TIM-04, CLN-02, SEC-04).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `einsatz.quelle` kennt seit `0028` den Wert `manuell`, und
 * `kern.einsatz_quell_schluessel_setzen` schreibt für eine schlüssellose Zeile
 * eigens `manuell:<id>` — die Datenbank war auf die von Hand geplante Schicht
 * vorbereitet. **Nur legte sie niemand an.** Ein Einsatz entstand aus einer
 * Serie, aus einer Veranstaltung oder gar nicht.
 *
 * Im Betrieb ist das die häufigste Planung überhaupt: eine Grundreinigung am
 * Samstag, eine zusätzliche Wache für eine Nacht, ein Einsatz nach einem
 * Wasserschaden. Wer dafür eine Serie anlegen muss, legt eine Serie an, die
 * einmal feuert — und sie generiert ab morgen weiter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Vier Regeln, die hier und nicht in der Oberfläche stehen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Die Instants entstehen IN DER ANWEISUNG** (Invariante 2, §7.2).
 * `app.loese_ortszeit` rechnet Wanduhr → Zeitpunkt, und das Ende bekommt
 * seinen EIGENEN Aufruf: es ist ein eigener Wanduhr-Anker und nicht der
 * Anfang plus eine Dauer. In der Umstellungsnacht wäre die Schicht sonst eine
 * Stunde zu lang. Genau so macht es der Generator, und zwei Rechenwege für
 * dieselbe Tatsache wären zwei Antworten auf die Frage, wie lang die Schicht
 * war.
 *
 * **2. `endet_am_folgetag` ist eine Angabe, keine Ableitung.** `22:00–06:00`
 * ist ohne sie von einem Tippfehler nicht zu unterscheiden — die Spalte
 * existiert genau dafür (`einsatz_folgetag`).
 *
 * **3. `kunde_id` und `quell_schluessel` schreibt die Datenbank.** Der
 * Kunde kommt aus dem Objekt (`kern.einsatz_kunde_setzen`) und wird dem
 * Aufrufer nicht geglaubt: auf dieser Spalte stehen die Kundendecke und
 * `t_kunde`.
 *
 * **4. Die Leistungszeile ist der Abrechnungsanker** (TIM-12, V-191). Der
 * Zeiteintrag erbt `auftrag_leistung_id` von seiner Schicht (`z_erben`,
 * 0034) — und NUR davon; `auftrag_id` allein liest in der Zeitkette niemand.
 * Wer den Auftrag nennt, nennt deshalb auch die Zeile, oder die Schicht hängt
 * an keiner Abrechnung. Ist nur die Zeile genannt, leitet die Datenbank den
 * Auftrag ab (`kern.einsatz_auftrag_ableiten`).
 *
 * **5. Abgesagt wird mit Grund, nie durch Löschen.**
 * `einsatz_storno_begruendet` verlangt es; eine Schicht, die spurlos
 * verschwindet, ist im Lohnstreit keine Auskunft. Eine Schicht mit erfasster
 * Zeit wird gar nicht erst abgesagt — die Zeit bliebe an einer Schicht
 * hängen, die es nicht mehr gibt.
 */
export class SchichtFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'unvollstaendig' | 'zeitfenster' | 'besetzung' | 'kein_kunde'
      | 'nicht_gefunden' | 'schon_storniert' | 'hat_zeiten' | 'grund_fehlt' | 'abgewiesen'
      | 'leistung_unbekannt' | 'leistung_beendet' | 'leistung_anderer_auftrag'
      | 'nicht_manuell' | 'leistung_hat_zeiten',
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'SchichtFehler';
  }
}

export interface EinzelschichtEingabe {
  readonly objektId: string;
  /** Der BERLINER Kalendertag, zu dem die Schicht zählt — ihr Starttag. */
  readonly planDatum: string;
  /** Wanduhr `HH:MM`, Europe/Berlin. */
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly endetAmFolgetag: boolean;
  readonly sollBesetzung: number;
  readonly minBesetzung: number;
  readonly pauseMinuten?: number;
  readonly revierId?: string | null;
  readonly auftragId?: string | null;
  /** Die Leistungszeile, an deren Abrechnung die Zeit dieser Schicht hängt (TIM-12). */
  readonly auftragLeistungId?: string | null;
  readonly notiz?: string | null;
}

/** Ein Ankerfehler als Fehler dieser Schicht — derselbe Grund, dieselbe Maske. */
async function pruefeAnker(
  kontext: SchreibKontext, auftragLeistungId: string, auftragId: string | null,
): Promise<void> {
  try {
    await pruefeLeistungsanker(kontext, auftragLeistungId, auftragId);
  } catch (fehler: unknown) {
    if (fehler instanceof LeistungsankerFehler) {
      throw new SchichtFehler(fehler.message, fehler.grund, 422);
    }
    throw fehler;
  }
}

export interface EinzelschichtErgebnis {
  readonly einsatzId: string;
  /**
   * `dst_luecke` oder `dst_doppelt` — die Schicht beginnt in einer Ortszeit,
   * die es nicht oder zweimal gibt. Sie entsteht trotzdem; die Oberfläche
   * sagt es hin, statt sie zu verweigern (O-163 ist offen).
   */
  readonly zeitanomalie: 'keine' | 'dst_luecke' | 'dst_doppelt';
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
const UHRZEIT = /^([01]\d|2[0-3]):([0-5]\d)$/u;

function minuten(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Die geplante Dauer in Minuten — die Wanduhrrechnung, nicht die echte.
 *
 * **Und das ist hier richtig.** Die Zahl entscheidet nur, ob die Eingabe
 * plausibel ist (unter 24 Stunden); die BEZAHLTE Dauer ist immer die
 * Differenz zweier UTC-Instants (Invariante 2) und wird nie aus dieser Zahl
 * gebildet. In der Umstellungsnacht sind die beiden verschieden, und genau
 * deshalb steht diese Funktion getrennt und heisst nicht `dauer`.
 */
export function wanduhrDauerMinuten(
  beginnLokal: string, endeLokal: string, endetAmFolgetag: boolean,
): number {
  const roh = minuten(endeLokal) - minuten(beginnLokal);
  return endetAmFolgetag ? roh + 24 * 60 : roh;
}

export function pruefeEinzelschicht(e: EinzelschichtEingabe): void {
  if (!DATUM.test(e.planDatum)) {
    throw new SchichtFehler('Der Plantag ist kein Kalendertag (JJJJ-MM-TT).', 'unvollstaendig');
  }
  if (!UHRZEIT.test(e.beginnLokal) || !UHRZEIT.test(e.endeLokal)) {
    throw new SchichtFehler('Beginn und Ende sind Uhrzeiten (HH:MM).', 'unvollstaendig');
  }
  /*
   * Dieselbe Bedingung wie `einsatz_folgetag`, nur als Satz. Ohne den Haken
   * wäre „22:00 bis 06:00" eine Schicht mit negativer Dauer — und der CHECK
   * meldete das mit seinem Namen, nicht mit dem Grund.
   */
  if (!e.endetAmFolgetag && minuten(e.endeLokal) <= minuten(e.beginnLokal)) {
    throw new SchichtFehler(
      'Das Ende liegt vor dem Beginn. Endet die Schicht nach Mitternacht, setzen '
      + 'Sie den Haken „endet am Folgetag" — eine Nachtschicht 22:00–06:00 ist '
      + 'ohne ihn von einem Tippfehler nicht zu unterscheiden.', 'zeitfenster');
  }
  const dauer = wanduhrDauerMinuten(e.beginnLokal, e.endeLokal, e.endetAmFolgetag);
  if (dauer <= 0 || dauer > MAX_DAUER_MINUTEN) {
    throw new SchichtFehler(
      'Eine Schicht dauert mehr als null und weniger als 24 Stunden. Was länger '
      + 'läuft, sind zwei Schichten.', 'zeitfenster');
  }
  if (!Number.isInteger(e.sollBesetzung) || e.sollBesetzung < 1) {
    throw new SchichtFehler('Die Sollbesetzung ist mindestens 1.', 'besetzung');
  }
  if (!Number.isInteger(e.minBesetzung) || e.minBesetzung < 1
    || e.minBesetzung > e.sollBesetzung) {
    throw new SchichtFehler(
      'Die Mindestbesetzung liegt zwischen 1 und der Sollbesetzung.', 'besetzung');
  }
  const pause = e.pauseMinuten ?? 0;
  if (!Number.isInteger(pause) || pause < 0 || pause >= dauer) {
    throw new SchichtFehler(
      'Die geplante Pause ist nicht negativ und kürzer als die Schicht.', 'zeitfenster');
  }
}

export async function legeEinzelschichtAn(
  kontext: SchreibKontext, e: EinzelschichtEingabe,
): Promise<EinzelschichtErgebnis> {
  pruefeEinzelschicht(e);
  const leistung = e.auftragLeistungId ?? null;
  if (leistung !== null) await pruefeAnker(kontext, leistung, e.auftragId ?? null);

  try {
    const [z] = await kontext.schreibe<{ id: string; zeitanomalie: string }>(
      `with anfang as (select * from app.loese_ortszeit($2::date, $3::time, 'Europe/Berlin')),
            ende   as (select * from app.loese_ortszeit(
                         ($2::date + case when $5 then 1 else 0 end), $4::time, 'Europe/Berlin'))
       insert into einsatz (
         mandant_id, quelle, objekt_id, revier_id, auftrag_id, auftrag_leistung_id, plan_datum,
         beginn_zeitpunkt, ende_zeitpunkt, zeitzone, beginn_lokal, ende_lokal,
         endet_am_folgetag, zeitanomalie, pause_geplant_minuten,
         soll_besetzung, min_besetzung, notiz, status, erstellt_von_art, erstellt_von)
       select $1::uuid, 'manuell'::einsatz_quelle, $6::uuid, $7::uuid, $8::uuid, $14::uuid,
              $2::date,
              anfang.zeitpunkt, ende.zeitpunkt, 'Europe/Berlin', $3::time, $4::time,
              $5, anfang.anomalie, $9::integer,
              $10::smallint, $11::smallint, $12, 'geplant'::einsatz_status,
              'mensch'::akteur_art, $13::uuid
         from anfang, ende
       returning id, zeitanomalie::text as zeitanomalie`,
      [kontext.aktiverMandantId, e.planDatum, e.beginnLokal, e.endeLokal, e.endetAmFolgetag,
        e.objektId, e.revierId ?? null, e.auftragId ?? null, e.pauseMinuten ?? 0,
        e.sollBesetzung, e.minBesetzung, e.notiz?.trim() === '' ? null : e.notiz ?? null,
        kontext.benutzerId, leistung]);
    if (z === undefined) {
      throw new SchichtFehler(
        'Die Schicht wurde nicht angelegt — fehlt `dienstplan.schreiben` in dieser '
        + 'Gesellschaft?', 'abgewiesen', 403);
    }
    const anomalie = (['keine', 'dst_luecke', 'dst_doppelt'] as const)
      .find((a) => a === z.zeitanomalie) ?? 'keine';
    return { einsatzId: z.id, zeitanomalie: anomalie };
  } catch (fehler: unknown) {
    if (fehler instanceof SchichtFehler) throw fehler;
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    /*
     * `kern.einsatz_kunde_setzen` wirft zwei verschiedene Sätze, und beide
     * meinen etwas, das ein Mensch beheben kann. Der Auslösertext nennt
     * Spalten; dieser hier nennt den Schritt.
     */
    if (text.includes('nennt keinen Kunden')) {
      throw new SchichtFehler(
        'Dieses Objekt ist keinem Kunden zugeordnet. Eine Schicht ohne Kunden '
        + 'liesse sich später nicht abrechnen und wäre für das Kundenportal '
        + 'unsichtbar — tragen Sie den Kunden am Objekt ein.', 'kein_kunde', 409);
    }
    if (text.includes('gehoert nicht zu dieser Gesellschaft')) {
      throw new SchichtFehler(
        'Dieses Objekt gehört nicht zu dieser Gesellschaft.', 'nicht_gefunden', 404);
    }
    throw fehler;
  }
}

/**
 * Absagen — der Gegenweg, ohne den die von Hand geplante Schicht eine
 * Sackgasse wäre.
 *
 * **Bedingt geschrieben** (K-09): `where storniert_am is null` trifft beim
 * zweiten Mal null Zeilen, und das ist eine Antwort („war schon") und kein
 * zweiter Vorgang.
 *
 * **Eine Schicht mit erfasster Zeit wird nicht abgesagt.** Dieselbe Bedingung,
 * die der Generator vor seinem Upsert prüft (`app.einsatz_hat_zeiterfassung`):
 * eine Stunde, die an einer abgesagten Schicht hängt, ist eine Stunde, die im
 * Lohnlauf niemand mehr zuordnen kann.
 */
export async function sageEinsatzAb(
  kontext: SchreibKontext, einsatzId: string, grund: string,
): Promise<void> {
  if (grund.trim().length < 3) {
    throw new SchichtFehler(
      'Eine Absage ohne Grund ist im Lohnstreit keine Auskunft — mindestens drei '
      + 'Zeichen. Sie beantwortet später, warum an diesem Tag niemand da war.',
      'grund_fehlt');
  }

  const [stand] = await kontext.abfrage<{ storniert: boolean; zeiten: boolean }>(
    `select (storniert_am is not null) as storniert,
            app.einsatz_hat_zeiterfassung(id) as zeiten
       from einsatz where id = $1::uuid`, [einsatzId]);
  if (stand === undefined) {
    throw new SchichtFehler('Diese Schicht gibt es nicht.', 'nicht_gefunden', 404);
  }
  if (stand.storniert) {
    throw new SchichtFehler('Diese Schicht ist schon abgesagt.', 'schon_storniert', 409);
  }
  if (stand.zeiten) {
    throw new SchichtFehler(
      'Auf dieser Schicht ist schon Zeit erfasst. Eine abgesagte Schicht mit '
      + 'erfasster Zeit liesse eine Stunde zurück, die im Lohnlauf niemand mehr '
      + 'zuordnen kann — korrigieren Sie erst die Zeiterfassung.', 'hat_zeiten', 409);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update einsatz
        set status = 'storniert'::einsatz_status, storniert_am = now(),
            storniert_von = $3::uuid, storno_grund = $2,
            geaendert_am = now(), geaendert_von_art = 'mensch'::akteur_art,
            geaendert_von = $3::uuid
      where id = $1::uuid and storniert_am is null
      returning id`, [einsatzId, grund.trim(), kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new SchichtFehler(
      'Die Schicht wurde nicht abgesagt — fehlt `dienstplan.schreiben` in dieser '
      + 'Gesellschaft?', 'abgewiesen', 403);
  }
}

/**
 * Die Leistungszeile einer von Hand geplanten Schicht nachtragen, ändern oder
 * lösen (V-191, TIM-12).
 *
 * **Nur, solange auf der Schicht keine Zeit erfasst ist.** Der Zeiteintrag
 * erbt den Anker beim Anlegen (`z_erben`, 0034) und hält ihn danach fest; ein
 * Anker, der sich nach der ersten Stunde ändert, bräche die Schicht von ihren
 * eigenen Einträgen ab. Deshalb dieselbe Bedingung wie beim Absagen und im
 * Generator: `app.einsatz_hat_zeiterfassung`.
 *
 * **Nur für eine Einzelschicht** (`quelle = 'manuell'`). Eine Serienschicht
 * trägt den Anker ihres Turnus oder Postens, und der Generator schreibt ihn
 * bei jedem Lauf auf die künftigen Schichten — ein hier gesetzter Wert hielte
 * nur bis zum nächsten Lauf. Der Weg dorthin ist der Träger.
 *
 * **Der Auftrag folgt dem Anker — ausser, er wurde ohne Anker genannt.**
 * Trug die Schicht schon eine Zeile, stammt ihr Auftrag aus dieser Zeile, und
 * eine neue Zeile bringt ihren eigenen mit (`auftrag_id` wird geleert und von
 * `kern.einsatz_auftrag_ableiten` neu gesetzt). Nannte sie nur einen Auftrag,
 * muss die Zeile zu IHM gehören — das war die Angabe eines Menschen. Gelöst
 * wird nur der Anker; der Auftrag bleibt.
 */
export async function setzeLeistungsanker(
  kontext: SchreibKontext, einsatzId: string, auftragLeistungId: string | null,
): Promise<void> {
  const [stand] = await kontext.abfrage<{
    quelle: string; storniert: boolean; zeiten: boolean; auftrag_id: string | null;
    anker: string | null;
  }>(
    `select quelle::text as quelle, (storniert_am is not null) as storniert,
            app.einsatz_hat_zeiterfassung(id) as zeiten, auftrag_id,
            auftrag_leistung_id as anker
       from einsatz where id = $1::uuid`, [einsatzId]);
  if (stand === undefined) {
    throw new SchichtFehler('Diese Schicht gibt es nicht.', 'nicht_gefunden', 404);
  }
  if (stand.quelle !== 'manuell') {
    throw new SchichtFehler(
      'Eine Serienschicht trägt die Leistungszeile ihres Turnus oder Postens — '
      + 'ändern Sie sie dort.', 'nicht_manuell', 409);
  }
  if (stand.storniert) {
    throw new SchichtFehler('Diese Schicht ist abgesagt.', 'schon_storniert', 409);
  }
  if (stand.zeiten) {
    throw new SchichtFehler(
      'Auf dieser Schicht ist schon Zeit erfasst; ihre Einträge haben den Anker '
      + 'übernommen, den die Schicht damals trug.', 'leistung_hat_zeiten', 409);
  }
  const auftragFolgtAnker = stand.anker !== null;
  if (auftragLeistungId !== null) {
    await pruefeAnker(kontext, auftragLeistungId, auftragFolgtAnker ? null : stand.auftrag_id);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update einsatz
        set auftrag_leistung_id = $2::uuid,
            auftrag_id = case when $4 and $2::uuid is not null then null else auftrag_id end,
            geaendert_am = now(), geaendert_von_art = 'mensch'::akteur_art,
            geaendert_von = $3::uuid
      where id = $1::uuid and storniert_am is null
        and not app.einsatz_hat_zeiterfassung(id)
      returning id`, [einsatzId, auftragLeistungId, kontext.benutzerId, auftragFolgtAnker]);
  if (zeilen.length === 0) {
    throw new SchichtFehler(
      'Die Leistungszeile wurde nicht gesetzt — fehlt `dienstplan.schreiben` in dieser '
      + 'Gesellschaft?', 'abgewiesen', 403);
  }
}
