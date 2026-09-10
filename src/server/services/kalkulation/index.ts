/**
 * Die Reinigungskalkulation (OPS-07) — von der Flaeche zum Netto-Angebotspreis.
 *
 * Der Weg ist genau einer, und er steht hier:
 *
 *   Flaeche je Belagsart → Sekunden je Durchgang → Sekunden je Periode
 *     → Lohnkosten → + Gemeinkosten → + Wagnis → + Gewinn → Netto
 *
 * Drei Regeln, die den teuren Fehler verhindern:
 *
 * 1. **Je Zeile gerundet, dann summiert.** Die angezeigten Zeilen ergeben in
 *    der Summe den Gesamtpreis — sonst steht unter einer korrekten Liste eine
 *    Summe, die nicht dazu passt, und ein Kunde findet den Cent.
 * 2. **Raeume OHNE Belagsart sind ein eigener, sichtbarer Posten.** Sie
 *    stillschweigend wegzulassen ist der Fehler, der ein Angebot zu billig
 *    macht, ohne dass irgendetwas falsch aussieht.
 * 3. **Platzhalter bleiben sichtbar.** Solange Tarif oder Frequenz aus einer
 *    offenen Frage stammen, traegt das Ergebnis `istPlatzhalter` und nennt
 *    die O-Nummern.
 */
import { anteilInBasisPunkten, addiere, NULL_CENT, type Cent } from '../finanz/geld.js';
import { addiereMengen, NULL_MENGE, type MilliMenge } from '../finanz/menge.js';
import { sekundenJeDurchgang, sekundenJePeriode, teileHalbAuf,
         type Flaechenposten } from './richtzeit.js';
import type { Frequenz, Tarif } from './tarif.js';

export interface Kalkulationszeile {
  readonly belagsartId: string;
  readonly bezeichnung: string;
  readonly flaeche: MilliMenge;
  readonly leistungswert: MilliMenge;
  readonly sekundenJeDurchgang: bigint;
  readonly sekundenJePeriode: bigint;
  readonly lohnkosten: Cent;
}

export interface Kalkulation {
  readonly zeilen: readonly Kalkulationszeile[];
  readonly flaecheGesamt: MilliMenge;
  readonly sekundenJeDurchgang: bigint;
  readonly sekundenJePeriode: bigint;
  readonly lohnkosten: Cent;
  readonly gemeinkosten: Cent;
  readonly wagnis: Cent;
  readonly gewinn: Cent;
  /** Netto — die Umsatzsteuer entsteht erst auf der Rechnung, je Steuergruppe. */
  readonly netto: Cent;
  /** Flaeche in Raeumen ohne Belagsart. Nicht kalkulierbar, nicht verschwiegen. */
  readonly flaecheOhneBelagsart: MilliMenge;
  readonly istPlatzhalter: boolean;
  readonly offeneFragen: readonly string[];
}

export interface Kalkulationseingabe {
  readonly posten: readonly Flaechenposten[];
  readonly frequenz: Frequenz;
  readonly tarif: Tarif;
  /** Flaeche, der keine Belagsart zugeordnet ist. */
  readonly flaecheOhneBelagsart?: MilliMenge;
}

/** Lohnkosten aus Sekunden und Stundensatz — die einzige Zeit→Geld-Stelle. */
export function lohnkostenAusSekunden(sekunden: bigint, stundensatz: Cent): Cent {
  if (sekunden < 0n) throw new Error('Negative Sekunden ergeben keine Kosten');
  return teileHalbAuf(sekunden * stundensatz, 3600n) as Cent;
}

export function kalkuliere(eingabe: Kalkulationseingabe): Kalkulation {
  const { posten, frequenz, tarif } = eingabe;

  const zeilen: Kalkulationszeile[] = posten.map((p) => {
    const jeDurchgang = sekundenJeDurchgang(p);
    const jePeriode = sekundenJePeriode(p, frequenz.faktor);
    return {
      belagsartId: p.belagsartId,
      bezeichnung: p.bezeichnung,
      flaeche: p.flaeche,
      leistungswert: p.leistungswert,
      sekundenJeDurchgang: jeDurchgang,
      sekundenJePeriode: jePeriode,
      lohnkosten: lohnkostenAusSekunden(jePeriode, tarif.stundensatz),
    };
  });

  // Regel 1: die Summe ist die Summe der ANGEZEIGTEN Zeilen.
  const lohnkosten = addiere(...zeilen.map((z) => z.lohnkosten));
  const gemeinkosten = anteilInBasisPunkten(lohnkosten, tarif.gemeinkostenSatz);
  const zwischensumme = addiere(lohnkosten, gemeinkosten);
  // Wagnis und Gewinn rechnen auf die Zwischensumme, nicht auf den Lohn: ein
  // Zuschlag auf einen Zuschlag ist eine Entscheidung, und dies ist sie.
  const wagnis = anteilInBasisPunkten(zwischensumme, tarif.wagnisSatz);
  const gewinn = anteilInBasisPunkten(addiere(zwischensumme, wagnis), tarif.gewinnSatz);

  const fragen = [...new Set([...tarif.offeneFragen, ...frequenz.offeneFragen])].sort();

  return {
    zeilen,
    flaecheGesamt: addiereMengen(...posten.map((p) => p.flaeche)),
    sekundenJeDurchgang: zeilen.reduce((s, z) => s + z.sekundenJeDurchgang, 0n),
    sekundenJePeriode: zeilen.reduce((s, z) => s + z.sekundenJePeriode, 0n),
    lohnkosten,
    gemeinkosten,
    wagnis,
    gewinn,
    netto: addiere(zwischensumme, wagnis, gewinn),
    flaecheOhneBelagsart: eingabe.flaecheOhneBelagsart ?? NULL_MENGE,
    istPlatzhalter: tarif.istPlatzhalter || frequenz.istPlatzhalter,
    offeneFragen: fragen,
  };
}

/** Eine Kalkulation ohne einen einzigen Posten — ausdruecklich, nicht leer geraten. */
export const LEERE_KALKULATION: Kalkulation = {
  zeilen: [], flaecheGesamt: NULL_MENGE, sekundenJeDurchgang: 0n, sekundenJePeriode: 0n,
  lohnkosten: NULL_CENT, gemeinkosten: NULL_CENT, wagnis: NULL_CENT, gewinn: NULL_CENT,
  netto: NULL_CENT, flaecheOhneBelagsart: NULL_MENGE, istPlatzhalter: false, offeneFragen: [],
};
