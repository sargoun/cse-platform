/**
 * Die Mengen hinter den Kennzahlen — EIN Ort für jedes Prädikat, das eine
 * Zahl und ihre Liste teilen (DSH-01, DSH-04, V-149, V-150, D-643, D-644).
 *
 * **Der Befund.** Eine Kachel zählt mit `zaehlung`, die Liste dahinter holt
 * mit ihrer eigenen Abfrage. Solange die Liste keinen Filter kennt, zeigt sie
 * ALLE Aufträge, während die Kachel „aktive" zählt — 14 auf der Kachel, 31 in
 * der Liste, und niemand kann sagen, welche Zahl lügt. Die Gruppenübersicht
 * zählte „Angebote offen" als `entwurf`, `in_pruefung`, `versendet` — eine
 * Menge, die sonst nirgends stand.
 *
 * Hier stehen die Werte deshalb einmal: die Kachel baut ihr Prädikat daraus,
 * die Liste liest ihren Filter dagegen, die Gruppenübersicht zählt damit.
 * Ein vierter Status in einer Menge ändert alle drei zugleich.
 *
 * **Keine Fachregel, eine Benennung.** Welche Stände „offen" oder „aktiv"
 * heissen, folgt den Aufzählungen selbst (0024, 0025, 0071): ein Angebot ist
 * offen, solange niemand angenommen, abgelehnt, zurückgezogen hat und es nicht
 * abgelaufen ist; ein Auftrag ist aktiv, wenn sein Stand `aktiv` heisst; ein
 * Projekt ist in Arbeit, wenn seiner `in_arbeit` heisst.
 */

/** `auftrag_status` (0025). */
export const AUFTRAG_STATUS = ['angelegt', 'aktiv', 'pausiert', 'abgeschlossen', 'storniert'] as const;
export type AuftragStatus = (typeof AUFTRAG_STATUS)[number];

/** `projekt_status` (0071). */
export const PROJEKT_STATUS = ['geplant', 'in_arbeit', 'abgenommen', 'abgeschlossen', 'archiviert'] as const;
export type ProjektStatus = (typeof PROJEKT_STATUS)[number];

/** `angebot_status` (0024). */
export const ANGEBOT_STATUS = [
  'entwurf', 'in_pruefung', 'versendet', 'angenommen', 'abgelehnt', 'zurueckgezogen', 'abgelaufen',
] as const;
export type AngebotStatus = (typeof ANGEBOT_STATUS)[number];

/** `lead_status` (0017). */
export const LEAD_STATUS = [
  'neu', 'in_bearbeitung', 'angebot', 'gewonnen', 'verloren', 'kein_bedarf',
] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

/** Ein Angebot, über das noch nicht entschieden ist. */
export const ANGEBOT_OFFEN: readonly AngebotStatus[] = ['entwurf', 'in_pruefung', 'versendet'];

/**
 * Der Stand, den „Neue Anfragen" zählt — die Kachel im Bereich und die Spalte
 * der Gruppenübersicht (V-152). Beide führten auf die ungefilterte Liste.
 */
export const LEAD_NEU: LeadStatus = 'neu';

/** `?frist=ueberschritten` — die Leads, die die Kachel „Frist überschritten" zählt. */
export const FRIST_UEBERSCHRITTEN = 'ueberschritten';
export type LeadFrist = typeof FRIST_UEBERSCHRITTEN;

/**
 * Das Prädikat „Reaktionsfrist überschritten" — für die Kachel und für die
 * Liste, in der die Kachel ihre Zeilen zeigt (V-152). `alias` ist leer oder
 * ein Tabellenkürzel mit Punkt (`l.`); nichts anderes kommt hinein.
 */
export function fristUeberschrittenSql(alias: '' | 'l.'): string {
  return `${alias}sla_frist_am is not null and ${alias}erste_reaktion_am is null`
    + ` and ${alias}sla_frist_am < now()`;
}

/** Der Stand, den die Kachel „Aktive Aufträge" zählt. */
export const AUFTRAG_AKTIV: AuftragStatus = 'aktiv';

/** Der Stand, den die Kachel „Projekte in Arbeit" zählt. */
export const PROJEKT_IN_ARBEIT: ProjektStatus = 'in_arbeit';

const istAus = <T extends string>(liste: readonly T[], roh: unknown): roh is T =>
  typeof roh === 'string' && (liste as readonly string[]).includes(roh);

/** Ein Suchparameter als Auftragsstand — gegen die Werteliste, nie gegen eine Form. */
export function auftragStatusAus(roh: unknown): AuftragStatus | null {
  return istAus(AUFTRAG_STATUS, roh) ? roh : null;
}

export function projektStatusAus(roh: unknown): ProjektStatus | null {
  return istAus(PROJEKT_STATUS, roh) ? roh : null;
}

/** Ein Suchparameter als Leadstand — gegen die Werteliste (V-152). */
export function leadStatusAus(roh: unknown): LeadStatus | null {
  return istAus(LEAD_STATUS, roh) ? roh : null;
}

/** `?frist=ueberschritten` — sonst kein Fristfilter. */
export function leadFristAus(roh: unknown): LeadFrist | null {
  return roh === FRIST_UEBERSCHRITTEN ? FRIST_UEBERSCHRITTEN : null;
}

/** `?status=offen` auf der Angebotsliste — die eine Sammelangabe, die es gibt. */
export function angebotFilterAus(roh: unknown): 'offen' | AngebotStatus | null {
  if (roh === 'offen') return 'offen';
  return istAus(ANGEBOT_STATUS, roh) ? roh : null;
}

/** Die Stände, die ein Angebotsfilter meint — `null` heisst: alle. */
export function angebotStaende(filter: 'offen' | AngebotStatus | null): readonly string[] | null {
  if (filter === null) return null;
  return filter === 'offen' ? ANGEBOT_OFFEN : [filter];
}

/**
 * Eine Werteliste als SQL-Literal — NUR für die Konstanten dieser Datei.
 *
 * Die Kacheln sind statische Anweisungen, die beim Registrieren feststehen;
 * ein Parameter ist dort nicht vorgesehen (`$1` ist die Mandantenliste).
 * Deshalb wird hier geprüft, dass nichts als ein Aufzählungswert hineinkommt.
 */
export function sqlWerte(werte: readonly string[]): string {
  for (const w of werte) {
    if (!/^[a-z_]+$/u.test(w)) throw new Error(`Kein Aufzählungswert: ${w}`);
  }
  return werte.map((w) => `'${w}'`).join(', ');
}
