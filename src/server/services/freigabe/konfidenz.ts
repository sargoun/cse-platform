/**
 * Konfidenz und Quellenangabe je extrahiertem Feld (APR-03, §14.7).
 *
 * **Die Konfidenz wird ABGELEITET, nicht erfragt.** Ein Modell, das seine
 * eigene Sicherheit meldet, meldet sie selbstbewusst auch dort, wo es sich
 * irrt; das ist der Grund, warum die Tabelle unten keine einzige Zeile
 * enthaelt, die ein Modell beisteuert. Jede Pruefung ist eine Tatsache ueber
 * die Daten: eine IBAN-Pruefsumme stimmt oder sie stimmt nicht, eine
 * Netto-plus-USt-Summe geht auf oder sie geht nicht auf, ein Lieferant ist im
 * Stamm oder er ist es nicht.
 *
 * **Jedes Feld muss seine Quelle nennen koennen** (APR-03) — Dokument, Seite,
 * Tabelle, Zelle, Zitat oder der Wissens-Chunk. Die Datenbank erzwingt es mit
 * einem CHECK; hier steht derselbe Satz als Typ, damit ein Feld ohne Quelle
 * gar nicht erst gebaut werden kann.
 *
 * **Die Schwelle ist NICHT erfunden.**
 * TODO(client, O-197): Ab welcher Konfidenz gilt ein extrahiertes Feld als
 * unsicher und erzwingt Einzelpruefung (APR-03, APR-04)?
 * Bis zur Antwort gilt der Platzhalter unten, und er irrt bewusst nach STRENG:
 * ein zu Unrecht als unsicher markiertes Feld kostet einen Klick, ein zu
 * Unrecht durchgewinktes kostet eine falsche Freigabe.
 */

/**
 * PLATZHALTER (O-197). Ein Feld unterhalb dieser Konfidenz ist `unsicher`.
 *
 * 0,950 ist streng — gewollt. Der Wert steht an genau einer Stelle, damit die
 * Antwort des Kunden eine Zeile ist und keine Suche.
 */
export const KONFIDENZ_SCHWELLE = 0.95;
export const KONFIDENZ_SCHWELLE_IST_PLATZHALTER = true as const;

/** Welche Pruefung gelaufen ist — eine geschlossene Menge (§14.7). */
export type Pruefung =
  | 'ocr_konfidenz'
  | 'formatpruefung'
  | 'rechenprobe'
  | 'stammdatenabgleich'
  | 'katalogabgleich'
  | 'dublettenpruefung'
  | 'adressatenabgleich'
  | 'weitergabe';

export interface Befund {
  readonly pruefung: Pruefung;
  /** `true`, wenn die Pruefung durchging. */
  readonly bestanden: boolean;
  /** Was dem Menschen angezeigt wird, wenn sie nicht durchging. */
  readonly hinweis: string | null;
}

/**
 * Die Quelle eines Feldes. Mindestens eine Angabe ist Pflicht — der Typ
 * erzwingt es ueber die Union, die Datenbank ueber ihren CHECK.
 */
export type Quellenangabe =
  | { readonly art: 'dokument'; readonly dokumentId: string;
      readonly seite: number | null; readonly tabelle: string | null;
      readonly zelle: string | null; readonly bbox: BBox | null;
      readonly zitat: string | null }
  | { readonly art: 'ausschreibungsdokument'; readonly dokumentId: string;
      readonly seite: number | null; readonly zitat: string | null }
  | { readonly art: 'wissen'; readonly chunkId: string; readonly zitat: string | null }
  | { readonly art: 'zitat'; readonly zitat: string };

export interface BBox {
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
}

export interface ExtrahiertesFeld {
  /** JSON-Pointer in `vorschau_payload`, z. B. `/positionen/3/menge`. */
  readonly feldPfad: string;
  readonly bezeichnung: string;
  readonly wertVorher: string | null;
  readonly wertNachher: string | null;
  readonly quelle: Quellenangabe;
  /** Was das Modell gemeldet hat — ein Signal unter mehreren, nie das Urteil. */
  readonly ocrKonfidenz: number | null;
  readonly befunde: readonly Befund[];
  readonly extraktionModell: string | null;
}

export interface BewertetesFeld extends ExtrahiertesFeld {
  readonly konfidenz: number;
  readonly unsicher: boolean;
  /** Warum es unsicher ist — der kurze Satz neben der Warnpille (§14.7). */
  readonly grund: string | null;
}

export class KonfidenzFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'KonfidenzFehler'; }
}

/**
 * Die Konfidenz eines Feldes.
 *
 * **Das Minimum, nicht der Durchschnitt.** Ein Mittelwert ueber fuenf
 * Pruefungen laesst eine gerissene Rechenprobe von vier bestandenen
 * ueberstimmen — und die Rechenprobe ist genau die, die zaehlt. Eine
 * gescheiterte Pruefung setzt deshalb hart auf 0.
 *
 * Ohne Pruefung und ohne OCR-Wert ist die Konfidenz 0 und nicht 1: „nichts
 * geprueft" ist nicht „alles in Ordnung". Das ist die Richtung, in die ein
 * unvollstaendiger Extraktor irren soll.
 */
export function konfidenzAus(feld: ExtrahiertesFeld): number {
  if (feld.befunde.some((b) => !b.bestanden)) return 0;
  if (feld.ocrKonfidenz === null) {
    // Ohne OCR-Wert zaehlen die bestandenen Pruefungen: mindestens eine
    // ergibt volle Konfidenz, keine einzige ergibt keine.
    return feld.befunde.length > 0 ? 1 : 0;
  }
  if (!Number.isFinite(feld.ocrKonfidenz)
      || feld.ocrKonfidenz < 0 || feld.ocrKonfidenz > 1) {
    throw new KonfidenzFehler(
      `OCR-Konfidenz liegt ausserhalb von [0,1]: ${String(feld.ocrKonfidenz)}`,
    );
  }
  return feld.ocrKonfidenz;
}

/**
 * Auf drei Nachkommastellen — die Gestalt der Spalte `numeric(4,3)`.
 *
 * Gerundet wird kaufmaennisch und die Zeichenkette ist massgeblich: sie geht
 * in `felder` und damit in `felder_hash` ein (K-13). Zwei Laeufe, die
 * dieselbe Zahl verschieden schreiben, brechen die Kette.
 */
export function konfidenzText(wert: number): string {
  if (!Number.isFinite(wert) || wert < 0 || wert > 1) {
    throw new KonfidenzFehler(`Konfidenz liegt ausserhalb von [0,1]: ${String(wert)}`);
  }
  return (Math.round(wert * 1000) / 1000).toFixed(3);
}

/** Der erste gescheiterte Befund liefert den Satz neben der Warnpille. */
function grundAus(feld: ExtrahiertesFeld, konfidenz: number): string | null {
  const gerissen = feld.befunde.find((b) => !b.bestanden);
  if (gerissen !== undefined) {
    return gerissen.hinweis ?? `Pruefung ${gerissen.pruefung} nicht bestanden`;
  }
  if (konfidenz < KONFIDENZ_SCHWELLE) {
    return `Konfidenz ${konfidenzText(konfidenz)} unter der Schwelle `
      + `${KONFIDENZ_SCHWELLE.toFixed(3)} (PLATZHALTER, O-197)`;
  }
  return null;
}

export function bewerte(feld: ExtrahiertesFeld): BewertetesFeld {
  const konfidenz = konfidenzAus(feld);
  const unsicher = konfidenz < KONFIDENZ_SCHWELLE;
  return { ...feld, konfidenz, unsicher, grund: grundAus(feld, konfidenz) };
}

export function bewerteAlle(felder: readonly ExtrahiertesFeld[]): readonly BewertetesFeld[] {
  return felder.map(bewerte);
}

/**
 * Die niedrigste Konfidenz eines Vorgangs — `freigabe.min_konfidenz`,
 * denormalisiert fuer die Sortierung des Posteingangs (§4.2).
 *
 * Ohne Felder ist sie `null` und nicht 1: ein Vorgang ohne Extraktion hat
 * keine Konfidenz, und `1` zu schreiben hiesse, ihn als bestgeprueften ganz
 * nach hinten zu sortieren.
 */
export function minKonfidenz(felder: readonly BewertetesFeld[]): number | null {
  if (felder.length === 0) return null;
  return felder.reduce((m, f) => (f.konfidenz < m ? f.konfidenz : m), 1);
}

export function anzahlUnsicher(felder: readonly BewertetesFeld[]): number {
  return felder.filter((f) => f.unsicher).length;
}

/**
 * Die Weitergaberegel (§5.5 Regel 7): ein unsicherer gebundener Wert macht
 * jedes Feld unsicher, das aus ihm abgeleitet ist.
 *
 * Abgeleitet heisst hier: der Pfad des abgeleiteten Feldes beginnt mit dem
 * Pfad des unsicheren. `/positionen/3` faerbt `/positionen/3/betrag`, aber
 * NICHT `/positionen/30/betrag` — deshalb wird auf der Segmentgrenze
 * verglichen und nicht auf dem nackten Praefix. Ohne diese Grenze faerbte
 * Position 3 stillschweigend dreissig weitere.
 */
export function gibWeiter(felder: readonly BewertetesFeld[]): readonly BewertetesFeld[] {
  const wurzeln = felder.filter((f) => f.unsicher).map((f) => f.feldPfad);
  if (wurzeln.length === 0) return felder;

  return felder.map((f) => {
    if (f.unsicher) return f;
    const wurzel = wurzeln.find((w) => f.feldPfad !== w && f.feldPfad.startsWith(`${w}/`));
    if (wurzel === undefined) return f;
    return {
      ...f,
      unsicher: true,
      grund: `Abgeleitet aus dem unsicheren Feld ${wurzel} (Weitergabe, §5.5 Regel 7)`,
      befunde: [...f.befunde, {
        pruefung: 'weitergabe' as const,
        bestanden: false,
        hinweis: `Quellfeld ${wurzel} ist unsicher`,
      }],
    };
  });
}
