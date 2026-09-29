/**
 * Die Wörter der Zeitwirtschaft auf der Verwaltungsseite (TIM-06, V-232,
 * D-726).
 *
 * Der Stand eines Einwands (`einwand_status`, 0052) stand auf dem Einwandblatt
 * als Wort und auf der Korrekturseite roh („Stand: in_pruefung"). Das
 * Arbeiterportal hat seine eigene Karte in vier Sprachen, aus Sicht der
 * Person, die den Einwand erhebt (`EINWAND_STATUS_TEXTE`, `i18n/texte.ts`);
 * diese hier spricht die Planung an.
 */
import type { Karte } from './basis.js';

export const EINWAND_STATUS_TEXT: Karte<
  'offen' | 'in_pruefung' | 'anerkannt' | 'teilweise_anerkannt' | 'abgelehnt'
  | 'zurueckgezogen'> = {
  de: {
    offen: 'Offen', in_pruefung: 'In Prüfung', anerkannt: 'Anerkannt',
    teilweise_anerkannt: 'Teilweise anerkannt', abgelehnt: 'Abgelehnt',
    zurueckgezogen: 'Zurückgezogen',
  },
  en: {
    offen: 'Open', in_pruefung: 'Under review', anerkannt: 'Accepted',
    teilweise_anerkannt: 'Partly accepted', abgelehnt: 'Rejected',
    zurueckgezogen: 'Withdrawn',
  },
};
