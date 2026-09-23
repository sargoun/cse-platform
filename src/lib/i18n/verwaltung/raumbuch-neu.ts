/**
 * Die Wörter des einzelnen Raums — in beiden Sprachen (V-012, OPS-02,
 * OPS-03, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** `Raumbuch`,
 * `Belagsart` und `Reinigungsklasse` sind die Begriffe, in denen der Vertrag
 * und die Kalkulation sprechen; erklärt wird in Klammern, ersetzt wird nicht.
 */
import type { InternSprache } from '../intern.js';

export interface RaumNeuTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly warum: string;
  readonly zumRaumbuch: string;

  readonly raumnummer: string;
  readonly raumnummerErklaerung: string;
  readonly bezeichnung: string;
  readonly bezeichnungErklaerung: string;
  readonly etage: string;
  readonly etageErklaerung: string;
  readonly nutzungsart: string;
  readonly flaeche: string;
  readonly flaecheErklaerung: string;
  readonly fensterflaeche: string;
  readonly fensterflaecheErklaerung: string;
  readonly belagsart: string;
  readonly ohneBelagsart: string;
  readonly belagsartErklaerung: string;
  readonly reinigungsklasse: string;
  readonly ohneKlasse: string;
  readonly sortierung: string;
  readonly sortierungErklaerung: string;
  readonly freiwillig: string;

  readonly anlegen: string;
  readonly abbrechen: string;
  readonly keinSchreibrecht: string;
  readonly importHinweis: string;

  readonly fehler: Readonly<Record<string, string>>;
}

const DE: RaumNeuTexte = {
  modul: 'Raumbuch',
  titel: 'Neuer Raum',
  untertitel: 'Ein einzelner Raum — ohne Datei, ohne Import.',
  warum:
    'Ein Raum kam bisher nur aus einer CSV- oder Excel-Datei. Für den Anbau, das '
    + 'neue WC oder den Raum, der beim Import gefehlt hat, musste man eine Datei '
    + 'bauen, um eine Zeile zu ergänzen.',
  zumRaumbuch: 'Zum Raumbuch',

  raumnummer: 'Raumnummer',
  raumnummerErklaerung:
    'Die Türnummer. Nummer oder Bezeichnung ist Pflicht — eines von beiden.',
  bezeichnung: 'Bezeichnung',
  bezeichnungErklaerung: 'Für Flur, Treppenhaus oder WC-Vorraum, die keine Nummer tragen.',
  etage: 'Etage',
  etageErklaerung:
    'Text und keine Zahl: „UG", „EG", „1", „ZG". Die Etage gehört zum Schlüssel — '
    + '„101" im Untergeschoss ist nicht „101" im ersten Obergeschoss.',
  nutzungsart: 'Nutzungsart',
  flaeche: 'Fläche in m²',
  flaecheErklaerung: 'Deutsch schreiben: 12,5 — der Punkt ist der Tausendertrenner.',
  fensterflaeche: 'Fensterfläche in m²',
  fensterflaecheErklaerung:
    'Die Glasreinigung rechnet auf Glasfläche, nicht auf Bodenfläche (CLN-05).',
  belagsart: 'Belagsart',
  ohneBelagsart: 'ohne Belagsart',
  belagsartErklaerung:
    'Ohne Belagsart entsteht der Raum trotzdem — er trägt dann aber zu keiner '
    + 'Kalkulation bei, und das Angebot weist die nicht bepreisbare Fläche aus.',
  reinigungsklasse: 'Reinigungsklasse',
  ohneKlasse: 'ohne Reinigungsklasse',
  sortierung: 'Sortierung',
  sortierungErklaerung: 'Bestimmt nur die Reihenfolge in der Liste.',
  freiwillig: 'freiwillig',

  anlegen: 'Raum anlegen',
  abbrechen: 'Abbrechen',
  keinSchreibrecht: 'Zum Anlegen eines Raums fehlt Ihnen',
  importHinweis:
    'Für ein ganzes Gebäude ist der Dateiimport der schnellere Weg — er zeigt eine '
    + 'Vorschau, bevor er etwas übernimmt.',

  fehler: {
    ohne_kennung:
      'Nummer oder Bezeichnung ist Pflicht — sonst ist der Raum in der Liste von '
      + 'jedem anderen unbenannten nicht zu unterscheiden.',
    flaeche_unlesbar:
      'Die Fläche war nicht lesbar. Deutsch schreiben: 12,5 — der Punkt ist der '
      + 'Tausendertrenner.',
    flaeche_null:
      'Die Fläche muss größer als null sein. Ein Raum ohne Fläche trägt zu keinem '
      + 'Preis bei.',
    nummer_belegt: 'In dieser Etage trägt schon ein Raum diese Nummer.',
    bezeichnung_belegt:
      'In dieser Etage trägt schon ein Raum ohne Nummer diese Bezeichnung.',
    fremde_belagsart: 'Diese Belagsart gehört nicht zu dieser Gesellschaft.',
    fremde_klasse: 'Diese Reinigungsklasse gehört nicht zu dieser Gesellschaft.',
    nicht_gefunden: 'Dieses Objekt gibt es in dieser Gesellschaft nicht.',
    objekt_archiviert:
      'Dieses Objekt ist archiviert. Ein archiviertes Objekt bekommt keine neuen Räume.',
    kein_recht: 'Ihnen fehlt objekt.schreiben.',
  },
};

const EN: RaumNeuTexte = {
  modul: 'Raumbuch (room register)',
  titel: 'New room',
  untertitel: 'A single room — no file, no import.',
  warum:
    'Until now a room could only come from a CSV or Excel file. For an extension, a '
    + 'new toilet, or a room the import missed, you had to build a file just to add '
    + 'one line.',
  zumRaumbuch: 'To the Raumbuch',

  raumnummer: 'Room number',
  raumnummerErklaerung: 'The door number. Number or label is required — one of the two.',
  bezeichnung: 'Label',
  bezeichnungErklaerung: 'For corridors, stairwells or lobbies that carry no number.',
  etage: 'Floor',
  etageErklaerung:
    'Text, not a number: “UG”, “EG”, “1”, “ZG”. The floor is part of the key — “101” '
    + 'in the basement is not “101” on the first floor.',
  nutzungsart: 'Use',
  flaeche: 'Area in m²',
  flaecheErklaerung: 'German notation: 12,5 — the dot is the thousands separator.',
  fensterflaeche: 'Glass area in m²',
  fensterflaecheErklaerung:
    'Window cleaning is charged on glass area, not on floor area (CLN-05).',
  belagsart: 'Belagsart (floor covering)',
  ohneBelagsart: 'no Belagsart',
  belagsartErklaerung:
    'Without a Belagsart the room is still created — but it contributes to no '
    + 'calculation, and the offer reports the area that cannot be priced.',
  reinigungsklasse: 'Reinigungsklasse (cleaning class)',
  ohneKlasse: 'no Reinigungsklasse',
  sortierung: 'Sort order',
  sortierungErklaerung: 'Affects the order in the list, nothing else.',
  freiwillig: 'optional',

  anlegen: 'Create room',
  abbrechen: 'Cancel',
  keinSchreibrecht: 'To create a room you are missing',
  importHinweis:
    'For a whole building the file import is the faster way — it shows a preview '
    + 'before it commits anything.',

  fehler: {
    ohne_kennung:
      'Number or label is required — otherwise the room cannot be told apart from '
      + 'every other unnamed one in the list.',
    flaeche_unlesbar:
      'The area could not be read. German notation: 12,5 — the dot is the thousands '
      + 'separator.',
    flaeche_null:
      'The area must be greater than zero. A room without area contributes to no price.',
    nummer_belegt: 'A room on this floor already carries this number.',
    bezeichnung_belegt: 'A room without a number on this floor already carries this label.',
    fremde_belagsart: 'This Belagsart does not belong to this Mandant (company).',
    fremde_klasse: 'This Reinigungsklasse does not belong to this Mandant (company).',
    nicht_gefunden: 'This Objekt (site) does not exist in this Mandant (company).',
    objekt_archiviert:
      'This Objekt (site) is archived. An archived site takes no new rooms.',
    kein_recht: 'You are missing objekt.schreiben.',
  },
};

export const RAUM_NEU_TEXTE: Readonly<Record<InternSprache, RaumNeuTexte>> = {
  de: DE, en: EN,
};
