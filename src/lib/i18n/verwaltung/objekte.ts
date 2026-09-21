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

export interface ObjekteTexte {
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
