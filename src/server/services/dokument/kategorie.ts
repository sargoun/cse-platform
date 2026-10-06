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
  // Seit 0489 (D-779) Voreinstellungen — `istPlatzhalter` heisst „von der
  // Buchhaltung noch nicht bestaetigt", die Loeschsperre bleibt.
  { kategorie: 'mitarbeiter', jahre: 6, loeschsperre: true,
    grundlage: 'Voreinstellung — § 41 EStG Lohnunterlagen, § 28f SGB IV: 6 Jahre (O-25)', istPlatzhalter: true },
  { kategorie: 'projekt', jahre: 10, loeschsperre: true,
    grundlage: 'Voreinstellung — § 147 AO Abrechnungsunterlagen, VOB/B § 13 Gewährleistung: 10 Jahre (O-25)', istPlatzhalter: true },
  { kategorie: 'unternehmen', jahre: 10, loeschsperre: true,
    grundlage: 'Voreinstellung — § 257 HGB Gesellschaftsunterlagen: 10 Jahre (O-25)', istPlatzhalter: true },
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

/**
 * **Welche Kategorien das Haus verlassen duerfen** — die Voreinstellungen zu
 * O-736 (Kunde) und O-851 (Belegschaft), D-780.
 *
 * Die Frage war offen, und die Datenbank prueft bis heute nur das Recht bzw.
 * den Schalter. Seit D-780 gilt eine Voreinstellung, und sie steht an EINER
 * Stelle: `setzeKundenfreigabe`, `setzeMitarbeiterfreigabe` und die Ablage
 * (`pruefeFelder`) weisen alles andere ab. Die Ruecknahme einer Freigabe
 * bleibt fuer jede Kategorie moeglich — ein falsch freigegebenes Dokument
 * muss man immer wieder sperren koennen.
 *
 * TODO(client, O-736): Voreinstellung — an einen KUNDEN gehen `kunde`
 * (Schriftverkehr mit ihm), `angebot`, `vertrag`, `rechnung` und `projekt`
 * (Leistungsnachweise, Berichte, Aufmasse fuer ihn); nie `mitarbeiter`,
 * `buchhaltung`, `beleg` oder `unternehmen`.
 * TODO(client, O-851): Voreinstellung — an die BELEGSCHAFT gehen
 * `unternehmen` (Dienstanweisungen, Aushaenge, Schulungsunterlagen,
 * Bescheinigungen der Gesellschaft) und `projekt` (Objektunterlagen,
 * Dienstplaene, Nachweise); nie `mitarbeiter` (eine Personalakte gehoert
 * einer Person, nicht der Belegschaft), nie Kunden-, Vertrags-, Angebots-,
 * Rechnungs-, Beleg- oder Buchhaltungsunterlagen.
 */
export const KUNDENFREIGABE_KATEGORIEN: readonly Kategorie[] =
  ['kunde', 'angebot', 'vertrag', 'rechnung', 'projekt'];
export const MITARBEITERFREIGABE_KATEGORIEN: readonly Kategorie[] = ['unternehmen', 'projekt'];

/** Darf ein Dokument dieser Kategorie an einen Kunden freigegeben werden? */
export function kundenfreigabeMoeglich(kategorie: string): boolean {
  return (KUNDENFREIGABE_KATEGORIEN as readonly string[]).includes(kategorie);
}

/** Darf ein Dokument dieser Kategorie der Belegschaft freigegeben werden? */
export function mitarbeiterfreigabeMoeglich(kategorie: string): boolean {
  return (MITARBEITERFREIGABE_KATEGORIEN as readonly string[]).includes(kategorie);
}
