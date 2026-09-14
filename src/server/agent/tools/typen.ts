import 'server-only';

/**
 * Der gemeinsame Vertrag aller neun Werkzeuge (AGT-02, Invariante 6, K-10).
 *
 * **Vier Regeln, ausnahmslos.** Sie sind der Grund, warum diese Datei vor
 * jedem Werkzeug steht:
 *
 *  1. **Kein Werkzeugargument trägt `mandant_id`.** Die Gesellschaft kommt
 *     aus dem Kontext, den der Orchestrator setzt (Invariante 3). Das Schema,
 *     das ein Modell sieht, hat gar kein Feld dafür — es kann also nicht
 *     einmal versuchen, eines zu setzen.
 *  2. **Kein Werkzeugargument trägt Geld, Menge, Formel, Satz oder Datum.**
 *     Jedes davon ist ein Handle oder ein Registertoken. Eine Zahl, die ein
 *     Modell in ein Argument schreibt, ist eine geratene Zahl — und sie fällt
 *     bei einem Angebot über 486.000 € nicht in der Prüfung auf.
 *  3. **Vertrauen ist eine Eigenschaft je FELD, nicht je Ergebnis.** Ein
 *     Dokument kann eine wahre Adresse und eine erfundene Quadratmeterzahl
 *     enthalten; ein Ergebnis, das insgesamt „vertrauenswürdig" hiesse,
 *     machte die zweite unsichtbar.
 *  4. **Jede Zahl und jedes Datum eines Ergebnisses ist registriert.** Eine
 *     freistehende Zahl in erzeugtem Text ist ein Fehler, kein Schönheits-
 *     fehler: sie hat keine Herkunft, und niemand kann sie nachrechnen.
 *
 * **Die eine erklärte Ausnahme zu Regel 2** ist der Seitenbereich von
 * `lies_dokument` und `extrahiere_lv`: ein Lesefenster über ein Dokument, das
 * bereits über ein Handle aufgelöst wurde. Er geht in keine Rechnung und in
 * keine gespeicherte Zeile. Er ist trotzdem eine Zahl aus einem Modell und
 * deshalb **begrenzt, nicht vertraut** — siehe `pruefeSeitenbereich`.
 */

/* ------------------------------------------------------------------------ */
/* Handles — die einzige Form, in der ein Modell auf eine Zeile zeigen darf.  */
/* ------------------------------------------------------------------------ */

/**
 * **Ein Handle ist kein Bezeichner, sondern ein Gutschein.** Er wird je Lauf
 * von vertrauenswürdigem Code geprägt und zeigt auf eine Zeile, die dieser
 * Lauf bereits rechtmässig gelesen hat. Eine Kennung, die in einem Dokument,
 * einer E-Mail, einer OCR-Ausgabe oder einer Modellantwort auftaucht, ist
 * KEIN Handle und lässt sich nicht auflösen.
 *
 * Die Literaltypen sind Dokumentation, keine Zusicherung — zur Laufzeit sind
 * sie gelöscht, und `dok_-1` passt auf sie. Die echte Kontrolle ist
 * `HandleTresor.loese` (siehe `handles.ts`).
 */
export type DokumentHandle = `dok_${number}`;
export type ArtefaktHandle = `artefakt_${number}`;
export type ObjektHandle = `objekt_${number}`;
export type AuftragHandle = `auftrag_${number}`;
export type AngebotHandle = `angebot_${number}`;
export type AusschreibungHandle = `ausschr_${number}`;
export type PersonHandle = `person_${number}`;
export type EinsatzHandle = `einsatz_${number}`;
export type BezugHandle = `bezug_${number}`;
export type EmpfaengerHandle =
  | `kontakt_${number}` | `kandidat_${number}` | `lieferant_${number}` | `benutzer_${number}`;

/** Die Tabellen, auf die ein Handle zeigen kann — geschlossen, mit Absicht. */
export const HANDLE_TABELLEN = {
  dok: 'dokument',
  artefakt: 'agent_artefakt',
  objekt: 'objekt',
  auftrag: 'auftrag',
  angebot: 'angebot',
  ausschr: 'ausschreibung',
  person: 'person',
  einsatz: 'einsatz',
  bezug: '*',
  kontakt: 'kontakt',
  kandidat: 'kandidat',
  lieferant: 'lieferant',
  benutzer: 'benutzer',
} as const;

export type HandlePraefix = keyof typeof HANDLE_TABELLEN;

/** Ein Registertoken: `z7`. Die einzige Form, in der ein Modell eine Zahl nennt. */
export type WertToken = `z${number}`;

/* ------------------------------------------------------------------------ */
/* Herkunft, Vertrauen, gebundene Werte                                      */
/* ------------------------------------------------------------------------ */

export type Vertrauen = 'vertraut' | 'unvertraut';

export type Quelle =
  | {
    readonly art: 'dokument'; readonly dokument: string; readonly seite: number;
    readonly tabelle?: number; readonly zeile?: number; readonly spalte?: number;
    /** Wörtlich, höchstens 240 Zeichen — der Nachweis für APR-03. */
    readonly textausschnitt: string;
  }
  | {
    readonly art: 'wissen'; readonly chunkId: string; readonly seite: number | null;
    readonly textausschnitt: string;
  }
  | {
    readonly art: 'stammdaten'; readonly tabelle: string; readonly feld: string;
    readonly datensatzRef: string;
  }
  | {
    readonly art: 'berechnet'; readonly dienst: string; readonly dienstVersion: string;
    readonly eingabenHash: string;
  }
  | {
    readonly art: 'abfrage'; readonly abfrageId: string; readonly stand: string;
    readonly datensatzRefs: readonly string[];
  };

/** Ein Feld mit Herkunft. `unsicher` setzt eine Prüfregel, nie ein Modell. */
export interface Feld<T> {
  readonly wert: T;
  readonly quelle: Quelle;
  readonly vertrauen: Vertrauen;
  /** 0..1. Eine deterministische Quelle ist 1 — sie rät nicht. */
  readonly konfidenz: number;
  readonly unsicher: boolean;
  readonly pruefungen: readonly {
    readonly regel: string; readonly bestanden: boolean; readonly hinweis?: string;
  }[];
}

/**
 * Eine Zahl, Menge, Dauer oder ein DATUM, erzeugt von einem getesteten
 * Dienst (Invariante 6, AGT-07, K-10).
 *
 * **`anzeige` ist die einzige Form, die in einen Text darf.** Ein Modell, das
 * „456,00 €" schreiben soll, bekommt den Token `z7` und den fertigen String;
 * es rechnet nichts und formatiert nichts.
 */
export interface GebundenerWert {
  readonly token: WertToken;
  readonly art: 'geld' | 'menge' | 'dauer' | 'datum' | 'prozent';
  /** Geld ist IMMER ganzzahlige Cent (Invariante 1, K-16). */
  readonly betragCent?: bigint;
  /** Kanonische Dezimalzeichenkette für Mengen — nie ein Gleitkommawert. */
  readonly wert?: string;
  /** ISO-8601 UTC für `datum` (Invariante 2). */
  readonly instant?: string;
  readonly einheit?: string;
  /** Deutsch formatiert, Europe/Berlin für Daten (K-11). */
  readonly anzeige: string;
  readonly quelle: Quelle;
  readonly konfidenz: number;
  readonly unsicher: boolean;
  readonly abgeleitetVon: readonly string[];
}

/* ------------------------------------------------------------------------ */
/* Ergebnis und Fehler                                                       */
/* ------------------------------------------------------------------------ */

export type WerkzeugFehlerCode =
  /** Schliesst JEDEN mandantenfremden Treffer ein — 404, nie 403 (AUT-06). */
  | 'nicht_gefunden'
  | 'nicht_erlaubt'
  /** Die Zod-Grenze hat abgewiesen (SEC-A4). */
  | 'ungueltige_eingabe'
  /** AGT-07: „das kann ich aus dem Schema nicht beantworten." */
  | 'kein_ergebnis'
  | 'quelle_nicht_lesbar'
  /** AGT-05, harter Stopp. */
  | 'budget_erschoepft'
  /** Kanarienvogel: bricht den Lauf ab und meldet einen Sicherheitsvorfall. */
  | 'mandant_grenze'
  /** Es gibt keinen Modellanbieter — und deshalb kein Ergebnis (D-435). */
  | 'kein_modellzugang';

export type WerkzeugErgebnis<T> =
  | {
    readonly ok: true; readonly daten: T;
    readonly werte: readonly GebundenerWert[]; readonly dauerMs: number;
  }
  | {
    readonly ok: false;
    readonly fehler: { readonly code: WerkzeugFehlerCode; readonly nachricht: string };
  };

/* ------------------------------------------------------------------------ */
/* Nebenwirkungsklassen (§5.2)                                               */
/* ------------------------------------------------------------------------ */

/**
 * | Klasse | Bedeutung | Untergrenze der Richtlinie |
 * |---|---|---|
 * | `lesen` | keine Zustandsänderung | erlaubt |
 * | `entwurf` | schreibt nur ein `agent_artefakt` | erlaubt |
 * | `schreiben_mit_tor` | würde eine Fachzeile anlegen oder ändern | je Art |
 * | `versand` | verlässt das System | **immer Freigabe** |
 */
export type Nebenwirkung = 'lesen' | 'entwurf' | 'schreiben_mit_tor' | 'versand';

/**
 * Der begrenzte Seitenbereich — die EINZIGE Zahl, die ein Modell in ein
 * Argument schreiben darf, und auch sie nur so.
 *
 * Beide ganzzahlig, `1 ≤ von ≤ bis`, höchstens fünfzig Seiten, und `bis` wird
 * an der echten Seitenzahl des aufgelösten Dokuments gekappt. Was
 * herauskommt, nennt den tatsächlich gelesenen Bereich — nicht den erbetenen.
 */
export const SEITEN_HOECHSTZAHL = 50;

export interface Seitenbereich { readonly von: number; readonly bis: number }

export class WerkzeugEingabeFehler extends Error {
  readonly code: WerkzeugFehlerCode = 'ungueltige_eingabe';
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'WerkzeugEingabeFehler';
  }
}

export function pruefeSeitenbereich(
  roh: unknown, seitenImDokument: number | null,
): Seitenbereich | null {
  if (roh === undefined || roh === null) return null;
  if (typeof roh !== 'object') {
    throw new WerkzeugEingabeFehler('Der Seitenbereich ist kein Objekt.');
  }
  const { von, bis } = roh as { von?: unknown; bis?: unknown };
  if (!Number.isInteger(von) || !Number.isInteger(bis)) {
    throw new WerkzeugEingabeFehler('Seitenzahlen sind ganze Zahlen.');
  }
  const v = von as number;
  let b = bis as number;
  if (v < 1) throw new WerkzeugEingabeFehler('Die erste Seite ist 1.');
  if (b < v) throw new WerkzeugEingabeFehler('„bis" liegt vor „von".');
  if (seitenImDokument !== null && b > seitenImDokument) {
    /* Gekappt, nicht abgewiesen: „bis Seite 999" heisst „bis zum Ende". */
    b = seitenImDokument;
  }
  if (b - v + 1 > SEITEN_HOECHSTZAHL) {
    throw new WerkzeugEingabeFehler(
      `Höchstens ${String(SEITEN_HOECHSTZAHL)} Seiten je Aufruf.`);
  }
  return { von: v, bis: b };
}
