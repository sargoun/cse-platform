/**
 * Die drei Unbekannten der Reinigungskalkulation — hinter je einer
 * Schnittstelle, mit einem SICHTBAREN Platzhalter dahinter.
 *
 * Keine dieser Zahlen darf erfunden werden (CLAUDE.md, "Never invent a
 * business rule"): der Stundenverrechnungssatz ist eine Preisentscheidung,
 * der Frequenzfaktor eine Vertragsauslegung, die Zuschlaege eine
 * betriebswirtschaftliche Vorgabe. Falsch geraten heisst hier: jedes Angebot
 * ist falsch, alle gleich falsch, und niemand sieht es dem Ergebnis an.
 *
 * Deshalb traegt jeder Platzhalter `istPlatzhalter: true` bis in das
 * Ergebnis hinein, und die Kalkulation nennt die offenen Fragen, mit denen
 * sie gerechnet hat. Eine Oberflaeche, die das anzeigt, kann nicht
 * versehentlich so aussehen, als stuende der Preis fest.
 */
import { basisPunkte, cent, type BasisPunkte, type Cent } from '../finanz/geld.js';
import { milliMenge, type MilliMenge } from '../finanz/menge.js';

/** Die Zuschlagskette nach OPS-07, als Saetze in Basispunkten. */
export interface Tarif {
  /** Verrechnungssatz je Stunde Reinigungsleistung. */
  readonly stundensatz: Cent;
  readonly gemeinkostenSatz: BasisPunkte;
  readonly wagnisSatz: BasisPunkte;
  readonly gewinnSatz: BasisPunkte;
  /** Wahr, solange irgendein Wert daran ein Platzhalter ist. */
  readonly istPlatzhalter: boolean;
  /** Die offenen Fragen, aus denen dieser Tarif stammt (leer, wenn keine). */
  readonly offeneFragen: readonly string[];
}

export interface Tarifquelle {
  /** Der Tarif einer Gesellschaft fuer ein Gewerk, zu einem Stichtag. */
  tarif(mandantId: string, gewerk: string): Tarif;
}

/**
 * PLATZHALTER — nicht der Tarif der CSE-Gruppe.
 *
 * // TODO(client, O-16): Stundenverrechnungssaetze je Gewerk sowie
 * Gemeinkosten-, Wagnis- und Gewinnzuschlag je Gesellschaft.
 */
export const PLATZHALTER_TARIF: Tarifquelle = {
  tarif: (): Tarif => ({
    stundensatz: cent(2900n),
    gemeinkostenSatz: basisPunkte(1500),
    wagnisSatz: basisPunkte(300),
    gewinnSatz: basisPunkte(500),
    istPlatzhalter: true,
    offeneFragen: ['O-16'],
  }),
};

/** Wie oft ein Turnus in der Abrechnungsperiode vorkommt. */
export interface Frequenz {
  /** Durchgaenge je Periode, in Tausendsteln (21,667 → `21_667n`). */
  readonly faktor: MilliMenge;
  readonly istPlatzhalter: boolean;
  readonly offeneFragen: readonly string[];
}

export interface Frequenzquelle {
  frequenz(turnus: string): Frequenz;
}

/**
 * PLATZHALTER — die Umrechnung Turnus → Faktor ist offen.
 *
 * // TODO(client, O-56): Wie wird ein Turnus in einen Frequenzfaktor je
 * Abrechnungsmonat umgerechnet (4,33 Wochen, Kalendertage, Vertragstage)?
 *
 * Die Werte hier rechnen mit 4,333 Wochen je Monat. Sie stehen als EIN Wert
 * je Turnus da, damit der Austausch eine Zeile ist und nicht eine Suche.
 */
const PLATZHALTER_FAKTOREN: Readonly<Record<string, bigint>> = {
  '5_pro_woche': 21_667n,
  '3_pro_woche': 13_000n,
  '2_pro_woche': 8_667n,
  '1_pro_woche': 4_333n,
  '14_taegig': 2_167n,
  '1_pro_monat': 1_000n,
  '1_pro_quartal': 333n,
  '1_pro_jahr': 83n,
  einmalig: 1_000n,
};

export class TarifFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'TarifFehler'; }
}

export const PLATZHALTER_FREQUENZ: Frequenzquelle = {
  frequenz: (turnus: string): Frequenz => {
    const faktor = PLATZHALTER_FAKTOREN[turnus];
    if (faktor === undefined) {
      // Ein unbekannter Turnus bekommt KEINEN Ersatzwert. Ein stillschweigendes
      // "dann eben monatlich" waere ein Preis, den niemand entschieden hat.
      throw new TarifFehler(
        `Unbekannter Turnus: ${turnus}. Bekannt sind: `
        + `${Object.keys(PLATZHALTER_FAKTOREN).join(', ')} (O-56).`,
      );
    }
    return { faktor: milliMenge(faktor), istPlatzhalter: true, offeneFragen: ['O-56'] };
  },
};

/** Die Turnusse, die der Platzhalter kennt — fuer Auswahllisten (O-62). */
export const PLATZHALTER_TURNUSSE: readonly string[] = Object.keys(PLATZHALTER_FAKTOREN);
