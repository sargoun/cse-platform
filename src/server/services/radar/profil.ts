import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { cent, type Cent } from '../finanz/geld.js';
import type { KeywordWirkung, Wirkung } from './bewertung.js';

/**
 * Ein Suchprofil des Vergaberadars lesen und schreiben (RAD-04, RAD-05,
 * O-15, O-47, O-98, O-191, O-720, O-721).
 *
 * **Was dieser Dienst NICHT tut: rechnen.** Die Punktzahl entsteht in
 * `bewertung.ts`, deterministisch, mit einer Begründung je Regel; hier werden
 * nur die Eingaben eines Profils gepflegt. Und kein Sprachmodell ist
 * beteiligt — weder beim Bewerten noch beim Pflegen (Invariante 6).
 *
 * **Vier Felder bleiben gesperrt, weil ihre Regel offen ist** (Regel 1):
 *
 *  * `gewichtung` und `benachrichtigung_ab_punkte` — wie viel ein CPV-Treffer
 *    gegenüber einer Region wiegt und ab welcher Punktzahl benachrichtigt
 *    wird, hat niemand entschieden (O-15). Freie Zahlenfelder täten so, als
 *    wäre die Gewichtung bestätigt, und die Rangfolge, die daraus entsteht,
 *    würde geglaubt.
 *  * `negativ_wirkung` — schliesst ein Negativ-Stichwort aus oder zieht es
 *    nur ab (O-191)? Bis zur Antwort steht es auf `abzug`, der sicheren
 *    Richtung: ein Ausschluss verwirft still, was nie ein Mensch gesehen hat.
 *  * `waehrung` — Fremdwährungen werden NIE umgerechnet (O-47). Ein Profil,
 *    dessen Grenzen in einer anderen Währung stünden, verlöre für jede
 *    Bekanntmachung in Euro das Wertkriterium, und zwar stillschweigend
 *    (`wert_kriterium = 'fremdwaehrung'`).
 *  * `skala_max` — die Skala gehört zur Gewichtungsfrage (O-15).
 *
 * **Und `ist_platzhalter` lässt sich nicht von Hand löschen.** Das Flag sagt
 * „die Gewichte und die CPV-Codes dieses Profils sind unbestätigt"; es zu
 * entfernen wäre eine Behauptung über O-15 und O-98, nicht eine Eingabe.
 *
 * **Und das Profil selbst wird von hier nie archiviert.** `radar_profil` trägt
 * `geloescht_am`/`geloescht_von`, also war ein Archivieren vorgesehen — nur
 * sagt niemand, was dann mit den `bewertung`-Zeilen geschieht, die es erzeugt
 * hat: sie nennen den Profilnamen in ihrer Begründung, und die Radarliste
 * verbindet sie weiter mit `radar_profil` (ohne Filter auf `geloescht_am`).
 * Die sichere Richtung ist deshalb `ist_aktiv = false`: der Lauf bewertet
 * nichts mehr damit, und nichts wird unlesbar.
 *
 * // TODO(client, O-720): Soll ein Suchprofil archiviert werden können — und
 * // was geschieht dann mit den Bewertungen, die es erzeugt hat: bleiben sie
 * // mit dem Profilnamen lesbar, oder verschwinden sie aus dem Radar?
 *
 * **Die beiden Kindtabellen werden HART gelöscht** — und das ist zulässig.
 * Invariante 8 nennt Finanzen, Zeiterfassung und Audit; Radar steht nicht
 * darunter. `radar_profil_cpv` und `radar_profil_empfaenger` tragen weder
 * `geloescht_am` noch `ist_aktiv`, hängen per `on delete cascade` am Profil
 * und haben eigens einen DELETE-Trigger für den Versionszähler. Eine
 * Löschsperre hier zu behaupten hiesse, eine Spalte zu suchen, die es nicht
 * gibt. Was verloren geht, ist nicht die Spur: jede Änderung zählt
 * `radar_profil.version` hoch, und die alten `bewertung`-Zeilen bleiben mit
 * ihrer Profilfassung stehen.
 */

export class ProfilFehler extends Error {
  readonly status = 400;
  constructor(
    readonly code: 'name' | 'nuts' | 'cpv' | 'wert' | 'frist' | 'nicht_gefunden'
      | 'empfaenger' | 'gesperrt',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'ProfilFehler';
  }
}

/* ------------------------------------------------------------------ Prüfen */

/**
 * Ein CPV-Code, wie die Datenbank ihn verlangt: acht Ziffern, optional die
 * Prüfziffer hinter einem Bindestrich (`radar_profil_cpv_cpv_code_check`).
 *
 * **Geprüft wird hier, damit die Seite einen Satz zeigen kann** statt eines
 * `check_violation` nach dem Absenden. Die Datenbank prüft es trotzdem noch
 * einmal — sie ist die Wand, nicht diese Zeile.
 *
 * **Was hier NICHT geprüft wird: ob der Code existiert.** Die amtliche
 * CPV-Liste liegt nicht als Tabelle vor, und die Codes der drei Gewerke sind
 * gegen sie unbestätigt (O-98). Jede von Hand eingetragene Zeile bleibt
 * deshalb `ist_platzhalter = true` — sie ist eine Eingabe, keine bestätigte
 * Leistungsart.
 */
const CPV_MUSTER = /^[0-9]{8}(-[0-9])?$/u;

export function pruefeCpvCode(eingabe: string): string {
  const code = eingabe.trim();
  if (!CPV_MUSTER.test(code)) {
    throw new ProfilFehler('cpv',
      `„${eingabe}" ist kein CPV-Code: acht Ziffern, optional „-" und eine Prüfziffer `
      + '(z. B. 90910000 oder 90910000-9).');
  }
  return code;
}

export function pruefePraefixLaenge(eingabe: number): number {
  if (!Number.isInteger(eingabe) || eingabe < 2 || eingabe > 8) {
    throw new ProfilFehler('cpv',
      'Die Präfixlänge liegt zwischen 2 und 8 Stellen: 2 fängt eine ganze Abteilung, '
      + '8 genau einen Code.');
  }
  return eingabe;
}

/**
 * Ein NUTS-Präfix: zwei Buchstaben Land, dann bis zu drei Stellen
 * (`DE`, `DE3`, `DE30`, `DE300`).
 *
 * **Die Form wird geprüft, die Liste nicht.** Es gibt keine NUTS-Tabelle im
 * Haus, und welche Fassung der amtlichen Liste gilt, ist offen (O-721). Ein
 * Präfix, das der Form entspricht aber kein Gebiet bezeichnet, engt die Suche
 * still ein — deshalb steht die offene Frage in der Oberfläche am Feld.
 */
// TODO(client, O-721): Gegen welche Fassung der amtlichen NUTS-Liste sind die
// Regionspraefixe eines Suchprofils zu pruefen — und soll ein Praefix, das kein
// Gebiet bezeichnet, abgewiesen oder nur markiert werden?
const NUTS_MUSTER = /^[A-Z]{2}[A-Z0-9]{0,3}$/u;

export function pruefeNutsPraefix(eingabe: string): string {
  const code = eingabe.trim().toUpperCase();
  if (!NUTS_MUSTER.test(code)) {
    throw new ProfilFehler('nuts',
      `„${eingabe}" ist kein NUTS-Präfix: zwei Buchstaben für das Land und bis zu drei `
      + 'weitere Stellen (DE, DE3, DE30, DE300).');
  }
  return code;
}

/**
 * Eine Liste aus einem Textfeld: getrennt durch Zeilenumbruch, Semikolon oder
 * Komma, getrimmt, ohne Leere, ohne Doppelte — **und in der Reihenfolge der
 * Eingabe**.
 *
 * Die Reihenfolge bleibt, weil `nuts_praefixe` und die Stichwortlisten in den
 * `eingaben_hash` einer Bewertung eingehen: eine Umsortierung wäre eine
 * Änderung, die keine ist, und sie erzeugte eine neue Bewertungszeile ohne
 * neuen Inhalt.
 */
export function teileListe(eingabe: string | null): readonly string[] {
  if (eingabe === null) return [];
  const teile = eingabe.split(/[\n;,]/u).map((t) => t.trim()).filter((t) => t !== '');
  return [...new Set(teile)];
}

/** Ein Stichwort: nicht leer, höchstens 100 Zeichen — sonst ist es ein Satz. */
export function pruefeStichwort(eingabe: string): string {
  const wort = eingabe.trim();
  if (wort.length === 0 || wort.length > 100) {
    throw new ProfilFehler('name',
      `„${eingabe}" ist kein Stichwort: eins bis hundert Zeichen. Ein ganzer Satz `
      + 'trifft nie, weil verglichen wird, ob er im Text vorkommt.');
  }
  return wort;
}

export function pruefeWertgrenzen(min: Cent | null, max: Cent | null): void {
  if (min !== null && min < 0n) {
    throw new ProfilFehler('wert', 'Eine Untergrenze ist nie negativ.');
  }
  if (max !== null && max < 0n) {
    throw new ProfilFehler('wert', 'Eine Obergrenze ist nie negativ.');
  }
  if (min !== null && max !== null && max < min) {
    throw new ProfilFehler('wert',
      'Die Obergrenze liegt unter der Untergrenze — so trifft das Profil nie einen Wert.');
  }
}

export function pruefeFristMinTage(eingabe: number | null): number | null {
  if (eingabe === null) return null;
  if (!Number.isInteger(eingabe) || eingabe < 0 || eingabe > 365) {
    throw new ProfilFehler('frist',
      'Die Mindestrestfrist sind ganze Tage zwischen 0 und 365.');
  }
  return eingabe;
}

export function pruefeName(eingabe: string): string {
  const name = eingabe.trim();
  if (name.length === 0 || name.length > 120) {
    throw new ProfilFehler('name', 'Ein Profil braucht einen Namen (bis 120 Zeichen).');
  }
  return name;
}

/* ------------------------------------------------------------------- Lesen */

export interface ProfilCpvZeile {
  readonly id: string;
  readonly code: string;
  readonly praefixLaenge: number;
  readonly wirkung: Wirkung;
  readonly bezeichnung: string | null;
  readonly istPlatzhalter: boolean;
  /** Steht im Schema, wird von `bewertung.ts` NICHT benutzt (O-15). */
  readonly gewichtung: number;
}

export interface ProfilEmpfaengerZeile {
  readonly id: string;
  readonly benutzerId: string;
  /** `null` heisst: der Name ist für diese Sitzung nicht lesbar. */
  readonly name: string | null;
  readonly abPunkte: number | null;
}

export interface ProfilBlick {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly istAktiv: boolean;
  readonly istPlatzhalter: boolean;
  readonly nutsPraefixe: readonly string[];
  readonly positivKeywords: readonly string[];
  readonly negativKeywords: readonly string[];
  readonly negativWirkung: KeywordWirkung;
  readonly wertMinCent: Cent | null;
  readonly wertMaxCent: Cent | null;
  readonly waehrung: string;
  readonly fristMinTage: number | null;
  readonly oberhalbSchwellenwert: boolean | null;
  readonly skalaMax: number;
  readonly gewichtung: Readonly<Record<string, number>>;
  readonly benachrichtigungAbPunkte: number | null;
  readonly regelVersion: string;
  readonly cpv: readonly ProfilCpvZeile[];
  readonly empfaenger: readonly ProfilEmpfaengerZeile[];
  /** Wie viele Bewertungen mit diesem Profil (über alle Fassungen) entstanden sind. */
  readonly bewertungen: number;
  readonly erstelltAm: Date;
  readonly geaendertAm: Date | null;
}

/**
 * EIN Profil, gesucht nach seiner Kennung.
 *
 * `null` heisst „gibt es nicht ODER die Sitzung darf es nicht sehen" — nach
 * aussen dasselbe (AUT-06). `t_lesen` verlangt `radar.lesen`, die
 * Bearbeitungsroute ist auf `radar.profil_schreiben` bewacht; beide Rechte
 * halten heute dieselben Rollen, aber die Seite verlässt sich nicht darauf.
 *
 * Ein archiviertes Profil (`geloescht_am`) wird NICHT geladen: es zu
 * bearbeiten hiesse, eine Suche zu ändern, die nicht mehr läuft. Die
 * `bewertung`-Zeilen, die es erzeugt hat, bleiben lesbar — dort steht der
 * Profilname weiter.
 */
export async function leseProfil(
  kontext: LeseKontext, id: string,
): Promise<ProfilBlick | null> {
  const [p] = await kontext.abfrage<Record<string, unknown>>(
    `select p.id, p.name, p.version, p.ist_aktiv, p.ist_platzhalter,
            p.nuts_praefixe, p.positiv_keywords, p.negativ_keywords,
            p.negativ_wirkung::text as negativ_wirkung,
            p.wert_min_cent::text as wert_min, p.wert_max_cent::text as wert_max,
            p.waehrung, p.frist_min_tage, p.oberhalb_schwellenwert,
            p.skala_max, p.gewichtung, p.benachrichtigung_ab_punkte,
            p.regel_version, p.erstellt_am, p.geaendert_am,
            (select count(*) from bewertung b where b.radar_profil_id = p.id)::int
              as bewertungen
       from radar_profil p
      where p.id = $1::uuid and p.geloescht_am is null`,
    [id]);
  if (p === undefined) return null;

  const cpv = await kontext.abfrage<Record<string, unknown>>(
    `select c.id, c.cpv_code, c.praefix_laenge, c.wirkung::text as wirkung,
            c.bezeichnung, c.ist_platzhalter, c.gewichtung
       from radar_profil_cpv c
      where c.radar_profil_id = $1::uuid
      order by c.wirkung, c.cpv_code`,
    [id]);

  const empfaenger = await kontext.abfrage<Record<string, unknown>>(
    `select e.id, e.benutzer_id, e.ab_punkte, b.name
       from radar_profil_empfaenger e
       left join benutzer b on b.id = e.benutzer_id
      where e.radar_profil_id = $1::uuid
      order by b.name nulls last, e.benutzer_id`,
    [id]);

  return {
    id: String(p['id']),
    name: String(p['name']),
    version: Number(p['version']),
    istAktiv: p['ist_aktiv'] === true,
    istPlatzhalter: p['ist_platzhalter'] === true,
    nutsPraefixe: (p['nuts_praefixe'] as string[] | null) ?? [],
    positivKeywords: (p['positiv_keywords'] as string[] | null) ?? [],
    negativKeywords: (p['negativ_keywords'] as string[] | null) ?? [],
    negativWirkung: String(p['negativ_wirkung']) as KeywordWirkung,
    wertMinCent: typeof p['wert_min'] === 'string' ? cent(BigInt(p['wert_min'])) : null,
    wertMaxCent: typeof p['wert_max'] === 'string' ? cent(BigInt(p['wert_max'])) : null,
    waehrung: String(p['waehrung']).trim(),
    fristMinTage: p['frist_min_tage'] === null ? null : Number(p['frist_min_tage']),
    oberhalbSchwellenwert: (p['oberhalb_schwellenwert'] as boolean | null) ?? null,
    skalaMax: Number(p['skala_max']),
    gewichtung: (p['gewichtung'] as Record<string, number> | null) ?? {},
    benachrichtigungAbPunkte: p['benachrichtigung_ab_punkte'] === null
      ? null : Number(p['benachrichtigung_ab_punkte']),
    regelVersion: String(p['regel_version']),
    cpv: cpv.map((c) => ({
      id: String(c['id']),
      code: String(c['cpv_code']),
      praefixLaenge: Number(c['praefix_laenge']),
      wirkung: String(c['wirkung']) as Wirkung,
      bezeichnung: (c['bezeichnung'] as string | null) ?? null,
      istPlatzhalter: c['ist_platzhalter'] === true,
      gewichtung: Number(c['gewichtung']),
    })),
    empfaenger: empfaenger.map((e) => ({
      id: String(e['id']),
      benutzerId: String(e['benutzer_id']),
      name: (e['name'] as string | null) ?? null,
      abPunkte: e['ab_punkte'] === null ? null : Number(e['ab_punkte']),
    })),
    bewertungen: Number(p['bewertungen']),
    erstelltAm: p['erstellt_am'] as Date,
    geaendertAm: (p['geaendert_am'] as Date | null) ?? null,
  };
}

/**
 * Wer als Empfänger in Frage kommt: die Konten DIESER Gesellschaft, die noch
 * nicht eingetragen sind.
 *
 * Der Trigger `trg_rpe_empfaenger_im_mandant` besteht darauf, dass das Konto
 * eine gültige `benutzer_mandant`-Zeile in diesem Mandanten hat; eine Liste
 * mit fremden Konten wäre also eine Auswahl, die beim Absenden scheitert.
 * Sichtbar sind die Namen nur mit `system.benutzer_lesen` — ohne das Recht
 * kommt die Liste leer zurück, und die Seite sagt das, statt „niemand da" zu
 * behaupten.
 */
export async function leseEmpfaengerkandidaten(
  kontext: LeseKontext, profilId: string,
): Promise<readonly { readonly id: string; readonly name: string }[]> {
  const zeilen = await kontext.abfrage<{ id: string; name: string }>(
    `select b.id, b.name
       from benutzer b
       join benutzer_mandant bm
         on bm.benutzer_id = b.id and bm.mandant_id = app.aktiver_mandant()
        and bm.entzogen_am is null
      where b.status = 'aktiv'
        and not exists (select 1 from radar_profil_empfaenger e
                         where e.radar_profil_id = $1::uuid and e.benutzer_id = b.id)
      order by b.name
      limit 200`,
    [profilId]);
  return zeilen;
}

/* --------------------------------------------------------------- Schreiben */

export interface ProfilEingabe {
  readonly name: string;
  readonly nutsPraefixe: readonly string[];
  readonly positivKeywords: readonly string[];
  readonly negativKeywords: readonly string[];
  readonly wertMinCent: Cent | null;
  readonly wertMaxCent: Cent | null;
  readonly fristMinTage: number | null;
  readonly oberhalbSchwellenwert: boolean | null;
  readonly istAktiv: boolean;
}

/**
 * Die Stammdaten eines Profils setzen.
 *
 * **Was ein Speichern auslöst, tut die DATENBANK von selbst.** Der Trigger
 * `trg_radar_profil_version` zählt `version` hoch, sobald sich irgendein Feld
 * ändert; die drei CPV-Trigger und die drei Empfänger-Trigger tun dasselbe
 * über `app.radar_profil_version_bump`. Der nächste Nachtlauf schreibt dann
 * eine NEUE `bewertung`-Zeile, und die alte bleibt stehen — so bleibt
 * nachlesbar, mit welcher Suche eine Bekanntmachung damals bewertet wurde,
 * und nicht nur, wie sie heute aussähe. Deshalb wird hier auch nichts
 * „aufgeräumt": ein `update`, das dieselben Werte schreibt, zählt die Fassung
 * NICHT hoch (der Trigger prüft `old.* is distinct from new.*`).
 *
 * **Gesperrte Felder stehen nicht in der Eingabe.** `gewichtung`,
 * `benachrichtigung_ab_punkte`, `skala_max`, `negativ_wirkung`, `waehrung`
 * und `ist_platzhalter` tauchen in `ProfilEingabe` nicht auf — nicht weil sie
 * vergessen wurden, sondern damit kein Aufrufer sie versehentlich setzen
 * kann. Ihre offenen Fragen: O-15, O-191, O-47.
 */
/** Genau die Felder, die eine Bewertung beeinflussen — die Vergleichsgrundlage. */
interface StandRoh {
  readonly name: string;
  readonly nuts_praefixe: readonly string[];
  readonly positiv_keywords: readonly string[];
  readonly negativ_keywords: readonly string[];
  readonly wert_min: string | null;
  readonly wert_max: string | null;
  readonly frist_min_tage: number | null;
  readonly oberhalb_schwellenwert: boolean | null;
  readonly ist_aktiv: boolean;
}

/** Zwei Listen, gleich wenn gleich lang und Element für Element gleich. */
function gleich(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

export async function schreibeProfil(
  kontext: SchreibKontext, id: string, e: ProfilEingabe,
): Promise<void> {
  const name = pruefeName(e.name);
  /*
   * **Entdoppelt wird NACH dem Normalisieren, nicht davor.**
   *
   * `teileListe` entdoppelt die rohen Teile; `pruefeNutsPraefix` schreibt erst
   * danach gross. Die Eingabe „de3, DE3" ergab deshalb `['DE3', 'DE3']` in
   * `nuts_praefixe`. Das bleibt nicht folgenlos: die Liste geht in den
   * `eingaben_hash` einer Bewertung ein, und beim naechsten Oeffnen und
   * Speichern entdoppelt `teileListe` die jetzt gleich geschriebenen Werte —
   * der Vergleich unten schlaegt an, und die Profilfassung springt ohne
   * inhaltliche Aenderung. Genau das vermeidet `schreibeProfil` sonst
   * sorgfaeltig.
   *
   * Die Stichwortlisten koennen heute keine Doppelten gewinnen
   * (`pruefeStichwort` trimmt nur, und `teileListe` hat schon getrimmt) —
   * sie gehen trotzdem durch dieselbe Form, damit die naechste Normalisierung
   * den Fehler nicht wieder einfuehrt.
   */
  const nuts = [...new Set(e.nutsPraefixe.map(pruefeNutsPraefix))];
  const positiv = [...new Set(e.positivKeywords.map(pruefeStichwort))];
  const negativ = [...new Set(e.negativKeywords.map(pruefeStichwort))];
  pruefeWertgrenzen(e.wertMinCent, e.wertMaxCent);
  const frist = pruefeFristMinTage(e.fristMinTage);
  const minText = e.wertMinCent === null ? null : String(e.wertMinCent);
  const maxText = e.wertMaxCent === null ? null : String(e.wertMaxCent);

  /**
   * **Erst die Zeile sperren, dann vergleichen** — und beides in EINER
   * Anweisung, `select … for update`.
   *
   * `for update` ist hier nicht Vorsicht, sondern die Rechteprüfung: Postgres
   * wendet auf eine Sperrklausel auch das `using` der UPDATE-Policy an. Eine
   * Sitzung mit `radar.lesen`, aber ohne `radar.profil_schreiben` bekommt hier
   * also NULL Zeilen — und ebenso die Gruppenansicht, weil
   * `t_profil_schreiben` `not app.ist_readonly()` verlangt (Invariante 10).
   * Ohne das stünde weiter unten ein `update`, das null Zeilen trifft und wie
   * ein Erfolg aussieht; das ist der teuerste Fehler dieser Sorte.
   */
  const [alt] = await kontext.schreibe<StandRoh>(
    `select name, nuts_praefixe, positiv_keywords, negativ_keywords,
            wert_min_cent::text as wert_min, wert_max_cent::text as wert_max,
            frist_min_tage, oberhalb_schwellenwert, ist_aktiv
       from radar_profil
      where id = $1::uuid and mandant_id = $2::uuid and geloescht_am is null
      for update`,
    [id, kontext.aktiverMandantId]);
  if (alt === undefined) {
    throw new ProfilFehler('nicht_gefunden',
      'Das Profil wurde nicht gefunden, ist archiviert, oder diese Sitzung darf es '
      + 'nicht ändern.');
  }

  /**
   * **Ein Speichern ohne Änderung ändert NICHTS — auch nicht die Fassung.**
   *
   * Das ist keine Optimierung. `trg_radar_profil_version` zählt `version`
   * hoch, sobald irgendeine Spalte anders ist, und `geaendert_am = now()`
   * wäre immer anders: jeder Klick auf „Speichern" hätte die Fassung
   * hochgezählt, und der nächste Nachtlauf hätte für jede Bekanntmachung eine
   * NEUE `bewertung`-Zeile geschrieben — mit derselben Punktzahl, aus
   * derselben Suche. `bewertung.ts` sagt den Grund an der Stelle, an der es
   * `radar_profil_cpv.gewichtung` aus dem `eingaben_hash` heraushält: „das
   * Ändern einer Zahl ohne Wirkung erzeugte eine neue Bewertungszeile, und
   * die Aufzeichnung behauptete eine Änderung, die keine war".
   *
   * Verglichen wird deshalb genau das, was eine Bewertung beeinflusst — nicht
   * `geaendert_von`: dass jemand anderes zuletzt gespeichert hat, ist keine
   * andere Suche.
   */
  const unveraendert = alt.name === name
    && gleich(alt.nuts_praefixe, nuts)
    && gleich(alt.positiv_keywords, positiv)
    && gleich(alt.negativ_keywords, negativ)
    && alt.wert_min === minText
    && alt.wert_max === maxText
    && alt.frist_min_tage === frist
    && alt.oberhalb_schwellenwert === e.oberhalbSchwellenwert
    && alt.ist_aktiv === e.istAktiv;
  if (unveraendert) return;

  const [zeile] = await kontext.schreibe<{ id: string }>(
    `update radar_profil
        set name = $3, nuts_praefixe = $4::text[], positiv_keywords = $5::text[],
            negativ_keywords = $6::text[], wert_min_cent = $7::bigint,
            wert_max_cent = $8::bigint, frist_min_tage = $9::integer,
            oberhalb_schwellenwert = $10::boolean, ist_aktiv = $11,
            -- geaendert_am steht HIER, weil radar_profil keinen
            -- setze_geaendert_am-Trigger traegt (nur den Versionszaehler) und
            -- app.radar_profil_version_bump es nur setzt, wenn eine
            -- Kindtabelle die Fassung hochzaehlt. Ohne diese Zeile blieb die
            -- Spalte nach einer Stammdatenaenderung leer, und die Seite sagte
            -- "seit dem Anlegen unveraendert" ueber ein Profil, das eben
            -- geaendert wurde. Die Uhr ist die des Servers (Invariante 5).
            geaendert_am = now(), geaendert_von = $12::uuid
      where id = $1::uuid and mandant_id = $2::uuid and geloescht_am is null
      returning id`,
    [id, kontext.aktiverMandantId, name, [...nuts], [...positiv], [...negativ],
      minText, maxText, frist, e.oberhalbSchwellenwert, e.istAktiv, kontext.benutzerId]);

  /* Nach der Sperre oben kann das nicht mehr eintreten — bleibt aber stehen:
     ein stilles Null-Zeilen-Update darf nie wie ein Erfolg aussehen. */
  if (zeile === undefined) {
    throw new ProfilFehler('nicht_gefunden',
      'Das Profil liess sich nicht ändern.');
  }

  await kontext.schreibe(
    `select app.protokolliere('radar.profil_gesetzt', 'radar_profil', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [id, {
      name: alt.name, nuts: [...alt.nuts_praefixe], positiv: [...alt.positiv_keywords],
      negativ: [...alt.negativ_keywords], wertMinCent: alt.wert_min,
      wertMaxCent: alt.wert_max, fristMinTage: alt.frist_min_tage,
      oberhalbSchwellenwert: alt.oberhalb_schwellenwert, istAktiv: alt.ist_aktiv,
    }, {
      name, nuts: [...nuts], positiv: [...positiv], negativ: [...negativ],
      wertMinCent: minText, wertMaxCent: maxText, fristMinTage: frist,
      oberhalbSchwellenwert: e.oberhalbSchwellenwert, istAktiv: e.istAktiv,
    }]);
}

export interface CpvEingabe {
  readonly code: string;
  readonly praefixLaenge: number;
  readonly wirkung: Wirkung;
  readonly bezeichnung: string | null;
}

/**
 * Eine CPV-Zeile anlegen oder ihre Wirkung ändern.
 *
 * **`ist_platzhalter` bleibt `true`, und das ist nicht verhandelbar** (O-98):
 * die CPV-Listen der drei Gewerke sind gegen die amtliche Liste unbestätigt.
 * Eine von Hand eingetragene Zeile ist eine Eingabe, keine bestätigte
 * Leistungsart — und der Bildschirm sagt das an der Zeile.
 *
 * **`gewichtung` wird nicht gesetzt** und bleibt beim Vorgabewert: die
 * Bewertung benutzt die Spalte nicht (O-15), und eine Zahl zu schreiben, die
 * nichts bewirkt, sähe aus wie eine Einstellung.
 */
export async function setzeCpv(
  kontext: SchreibKontext, profilId: string, e: CpvEingabe,
): Promise<void> {
  const code = pruefeCpvCode(e.code);
  const laenge = pruefePraefixLaenge(e.praefixLaenge);
  const bezeichnung = e.bezeichnung === null || e.bezeichnung.trim() === ''
    ? null : e.bezeichnung.trim().slice(0, 200);

  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into radar_profil_cpv
       (mandant_id, radar_profil_id, cpv_code, praefix_laenge, wirkung, bezeichnung,
        ist_platzhalter)
     select $1::uuid, p.id, $3, $4::smallint, $5::cpv_wirkung, $6, true
       from radar_profil p
      where p.id = $2::uuid and p.mandant_id = $1::uuid and p.geloescht_am is null
     on conflict (radar_profil_id, cpv_code, praefix_laenge) do update
        set wirkung = excluded.wirkung,
            bezeichnung = coalesce(excluded.bezeichnung, radar_profil_cpv.bezeichnung)
     returning id`,
    [kontext.aktiverMandantId, profilId, code, laenge, e.wirkung, bezeichnung]);
  if (zeile === undefined) {
    throw new ProfilFehler('nicht_gefunden',
      'Das Profil wurde nicht gefunden, oder diese Sitzung darf es nicht ändern.');
  }
  /*
   * **Protokolliert, weil sonst niemand es je erfaehrt.**
   * `radar_profil_cpv` traegt keinen Audit-Trigger — nur die drei
   * Versionszaehler (`trg_rpc_version_*`). Der Zaehler sagt „irgendetwas hat
   * sich geaendert", nicht WER welchen Code auf welche Wirkung gestellt hat;
   * und weil hart geloescht wird, ist die Zeile danach weg. `entferneCpv`
   * protokollierte von Anfang an — dass es hier fehlte, war ein Versehen und
   * keine Entscheidung.
   */
  await kontext.schreibe(
    `select app.protokolliere('radar.profil_cpv_gesetzt', 'radar_profil', $1, null,
                              $2::jsonb, app.aktiver_mandant())`,
    [profilId, {
      cpvCode: code, praefixLaenge: laenge, wirkung: e.wirkung, bezeichnung,
    }]);
}

/**
 * Eine CPV-Zeile entfernen — **hart**, und das ist hier richtig.
 *
 * `radar_profil_cpv` trägt kein `geloescht_am` und kein `ist_aktiv`; sie hängt
 * per `on delete cascade` am Profil und hat eigens `trg_rpc_version_del`, um
 * beim Löschen die Profilfassung hochzuzählen. Invariante 8 nennt Finanzen,
 * Zeiterfassung und Audit — Radar nicht. Die Spur bleibt: die Fassung springt,
 * das Protokoll hält es fest, und die alten `bewertung`-Zeilen behalten ihre
 * Begründung mit dem Code, der damals traf.
 */
export async function entferneCpv(
  kontext: SchreibKontext, profilId: string, cpvId: string,
): Promise<void> {
  const [weg] = await kontext.schreibe<{ cpv_code: string }>(
    `delete from radar_profil_cpv
      where id = $1::uuid and radar_profil_id = $2::uuid
        and mandant_id = $3::uuid
     returning cpv_code`,
    [cpvId, profilId, kontext.aktiverMandantId]);
  if (weg === undefined) {
    throw new ProfilFehler('cpv', 'Diese CPV-Zeile gehört nicht zu diesem Profil.');
  }
  await kontext.schreibe(
    `select app.protokolliere('radar.profil_cpv_entfernt', 'radar_profil', $1, $2::jsonb,
                              null, app.aktiver_mandant())`,
    [profilId, { cpvCode: weg.cpv_code }]);
}

/**
 * Einen Empfänger eintragen.
 *
 * **Ohne Schwelle** — `ab_punkte` bleibt `null`, weil ab welcher Punktzahl
 * benachrichtigt wird, niemand entschieden hat (O-15). Ein eingetragener
 * Empfänger ohne Schwelle bekommt nach RAD-08 keine Treffermeldung, und die
 * Oberfläche sagt genau das. Eine Zahl hier zu erfinden hiesse, jemandem
 * Post zu schicken, deren Auswahlregel niemand bestätigt hat — und die
 * Gegenrichtung (eine zu hohe Schwelle) verschweigt Treffer, die niemand
 * sucht.
 */
export async function setzeEmpfaenger(
  kontext: SchreibKontext, profilId: string, benutzerId: string,
): Promise<void> {
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into radar_profil_empfaenger (mandant_id, radar_profil_id, benutzer_id)
     select $1::uuid, p.id, $3::uuid
       from radar_profil p
      where p.id = $2::uuid and p.mandant_id = $1::uuid and p.geloescht_am is null
     on conflict (radar_profil_id, benutzer_id) do nothing
     returning id`,
    [kontext.aktiverMandantId, profilId, benutzerId]);
  if (zeile === undefined) {
    /*
     * `do nothing` gibt auch dann keine Zeile zurueck, wenn der Empfaenger
     * schon eingetragen ist — und das ist kein Fehler, sondern der Zustand,
     * den der Aufrufer wollte. Unterschieden wird es hier, weil „schon da"
     * und „Profil nicht gefunden" zwei verschiedene Saetze verdienen.
     */
    const [da] = await kontext.abfrage<{ eins: number }>(
      `select 1 as eins from radar_profil_empfaenger
        where radar_profil_id = $1::uuid and benutzer_id = $2::uuid`,
      [profilId, benutzerId]);
    if (da !== undefined) return;
    throw new ProfilFehler('empfaenger',
      'Das Profil wurde nicht gefunden, oder diese Sitzung darf es nicht ändern.');
  }
  /*
   * Nur der ECHTE Eintrag steht im Protokoll: der Zweig oben kehrt um, wenn
   * der Empfaenger schon eingetragen war, und eine Zeile fuer eine Handlung,
   * die nichts geaendert hat, macht das Protokoll unlesbar. Auch hier gibt es
   * keinen Trigger (`radar_profil_empfaenger` traegt nur die Versionszaehler
   * und die Mandantenwache), und geloescht wird hart — wer nicht schreibt,
   * hinterlaesst nichts.
   */
  await kontext.schreibe(
    `select app.protokolliere('radar.profil_empfaenger_gesetzt', 'radar_profil', $1,
                              null, $2::jsonb, app.aktiver_mandant())`,
    [profilId, { benutzerId }]);
}

/** Einen Empfänger entfernen — hart, aus demselben Grund wie bei den CPV-Zeilen. */
export async function entferneEmpfaenger(
  kontext: SchreibKontext, profilId: string, empfaengerId: string,
): Promise<void> {
  const [weg] = await kontext.schreibe<{ benutzer_id: string }>(
    `delete from radar_profil_empfaenger
      where id = $1::uuid and radar_profil_id = $2::uuid and mandant_id = $3::uuid
     returning benutzer_id`,
    [empfaengerId, profilId, kontext.aktiverMandantId]);
  if (weg === undefined) {
    throw new ProfilFehler('empfaenger',
      'Dieser Eintrag gehört nicht zu diesem Profil.');
  }
  /* Dasselbe Muster wie `entferneCpv`: die Zeile ist danach weg, also muss
     VOR ihrem Verschwinden festgehalten sein, wer wen entfernt hat. */
  await kontext.schreibe(
    `select app.protokolliere('radar.profil_empfaenger_entfernt', 'radar_profil', $1,
                              $2::jsonb, null, app.aktiver_mandant())`,
    [profilId, { benutzerId: weg.benutzer_id }]);
}
