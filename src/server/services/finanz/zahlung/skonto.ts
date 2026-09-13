import 'server-only';
import { cent, verteileNachAnteil, type Cent } from '../geld.js';

/**
 * Skonto ist eine §17-UStG-Korrektur, kein Rabattposten (§7.2).
 *
 * **Warum das nicht eine Zeile weniger auf der Rechnung ist.** Ein Skonto
 * mindert das ENTGELT und damit die Umsatzsteuer — nach der Ausstellung, auf
 * einem Beleg, der nach §14 UStG unveraenderlich ist. Er wird deshalb nicht
 * in die Rechnung gerechnet, sondern als Korrektur gebucht, und zwar JE
 * STEUERSATZGRUPPE: eine Rechnung mit 19 %-Zeilen und §13b-Zeilen hat zwei
 * verschiedene Steuerfolgen, und ein Skonto, der auf beide denselben Satz
 * anwendet, meldet dem Finanzamt eine falsche Vorsteuerkorrektur.
 *
 * **Die Aufteilung folgt dem BRUTTO der Gruppe, und das ist dasselbe wie
 * „im Verhaeltnis der Netto-Betraege" (§7.2) — nur exakt.** Ein Skonto ist
 * ein Prozentsatz auf den Rechnungsbetrag; wendet man ihn auf jede Gruppe
 * brutto an, sinkt jedes Gruppen-NETTO um denselben Prozentsatz. Teilte man
 * dagegen den Bruttoskonto im Verhaeltnis der Nettos auf, bekaeme die Gruppe
 * mit dem hoeheren Steuersatz zu wenig und die steuerfreie zu viel: bei
 * 1.000 EUR zu 19 % und 1.000 EUR nach §13b waeren es 21,90 EUR statt 23,80
 * und 21,90 statt 20,00 — jede Zeile falsch, die Summe richtig, und deshalb
 * faellt es niemandem auf.
 *
 * **Die Cent-Reste gehen nicht verloren.** `verteileNachAnteil` verteilt nach
 * groesstem Rest, also ist die Summe der Anteile immer genau der Skonto.
 *
 * OB ueberhaupt ein Skonto gewaehrt wird, entscheidet diese Datei nicht —
 * siehe `skonto.platzhalter.ts` (O-177).
 */

/** Eine Steuerzeile der Rechnung, so wie `rechnung_steuer` sie traegt. */
export interface SteuerGruppe {
  readonly steuersatzGruppeId: string;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
  /** Der Satz in Basispunkten: `1900` sind 19,00 %. */
  readonly satzBp: number;
}

export interface SkontoAnteil {
  readonly steuersatzGruppeId: string;
  /** Brutto — das, was der Kunde bei dieser Gruppe weniger ueberweist. */
  readonly bruttoCent: Cent;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
}

export class SkontoFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'SkontoFehler';
  }
}

/**
 * Verteilt einen Bruttoskonto auf die Steuersatzgruppen der Rechnung.
 *
 * Die Rueckgabe enthaelt eine Zeile je Gruppe MIT Anteil; eine Gruppe, auf
 * die nach der Verteilung null Cent entfallen, faellt heraus — eine
 * Korrekturbuchung ueber 0,00 EUR beschreibt nichts und stuende nur im Weg.
 */
export function verteileSkonto(
  skontoBruttoCent: Cent,
  gruppen: readonly SteuerGruppe[],
): readonly SkontoAnteil[] {
  if (skontoBruttoCent <= 0n) {
    throw new SkontoFehler(`Ein Skonto von ${skontoBruttoCent} Cent ist keiner.`);
  }
  if (gruppen.length === 0) {
    throw new SkontoFehler('Ohne Steuerzeilen laesst sich ein Skonto nicht aufteilen.');
  }

  const brutto = gruppen.map((g) => g.nettoCent + g.steuerCent);
  if (brutto.some((b) => b < 0n)) {
    throw new SkontoFehler(
      'Eine Steuergruppe mit negativem Brutto — ein Skonto auf eine Gutschrift '
      + 'ist eine eigene Buchung, keine Aufteilung.');
  }
  const summe = brutto.reduce((a, b) => a + b, 0n);
  if (skontoBruttoCent > summe) {
    throw new SkontoFehler(
      `Skonto ${skontoBruttoCent} Cent auf eine Rechnung ueber ${summe} Cent.`);
  }

  const anteile = verteileNachAnteil(skontoBruttoCent, brutto);

  return gruppen.flatMap((g, i) => {
    const anteil = anteile[i]!;
    if (anteil === 0n) return [];
    /**
     * Netto aus dem Brutto herausrechnen, mit dem Satz DIESER Gruppe. Bei
     * §13b (`satzBp = 0`) ist das Netto der ganze Betrag — genau richtig:
     * dort gibt es keine Steuer zu korrigieren.
     */
    const netto = cent((anteil * 10_000n) / BigInt(10_000 + g.satzBp));
    return [{
      steuersatzGruppeId: g.steuersatzGruppeId,
      bruttoCent: anteil,
      nettoCent: netto,
      steuerCent: cent(anteil - netto),
    }];
  });
}
