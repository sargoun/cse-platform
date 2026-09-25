/**
 * Ein Bewerbungsgespräch nach dem Anlegen: absagen, verschieben, als geführt
 * vermerken (REC-06, CAL-01, V-220, D-714).
 *
 * **Der Befund.** `planeGespraech` legte an, und danach war das Gespräch fest:
 * `gespraech.status` blieb immer `geplant`. Kalender und iCal-Ausgang werten
 * `abgesagt` aus — einen Zustand, den kein Weg setzte. Ein abgesagter Termin
 * stand damit als lebender Termin im Kalender jedes Menschen, der ihn
 * abonniert hatte.
 *
 * **Drei Übergänge, alle nur aus `geplant`, und keiner zurück** (0471,
 * `kern.gespraech_weg`). Jeder schreibt mit der Bedingung IM `update`
 * (`status = 'geplant'`): zwei gleichzeitige Klicks — der eine sagt ab, der
 * andere verschiebt — finden nicht beide einen geplanten Termin vor. Wer
 * verliert, bekommt `falscher_status` und nicht stillschweigend Erfolg.
 *
 * **Die Uhr ist die der Datenbank** (Invariante 5): ein Termin wird nur in die
 * Zukunft verschoben, und als geführt vermerkt wird nur, was schon begonnen
 * hat — beides gegen `now()` der DATENBANK, nie gegen die Uhr des Geräts.
 *
 * **Und nichts geht hinaus** (Invariante 7). Eine Absage oder ein neuer
 * Termin erreicht die Bewerberin nur über eine Nachricht, die ein Mensch
 * entwirft und die durch die Freigabe geht (`recruiting/antwort.ts`); dieser
 * Dienst schreibt nur den Zustand und das Protokoll.
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { RecruitingFehler } from './dienst.js';

/** Fünf Minuten bis vier Stunden — dieselben Grenzen wie beim Anlegen. */
export const GESPRAECH_DAUER_MIN = 5;
export const GESPRAECH_DAUER_MAX = 240;

export type GespraechAktion = 'absagen' | 'verschieben' | 'vermerken';

interface Stand {
  readonly id: string;
  readonly status: string;
  readonly termin: Date;
  readonly dauer_minuten: number;
  readonly begonnen: boolean;
}

/**
 * Der Stand eines Gesprächs dieser Gesellschaft — unter Sperre.
 *
 * Eine gelöschte Bewerbung (REC-07) hat keine Gespräche mehr, die jemand
 * ändert: sie gilt hier als unbekannt, wie in `ladeGespraech`.
 */
async function sperre(kontext: SchreibKontext, id: string): Promise<Stand> {
  const [g] = await kontext.abfrage<Stand>(
    `select g.id, g.status::text as status, g.termin, g.dauer_minuten,
            (g.termin <= now()) as begonnen
       from gespraech g
       join bewerbung b on b.id = g.bewerbung_id and b.mandant_id = g.mandant_id
      where g.id = $1::uuid and g.mandant_id = app.aktiver_mandant()
        and b.geloescht_am is null
      for update of g`, [id]);
  if (g === undefined) {
    throw new RecruitingFehler('Dieses Gespräch gibt es nicht.', 'unbekannt', 404);
  }
  if (g.status !== 'geplant') {
    throw new RecruitingFehler(
      g.status === 'abgesagt'
        ? 'Dieses Gespräch ist abgesagt. Ein neuer Termin ist ein neues Gespräch.'
        : 'Dieses Gespräch ist als geführt vermerkt — es wird nicht mehr geändert.',
      'falscher_status', 409);
  }
  return g;
}

/** Das `update` mit der Bedingung darin — null Zeilen heisst: jemand war schneller. */
async function schreibe(
  kontext: SchreibKontext, satz: string, werte: readonly unknown[],
): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `${satz} and status = 'geplant' returning id`, werte);
  if (zeilen.length === 0) {
    throw new RecruitingFehler(
      'Das Gespräch hat sich inzwischen geändert — oder diese Sitzung darf es nicht '
      + 'ändern. Bitte die Seite neu laden.', 'gleichzeitig', 409);
  }
}

/** Absagen — mit Grund, der im Gespräch UND im Prüfprotokoll steht. */
export async function sageGespraechAb(
  kontext: SchreibKontext, id: string, grund: string,
): Promise<void> {
  const text = grund.trim();
  if (text === '') {
    throw new RecruitingFehler(
      'Eine Absage nennt ihren Grund. Er bleibt intern — an die Bewerberin geht nur, was '
      + 'ein Mensch entwirft und freigibt.', 'ohne_grund', 400);
  }
  const vorher = await sperre(kontext, id);
  await schreibe(kontext,
    `update gespraech
        set status = 'abgesagt', abgesagt_am = now(), abgesagt_grund = $2,
            abgesagt_von = app.aktueller_benutzer(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [id, text]);
  await kontext.schreibe(
    `select app.protokolliere('recruiting.gespraech_abgesagt', 'gespraech', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [id, { status: vorher.status, termin: vorher.termin.toISOString() },
      { status: 'abgesagt', grund: text }]);
}

/**
 * Verschieben — auf einen Instant in der Zukunft (Uhr der Datenbank).
 *
 * Der Zeitpunkt kommt als UTC-Instant herein; die Berliner Ortszeit löst die
 * Route über `planEingabe` auf, wie beim Anlegen (Invariante 2). Das Gespräch
 * bleibt `geplant` — es ist dasselbe Gespräch zu einer anderen Zeit, und der
 * alte Termin steht im Prüfprotokoll.
 */
export async function verschiebeGespraech(
  kontext: SchreibKontext, id: string, termin: Date, dauerMinuten: number,
): Promise<void> {
  if (!Number.isInteger(dauerMinuten) || dauerMinuten < GESPRAECH_DAUER_MIN
      || dauerMinuten > GESPRAECH_DAUER_MAX) {
    throw new RecruitingFehler(
      `Die Dauer liegt zwischen ${String(GESPRAECH_DAUER_MIN)} und `
      + `${String(GESPRAECH_DAUER_MAX)} Minuten.`, 'unbrauchbare_dauer', 400);
  }
  const vorher = await sperre(kontext, id);
  const [zukunft] = await kontext.abfrage<{ ja: boolean }>(
    `select $1::timestamptz > now() as ja`, [termin.toISOString()]);
  if (zukunft?.ja !== true) {
    throw new RecruitingFehler(
      'Der neue Termin liegt nicht in der Zukunft. Verschoben wird nach vorn, nicht in die '
      + 'Vergangenheit.', 'vergangenheit', 400);
  }
  if (vorher.termin.getTime() === termin.getTime() && vorher.dauer_minuten === dauerMinuten) {
    throw new RecruitingFehler(
      'Termin und Dauer sind dieselben wie bisher — es gibt nichts zu verschieben.',
      'unveraendert', 400);
  }
  await schreibe(kontext,
    `update gespraech
        set termin = $2::timestamptz, dauer_minuten = $3::int,
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [id, termin.toISOString(), dauerMinuten]);
  await kontext.schreibe(
    `select app.protokolliere('recruiting.gespraech_verschoben', 'gespraech', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [id, { termin: vorher.termin.toISOString(), dauer_minuten: vorher.dauer_minuten },
      { termin: termin.toISOString(), dauer_minuten: dauerMinuten }]);
}

/**
 * Als geführt vermerken — erst, wenn der Termin begonnen hat.
 *
 * Ein Gespräch, das in drei Tagen stattfindet, hat nicht stattgefunden; ein
 * Vermerk davor wäre eine Behauptung über die Zukunft. Gemessen wird gegen
 * `now()` der Datenbank.
 */
export async function vermerkeGespraech(kontext: SchreibKontext, id: string): Promise<void> {
  const vorher = await sperre(kontext, id);
  if (!vorher.begonnen) {
    throw new RecruitingFehler(
      'Das Gespräch hat noch nicht begonnen — als geführt vermerkt wird es danach.',
      'noch_nicht', 409);
  }
  await schreibe(kontext,
    `update gespraech
        set status = 'stattgefunden', stattgefunden_vermerkt_am = now(),
            stattgefunden_vermerkt_von = app.aktueller_benutzer(),
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [id]);
  await kontext.schreibe(
    `select app.protokolliere('recruiting.gespraech_stattgefunden', 'gespraech', $1,
                              $2::jsonb, $3::jsonb, app.aktiver_mandant())`,
    [id, { status: vorher.status }, { status: 'stattgefunden' }]);
}
