import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';
import { rechteImKontext } from '../../auth/kontext-rechte.js';
import { lageVon, leseRegister, type RegisterZeile } from '../nachweis/register.js';
import { postenUebersicht, unterbesetzung, type PostenZeile, type Unterbesetzung } from './posten.js';
import { leseBuch, type EintragZeile } from './wachbuch.js';

/**
 * Der Modulkopf der Sicherheit — drei Fragen, drei Antworten (SEC-01, SEC-02,
 * SEC-05).
 *
 * **„Offene Vorfälle" gibt es als Zustand nicht, und deshalb steht hier etwas
 * anderes.** `wachbuch_eintrag` hat keine Spalte `offen`/`geschlossen`; eine
 * Korrektur ist eine NACHFOLGENDE Zeile (`ersetzt_durch_id`), und ein
 * Vorkommnis wird nie geschlossen — das ist der Kern von SEC-05 und LEG-01:
 * ein Protokoll, das man nicht abhaken kann. Eine Statusspalte zu erfinden
 * wäre eine Geschäftsregel mit Beweiswirkung. Die Kachel zählt deshalb die
 * Einträge der Art `vorkommnis` in einem BENANNTEN Zeitfenster und sagt das
 * im Text.
 *
 * **Die Art heisst `vorkommnis`, nicht `vorfall`.** Der Aufzählungstyp
 * `wachbuch_art` hat genau fünf Werte: `rundgang`, `vorkommnis`, `uebergabe`,
 * `schluessel`, `alarm`. Ein Filter auf `'vorfall'` wäre ein
 * `invalid input value for enum` — im besten Fall, denn ein `::text`-Vergleich
 * daneben hätte lautlos null Zeilen geliefert.
 *
 * **Die Nachweise liegen hinter einem ANDEREN Recht als diese Route.** Die
 * Route hält `security.lesen`; `nachweis` verlangt `personal.nachweis_lesen`
 * (Policy `n_lesen`), `einsatz`/`einsatz_zuordnung` verlangen
 * `dienstplan.lesen`. Eine reine Sicherheitsrolle sieht dort nichts — und
 * „keine ablaufenden Nachweise" wäre dann eine Entwarnung, die niemand
 * geprüft hat. Jede Kachel ist deshalb `null`, wenn ihr Recht fehlt.
 *
 * **Abgelaufen ist ein SPERRGRUND, keine Warnung.** SEC-04 ist eine harte
 * Sperre: wer keinen gültigen § 34a-Nachweis hat, wird nicht eingeteilt. Die
 * Lage kommt aus `lageVon`, und die Schwellen kommen aus
 * `qualifikation.warnung_tage` — nie aus einer Konstante in einer Seite, sonst
 * gäbe es zwei Meinungen darüber, was „kritisch" heisst.
 */

/** Die Rechte, die der Kopf ausser `security.lesen` gern hätte. */
export const SECURITY_KOPF_FREMDRECHTE = [
  'dienstplan.lesen', 'personal.nachweis_lesen', 'wachbuch.lesen', 'objekt.lesen',
] as const;

/** Das Fenster der Postenabdeckung: heute plus vier Wochen. */
export const POSTEN_FENSTER_TAGE = 28;

/**
 * Das Fenster der Wachbuchkachel — SIEBEN Berliner Kalendertage.
 *
 * Die Zahl steht hier und nicht in der Seite, weil die Überschrift sie nennen
 * MUSS: „Vorkommnisse der letzten 7 Tage" ist eine Aussage, „offene
 * Vorkommnisse" wäre eine Erfindung.
 */
export const WACHBUCH_FENSTER_TAGE = 7;

/**
 * Die Katalogschlüssel der Bewacherqualifikationen — die Zeilen, die ein
 * Mensch für eine Wachtätigkeit nach § 34a GewO braucht.
 *
 * **Die Schlüssel sind nachgemessen, nicht geraten:** im plattformweiten
 * Katalog (`src/server/db/seed/qualifikation.ts`) heissen sie
 * `34a_sachkunde`, `34a_unterrichtung` und `bewacherausweis`. Ein blosses
 * `'34a'` — so stand es hier — trifft KEINE dieser Zeilen; ein Filter darauf
 * hätte die Liste still geleert und „nichts abgelaufen" gemeldet.
 *
 * **Sie filtern die Liste nicht, sie markieren sie.** Der Modulkopf zeigt alle
 * Nachweise dieser Gesellschaft mit Frist, weil SEC-04 nicht an der
 * Qualifikation hängt, sondern an `einsatzanforderung.zwingend` des jeweiligen
 * Postens (`app.einsatz_qualifikation_erfuellt`): auch eine abgelaufene
 * Unterweisung kann eine Einteilung sperren, wenn der Posten sie zwingend
 * verlangt. Welche Teilmenge der Modulkopf zeigen soll, ist nicht entschieden.
 */
// TODO(client, O-706): Soll der Sicherheits-Modulkopf nur die Bewachernachweise (34a_sachkunde, 34a_unterrichtung, bewacherausweis) zeigen oder alle Nachweise der Gesellschaft mit Frist?
export const BEWACHER_QUALIFIKATIONEN: readonly string[] = [
  '34a_sachkunde', '34a_unterrichtung', 'bewacherausweis',
];

export interface NachweisLage {
  readonly zeile: RegisterZeile;
  readonly lage: ReturnType<typeof lageVon>;
  /** Eine Bewacherqualifikation nach § 34a GewO — Markierung, kein Filter. */
  readonly bewacher: boolean;
}

export interface SecurityKopf {
  readonly heute: string;
  readonly geprueft: Readonly<Record<string, boolean>>;
  /** `null` heisst: `security.lesen` reicht, aber `dienstplan.lesen` fehlt. */
  readonly posten: readonly PostenZeile[] | null;
  readonly luecken: readonly Unterbesetzung[] | null;
  /** `null` heisst: `personal.nachweis_lesen` fehlt. */
  readonly nachweise: readonly NachweisLage[] | null;
  /** `null` heisst: `wachbuch.lesen` fehlt. */
  readonly vorkommnisse: readonly EintragZeile[] | null;
  readonly fenster: { readonly von: string; readonly bis: string };
  readonly wachbuchVon: string;
}

/**
 * Die Lagen, die auf dieser Seite auftauchen — abgelaufen und kritisch zuerst.
 *
 * `unbefristet` und `gueltig` stehen NICHT dabei: ein Nachweis, der noch zwei
 * Jahre läuft, ist keine Auskunft für einen Modulkopf. `ungueltig`
 * (widerrufen, abgelehnt) gehört dazu — ein widerrufener Nachweis sperrt wie
 * ein abgelaufener.
 */
const AUFFAELLIGE_LAGEN: readonly string[] = ['abgelaufen', 'ungueltig', 'kritisch', 'warnung'];

export async function ladeSecurityKopf(
  kontext: LeseKontext, heute: string,
  fenster: { readonly von: string; readonly bis: string },
  wachbuchVon: string,
): Promise<SecurityKopf> {
  const geprueft = await rechteImKontext(kontext, ...SECURITY_KOPF_FREMDRECHTE);

  /*
   * `posten` selbst liegt hinter `security.lesen` — dem Recht dieser Route.
   * Die BESETZUNG darin kommt aus `einsatz`/`einsatz_zuordnung` und damit aus
   * `dienstplan.lesen`; `postenUebersicht` zaehlt Schichten mit. Ohne das
   * Recht stuenden dort ueberall Nullen, und „0 unterbesetzt" wäre die
   * gefaehrlichste Zahl auf diesem Bildschirm.
   */
  const planbar = geprueft['dienstplan.lesen'] === true;
  const posten = planbar ? await postenUebersicht(kontext, fenster) : null;
  const luecken = planbar ? await unterbesetzung(kontext, fenster) : null;

  const nachweise = geprueft['personal.nachweis_lesen'] === true
    ? (await leseRegister(kontext, heute))
      .map((zeile) => ({
        zeile,
        lage: lageVon(zeile),
        bewacher: BEWACHER_QUALIFIKATIONEN.includes(zeile.qualifikationSchluessel),
      }))
      .filter((n) => AUFFAELLIGE_LAGEN.includes(n.lage))
      /*
       * Sortiert nach Restfrist, nicht nach Name — wie das Nachweisregister.
       * Ein abgelaufener Nachweis (negative Restfrist) steht damit oben, und
       * das ist die Reihenfolge, in der jemand sie abarbeitet. `null` (kein
       * Ablaufdatum) kann hier nur bei `ungueltig` vorkommen und wandert nach
       * hinten.
       */
      .sort((a, b) => (a.zeile.restTage ?? 99_999) - (b.zeile.restTage ?? 99_999))
    : null;

  const vorkommnisse = geprueft['wachbuch.lesen'] === true
    ? await leseBuch(kontext, { art: 'vorkommnis', von: wachbuchVon, bis: heute, grenze: 50 })
    : null;

  return {
    heute, geprueft, posten, luecken, nachweise, vorkommnisse, fenster, wachbuchVon,
  };
}
