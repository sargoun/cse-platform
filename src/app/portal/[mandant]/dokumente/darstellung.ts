/** Beschriftungen und Anzeigehelfer der Ablage — keine Rechnung mit Bedeutung. */
export const KATEGORIE: Readonly<Record<string, string>> = {
  kunde: 'Kunde', vertrag: 'Vertrag', angebot: 'Angebot', rechnung: 'Rechnung', beleg: 'Beleg',
  mitarbeiter: 'Mitarbeiter', projekt: 'Projekt', buchhaltung: 'Buchhaltung', unternehmen: 'Unternehmen',
};
export const KATEGORIEN: readonly string[] = Object.keys(KATEGORIE);

export function formatiereBytes(bytes: string | null): string {
  if (bytes === null) return '—';
  const b = Number(bytes);
  if (!Number.isFinite(b) || b < 0) return '—';
  if (b < 1024) return `${String(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** `%`, `_` und `\` sind in ILIKE Muster — als Zeichen gemeint, also maskiert. */
export function ilikeMuster(q: string): string {
  return `%${q.replace(/[\\%_]/gu, (z) => `\\${z}`)}%`;
}
