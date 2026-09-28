/**
 * Die Wörter des Vergaberadars und der Vergabemappe (RAD-06, RAD-07, V-232,
 * D-726) — je Enum eine Karte, deutsch und englisch.
 *
 * Die Stände eines Vorgangs standen als eigene Liste in der Radarliste und
 * noch einmal in der Gruppenübersicht, der Stand der Mappe nur auf der
 * Mappenseite — und das Vorgangsblatt zeigte ihn daneben roh („Stand:
 * in_arbeit"). Der letzte Lauf stand als „oeffentlichevergabe — uebersprungen"
 * über der Liste. Die Schlüssel sind die aus 0145 (`ausschreibung_status`,
 * `radar_lauf_status`, `ausschreibung_quelle`) und 0147 (`vergabemappe_status`).
 */
import type { Karte } from './basis.js';

export const AUSSCHREIBUNG_STATUS_TEXT: Karte<
  'neu' | 'geprueft' | 'in_bearbeitung' | 'eingereicht' | 'zuschlag'
  | 'nicht_beruecksichtigt' | 'verfahren_aufgehoben' | 'verworfen'> = {
  de: {
    neu: 'neu', geprueft: 'geprüft', in_bearbeitung: 'in Bearbeitung',
    eingereicht: 'eingereicht', zuschlag: 'Zuschlag',
    nicht_beruecksichtigt: 'nicht berücksichtigt',
    verfahren_aufgehoben: 'Verfahren aufgehoben', verworfen: 'verworfen',
  },
  en: {
    neu: 'new', geprueft: 'reviewed', in_bearbeitung: 'in progress',
    eingereicht: 'submitted', zuschlag: 'awarded', nicht_beruecksichtigt: 'not awarded',
    verfahren_aufgehoben: 'procedure cancelled', verworfen: 'discarded',
  },
};

export const MAPPE_STATUS_TEXT: Karte<
  'offen' | 'in_arbeit' | 'vollstaendig' | 'freigegeben' | 'eingereicht' | 'verworfen'> = {
  de: {
    offen: 'offen', in_arbeit: 'in Arbeit', vollstaendig: 'vollständig',
    freigegeben: 'freigegeben', eingereicht: 'eingereicht', verworfen: 'verworfen',
  },
  en: {
    offen: 'open', in_arbeit: 'in progress', vollstaendig: 'complete',
    freigegeben: 'approved', eingereicht: 'submitted', verworfen: 'discarded',
  },
};

export const RADAR_LAUF_STATUS_TEXT: Karte<
  'laeuft' | 'erfolg' | 'teilweise' | 'fehler' | 'uebersprungen'> = {
  de: {
    laeuft: 'läuft', erfolg: 'erfolgreich', teilweise: 'teilweise erfolgreich',
    fehler: 'fehlgeschlagen', uebersprungen: 'übersprungen',
  },
  en: {
    laeuft: 'running', erfolg: 'successful', teilweise: 'partly successful',
    fehler: 'failed', uebersprungen: 'skipped',
  },
};

/** Die Quellen des Radars mit ihrem Namen — dieselben wie in `services/radar/quelle.ts`. */
export const RADAR_QUELLE_TEXT: Karte<'oeffentlichevergabe' | 'ted'> = {
  de: { oeffentlichevergabe: 'oeffentlichevergabe.de (OCDS)', ted: 'TED Search API v3' },
  en: { oeffentlichevergabe: 'oeffentlichevergabe.de (OCDS)', ted: 'TED Search API v3' },
};
