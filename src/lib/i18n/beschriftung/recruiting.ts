/**
 * Die Wörter der Veröffentlichung einer Stelle (REC-09, V-232, D-726).
 *
 * Das Ergebnis eines Veröffentlichungsversuchs (`veroeffentlichung_ergebnis`,
 * 0166) stand auf dem Stellenblatt als Wort und auf der Veröffentlichungsseite
 * roh („Letzter Versuch: nicht_verbunden").
 */
import type { Karte } from './basis.js';

export const VEROEFFENTLICHUNG_ERGEBNIS_TEXT: Karte<
  'offen' | 'veroeffentlicht' | 'nicht_verbunden' | 'fehlgeschlagen'> = {
  de: {
    offen: 'noch nicht versucht', veroeffentlicht: 'veröffentlicht',
    nicht_verbunden: 'nicht verbunden', fehlgeschlagen: 'fehlgeschlagen',
  },
  en: {
    offen: 'not yet attempted', veroeffentlicht: 'published',
    nicht_verbunden: 'not connected', fehlgeschlagen: 'failed',
  },
};
