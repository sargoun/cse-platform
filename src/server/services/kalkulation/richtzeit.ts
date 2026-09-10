/**
 * Die Richtzeit — `Σ (m² ÷ Leistungswert) × Frequenzfaktor` (SPEC §7).
 *
 * Das ist die Rechnung, auf der jeder Reinigungspreis steht, und sie ist
 * hier aus einem Grund GANZZAHLIG: eine Flaeche kommt als `numeric(12,3)`,
 * ein Leistungswert als `numeric(10,3)`, und beide als Gleitkommazahl
 * gerechnet ergeben einen Preis, der um Bruchteile daneben liegt — jedes Mal
 * in dieselbe Richtung, und erst nach hundert Rechnungen sichtbar.
 *
 * Also: Flaeche und Leistungswert in Tausendsteln, Zeit in ganzen SEKUNDEN,
 * und genau eine Rundungsstelle, hier benannt (K-16).
 *
 * Die Einheiten kuerzen sich sauber:
 *   Sekunden = 3600 s/h × (Milli-m²) ÷ (Milli-m²/h)
 * Die Tausendstel stehen in Zaehler und Nenner und fallen weg — deshalb
 * braucht diese Rechnung keinen Zwischenwert mit Nachkommastellen.
 */
import type { MilliMenge } from '../finanz/menge.js';

export class RichtzeitFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'RichtzeitFehler'; }
}

/** Kaufmaennisch: halbe Sekunde auf, vom Nullpunkt weg. */
export function teileHalbAuf(zaehler: bigint, nenner: bigint): bigint {
  if (nenner <= 0n) throw new RichtzeitFehler('Nenner muss positiv sein');
  const negativ = zaehler < 0n;
  const abs = negativ ? -zaehler : zaehler;
  const gerundet = (abs * 2n + nenner) / (nenner * 2n);
  return negativ ? -gerundet : gerundet;
}

/** Eine Flaeche EINER Belagsart in einem Objekt. */
export interface Flaechenposten {
  readonly belagsartId: string;
  readonly bezeichnung: string;
  /** Summe der Raumflaechen dieser Belagsart, in Milli-m². */
  readonly flaeche: MilliMenge;
  /** Leistungswert in Milli-m² je Stunde. */
  readonly leistungswert: MilliMenge;
  /**
   * Steht dieser Leistungswert selbst noch auf einer offenen Frage (O-17)?
   *
   * Ohne dieses Feld meldete `kalkuliere` nach der Beantwortung von O-16 und
   * O-56 einen Preis als bestaetigt, der auf einem geschaetzten
   * Reinigungsrichtwert ruht — die letzte offene Frage waere die einzige, die
   * niemand mehr sieht.
   */
  readonly leistungswertIstPlatzhalter?: boolean;
  /** Woher der Leistungswert stammt — fuer die Nachfrage im Preisstreit. */
  readonly leistungswertQuelle?: string;
}

/**
 * Die Zeit fuer EINEN Durchgang ueber diese Flaeche, in ganzen Sekunden.
 *
 * Ein Leistungswert von null ist kein "kostenlos", sondern eine fehlende
 * Angabe — und eine Division, die durchginge, machte daraus eine unendliche
 * oder eine verschwundene Zeit. Beides waere ein Preis, den niemand gesetzt
 * hat, deshalb wirft sie.
 */
export function sekundenJeDurchgang(posten: Flaechenposten): bigint {
  if (posten.leistungswert <= 0n) {
    throw new RichtzeitFehler(
      `Belagsart ${posten.bezeichnung}: Leistungswert ist ${String(posten.leistungswert)}. `
      + 'Ohne Leistungswert gibt es keine Richtzeit (O-17).',
    );
  }
  if (posten.flaeche < 0n) {
    throw new RichtzeitFehler(`Belagsart ${posten.bezeichnung}: negative Flaeche.`);
  }
  return teileHalbAuf(3600n * posten.flaeche, posten.leistungswert);
}

/**
 * Dieselbe Zeit fuer eine ganze Abrechnungsperiode.
 *
 * Der Frequenzfaktor ist selbst ein Tausendstel-Wert (21,667 Durchgaenge je
 * Monat → `21_667n`), also wird nach der Multiplikation einmal durch 1000
 * geteilt — und die Rundung steht hier, nicht beim Aufrufer.
 */
export function sekundenJePeriode(posten: Flaechenposten, frequenzfaktor: MilliMenge): bigint {
  if (frequenzfaktor < 0n) throw new RichtzeitFehler('Negativer Frequenzfaktor');
  return teileHalbAuf(sekundenJeDurchgang(posten) * frequenzfaktor, 1000n);
}

/**
 * Sekunden als Stunden mit zwei Nachkommastellen, zur ANZEIGE.
 *
 * Bewusst getrennt von der Rechnung: wer Stunden anzeigt und mit Stunden
 * weiterrechnet, rundet zweimal. Weitergerechnet wird immer mit Sekunden.
 */
/**
 * Dieselben Stunden in der Form, die eine `numeric(12,3)`-Spalte liest.
 *
 * `alsStundenText` liefert die DEUTSCHE Anzeige mit Komma; die Datenbank
 * liest Punkte. Zwei Formen fuer dieselbe Groesse gehoeren nebeneinander,
 * damit niemand die eine dort einsetzt, wo die andere gemeint war.
 */
export function stundenNachPostgres(sekunden: bigint): string {
  const tausendstel = teileHalbAuf(sekunden * 1000n, 3600n);
  const negativ = tausendstel < 0n;
  const abs = negativ ? -tausendstel : tausendstel;
  return `${negativ ? '-' : ''}${String(abs / 1000n)}.${String(abs % 1000n).padStart(3, '0')}`;
}

export function alsStundenText(sekunden: bigint): string {
  const hundertstel = teileHalbAuf(sekunden * 100n, 3600n);
  const ganz = hundertstel / 100n;
  const rest = hundertstel % 100n;
  return `${String(ganz)},${String(rest).padStart(2, '0')}`;
}
