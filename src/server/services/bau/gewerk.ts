/**
 * Der Gewerkekatalog des Mandanten — der Bezug der Mannstunden im
 * Bautagebuch (BAU-07 „Mannstunden per trade", §7.15, V-182, D-676).
 *
 * **Der Befund.** `bautagebuch_mannstunden.gewerk_id` ist NOT NULL, und
 * `hefteMannstundenAn` weist jedes unbekannte Gewerk ab. Der Katalog `gewerk`
 * wird leer ausgeliefert (O-159) und nur der Seed fuellte ihn — Dienst, Route
 * und Seite, die ein Gewerk anlegen, gab es nicht, obwohl Policy und
 * `grant insert, update` (0082) fuer `bau.schreiben` bereitstanden. In jedem
 * echten Bau-Mandanten blieb die Kernangabe des Bautagebuchs damit
 * unerfassbar.
 *
 * **Was hier entschieden wird und was nicht.** WELCHE Gewerke gefuehrt werden
 * und ob die Liste den STLB-Bau-Leistungsbereichen folgt, entscheidet die
 * Gesellschaft (O-159). Dieser Dienst legt ab, was ein Mensch mit
 * `bau.schreiben` eintraegt, und sagt dazu, ob es bestaetigt ist
 * (`ist_platzhalter`, §1.16). Er schlaegt kein Gewerk vor.
 *
 * **Umbenennen ja, den Code aendern nein.** Die Mannstunden eines Tages
 * zeigen „Code · Bezeichnung"; ein Code, der sich unter gebuchten Stunden
 * aendert, schriebe die Anzeige eines abgeschlossenen Tages um. Wer einen
 * anderen Code braucht, archiviert und legt neu an — der archivierte Code ist
 * danach wieder frei (`gewerk_code_uk` ist partiell, 0082).
 *
 * **Geloescht wird nie** (`trg_gewerk_kein_hard_delete`): an einem Gewerk
 * haengen gebuchte Mannstunden. Archiviert heisst: fuer neue Buchungen nicht
 * mehr waehlbar, in alten weiter lesbar.
 */
import { randomUUID } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export type GewerkGrund =
  | 'unvollstaendig' | 'code_form' | 'doppelt' | 'nicht_gefunden' | 'schon_archiviert';

export class GewerkFehler extends Error {
  readonly code: GewerkGrund;
  readonly status: number;
  constructor(readonly grund: GewerkGrund, nachricht: string) {
    super(nachricht);
    this.code = grund;
    this.status = grund === 'nicht_gefunden' ? 404
      : grund === 'doppelt' || grund === 'schon_archiviert' ? 409 : 422;
    this.name = 'GewerkFehler';
  }
}

/** Die vier Sprachen des Mitarbeiterportals (EMP-12) — `de` ist die Bezeichnung. */
const SPRACHEN = ['en', 'ar', 'tr'] as const;

export interface GewerkEingabe {
  readonly code: string;
  readonly bezeichnung: string;
  /** Uebersetzungen fuer das Mitarbeiterportal — leere werden weggelassen. */
  readonly uebersetzungen?: Readonly<Partial<Record<(typeof SPRACHEN)[number], string>>>;
  readonly leistungsbereich?: string | null;
  readonly sortierung?: number;
  /** Aus der Antwort auf O-159 bestaetigt? Sonst bleibt der Eintrag unbestaetigt. */
  readonly bestaetigt: boolean;
}

/**
 * `„ tro "` → `TRO`. Ein bis zwoelf Zeichen aus Buchstaben, Ziffern, Binde-
 * und Unterstrich — der Code steht in jeder Mannstundenzeile vor der
 * Bezeichnung und in keinem Export als Schluessel; eine engere Form (etwa die
 * STLB-Nummer) waere eine Antwort auf O-159, die niemand gegeben hat.
 */
export function pruefeGewerkCode(eingabe: string): string {
  const code = eingabe.trim().toUpperCase();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,11}$/u.test(code)) {
    throw new GewerkFehler('code_form',
      'Der Code hat 1 bis 12 Zeichen: Buchstaben, Ziffern, Binde- oder Unterstrich.');
  }
  return code;
}

function uebersetzungen(e: GewerkEingabe): Readonly<Record<string, string>> {
  const karte: Record<string, string> = { de: e.bezeichnung.trim() };
  for (const sprache of SPRACHEN) {
    const wert = (e.uebersetzungen?.[sprache] ?? '').trim();
    if (wert !== '') karte[sprache] = wert;
  }
  return karte;
}

function pruefeEingabe(e: GewerkEingabe): void {
  if (e.bezeichnung.trim() === '') {
    throw new GewerkFehler('unvollstaendig', 'Ein Gewerk braucht eine Bezeichnung.');
  }
  const s = e.sortierung ?? 0;
  if (!Number.isInteger(s) || s < 0 || s > 999) {
    throw new GewerkFehler('unvollstaendig', 'Die Reihenfolge ist eine ganze Zahl von 0 bis 999.');
  }
}

function istCodeDoppelt(fehler: unknown): boolean {
  const f = fehler as { code?: unknown; constraint_name?: unknown };
  return f.code === '23505' && f.constraint_name === 'gewerk_code_uk';
}

/** Legt ein Gewerk an und gibt seine Kennung zurueck. */
export async function legeGewerkAn(
  kontext: SchreibKontext, e: GewerkEingabe,
): Promise<string> {
  const code = pruefeGewerkCode(e.code);
  pruefeEingabe(e);
  const leistungsbereich = (e.leistungsbereich ?? '').trim();
  const id = randomUUID();
  try {
    await kontext.schreibe(
      `insert into gewerk (id, mandant_id, code, bezeichnung, bezeichnung_i18n,
                           leistungsbereich, sortierung, ist_platzhalter,
                           erstellt_von_art, erstellt_von)
       values ($1::uuid, $2::uuid, $3, $4, $5::text::jsonb, $6, $7::smallint, $8::boolean,
               'mensch', $9::uuid)`,
      [
        id, kontext.aktiverMandantId, code, e.bezeichnung.trim(),
        JSON.stringify(uebersetzungen(e)),
        leistungsbereich === '' ? null : leistungsbereich,
        e.sortierung ?? 0, !e.bestaetigt, kontext.benutzerId,
      ],
    );
  } catch (fehler) {
    if (istCodeDoppelt(fehler)) {
      throw new GewerkFehler('doppelt',
        `Den Code „${code}" führt schon ein lebendes Gewerk dieser Gesellschaft.`);
    }
    throw fehler;
  }
  return id;
}

/** Umbenennen, Reihenfolge, Leistungsbereich, Bestaetigung — der Code bleibt. */
export async function aendereGewerk(
  kontext: SchreibKontext, id: string, e: Omit<GewerkEingabe, 'code'>,
): Promise<void> {
  pruefeEingabe({ ...e, code: 'X' });
  const leistungsbereich = (e.leistungsbereich ?? '').trim();
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update gewerk
        set bezeichnung = $2, bezeichnung_i18n = $3::text::jsonb,
            leistungsbereich = $4, sortierung = $5::smallint, ist_platzhalter = $6::boolean,
            geaendert_von = $7::uuid, geaendert_von_art = 'mensch'
      where id = $1::uuid and archiviert_am is null
      returning id`,
    [
      id, e.bezeichnung.trim(), JSON.stringify(uebersetzungen({ ...e, code: 'X' })),
      leistungsbereich === '' ? null : leistungsbereich, e.sortierung ?? 0,
      !e.bestaetigt, kontext.benutzerId,
    ],
  );
  if (zeilen.length === 0) {
    throw new GewerkFehler('nicht_gefunden',
      'Dieses Gewerk gibt es hier nicht (oder es ist archiviert).');
  }
}

/** Archiviert ein Gewerk: nicht mehr waehlbar, gebuchte Stunden bleiben lesbar. */
export async function archiviereGewerk(kontext: SchreibKontext, id: string): Promise<void> {
  const [z] = await kontext.abfrage<{ archiviert: boolean }>(
    `select (archiviert_am is not null) as archiviert from gewerk where id = $1::uuid`, [id]);
  if (z === undefined) {
    throw new GewerkFehler('nicht_gefunden', 'Dieses Gewerk gibt es hier nicht.');
  }
  if (z.archiviert) {
    throw new GewerkFehler('schon_archiviert', 'Dieses Gewerk ist schon archiviert.');
  }
  await kontext.schreibe(
    `update gewerk
        set archiviert_am = now(), archiviert_von = $2::uuid,
            geaendert_von = $2::uuid, geaendert_von_art = 'mensch'
      where id = $1::uuid and archiviert_am is null`,
    [id, kontext.benutzerId]);
}

/** Eine Katalogzeile, wie die Pflegeseite sie zeigt. */
export interface GewerkKatalogZeile {
  readonly id: string;
  readonly code: string;
  readonly bezeichnung: string;
  readonly uebersetzungen: Readonly<Record<string, string>>;
  readonly leistungsbereich: string | null;
  readonly sortierung: number;
  readonly istPlatzhalter: boolean;
  readonly archiviert: boolean;
  /** Gebuchte, nicht stornierte Mannstundenzeilen — die Folge eines Archivierens. */
  readonly buchungen: number;
}

/** Der ganze Katalog, lebende zuerst — mit der Zahl der Buchungen je Gewerk. */
export async function leseGewerkeKatalog(
  kontext: LeseKontext,
): Promise<readonly GewerkKatalogZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; code: string; bezeichnung: string;
    bezeichnung_i18n: Record<string, string> | null; leistungsbereich: string | null;
    sortierung: number; ist_platzhalter: boolean; archiviert: boolean; buchungen: number;
  }>(
    `select g.id, g.code, g.bezeichnung, g.bezeichnung_i18n, g.leistungsbereich,
            g.sortierung, g.ist_platzhalter, (g.archiviert_am is not null) as archiviert,
            (select count(*)::int from bautagebuch_mannstunden m
              where m.gewerk_id = g.id and m.mandant_id = g.mandant_id
                and m.storniert_am is null) as buchungen
       from gewerk g
      where g.mandant_id = app.aktiver_mandant()
      order by (g.archiviert_am is not null), g.sortierung, g.code`);
  return zeilen.map((z) => ({
    id: z.id, code: z.code, bezeichnung: z.bezeichnung,
    uebersetzungen: z.bezeichnung_i18n ?? {},
    leistungsbereich: z.leistungsbereich, sortierung: Number(z.sortierung),
    istPlatzhalter: z.ist_platzhalter, archiviert: z.archiviert,
    buchungen: Number(z.buchungen),
  }));
}
