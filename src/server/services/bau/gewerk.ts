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
 * **Der Code ist fest — und der Name, sobald er an einem abgeschlossenen Tag
 * steht** (D-676 Nr. 2, D-679). Die Mannstunden eines Tages zeigen „Code ·
 * Bezeichnung", gelesen live aus diesem Katalog; einen Schnappschuss gibt es
 * nicht. Ein Code, der sich unter gebuchten Stunden aendert, schriebe die
 * Anzeige eines abgeschlossenen, vielleicht gegengezeichneten Tages um — und
 * ein Name genauso: aus „Trockenbau" wurde „Elektro", und der Tag, den der
 * Auftraggeber gegengezeichnet hat, zeigte danach Elektro-Stunden. Wer einen
 * anderen Namen braucht, sobald ein abgeschlossener Tag ihn traegt,
 * archiviert und traegt neu ein — der archivierte Code ist danach wieder frei
 * (`gewerk_code_uk` ist partiell, 0082), und der alte Tag behaelt, was er
 * zeigte. Bis dahin ist der Name frei, ebenso Reihenfolge, Leistungsbereich,
 * Bestaetigung und die Uebersetzungen des Mitarbeiterportals (sie sind nicht
 * Teil der gegengezeichneten Fassung).
 *
 * **Jede Aenderung steht im Pruefprotokoll** (`app.protokolliere`, vorher und
 * nachher), wie in den anderen Katalogen des Hauses — `gewerk` fuehrt keinen
 * Audit-Ausloeser, und ohne Protokoll liesse sich nicht mehr sagen, wie ein
 * Gewerk hiess, als ein Tag geschlossen wurde.
 *
 * **Geloescht wird nie** (`trg_gewerk_kein_hard_delete`): an einem Gewerk
 * haengen gebuchte Mannstunden. Archiviert heisst: fuer neue Buchungen nicht
 * mehr waehlbar, in alten weiter lesbar.
 */
import { randomUUID } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export type GewerkGrund =
  | 'unvollstaendig' | 'code_form' | 'doppelt' | 'nicht_gefunden' | 'schon_archiviert'
  /** Der Name steht an einem abgeschlossenen Bautag (D-679) — archivieren und neu eintragen. */
  | 'name_fest';

export class GewerkFehler extends Error {
  readonly code: GewerkGrund;
  readonly status: number;
  constructor(readonly grund: GewerkGrund, nachricht: string) {
    super(nachricht);
    this.code = grund;
    this.status = grund === 'nicht_gefunden' ? 404
      : grund === 'doppelt' || grund === 'schon_archiviert' || grund === 'name_fest' ? 409 : 422;
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

/**
 * Die Spalten, die VORHER und NACHHER im Pruefprotokoll teilen — die Namen
 * der Tabelle, damit `app.protokolliere` die geaenderten Felder richtig
 * ausweist (dieselbe Regel wie in `stammdaten/reinigungsklasse.ts`).
 */
const PROTOKOLL_SPALTEN = `code, bezeichnung, bezeichnung_i18n, leistungsbereich, sortierung,
            ist_platzhalter, archiviert_am`;

/**
 * Steht dieses Gewerk an einem abgeschlossenen (oder stornierten) Bautag?
 * Gezaehlt werden auch stornierte Mannstundenzeilen: sie stehen als
 * Korrekturspur auf dem Tag und tragen den Namen genauso (D-679).
 */
const AN_ABGESCHLOSSENEM_TAG = `exists (
          select 1 from bautagebuch_mannstunden m
            join bautagebuch b on b.id = m.bautagebuch_id and b.mandant_id = m.mandant_id
           where m.gewerk_id = g.id and m.mandant_id = g.mandant_id
             and (b.abgeschlossen_am is not null or b.storniert_am is not null))`;

/** Die Zeile, wie das Protokoll sie festhaelt — oder `null`, wenn es sie hier nicht gibt. */
async function protokollZeile(
  kontext: LeseKontext, id: string,
): Promise<(Readonly<Record<string, unknown>> & {
  readonly bezeichnung: string; readonly archiviert_am: unknown;
}) | null> {
  const [zeile] = await kontext.abfrage<Record<string, unknown> & {
    bezeichnung: string; archiviert_am: unknown;
  }>(`select ${PROTOKOLL_SPALTEN} from gewerk g where g.id = $1::uuid`, [id]);
  return zeile ?? null;
}

async function protokolliere(
  kontext: SchreibKontext, aktion: 'angelegt' | 'geaendert' | 'archiviert', id: string,
  vorher: Readonly<Record<string, unknown>> | null, nachher: Readonly<Record<string, unknown>>,
): Promise<void> {
  await kontext.schreibe(
    `select app.protokolliere($1, 'gewerk', $2, $3::jsonb, $4::jsonb, app.aktiver_mandant())`,
    [`bau.gewerk_${aktion}`, id, vorher, nachher]);
}

/** Legt ein Gewerk an und gibt seine Kennung zurueck. */
export async function legeGewerkAn(
  kontext: SchreibKontext, e: GewerkEingabe,
): Promise<string> {
  const code = pruefeGewerkCode(e.code);
  pruefeEingabe(e);
  const leistungsbereich = (e.leistungsbereich ?? '').trim();
  const id = randomUUID();
  const zeile = {
    code, bezeichnung: e.bezeichnung.trim(), bezeichnung_i18n: uebersetzungen(e),
    leistungsbereich: leistungsbereich === '' ? null : leistungsbereich,
    sortierung: e.sortierung ?? 0, ist_platzhalter: !e.bestaetigt, archiviert_am: null,
  };
  try {
    await kontext.schreibe(
      `insert into gewerk (id, mandant_id, code, bezeichnung, bezeichnung_i18n,
                           leistungsbereich, sortierung, ist_platzhalter,
                           erstellt_von_art, erstellt_von)
       values ($1::uuid, $2::uuid, $3, $4, $5::text::jsonb, $6, $7::smallint, $8::boolean,
               'mensch', $9::uuid)`,
      [
        id, kontext.aktiverMandantId, zeile.code, zeile.bezeichnung,
        JSON.stringify(zeile.bezeichnung_i18n), zeile.leistungsbereich,
        zeile.sortierung, zeile.ist_platzhalter, kontext.benutzerId,
      ],
    );
  } catch (fehler) {
    if (istCodeDoppelt(fehler)) {
      throw new GewerkFehler('doppelt',
        `Den Code „${code}" führt schon ein lebendes Gewerk dieser Gesellschaft.`);
    }
    throw fehler;
  }
  await protokolliere(kontext, 'angelegt', id, null, zeile);
  return id;
}

/**
 * Umbenennen, Reihenfolge, Leistungsbereich, Bestaetigung, Uebersetzungen —
 * der Code bleibt immer, der Name, sobald ein abgeschlossener Tag ihn traegt
 * (D-679). Die Sperre steht auch in der Aenderung selbst: schliesst jemand
 * zwischen Lesen und Schreiben einen Tag mit diesem Gewerk, aendert sie den
 * Namen nicht.
 */
export async function aendereGewerk(
  kontext: SchreibKontext, id: string, e: Omit<GewerkEingabe, 'code'>,
): Promise<void> {
  pruefeEingabe({ ...e, code: 'X' });
  const leistungsbereich = (e.leistungsbereich ?? '').trim();
  const bezeichnung = e.bezeichnung.trim();

  const vorher = await protokollZeile(kontext, id);
  if (vorher === null || vorher.archiviert_am !== null) {
    throw new GewerkFehler('nicht_gefunden',
      'Dieses Gewerk gibt es hier nicht (oder es ist archiviert).');
  }
  const nameFest = (): GewerkFehler => new GewerkFehler('name_fest',
    `„${vorher.bezeichnung}" steht schon an einem abgeschlossenen Bautag — umbenannt, `
    + 'zeigte dieser Tag einen anderen Namen, als abgeschlossen wurde. Archivieren Sie das '
    + 'Gewerk und tragen Sie es unter dem neuen Namen neu ein; der Code wird dabei frei.');
  if (bezeichnung !== vorher.bezeichnung) {
    const [z] = await kontext.abfrage<{ name_fest: boolean }>(
      `select ${AN_ABGESCHLOSSENEM_TAG} as name_fest from gewerk g where g.id = $1::uuid`, [id]);
    if (z?.name_fest === true) throw nameFest();
  }

  const [nachher] = await kontext.schreibe<Record<string, unknown>>(
    `update gewerk g
        set bezeichnung = $2, bezeichnung_i18n = $3::text::jsonb,
            leistungsbereich = $4, sortierung = $5::smallint, ist_platzhalter = $6::boolean,
            geaendert_von = $7::uuid, geaendert_von_art = 'mensch'
      where g.id = $1::uuid and g.archiviert_am is null
        and (g.bezeichnung = $2 or not ${AN_ABGESCHLOSSENEM_TAG})
      returning ${PROTOKOLL_SPALTEN}`,
    [
      id, bezeichnung, JSON.stringify(uebersetzungen({ ...e, code: 'X' })),
      leistungsbereich === '' ? null : leistungsbereich, e.sortierung ?? 0,
      !e.bestaetigt, kontext.benutzerId,
    ],
  );
  if (nachher === undefined) throw nameFest();
  await protokolliere(kontext, 'geaendert', id, vorher, nachher);
}

/** Archiviert ein Gewerk: nicht mehr waehlbar, gebuchte Stunden bleiben lesbar. */
export async function archiviereGewerk(kontext: SchreibKontext, id: string): Promise<void> {
  const vorher = await protokollZeile(kontext, id);
  if (vorher === null) {
    throw new GewerkFehler('nicht_gefunden', 'Dieses Gewerk gibt es hier nicht.');
  }
  const schonArchiviert = (): GewerkFehler =>
    new GewerkFehler('schon_archiviert', 'Dieses Gewerk ist schon archiviert.');
  if (vorher.archiviert_am !== null) throw schonArchiviert();
  const [nachher] = await kontext.schreibe<Record<string, unknown>>(
    `update gewerk
        set archiviert_am = now(), archiviert_von = $2::uuid,
            geaendert_von = $2::uuid, geaendert_von_art = 'mensch'
      where id = $1::uuid and archiviert_am is null
      returning ${PROTOKOLL_SPALTEN}`,
    [id, kontext.benutzerId]);
  if (nachher === undefined) throw schonArchiviert();
  await protokolliere(kontext, 'archiviert', id, vorher, nachher);
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
  /**
   * Der Name steht an einem abgeschlossenen Bautag (D-679): die Pflegeseite
   * bietet ihn nicht mehr zum Umbenennen an, sondern sagt, warum.
   */
  readonly nameFest: boolean;
}

/** Der ganze Katalog, lebende zuerst — mit der Zahl der Buchungen je Gewerk. */
export async function leseGewerkeKatalog(
  kontext: LeseKontext,
): Promise<readonly GewerkKatalogZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; code: string; bezeichnung: string;
    bezeichnung_i18n: Record<string, string> | null; leistungsbereich: string | null;
    sortierung: number; ist_platzhalter: boolean; archiviert: boolean; buchungen: number;
    name_fest: boolean;
  }>(
    `select g.id, g.code, g.bezeichnung, g.bezeichnung_i18n, g.leistungsbereich,
            g.sortierung, g.ist_platzhalter, (g.archiviert_am is not null) as archiviert,
            (select count(*)::int from bautagebuch_mannstunden m
              where m.gewerk_id = g.id and m.mandant_id = g.mandant_id
                and m.storniert_am is null) as buchungen,
            ${AN_ABGESCHLOSSENEM_TAG} as name_fest
       from gewerk g
      where g.mandant_id = app.aktiver_mandant()
      order by (g.archiviert_am is not null), g.sortierung, g.code`);
  return zeilen.map((z) => ({
    id: z.id, code: z.code, bezeichnung: z.bezeichnung,
    uebersetzungen: z.bezeichnung_i18n ?? {},
    leistungsbereich: z.leistungsbereich, sortierung: Number(z.sortierung),
    istPlatzhalter: z.ist_platzhalter, archiviert: z.archiviert,
    buchungen: Number(z.buchungen), nameFest: z.name_fest,
  }));
}
