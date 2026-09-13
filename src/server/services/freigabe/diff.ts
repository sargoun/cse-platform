/**
 * Der Diff, ueber den ein Mensch entscheidet (APR-02,
 * `06-AGENTEN-FREIGABEN.md` §14.5).
 *
 * **Worum es geht.** Eine Monatsrechnung mit vierzig Positionen liest
 * niemand. Ein Satz wie „Wie im August, ausser +12 Nachtstunden am
 * Kurfuerstendamm → +456,00 €" liest jeder, und er ist der Unterschied
 * zwischen einer Pruefung und einem Klick. Genau das ist der Zweck des Tores
 * (Invariante 7): wer nicht liest, gibt nichts frei — er stempelt.
 *
 * **Drei Eigenschaften, und jede haelt einen konkreten Ausfall auf:**
 *
 *  1. **Der Diff laeuft ueber die STRUKTUR, nie ueber gerenderten Text.**
 *     Ein Textvergleich zeigt Zeilenumbrueche als Aenderung und eine
 *     verschobene Position als vier — und eine Preisaenderung im Rauschen.
 *
 *  2. **Jede Geldrechnung ist `bigint`-Cent** (Invariante 1). Die
 *     Umsatzsteuerdifferenz wird JE STEUERSATZGRUPPE gebildet und nie aus
 *     einem Bruttobetrag zurueckgerechnet — eine Gruppensumme aus einer
 *     Gesamtsumme zu rekonstruieren ist genau der Rundungsfehler, den
 *     Invariante 1 verbietet.
 *
 *  3. **Die Funktion ist rein.** Kein Datenbankzugriff, keine Uhr, kein
 *     Modell. Sie wird von `tests/kern/freigabe-diff.test.ts` erschoepfend
 *     geprueft, weil die Zusammenfassung, die ein Mensch liest, aus ihrem
 *     Ergebnis gebaut wird (§14.5) — ein falscher Diff ist eine falsche
 *     Zusammenfassung und damit eine Freigabe fuer etwas anderes.
 *
 * **Was hier NICHT steht:** die Entscheidung, WELCHE Vorperiode verglichen
 * wird. Das ist der Vergleichsaufloeser je Vorgangsart (§14.5) und haengt an
 * Werten, die der Kunde noch nicht bestaetigt hat (O-04, O-05). Ohne
 * Vergleichbares gibt es keinen Diff, und das Ergebnis ist die vollstaendige
 * Pruefung — die sichere Richtung.
 */
import { ZUSAETZLICHE_SCHLUESSEL_MERKMALE } from './vergleich-schluessel.platzhalter.js';
import type { Cent } from '../finanz/geld.js';
import type { MilliMenge } from '../finanz/menge.js';

/**
 * Woher eine Position kommt (FIN-07). Eine Zeile ohne Herkunft ist ein Betrag
 * ohne nachvollziehbare Quelle — §14.6 macht sie `unsicher`, und das ist
 * keine Formalie: ein Betrag, den niemand zurueckverfolgen kann, ist einer,
 * den niemand pruefen kann.
 */
export type QuellenArt = 'zeiteintrag' | 'aufmass' | 'vertrag' | 'material';

export interface Quelle {
  readonly art: QuellenArt;
  readonly id: string;
}

export interface VergleichsPosition {
  /** Objekt, Katalogeintrag und Einheit — siehe `positionsSchluessel`. */
  readonly objektId: string | null;
  readonly leistungskatalogId: string | null;
  readonly bezeichnung: string;
  /** Tausendstel (K-16). Nie eine Gleitkommazahl, nie eine JSON-Zahl. */
  readonly menge: MilliMenge;
  readonly einheit: string;
  readonly einzelpreisCent: Cent;
  readonly betragCent: Cent;
  readonly herkunft: readonly Quelle[];
  /** Freie Merkmale, z. B. `{ zuschlag: 'nacht' }` — siehe O-114. */
  readonly meta: Readonly<Record<string, string>>;
}

export interface UstGruppe {
  readonly steuersatzGruppeId: string;
  readonly nettoCent: Cent;
  readonly ustCent: Cent;
}

export interface Vergleichsmodell {
  readonly vorgangTyp: string;
  /** Die Bezeichnung der Periode, wie sie in der Zusammenfassung steht. */
  readonly periode: string;
  readonly positionen: readonly VergleichsPosition[];
  readonly ustGruppen: readonly UstGruppe[];
  readonly summeNettoCent: Cent;
  readonly summeBruttoCent: Cent;
  /** FIN-05: bei einer Rechnung Pflicht, sonst `null`. */
  readonly leistungszeitraum: { readonly von: string; readonly bis: string } | null;
}

/** Welches Feld sich geaendert hat. Eine geschlossene Menge, kein freier Text. */
export type GeaendertesFeld =
  | 'menge' | 'einzelpreis' | 'betrag' | 'bezeichnung' | 'herkunft' | 'meta';

export interface FeldAenderung {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly feld: GeaendertesFeld;
  /** Anzeigewerte. Nie Eingabe einer Rechnung — dafuer steht `deltaCent`. */
  readonly alt: string;
  readonly neu: string;
  /** Nur bei `betrag` gefuellt; sonst `null` (K-10: keine erfundene Zahl). */
  readonly deltaCent: Cent | null;
}

export interface UstGruppenDelta {
  readonly steuersatzGruppeId: string;
  readonly deltaNettoCent: Cent;
  readonly deltaUstCent: Cent;
}

export interface Diff {
  readonly unveraendert: readonly string[];
  readonly hinzugefuegt: readonly VergleichsPosition[];
  readonly entfallen: readonly VergleichsPosition[];
  readonly geaendert: readonly FeldAenderung[];
  readonly deltaNettoCent: Cent;
  readonly deltaBruttoCent: Cent;
  readonly deltaUstGruppen: readonly UstGruppenDelta[];
}

export class DiffFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'DiffFehler'; }
}

/**
 * Die Identitaet einer Position.
 *
 * `objekt | katalog | einheit` plus die Merkmale aus O-114. Die drei festen
 * Abschnitte stehen fest, weil sie keine offene Frage sind: dasselbe Objekt,
 * derselbe Katalogeintrag, dieselbe Einheit ist dieselbe Leistung. Alles
 * Weitere ist die Frage, die noch niemand beantwortet hat — und solange sie
 * offen ist, ist es ein ATTRIBUT und kein Teil der Identitaet.
 *
 * `|` als Trenner und die Abschnitte einzeln maskiert: ohne Maskierung
 * kollidierten `('a|b', 'c')` und `('a', 'b|c')` zu demselben Schluessel, und
 * zwei verschiedene Positionen erschienen als eine geaenderte.
 */
export function positionsSchluessel(p: VergleichsPosition): string {
  const teile = [p.objektId ?? '', p.leistungskatalogId ?? '', p.einheit];
  for (const merkmal of ZUSAETZLICHE_SCHLUESSEL_MERKMALE) {
    teile.push(p.meta[merkmal] ?? '');
  }
  return teile.map((t) => t.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|')).join('|');
}

function mengeText(menge: MilliMenge): string {
  const negativ = menge < 0n;
  const abs = (negativ ? -menge : menge).toString().padStart(4, '0');
  return `${negativ ? '-' : ''}${abs.slice(0, -3)},${abs.slice(-3)}`;
}

function centText(betrag: Cent): string {
  const negativ = betrag < 0n;
  const abs = (negativ ? -betrag : betrag).toString().padStart(3, '0');
  return `${negativ ? '-' : ''}${abs.slice(0, -2)},${abs.slice(-2)}`;
}

function herkunftText(quellen: readonly Quelle[]): string {
  return [...quellen].map((q) => `${q.art}:${q.id}`).sort().join(' · ');
}

function metaText(meta: Readonly<Record<string, string>>): string {
  return Object.keys(meta).sort().map((k) => `${k}=${meta[k] ?? ''}`).join(' · ');
}

/**
 * Die Positionen einer Seite nach Schluessel.
 *
 * **Ein doppelter Schluessel ist ein FEHLER, keine stille Zusammenfassung.**
 * Zwei Zeilen mit derselben Identitaet zu addieren saehe im Diff aus wie eine
 * Mengenaenderung; sie zu ueberschreiben liesse eine verschwinden. Beides
 * verbirgt genau das, wofuer dieser Diff existiert. Wenn eine Nutzlast
 * dieselbe Position zweimal traegt, ist die Nutzlast falsch — und das gehoert
 * vor die Freigabe, nicht dahinter.
 */
function nachSchluessel(
  positionen: readonly VergleichsPosition[], seite: string,
): ReadonlyMap<string, VergleichsPosition> {
  const karte = new Map<string, VergleichsPosition>();
  for (const p of positionen) {
    const s = positionsSchluessel(p);
    if (karte.has(s)) {
      throw new DiffFehler(
        `Die Position ${JSON.stringify(s)} steht zweimal in ${seite}. Zwei Zeilen `
        + 'mit derselben Identitaet ergeben keinen Diff, den ein Mensch pruefen kann.',
      );
    }
    karte.set(s, p);
  }
  return karte;
}

function vergleicheEine(
  schluessel: string, alt: VergleichsPosition, neu: VergleichsPosition,
): readonly FeldAenderung[] {
  const aenderungen: FeldAenderung[] = [];
  const bez = neu.bezeichnung;

  if (alt.bezeichnung !== neu.bezeichnung) {
    aenderungen.push({
      schluessel, bezeichnung: bez, feld: 'bezeichnung',
      alt: alt.bezeichnung, neu: neu.bezeichnung, deltaCent: null,
    });
  }
  if (alt.menge !== neu.menge) {
    aenderungen.push({
      schluessel, bezeichnung: bez, feld: 'menge',
      alt: mengeText(alt.menge), neu: mengeText(neu.menge), deltaCent: null,
    });
  }
  if (alt.einzelpreisCent !== neu.einzelpreisCent) {
    aenderungen.push({
      schluessel, bezeichnung: bez, feld: 'einzelpreis',
      alt: centText(alt.einzelpreisCent), neu: centText(neu.einzelpreisCent),
      deltaCent: null,
    });
  }
  if (alt.betragCent !== neu.betragCent) {
    aenderungen.push({
      schluessel, bezeichnung: bez, feld: 'betrag',
      alt: centText(alt.betragCent), neu: centText(neu.betragCent),
      deltaCent: (neu.betragCent - alt.betragCent) as Cent,
    });
  }
  const altH = herkunftText(alt.herkunft);
  const neuH = herkunftText(neu.herkunft);
  if (altH !== neuH) {
    aenderungen.push({
      schluessel, bezeichnung: bez, feld: 'herkunft', alt: altH, neu: neuH, deltaCent: null,
    });
  }
  const altM = metaText(alt.meta);
  const neuM = metaText(neu.meta);
  if (altM !== neuM) {
    aenderungen.push({
      schluessel, bezeichnung: bez, feld: 'meta', alt: altM, neu: neuM, deltaCent: null,
    });
  }
  return aenderungen;
}

/**
 * Die Steuerdifferenz, JE GRUPPE (Invariante 1).
 *
 * Eine Gruppe, die nur auf einer Seite vorkommt, erscheint mit ihrem vollen
 * Betrag — als Zugang oder als Wegfall. Genau das ist der interessante Fall:
 * eine Rechnung, die ploetzlich 7 % statt 19 % ausweist, ist die Aenderung,
 * die eine Pruefung finden muss, und sie stuende in keiner Gesamtsumme.
 */
function ustDelta(
  vorher: readonly UstGruppe[], nachher: readonly UstGruppe[],
): readonly UstGruppenDelta[] {
  const alt = new Map(vorher.map((g) => [g.steuersatzGruppeId, g]));
  const neu = new Map(nachher.map((g) => [g.steuersatzGruppeId, g]));
  const gruppen = [...new Set([...alt.keys(), ...neu.keys()])].sort();

  return gruppen.map((id) => {
    const a = alt.get(id);
    const n = neu.get(id);
    return {
      steuersatzGruppeId: id,
      deltaNettoCent: ((n?.nettoCent ?? 0n) - (a?.nettoCent ?? 0n)) as Cent,
      deltaUstCent: ((n?.ustCent ?? 0n) - (a?.ustCent ?? 0n)) as Cent,
    };
  }).filter((d) => d.deltaNettoCent !== 0n || d.deltaUstCent !== 0n);
}

/**
 * Der Diff zweier Vergleichsmodelle.
 *
 * Die Reihenfolge jeder Liste ist deterministisch (nach Schluessel sortiert),
 * damit derselbe Vergleich denselben Diff ergibt — sonst hiesse
 * `diff_hash` (K-13) bei jedem Aufruf etwas anderes und die Kette bezeugte
 * nichts.
 */
export function diffVergleich(vorher: Vergleichsmodell, nachher: Vergleichsmodell): Diff {
  const alt = nachSchluessel(vorher.positionen, 'der Vorperiode');
  const neu = nachSchluessel(nachher.positionen, 'dem Vorschlag');

  const unveraendert: string[] = [];
  const geaendert: FeldAenderung[] = [];
  const entfallen: VergleichsPosition[] = [];
  const hinzugefuegt: VergleichsPosition[] = [];

  for (const schluessel of [...alt.keys()].sort()) {
    const a = alt.get(schluessel)!;
    const n = neu.get(schluessel);
    if (n === undefined) { entfallen.push(a); continue; }
    const aenderungen = vergleicheEine(schluessel, a, n);
    if (aenderungen.length === 0) unveraendert.push(schluessel);
    else geaendert.push(...aenderungen);
  }
  for (const schluessel of [...neu.keys()].sort()) {
    if (!alt.has(schluessel)) hinzugefuegt.push(neu.get(schluessel)!);
  }

  return {
    unveraendert,
    hinzugefuegt,
    entfallen,
    geaendert,
    deltaNettoCent: (nachher.summeNettoCent - vorher.summeNettoCent) as Cent,
    deltaBruttoCent: (nachher.summeBruttoCent - vorher.summeBruttoCent) as Cent,
    deltaUstGruppen: ustDelta(vorher.ustGruppen, nachher.ustGruppen),
  };
}

/** Ob ueberhaupt etwas anders ist — die Frage, die der Posteingang stellt. */
export function istUnveraendert(diff: Diff): boolean {
  return diff.hinzugefuegt.length === 0
    && diff.entfallen.length === 0
    && diff.geaendert.length === 0
    && diff.deltaNettoCent === 0n
    && diff.deltaBruttoCent === 0n
    && diff.deltaUstGruppen.length === 0;
}

/** Wie viele Aenderungen die Zusammenfassung nennt (§14.5). */
export function anzahlAenderungen(diff: Diff): number {
  return diff.hinzugefuegt.length + diff.entfallen.length + diff.geaendert.length;
}
