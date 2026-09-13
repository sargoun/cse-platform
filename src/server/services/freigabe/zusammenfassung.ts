/**
 * Der eine Satz, den ein Mensch liest (APR-02, §14.5).
 *
 * **Er wird aus einer Schablone gebaut und NIE von einem Modell geschrieben.**
 * Das ist die tragende Entscheidung dieser Datei und keine Stilfrage: eine
 * Paraphrase eines Diffs kann falsch sein, und eine falsche Zusammenfassung
 * hebt das gesamte Tor auf — der Mensch hat gelesen, was nicht dasteht, und
 * freigegeben, was er nicht gesehen hat (Invariante 6, Invariante 7).
 *
 * Die Schablonen stehen woertlich in `06-AGENTEN-FREIGABEN.md` §14.5:
 *
 *   1 Aenderung:  „Wie {periode}, ausser {vz}{menge} {einheit} {bezeichnung}
 *                  an {objekt} → {vz}{betrag}"
 *   2–3:          dieselbe Klausel, mit „und" verbunden
 *   > 3:          „{n} Aenderungen · Netto {vz}{delta} · Details unten"
 *   0:            „Unveraendert gegenueber {periode}"
 *
 * `{objekt}` ist der Name, den der Aufrufer mitgibt, nicht die Kennung: eine
 * UUID im Satz ist kein Satz. Fehlt er, entfaellt der Abschnitt — ein
 * „an undefined" waere schlimmer als keine Ortsangabe.
 */
import { anzahlAenderungen, type Diff, type FeldAenderung, type VergleichsPosition }
  from './diff.js';
import { formatiereGeld, type Cent } from '../finanz/geld.js';

/** Objektnamen je Objektkennung — die Oberflaeche kennt sie, der Diff nicht. */
export type ObjektNamen = ReadonlyMap<string, string>;

/**
 * Ein Delta mit AUSDRUECKLICHEM Vorzeichen (DESIGN §9: Farbe ist nie das
 * einzige Signal, und ein Minus, das man ueberliest, ist eine Freigabe fuer
 * das Gegenteil).
 *
 * **Formatiert wird mit `formatiereGeld`, nicht hier.** Es gibt genau einen
 * Geldformatierer, und das ist keine Stilfrage: eine zweite Fassung waere die
 * Stelle, an der das geschuetzte Leerzeichen, der Tausenderpunkt oder die
 * Rundung irgendwann still auseinanderlaufen — und zwei Bildschirme zeigten
 * denselben Betrag verschieden. Hier kommt nur das Vorzeichen dazu, das
 * `Intl` fuer positive Werte nicht schreibt.
 */
export function euroMitVorzeichen(betrag: Cent): string {
  if (betrag < 0n) return formatiereGeld(betrag).replace('-', '−');
  return `+${formatiereGeld(betrag)}`;
}

/** Ohne Vorzeichen — fuer Summen, die keine Differenz sind. */
export const euro = formatiereGeld;

function objektName(p: VergleichsPosition, namen: ObjektNamen): string | null {
  if (p.objektId === null) return null;
  return namen.get(p.objektId) ?? null;
}

function klauselZugang(p: VergleichsPosition, namen: ObjektNamen): string {
  const ort = objektName(p, namen);
  const wo = ort === null ? '' : ` an ${ort}`;
  return `${p.bezeichnung}${wo} neu → ${euroMitVorzeichen(p.betragCent)}`;
}

function klauselWegfall(p: VergleichsPosition, namen: ObjektNamen): string {
  const ort = objektName(p, namen);
  const wo = ort === null ? '' : ` an ${ort}`;
  return `${p.bezeichnung}${wo} entfaellt → ${euroMitVorzeichen(-p.betragCent as Cent)}`;
}

function klauselAenderung(a: FeldAenderung): string {
  if (a.feld === 'betrag' && a.deltaCent !== null) {
    return `${a.bezeichnung} → ${euroMitVorzeichen(a.deltaCent)}`;
  }
  return `${a.bezeichnung}: ${a.feld} ${a.alt} → ${a.neu}`;
}

/**
 * Der Satz.
 *
 * `periodeVorher` ist die Bezeichnung des Vergleichs („im August"), nicht ein
 * Datum: der Satz wird gelesen, nicht geparst.
 */
export function zusammenfassung(
  diff: Diff, periodeVorher: string | null, objektNamen: ObjektNamen = new Map(),
): string {
  const bezug = periodeVorher === null ? 'zum Vergleich' : `zu ${periodeVorher}`;
  const n = anzahlAenderungen(diff);

  if (n === 0) return `Unveraendert gegenueber ${periodeVorher ?? 'dem Vergleich'}`;

  if (n > 3) {
    return `${String(n)} Aenderungen · Netto ${euroMitVorzeichen(diff.deltaNettoCent)}`
      + ' · Details unten';
  }

  /*
   * Die Reihenfolge ist festgelegt — Zugaenge, Wegfaelle, Aenderungen —, und
   * zwar hier und nicht dem Zufall der Kartenreihenfolge ueberlassen: derselbe
   * Diff muss denselben Satz ergeben, weil der Satz in `ansicht_modell` steht
   * und damit in die Hashkette eingeht (K-13).
   */
  const klauseln = [
    ...diff.hinzugefuegt.map((p) => klauselZugang(p, objektNamen)),
    ...diff.entfallen.map((p) => klauselWegfall(p, objektNamen)),
    ...diff.geaendert.map(klauselAenderung),
  ];

  return `Wie ${bezug}, ausser ${klauseln.join(' und ')}`;
}

/**
 * Ohne Vergleichbares gibt es keinen Diff — und dann sagt der Satz genau das.
 *
 * §14.5: „Erstmalig — vollstaendige Pruefung". Der Satz ist nicht Beiwerk; er
 * ist die Begruendung dafuer, dass dieser Vorgang `risiko = hoch` traegt und
 * nicht im Stapel erscheint.
 */
export const OHNE_VERGLEICH = 'Erstmalig — vollstaendige Pruefung';
