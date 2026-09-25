/**
 * Die Termine, die der Kalender SELBST besitzt: Besprechung, Kundentermin,
 * sonstiger Termin — anlegen, ändern, absagen (CAL-01, V-221, D-715).
 *
 * **Der Befund.** `kalender_eintrag` kennt seit 0160 die Arten `besprechung`,
 * `kundentermin` und `sonstiges`. Kein Bildschirm und keine Route legte sie
 * an, änderte sie oder sagte sie ab; einzige Quelle im Betrieb war der
 * Spiegel einer CRM-Wiedervorlage. Die Terminseite zeigte „Abgesagt" — und
 * nichts setzte `abgesagt_am`.
 *
 * **Was hier NICHT geschrieben wird.** Wiedervorlagen gehören dem CRM
 * (`crm/wiedervorlage.ts` spiegelt sie hierher), Bewerbungsgespräche dem
 * Recruiting (`gespraech`, 0166, eigene Tabelle). Eine Wiedervorlage im
 * Kalender umzuplanen hiesse, sie an ihrer Quelle vorbei zu ändern — zwei
 * Wahrheiten über denselben Termin, genau das, wogegen 0160 gebaut ist.
 * Deshalb ändert und sagt dieser Dienst nur ab, was er auch anlegt.
 *
 * **Die Zeit ist ein Instant** (Invariante 2): `beginn` und `ende` kommen als
 * UTC-Zeitpunkte herein; die Berliner Wanduhr des Formulars löst
 * `leseTerminZeiten` auf. Ganztägig heisst: Beginn um Berliner Mitternacht
 * des ersten Tags, Ende um Berliner Mitternacht NACH dem letzten (0160, wie
 * iCal) — an einem Umstellungstag ist der Tag also 23 oder 25 Stunden lang,
 * und das ist richtig.
 *
 * **Absagen heisst: stehen lassen** (0161, Invariante 8 sinngemäss). Die
 * Zeile bleibt mit Zeitpunkt (Uhr der DATENBANK) und Grund; wer den Termin
 * abonniert hat, sieht die Absage (`STATUS:CANCELLED`) statt eines Lochs.
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { planEingabe } from '../zeit/formulareingabe.js';
import { berlinTagesZeitpunkt, istKalendertag } from '../zeit/dauer.js';

/** Die Arten, die dieser Dienst anlegt und ändert. */
export const EIGENE_ARTEN = ['besprechung', 'kundentermin', 'sonstiges'] as const;
export type EigeneArt = (typeof EIGENE_ARTEN)[number];

export function istEigeneArt(wert: string): wert is EigeneArt {
  return (EIGENE_ARTEN as readonly string[]).includes(wert);
}

export type TerminAbweisung =
  | 'nicht_gefunden' | 'titel_fehlt' | 'titel_zu_lang' | 'text_zu_lang'
  | 'art_unbekannt' | 'fremde_art' | 'ende_vor_beginn' | 'teilnehmer_unbekannt'
  | 'abgesagt' | 'ohne_grund' | 'gleichzeitig' | 'zeitpunkt_unlesbar'
  | 'kein_kalendertag' | 'keine_uhrzeit';

export class TerminFehler extends Error {
  constructor(nachricht: string, readonly grund: TerminAbweisung) {
    super(nachricht);
    this.name = 'TerminFehler';
  }
}

export interface TerminEingabe {
  readonly art: string;
  readonly titel: string;
  readonly beschreibung: string;
  readonly ort: string;
  /** UTC-Instant — aus `leseTerminZeiten`. */
  readonly beginn: Date;
  /** UTC-Instant, der erste Augenblick DANACH. */
  readonly ende: Date;
  readonly ganztaegig: boolean;
  /** Weitere Teilnehmende (Benutzerkennungen); wer anlegt, führt den Termin. */
  readonly teilnehmer: readonly string[];
}

export interface GeprueftTermin {
  readonly art: EigeneArt;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly ort: string | null;
  readonly beginn: Date;
  readonly ende: Date;
  readonly ganztaegig: boolean;
  readonly teilnehmer: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Anzeigegrenzen, keine Fachregeln. */
export const TITEL_LAENGE = 200;
export const TEXT_LAENGE = 4000;
export const TEILNEHMER_HOECHSTENS = 50;

/**
 * Die Felder prüfen — rein, damit `tests/kern/kalender-termin.test.ts` jeden
 * Rand ohne Datenbank halten kann.
 */
export function pruefeTermin(e: TerminEingabe): GeprueftTermin {
  const titel = e.titel.trim();
  if (titel === '') throw new TerminFehler('Ein Termin braucht einen Titel.', 'titel_fehlt');
  if (titel.length > TITEL_LAENGE) {
    throw new TerminFehler(`Der Titel fasst ${String(TITEL_LAENGE)} Zeichen.`, 'titel_zu_lang');
  }
  const art = e.art.trim();
  if (!istEigeneArt(art)) {
    throw new TerminFehler(
      'Besprechung, Kundentermin oder sonstiger Termin — Wiedervorlagen entstehen im CRM, '
      + 'Bewerbungsgespräche im Recruiting.', 'art_unbekannt');
  }
  const beschreibung = e.beschreibung.trim();
  const ort = e.ort.trim();
  if (beschreibung.length > TEXT_LAENGE || ort.length > TITEL_LAENGE) {
    throw new TerminFehler('Beschreibung oder Ort sind zu lang.', 'text_zu_lang');
  }
  if (!(e.ende.getTime() > e.beginn.getTime())) {
    throw new TerminFehler('Das Ende liegt nicht nach dem Beginn.', 'ende_vor_beginn');
  }
  const teilnehmer = [...new Set(e.teilnehmer.map((t) => t.trim()).filter((t) => t !== ''))];
  if (teilnehmer.length > TEILNEHMER_HOECHSTENS || teilnehmer.some((t) => !UUID.test(t))) {
    throw new TerminFehler('Unter den Teilnehmenden ist jemand, den es hier nicht gibt.',
      'teilnehmer_unbekannt');
  }
  return {
    art, titel, beschreibung: beschreibung === '' ? null : beschreibung,
    ort: ort === '' ? null : ort, beginn: e.beginn, ende: e.ende,
    ganztaegig: e.ganztaegig, teilnehmer,
  };
}

/** Was das Formular schickt: Berliner Wanduhr bzw. Kalendertage, ohne Zone. */
export interface TerminZeitfelder {
  readonly ganztaegig: boolean;
  /** `JJJJ-MM-TTTHH:MM` — bei einem Termin mit Uhrzeit. */
  readonly beginn?: string;
  readonly ende?: string;
  /** `JJJJ-MM-TT` — bei einem ganztägigen Termin, beide einschliesslich. */
  readonly vonTag?: string;
  readonly bisTag?: string;
}

function tag(wert: string | undefined): string {
  const t = (wert ?? '').trim();
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(t);
  if (treffer === null) {
    throw new TerminFehler('Der Tag ist keiner: erwartet wird ein Datum.', 'zeitpunkt_unlesbar');
  }
  if (!istKalendertag(Number(treffer[1]), Number(treffer[2]), Number(treffer[3]))) {
    throw new TerminFehler(`Diesen Tag gibt es nicht: ${t}.`, 'kein_kalendertag');
  }
  return t;
}

function folgetag(t: string): string {
  const d = new Date(`${t}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Die Formularfelder als zwei Instants (Invariante 2).
 *
 * Mit Uhrzeit: `planEingabe`, wie beim Gespräch und bei der Wiedervorlage —
 * ein Tag, den der Kalender nicht kennt, wird abgewiesen. Ganztägig: Berliner
 * Mitternacht des ersten Tags bis Berliner Mitternacht nach dem letzten.
 */
export function leseTerminZeiten(f: TerminZeitfelder): { beginn: Date; ende: Date } {
  if (f.ganztaegig) {
    const von = tag(f.vonTag);
    const bis = tag(f.bisTag === undefined || f.bisTag.trim() === '' ? f.vonTag : f.bisTag);
    return { beginn: berlinTagesZeitpunkt(von), ende: berlinTagesZeitpunkt(folgetag(bis)) };
  }
  const beginn = planEingabe(f.beginn ?? '');
  if (!(beginn instanceof Date)) throw new TerminFehler(beginn.satz, beginn.grund as TerminAbweisung);
  const ende = planEingabe(f.ende ?? '');
  if (!(ende instanceof Date)) throw new TerminFehler(ende.satz, ende.grund as TerminAbweisung);
  return { beginn, ende };
}

/**
 * Nur Menschen DIESER Gesellschaft nehmen teil — gelesen unter RLS.
 *
 * Wer die Namen der anderen nicht lesen darf, sieht sie hier nicht, und eine
 * Kennung, die er nicht sieht, wird abgewiesen: dieselbe Grenze wie in der
 * Auswahl des Formulars.
 */
async function pruefeTeilnehmer(
  kontext: SchreibKontext, teilnehmer: readonly string[],
): Promise<void> {
  if (teilnehmer.length === 0) return;
  const gefunden = await kontext.abfrage<{ id: string }>(
    `select distinct b.id
       from benutzer b
       join benutzer_mandant bm on bm.benutzer_id = b.id
      where bm.mandant_id = app.aktiver_mandant() and bm.entzogen_am is null
        and b.status = 'aktiv' and b.id = any ($1::uuid[])`, [[...teilnehmer]]);
  if (gefunden.length !== teilnehmer.length) {
    throw new TerminFehler('Unter den Teilnehmenden ist jemand, der nicht zu dieser '
      + 'Gesellschaft gehört.', 'teilnehmer_unbekannt');
  }
}

/** Einen Termin anlegen — wer anlegt, führt ihn (`besitzer_benutzer_id`). */
export async function legeTerminAn(
  kontext: SchreibKontext, eingabe: TerminEingabe,
): Promise<string> {
  const t = pruefeTermin(eingabe);
  const teilnehmer = t.teilnehmer.filter((x) => x !== kontext.benutzerId);
  await pruefeTeilnehmer(kontext, teilnehmer);
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into kalender_eintrag
       (mandant_id, art, titel, beschreibung, ort, beginn, ende, ganztaegig,
        besitzer_benutzer_id, teilnehmer, erstellt_von)
     values (app.aktiver_mandant(), $1::kalender_art, $2, $3, $4, $5::timestamptz,
             $6::timestamptz, $7, app.aktueller_benutzer(),
             array_prepend(app.aktueller_benutzer(), $8::uuid[]), app.aktueller_benutzer())
     returning id`,
    [t.art, t.titel, t.beschreibung, t.ort, t.beginn.toISOString(), t.ende.toISOString(),
      t.ganztaegig, [...teilnehmer]]);
  if (z === undefined) {
    throw new TerminFehler('Der Termin wurde nicht angelegt.', 'gleichzeitig');
  }
  return z.id;
}

interface Bestand {
  readonly art: string;
  readonly abgesagt: boolean;
  readonly titel: string;
  readonly beginn: Date;
  readonly ende: Date;
  readonly ganztaegig: boolean;
}

/** Der Stand unter Sperre — und nur, was dieser Dienst ändern darf. */
async function sperre(kontext: SchreibKontext, id: string): Promise<Bestand> {
  if (!UUID.test(id)) throw new TerminFehler('Diesen Termin gibt es nicht.', 'nicht_gefunden');
  const [k] = await kontext.abfrage<Bestand>(
    `select art::text as art, (abgesagt_am is not null) as abgesagt, titel, beginn, ende,
            ganztaegig
       from kalender_eintrag
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      for update`, [id]);
  if (k === undefined) throw new TerminFehler('Diesen Termin gibt es nicht.', 'nicht_gefunden');
  if (!istEigeneArt(k.art)) {
    throw new TerminFehler(
      k.art === 'wiedervorlage'
        ? 'Eine Wiedervorlage ändert man an ihrer Anfrage im CRM — der Kalender zeigt sie nur.'
        : 'Ein Bewerbungsgespräch ändert man im Recruiting — der Kalender zeigt es nur.',
      'fremde_art');
  }
  if (k.abgesagt) {
    throw new TerminFehler('Dieser Termin ist abgesagt — er wird nicht mehr geändert.',
      'abgesagt');
  }
  return k;
}

/** Ändern — Art, Titel, Zeiten, Ort, Beschreibung und Teilnehmende. */
export async function aendereTermin(
  kontext: SchreibKontext, id: string, eingabe: TerminEingabe,
): Promise<void> {
  const t = pruefeTermin(eingabe);
  const vorher = await sperre(kontext, id);
  const teilnehmer = t.teilnehmer.filter((x) => x !== kontext.benutzerId);
  await pruefeTeilnehmer(kontext, teilnehmer);
  /*
   * Die Führung bleibt, wer sie hat: wer ändert, übernimmt den Termin nicht.
   * Die Teilnehmenden ersetzt die Auswahl — und die führende Person steht
   * immer darin, damit sie ihn in „Nur meine" und im Abonnement behält.
   */
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update kalender_eintrag
        set art = $2::kalender_art, titel = $3, beschreibung = $4, ort = $5,
            beginn = $6::timestamptz, ende = $7::timestamptz, ganztaegig = $8,
            teilnehmer = (select array_agg(distinct x)
                            from unnest(array_prepend(coalesce(besitzer_benutzer_id,
                                          app.aktueller_benutzer()), $9::uuid[])) as x),
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant() and abgesagt_am is null
      returning id`,
    [id, t.art, t.titel, t.beschreibung, t.ort, t.beginn.toISOString(), t.ende.toISOString(),
      t.ganztaegig, [...teilnehmer]]);
  if (zeilen.length === 0) {
    throw new TerminFehler('Der Termin hat sich inzwischen geändert — oder diese Sitzung darf '
      + 'ihn nicht ändern.', 'gleichzeitig');
  }
  await kontext.schreibe(
    `select app.protokolliere('kalender.termin_geaendert', 'kalender_eintrag', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [id,
      { art: vorher.art, titel: vorher.titel, beginn: vorher.beginn.toISOString(),
        ende: vorher.ende.toISOString(), ganztaegig: vorher.ganztaegig },
      { art: t.art, titel: t.titel, beginn: t.beginn.toISOString(),
        ende: t.ende.toISOString(), ganztaegig: t.ganztaegig }]);
}

/** Absagen — mit Grund (CHECK `ke_absage_begruendet`, 0160), stehen lassen. */
export async function sageTerminAb(
  kontext: SchreibKontext, id: string, grund: string,
): Promise<void> {
  const text = grund.trim();
  if (text === '') {
    throw new TerminFehler('Eine Absage nennt ihren Grund — er steht bei jedem, der den '
      + 'Termin sieht.', 'ohne_grund');
  }
  await sperre(kontext, id);
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update kalender_eintrag
        set abgesagt_am = now(), abgesagt_grund = $2, geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant() and abgesagt_am is null
      returning id`,
    [id, text]);
  if (zeilen.length === 0) {
    throw new TerminFehler('Der Termin hat sich inzwischen geändert — oder diese Sitzung darf '
      + 'ihn nicht absagen.', 'gleichzeitig');
  }
  await kontext.schreibe(
    `select app.protokolliere('kalender.termin_abgesagt', 'kalender_eintrag', $1, null,
                              $2::jsonb, app.aktiver_mandant())`,
    [id, { grund: text }]);
}
