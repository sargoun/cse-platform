/**
 * Die Wörter des Agentenzentrums (AGT-01…AGT-04) — Werkzeuge, ihre
 * Nebenwirkung und die Untergrenze der Richtlinie (V-228, D-722).
 *
 * Die Schlüssel sind die aus 0128/0150 (`agent_werkzeug_name`) und aus
 * `agent/tools/typen.ts` (`Nebenwirkung`); `tests/kern/beschriftung.test.ts`
 * prüft, dass jede der neun Werkzeugkennungen aus `WERKZEUGE` ein Wort hat.
 */
import type { Karte } from './basis.js';

export type WerkzeugSchluessel =
  | 'lies_dokument' | 'extrahiere_lv' | 'suche_bestand' | 'berechne_preis'
  | 'pruefe_nachweise' | 'pruefe_bilder' | 'entwirf_text' | 'sende_email'
  | 'erstelle_vorgang';

export const WERKZEUG_TEXT: Karte<WerkzeugSchluessel> = {
  de: {
    lies_dokument: 'Dokument lesen',
    extrahiere_lv: 'Leistungsverzeichnis auslesen',
    suche_bestand: 'Bestand abfragen',
    berechne_preis: 'Preis berechnen',
    pruefe_nachweise: 'Nachweise prüfen',
    pruefe_bilder: 'Fotos sichten',
    entwirf_text: 'Text entwerfen',
    sende_email: 'E-Mail senden',
    erstelle_vorgang: 'Vorgang anlegen',
  },
  en: {
    lies_dokument: 'Read a document',
    extrahiere_lv: 'Extract a bill of quantities (Leistungsverzeichnis)',
    suche_bestand: 'Query the records',
    berechne_preis: 'Calculate a price',
    pruefe_nachweise: 'Check certificates',
    pruefe_bilder: 'Review photos',
    entwirf_text: 'Draft a text',
    sende_email: 'Send an email',
    erstelle_vorgang: 'Create a record',
  },
};

export const NEBENWIRKUNG_TEXT: Karte<'lesen' | 'entwurf' | 'schreiben_mit_tor' | 'versand'> = {
  de: {
    lesen: 'liest nur',
    entwurf: 'schreibt nur einen Entwurf',
    schreiben_mit_tor: 'würde eine Fachzeile anlegen oder ändern',
    versand: 'verlässt das Haus',
  },
  en: {
    lesen: 'reads only',
    entwurf: 'writes a draft only',
    schreiben_mit_tor: 'would create or change a business record',
    versand: 'leaves the company',
  },
};

export const UNTERGRENZE_TEXT: Karte<'erlaubt' | 'je_art' | 'freigabe_erforderlich'> = {
  de: {
    erlaubt: 'darf ohne Freigabe laufen',
    je_art: 'je nach Art des Vorgangs',
    freigabe_erforderlich: 'immer mit menschlicher Freigabe',
  },
  en: {
    erlaubt: 'may run without approval',
    je_art: 'depends on the kind of record',
    freigabe_erforderlich: 'always with human approval',
  },
};
