/**
 * Die Reinigungskalkulation (OPS-07) — von der Flaeche zum Netto-Angebotspreis.
 *
 * Der Weg ist genau einer, und er steht hier:
 *
 *   Flaeche je Belagsart → Sekunden je Durchgang → Sekunden je Periode
 *     → Lohnkosten (+ Material + Geraet) → + Gemeinkosten → + Wagnis
 *     → + Gewinn → Netto
 *
 * **Die fuenf Bloecke von OPS-07** (V-174): Lohn, Material, Geraet,
 * Gemeinkosten, Wagnis/Gewinn. Material und Geraet werden NIE vorbelegt —
 * sie sind die Summe der Positionen, die ein Mensch erfasst hat
 * (`kostenposition.ts`). Ohne sie rechnet die Kette wie bisher; mit ihnen
 * gehen sie als Einzelkosten in den Preis, und die Gemeinkosten rechnen auf
 * die Basis, die die Kalkulation nennt: `lohn` (nur der Lohn) oder
 * `selbstkosten` (Lohn + Material + Geraet). `je_kostenart` braucht Saetze je
 * Kostenart, die niemand genannt hat (O-16) — sie wird abgewiesen, nie still
 * wie `lohn` gerechnet.
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
  /**
   * Stand der Leistungswert dieser Zeile auf O-17?
   *
   * Je ZEILE, nicht nur als Gesamtraute: `uebernimmKalkulation` schreibt ihn
   * als Schnappschuss (0027), und daran haengt spaeter die Sperre. Ohne ihn
   * las die Sicht den Katalog live — und eine Katalogpflege gab ruecklings
   * Angebote frei, die auf dem Platzhalter gerechnet waren.
   */
  readonly leistungswertIstPlatzhalter: boolean;
}

/**
 * Worauf der Gemeinkostenzuschlag rechnet (V-174). `je_kostenart` fehlt hier
 * mit Absicht: dafuer braeuchte es je Kostenart einen Satz, und die sind
 * offen (O-16).
 */
export type GemeinkostenBasis = 'lohn' | 'selbstkosten';

/** Die von Menschen erfassten Einzelkosten neben dem Lohn (V-174). */
export interface Einzelkosten {
  readonly material: Cent;
  readonly geraet: Cent;
}

export interface Kalkulation {
  readonly zeilen: readonly Kalkulationszeile[];
  readonly flaecheGesamt: MilliMenge;
  readonly sekundenJeDurchgang: bigint;
  readonly sekundenJePeriode: bigint;
  readonly lohnkosten: Cent;
  /** Summe der Materialpositionen — erfasst, nie vorbelegt (V-174). */
  readonly materialkosten: Cent;
  /** Summe der Geraetepositionen — erfasst, nie vorbelegt (V-174). */
  readonly geraetekosten: Cent;
  readonly gemeinkostenBasis: GemeinkostenBasis;
  /** Der Betrag, auf den der Gemeinkostenzuschlag gerechnet wurde. */
  readonly gemeinkostenBezug: Cent;
  readonly gemeinkosten: Cent;
  /** Einzelkosten + Gemeinkosten — der Bezug von Wagnis und Gewinn. */
  readonly vorZuschlag: Cent;
  readonly wagnis: Cent;
  readonly gewinn: Cent;
  /** Netto — die Umsatzsteuer entsteht erst auf der Rechnung, je Steuergruppe. */
  readonly netto: Cent;
  /** Flaeche in Raeumen ohne Belagsart. Nicht kalkulierbar, nicht verschwiegen. */
  readonly flaecheOhneBelagsart: MilliMenge;
  /**
   * Belagsarten, die im Raumbuch vorkommen, am Stichtag aber keinen gueltigen
   * Leistungswert haben. Ihre Flaeche steckt in KEINER Zeile — sie faellt
   * sonst lautlos aus dem Preis.
   */
  readonly ohneGueltigenLeistungswert: readonly string[];
  readonly istPlatzhalter: boolean;
  readonly offeneFragen: readonly string[];
}

export interface Kalkulationseingabe {
  readonly posten: readonly Flaechenposten[];
  readonly frequenz: Frequenz;
  readonly tarif: Tarif;
  /** Flaeche, der keine Belagsart zugeordnet ist. */
  readonly flaecheOhneBelagsart?: MilliMenge;
  /** Belagsarten ohne gueltigen Leistungswert am Stichtag. */
  readonly ohneGueltigenLeistungswert?: readonly string[];
  /** Material und Geraet (V-174). Fehlt es, sind beide null. */
  readonly einzelkosten?: Einzelkosten;
  /** Vorgabe `lohn` — die Basis, mit der jedes Angebot aus dem Raumbuch entsteht. */
  readonly gemeinkostenBasis?: GemeinkostenBasis;
}

/**
 * Der Bezug des Gemeinkostenzuschlags (V-174) — EINE Stelle, getestet.
 *
 * `lohn`: nur die Lohnkosten. `selbstkosten`: Lohn + Material + Geraet, also
 * die Einzelkosten, auf die ein Gemeinkostenzuschlag in der
 * Zuschlagskalkulation rechnet. Welche Basis gilt, waehlt ein Mensch je
 * Kalkulation; was gruppenweit gilt, ist O-16.
 */
export function gemeinkostenBezug(
  basis: GemeinkostenBasis, lohn: Cent, einzel: Einzelkosten,
): Cent {
  return basis === 'lohn' ? lohn : addiere(lohn, einzel.material, einzel.geraet);
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
      leistungswertIstPlatzhalter: p.leistungswertIstPlatzhalter === true,
    };
  });

  // Regel 1: die Summe ist die Summe der ANGEZEIGTEN Zeilen.
  const lohnkosten = addiere(...zeilen.map((z) => z.lohnkosten));
  const einzel = eingabe.einzelkosten ?? { material: NULL_CENT, geraet: NULL_CENT };
  if ((einzel.material as bigint) < 0n || (einzel.geraet as bigint) < 0n) {
    // Negative Kosten waeren eine Gutschrift im Preis — kein Material der Welt.
    throw new Error('Material- und Geraetekosten sind nicht negativ');
  }
  const basis: GemeinkostenBasis = eingabe.gemeinkostenBasis ?? 'lohn';
  const bezug = gemeinkostenBezug(basis, lohnkosten, einzel);
  const gemeinkosten = anteilInBasisPunkten(bezug, tarif.gemeinkostenSatz);
  // Die Einzelkosten gehen IMMER in den Preis — die Basis entscheidet nur,
  // worauf der Gemeinkostenzuschlag rechnet.
  const zwischensumme = addiere(lohnkosten, einzel.material, einzel.geraet, gemeinkosten);
  // Wagnis und Gewinn rechnen auf die Zwischensumme, nicht auf den Lohn: ein
  // Zuschlag auf einen Zuschlag ist eine Entscheidung, und dies ist sie.
  const wagnis = anteilInBasisPunkten(zwischensumme, tarif.wagnisSatz);
  const gewinn = anteilInBasisPunkten(addiere(zwischensumme, wagnis), tarif.gewinnSatz);

  /**
   * O-17 zaehlt MIT: ein Leistungswert, den niemand bestaetigt hat, macht den
   * Preis genauso vorlaeufig wie ein unbestaetigter Stundensatz. Die
   * Datenbank sieht das ueber `belagsart.ist_platzhalter` in
   * `kalkulation_platzhalter`; hier ist die zweite, fruehere Sicht darauf —
   * die, die die Oberflaeche liest, bevor ueberhaupt etwas gespeichert ist.
   */
  const grundlageOffen = posten.some((p) => p.leistungswertIstPlatzhalter === true);
  const fragen = [...new Set([
    ...tarif.offeneFragen, ...frequenz.offeneFragen,
    ...(grundlageOffen ? ['O-17'] : []),
  ])].sort();

  return {
    zeilen,
    flaecheGesamt: addiereMengen(...posten.map((p) => p.flaeche)),
    sekundenJeDurchgang: zeilen.reduce((s, z) => s + z.sekundenJeDurchgang, 0n),
    sekundenJePeriode: zeilen.reduce((s, z) => s + z.sekundenJePeriode, 0n),
    lohnkosten,
    materialkosten: einzel.material,
    geraetekosten: einzel.geraet,
    gemeinkostenBasis: basis,
    gemeinkostenBezug: bezug,
    gemeinkosten,
    vorZuschlag: zwischensumme,
    wagnis,
    gewinn,
    netto: addiere(zwischensumme, wagnis, gewinn),
    flaecheOhneBelagsart: eingabe.flaecheOhneBelagsart ?? NULL_MENGE,
    ohneGueltigenLeistungswert: eingabe.ohneGueltigenLeistungswert ?? [],
    istPlatzhalter: tarif.istPlatzhalter || frequenz.istPlatzhalter || grundlageOffen,
    offeneFragen: fragen,
  };
}

/** Eine Kalkulation ohne einen einzigen Posten — ausdruecklich, nicht leer geraten. */
export const LEERE_KALKULATION: Kalkulation = {
  zeilen: [], flaecheGesamt: NULL_MENGE, sekundenJeDurchgang: 0n, sekundenJePeriode: 0n,
  lohnkosten: NULL_CENT, materialkosten: NULL_CENT, geraetekosten: NULL_CENT,
  gemeinkostenBasis: 'lohn', gemeinkostenBezug: NULL_CENT, gemeinkosten: NULL_CENT,
  vorZuschlag: NULL_CENT, wagnis: NULL_CENT, gewinn: NULL_CENT,
  netto: NULL_CENT, flaecheOhneBelagsart: NULL_MENGE, ohneGueltigenLeistungswert: [],
  istPlatzhalter: false, offeneFragen: [],
};

/**
 * Der Zuschlagsanteil je Zeile — damit die Summe der Positionen den NETTOPREIS
 * ergibt und nicht die blosse Lohnsumme.
 *
 * Der Fehler, den diese Funktion verhindert, ist der teuerste dieser Phase:
 * `kalkuliere` rechnet Lohn → Gemeinkosten → Wagnis → Gewinn, und wer die
 * Positionen anschliessend nur mit `lohnkosten` bepreist, verschickt ein
 * Angebot ohne Gemeinkosten, ohne Wagnis und ohne Gewinn. Nichts daran sieht
 * falsch aus: die Zeilen stimmen, die Summe stimmt zu den Zeilen, und der
 * Auftrag wird zum Selbstkostenpreis unterschrieben.
 *
 * Verteilt wird nach dem GROESSTEN REST: jede Zeile bekommt ihren
 * abgerundeten Anteil, und die verbleibenden Cent gehen an die Zeilen mit dem
 * groessten Rest — bei Gleichstand an die weiter oben stehende. Das ist der
 * einzige Weg, bei dem die Zeilensumme exakt `netto` ergibt, ohne dass eine
 * Zeile die Rundung aller anderen traegt.
 *
 * Sind die Lohnkosten insgesamt null, ist ohne Material und Geraet auch
 * `netto` null, und jede Zeile bekommt null. MIT Material oder Geraet gibt es
 * dann keine Zeile, die den Betrag tragen koennte — das wird abgewiesen, nie
 * verschluckt (V-174).
 *
 * **Material und Geraet reisen mit** (V-174): sie stecken im Netto und
 * werden wie Gemeinkosten, Wagnis und Gewinn nach dem Lohngewicht auf die
 * Leistungszeilen verteilt — dieselbe offene Frage O-208, ob sie im Angebot
 * eigene Positionen waeren.
 *
 * TODO(client, O-208): Sollen Gemeinkosten, Wagnis und Gewinn im Angebot als
 * EIGENE Positionen erscheinen, oder bleiben sie — wie hier — im Einzelpreis
 * der Leistungszeilen enthalten? Beides ist ueblich; die Wahl entscheidet,
 * was der Kunde im Dokument liest, und sie gehoert nicht uns.
 */
export function verteileNetto(
  zeilen: readonly Kalkulationszeile[], netto: Cent,
): readonly Cent[] {
  if (zeilen.length === 0) return [];
  const gewichte = zeilen.map((z) => z.lohnkosten as bigint);
  const summe = gewichte.reduce((a, b) => a + b, 0n);
  if (summe === 0n) {
    if (netto !== NULL_CENT) {
      throw new Error('Netto ohne Lohnkosten laesst sich nicht zuordnen');
    }
    return zeilen.map(() => NULL_CENT);
  }

  const gesamt = netto as bigint;
  const anteile = gewichte.map((g) => (gesamt * g) / summe);          // abgerundet
  const reste = gewichte.map((g, i) => (gesamt * g) - (anteile[i]! * summe));
  let offen = gesamt - anteile.reduce((a, b) => a + b, 0n);

  // Absteigend nach Rest, bei Gleichstand nach Position — stabil und
  // reproduzierbar, damit zweimal dieselbe Kalkulation zweimal dieselben
  // Zeilenpreise ergibt.
  const reihenfolge = anteile.map((_, i) => i)
    .sort((a, b) => (reste[b]! === reste[a]! ? a - b : (reste[b]! > reste[a]! ? 1 : -1)));
  for (const i of reihenfolge) {
    if (offen <= 0n) break;
    anteile[i] = anteile[i]! + 1n;
    offen -= 1n;
  }
  return anteile.map((a) => a as Cent);
}
