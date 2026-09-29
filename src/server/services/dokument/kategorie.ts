/**
 * Die neun Dokumentkategorien (DOC-01) und ihre Aufbewahrung (DOC-07).
 *
 * Die Liste ist SPEC DOC-01 woertlich und geschlossen. Die Fristen sind es
 * **nicht**: `loeschsperre` steht fest, wo eine gesetzliche Pflicht sie
 * erzwingt, und die Dauer daneben ist ein Platzhalter, bis der Mandant
 * antwortet (K-17, O-25).
 */

export const KATEGORIEN = [
  'kunde', 'vertrag', 'angebot', 'rechnung', 'beleg',
  'mitarbeiter', 'projekt', 'buchhaltung', 'unternehmen',
] as const;
export type Kategorie = (typeof KATEGORIEN)[number];

export interface AufbewahrungsRegel {
  readonly kategorie: Kategorie;
  /**
   * Jahre ab Ende des Entstehungsjahres, oder `null`, wenn die Frist offen
   * ist. `null` ist NICHT "keine Frist": zusammen mit `loeschsperre = true`
   * heisst es "unbekannte Pflicht wird als Pflicht behandelt".
   */
  readonly jahre: number | null;
  /** Darf ueberhaupt geloescht werden? */
  readonly loeschsperre: boolean;
  /** Die Rechtsgrundlage — sie steht in der Zeile, nicht im Gedaechtnis. */
  readonly grundlage: string;
  /** Ist die Dauer bestaetigt oder ein Platzhalter (K-17)? */
  readonly istPlatzhalter: boolean;
}

/**
 * // TODO(client): O-25 — Aufbewahrungsfristen je Dokumentkategorie ueber das
 * // gesetzliche Minimum hinaus? Bis zur Antwort gilt ausschliesslich das
 * // Minimum, und wo keines feststeht, gilt die Sperre.
 */
export const AUFBEWAHRUNG: readonly AufbewahrungsRegel[] = [
  { kategorie: 'rechnung', jahre: 10, loeschsperre: true,
    grundlage: '§ 147 AO, § 14b UStG — 10 Jahre', istPlatzhalter: false },
  { kategorie: 'buchhaltung', jahre: 10, loeschsperre: true,
    grundlage: '§ 147 AO, § 257 HGB — 10 Jahre', istPlatzhalter: false },
  { kategorie: 'beleg', jahre: 10, loeschsperre: true,
    grundlage: '§ 147 AO — Buchungsbelege, 10 Jahre', istPlatzhalter: false },
  { kategorie: 'vertrag', jahre: 10, loeschsperre: true,
    grundlage: '§ 257 HGB — Handelsbriefe, mit Rechnungsbezug 10 Jahre', istPlatzhalter: false },
  { kategorie: 'angebot', jahre: 6, loeschsperre: false,
    grundlage: '§ 257 HGB — empfangene Handelsbriefe, 6 Jahre', istPlatzhalter: false },
  { kategorie: 'kunde', jahre: 6, loeschsperre: false,
    grundlage: '§ 257 HGB — Handelskorrespondenz, 6 Jahre', istPlatzhalter: false },
  // Personalunterlagen: die Fristen sind uneinheitlich (Lohnkonto 6 Jahre,
  // Arbeitszeitnachweise 2 Jahre MiLoG, Berufsgenossenschaft laenger). Welche
  // hier gilt, haengt vom Dokument ab, nicht von der Kategorie — deshalb
  // offen und gesperrt, statt eine Zahl zu waehlen.
  { kategorie: 'mitarbeiter', jahre: null, loeschsperre: true,
    grundlage: 'offen — je Unterlage verschieden (O-25)', istPlatzhalter: true },
  { kategorie: 'projekt', jahre: null, loeschsperre: true,
    grundlage: 'offen — VOB/B-Gewaehrleistung je Vertrag (O-25)', istPlatzhalter: true },
  { kategorie: 'unternehmen', jahre: null, loeschsperre: true,
    grundlage: 'offen — Gesellschaftsunterlagen (O-25)', istPlatzhalter: true },
];

export function regelFuer(kategorie: Kategorie): AufbewahrungsRegel {
  const r = AUFBEWAHRUNG.find((x) => x.kategorie === kategorie);
  if (r === undefined) {
    // Unerreichbar, solange der Typ haelt — aber wenn eine zehnte Kategorie
    // dazukaeme, ist ein Fehler besser als eine stillschweigend fehlende
    // Aufbewahrungspflicht.
    throw new Error(`Keine Aufbewahrungsregel fuer ${kategorie}.`);
  }
  return r;
}

/**
 * **Welche Kategorien eine zweite Fassung bekommen** (DOC-05, V-219, D-713).
 *
 * DOC-05 sagt „versioning where the document type warrants it" und nennt die
 * Typen nicht. Fest steht nur die eine Seite: Rechnung, Beleg und
 * Buchhaltungsunterlage bekommen KEINE neue Fassung — GoBD und § 147 AO
 * verlangen, dass ein Buchungsbeleg unverändert bleibt, und berichtigt wird
 * durch Gegenbuchung bzw. Storno (Invariante 4), nie durch den Austausch der
 * Datei. Dieselbe Liste prüft die Datenbank (`kern.dokument_fassung_pruefen`,
 * 0470); eine Änderung hier ohne dort wäre eine zweite Wahrheit.
 */
export const FASSUNG_GESPERRT: readonly Kategorie[] = ['rechnung', 'beleg', 'buchhaltung'];

/**
 * Die übrigen sechs — ein PLATZHALTER, kein Urteil.
 *
 * TODO(client, O-937): Welche Dokumentkategorien sollen überhaupt Fassungen
 * führen („where the document type warrants it", DOC-05) — alle übrigen sechs,
 * oder etwa nur Vertrag, Angebot und Projektunterlage? Bis zur Antwort sperrt
 * die Plattform nur, was GoBD sperrt, und lässt die übrigen sechs zu.
 */
export const FASSUNG_ERLAUBT_PLATZHALTER: readonly Kategorie[] =
  KATEGORIEN.filter((k) => !FASSUNG_GESPERRT.includes(k));

/** Bekommt ein Dokument dieser Kategorie eine neue Fassung? */
export function fassungMoeglich(kategorie: string): boolean {
  return (FASSUNG_ERLAUBT_PLATZHALTER as readonly string[]).includes(kategorie);
}
