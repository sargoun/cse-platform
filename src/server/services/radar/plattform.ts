import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';

/**
 * Der Plattformkatalog und der Registrierungsstand des Vergaberadars
 * (RAD-09, O-07, D-490, V-175, D-669).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RAD-09 verlangt festzuhalten, auf welchen Vergabeplattformen die Gruppe
 * registriert ist, und Bekanntmachungen auf Plattformen ohne Registrierung zu
 * markieren. `vergabeplattform` und `mandant_plattform_registrierung` standen
 * seit 0145 mit RLS und Schreibrechten da — geschrieben hat sie kein Weg. Dass
 * der Katalog LEER ausgeliefert wird, ist entschieden (O-07, D-490). Nicht
 * entschieden war, dass die Antwort auf O-07 nie eingetragen werden kann: die
 * Seite versprach „die Super-Administration trägt die Plattformen ein", und
 * die Warnung „nicht freigeschaltet" konnte nie auslösen, weil keine
 * Bekanntmachung je eine Plattform bekam.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier gilt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - **Den Katalog pflegt die Super-Administration** — er gehört keiner
 *    Gesellschaft, und `r_plattform_schreiben` (0145, 0146) sagt dasselbe.
 *    Dieser Dienst fragt es vorher, damit der Mensch einen Satz bekommt.
 *  - **Eingetragen wird, was ein Mensch weiss; vorbelegt wird nichts** (O-07).
 *    Ein neuer Eintrag trägt `ist_platzhalter`, bis ein Mensch ihn eigens
 *    bestätigt.
 *  - **Nach jeder Änderung am Katalog werden die schon eingelesenen
 *    Bekanntmachungen ohne Plattform nachgeordnet** — über
 *    `app.radar_plattform_nachordnen` (0420), also über DENSELBEN Auslöser
 *    wie beim Einlesen. Eine zweite Fassung der Hostregel gibt es nicht.
 *  - **Den Registrierungsstand pflegt jede Gesellschaft selbst**, unter
 *    `radar.plattform_verwalten`. Ein Kennwort steht nirgends (SEC-A5): die
 *    Maske fragt die Anmeldekennung, nie das Geheimnis.
 *  - **Gelöscht wird nichts.** Ein falscher Katalogeintrag wird archiviert;
 *    Bekanntmachungen und Registrierungen, die auf ihn zeigen, bleiben lesbar.
 */

export type PlattformFehlerCode =
  | 'nur_super_admin' | 'name_fehlt' | 'slug_ungueltig' | 'slug_vergeben'
  | 'url_ungueltig' | 'host_ungueltig' | 'text_zu_lang' | 'plattform_unbekannt'
  | 'status_unbekannt' | 'datum_ungueltig' | 'registriert_ohne_datum'
  | 'gueltig_vor_start' | 'verantwortlich_fremd' | 'unbekannte_handlung';

export class PlattformFehler extends Error {
  readonly status = 400;
  constructor(readonly code: PlattformFehlerCode, nachricht: string) {
    super(nachricht);
    this.name = 'PlattformFehler';
  }
}

/** Die Stände aus `plattform_registrierung_status` (0145) — ein Cast ist keine Prüfung. */
export const REGISTRIERUNG_STAENDE = [
  'unbekannt', 'nicht_registriert', 'beantragt', 'registriert', 'abgelaufen',
] as const;
export type RegistrierungStand = typeof REGISTRIERUNG_STAENDE[number];

export function istRegistrierungStand(wert: string): wert is RegistrierungStand {
  return (REGISTRIERUNG_STAENDE as readonly string[]).includes(wert);
}

/**
 * **Ist diese Gesellschaft auf der Plattform einer Bekanntmachung
 * freigeschaltet?** — als SQL-Ausdruck, EINE Stelle für Liste, Kennzahl,
 * Detailblatt, Plattformseite und Gruppenansicht (V-240, RAD-09).
 *
 * Vorher fragte jede Stelle nur `status = 'registriert'`. Damit meldeten sie
 * auch eine Plattform als „nicht freigeschaltet", die laut Katalog gar keine
 * Registrierung verlangt (`registrierung_erforderlich`, 0145), und eine
 * Registrierung, deren eingetragene Gültigkeit vorbei ist, galt überall als
 * freigeschaltet — nur die Plattformseite warnte.
 *
 *  - `null`: die Bekanntmachung hat keine Plattform — darüber lässt sich
 *    nichts sagen, und es wird nichts behauptet.
 *  - `true`: die Plattform verlangt laut Eintrag keine Registrierung, ODER
 *    der Stand ist `registriert` und „gültig bis" ist leer oder nicht vor
 *    dem heutigen Berliner Tag.
 *  - `false`: alles andere — auch `unbekannt` (keine Zeile).
 *
 * Der gespeicherte Stand wird dabei nicht umgedeutet (D-669 Punkt 7): eine
 * abgelaufene Gültigkeit ändert die WARNUNG, nicht die Zeile.
 *
 * Die Aliasse sind Namen aus dem Code, nie aus einer Anfrage.
 */
export function freischaltungSql(plattform: string, registrierung: string): string {
  return `(case when ${plattform}.id is null then null
               when not ${plattform}.registrierung_erforderlich then true
               else coalesce(${registrierung}.status = 'registriert'
                             and (${registrierung}.gueltig_bis is null
                                  or ${registrierung}.gueltig_bis >= app.berlin_heute()),
                             false)
          end)`;
}

/** Registriert, aber die eingetragene Gültigkeit ist vorbei (V-240). */
export function registrierungAbgelaufenSql(registrierung: string): string {
  return `coalesce(${registrierung}.status = 'registriert'
                   and ${registrierung}.gueltig_bis < app.berlin_heute(), false)`;
}

/** Anzeigegrenzen, keine Fachregeln. */
export const NAME_LAENGE = 200;
export const TEXT_LAENGE = 500;
export const NOTIZ_LAENGE = 2000;
export const HOSTS_HOECHSTENS = 20;

const SLUG = /^[a-z0-9_-]{2,60}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TAG = /^\d{4}-\d{2}-\d{2}$/u;
/** Ein Hostname: Labels aus Buchstaben, Ziffern und Bindestrich, mindestens ein Punkt. */
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/* ------------------------------------------------------------------ Prüfen */

function leer(wert: string | null | undefined): boolean {
  return wert === null || wert === undefined || wert.trim() === '';
}

function kurz(wert: string | null | undefined, grenze: number): string | null {
  if (leer(wert)) return null;
  const t = (wert ?? '').trim();
  if (t.length > grenze) {
    throw new PlattformFehler('text_zu_lang', `Ein Text ist länger als ${String(grenze)} Zeichen.`);
  }
  return t;
}

/** Ein Kalendertag `JJJJ-MM-TT`, den es gibt (kein 30. Februar). */
export function istTag(wert: string): boolean {
  if (!TAG.test(wert)) return false;
  const t = Date.parse(`${wert}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === wert;
}

/**
 * Die Hostnamen, über die eine Bekanntmachung ihrer Plattform zugeordnet wird.
 *
 * Getrennt durch Komma, Leerzeichen oder Zeilenwechsel; klein geschrieben.
 * Wer eine ganze Adresse einfügt („https://www.dtvp.de/Center/"), bekommt
 * ihren Host — das ist keine Deutung, sondern der Teil der Adresse, den der
 * Auslöser vergleicht. Alles andere, was kein Hostname ist, wird abgewiesen.
 */
export function leseHostmuster(roh: string | null | undefined): readonly string[] {
  if (leer(roh)) return [];
  const teile = (roh ?? '').split(/[\s,;]+/u).map((t) => t.trim()).filter((t) => t !== '');
  const hosts: string[] = [];
  for (const teil of teile) {
    let host = teil.toLowerCase();
    if (host.includes('://')) {
      try {
        host = new URL(host).hostname;
      } catch {
        throw new PlattformFehler('host_ungueltig', `Kein Hostname: ${teil}`);
      }
    }
    host = host.replace(/\.$/u, '');
    if (!HOST.test(host)) throw new PlattformFehler('host_ungueltig', `Kein Hostname: ${teil}`);
    if (!hosts.includes(host)) hosts.push(host);
  }
  if (hosts.length > HOSTS_HOECHSTENS) {
    throw new PlattformFehler('host_ungueltig',
      `Höchstens ${String(HOSTS_HOECHSTENS)} Hostnamen je Plattform.`);
  }
  return hosts;
}

/** Eine Adresse mit http(s) — oder keine. */
export function leseBasisUrl(roh: string | null | undefined): string | null {
  if (leer(roh)) return null;
  const t = (roh ?? '').trim();
  if (t.length > TEXT_LAENGE) throw new PlattformFehler('url_ungueltig', 'Die Adresse ist zu lang.');
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    throw new PlattformFehler('url_ungueltig', `Keine Adresse: ${t}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PlattformFehler('url_ungueltig', `Keine Webadresse: ${t}`);
  }
  if (url.username !== '' || url.password !== '') {
    // Eine Adresse mit Zugangsdaten ist ein Kennwort an einer Stelle, die vier Rollen lesen.
    throw new PlattformFehler('url_ungueltig', 'Eine Adresse trägt keine Zugangsdaten.');
  }
  return t;
}

export interface PlattformRoh {
  readonly name?: string | null;
  readonly slug?: string | null;
  readonly betreiber?: string | null;
  readonly basisUrl?: string | null;
  readonly hostMuster?: string | null;
  readonly registrierungErforderlich?: boolean;
  readonly registrierungDauerHinweis?: string | null;
}

export interface PlattformDaten {
  readonly name: string;
  /** `null`: aus dem Namen bilden (`app.slug_aus_titel`). */
  readonly slug: string | null;
  readonly betreiber: string | null;
  readonly basisUrl: string | null;
  readonly hostMuster: readonly string[];
  readonly registrierungErforderlich: boolean;
  readonly registrierungDauerHinweis: string | null;
}

/** Prüft die Felder eines Katalogeintrags — rein, ohne Datenbank. */
export function pruefePlattform(roh: PlattformRoh): PlattformDaten {
  const name = kurz(roh.name, NAME_LAENGE);
  if (name === null) throw new PlattformFehler('name_fehlt', 'Eine Plattform braucht einen Namen.');
  const slugRoh = leer(roh.slug) ? null : (roh.slug ?? '').trim().toLowerCase();
  if (slugRoh !== null && !SLUG.test(slugRoh)) {
    throw new PlattformFehler('slug_ungueltig',
      'Der Kurzname besteht aus 2 bis 60 Kleinbuchstaben, Ziffern, Binde- oder Unterstrichen.');
  }
  return {
    name,
    slug: slugRoh,
    betreiber: kurz(roh.betreiber, NAME_LAENGE),
    basisUrl: leseBasisUrl(roh.basisUrl),
    hostMuster: leseHostmuster(roh.hostMuster),
    registrierungErforderlich: roh.registrierungErforderlich !== false,
    registrierungDauerHinweis: kurz(roh.registrierungDauerHinweis, NAME_LAENGE),
  };
}

export interface RegistrierungRoh {
  readonly status?: string | null;
  readonly benutzerkennung?: string | null;
  readonly registriertAm?: string | null;
  readonly gueltigBis?: string | null;
  readonly verantwortlichBenutzerId?: string | null;
  readonly notiz?: string | null;
}

export interface RegistrierungDaten {
  readonly status: RegistrierungStand;
  readonly benutzerkennung: string | null;
  readonly registriertAm: string | null;
  readonly gueltigBis: string | null;
  readonly verantwortlichBenutzerId: string | null;
  readonly notiz: string | null;
}

/**
 * Prüft den Registrierungsstand — rein, ohne Datenbank.
 *
 * Die beiden Datumsregeln sind die der CHECKs aus 0145
 * (`mpr_registriert_datum`, `mpr_gueltig_nach_start`); hier stehen sie, damit
 * ein fehlendes Datum ein Satz wird und kein 23514.
 */
export function pruefeRegistrierung(roh: RegistrierungRoh): RegistrierungDaten {
  const status = (roh.status ?? '').trim();
  if (!istRegistrierungStand(status)) {
    throw new PlattformFehler('status_unbekannt', `Diesen Stand gibt es nicht: ${status}`);
  }
  const tag = (wert: string | null | undefined): string | null => {
    if (leer(wert)) return null;
    const t = (wert ?? '').trim();
    if (!istTag(t)) throw new PlattformFehler('datum_ungueltig', `Kein Datum: ${t}`);
    return t;
  };
  const registriertAm = tag(roh.registriertAm);
  const gueltigBis = tag(roh.gueltigBis);
  if (status === 'registriert' && registriertAm === null) {
    throw new PlattformFehler('registriert_ohne_datum',
      'Registriert heisst: seit einem Tag. Bitte das Datum der Freischaltung nennen.');
  }
  if (registriertAm !== null && gueltigBis !== null && gueltigBis < registriertAm) {
    throw new PlattformFehler('gueltig_vor_start', 'Die Gültigkeit endet vor der Registrierung.');
  }
  const verantwortlich = leer(roh.verantwortlichBenutzerId)
    ? null : (roh.verantwortlichBenutzerId ?? '').trim();
  if (verantwortlich !== null && !UUID.test(verantwortlich)) {
    throw new PlattformFehler('verantwortlich_fremd', 'Diese Person gibt es hier nicht.');
  }
  return {
    status,
    benutzerkennung: kurz(roh.benutzerkennung, NAME_LAENGE),
    registriertAm,
    gueltigBis,
    verantwortlichBenutzerId: verantwortlich,
    notiz: kurz(roh.notiz, NOTIZ_LAENGE),
  };
}

/* ---------------------------------------------------------------- Katalog */

async function nurSuperAdmin(kontext: SchreibKontext): Promise<void> {
  const [z] = await kontext.abfrage<{ ja: boolean }>(`select app.ist_super_admin() as ja`);
  if (z?.ja !== true) {
    throw new PlattformFehler('nur_super_admin',
      'Den Plattformkatalog pflegt die Super-Administration — er gehört keiner Gesellschaft.');
  }
}

/** Die Spalten, die Vorher und Nachher im Protokoll teilen. */
const KATALOG_SPALTEN = `id, name, slug, betreiber, basis_url, host_muster,
            registrierung_erforderlich, registrierung_dauer_hinweis, ist_platzhalter,
            archiviert_am`;

/** Der Postgres-Code einer verletzten Eindeutigkeit — ohne den Treiber zu kennen. */
function istEindeutigkeit(fehler: unknown, name: string): boolean {
  const f = fehler as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  return f.code === '23505' && (f.constraint_name === name || f.constraint === name);
}

async function nachordnen(kontext: SchreibKontext): Promise<number> {
  const [z] = await kontext.schreibe<{ anzahl: number }>(
    `select app.radar_plattform_nachordnen() as anzahl`);
  return z?.anzahl ?? 0;
}

export interface KatalogErgebnis {
  readonly plattformId: string;
  /** Wie viele schon eingelesene Bekanntmachungen jetzt diese (oder eine) Plattform tragen. */
  readonly zugeordnet: number;
}

/**
 * Trägt eine Plattform in den Katalog ein — als Platzhalter, bis ein Mensch
 * sie bestätigt — und ordnet die Bekanntmachungen ohne Plattform nach.
 */
export async function legePlattformAn(
  kontext: SchreibKontext, roh: PlattformRoh,
): Promise<KatalogErgebnis> {
  await nurSuperAdmin(kontext);
  const d = pruefePlattform(roh);
  let slug = d.slug;
  if (slug === null) {
    const [s] = await kontext.abfrage<{ slug: string }>(
      `select left(app.slug_aus_titel($1), 60) as slug`, [d.name]);
    slug = (s?.slug ?? '').replace(/-+$/u, '');
    if (!SLUG.test(slug)) {
      throw new PlattformFehler('slug_ungueltig',
        'Aus diesem Namen entsteht kein Kurzname — bitte einen angeben.');
    }
  }
  let zeile: Record<string, unknown> | undefined;
  try {
    [zeile] = await kontext.schreibe<Record<string, unknown>>(
      `insert into vergabeplattform
         (name, slug, betreiber, basis_url, host_muster, registrierung_erforderlich,
          registrierung_dauer_hinweis)
       values ($1, $2, $3, $4, $5::text[], $6::boolean, $7)
       returning ${KATALOG_SPALTEN}`,
      [d.name, slug, d.betreiber, d.basisUrl, d.hostMuster, d.registrierungErforderlich,
       d.registrierungDauerHinweis]);
  } catch (fehler) {
    if (istEindeutigkeit(fehler, 'vergabeplattform_slug_uk')) {
      throw new PlattformFehler('slug_vergeben', `Den Kurznamen „${slug}" trägt schon ein Eintrag.`);
    }
    throw fehler;
  }
  const id = zeile?.['id'];
  if (typeof id !== 'string') {
    throw new PlattformFehler('nur_super_admin', 'Die Plattform wurde nicht eingetragen.');
  }
  await kontext.schreibe(
    `select app.protokolliere('radar.plattform_angelegt', 'vergabeplattform', $1, null,
                              $2::jsonb, app.aktiver_mandant())`, [id, zeile]);
  return { plattformId: id, zugeordnet: await nachordnen(kontext) };
}

/** Liest einen Katalogeintrag unter Sperre — oder wirft. */
async function sperreEintrag(
  kontext: SchreibKontext, id: string,
): Promise<Record<string, unknown>> {
  if (!UUID.test(id)) throw new PlattformFehler('plattform_unbekannt', 'Diese Plattform gibt es nicht.');
  const [alt] = await kontext.schreibe<Record<string, unknown>>(
    `select ${KATALOG_SPALTEN} from vergabeplattform
      where id = $1::uuid and archiviert_am is null for update`, [id]);
  if (alt === undefined) {
    throw new PlattformFehler('plattform_unbekannt', 'Diese Plattform gibt es nicht (mehr).');
  }
  return alt;
}

/** Ändert Name, Betreiber, Adresse, Hostnamen und Hinweis eines Eintrags. */
export async function aenderePlattform(
  kontext: SchreibKontext, id: string, roh: PlattformRoh,
): Promise<KatalogErgebnis> {
  await nurSuperAdmin(kontext);
  const d = pruefePlattform(roh);
  const alt = await sperreEintrag(kontext, id);
  let zeile: Record<string, unknown> | undefined;
  try {
    [zeile] = await kontext.schreibe<Record<string, unknown>>(
      `update vergabeplattform
          set name = $2, slug = coalesce($3, slug), betreiber = $4, basis_url = $5,
              host_muster = $6::text[], registrierung_erforderlich = $7::boolean,
              registrierung_dauer_hinweis = $8, geaendert_am = now()
        where id = $1::uuid
        returning ${KATALOG_SPALTEN}`,
      [id, d.name, d.slug, d.betreiber, d.basisUrl, d.hostMuster,
       d.registrierungErforderlich, d.registrierungDauerHinweis]);
  } catch (fehler) {
    if (istEindeutigkeit(fehler, 'vergabeplattform_slug_uk')) {
      throw new PlattformFehler('slug_vergeben', `Den Kurznamen „${String(d.slug)}" trägt schon ein Eintrag.`);
    }
    throw fehler;
  }
  await kontext.schreibe(
    `select app.protokolliere('radar.plattform_geaendert', 'vergabeplattform', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`, [id, alt, zeile ?? null]);
  return { plattformId: id, zugeordnet: await nachordnen(kontext) };
}

/**
 * Bestätigt einen Eintrag: ein Mensch sagt, dass diese Plattform für die
 * Gruppe gilt und die Angaben stimmen (O-07). Ab dann trägt er keinen
 * Platzhaltervermerk mehr.
 */
export async function bestaetigePlattform(
  kontext: SchreibKontext, id: string,
): Promise<KatalogErgebnis> {
  await nurSuperAdmin(kontext);
  const alt = await sperreEintrag(kontext, id);
  const [zeile] = await kontext.schreibe<Record<string, unknown>>(
    `update vergabeplattform set ist_platzhalter = false, geaendert_am = now()
      where id = $1::uuid returning ${KATALOG_SPALTEN}`, [id]);
  await kontext.schreibe(
    `select app.protokolliere('radar.plattform_bestaetigt', 'vergabeplattform', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`, [id, alt, zeile ?? null]);
  return { plattformId: id, zugeordnet: 0 };
}

/**
 * Archiviert einen falschen oder nicht mehr genutzten Eintrag — gelöscht wird
 * er nicht: Bekanntmachungen und Registrierungen, die auf ihn zeigen, bleiben
 * lesbar, und neue werden ihm nicht mehr zugeordnet (der Auslöser fragt nur
 * nicht archivierte Einträge).
 */
export async function archivierePlattform(
  kontext: SchreibKontext, id: string,
): Promise<KatalogErgebnis> {
  await nurSuperAdmin(kontext);
  const alt = await sperreEintrag(kontext, id);
  const [zeile] = await kontext.schreibe<Record<string, unknown>>(
    `update vergabeplattform set archiviert_am = now(), geaendert_am = now()
      where id = $1::uuid returning ${KATALOG_SPALTEN}`, [id]);
  await kontext.schreibe(
    `select app.protokolliere('radar.plattform_archiviert', 'vergabeplattform', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`, [id, alt, zeile ?? null]);
  return { plattformId: id, zugeordnet: 0 };
}

/* ------------------------------------------------------ Registrierungsstand */

/** Die Spalten, die Vorher und Nachher im Protokoll teilen — nie ein Geheimnis. */
const REGISTRIERUNG_SPALTEN = `id, vergabeplattform_id, status::text as status, benutzerkennung,
            registriert_am::text as registriert_am, gueltig_bis::text as gueltig_bis,
            verantwortlich_benutzer_id, notiz`;

/**
 * Setzt den Registrierungsstand DIESER Gesellschaft auf einer Plattform —
 * anlegen oder ändern, eine Zeile je Plattform (`mpr_uk`).
 *
 * `zuletzt_bestaetigt_am` kommt von der Serveruhr (Invariante 5): wann ein
 * Mensch diesen Stand zuletzt gesagt hat.
 */
export async function setzeRegistrierung(
  kontext: SchreibKontext, plattformId: string, roh: RegistrierungRoh,
): Promise<{ readonly registrierungId: string }> {
  const d = pruefeRegistrierung(roh);
  if (!UUID.test(plattformId)) {
    throw new PlattformFehler('plattform_unbekannt', 'Diese Plattform gibt es nicht.');
  }
  const [plattform] = await kontext.abfrage<{ id: string }>(
    `select id from vergabeplattform where id = $1::uuid and archiviert_am is null`,
    [plattformId]);
  if (plattform === undefined) {
    throw new PlattformFehler('plattform_unbekannt', 'Diese Plattform gibt es nicht (mehr).');
  }
  if (d.verantwortlichBenutzerId !== null) {
    // Dieselbe Frage stellt `trg_mpr_verantwortlich_im_mandant` danach noch einmal.
    const [m] = await kontext.abfrage<{ ja: boolean }>(
      `select app.ist_mitglied($1::uuid, app.aktiver_mandant()) as ja`,
      [d.verantwortlichBenutzerId]);
    if (m?.ja !== true) {
      throw new PlattformFehler('verantwortlich_fremd',
        'Verantwortlich kann nur sein, wer in dieser Gesellschaft arbeitet.');
    }
  }

  const [vorher] = await kontext.schreibe<Record<string, unknown>>(
    `select ${REGISTRIERUNG_SPALTEN} from mandant_plattform_registrierung
      where mandant_id = app.aktiver_mandant() and vergabeplattform_id = $1::uuid
        and geloescht_am is null
      for update`, [plattformId]);

  const [nachher] = await kontext.schreibe<Record<string, unknown>>(
    `insert into mandant_plattform_registrierung
       (mandant_id, vergabeplattform_id, status, benutzerkennung, registriert_am, gueltig_bis,
        verantwortlich_benutzer_id, notiz, zuletzt_bestaetigt_am, erstellt_von_art, erstellt_von,
        geaendert_am, geaendert_von)
     values (app.aktiver_mandant(), $1::uuid, $2::plattform_registrierung_status, $3,
             $4::date, $5::date, $6::uuid, $7, now(), 'mensch', $8::uuid, now(), $8::uuid)
     on conflict (mandant_id, vergabeplattform_id) where geloescht_am is null do update
       set status = excluded.status, benutzerkennung = excluded.benutzerkennung,
           registriert_am = excluded.registriert_am, gueltig_bis = excluded.gueltig_bis,
           verantwortlich_benutzer_id = excluded.verantwortlich_benutzer_id,
           notiz = excluded.notiz, zuletzt_bestaetigt_am = now(),
           geaendert_am = now(), geaendert_von = excluded.geaendert_von
     returning ${REGISTRIERUNG_SPALTEN}`,
    [plattformId, d.status, d.benutzerkennung, d.registriertAm, d.gueltigBis,
     d.verantwortlichBenutzerId, d.notiz, kontext.benutzerId]);
  const id = nachher?.['id'];
  if (typeof id !== 'string') {
    throw new PlattformFehler('plattform_unbekannt', 'Der Stand wurde nicht gespeichert.');
  }
  await kontext.schreibe(
    `select app.protokolliere('radar.plattform_registrierung', 'mandant_plattform_registrierung',
                              $1, $2::jsonb, $3::jsonb, app.aktiver_mandant())`,
    [id, vorher ?? null, nachher]);
  return { registrierungId: id };
}
