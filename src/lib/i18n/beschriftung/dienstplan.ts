/**
 * Die Wörter des Dienstplans (TIM-01, SEC-06, V-232, D-726).
 *
 * Der Stand einer Einteilung (`zuordnung_status`, 0028) stand im
 * Veranstaltungsblatt roh („nicht_erschienen").
 */
import type { Karte } from './basis.js';

export const ZUORDNUNG_STATUS_TEXT: Karte<
  'geplant' | 'zugesagt' | 'abgesagt' | 'ersetzt' | 'nicht_erschienen'> = {
  de: {
    geplant: 'geplant', zugesagt: 'zugesagt', abgesagt: 'abgesagt', ersetzt: 'ersetzt',
    nicht_erschienen: 'nicht erschienen',
  },
  en: {
    geplant: 'planned', zugesagt: 'confirmed', abgesagt: 'declined', ersetzt: 'replaced',
    nicht_erschienen: 'no-show',
  },
};
