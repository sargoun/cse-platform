import 'server-only';
import { normalisiereTelefon } from '../../../lib/telefon.js';

/**
 * **Den Telefonzugang einer Mitarbeiterin einrichten, umschreiben, sperren
 * und entsperren** (V-014, EMP-01, EMP-14, AUT-08, D-09).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0113` legt `mitarbeiter_zugang` an, `0114` meldet damit an, `0130` bremst
 * das Raten, `0143` stellt den Code aus der Hand der Einsatzleitung aus,
 * `0144` zeigt den Stand. Fünf Migrationen um eine Zeile herum — **und diese
 * Zeile entstand nirgends ausser im Seed.**
 *
 * Wer nach dem Seed eingestellt wird, hat keine Nummer hinterlegt. Die
 * Zugangsseite sagte ihm: „die Super-Administration trägt die Nummer an der
 * Person ein." Die konnte das nicht: `person.telefon` ist ein Feld der
 * Personalakte, angemeldet wird mit `mitarbeiter_zugang.telefon_e164`, und
 * für die zweite Spalte gab es keinen Schreibweg.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Vier Regeln, die hier und nicht in der Oberfläche stehen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Die Nummer wird normalisiert, bevor sie irgendwo hingeht.**
 * `0170 1234567`, `+49 170 1234567` und `0049-170-1234567` sind dieselbe
 * Nummer; ohne `normalisiereTelefon` legte jede Schreibweise einen eigenen
 * Zugang an und `unique (telefon_e164)` hielte nichts mehr zusammen. Die
 * Regel liegt in `lib/telefon.ts` und hat genau eine Fassung.
 *
 * **2. Ein Zugang wechselt nie den Menschen.** `person_id` steht nicht im
 * Spaltenrecht (0113) und nicht in diesem Dienst. Wer sich vertan hat,
 * sperrt und legt neu an; die alte Zeile bleibt als Spur stehen.
 *
 * **3. Die Sperre wirkt sofort und auch auf offene Codes.**
 * `app.zugang_code_einloesen` (0114) sucht den Zugang mit
 * `gesperrt_am is null` — ein Code, der vor der Sperre ausgestellt wurde,
 * ist mit ihr wertlos. Das Umschreiben der Nummer tut das NICHT: ein offener
 * Code hängt an der Zugangszeile, nicht an der Nummer, und bleibt bis zu
 * seinem Ablauf für die neue Nummer einlösbar. Beides steht so in der
 * Oberfläche.
 *
 * **4. Der Handelnde kommt aus der Sitzung, nie aus dem Formular.**
 * `app.aktueller_benutzer()` — dieselbe Quelle wie in jedem anderen Dienst.
 * `0384` erteilt dafür die zwei Spaltenrechte, die `0113` aus einer falschen
 * Annahme heraus nicht erteilt hat (es gab keinen Audit-Trigger, der sie
 * gefüllt hätte); seit `0384` gibt es ihn, und er schreibt `audit_log`, nicht
 * die Zeile.
 */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type ZugangGrund =
  | 'keine_nummer'
  | 'nummer_vergeben'
  | 'schon_vorhanden'
  | 'kein_zugang'
  | 'keine_anstellung'
  | 'unveraendert'
  | 'schon_gesperrt'
  | 'nicht_gesperrt'
  | 'grund_fehlt'
  | 'abgewiesen';

export class ZugangFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: ZugangGrund,
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'ZugangFehler';
  }
}

/**
 * Die Nummer, oder ein Satz darüber, warum sie keine ist.
 *
 * Getrennt und exportiert, damit die Regel ohne Datenbank prüfbar ist: eine
 * Nummer, die durchrutscht, ist entweder ein Zugang, der nie ankommt, oder —
 * schlimmer — ein zweiter Zugang für denselben Menschen unter einer zweiten
 * Schreibweise.
 */
export function nummerOderFehler(roh: string): string {
  const e164 = normalisiereTelefon(roh);
  if (e164 === null) {
    throw new ZugangFehler(
      'Das ist keine Mobilnummer, die sich eindeutig lesen lässt. Schreiben Sie '
      + 'sie mit führender Null (0170 1234567) oder international (+49 170 1234567) — '
      + 'eine Nummer ohne beides könnte deutsch oder ausländisch sein, und die '
      + 'Plattform rät nicht.',
      'keine_nummer');
  }
  return e164;
}

/** Was `23505` meint — die beiden eindeutigen Spalten dieser Tabelle. */
function ausEindeutig(fehler: unknown): never {
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  if (text.includes('telefon_e164')) {
    throw new ZugangFehler(
      'Diese Mobilnummer ist schon der Zugang eines anderen Menschen. Zwei '
      + 'Menschen unter einer Nummer wären ein Konto, in das beide kommen — '
      + 'darum lässt die Datenbank es nicht zu. Klären Sie, wem die Nummer '
      + 'gehört, und sperren Sie den alten Zugang, bevor Sie sie neu vergeben.',
      'nummer_vergeben', 409);
  }
  if (text.includes('person_id')) {
    throw new ZugangFehler(
      'Dieser Mensch hat schon einen Zugang. Ändern Sie die Nummer, statt '
      + 'einen zweiten danebenzustellen — ein Mensch, ein Login (EMP-14).',
      'schon_vorhanden', 409);
  }
  throw fehler;
}

/** Ein Schreibversuch, den die Policy abgewiesen hat, als Satz. */
function ausPolicy(fehler: unknown): never {
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  if (text.includes('row-level security') || text.includes('row level security')) {
    throw new ZugangFehler(
      'Dieser Mensch ist in dieser Gesellschaft nicht beschäftigt — für einen '
      + 'Fremden richtet diese Gesellschaft keinen Zugang ein. Legen Sie erst '
      + 'die Anstellung an.',
      'keine_anstellung', 403);
  }
  throw fehler;
}

/**
 * Einrichten.
 *
 * Die Beschäftigung wird ZWEIMAL geprüft: hier, damit der Satz den Menschen
 * erreicht, und in `t_zugang_anlegen` (0384), damit die Regel auch dann hält,
 * wenn morgen ein zweiter Aufrufer diesen Dienst vergisst. RLS ist die zweite
 * Linie, nie die einzige und nie die fehlende (Invariante 3).
 */
export async function richteZugangEin(
  db: Abfrage, personId: string, rohesTelefon: string,
): Promise<string> {
  const e164 = nummerOderFehler(rohesTelefon);

  const [a] = await db.abfrage<{ eins: number }>(
    `select 1 as eins from anstellung
      where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
        and geloescht_am is null
      limit 1`, [personId]);
  if (a === undefined) {
    throw new ZugangFehler(
      'Dieser Mensch ist in dieser Gesellschaft nicht beschäftigt. Ein Zugang '
      + 'hängt am Menschen (D-09), eingerichtet wird er aber von der '
      + 'Gesellschaft, die ihn beschäftigt.', 'keine_anstellung', 403);
  }

  try {
    const [z] = await db.abfrage<{ id: string }>(
      `insert into mitarbeiter_zugang (person_id, telefon_e164, erstellt_von)
       values ($1::uuid, $2, app.aktueller_benutzer())
       returning id`, [personId, e164]);
    if (z === undefined) {
      throw new ZugangFehler(
        'Der Zugang wurde nicht angelegt — fehlt `personal.zugang_verwalten` in '
        + 'dieser Gesellschaft?', 'abgewiesen', 403);
    }
    return z.id;
  } catch (fehler: unknown) {
    if (fehler instanceof ZugangFehler) throw fehler;
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    if (text.includes('duplicate key') || text.includes('23505')) ausEindeutig(fehler);
    ausPolicy(fehler);
  }
}

/**
 * Die Nummer umschreiben — der teuerste Knopf auf dieser Seite.
 *
 * **Wer die Nummer hat, bekommt den Code.** Ein Umschreiben ist deshalb
 * fachlich eine Kontoübergabe, und seit `0384` steht sie mit Vorher und
 * Nachher im Protokoll. Ob dafür ein zweites Augenpaar verlangt wird, ist
 * NICHT entschieden — siehe O-86; die Oberfläche sagt das hin, statt eine
 * Regel zu erfinden.
 *
 * Die alte Nummer wird verglichen, ohne sie nach Node zu holen: sie ist ein
 * personenbezogenes Datum, und der Vergleich gehört dorthin, wo sie liegt.
 */
export async function aendereZugangsnummer(
  db: Abfrage, personId: string, rohesTelefon: string,
): Promise<void> {
  const e164 = nummerOderFehler(rohesTelefon);

  const [stand] = await db.abfrage<{ gleich: boolean }>(
    `select (telefon_e164 = $2) as gleich from mitarbeiter_zugang
      where person_id = $1::uuid`, [personId, e164]);
  if (stand === undefined) {
    throw new ZugangFehler(
      'Für diesen Menschen gibt es keinen Zugang, dessen Nummer sich ändern '
      + 'liesse. Richten Sie ihn zuerst ein.', 'kein_zugang', 404);
  }
  if (stand.gleich) {
    throw new ZugangFehler(
      'Das ist die Nummer, die schon hinterlegt ist. Nichts geändert.',
      'unveraendert', 409);
  }

  try {
    const zeilen = await db.abfrage<{ id: string }>(
      `update mitarbeiter_zugang
          set telefon_e164 = $2, geaendert_von = app.aktueller_benutzer()
        where person_id = $1::uuid
        returning id`, [personId, e164]);
    if (zeilen.length === 0) {
      throw new ZugangFehler(
        'Die Nummer wurde nicht geändert — fehlt `personal.zugang_verwalten` in '
        + 'dieser Gesellschaft?', 'abgewiesen', 403);
    }
  } catch (fehler: unknown) {
    if (fehler instanceof ZugangFehler) throw fehler;
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    if (text.includes('duplicate key') || text.includes('23505')) ausEindeutig(fehler);
    throw fehler;
  }
}

/**
 * Sperren — mit Grund, nie durch Löschen (Invariante 8, 0113).
 *
 * Der CHECK `zugang_sperre_stimmig` hält „beides oder keines" ohnehin; hier
 * steht es trotzdem, weil `(gesperrt_am is null) = (gesperrt_grund is null)`
 * kein Satz ist, den man einem Menschen zeigt.
 */
export async function sperreZugang(
  db: Abfrage, personId: string, grund: string,
): Promise<void> {
  if (grund.trim().length < 3) {
    throw new ZugangFehler(
      'Eine Sperre ohne Grund ist keine Auskunft — mindestens drei Zeichen. Sie '
      + 'beantwortet später die Frage, warum dieser Mensch nicht mehr ins '
      + 'Portal kommt: verlorenes Telefon, Austritt, Verdacht.', 'grund_fehlt');
  }

  const [stand] = await db.abfrage<{ gesperrt: boolean }>(
    `select (gesperrt_am is not null) as gesperrt from mitarbeiter_zugang
      where person_id = $1::uuid`, [personId]);
  if (stand === undefined) {
    throw new ZugangFehler(
      'Für diesen Menschen gibt es keinen Zugang, der sich sperren liesse.',
      'kein_zugang', 404);
  }
  if (stand.gesperrt) {
    throw new ZugangFehler('Dieser Zugang ist schon gesperrt.', 'schon_gesperrt', 409);
  }

  const zeilen = await db.abfrage<{ id: string }>(
    `update mitarbeiter_zugang
        set gesperrt_am = now(), gesperrt_grund = $2,
            geaendert_von = app.aktueller_benutzer()
      where person_id = $1::uuid and gesperrt_am is null
      returning id`, [personId, grund.trim()]);
  if (zeilen.length === 0) {
    throw new ZugangFehler(
      'Der Zugang wurde nicht gesperrt — fehlt `personal.zugang_verwalten` in '
      + 'dieser Gesellschaft?', 'abgewiesen', 403);
  }
}

/**
 * Entsperren.
 *
 * **Der alte Sperrgrund geht dabei verloren — und das ist seit `0384` kein
 * Verlust mehr.** Die Spalte muss leer werden, sonst schlägt
 * `zugang_sperre_stimmig` zu; was dort stand, steht im Protokoll unter
 * `vorher`. Vor `0384` wäre es spurlos verschwunden.
 */
export async function entsperreZugang(db: Abfrage, personId: string): Promise<void> {
  const [stand] = await db.abfrage<{ gesperrt: boolean }>(
    `select (gesperrt_am is not null) as gesperrt from mitarbeiter_zugang
      where person_id = $1::uuid`, [personId]);
  if (stand === undefined) {
    throw new ZugangFehler(
      'Für diesen Menschen gibt es keinen Zugang, der sich entsperren liesse.',
      'kein_zugang', 404);
  }
  if (!stand.gesperrt) {
    throw new ZugangFehler('Dieser Zugang ist nicht gesperrt.', 'nicht_gesperrt', 409);
  }

  const zeilen = await db.abfrage<{ id: string }>(
    `update mitarbeiter_zugang
        set gesperrt_am = null, gesperrt_grund = null,
            geaendert_von = app.aktueller_benutzer()
      where person_id = $1::uuid and gesperrt_am is not null
      returning id`, [personId]);
  if (zeilen.length === 0) {
    throw new ZugangFehler(
      'Der Zugang wurde nicht entsperrt — fehlt `personal.zugang_verwalten` in '
      + 'dieser Gesellschaft?', 'abgewiesen', 403);
  }
}
