import 'server-only';
import { anteilInBasisPunkten, basisPunkte, NULL_CENT, type Cent } from '../geld.js';

/**
 * Die kaufmännischen Bedingungen einer Abschlags- und Schlussrechnung — als
 * SCHNITTSTELLE (FIN-08, VOB/B §16 und §17).
 *
 * **Warum hier nichts entschieden wird.** Ein Sicherheitseinbehalt ist kein
 * Rechenparameter, sondern eine Vertragsklausel: er entscheidet, wie viel Geld
 * die Gruppe nach der Schlussrechnung noch NICHT bekommt, und wie lange. Wer
 * ihn hier auf „5 %, zwei Jahre" setzt, schreibt einen Vertragsinhalt in einen
 * unveraenderlichen Beleg, den danach niemand mehr korrigieren kann — die
 * Rechnung ist festgeschrieben, der Einbehalt steht drauf, und der Kunde
 * zahlt entsprechend weniger.
 *
 * Der Typ hier ist deshalb der Liefergegenstand; `bedingungen.platzhalter.ts`
 * daneben ist ein beschrifteter Vorschlag und nichts sonst.
 */

/** Wie ein Einbehalt ermittelt wird, wenn es denn einen gibt. */
export interface Einbehalt {
  /** Der Anteil in Basispunkten — 500 = 5 %. */
  readonly anteilBp: number;
  /**
   * Worauf er sich bezieht. VOB/B §17 rechnet auf die Auftragssumme, manche
   * Verträge auf die Schlussrechnungssumme; das ist nicht dasselbe, sobald
   * Nachträge im Spiel sind.
   */
  readonly grundlage: 'auftragssumme' | 'schlussrechnung_netto';
  /** Monate bis zur Freigabe, gerechnet ab Abnahme. */
  readonly freigabeNachMonaten: number;
  /** Ob eine Bürgschaft ihn ablösen darf (VOB/B §17 Abs. 3). */
  readonly buergschaftMoeglich: boolean;
}

export interface AbschlagsBedingungen {
  /**
   * `null` heisst NICHT „kein Einbehalt", sondern „niemand hat es gesagt".
   * Der Unterschied ist der ganze Punkt: `null` sperrt, ein Wert rechnet.
   */
  readonly einbehalt: Einbehalt | null;
  /**
   * Ob der Einbehalt schon vom Abschlag abgezogen wird oder erst von der
   * Schlussrechnung. VOB/B §16 Abs. 1 kennt beides, je nach Vertrag.
   */
  readonly vomAbschlag: boolean;
  /** Woher die Angabe stammt — für die Oberfläche, wörtlich anzeigbar. */
  readonly herkunft: string;
  /** `true`, solange es ein Platzhalter ist. */
  readonly istPlatzhalter: boolean;
}

export class EinbehaltNichtEntschiedenFehler extends Error {
  constructor() {
    super(
      'Ein Sicherheitseinbehalt ist nicht entschieden (O-20). Die Plattform '
      + 'zieht deshalb NICHTS ein — weder vom Abschlag noch von der '
      + 'Schlussrechnung. Offen: behält die Gruppe einen Einbehalt ein, in '
      + 'welcher Höhe, auf welche Grundlage, über welche Frist, und darf eine '
      + 'Bürgschaft ihn ablösen?',
    );
    this.name = 'EinbehaltNichtEntschiedenFehler';
  }
}

/**
 * Der Betrag, der einbehalten wird — oder 0n, wenn es keine Regel gibt.
 *
 * **Kein Werfen im Normalfall.** Eine Schlussrechnung ohne entschiedenen
 * Einbehalt ist keine kaputte Rechnung, sondern eine ohne Einbehalt: die
 * Gruppe bekommt den vollen Betrag, und das ist die Richtung, in die ein
 * unbeantworteter Vertragspunkt fallen muss. Ein erfundener Einbehalt zöge
 * dem Kunden Geld ab, das niemand vereinbart hat.
 */
export function einbehaltCent(
  bedingungen: AbschlagsBedingungen,
  grundlagen: { readonly auftragssummeNettoCent: Cent | null; readonly schlussNettoCent: Cent },
): Cent {
  const e = bedingungen.einbehalt;
  if (e === null) return NULL_CENT;

  const basis = e.grundlage === 'auftragssumme'
    ? grundlagen.auftragssummeNettoCent
    : grundlagen.schlussNettoCent;
  /*
   * Eine Grundlage, die es nicht gibt, ist kein Anlass zu raten: ohne
   * Auftragssumme wird nichts einbehalten, und die Oberflaeche sagt warum.
   */
  if (basis === null) return NULL_CENT;

  /*
   * Ueber `anteilInBasisPunkten` und nicht mit einer eigenen Formel: die
   * Rundungsregel des Hauses steht in `geld.ts` (`teileHalbAuf`), und eine
   * zweite Fassung daneben waere eine zweite Auslegung — sichtbar erst an dem
   * einen Cent, um den eine Schlussrechnung nicht aufgeht.
   */
  return anteilInBasisPunkten(basis, basisPunkte(e.anteilBp));
}
