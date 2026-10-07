import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { GEWERKE } from '../../registry/modul.js';

/**
 * **Die Modulbuchung einer Gesellschaft eintragen** (V-298, O-355, D-809).
 *
 * `mandant.module` nennt die gebuchten Gewerke, `module_gepflegt` sagt, ob
 * die Liste gilt (0103, D-377). Geschrieben hat beides bis hierher nur der
 * Seed. `app.mandant_module_buchen` (0502) prueft Mandant, Gruppenansicht,
 * lesende Sitzung, zweiten Faktor, Super-Administration und
 * `system.module_zuweisen`, und haelt fest, wer eingetragen hat.
 *
 * TODO(client, O-355): Voreinstellung — die Super-Administration traegt die
 * gebuchten Gewerke beim Vertragsschluss ein (Einstellungen › Module); die
 * Gesellschaft bucht nicht selbst. Gebaut mit V-298. D-784, D-809.
 *
 * **Dieser Dienst prueft nichts davon ein zweites Mal** — wie
 * `mitgliedschaft-module.ts`: er reicht durch und uebersetzt die Codes der
 * Datenbank in einen Grund, den die Seite in Worte fasst.
 */

export type ModulbuchungGrund =
  | 'nicht_erlaubt' | 'nur_super_admin' | 'unbekanntes_gewerk';

export class ModulbuchungFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: ModulbuchungGrund,
    readonly status: number,
  ) {
    super(nachricht);
    this.name = 'ModulbuchungFehler';
  }
}

/**
 * Die Gewerke aus dem Formular — jedes nur einmal, in fester Reihenfolge.
 *
 * Leer ist erlaubt und heisst „kein Gewerk" (0103): die Aussage der CSE
 * Operations. Ein Wert ausserhalb von `GEWERKE` wird abgewiesen, bevor die
 * Datenbank ihn sieht; die Datenbank prueft ihn trotzdem noch einmal.
 */
export function gewerkeAusFormular(roh: readonly string[]): readonly string[] {
  const gewaehlt = new Set<string>();
  for (const wert of roh) {
    const g = wert.trim();
    if (!GEWERKE.includes(g)) {
      throw new ModulbuchungFehler(
        'Gebucht werden nur Gebäudereinigung, Sicherheit und Bau.', 'unbekanntes_gewerk', 400);
    }
    gewaehlt.add(g);
  }
  return [...gewaehlt].sort();
}

/**
 * `detail` traegt den Grund als Schluessel (0502). `42501` ohne Schluessel ist
 * „darf nicht" und wird wie ein fehlendes Recht beantwortet: 404 (AUT-06).
 * `nur_super_admin` steht erst hinter bestandenem Recht — wer es liest, haelt
 * `system.module_zuweisen` und erfaehrt nur, wer die Buchung eintraegt.
 */
function uebersetze(fehler: unknown): never {
  const f = fehler as { code?: string; detail?: string };
  if (f.code === '42501' && f.detail === 'nur_super_admin') {
    throw new ModulbuchungFehler(
      'Die Modulbuchung trägt die Super-Administration ein.', 'nur_super_admin', 403);
  }
  if (f.code === '42501') {
    throw new ModulbuchungFehler('Nicht gefunden.', 'nicht_erlaubt', 404);
  }
  if (f.code === '22023') {
    throw new ModulbuchungFehler(
      'Gebucht werden nur Gebäudereinigung, Sicherheit und Bau.', 'unbekanntes_gewerk', 400);
  }
  throw fehler;
}

/**
 * Traegt die Buchung der aktiven Gesellschaft ein.
 *
 * `geaendert: false` ist kein Fehler: dieselbe Buchung zweimal abzuschicken
 * aendert nichts und schreibt kein zweites Mal ins Protokoll.
 */
export async function bucheModule(
  kontext: SchreibKontext, gewerke: readonly string[],
): Promise<{ readonly geaendert: boolean }> {
  try {
    const [z] = await kontext.schreibe<{ geaendert: boolean }>(
      `select app.mandant_module_buchen($1::text[]) as geaendert`, [[...gewerke]]);
    return { geaendert: z?.geaendert === true };
  } catch (fehler) {
    return uebersetze(fehler);
  }
}

export interface Modulbuchung {
  readonly module: readonly string[];
  /** Gilt die Liste (0103)? `false` = es wird nicht gefiltert. */
  readonly gepflegt: boolean;
  /** Berliner Zeit der Eintragung, oder `null` beim Seed-Stand. */
  readonly eingetragenAm: string | null;
  /** Wer eingetragen hat — `null`, wenn der Name hier nicht lesbar ist. */
  readonly eingetragenVon: string | null;
}

/** Der Stand einer Gesellschaft — gezeigt in Berliner Zeit (Invariante 2). */
export async function leseModulbuchung(
  kontext: LeseKontext, mandantId: string,
): Promise<Modulbuchung | null> {
  const [z] = await kontext.abfrage<{
    module: readonly string[] | null; module_gepflegt: boolean;
    eingetragen_am: string | null; eingetragen_von: string | null;
  }>(
    `select m.module, m.module_gepflegt,
            to_char(m.module_eingetragen_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as eingetragen_am,
            b.name as eingetragen_von
       from mandant m
       left join benutzer b on b.id = m.module_eingetragen_von
      where m.id = $1::uuid`, [mandantId]);
  if (z === undefined) return null;
  return {
    module: z.module ?? [],
    gepflegt: z.module_gepflegt,
    eingetragenAm: z.eingetragen_am,
    eingetragenVon: z.eingetragen_von,
  };
}
