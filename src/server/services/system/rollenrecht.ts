import 'server-only';
import { KATALOG } from '../../auth/katalog.generiert.js';
import type { SchreibKontext } from '../../kontext/index.js';

/**
 * **Eine Abweichung dieser Gesellschaft an der Rechtematrix setzen**
 * (V-023, AUT-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0008` baut alles: `rolle_berechtigung` trägt `mandant_id`, `gewaehrt` ist
 * ein BOOLEAN statt blosser Existenz (damit sich ENTZIEHEN von „nie etwas
 * eingestellt" unterscheiden lässt), `app.hat_recht` löst
 * mandantenspezifisch vor Plattformvorgabe auf, drei Policies bewachen den
 * Schreibweg und eine vierte verlangt den zweiten Faktor. Die Seitenkarte
 * nennt die Matrix wörtlich „editable per mandant". Das Rollenblatt zeigt je
 * Recht die Quelle: „Plattformvorgabe" oder „Abweichung dieser
 * Gesellschaft".
 *
 * **Und keine Oberfläche erzeugte je eine Abweichung.** Das Beispiel aus dem
 * Tabellenkopf von `0008` — „`finanzen.lesen` der `leitung` in `bau` zu
 * entziehen darf in `reinigung` nichts ändern" — war nicht durchführbar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Vier Wände, und jede hat einen Fall, den sie verhindert.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. **Nur die vier gesellschaftsgebundenen Systemrollen.** `super_admin`
 *     ist die Rolle der PLATTFORM, und `app.hat_recht` wertet für sie eine
 *     mandantengebundene Zeile mit aus (der Zweig über
 *     `benutzer.globale_rolle_id` prüft `mandant_id is not distinct from
 *     p_mandant`). Eine Gesellschaft könnte der Plattformverwaltung damit in
 *     ihrem eigenen Bereich Rechte entziehen — das ist keine Abweichung
 *     mehr, das ist eine Aussperrung von aussen nach innen. Die
 *     Dienstprinzipale (`website_renderer`, `formular_eingang`) stehen aus
 *     demselben Grund draussen: sie sind Prinzipale der Plattform und stehen
 *     in keiner Spalte der Matrix.
 *  2. **Nur Zellen, die die Matrix kennt** — `✔` (gebunden) oder `○`
 *     (bindbar). Der Katalog sagt es selbst: `bindbar` sind „Rollen, für die
 *     eine Bindung IN DER UI angelegt werden darf". Eine Zelle, die weder
 *     das eine noch das andere ist, steht in 03-AUTH §12 leer — sie hier zu
 *     füllen hiesse, die Matrix an einem zweiten Ort umzuschreiben, und der
 *     zweite gewinnt beim ersten Widerspruch, ohne dass ihn jemand sieht.
 *  3. **Kein `nur_global`-Recht.** `app.hat_recht` verlässt für ein solches
 *     Recht die Auflösung VOR der Mitgliedschaftsrolle (Stufe 4). Eine
 *     Abweichung darauf wäre eine Zeile, die nichts bewirkt — und das
 *     Rollenblatt zeigte „gilt: ja · Abweichung dieser Gesellschaft" über
 *     ein Recht, das die Plattform verweigert. Eine Anzeige, die lügt, ist
 *     schlimmer als eine fehlende.
 *  4. **Keine Selbstaussperrung** — und geprüft wird sie NICHT durch
 *     Nachdenken, sondern durch Nachfragen: nach allen Schreibvorgängen wird
 *     `app.hat_recht('system.rolle_verwalten', …)` noch einmal gestellt, in
 *     derselben Transaktion. Steht dort jetzt `false`, hat die Sitzung sich
 *     gerade selbst die Tür zugezogen, und alles rollt zurück. Das ist
 *     derselbe Gedanke wie beim Entzug eines Verwaltungskontos (V-022, „wer
 *     sich selbst entzieht, sperrt sich in derselben Sekunde aus") — nur
 *     fragt er hier den ECHTEN Auflöser statt ihn nachzubauen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Eine Abweichung wird nicht gelöscht, und das ist eine Entscheidung.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0008` erteilt `cse_app` ausdrücklich nur `select, insert, update` auf
 * `rolle_berechtigung` — kein `delete`. „Zurück zur Plattformvorgabe" gibt es
 * deshalb nicht; es gibt nur „hier gilt es" und „hier gilt es nicht". Das ist
 * kein Mangel dieses Dienstes: eine Entscheidung dieser Gesellschaft über
 * ihre eigene Rechtematrix soll nicht spurlos verschwinden, und ein
 * Protokolleintrag, der auf eine gelöschte Zeile zeigt, belegt nichts mehr.
 * Die Oberfläche sagt es hin.
 *
 * Der Unterschied ist trotzdem echt und wird nicht verschwiegen: eine
 * Abweichung bleibt stehen, auch wenn die Plattformvorgabe sich später
 * ändert. Wer „wie die Vorgabe" will, setzt den Wert, den die Vorgabe heute
 * hat — und bleibt darauf stehen.
 */

export type Wunsch = 'gewaehren' | 'entziehen';

export type RollenrechtGrund =
  'unbekannte_rolle' | 'unbekanntes_recht' | 'rolle_nicht_editierbar'
  | 'nur_global' | 'nicht_in_der_matrix' | 'nichts_gewaehlt' | 'zu_viele'
  | 'selbstaussperrung' | 'nicht_selbst_gehalten' | 'abgewiesen';

export class RollenrechtFehler extends Error {
  constructor(nachricht: string, readonly grund: RollenrechtGrund,
              readonly status = 400) {
    super(nachricht);
    this.name = 'RollenrechtFehler';
  }
}

/**
 * Die vier Rollen, deren Matrixspalte einer Gesellschaft gehört.
 *
 * `super_admin` fehlt mit Absicht (Wand 1). Die Liste steht hier und nicht im
 * Katalog, weil sie keine Eigenschaft eines RECHTS ist, sondern eine des
 * Mandantenmodells: `rolle.geltungsbereich = 'mandant'` bei einer
 * Systemrolle, die in der Matrix eine Spalte hat.
 */
export const EDITIERBARE_ROLLEN: readonly string[] =
  ['admin', 'leitung', 'mitarbeiter', 'kunde'];

/** Höchstens so viele Zellen in EINEM Absenden — der Katalog hat 243. */
export const MAX_AENDERUNGEN = 250;

export interface Aenderung {
  readonly recht: string;
  readonly wunsch: Wunsch;
}

/**
 * **Die dritte Verteidigungslinie spricht Postgres, nicht Deutsch.**
 *
 * `kern.rolle_berechtigung_pruefen` (0008) steht VOR der Zeile und prüft drei
 * Dinge, die dieser Dienst nicht noch einmal nachbaut — ein zweiter Nachbau
 * ginge beim ersten Unterschied auseinander:
 *
 *  * dem `super_admin` wird auf KEINEM Weg ein Recht entzogen, auch nicht von
 *    einer Migration;
 *  * der Handelnde hält `system.rolle_verwalten` in diesem Bereich;
 *  * **er hält das Recht, das er vergibt, selbst** (SEC-A3). Ohne diese
 *    Bedingung wäre der Rechte-Editor eine Rechteerweiterung: wer Rechte
 *    verwalten darf, gäbe sich über eine Rolle jedes andere Recht.
 *
 * Was fehlt, ist der SATZ. Ohne diese Übersetzung bekäme ein Mensch
 * „insufficient_privilege" als 500er, wo „du kannst nicht vergeben, was du
 * selbst nicht hast" die Wahrheit ist.
 */
function alsSatz(fehler: unknown): never {
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  if (text.includes('der Vergebende hält es selbst nicht')
      || text.includes('der Vergebende haelt es selbst nicht')) {
    throw new RollenrechtFehler(
      'Dieses Recht lässt sich nicht vergeben: die Sitzung hält es selbst nicht '
      + '(SEC-A3). Wer Rollen verwaltet, gibt damit nicht mehr weiter, als er hat — '
      + 'sonst wäre die Rechteverwaltung eine Hintertür in jedes andere Recht.',
      'nicht_selbst_gehalten', 409);
  }
  if (text.includes('system.rolle_verwalten fehlt')) {
    throw new RollenrechtFehler(
      'In dieser Gesellschaft fehlt der Sitzung `system.rolle_verwalten`.',
      'abgewiesen', 403);
  }
  if (text.includes('super_admin kann sich Rechte nicht entziehen')) {
    throw new RollenrechtFehler(
      'Der Plattformverwaltung wird kein Recht entzogen — auf keinem Weg.',
      'rolle_nicht_editierbar', 409);
  }
  if (text.includes('row-level security') || text.includes('row level security')) {
    throw new RollenrechtFehler(
      'Die Änderung wurde von der Datenbank abgewiesen. Fehlt der zweite Faktor in '
      + 'dieser Sitzung (AUT-02), oder `system.rolle_verwalten` in dieser '
      + 'Gesellschaft?', 'abgewiesen', 403);
  }
  /* Alles andere ist KEINE Rechtefrage und wird nicht als eine verkleidet. */
  throw fehler;
}

interface RolleZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly plattformweit: boolean;
}

interface RechtZeile {
  readonly id: string;
  readonly nur_global: boolean;
}

/**
 * Darf diese Zelle in der Oberfläche überhaupt bewegt werden?
 *
 * Die Antwort steht im Katalog, der aus der Matrix in 03-AUTH §12 erzeugt
 * wird — `✔` oder `○`. Sie wird auch von der SEITE gebraucht, damit dort
 * kein Auswahlfeld steht, das die Route ohnehin abweist: ein Formular, das
 * etwas anbietet und danach „geht nicht" sagt, ist schlechter als eines, das
 * es gar nicht erst anbietet.
 */
export function zelleBindbar(rolleSchluessel: string, rechtSchluessel: string): boolean {
  if (!EDITIERBARE_ROLLEN.includes(rolleSchluessel)) return false;
  const eintrag = KATALOG.find((e) => e.schluessel === rechtSchluessel);
  if (eintrag === undefined) return false;
  if (eintrag.nurGlobal) return false;
  return (eintrag.gebunden as readonly string[]).includes(rolleSchluessel)
    || (eintrag.bindbar as readonly string[]).includes(rolleSchluessel);
}

/**
 * Die Abweichungen setzen — alle in EINER Transaktion.
 *
 * **Warum alle zusammen und nicht eine je Anfrage.** Eine Rechtematrix wird
 * als Ganzes gelesen und als Ganzes entschieden; „`finanzen.lesen` entziehen,
 * `finanzen.exportieren` aber lassen" ist EINE Überlegung. Zwei Anfragen
 * daraus zu machen hiesse, dass zwischen ihnen ein Zustand steht, den niemand
 * gewollt hat — und dass die Selbstaussperrungsprüfung ihn für gültig hält.
 *
 * Gibt zurück, wie viele Zellen sich tatsächlich geändert haben. Eine Zelle,
 * die schon so steht, wird übersprungen: sie erzeugte sonst eine
 * Protokollzeile über eine Änderung, die keine war.
 */
export async function setzeRollenrechte(
  kontext: SchreibKontext, rolleId: string, aenderungen: readonly Aenderung[],
): Promise<number> {
  if (aenderungen.length === 0) {
    throw new RollenrechtFehler(
      'Es wurde keine Zelle geändert. Stelle mindestens ein Recht auf „gilt hier" '
      + 'oder „gilt hier nicht".', 'nichts_gewaehlt');
  }
  if (aenderungen.length > MAX_AENDERUNGEN) {
    throw new RollenrechtFehler(
      `Höchstens ${String(MAX_AENDERUNGEN)} Zellen auf einmal.`, 'zu_viele');
  }

  /*
   * Die Rolle wird in DIESER Gesellschaft gesucht: entweder plattformweit
   * (`mandant_id is null`) oder eine eigene dieses Bereichs. Ein fremder
   * Bereich ist damit 404 und nicht 403 (AUT-06).
   */
  const [rolle] = await kontext.schreibe<RolleZeile>(
    `select r.id, r.schluessel, (r.mandant_id is null) as plattformweit
       from rolle r
      where r.id = $1::uuid and r.archiviert_am is null
        and (r.mandant_id is null or r.mandant_id = app.aktiver_mandant())`,
    [rolleId]);
  if (rolle === undefined) {
    throw new RollenrechtFehler(
      'Diese Rolle gibt es nicht — oder sie gehört einer anderen Gesellschaft.',
      'unbekannte_rolle', 404);
  }

  if (!rolle.plattformweit) {
    /*
     * Eine Rolle, die es NUR in dieser Gesellschaft gibt, steht in keiner
     * Spalte der Matrix aus 03-AUTH §12 — gegen welche Liste ihre Rechte zu
     * binden sind, hat niemand entschieden (O-904). Bis dahin wird hier
     * nichts geraten.
     */
    // TODO(client, O-904): Gegen welche Rechteliste wird eine Rolle gebunden, die es nur in EINER Gesellschaft gibt?
    throw new RollenrechtFehler(
      'Diese Rolle gehört nur dieser Gesellschaft und steht in keiner Spalte der '
      + 'Rechtematrix. Wogegen ihre Rechte zu binden sind, ist offen (O-904) — und '
      + 'wird hier nicht geraten.', 'rolle_nicht_editierbar', 409);
  }

  if (!EDITIERBARE_ROLLEN.includes(rolle.schluessel)) {
    throw new RollenrechtFehler(
      `„${rolle.schluessel}" ist keine Rolle, deren Rechte eine einzelne Gesellschaft `
      + 'ändern darf. Die Plattformverwaltung und die Dienstprinzipale gehören der '
      + 'Plattform; eine Abweichung daran wäre eine Aussperrung von aussen nach innen.',
      'rolle_nicht_editierbar', 409);
  }

  let gesetzt = 0;
  for (const a of aenderungen) {
    const [recht] = await kontext.schreibe<RechtZeile>(
      `select b.id, b.nur_global from berechtigung b where b.schluessel = $1`,
      [a.recht]);
    if (recht === undefined) {
      /* K-19: ein unbekannter Schlüssel ist ein Tippfehler, keine Ausnahme. */
      throw new RollenrechtFehler(
        `Das Recht „${a.recht}" steht nicht im Katalog.`, 'unbekanntes_recht');
    }
    if (recht.nur_global) {
      throw new RollenrechtFehler(
        `„${a.recht}" gilt nur über die globale Rolle (`
        + '`app.hat_recht`, Stufe 4). Eine Abweichung je Gesellschaft wäre eine Zeile, '
        + 'die nichts bewirkt — und eine Anzeige, die das Gegenteil behauptet.',
        'nur_global', 409);
    }
    if (!zelleBindbar(rolle.schluessel, a.recht)) {
      throw new RollenrechtFehler(
        `Die Matrix in 03-AUTH §12 führt „${a.recht}" für die Rolle `
        + `„${rolle.schluessel}" weder als gebunden noch als bindbar. Diese Zelle wird `
        + 'nicht hier gefüllt, sondern dort entschieden.', 'nicht_in_der_matrix', 409);
    }

    const gewaehrt = a.wunsch === 'gewaehren';

    /*
     * **Erst lesen, dann schreiben — und nur, wenn es etwas ändert.** Eine
     * Zelle, die schon so steht, erzeugte sonst eine Protokollzeile über eine
     * Änderung, die keine war; dieselbe Überlegung wie beim Suchprofil.
     */
    const [vorher] = await kontext.schreibe<{ gewaehrt: boolean }>(
      `select rb.gewaehrt from rolle_berechtigung rb
        where rb.rolle_id = $1::uuid and rb.berechtigung_id = $2::uuid
          and rb.mandant_id = app.aktiver_mandant()`,
      [rolle.id, recht.id]);
    if (vorher !== undefined && vorher.gewaehrt === gewaehrt) continue;

    /*
     * `on conflict` auf den eindeutigen Index `rolle_berechtigung_key`
     * (`nulls not distinct`). Er ist der Grund, warum hier kein „erst löschen"
     * steht: zwei Sitzungen, die dieselbe Zelle setzen, laufen in den Index
     * und nicht in eine zweite Zeile.
     *
     * Ein von der Policy abgewiesener INSERT WIRFT; `p_rb_aal2` verlangt
     * ausserdem `aal2`. Die Route fragt beides vorher ab, damit ein Mensch
     * einen Satz bekommt statt einer Meldung aus der Tiefe.
     */
    try {
      await kontext.schreibe(
        `insert into rolle_berechtigung
           (rolle_id, berechtigung_id, mandant_id, gewaehrt, erstellt_von)
         values ($1::uuid, $2::uuid, app.aktiver_mandant(), $3::boolean,
                 app.aktueller_benutzer())
         on conflict (rolle_id, berechtigung_id, mandant_id) do update
            set gewaehrt = excluded.gewaehrt,
                geaendert_am = now(),
                geaendert_von = app.aktueller_benutzer()`,
        [rolle.id, recht.id, gewaehrt]);
    } catch (fehler: unknown) {
      alsSatz(fehler);
    }

    await kontext.schreibe(
      `select app.protokolliere('system.rollenrecht_gesetzt', 'rolle_berechtigung',
                                $1, $2::jsonb, $3::jsonb, app.aktiver_mandant())`,
      [`${rolle.id}:${recht.id}`,
        { rolle: rolle.schluessel, recht: a.recht,
          gewaehrt: vorher === undefined ? null : vorher.gewaehrt },
        { rolle: rolle.schluessel, recht: a.recht, gewaehrt }]);
    gesetzt += 1;
  }

  /*
   * **Die Tür, durch die man gerade gegangen ist.**
   *
   * Nicht nachgedacht, sondern nachgefragt: `app.hat_recht` ist `stable` und
   * sieht in derselben Transaktion, was oben geschrieben wurde. Wer sich
   * `system.rolle_verwalten` selbst entzogen hat — direkt oder über die
   * Rolle, mit der er in dieser Gesellschaft sitzt —, bekommt hier `false`,
   * und alles rollt zurück. Ein nachgebauter Auflöser wäre eine zweite
   * Fassung von `app.hat_recht` und ginge beim ersten Unterschied auseinander.
   */
  const [tuer] = await kontext.schreibe<{ darf: boolean }>(
    `select app.hat_recht('system.rolle_verwalten', app.aktiver_mandant()) as darf`);
  if (tuer?.darf !== true) {
    throw new RollenrechtFehler(
      'Mit dieser Änderung hätte diese Sitzung selbst kein Recht mehr, Rollen zu '
      + 'verwalten — die Tür wäre von innen zu. Es wurde nichts gespeichert. Ein '
      + 'anderes Konto mit `system.rolle_verwalten` kann es setzen.',
      'selbstaussperrung', 409);
  }

  return gesetzt;
}
