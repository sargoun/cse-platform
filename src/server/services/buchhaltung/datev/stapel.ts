import 'server-only';

/**
 * **Der Stapel bekommt seinen Vermerk** (V-027, ACC-02, §9.4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `datev_export_status` kennt seit `0133` drei Werte — `erzeugt`,
 * `uebergeben`, `verworfen`. Der CHECK `datev_export_status_stimmig` hält
 * Zustand und Stempel zusammen, `fin.datev_export_unveraenderlich` lässt
 * ausdrücklich genau diese Spalten beweglich, und die Einzelseite zeigt
 * „Übergeben" und den Verwerfungsgrund an. **Gesetzt hat beides nie jemand:**
 * jeder Stapel steht auf `erzeugt`, für immer.
 *
 * Das ist nicht kosmetisch. Die Liste beantwortet damit die einzige Frage,
 * für die sie da ist — welcher Monat ist beim Steuerbüro und welcher nicht —
 * gar nicht, und ein zweiter Stapel über denselben Zeitraum sieht aus wie der
 * erste.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier NICHT passiert.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Es wird nichts gesendet. Es gibt keinen DATEV-Endpunkt und keine
 * Zugangsdaten (O-05); wer die Datei dem Steuerbüro gibt, ist ein Mensch, und
 * was hier entsteht, ist SEIN Vermerk darüber — mit seinem Namen und der
 * Serveruhr daneben. Ein Knopf „an DATEV senden" wäre die erfundene
 * Integration, die CLAUDE.md verbietet.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Beide Wege führen nur aus `erzeugt` heraus — und das ist eine Aussage.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Stapel, der beim Steuerbüro liegt, ist übergeben worden. Ihn später auf
 * „verworfen" zu stellen, weil das Büro ihn zurückweist, schriebe um, was
 * geschehen IST. Der ehrliche Weg ist der, den die Tabelle ohnehin vorsieht:
 * der alte Stapel bleibt übergeben, und für denselben Zeitraum entsteht ein
 * neuer — `datev_export` führt keine Eindeutigkeit über den Zeitraum, genau
 * dafür.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class StapelFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'nicht_offen' | 'grund_zu_kurz' | 'abgewiesen',
  readonly status = 409) {
    super(nachricht);
    this.name = 'StapelFehler';
  }
}

/**
 * Fünf Zeichen — dieselbe Schranke wie im CHECK.
 *
 * Sie steht hier ZUSÄTZLICH und nicht statt dessen: die Datenbank antwortet
 * mit `violates check constraint "datev_export_status_stimmig"`, und das ist
 * kein Satz, den ein Mensch lesen soll.
 */
export const GRUND_MINDESTLAENGE = 5;

/** Die Handlungen, die es gibt — als Menge, damit eine Route sie prüfen kann. */
export const STAPEL_VERMERKE = ['uebergeben', 'verworfen'] as const;
export type StapelVermerk = (typeof STAPEL_VERMERKE)[number];

export function istStapelVermerk(wert: string): wert is StapelVermerk {
  return (STAPEL_VERMERKE as readonly string[]).includes(wert);
}

interface StandZeile {
  readonly id: string;
  readonly status: string;
}

async function offenerStapel(db: Abfrage, stapelId: string): Promise<StandZeile> {
  const [z] = await db.abfrage<StandZeile>(
    `select id, status::text as status from datev_export
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [stapelId]);
  if (z === undefined) {
    throw new StapelFehler(
      'Diesen Buchungsstapel gibt es in dieser Gesellschaft nicht.', 'nicht_gefunden', 404);
  }
  if (z.status !== 'erzeugt') {
    throw new StapelFehler(
      z.status === 'uebergeben'
        ? 'Dieser Stapel ist bereits als übergeben vermerkt. Was übergeben wurde, wird '
          + 'nicht nachträglich verworfen — für denselben Zeitraum entsteht ein neuer Stapel.'
        : 'Dieser Stapel ist verworfen. Er bekommt keinen weiteren Vermerk.',
      'nicht_offen');
  }
  return z;
}

/**
 * „Ich habe die Datei dem Steuerbüro gegeben."
 *
 * Die ZEIT kommt aus der Datenbank (`now()`), nicht aus dem Browser
 * (Invariante 5): der Vermerk ist ein Beleg, und ein Beleg mit der Uhrzeit
 * eines fremden Geräts belegt nichts.
 */
export async function vermerkeUebergabe(
  db: Abfrage, stapelId: string, notiz: string | null,
): Promise<void> {
  await offenerStapel(db, stapelId);
  const text = (notiz ?? '').trim();
  const [z] = await db.schreibe<{ id: string }>(
    `update datev_export
        set status = 'uebergeben',
            uebergeben_am = now(),
            uebergeben_notiz = $2,
            geaendert_von = app.aktueller_benutzer(),
            geaendert_von_art = 'mensch'
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and status = 'erzeugt'
      returning id`,
    [stapelId, text === '' ? null : text]);
  /*
   * Ein von RLS abgewiesenes UPDATE gibt NULL Zeilen zurück und wirft nicht —
   * anders als ein INSERT. Ohne diese Zeile meldete die Seite „vermerkt", und
   * nichts wäre geschehen.
   */
  if (z === undefined) {
    throw new StapelFehler(
      'Der Vermerk wurde abgewiesen — fehlt buchhaltung.exportieren in dieser '
      + 'Gesellschaft?', 'abgewiesen', 403);
  }
}

/**
 * „Diese Datei geht nicht ans Steuerbüro."
 *
 * **Mit Grund, und der Grund ist Pflicht.** Ein verworfener Stapel ohne Grund
 * ist eine Lücke in der Reihe: der Monat ist exportiert worden und doch nicht
 * beim Büro, und in drei Jahren weiss niemand mehr, warum. Der CHECK verlangt
 * fünf Zeichen; dass daraus ein Satz wird, verlangt die Oberfläche.
 */
export async function verwirfStapel(
  db: Abfrage, stapelId: string, grund: string,
): Promise<void> {
  await offenerStapel(db, stapelId);
  const text = grund.trim();
  if (text.length < GRUND_MINDESTLAENGE) {
    throw new StapelFehler(
      `Ein verworfener Stapel braucht einen Grund — mindestens ${
        String(GRUND_MINDESTLAENGE)} Zeichen. „Falsch" ist keiner, „Zeitraum falsch `
      + 'gewählt" ist einer.', 'grund_zu_kurz', 400);
  }
  const [z] = await db.schreibe<{ id: string }>(
    `update datev_export
        set status = 'verworfen',
            verworfen_am = now(),
            verwerfungsgrund = $2,
            geaendert_von = app.aktueller_benutzer(),
            geaendert_von_art = 'mensch'
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and status = 'erzeugt'
      returning id`,
    [stapelId, text]);
  if (z === undefined) {
    throw new StapelFehler(
      'Das Verwerfen wurde abgewiesen — fehlt buchhaltung.exportieren in dieser '
      + 'Gesellschaft?', 'abgewiesen', 403);
  }
}
