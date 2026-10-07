/**
 * Der Zeichnungsvermerk der Verfahrensdokumentation (V-316, O-188, D-787,
 * D-837).
 *
 * `erstelleVerfahrensdokumentation` erzeugt das Dokument aus der lebenden
 * Konfiguration, mit Hash und Schemastand. Hier steht, wer es in welcher
 * Fassung gezeichnet hat — und ob die Zeichnung noch gilt.
 *
 * // TODO(client, O-188): Voreinstellung — die Geschäftsführung der
 * Gesellschaft zeichnet; auf der Plattform zeichnet, wer
 * `buchhaltung_konfiguration.verwalten` hält, und trägt seine Funktion ein.
 * Geprüft wird jährlich und bei jedem Wechsel des Schemastands (D-787, D-837).
 *
 * **Gezeichnet wird die Fassung, die beim Zeichnen ENTSTEHT.** Hash und
 * Schemastand kommen aus der Dokumentation, die die Route in derselben
 * Transaktion erzeugt — kein Formular reicht sie herein. Wer zeichnet und wann,
 * setzt die Datenbank (`kern.vdz_zeichner_und_zeit`, 0526).
 *
 * **Der Stand ist eine reine Rechnung** (`zeichnungsStand`) im Berliner
 * Kalender: ungezeichnet, Schemastand gewechselt, Turnus abgelaufen, Inhalt
 * geändert — oder aktuell bis zum nächsten Prüftag.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import type { Verfahrensdokumentation } from './verfahrensdokumentation.js';

/** Ein Berliner Kalendertag, `YYYY-MM-DD`. */
export type Kalendertag = string;

/** Voreinstellung (O-188): geprüft wird jährlich. */
export const PRUEF_TURNUS_MONATE = 12;

/** Die Grenzen der Eingabe — dieselben stehen als CHECK in 0526. */
export const FUNKTION_MINDESTENS = 3;
export const FUNKTION_HOECHSTENS = 200;
export const BEMERKUNG_HOECHSTENS = 2000;

export type ZeichnungFehlerGrund =
  | 'fassung_geaendert' | 'funktion_fehlt' | 'funktion_zu_lang' | 'bemerkung_zu_lang';

export class ZeichnungFehler extends Error {
  readonly status = 422;
  constructor(nachricht: string, readonly grund: ZeichnungFehlerGrund) {
    super(nachricht);
    this.name = 'ZeichnungFehler';
  }
}

export type ZeichnungsStand =
  | { readonly art: 'ungezeichnet' }
  | { readonly art: 'schemastand_gewechselt'; readonly gezeichnet: string | null }
  | { readonly art: 'turnus_abgelaufen'; readonly faelligSeit: Kalendertag }
  | { readonly art: 'inhalt_geaendert'; readonly faelligAm: Kalendertag }
  | { readonly art: 'aktuell'; readonly faelligAm: Kalendertag };

function teile(tag: Kalendertag): { j: number; m: number; t: number } {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(tag);
  if (treffer === null) throw new RangeError(`Kein Kalendertag: „${tag}"`);
  return { j: Number(treffer[1]), m: Number(treffer[2]), t: Number(treffer[3]) };
}

function monatsletzter(j: number, m: number): number {
  return [31, (j % 4 === 0 && j % 100 !== 0) || j % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 31;
}

/**
 * Derselbe Kalendertag `monate` Monate später — im Kalender, ohne Uhr. Gibt
 * es ihn nicht (29. Februar, 31. eines kürzeren Monats), der letzte Tag des
 * Zielmonats: früher prüfen ist erlaubt, später nicht.
 */
export function plusMonate(tag: Kalendertag, monate: number): Kalendertag {
  const { j, m, t } = teile(tag);
  const gesamt = (j * 12 + (m - 1)) + monate;
  const zj = Math.floor(gesamt / 12);
  const zm = (gesamt % 12) + 1;
  const zt = Math.min(t, monatsletzter(zj, zm));
  return `${String(zj).padStart(4, '0')}-${String(zm).padStart(2, '0')}-${String(zt).padStart(2, '0')}`;
}

/**
 * Gilt die letzte Zeichnung noch? Die Reihenfolge ist die der Gründe, vom
 * stärksten zum schwächsten: ohne Zeichnung nichts; ein neuer Schemastand
 * verlangt eine neue Prüfung, gleich wie jung die alte ist; dann der Turnus;
 * dann eine Fassung, die nicht mehr die gezeichnete ist.
 *
 * `inhalt_geaendert` ist ein Hinweis, keine Fälligkeit: der Hash deckt auch
 * Commit und Konfiguration, und nicht jede Auslieferung ändert ein Verfahren.
 * Ob sie es tut, prüft der Mensch — fällig wird die Prüfung mit dem
 * Schemastand oder dem Turnus. Kalendertage im Format `YYYY-MM-DD` lassen sich
 * als Zeichenketten vergleichen.
 */
export function zeichnungsStand(
  letzte: { readonly sha256: string; readonly schemastand: string | null;
    readonly gezeichnetTag: Kalendertag } | null,
  aktuell: { readonly sha256: string; readonly schemastand: string | null },
  heute: Kalendertag,
): ZeichnungsStand {
  teile(heute);
  if (letzte === null) return { art: 'ungezeichnet' };
  if (letzte.schemastand !== aktuell.schemastand) {
    return { art: 'schemastand_gewechselt', gezeichnet: letzte.schemastand };
  }
  const faellig = plusMonate(letzte.gezeichnetTag, PRUEF_TURNUS_MONATE);
  if (heute >= faellig) return { art: 'turnus_abgelaufen', faelligSeit: faellig };
  if (letzte.sha256 !== aktuell.sha256) return { art: 'inhalt_geaendert', faelligAm: faellig };
  return { art: 'aktuell', faelligAm: faellig };
}

export interface Zeichnung {
  readonly id: string;
  readonly sha256: string;
  readonly schemastand: string | null;
  readonly funktion: string;
  readonly bemerkung: string | null;
  readonly gezeichnetVon: string | null;
  /** Berliner Kalendertag der Zeichnung. */
  readonly gezeichnetTag: Kalendertag;
  /** Der Zeitpunkt als UTC-Instant (ISO 8601) — angezeigt in Berliner Zeit. */
  readonly gezeichnetAm: string;
}

/** Die Zeichnungen der aktiven Gesellschaft, die jüngste zuerst. */
export async function ladeZeichnungen(kontext: LeseKontext): Promise<readonly Zeichnung[]> {
  return kontext.abfrage<Zeichnung>(
    `select z.id::text as id, z.sha256, z.schemastand, z.funktion, z.bemerkung,
            b.name as "gezeichnetVon",
            to_char(z.gezeichnet_am at time zone 'Europe/Berlin', 'YYYY-MM-DD') as "gezeichnetTag",
            to_char(z.gezeichnet_am at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
              as "gezeichnetAm"
       from verfahrensdokumentation_zeichnung z
       left join benutzer b on b.id = z.gezeichnet_von
      where z.mandant_id = app.aktiver_mandant()
      order by z.gezeichnet_am desc, z.id`);
}

/** Was gezeichnet wird: Hash und Schemastand einer erzeugten Dokumentation. */
export interface Fassung {
  readonly sha256: string;
  readonly schemastand: string | null;
}

export function fassungVon(d: Pick<Verfahrensdokumentation, 'sha256' | 'schemastand'>): Fassung {
  return { sha256: d.sha256, schemastand: d.schemastand?.migration ?? null };
}

/**
 * Verlauf und Stand für die Seite. „Heute" ist der Berliner Kalendertag der
 * Datenbank (`app.berlin_heute()`), nicht die Uhr des Prozesses.
 */
export async function ladeZeichnungsvermerk(
  kontext: LeseKontext, aktuell: Fassung,
): Promise<{ readonly zeichnungen: readonly Zeichnung[]; readonly stand: ZeichnungsStand }> {
  const zeichnungen = await ladeZeichnungen(kontext);
  const [h] = await kontext.abfrage<{ heute: string }>(
    `select app.berlin_heute()::text as heute`);
  return { zeichnungen, stand: zeichnungsStand(zeichnungen[0] ?? null, aktuell, h!.heute) };
}

/**
 * Zeichnet die übergebene Fassung — Hash und Schemastand der Dokumentation,
 * die der Aufrufer in DIESER Transaktion erzeugt hat.
 *
 * **Und nur, wenn es die ist, die der Mensch gesehen hat.** `gesehen` ist der
 * Hash der Seite, auf der er geprüft hat. Hat sich die Konfiguration seither
 * geändert, ist die erzeugte Fassung eine andere — gezeichnet wird dann
 * nichts, und er prüft die neue. Der Hash aus dem Formular ersetzt die
 * Erzeugung nie; er hält nur eine veraltete Seite auf (Copilot-Runde PR #44).
 *
 * Das Recht (`buchhaltung_konfiguration.verwalten`) prüft die Route und die
 * Policy `t_vdz_zeichnen` (0526); Zeichner und Zeit setzt der Auslöser. Eine
 * Protokollzeile nennt Fassung und Funktion.
 */
export async function zeichne(
  kontext: SchreibKontext,
  fassung: Fassung,
  eingabe: {
    readonly funktion: string; readonly bemerkung?: string | null; readonly gesehen: string;
  },
): Promise<{ readonly id: string }> {
  if (eingabe.gesehen.trim() !== fassung.sha256) {
    throw new ZeichnungFehler(
      'Die Dokumentation hat sich geändert, seit sie geöffnet wurde — gezeichnet wird nur, '
      + 'was geprüft wurde.', 'fassung_geaendert');
  }
  const funktion = eingabe.funktion.trim();
  if (funktion.length < FUNKTION_MINDESTENS) {
    throw new ZeichnungFehler(
      'Die Funktion des Zeichnenden fehlt — etwa „Geschäftsführung".', 'funktion_fehlt');
  }
  if (funktion.length > FUNKTION_HOECHSTENS) {
    throw new ZeichnungFehler(
      `Die Funktion ist länger als ${String(FUNKTION_HOECHSTENS)} Zeichen.`, 'funktion_zu_lang');
  }
  const bemerkung = (eingabe.bemerkung ?? '').trim();
  if (bemerkung.length > BEMERKUNG_HOECHSTENS) {
    throw new ZeichnungFehler(
      `Die Bemerkung ist länger als ${String(BEMERKUNG_HOECHSTENS)} Zeichen.`, 'bemerkung_zu_lang');
  }
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into verfahrensdokumentation_zeichnung
       (mandant_id, sha256, schemastand, funktion, bemerkung)
     values (app.aktiver_mandant(), $1, $2, $3, $4)
     returning id::text as id`,
    [fassung.sha256, fassung.schemastand, funktion, bemerkung === '' ? null : bemerkung]);
  await kontext.schreibe(
    `select app.protokolliere('buchhaltung.verfahrensdokumentation_gezeichnet',
                              'verfahrensdokumentation_zeichnung', $1, null, $2::jsonb,
                              app.aktiver_mandant())`,
    [z!.id, { sha256: fassung.sha256, schemastand: fassung.schemastand, funktion }]);
  return { id: z!.id };
}
