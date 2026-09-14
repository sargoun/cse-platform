import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { alsKanonischerWert, fuerJsonb } from '../freigabe/diff-json.js';
import { KATEGORIEN, type Kategorie } from './kategorie.js';

/**
 * Die Aufbewahrungsregeln einer Gesellschaft — lesen und setzen (DOC-07,
 * LEG-01, PR 64, D-483).
 *
 * Je Kategorie gilt die Zeile der Gesellschaft, sonst die der Plattform
 * (`app.aufbewahrung_regel`, 0009). Setzen heisst: eine Zeile der
 * Gesellschaft anlegen oder aendern — nie die der Plattform, nie unter der
 * gesetzlichen Untergrenze. Die Untergrenzen stehen hier UND im Ausloeser
 * `kern.aufbewahrung_untergrenze` (0141): hier, damit der Satz fuer den
 * Menschen vor dem Schreiben kommt; dort, damit er auch ohne diesen Dienst
 * gilt.
 *
 * Eine gesetzte Regel gilt fuer Dokumente, die danach entstehen. Was schon
 * liegt, behaelt seine Frist — kuerzer wird sie ohnehin nie (0141).
 */
export interface AufbewahrungZeile {
  readonly kategorie: Kategorie;
  readonly jahre: number | null;
  readonly loeschsperre: boolean;
  readonly grundlage: string;
  readonly istPlatzhalter: boolean;
  readonly quelle: 'plattform' | 'gesellschaft';
  readonly geaendertAm: string | null;
}

/** Die gesetzlichen Untergrenzen in Jahren — § 147 AO, § 257 HGB; `null`: keine eine Zahl (O-25). */
export const UNTERGRENZE: Readonly<Record<Kategorie, number | null>> = {
  rechnung: 10, buchhaltung: 10, beleg: 10,
  vertrag: 6, angebot: 6, kunde: 6,
  mitarbeiter: null, projekt: null, unternehmen: null,
};

export class AufbewahrungFehler extends Error {
  constructor(nachricht: string, readonly grund: 'kategorie' | 'jahre' | 'untergrenze' | 'grundlage' | 'nicht_gesetzt') {
    super(nachricht);
    this.name = 'AufbewahrungFehler';
  }
}

interface RegelRoh {
  readonly kategorie: string;
  readonly jahre: number | null;
  readonly loeschsperre: boolean;
  readonly grundlage: string;
  readonly ist_platzhalter: boolean;
  readonly mandant_id: string | null;
  readonly geaendert_am: string | null;
}

interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export async function liesAufbewahrung(db: Abfrage): Promise<readonly AufbewahrungZeile[]> {
  const roh = await db.abfrage<RegelRoh>(
    `select kategorie, jahre, loeschsperre, grundlage, ist_platzhalter, mandant_id,
            to_char(geaendert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as geaendert_am
       from dokument_aufbewahrung
      where mandant_id is null or mandant_id = app.aktiver_mandant()`);
  const eigene = new Map(roh.filter((r) => r.mandant_id !== null).map((r) => [r.kategorie, r]));
  const plattform = new Map(roh.filter((r) => r.mandant_id === null).map((r) => [r.kategorie, r]));
  const aus: AufbewahrungZeile[] = [];
  for (const k of KATEGORIEN) {
    const r = eigene.get(k) ?? plattform.get(k);
    if (r === undefined) continue;
    aus.push({
      kategorie: k, jahre: r.jahre, loeschsperre: r.loeschsperre, grundlage: r.grundlage,
      istPlatzhalter: r.ist_platzhalter,
      quelle: r.mandant_id === null ? 'plattform' : 'gesellschaft',
      geaendertAm: r.geaendert_am,
    });
  }
  return aus;
}

export interface AufbewahrungSetzen {
  readonly kategorie: string;
  /** `null` laesst die Frist offen — dann bleibt die Sperre gesetzt (K-17). */
  readonly jahre: number | null;
  readonly loeschsperre: boolean;
  readonly grundlage: string;
}

export async function setzeAufbewahrung(
  kontext: SchreibKontext, e: AufbewahrungSetzen,
): Promise<AufbewahrungZeile> {
  if (!(KATEGORIEN as readonly string[]).includes(e.kategorie)) {
    throw new AufbewahrungFehler(`Unbekannte Kategorie „${e.kategorie}".`, 'kategorie');
  }
  const kategorie = e.kategorie as Kategorie;
  if (e.jahre !== null && (!Number.isInteger(e.jahre) || e.jahre < 0 || e.jahre > 30)) {
    throw new AufbewahrungFehler('Die Frist ist eine ganze Zahl von Jahren zwischen 0 und 30 — oder offen.', 'jahre');
  }
  const grundlage = e.grundlage.trim();
  if (grundlage.length < 5) {
    throw new AufbewahrungFehler('Die Rechtsgrundlage gehört in die Zeile — mindestens fünf Zeichen.', 'grundlage');
  }
  const min = UNTERGRENZE[kategorie];
  if (min !== null && (e.jahre === null || e.jahre < min)) {
    throw new AufbewahrungFehler(
      `Für „${kategorie}" gilt eine gesetzliche Mindestfrist von ${String(min)} Jahren (§ 147 AO, § 257 HGB) — `
      + 'länger ist möglich, kürzer nicht.', 'untergrenze');
  }
  /* Offene Frist heisst Sperre; die Finanzkategorien sind ohnehin gesperrt. */
  const loeschsperre = e.loeschsperre || e.jahre === null || (min !== null && min >= 10);

  const vorher = (await liesAufbewahrung(kontext)).find((z) => z.kategorie === kategorie) ?? null;
  const [z] = await kontext.schreibe<RegelRoh>(
    `insert into dokument_aufbewahrung
       (mandant_id, kategorie, jahre, loeschsperre, grundlage, ist_platzhalter, geaendert_von)
     values (app.aktiver_mandant(), $1, $2, $3, $4, false, app.aktueller_benutzer())
     on conflict (mandant_id, kategorie) do update
        set jahre = excluded.jahre, loeschsperre = excluded.loeschsperre,
            grundlage = excluded.grundlage, ist_platzhalter = false,
            geaendert_von = excluded.geaendert_von
     returning kategorie, jahre, loeschsperre, grundlage, ist_platzhalter, mandant_id,
               to_char(geaendert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as geaendert_am`,
    [kategorie, e.jahre, loeschsperre, grundlage]);
  if (z === undefined) {
    throw new AufbewahrungFehler('Die Regel wurde nicht gespeichert (kein Recht im aktiven Bereich?).', 'nicht_gesetzt');
  }
  const nachher: AufbewahrungZeile = {
    kategorie, jahre: z.jahre, loeschsperre: z.loeschsperre, grundlage: z.grundlage,
    istPlatzhalter: z.ist_platzhalter, quelle: 'gesellschaft', geaendertAm: z.geaendert_am,
  };
  const spur = (r: AufbewahrungZeile) => fuerJsonb(alsKanonischerWert({
    jahre: r.jahre, loeschsperre: r.loeschsperre, grundlage: r.grundlage, quelle: r.quelle,
  }));
  await kontext.schreibe(
    `select app.protokolliere('dokument.aufbewahrung_gesetzt', 'dokument_aufbewahrung', $1,
                              $2::jsonb, $3::jsonb, app.aktiver_mandant())`,
    [kategorie, vorher === null ? null : spur(vorher), spur(nachher)]);
  return nachher;
}
