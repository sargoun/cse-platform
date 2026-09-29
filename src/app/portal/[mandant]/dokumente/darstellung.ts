/** Beschriftungen und Anzeigehelfer der Ablage — keine Rechnung mit Bedeutung. */
export const KATEGORIE: Readonly<Record<string, string>> = {
  kunde: 'Kunde', vertrag: 'Vertrag', angebot: 'Angebot', rechnung: 'Rechnung', beleg: 'Beleg',
  mitarbeiter: 'Mitarbeiter', projekt: 'Projekt', buchhaltung: 'Buchhaltung', unternehmen: 'Unternehmen',
};
export const KATEGORIEN: readonly string[] = Object.keys(KATEGORIE);

/** `%`, `_` und `\` sind in ILIKE Muster — als Zeichen gemeint, also maskiert. */
export function ilikeMuster(q: string): string {
  return `%${q.replace(/[\\%_]/gu, (z) => `\\${z}`)}%`;
}
