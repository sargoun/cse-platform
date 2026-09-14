import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { WOCHENTAGE, leseRegel, type Wochentag } from '../../../lib/datum/rrule.js';
import { generiereEinsaetze, type SerienBericht } from './generator.js';

/**
 * Serien anlegen — der Weg, auf dem eine Administration Schichten in den
 * Plan bekommt (TIM-01, TIM-02, CLN-02, SEC-04, D-487).
 *
 * **Der Befund.** Turnus, Posten und Planungsserie gab es, den Generator
 * auch — aber ausser dem Seed legte nichts eine `planungsserie` an. Ein
 * Posten mit Dienstzeiten blieb ein Posten ohne Schichten, und ein Revier
 * hatte keinen Weg zu einem Turnus. Der Dienstplan zeigte, was der Seed
 * geschrieben hatte, und sonst nichts.
 *
 * **Was hier entsteht.** Fuer die Reinigung ein Turnus (Revier, Leistung,
 * Wochentage, Beginn, Dauer, Feiertagsregel) samt Serie; fuer die Sicherheit
 * die Serie zu einem Posten, der Dienstzeiten traegt. In beiden Faellen
 * laeuft der Generator SOFORT fuer die Gesellschaft — der naechtliche Job
 * haette dieselbe Serie erst am naechsten Morgen materialisiert, und eine
 * Administration, die eine Serie anlegt, will die Schichten sehen. Was der
 * Generator ueberspringt (Objekt ohne Kunde), steht im Ergebnis, nicht
 * versteckt.
 *
 * **Die Regel wird gebaut, nicht getippt.** Wochentage werden zu
 * `FREQ=WEEKLY;BYDAY=…`, gelesen vom selben Parser wie der Generator; ein
 * Anker steht nie in der Regel (`turnus_rrule_ohne_anker`). Was der Parser
 * nicht liest, wird nicht gespeichert.
 */
export class SerieEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'SerieEingabeFehlt';
  }
}

export type Feiertagsregel = 'ausfall' | 'unveraendert';

export interface TurnusSerieEingabe {
  readonly revierId: string;
  readonly leistungskatalogPositionId: string;
  readonly bezeichnung: string;
  readonly wochentage: readonly string[];
  /** Wanduhr `HH:MM`, Europe/Berlin. */
  readonly beginnLokal: string;
  readonly dauerMinuten: number;
  readonly gueltigAb: string;
  readonly gueltigBis?: string | null;
  readonly feiertagsregel: Feiertagsregel;
}

export interface PlanungsserieEingabe {
  readonly quelle: 'turnus' | 'posten';
  readonly traegerId: string;
  readonly feiertageUeberspringen: boolean;
  readonly bundesland?: string;
  readonly horizontTage?: number;
}

export interface SerienErgebnis {
  readonly planungsserieId: string;
  readonly traegerId: string;
  /** `true`, wenn die Serie schon bestand und nur der Generator lief. */
  readonly bestandSchon: boolean;
  readonly erzeugt: number;
  readonly aktualisiert: number;
  readonly uebersprungen: readonly { readonly quellSchluessel: string; readonly grund: string }[];
  readonly generiertBis: string | null;
}

const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/u;
const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Wochentage → `FREQ=WEEKLY;BYDAY=MO,WE,FR` — in Wochenreihenfolge, ohne
 * Doppelte, ohne Anker. Unbekannte Kuerzel sind ein Fehler, keine Auslassung.
 */
export function wochenRegel(tage: readonly string[]): string {
  const gewaehlt = new Set<Wochentag>();
  for (const t of tage) {
    const kuerzel = t.trim().toUpperCase();
    if (!(WOCHENTAGE as readonly string[]).includes(kuerzel)) {
      throw new SerieEingabeFehlt(`"${t}" ist kein Wochentag (MO … SU).`);
    }
    gewaehlt.add(kuerzel as Wochentag);
  }
  if (gewaehlt.size === 0) throw new SerieEingabeFehlt('Mindestens ein Wochentag.');
  const geordnet = WOCHENTAGE.filter((w) => gewaehlt.has(w));
  const regel = `FREQ=WEEKLY;BYDAY=${geordnet.join(',')}`;
  leseRegel(regel);
  return regel;
}

function pruefeTurnusEingabe(e: TurnusSerieEingabe): { rrule: string; gueltigBis: string | null } {
  if (e.bezeichnung.trim() === '') throw new SerieEingabeFehlt('Eine Serie braucht eine Bezeichnung.');
  if (!UHRZEIT.test(e.beginnLokal)) throw new SerieEingabeFehlt('Der Beginn ist eine Uhrzeit HH:MM.');
  if (!Number.isInteger(e.dauerMinuten) || e.dauerMinuten < 15 || e.dauerMinuten > 1440) {
    throw new SerieEingabeFehlt('Die Dauer liegt zwischen 15 Minuten und 24 Stunden.');
  }
  if (!DATUM.test(e.gueltigAb)) throw new SerieEingabeFehlt('„Gültig ab" ist ein Datum.');
  const gueltigBis = e.gueltigBis === undefined || e.gueltigBis === null || e.gueltigBis === '' ? null : e.gueltigBis;
  if (gueltigBis !== null && (!DATUM.test(gueltigBis) || gueltigBis < e.gueltigAb)) {
    throw new SerieEingabeFehlt('„Gültig bis" ist ein Datum nach „Gültig ab".');
  }
  if (e.feiertagsregel !== 'ausfall' && e.feiertagsregel !== 'unveraendert') {
    throw new SerieEingabeFehlt('Die Feiertagsregel ist „ausfall" oder „unveraendert".');
  }
  return { rrule: wochenRegel(e.wochentage), gueltigBis };
}

/** Turnus (Reinigung) anlegen und sofort als Serie planen. */
export async function legeTurnusSerieAn(
  kontext: SchreibKontext, e: TurnusSerieEingabe,
): Promise<SerienErgebnis> {
  const { rrule, gueltigBis } = pruefeTurnusEingabe(e);
  const [turnus] = await kontext.schreibe<{ id: string }>(
    `insert into turnus
       (mandant_id, revier_id, leistungskatalog_position_id, bezeichnung, rrule, dtstart_lokal,
        dauer_minuten, feiertagsregel, gueltig_ab, gueltig_bis, erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, ($6 || ' ' || $7)::timestamp,
             $8::integer, $9::turnus_feiertagsregel, $6::date, $10::date, 'mensch', $11::uuid)
     returning id`,
    [kontext.aktiverMandantId, e.revierId, e.leistungskatalogPositionId, e.bezeichnung.trim(), rrule,
      e.gueltigAb, e.beginnLokal, e.dauerMinuten, e.feiertagsregel, gueltigBis, kontext.benutzerId]);
  if (turnus === undefined) {
    throw new SerieEingabeFehlt(
      'Der Turnus wurde nicht angelegt — das Revier oder die Leistung gehört nicht zu dieser Gesellschaft.');
  }
  return legePlanungsserieAn(kontext, {
    quelle: 'turnus', traegerId: turnus.id, feiertageUeberspringen: e.feiertagsregel === 'ausfall',
  });
}

/**
 * Die Serie zu einem Traeger — und der Generator, sofort.
 *
 * Besteht zu diesem Traeger schon eine aktive Serie, entsteht keine zweite:
 * zwei Serien auf einen Turnus waeren doppelte Schichten. Dann laeuft nur
 * der Generator, und das Ergebnis sagt es.
 */
export async function legePlanungsserieAn(
  kontext: SchreibKontext, e: PlanungsserieEingabe,
): Promise<SerienErgebnis> {
  const bundesland = e.bundesland ?? 'BE';
  if (!/^[A-Z]{2}$/u.test(bundesland)) throw new SerieEingabeFehlt('Das Bundesland ist ein Kürzel wie BE.');
  const horizont = e.horizontTage ?? 56;
  if (!Number.isInteger(horizont) || horizont < 1 || horizont > 400) {
    throw new SerieEingabeFehlt('Der Horizont liegt zwischen 1 und 400 Tagen.');
  }
  const spalte = e.quelle === 'turnus' ? 'turnus_id' : 'posten_id';

  const [vorhanden] = await kontext.abfrage<{ id: string }>(
    `select id from planungsserie where ${spalte} = $1::uuid and archiviert_am is null limit 1`,
    [e.traegerId]);
  let planungsserieId: string;
  if (vorhanden !== undefined) {
    planungsserieId = vorhanden.id;
  } else {
    const [neu] = await kontext.schreibe<{ id: string }>(
      `insert into planungsserie
         (mandant_id, ${spalte}, quelle, zeitzone, feiertage_ueberspringen, feiertag_bundesland,
          horizont_tage, erstellt_von_art, erstellt_von)
       values ($1::uuid, $2::uuid, $3::einsatz_quelle, 'Europe/Berlin', $4::boolean, $5, $6::integer,
               'mensch', $7::uuid)
       returning id`,
      [kontext.aktiverMandantId, e.traegerId, e.quelle, e.feiertageUeberspringen, bundesland, horizont,
        kontext.benutzerId]);
    if (neu === undefined) {
      throw new SerieEingabeFehlt(
        'Die Serie wurde nicht angelegt — der Träger gehört nicht zu dieser Gesellschaft, oder die Sitzung darf hier nicht schreiben.');
    }
    planungsserieId = neu.id;
  }

  const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
  const berichte: readonly SerienBericht[] = await generiereEinsaetze(
    { unsafe: (sql, werte) => kontext.schreibe<unknown>(sql, werte) },
    kontext.aktiverMandantId, { heute: heute?.tag ?? '2026-01-01', laufId: null }, { eigen: true });
  const bericht = berichte.find((b) => b.planungsserieId === planungsserieId);

  await kontext.schreibe(
    `select app.protokolliere('dienstplan.serie_angelegt', 'planungsserie', $1, null, $2::jsonb, app.aktiver_mandant())`,
    /* Ein Objekt, kein JSON-Text (D-467). */
    [planungsserieId, { quelle: e.quelle, traegerId: e.traegerId, bestandSchon: vorhanden !== undefined,
      erzeugt: bericht?.erzeugt ?? 0, uebersprungen: bericht?.uebersprungen.length ?? 0 }]);

  return {
    planungsserieId, traegerId: e.traegerId, bestandSchon: vorhanden !== undefined,
    erzeugt: bericht?.erzeugt ?? 0, aktualisiert: bericht?.aktualisiert ?? 0,
    uebersprungen: bericht?.uebersprungen ?? [], generiertBis: bericht?.generiertBis ?? null,
  };
}
