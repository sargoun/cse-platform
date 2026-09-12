/**
 * Das Kennzahl-Register (DSH-01 … DSH-04).
 *
 * **DSH-04: keine toten Zahlen.** Eine Kachel, die 14 anzeigt und nirgendwohin
 * fuehrt, laesst genau die Frage offen, die sie ausgeloest hat — WELCHE
 * vierzehn? Deshalb ist das Linkziel Pflicht, nicht Kuer: eine Kachel ohne
 * `ziel` laesst sich nicht registrieren, und die Registrierung scheitert beim
 * Start, wo jemand hinschaut, nicht um drei Uhr nachts.
 *
 * **Und die verlinkte Liste muss dieselbe Menge zeigen.** Die Kachel zaehlt
 * mit `zaehlung`, die Liste holt mit `zeilen` — zwei Abfragen, ein Praedikat.
 * Waeren es zwei Praedikate, zeigte die Kachel 14 und die Liste 11, und
 * niemand koennte sagen, welche der beiden luegt. Der Test vergleicht sie.
 *
 * **Ein Modul, das noch nicht gemergt ist, hat KEINE Kachel.** Nicht eine mit
 * `0` — `0` heisst "es gibt keine offenen Rechnungen", und "noch nicht gebaut"
 * heisst etwas voellig anderes. Wer die beiden verwechselt, plant auf einer
 * Zahl, die es nicht gibt. Eine Kachel erscheint erst, wenn ihr Modul da ist.
 */
import type { IconName } from '@/lib/design/icons';

export type Ton = 'success' | 'warning' | 'danger' | 'info' | 'muted';

export interface KachelKontext {
  /** Der Mandant, dessen Zahlen gezeigt werden — oder `null` in der Gruppe. */
  readonly mandantId: string | null;
  /**
   * Sein Slug — die Adresse haengt daran, die Abfrage nicht.
   *
   * Getrennt von `mandantId`, weil beide verschiedene Dinge sind: die ID
   * bindet die Zeilen (K-02), der Slug baut den Link. Ein Ziel aus der ID zu
   * bauen ergaebe `/portal/8f3a…` — eine Adresse, die niemand teilt und die
   * `04-SEITENKARTE.md` nicht kennt. `null` in der Gruppenansicht, in der es
   * keinen aktiven Bereich gibt.
   */
  readonly mandantSlug: string | null;
  /** Die sichtbaren Mandanten. In der Gruppenansicht mehr als einer. */
  readonly mandantIds: readonly string[];
}

export interface Kachel {
  readonly schluessel: string;
  /** Deutsch. Das interne Portal ist deutsch (CLAUDE.md). */
  readonly label: string;
  /** Das Modul, aus dem sie kommt — und ohne das sie nicht erscheint. */
  readonly modul: string;
  /** Der Rechteschluessel, ohne den die Kachel nicht gerendert wird. */
  readonly recht: string;
  readonly ton: Ton;
  /**
   * Das Icon der Kachel (DESIGN §5: die KPI-Kachel traegt eine 40×40-Flaeche
   * mit Icon). Ohne Angabe steht dort `info` — sichtbar unspezifisch, statt
   * dass sich jemand eins ausdenkt.
   */
  readonly icon?: IconName;
  /**
   * Die Zaehlung. Bekommt die sichtbaren Mandanten als `$1::uuid[]` und gibt
   * GENAU EINE Zeile mit einer Spalte `wert` zurueck.
   */
  readonly zaehlung: string;
  /**
   * Die Zeilen hinter der Zahl — dasselbe Praedikat, nur ohne `count(*)`.
   * Der Test vergleicht die Anzahl mit `zaehlung`; zwei Praedikate waeren
   * zwei Wahrheiten.
   */
  readonly zeilen: string;
  /** Wohin die Kachel fuehrt. PFLICHT (DSH-04). */
  readonly ziel: (kontext: KachelKontext) => string;
}

export class KachelFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'KachelFehler'; }
}

const REGISTER = new Map<string, Kachel>();

/**
 * Registriert eine Kachel. Wirft bei allem, was spaeter niemand bemerken
 * wuerde — eine fehlende Zahl faellt auf, ein fehlendes Ziel nicht.
 */
export function registriereKachel(kachel: Kachel): Kachel {
  if (!/^[a-z][a-z0-9_]{2,63}$/u.test(kachel.schluessel)) {
    throw new KachelFehler(`Ungültiger Kachelschlüssel: ${kachel.schluessel}`);
  }
  if (REGISTER.has(kachel.schluessel)) {
    throw new KachelFehler(`Kachel ${kachel.schluessel} ist bereits registriert.`);
  }
  if (kachel.label.trim() === '') {
    throw new KachelFehler(`Kachel ${kachel.schluessel} hat kein Label.`);
  }
  if (!/\bcount\s*\(/iu.test(kachel.zaehlung) || !/\bas\s+wert\b/iu.test(kachel.zaehlung)) {
    throw new KachelFehler(
      `Kachel ${kachel.schluessel}: \`zaehlung\` muss genau eine Zeile mit einer `
      + 'Spalte `wert` liefern — sonst zeigt die Kachel undefined und niemand sieht warum.',
    );
  }
  if (kachel.zeilen.trim() === '') {
    throw new KachelFehler(
      `Kachel ${kachel.schluessel}: ohne \`zeilen\` lässt sich nicht prüfen, ob die `
      + 'Zahl und die verlinkte Liste dieselbe Menge meinen.',
    );
  }
  // DSH-04. Eine Zahl ohne Weg dahinter ist eine Frage ohne Antwort.
  const ziel = kachel.ziel({ mandantId: 'pruef', mandantSlug: 'pruef', mandantIds: ['pruef'] });
  if (typeof ziel !== 'string' || !ziel.startsWith('/')) {
    throw new KachelFehler(
      `Kachel ${kachel.schluessel}: \`ziel\` muss einen Pfad liefern (DSH-04). `
      + 'Eine Kachel, die 14 zeigt und nirgendwohin führt, lässt genau die Frage '
      + 'offen, die sie ausgelöst hat: welche vierzehn?',
    );
  }
  REGISTER.set(kachel.schluessel, kachel);
  return kachel;
}

export function kacheln(): readonly Kachel[] { return [...REGISTER.values()]; }
export function findeKachel(schluessel: string): Kachel | undefined {
  return REGISTER.get(schluessel);
}
export function leereKacheln(): void { REGISTER.clear(); }

/**
 * Die Kacheln, die dieser Benutzer sehen darf.
 *
 * Gefiltert wird nach RECHT, nicht nach Rolle: die Rolle ist eine Abkürzung,
 * das Recht ist die Aussage. Was jemand nicht darf, erscheint gar nicht —
 * eine ausgegraute Kachel verriete die Existenz der Zahl (AUT-06).
 */
export function sichtbareKacheln(
  hatRecht: (recht: string) => boolean,
): readonly Kachel[] {
  return kacheln().filter((k) => hatRecht(k.recht));
}
