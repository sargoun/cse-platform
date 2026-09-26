import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { parseGeld, type Cent } from '../finanz/geld.js';

/**
 * **Das Monatsbudget eines Agenten setzen** (V-015, AGT-05, Invariante 1,
 * O-26, O-195).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0128` baut die ganze Kostenmechanik: Preisliste, Reservierung, Verbrauch
 * in Mikrocent, Hartstopp, Stoppmeldung an die richtigen Menschen.
 * `/agenten/budget` zeigt sie. **Und die eine Zahl, ohne die nichts davon je
 * anspringt, konnte niemand eintragen** — `budget_cent` blieb NULL, und
 * `app.agent_budget_pruefen` antwortet darauf mit `budget_fehlt`: kein Agent
 * läuft.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Drei Regeln, die hier und nicht in der Oberfläche stehen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Geld ist ganzzahliger Cent** (Invariante 1). Die Eingabe kommt in
 * Euro und läuft durch `parseGeld` — dieselbe geprüfte Funktion, die jede
 * Rechnung dieser Plattform liest. Kein `Number`, kein `parseFloat`: eine
 * Obergrenze, die um einen halben Cent danebenliegt, ist eine Obergrenze,
 * die irgendwann um einen halben Cent zu spät greift.
 *
 * **2. Eine gesetzte Grenze wird nicht wieder zu „nicht entschieden".**
 * `budget_cent is null` heisst „niemand hat entschieden" — eine Tatsache
 * über einen Zustand der Einrichtung, nicht ein Wert. Wer nichts mehr
 * ausgeben will, trägt `0,00 €` ein; das ist eine Entscheidung und sieht
 * auch wie eine aus. Zurück auf NULL wäre das Löschen einer Entscheidung.
 *
 * **3. Die HÖHE erfindet diese Datei nicht.** O-26 (welches Monatsbudget je
 * Gesellschaft und je Agent?) und O-195 (ab welchem Anteil wird gewarnt?)
 * bleiben offen; es gibt keinen Vorgabewert, und die Maske schlägt keinen
 * vor. Ein Vorschlag in einer Finanzmaske sieht aus wie eine Abstimmung.
 * Was ein Mensch einträgt, setzt `ist_platzhalter` auf `false` — ab da ist
 * die Zeile entschieden und wird nicht mehr als geraten gefärbt (§1.16).
 */
/**
 * Die Auditaktion als benannte Konstante — sie steht nicht als Literal in
 * `app.protokolliere(…)`, und das Präfix `AUDIT_` sagt dem Katalogscanner,
 * in welches Register der Wert gehört (`scripts/katalog/benutzung.ts` (4c)).
 */
const AUDIT_GESETZT = 'agent.budget_gesetzt';

export class BudgetFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'unvollstaendig' | 'kein_betrag' | 'negativ' | 'zeitraum'
      | 'schwelle' | 'kein_agent' | 'abgewiesen',
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'BudgetFehler';
  }
}

export interface BudgetEingabe {
  /** `mandant`: die Gesellschaft insgesamt. `agent`: ein einzelner Agent. */
  readonly bereich: 'mandant' | 'agent';
  readonly agentId?: string | null;
  readonly jahr: number;
  readonly monat: number;
  /** In Euro, deutsche Schreibweise — `parseGeld` liest sie. */
  readonly budgetEuro: string;
  readonly stoppBeiUeberschreitung: boolean;
  /** 1…100, oder leer: dann bleibt sie offen (O-195). */
  readonly warnschwelleProzent?: number | null;
}

/**
 * Der Eurobetrag als ganze Cent — über die geprüfte Geldfunktion.
 *
 * Getrennt und exportiert, damit die Regel ohne Datenbank prüfbar ist.
 * **Negativ ist draussen**, und das ist hier keine Formsache: `parseGeld`
 * nimmt negatives Geld an (eine Gutschrift IST negativ), eine Obergrenze von
 * minus zehn Euro ist dagegen eine Grenze, die jeder Verbrauch von Anfang an
 * reisst — ohne dass jemand das gemeint hätte.
 *
 * **Null ist drin.** `0,00 €` heisst „diese Gesellschaft gibt in diesem Monat
 * nichts aus", und das ist eine gültige Entscheidung — im Gegensatz zu NULL,
 * das „niemand hat entschieden" heisst.
 */
export function budgetInCent(eingabe: string): Cent {
  let betrag: Cent;
  try {
    betrag = parseGeld(eingabe);
  } catch {
    throw new BudgetFehler(
      `Das ist kein Betrag in deutscher Schreibweise: ${JSON.stringify(eingabe)}. `
      + 'Punkt trennt die Tausender, Komma die Cent — „1.250,00".', 'kein_betrag');
  }
  if ((betrag as bigint) < 0n) {
    throw new BudgetFehler(
      'Eine Obergrenze ist nicht negativ. Wer nichts ausgeben will, trägt '
      + '0,00 € ein — das ist eine Entscheidung und sieht auch so aus.', 'negativ');
  }
  return betrag;
}

/** Jahr und Monat, wie die Spalten sie verlangen (CHECK in `0128`). */
export function pruefeZeitraum(jahr: number, monat: number): void {
  if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100
    || !Number.isInteger(monat) || monat < 1 || monat > 12) {
    throw new BudgetFehler(
      'Jahr und Monat gehören zu einem Monat zwischen 2000 und 2100.', 'zeitraum');
  }
}

/**
 * Setzen — anlegen oder überschreiben, in EINER Anweisung.
 *
 * **`on conflict` auf die beiden PARTIELLEN Indizes.** `0128` legt zwei an:
 * `ab_agent_uk (mandant_id, agent_id, jahr, monat) where geltungsbereich =
 * 'agent'` und `ab_mandant_uk (mandant_id, jahr, monat) where
 * geltungsbereich = 'mandant'`. Ein Upsert muss den passenden benennen —
 * zwei Anweisungen, weil `on conflict` keine Fallunterscheidung kennt.
 *
 * Zwei Formulare, die denselben Monat gleichzeitig speichern, laufen damit
 * in den Index und nicht in eine zweite Zeile; das ist der Grund, warum hier
 * kein „erst lesen, dann schreiben" steht.
 */
/**
 * Ein abgewiesener Schreibversuch als Satz statt als `PostgresError`.
 *
 * Die Policy auf `agent_budget` (0385) verlangt `agent.budget_verwalten`;
 * wer sie reisst, bekam „new row violates row-level security policy" — ein
 * 500er mit einem Satz aus der Tiefe, wo „dir fehlt dieses Recht, und zwar
 * aus diesem Grund" die Wahrheit ist.
 */
async function schreibeOderSatz<T>(lauf: Promise<readonly T[]>): Promise<readonly T[]> {
  try {
    return await lauf;
  } catch (fehler: unknown) {
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    if (text.includes('row-level security') || text.includes('row level security')) {
      throw new BudgetFehler(
        'Das Budget wurde nicht gesetzt — fehlt `agent.budget_verwalten` in dieser '
        + 'Gesellschaft? Es ist ausdrücklich NICHT dasselbe Recht wie das Starten '
        + 'einer Agentenaufgabe: wer begrenzt wird, verstellt seine Grenze nicht '
        + 'selbst (AGT-05).', 'abgewiesen', 403);
    }
    throw fehler;
  }
}

export async function setzeBudget(
  kontext: SchreibKontext, e: BudgetEingabe,
): Promise<{ readonly budgetId: string; readonly cent: Cent }> {
  pruefeZeitraum(e.jahr, e.monat);
  const cent = budgetInCent(e.budgetEuro);

  const schwelle = e.warnschwelleProzent ?? null;
  if (schwelle !== null
    && (!Number.isInteger(schwelle) || schwelle < 1 || schwelle > 100)) {
    throw new BudgetFehler(
      'Die Warnschwelle ist ein Anteil zwischen 1 und 100 Prozent — oder sie bleibt '
      + 'leer, solange niemand sie entschieden hat (O-195).', 'schwelle');
  }
  if (e.bereich === 'agent' && (e.agentId ?? null) === null) {
    throw new BudgetFehler(
      'Ein Budget je Agent braucht den Agenten.', 'kein_agent');
  }
  if (e.bereich === 'mandant' && (e.agentId ?? null) !== null) {
    throw new BudgetFehler(
      'Ein Budget der Gesellschaft nennt keinen Agenten — `ab_bereich_stimmig` '
      + 'liesse die Zeile ohnehin nicht zu.', 'unvollstaendig');
  }

  const ziel = e.bereich === 'agent'
    ? '(mandant_id, agent_id, jahr, monat) where geltungsbereich = \'agent\''
    : '(mandant_id, jahr, monat) where geltungsbereich = \'mandant\'';

  /*
   * **Ein INSERT, den die Policy abweist, wirft — er gibt nicht null Zeilen
   * zurueck.** Das ist der Unterschied zwischen INSERT und UPDATE, und er
   * kostete hier beinahe einen 500er: der Zweig unten (`z === undefined`)
   * faengt nur den Fall, dass die Anweisung durchlaeuft und nichts trifft.
   * Der Test hat es gefunden.
   */
  const [z] = await schreibeOderSatz(kontext.schreibe<{ id: string }>(
    `insert into agent_budget
       (mandant_id, geltungsbereich, agent_id, jahr, monat, budget_cent,
        stopp_bei_ueberschreitung, warnschwelle_prozent, ist_platzhalter,
        erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::budget_geltungsbereich, $3::uuid, $4::integer, $5::integer,
             $6::bigint, $7::boolean, $8::integer, false, 'mensch'::akteur_art, $9::uuid)
     on conflict ${ziel} do update set
        budget_cent               = excluded.budget_cent,
        stopp_bei_ueberschreitung = excluded.stopp_bei_ueberschreitung,
        warnschwelle_prozent      = excluded.warnschwelle_prozent,
        /* Eine entschiedene Zeile wird nicht wieder zur geratenen. */
        ist_platzhalter           = false,
        /* **Der Stopp faellt mit der neuen Grenze.** Sonst bliebe eine
           Gesellschaft gestoppt, deren Budget gerade erhoeht wurde — und
           niemand faende den Grund, weil die Zahl daneben stimmt. Der
           naechste Lauf setzt ihn neu, wenn die neue Grenze auch reisst. */
        status                    = 'aktiv'::budget_status,
        gestoppt_am               = null,
        gewarnt_am                = null,
        geaendert_von_art         = 'mensch'::akteur_art,
        geaendert_von             = excluded.erstellt_von
     returning id`,
    [kontext.aktiverMandantId, e.bereich, e.agentId ?? null, e.jahr, e.monat,
      (cent as bigint).toString(), e.stoppBeiUeberschreitung, schwelle,
      kontext.benutzerId]));

  if (z === undefined) {
    throw new BudgetFehler(
      'Das Budget wurde nicht gesetzt — fehlt `agent.budget_verwalten` in dieser '
      + 'Gesellschaft? Es ist ausdrücklich NICHT dasselbe Recht wie das Starten '
      + 'einer Agentenaufgabe: wer begrenzt wird, verstellt seine Grenze nicht '
      + 'selbst (AGT-05).', 'abgewiesen', 403);
  }

  await kontext.schreibe(
    `select app.protokolliere($1, 'agent_budget', $2, null, $3::jsonb, app.aktiver_mandant())`,
    /* Das OBJEKT, nicht sein JSON-Text (D-467). */
    [AUDIT_GESETZT, z.id, {
      bereich: e.bereich, jahr: e.jahr, monat: e.monat,
      budgetCent: (cent as bigint).toString(),
      stopp: e.stoppBeiUeberschreitung, warnschwelle: schwelle,
    }]);

  return { budgetId: z.id, cent };
}
