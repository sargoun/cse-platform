import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

/**
 * **Die Module einer Administration** (AUT-01, V-164, D-658).
 *
 * SPEC §3: „Admin — assigned modules within assigned areas". Die Spalte
 * `benutzer_mandant.module` und ihre Auswertung in `app.hat_recht_fuer`
 * gab es seit 0007/0008 — nur schrieb sie niemand, und jede Administration
 * hielt alle Module ihrer Rolle. `drizzle/0416` baut den Weg:
 * `app.mitgliedschaft_module_setzen` mit allen Pruefungen (Mandant, zweiter
 * Faktor, `system.module_zuweisen`, Rolle `admin`, fremdes Konto) und einen
 * Ausloeser, der den Anwendungsweg an der Spalte vorbei sperrt.
 *
 * **Dieser Dienst prueft nichts davon ein zweites Mal.** Er reicht durch und
 * uebersetzt die Codes der Datenbank in einen Grund, den die Seite in Worte
 * fasst. Eine Pruefung hier ginge beim naechsten Aufrufer verloren; die in
 * der Datenbank nicht.
 */

export type ModulZuweisungGrund =
  | 'nicht_gefunden' | 'nicht_erlaubt' | 'eigenes_konto' | 'nur_admin'
  | 'keine_module' | 'unbekanntes_modul';

export class ModulZuweisungFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: ModulZuweisungGrund,
    readonly status: number,
  ) {
    super(nachricht);
    this.name = 'ModulZuweisungFehler';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface ModulZuweisung {
  readonly mitgliedschaftId: string;
  /** `null` = alle Module der Rolle; sonst die Schnittmenge (AUT-01). */
  readonly module: readonly string[] | null;
}

/**
 * Die Datenbank sagt, warum — dieser Satz sagt es dem Bildschirm.
 *
 * `detail` traegt den Grund als Schluessel (0416); `42501` ohne Schluessel ist
 * „darf nicht" und wird wie ein fehlendes Recht beantwortet: 404, nicht 403
 * (AUT-06). Wer das Recht nicht haelt, erfaehrt nicht, WAS ihm fehlt.
 */
function uebersetze(fehler: unknown): never {
  const f = fehler as { code?: string; detail?: string; message?: string };
  if (f.code === 'P0002') {
    throw new ModulZuweisungFehler('Diese Mitgliedschaft gibt es hier nicht.', 'nicht_gefunden', 404);
  }
  if (f.code === '42501' && f.detail === 'eigenes_konto') {
    throw new ModulZuweisungFehler(
      'Die eigene Modulliste ändert ein anderes Konto.', 'eigenes_konto', 409);
  }
  if (f.code === '42501') {
    throw new ModulZuweisungFehler('Nicht gefunden.', 'nicht_erlaubt', 404);
  }
  if (f.code === '22023' && f.detail === 'nur_admin') {
    throw new ModulZuweisungFehler(
      'Module werden nur einer Administration zugewiesen.', 'nur_admin', 409);
  }
  if (f.code === '22023' && f.detail === 'keine_module') {
    throw new ModulZuweisungFehler(
      'Mindestens ein Modul wählen — oder „alle Module der Rolle".', 'keine_module', 400);
  }
  if (f.code === '22023' && f.detail === 'unbekanntes_modul') {
    throw new ModulZuweisungFehler(f.message ?? 'Unbekanntes Modul.', 'unbekanntes_modul', 400);
  }
  throw fehler;
}

/**
 * Setzt die Module einer Mitgliedschaft im aktiven Mandanten.
 *
 * `geaendert: false` ist kein Fehler: zwei Menschen auf demselben Blatt sind
 * der Normalfall, und der zweite soll „unverändert" lesen, keine Ausnahme.
 */
export async function setzeMitgliedschaftModule(
  kontext: SchreibKontext, eingabe: ModulZuweisung,
): Promise<{ readonly geaendert: boolean }> {
  if (!UUID.test(eingabe.mitgliedschaftId)) {
    throw new ModulZuweisungFehler('Diese Mitgliedschaft gibt es hier nicht.', 'nicht_gefunden', 404);
  }
  try {
    const [z] = await kontext.schreibe<{ geaendert: boolean }>(
      `select app.mitgliedschaft_module_setzen($1::uuid, $2::text[]) as geaendert`,
      [eingabe.mitgliedschaftId, eingabe.module === null ? null : [...eingabe.module]]);
    return { geaendert: z?.geaendert === true };
  } catch (fehler) {
    return uebersetze(fehler);
  }
}

/**
 * Die Module, die es gibt — aus dem Katalog, nicht aus einer Liste im Code.
 *
 * Dieselbe Menge, gegen die der Ausloeser prueft (`select distinct modul from
 * berechtigung`). Eine zweite Liste hier waere beim naechsten Modul die, die
 * es nicht kennt.
 */
export async function modulKatalog(kontext: LeseKontext): Promise<readonly string[]> {
  const zeilen = await kontext.abfrage<{ modul: string }>(
    `select distinct modul from berechtigung order by modul`);
  return zeilen.map((z) => z.modul);
}

/**
 * Was das Formular geschickt hat, als Zuweisung.
 *
 * `umfang = alle` heisst `null` — ausdruecklich, nicht „keine Haken gesetzt":
 * eine leere Auswahl ist ein Versehen und wird als solches gemeldet, nicht
 * still zu „alles" gemacht.
 */
export function zuweisungAusFormular(
  umfang: string, gewaehlt: readonly string[],
): readonly string[] | null {
  if (umfang === 'alle') return null;
  return [...new Set(gewaehlt.map((m) => m.trim()).filter((m) => m !== ''))].sort();
}
