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
