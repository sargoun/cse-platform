/**
 * Objekte anlegen, ändern, archivieren — in beiden Sprachen (D-82, D-592).
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `./basis.ts`). Hier betrifft das drei Wörter, und alle drei aus demselben
 * Grund: sie sind Schlüssel, nicht Beschreibungen.
 *
 *  - **`Objekt`** heisst hier nicht „object" — es ist der ORT, an dem
 *    gearbeitet wird, und steht so in Dienstanweisungen, auf
 *    Schlüsselschildern und in jedem Leistungsnachweis. Im englischen Text
 *    steht deshalb `Objekt (the site — a building or grounds)`.
 *  - **`Leistungsnachweis`** ist der gegengezeichnete Nachweis erbrachter
 *    Leistung; „service record" trifft die vertragliche Bedeutung nicht.
 *  - **`Einsatz`** ist die geplante Schicht auf einem Objekt.
 *
 * **Die Objektnummer ist im Englischen `Objektnummer`**, nicht „object
 * number": sie ist genau die Zeichenkette, die auf dem Schlüsselschild steht.
 * Wer sie übersetzt, sucht danach vergeblich.
 */
import type { InternSprache } from '../intern.js';
import { rechtName } from '../rechtname.js';

export interface ObjekteTexte {
  /* ── Die Reiter des Objektblatts (V-044, SEITENKARTE §5.4) ─────────── */
  readonly reiter: Readonly<Record<string, string>>;
  readonly reiterLeer: string;
  readonly reiterAlle: string;
  readonly einsaetzeFenster: string;

  /* ── Überschriften ─────────────────────────────────────────────────── */
  readonly neuTitel: string;
  readonly bearbeitenTitel: string;
  readonly alleObjekte: string;
  readonly neuesObjekt: string;
  readonly bearbeiten: string;
  readonly ersteAnlegen: string;

  /* ── Gliederung des Formulars ──────────────────────────────────────── */
  readonly was: string;
  readonly wo: string;
  readonly wem: string;
  readonly intern: string;
  readonly archivieren: string;

  /* ── Felder ────────────────────────────────────────────────────────── */
  readonly bezeichnung: string;
  readonly bezeichnungBeispiel: string;
  readonly objektnummer: string;
  readonly objektnummerBeispiel: string;
  readonly objektnummerHinweis: string;
  readonly gebaeudetyp: string;
  readonly gebaeudetypBeispiel: string;
  readonly etagen: string;
  readonly strasse: string;
  readonly hausnummer: string;
  readonly adresszusatz: string;
  readonly adresszusatzBeispiel: string;
  readonly plz: string;
  readonly ort: string;
  readonly land: string;
  readonly kunde: string;
  readonly ohneKunde: string;
  readonly zutritt: string;
  readonly zutrittBeispiel: string;
  readonly bemerkung: string;
  readonly freiwillig: string;

  /* ── Koordinaten (V-170, OPS-01, BAU-08) ───────────────────────────── */
  readonly koordinaten: string;
  readonly breitengrad: string;
  readonly laengengrad: string;
  readonly breitengradBeispiel: string;
  readonly laengengradBeispiel: string;
  readonly koordinatenHinweis: string;
  readonly ohneKoordinaten: string;
  /**
   * Die Abweisungen des Objektdienstes (`ObjektFehler.grund`). Fehlt ein
   * Schlüssel, zeigt die Seite `fehlerSonst` — nie den Schlüssel selbst und
   * nie Text aus der Adresse (V-153, V-240).
   */
  readonly fehler: Readonly<Record<string, string>>;
  /** `einsaetze_offen` — mit der Zahl aus `?anzahl=`, wenn sie eine ist (V-240). */
  readonly einsaetzeOffen: (anzahl: number | null) => string;
  readonly fehlerSonst: string;

  /* ── Sätze, die eine Entscheidung begründen ────────────────────────── */
  readonly anschriftPflicht: string;
  readonly kundeFreiwillig: string;
  readonly nurIntern: string;
  readonly nummerBleibt: string;
  readonly archivierenErklaerung: string;
  readonly archivierenKnopf: string;
  readonly istArchiviert: string;

  /* ── Knöpfe und Abweisungen ────────────────────────────────────────── */
  readonly objektAnlegen: string;
  readonly aenderungenSpeichern: string;
  readonly keinSchreibrechtAnlegen: string;
  readonly keinSchreibrechtAendern: string;
}

export const OBJEKTE_TEXTE: Readonly<Record<InternSprache, ObjekteTexte>> = {
  de: {
    reiter: {
      uebersicht: 'Übersicht',
      raumbuch: 'Raumbuch',
      reviere: 'Reviere',
      posten: 'Posten',
      dienstanweisungen: 'Dienstanweisungen',
      schluessel: 'Schlüssel',
      auftraege: 'Aufträge',
      einsaetze: 'Einsätze',
      dokumente: 'Dokumente',
      qualitaet: 'Qualität',
    },
    reiterLeer: 'Zu diesem Objekt ist hier nichts erfasst.',
    reiterAlle: 'Alle anzeigen',
    einsaetzeFenster: 'Die letzten dreißig Tage und alles Kommende — die '
      + 'vollständige Reihe steht im Dienstplan.',
    neuTitel: 'Neues Objekt',
    bearbeitenTitel: 'Objekt bearbeiten',
    alleObjekte: 'Alle Objekte',
    neuesObjekt: 'Neues Objekt',
    bearbeiten: 'Bearbeiten',
    ersteAnlegen: 'Das erste anlegen.',

    was: 'Was',
    wo: 'Wo',
    wem: 'Wem gehört der Ort?',
    intern: 'Intern',
    archivieren: 'Archivieren',

    bezeichnung: 'Bezeichnung',
    bezeichnungBeispiel: 'z. B. Bürohaus Kurfürstendamm 21',
    objektnummer: 'Objektnummer',
    objektnummerBeispiel: 'leer lassen — die Plattform zählt weiter',
    objektnummerHinweis:
      'Bleibt das Feld leer, zählt die Plattform aus dem Bestand dieser '
      + 'Gesellschaft weiter. Die Nummer lässt sich später nicht mehr ändern: sie '
      + 'steht auf Schlüsselschildern und auf jedem unterschriebenen '
      + 'Leistungsnachweis.',
    gebaeudetyp: 'Gebäudetyp',
    gebaeudetypBeispiel: 'z. B. Bürogebäude, Schule, Baustelle',
    etagen: 'Etagen',
    strasse: 'Strasse',
    hausnummer: 'Nr.',
    adresszusatz: 'Adresszusatz',
    adresszusatzBeispiel: 'z. B. Aufgang C, Hinterhaus',
    plz: 'PLZ',
    ort: 'Ort',
    land: 'Land',
    kunde: 'Kunde',
    ohneKunde: 'ohne Kundenbezug',
    zutritt: 'Zutritt',
    zutrittBeispiel: 'z. B. Schlüssel beim Pförtner, Code am Nebeneingang',
    bemerkung: 'Bemerkung',
    freiwillig: '(freiwillig)',

    koordinaten: 'Koordinaten',
    breitengrad: 'Breitengrad',
    laengengrad: 'Längengrad',
    breitengradBeispiel: 'z. B. 52,520008',
    laengengradBeispiel: 'z. B. 13,404954',
    koordinatenHinweis:
      'Freiwillig, aber beide oder keiner — in Dezimalgrad, mit Komma oder Punkt. '
      + 'Gespeichert werden sechs Nachkommastellen (etwa zehn Zentimeter). Das '
      + 'Wetter im Bautagebuch sucht damit die nächste Station. Eine Adresse wird '
      + 'nicht von selbst in Koordinaten umgerechnet (O-122); was hier steht, hat '
      + 'ein Mensch eingetragen.',
    ohneKoordinaten:
      'keine hinterlegt — das Wetter im Bautagebuch braucht sie',
    fehler: {
      bezeichnung_fehlt: 'Die Bezeichnung fehlt.',
      strasse_fehlt: 'Die Strasse fehlt.',
      ort_fehlt: 'Der Ort fehlt.',
      plz_fehlt: 'Die Postleitzahl fehlt.',
      plz_ungueltig: 'Eine deutsche Postleitzahl hat fünf Ziffern.',
      land_ungueltig:
        'Das Land ist ein Länderkürzel aus zwei Buchstaben (ISO 3166-1), z. B. DE.',
      etagen_ungueltig:
        'Die Zahl der Etagen ist eine ganze Zahl ohne Vorzeichen — das '
        + 'Untergeschoss zählt die Etagen nicht herunter.',
      koordinate_ungueltig:
        'Eine Koordinate ist keine Zahl in Dezimalgrad — z. B. 52,520008 und '
        + '13,404954.',
      koordinate_bereich:
        'Der Breitengrad liegt zwischen −90 und 90 Grad, der Längengrad zwischen '
        + '−180 und 180 Grad.',
      koordinaten_paar:
        'Koordinaten sind ein Paar: Breiten- UND Längengrad, oder keines von beiden.',
      objekt_unbekannt:
        'Dieses Objekt gibt es nicht mehr, oder es ist bereits archiviert.',
      // V-240: das Recht beim Namen, nicht als Schlüssel (wie V-144).
      kein_schreibrecht:
        `Das Objekt wurde nicht angelegt — es fehlt das Recht „${rechtName('objekt.schreiben', 'de')}“ `
        + 'in dieser Gesellschaft.',
      id_fehlt: 'Kein Objekt angegeben.',
    },
    einsaetzeOffen: (n) =>
      `Zu diesem Objekt stehen noch ${n === null ? '' : `${String(n)} `}Einsätze in der `
      + 'Zukunft. Stornieren Sie diese zuerst — sonst fährt morgen jemand an einen Ort, den '
      + 'es in der Plattform nicht mehr gibt.',
    fehlerSonst: 'Die Eingabe wurde abgewiesen. Bitte prüfen Sie die Angaben.',

    anschriftPflicht:
      'Die Anschrift ist Pflicht. Eine Schicht, die auf ein Objekt ohne '
      + 'Anschrift eingeteilt wird, schickt jemanden an keinen Ort.',
    kundeFreiwillig:
      'Freiwillig, und das ist kein Versehen. Ein Objekt ist ein ORT; die '
      + 'kaufmännische Beziehung hängt am Auftrag. Ein Veranstaltungsort '
      + 'existiert, bevor es einen Kundenstamm gibt, und dasselbe Gebäude wird zu '
      + 'Recht von Eigentümer und Mieter beauftragt. Wer den Kunden nicht kennt, '
      + 'soll ihn nicht erfinden.',
    nurIntern:
      'Steht nur im internen Portal. Der Kunde sieht diese beiden Felder nicht.',
    nummerBleibt:
      'Sie bleibt, wie sie ist. Sie steht auf Schlüsselschildern, in '
      + 'Dienstanweisungen und auf jedem unterschriebenen Leistungsnachweis.',
    archivierenErklaerung:
      'Das Objekt verschwindet aus allen Listen und lässt sich nicht mehr '
      + 'einteilen. Gelöscht wird nichts — an einem Objekt hängen '
      + 'Leistungsnachweise, Wachbücher und Zeiteinträge, und ein Löschen machte '
      + 'aus jedem davon eine Zeile ohne Ort. Die Objektnummer wird danach wieder '
      + 'frei; ein verkauftes Gebäude gibt sie ab. Stehen noch Einsätze in der '
      + 'Zukunft, weist die Plattform das Archivieren zurück.',
    archivierenKnopf: 'Objekt archivieren',
    istArchiviert:
      'Dieses Objekt ist archiviert. Es lässt sich nicht mehr ändern; seine '
      + 'Nummer ist wieder frei.',

    objektAnlegen: 'Objekt anlegen',
    aenderungenSpeichern: 'Änderungen speichern',
    keinSchreibrechtAnlegen: 'Zum Anlegen fehlt Ihnen',
    keinSchreibrechtAendern: 'Zum Ändern fehlt Ihnen',
  },
  en: {
    reiter: {
      uebersicht: 'Overview',
      raumbuch: 'Raumbuch (room book)',
      reviere: 'Reviere (cleaning districts)',
      posten: 'Posten (guard posts)',
      dienstanweisungen: 'Dienstanweisungen (standing orders)',
      schluessel: 'Keys',
      auftraege: 'Aufträge (orders)',
      einsaetze: 'Einsätze (shifts)',
      dokumente: 'Documents',
      qualitaet: 'Quality',
    },
    reiterLeer: 'Nothing is recorded here for this Objekt (site).',
    reiterAlle: 'Show all',
    einsaetzeFenster: 'The last thirty days and everything ahead — the full '
      + 'series is in the Dienstplan (roster).',
    neuTitel: 'New Objekt',
    bearbeitenTitel: 'Edit Objekt',
    alleObjekte: 'All Objekte',
    neuesObjekt: 'New Objekt',
    bearbeiten: 'Edit',
    ersteAnlegen: 'Create the first one.',

    was: 'What',
    wo: 'Where',
    wem: 'Who owns the site?',
    intern: 'Internal',
    archivieren: 'Archive',

    bezeichnung: 'Name',
    bezeichnungBeispiel: 'e.g. Office building Kurfürstendamm 21',
    objektnummer: 'Objektnummer',
    objektnummerBeispiel: 'leave empty — the platform continues the count',
    objektnummerHinweis:
      'Leave this empty and the platform continues counting from what this '
      + 'Gesellschaft (the legal entity) already has. The Objektnummer cannot be '
      + 'changed afterwards: it is printed on key tags and on every signed '
      + 'Leistungsnachweis (the countersigned record of work performed).',
    gebaeudetyp: 'Building type',
    gebaeudetypBeispiel: 'e.g. office building, school, construction site',
    etagen: 'Floors',
    strasse: 'Street',
    hausnummer: 'No.',
    adresszusatz: 'Address addition',
    adresszusatzBeispiel: 'e.g. entrance C, rear building',
    plz: 'Postcode',
    ort: 'Town',
    land: 'Country',
    kunde: 'Kunde (customer)',
    ohneKunde: 'no customer assigned',
    zutritt: 'Access',
    zutrittBeispiel: 'e.g. key at the porter, code at the side entrance',
    bemerkung: 'Note',
    freiwillig: '(optional)',

    koordinaten: 'Coordinates',
    breitengrad: 'Latitude',
    laengengrad: 'Longitude',
    breitengradBeispiel: 'e.g. 52.520008',
    laengengradBeispiel: 'e.g. 13.404954',
    koordinatenHinweis:
      'Optional, but both or neither — in decimal degrees, with a comma or a dot. '
      + 'Six decimal places are stored (about ten centimetres). The weather in the '
      + 'Bautagebuch (construction diary) uses them to find the nearest station. An '
      + 'address is not converted into coordinates automatically (O-122); what is '
      + 'shown here was entered by a person.',
    ohneKoordinaten:
      'none recorded — the weather in the Bautagebuch (construction diary) needs them',
    fehler: {
      bezeichnung_fehlt: 'The name is missing.',
      strasse_fehlt: 'The street is missing.',
      ort_fehlt: 'The town is missing.',
      plz_fehlt: 'The postcode is missing.',
      plz_ungueltig: 'A German postcode has five digits.',
      land_ungueltig: 'The country is a two-letter code (ISO 3166-1), e.g. DE.',
      etagen_ungueltig:
        'The number of floors is a whole number without a sign — a basement does '
        + 'not count the floors down.',
      koordinate_ungueltig:
        'A coordinate is not a number in decimal degrees — e.g. 52.520008 and '
        + '13.404954.',
      koordinate_bereich:
        'Latitude lies between −90 and 90 degrees, longitude between −180 and 180 '
        + 'degrees.',
      koordinaten_paar:
        'Coordinates are a pair: latitude AND longitude, or neither.',
      objekt_unbekannt: 'This Objekt no longer exists, or it has already been archived.',
      kein_schreibrecht:
        `The Objekt was not created — the right “${rechtName('objekt.schreiben', 'en')}” `
        + 'is missing in this Gesellschaft (the legal entity).',
      id_fehlt: 'No Objekt was given.',
    },
    einsaetzeOffen: (n) =>
      `There ${n === 1 ? 'is' : 'are'} still ${n === null ? '' : `${String(n)} `}future `
      + `${n === 1 ? 'Einsatz' : 'Einsätze'} (shift${n === 1 ? '' : 's'}) at this Objekt. Cancel `
      + `${n === 1 ? 'it' : 'them'} first — otherwise someone drives tomorrow to a place that `
      + 'no longer exists in the platform.',
    fehlerSonst: 'The entry was rejected. Please check the values.',

    anschriftPflicht:
      'The address is required. A shift scheduled on an Objekt without an '
      + 'address sends someone to no place at all.',
    kundeFreiwillig:
      'Optional, and that is deliberate. An Objekt is a PLACE; the commercial '
      + 'relationship hangs on the Auftrag (the order). A venue exists before '
      + 'there is any customer record, and the same building is rightly ordered '
      + 'by both owner and tenant. If you do not know the customer, do not '
      + 'invent one.',
    nurIntern:
      'Visible in the internal portal only. The customer does not see these two '
      + 'fields.',
    nummerBleibt:
      'It stays as it is. It is printed on key tags, in Dienstanweisungen '
      + '(standing instructions for the site) and on every signed '
      + 'Leistungsnachweis (the countersigned record of work performed).',
    archivierenErklaerung:
      'The Objekt disappears from every list and can no longer be scheduled. '
      + 'Nothing is deleted — Leistungsnachweise, Wachbücher (the guard log '
      + 'required under GewO) and time entries all hang on an Objekt, and '
      + 'deleting it would turn each of them into a row without a place. The '
      + 'Objektnummer becomes available again afterwards; a building that has '
      + 'been sold gives it up. If Einsätze (planned shifts) still lie in the '
      + 'future, the platform refuses to archive.',
    archivierenKnopf: 'Archive Objekt',
    istArchiviert:
      'This Objekt is archived. It can no longer be changed; its Objektnummer is '
      + 'free again.',

    objektAnlegen: 'Create Objekt',
    aenderungenSpeichern: 'Save changes',
    keinSchreibrechtAnlegen: 'To create one you are missing',
    keinSchreibrechtAendern: 'To edit you are missing',
  },
};
