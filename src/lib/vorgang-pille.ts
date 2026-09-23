/**
 * Die Pille je Zustand eines Vorgangs der Kette — Lead, Angebot, Auftrag,
 * Rechnung (V-138, DESIGN §5).
 *
 * Dieselben Abbildungen standen bis hierher je Seite einzeln
 * (`angebote/page.tsx`, `auftraege/page.tsx`, `finanzen/rechnungen/page.tsx`,
 * `crm/leads/[id]/page.tsx`). Das Leadblatt und das Kundenblatt zeigen jetzt
 * alle vier Stufen nebeneinander; eine fünfte Kopie wäre die, die beim
 * nächsten neuen Zustand vergessen wird. Der Wert ist der deutsche
 * Pillenzustand — er wählt die Farbe, die Sprache färbt nur das Wort
 * (`i18n/pille.ts`).
 */
import type { PillZustand } from './i18n/pille.js';

export const LEAD_PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen', in_bearbeitung: 'In Arbeit', angebot: 'Angebot',
  gewonnen: 'Abgeschlossen', verloren: 'Abgelehnt', kein_bedarf: 'Archiviert',
};

export const ANGEBOT_PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf', in_pruefung: 'In Prüfung', versendet: 'Angebot',
  angenommen: 'Aktiv', abgelehnt: 'Abgelehnt', zurueckgezogen: 'Archiviert',
  abgelaufen: 'Überfällig',
};

export const AUFTRAG_PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant', aktiv: 'In Arbeit', pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen', storniert: 'Abgelehnt',
};

/** `Abgeschlossen` für festgeschrieben — dieselbe Wahl wie die Rechnungsliste. */
export const RECHNUNG_PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf', festgeschrieben: 'Abgeschlossen', verworfen: 'Archiviert',
};
