/**
 * Wie viele Tage eine Abwesenheit kostet (EMP-05, CLN-03).
 *
 * Die Zahl ist keine Formalie: sie geht auf `urlaubskonto.genommen_tage`, und
 * `rest_tage` haengt als erzeugte Spalte daran. Wer sie falsch rechnet,
 * verschenkt oder unterschlaegt Urlaubstage — und beides faellt erst im
 * naechsten Jahr auf.
 *
 * **Drei Regeln, und die dritte ist eine offene Frage.**
 *
 *  1. Gezaehlt werden ARBEITSTAGE, nicht Kalendertage. Ein Urlaub von Freitag
 *     bis Montag kostet zwei Tage, nicht vier.
 *  2. Gesetzliche Feiertage in Berlin zaehlen nicht (§ 3 Abs. 2 BUrlG). Sie
 *     kommen aus `@/lib/datum/feiertage-berlin` — derselben Quelle, die auch
 *     der Dienstplan benutzt (CLN-03), damit ein Feiertag nicht in der Planung
 *     gilt und im Urlaubskonto nicht.
 *  3. **Welche Wochentage Arbeitstage sind, ist NICHT entschieden.** Montag bis
 *     Freitag ist die Vorgabe dieser Umsetzung und ausdruecklich ein
 *     Platzhalter: eine Reinigungskraft mit Samstagsturnus hat eine andere
 *     Woche, und ob eine Teilzeitkraft mit drei Tagen fuer eine Urlaubswoche
 *     drei oder fuenf Tage abgibt, ist eine Tarif- und Vertragsfrage.
 *     // TODO(client, O-18): Welche Wochentage gelten je Arbeitszeitmodell als Arbeitstage, und wie rechnet eine Teilzeitwoche auf Urlaubstage um?
 *
 * Die Regel steht als PARAMETER und nicht als Konstante im Rumpf: sobald die
 * Antwort da ist, wird sie an einer Stelle gesetzt und nicht in dreissig
 * Formeln gesucht.
 */
import { istFeiertag } from '@/lib/datum/feiertage-berlin';
import { tagePlus } from '@/lib/datum/kalendertag';
import { milliMenge, type MilliMenge } from '../finanz/menge.js';

/** Wochentage als ISO-Zahlen: 1 = Montag … 7 = Sonntag. */
export type Wochentag = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * PLATZHALTER (O-18). Montag bis Freitag — die Vorgabe, solange niemand die
 * Frage beantwortet hat. Sie ist als Konstante sichtbar, damit sie in einer
 * Oberflaeche als „vorlaeufig" ausgewiesen werden kann.
 */
export const ARBEITSTAGE_PLATZHALTER: readonly Wochentag[] = [1, 2, 3, 4, 5];

export interface TageEingabe {
  /** `JJJJ-MM-TT`, einschliesslich. */
  readonly von: string;
  /** `JJJJ-MM-TT`, einschliesslich. */
  readonly bis: string;
  readonly vonHalbtags?: boolean;
  readonly bisHalbtags?: boolean;
  /** Welche Wochentage zaehlen. Vorgabe: der Platzhalter oben. */
  readonly arbeitstage?: readonly Wochentag[];
}

/**
 * Welcher Teil des Zeitraums nicht stimmt — als Schlüssel, den ein Formular
 * in seiner Sprache nachschlägt (V-188). Der Satz des Fehlers bleibt deutsch
 * und für die Verwaltungsseite, die ihn schon zeigt.
 */
export type ZeitraumGrund = 'kein_datum' | 'zeitraum_verkehrt' | 'zeitraum_zu_lang';

export class ZeitraumFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string, readonly grund: ZeitraumGrund = 'kein_datum') {
    super(nachricht);
    this.name = 'ZeitraumFehler';
  }
}

/** ISO-Wochentag eines Kalendertags — 1 = Montag. */
function wochentag(datum: string): Wochentag {
  const tag = new Date(`${datum}T00:00:00Z`).getUTCDay();
  return (tag === 0 ? 7 : tag) as Wochentag;
}

/**
 * Die angerechneten Tage — als Zahl mit drei Nachkommastellen, wie die Spalte.
 *
 * Halbe Tage zaehlen an den RAENDERN: `von_halbtags` halbiert den ersten
 * gezaehlten Tag, `bis_halbtags` den letzten. Faellt der Rand auf einen
 * Feiertag oder ein Wochenende, halbiert sich nichts — es gibt dort nichts zu
 * halbieren.
 */
export function rechneTage(eingabe: TageEingabe): MilliMenge {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(eingabe.von) || !/^\d{4}-\d{2}-\d{2}$/u.test(eingabe.bis)) {
    throw new ZeitraumFehler('Zeitraum erwartet zwei Kalendertage als JJJJ-MM-TT.', 'kein_datum');
  }
  if (eingabe.bis < eingabe.von) {
    throw new ZeitraumFehler('Der Zeitraum endet vor seinem Anfang.', 'zeitraum_verkehrt');
  }
  /**
   * Eine Obergrenze, damit ein Tippfehler im Jahr keine Schleife ueber
   * dreitausend Tage wird. Ein Jahr und ein Tag ist mehr, als jede
   * Abwesenheitsart braucht (§ 3 BUrlG kennt kein Jahr am Stueck), und der
   * Fehler nennt den Grund.
   */
  const grenze = tagePlus(eingabe.von, 366);
  if (eingabe.bis > grenze) {
    throw new ZeitraumFehler(
      'Ein Zeitraum von mehr als 366 Tagen ist keine Abwesenheit.', 'zeitraum_zu_lang');
  }

  const arbeitstage = new Set<Wochentag>(eingabe.arbeitstage ?? ARBEITSTAGE_PLATZHALTER);
  const zaehlt = (tag: string): boolean =>
    arbeitstage.has(wochentag(tag)) && !istFeiertag(tag);
  let gezaehlt = 0;
  for (let tag = eingabe.von; tag <= eingabe.bis; tag = tagePlus(tag, 1)) {
    if (!zaehlt(tag)) continue;
    gezaehlt += 1;
  }
  if (gezaehlt === 0) return milliMenge(0n);

  /**
   * Gerechnet wird in TAUSENDSTELN, nicht in Gleitkomma: ein halber Tag ist
   * `500n` und nicht `0.5`. `tage_angerechnet` ist `numeric(12,3)`, und die
   * Summe vieler halber Tage in `double precision` ist genau die Sorte Zahl,
   * die am Jahresende um einen Tag danebenliegt, ohne dass jemand die Stelle
   * findet (dieselbe Regel wie beim Geld, Invariante 1).
   */
  let tage = BigInt(gezaehlt) * 1000n;
  /**
   * Halbiert wird nur, wenn der Rand SELBST ein gezaehlter Tag ist.
   *
   * Vorher zog `von_halbtags` die halbe Zahl auch dann ab, wenn der erste Tag
   * des Zeitraums ein Samstag, ein Sonntag oder ein Feiertag war — an einem
   * Tag also, der gar nicht mitgezaehlt wurde und an dem es nichts zu
   * halbieren gibt. Ein Urlaub „Samstag halbtags bis Freitag" kostete damit
   * 4,5 statt 5 Tage: ein halber Tag zuviel auf dem Urlaubskonto, jedes Mal,
   * und `rest_tage` haengt als erzeugte Spalte daran.
   *
   * Die zweite Bedingung ist dieselbe Regel wie vorher, nur an der richtigen
   * Groesse festgemacht: faellt derselbe Tag auf beide Raender, ergeben ein
   * halber Vormittag und ein halber Nachmittag einen ganzen Tag, keinen
   * leeren.
   */
  if (eingabe.vonHalbtags === true && zaehlt(eingabe.von)) tage -= 500n;
  if (eingabe.bisHalbtags === true && zaehlt(eingabe.bis) && eingabe.bis !== eingabe.von) {
    tage -= 500n;
  }

  return milliMenge(tage);
}
