/**
 * Wie die vier Bereiche im Web erreichbar sind.
 *
 * **Offen (O-08).** Ob jeder Bereich eine eigene Domain bekommt oder alle
 * unter einer Gruppendomain als Pfad liegen, hat der Mandant nicht
 * entschieden. Die Wahl ist nicht kosmetisch: eigene Domains bedeuten eigene
 * SEO-Autoritaet und eigene Zertifikate, Pfade bedeuten eine gemeinsame.
 *
 * Bis zur Antwort gilt der Pfad — er funktioniert ohne DNS-Arbeit und laesst
 * sich spaeter auf Domains umlegen, was umgekehrt nicht gilt.
 *
 * // TODO(client): O-08 — eigene Domains je Bereich oder Pfade unter einer
 * // Gruppendomain?
 */

/** Leer, bis O-08 beantwortet ist. Ein erfundener Eintrag saehe entschieden aus. */
export const DOMAINS: Readonly<Record<string, string>> = {};

export function bereichsPfad(slug: string): string {
  const domain = DOMAINS[slug];
  return domain === undefined ? `/${slug}` : `https://${domain}`;
}

export function istPfadModus(): boolean {
  return Object.keys(DOMAINS).length === 0;
}

/* ── Der kanonische Host (O-08) ─────────────────────────────────────────── */

/**
 * Die absolute Basis fuer `sitemap.xml`, `robots.txt` und jeden JSON-LD-`@id`.
 *
 * **Warum das nicht im Code steht.** Solange O-08 offen ist, gibt es keine
 * entschiedene Domain. Eine hier eingetragene — `https://cse-gruppe.de` oder
 * aehnlich — waere geraten und wuerde als kanonische URL in jede Sitemap und
 * jeden `@id` wandern; ein spaeterer Wechsel entwertet genau die Autoritaet,
 * die diese Angaben aufbauen sollen. Ein falscher kanonischer Host ist
 * schlimmer als gar keiner: er sagt der Suchmaschine, die echte Seite sei
 * anderswo.
 *
 * Deshalb: die Umgebung nennt sie (`CSE_KANONISCHE_BASIS`), und bis dahin gilt
 * der Host der Anfrage. Der ist immer richtig, nur eben nicht stabil — und
 * `istKanonischEntschieden()` sagt jedem Aufrufer, welcher Fall vorliegt.
 *
 * // TODO(client): O-08 — unter welchem Host laeuft die Gruppenseite, und
 * // bekommt jeder Bereich eine eigene Domain?
 */
/**
 * Nur der Ausschnitt, den diese Datei liest. Als offener Record, weil
 * `process.env` keine projekteigenen Namen deklariert und ein Interface mit
 * genau einem unbekannten Feld deshalb keine Gemeinsamkeit mit `ProcessEnv`
 * haette — der Compiler lehnt die Vorgabe sonst ab.
 */
export type Umgebung = Readonly<Record<string, string | undefined>>;

export function istKanonischEntschieden(umgebung: Umgebung = process.env): boolean {
  const wert = umgebung['CSE_KANONISCHE_BASIS'];
  return wert !== undefined && wert !== '';
}

export class KeinHostFehler extends Error {
  constructor() {
    super(
      'Weder CSE_KANONISCHE_BASIS noch ein Host aus der Anfrage. Ohne absolute '
      + 'Basis gibt es keine kanonische URL — und eine geratene wäre schlechter '
      + 'als keine Sitemap.',
    );
    this.name = 'KeinHostFehler';
  }
}

/** Ohne Schrägstrich am Ende — jeder Aufrufer haengt einen Pfad an. */
export function kanonischeBasis(
  hostAusAnfrage: string | null = null, umgebung: Umgebung = process.env,
): string {
  const gesetzt = umgebung['CSE_KANONISCHE_BASIS'];
  if (gesetzt !== undefined && gesetzt !== '') return gesetzt.replace(/\/+$/u, '');
  if (hostAusAnfrage === null || hostAusAnfrage === '') throw new KeinHostFehler();
  const schema = hostAusAnfrage.startsWith('localhost') || hostAusAnfrage.startsWith('127.')
    ? 'http' : 'https';
  return `${schema}://${hostAusAnfrage}`;
}
