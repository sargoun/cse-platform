/**
 * Die Wörter des handgeschriebenen Angebots — in beiden Sprachen (V-005,
 * SEC-01, BAU-01, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** `Mandant`,
 * `Objekt`, `Angebot` und die Steuersatz-Bezeichnungen tragen Bedeutung aus
 * UStG und Vertrag; erklärt wird in Klammern, ersetzt wird nicht. Die
 * Bezeichnungen der Steuersätze kommen ohnehin aus `steuersatz_gruppe` und
 * werden nirgends übersetzt: „Bauleistung §13b Abs. 2 Nr. 4 UStG" ist der
 * Name einer Rechtsgrundlage, kein Etikett.
 */
import type { InternSprache } from '../intern.js';

export interface AngebotHandTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly warum: string;
  readonly zurListe: string;

  /* ── Kopf ──────────────────────────────────────────────────────────── */
  readonly kunde: string;
  readonly kundeWaehlen: string;
  readonly angebotstitel: string;
  readonly titelBeispiel: string;
  readonly objekt: string;
  readonly ohneObjekt: string;
  readonly objektErklaerung: string;
  readonly kontakt: string;
  readonly ohneKontakt: string;
  readonly kontaktErklaerung: string;
  readonly gueltigBis: string;
  readonly gueltigBisErklaerung: string;
  readonly einleitung: string;
  readonly einleitungErklaerung: string;

  /* ── Steuer ────────────────────────────────────────────────────────── */
  readonly steuersatz: string;
  readonly steuersatzWaehlen: string;
  readonly steuersatzErklaerung: string;
  readonly steuersatzOffen: string;
  readonly wieOben: string;
  readonly keineSaetze: string;

  /* ── Positionen ────────────────────────────────────────────────────── */
  readonly positionen: string;
  readonly positionenErklaerung: string;
  readonly zeile: string;
  readonly kurztext: string;
  readonly kurztextBeispiel: string;
  readonly langtext: string;
  readonly menge: string;
  readonly mengeErklaerung: string;
  readonly einheit: string;
  readonly einzelpreis: string;
  readonly einzelpreisErklaerung: string;
  readonly summeErklaerung: string;
  readonly mehrZeilen: string;
  readonly mehrZeilenErklaerung: string;
  readonly hoechstzahlErreicht: string;

  /* ── Abschluss ─────────────────────────────────────────────────────── */
  readonly anlegen: string;
  readonly abbrechen: string;
  readonly entwurfHinweis: string;
  readonly keineKunden: string;
  readonly keinSchreibrecht: string;

  readonly fehler: Readonly<Record<string, string>>;
}

const DE: AngebotHandTexte = {
  modul: 'Angebote',
  titel: 'Neues Angebot',
  untertitel: 'Ein Angebot von Hand — mit eigenen Positionen, ohne Raumbuch.',
  warum:
    'Ein Reinigungsangebot entsteht aus dem Raumbuch eines Objekts: Flächen mal '
    + 'Leistungswert mal Turnus. Ein Wachdienst und eine Bauleistung haben kein '
    + 'Raumbuch — hier stehen die Positionen selbst.',
  zurListe: 'Zu den Angeboten',

  kunde: 'Kunde',
  kundeWaehlen: 'Kunde wählen',
  angebotstitel: 'Titel des Angebots',
  titelBeispiel: 'z. B. „Objektschutz Lagerhalle Marzahn, 2026"',
  objekt: 'Objekt',
  ohneObjekt: 'ohne Objekt',
  objektErklaerung:
    'Freiwillig. Steht hier eines, hängt jede Position daran — dann lässt sich '
    + 'später zeigen, für welches Objekt der Preis galt.',
  kontakt: 'Ansprechpartner',
  ohneKontakt: 'ohne Ansprechpartner',
  kontaktErklaerung:
    'Freiwillig — und er muss zum gewählten Kunden gehören. Die Liste zeigt '
    + 'deshalb den Kunden dazu.',
  gueltigBis: 'Gültig bis',
  gueltigBisErklaerung:
    'Freiwillig. Das Datum steht im Angebot und in der Liste der auslaufenden '
    + 'Angebote; ohne Datum läuft nichts ab.',
  einleitung: 'Einleitungstext',
  einleitungErklaerung: 'Freiwillig. Steht im Dokument über den Positionen.',

  steuersatz: 'Steuersatz für alle Positionen',
  steuersatzWaehlen: 'Steuersatz wählen',
  steuersatzErklaerung:
    'Der Satz kommt aus dem Steuerkatalog und wird zum heutigen Tag aufgelöst — '
    + 'mit ihm auch das Kennzeichen und, bei einer Befreiung, der gedruckte '
    + 'Grund (§14 Abs. 4 Nr. 8 UStG). Eine einzelne Zeile darf abweichen.',
  steuersatzOffen:
    'Welcher Satz für welche Leistung gilt, steht nicht in der Plattform: §13b '
    + 'gilt für Bauleistungen und für Gebäudereinigung an Unternehmer, nicht an '
    + 'jeden Kunden. Die Wahl trifft hier ein Mensch.',
  wieOben: '— wie oben —',
  keineSaetze:
    'Zum heutigen Tag ist kein Steuersatz hinterlegt. Ohne Satz lässt sich keine '
    + 'Position schreiben.',

  positionen: 'Positionen',
  positionenErklaerung:
    'Leere Zeilen werden übergangen. Eine Zeile mit Menge oder Preis, aber ohne '
    + 'Kurztext, wird abgewiesen statt stillschweigend weggelassen.',
  zeile: 'Zeile',
  kurztext: 'Kurztext',
  kurztextBeispiel: 'z. B. „Doppelstreife, 22:00–06:00"',
  langtext: 'Langtext',
  menge: 'Menge',
  mengeErklaerung: 'Höchstens drei Nachkommastellen, kein Tausenderpunkt.',
  einheit: 'Einheit',
  einzelpreis: 'Einzelpreis',
  einzelpreisErklaerung: 'In Euro, netto: 1.250,00',
  summeErklaerung:
    'Die Zeilensumme rechnet die Datenbank aus Menge mal Einzelpreis — nicht '
    + 'dieser Bildschirm.',
  mehrZeilen: 'Mehr Zeilen',
  mehrZeilenErklaerung:
    'Lädt das Formular mit mehr Zeilen neu. Getipptes geht dabei verloren — '
    + 'bitte vor dem Ausfüllen.',
  hoechstzahlErreicht: 'Mehr Zeilen nimmt ein Formular hier nicht auf.',

  anlegen: 'Angebot anlegen',
  abbrechen: 'Abbrechen',
  entwurfHinweis:
    'Es entsteht ein Entwurf ohne Nummer. Die Nummer wird erst beim Versand '
    + 'vergeben, und versendet wird nur nach Preisfreigabe durch einen Menschen.',
  keineKunden:
    'In dieser Gesellschaft ist kein Kunde erfasst. Ein Angebot braucht einen '
    + 'Empfänger.',
  keinSchreibrecht: 'Zum Anlegen eines Angebots fehlt Ihnen',

  fehler: {
    unvollstaendig: 'Es fehlt eine Pflichtangabe — Titel oder Kunde.',
    keine_position:
      'Kein Angebot ohne Position. Tragen Sie mindestens eine Leistung ein.',
    zeile_ohne_text:
      'Eine Zeile trägt Menge oder Preis, aber keinen Kurztext. Ergänzen Sie den '
      + 'Text oder leeren Sie die Zeile ganz.',
    kein_betrag:
      'Ein Einzelpreis ist keine Zahl in deutscher Schreibweise. Punkt trennt die '
      + 'Tausender, Komma die Cent — „1.250,00". Negativ geht nicht.',
    keine_menge:
      'Eine Menge ist keine Zahl mit höchstens drei Nachkommastellen — oder sie '
      + 'ist null.',
    unbekannter_steuersatz:
      'Zu diesem Tag gibt es den gewählten Steuersatz nicht. Wählen Sie einen aus '
      + 'der Liste.',
    unbekannte_einheit: 'Diese Einheit steht nicht im Einheitenverzeichnis.',
    kein_kunde:
      'Zu diesem Kunden lässt sich kein Angebot schreiben — archiviert, oder nicht '
      + 'in dieser Gesellschaft.',
    kontakt_fremd: 'Dieser Ansprechpartner gehört nicht zum gewählten Kunden.',
    abgewiesen: 'Die Datenbank hat den Vorgang abgewiesen — fehlt angebot.schreiben?',
    lead_unbekannt: 'Diese Anfrage ist in dieser Gesellschaft nicht erreichbar.',
    lead_ohne_kunde:
      'Die Anfrage hat noch keinen Kunden. Übernehmen Sie sie auf dem Leadblatt als '
      + 'Kunden oder ordnen Sie einen bestehenden zu.',
    lead_kunde_abweichend:
      'Die Anfrage gehört einem anderen Kunden als dem gewählten. Ein Angebot für einen '
      + 'anderen Kunden zählte im Herkunftsbericht für die falsche Anfrage.',
  },
};

const EN: AngebotHandTexte = {
  modul: 'Offers',
  titel: 'New offer',
  untertitel: 'An offer written by hand — your own line items, no Raumbuch.',
  warum:
    'A cleaning offer is calculated from an object’s Raumbuch (room register): '
    + 'area × performance rate × frequency. Guarding and construction work have no '
    + 'Raumbuch — here the line items are written out.',
  zurListe: 'To the offers',

  kunde: 'Customer',
  kundeWaehlen: 'Choose a customer',
  angebotstitel: 'Offer title',
  titelBeispiel: 'e.g. “Site security, Marzahn warehouse, 2026”',
  objekt: 'Objekt (site)',
  ohneObjekt: 'no Objekt',
  objektErklaerung:
    'Optional. If one is given, every line item hangs off it — so it stays '
    + 'visible later which site the price applied to.',
  kontakt: 'Contact person',
  ohneKontakt: 'no contact person',
  kontaktErklaerung:
    'Optional — and they must belong to the chosen customer. That is why the list '
    + 'names the customer too.',
  gueltigBis: 'Valid until',
  gueltigBisErklaerung:
    'Optional. The date appears on the offer and in the list of expiring offers; '
    + 'without one, nothing expires.',
  einleitung: 'Introductory text',
  einleitungErklaerung: 'Optional. Printed above the line items.',

  steuersatz: 'VAT rate for all line items',
  steuersatzWaehlen: 'Choose a VAT rate',
  steuersatzErklaerung:
    'The rate comes from the tax-rate catalogue and is resolved as of today — and '
    + 'with it the tax category and, where exempt, the printed reason (§14 (4) no. 8 '
    + 'UStG). A single line may deviate.',
  steuersatzOffen:
    'Which rate applies to which service is not stored in the platform: §13b '
    + '(reverse charge) covers construction work and building cleaning supplied to '
    + 'businesses, not to every customer. A human makes that call here.',
  wieOben: '— as above —',
  keineSaetze:
    'No VAT rate is on file for today. Without a rate no line item can be written.',

  positionen: 'Line items',
  positionenErklaerung:
    'Empty rows are skipped. A row carrying a quantity or a price but no short text '
    + 'is refused rather than silently dropped.',
  zeile: 'Row',
  kurztext: 'Short text',
  kurztextBeispiel: 'e.g. “Two-guard patrol, 22:00–06:00”',
  langtext: 'Long text',
  menge: 'Quantity',
  mengeErklaerung: 'At most three decimal places, no thousands separator.',
  einheit: 'Unit',
  einzelpreis: 'Unit price',
  einzelpreisErklaerung: 'In Euro, net, German notation: 1.250,00',
  summeErklaerung:
    'The line total is computed by the database from quantity × unit price — not '
    + 'by this screen.',
  mehrZeilen: 'More rows',
  mehrZeilenErklaerung:
    'Reloads the form with more rows. Anything typed is lost — so do this before '
    + 'filling it in.',
  hoechstzahlErreicht: 'A form here does not take more rows than this.',

  anlegen: 'Create offer',
  abbrechen: 'Cancel',
  entwurfHinweis:
    'This creates a draft without a number. The number is assigned on dispatch '
    + 'only, and nothing is dispatched without a human price approval.',
  keineKunden:
    'No customer is on file in this Mandant (company). An offer needs a recipient.',
  keinSchreibrecht: 'To create an offer you are missing',

  fehler: {
    unvollstaendig: 'A required field is missing — title or customer.',
    keine_position: 'No offer without a line item. Enter at least one service.',
    zeile_ohne_text:
      'A row carries a quantity or a price but no short text. Add the text or clear '
      + 'the row completely.',
    kein_betrag:
      'A unit price is not a number in German notation. Dot separates thousands, '
      + 'comma the cents — “1.250,00”. Negative is not accepted.',
    keine_menge:
      'A quantity is not a number with at most three decimal places — or it is zero.',
    unbekannter_steuersatz:
      'The chosen VAT rate does not exist on that date. Pick one from the list.',
    unbekannte_einheit: 'That unit is not in the unit register.',
    kein_kunde:
      'No offer can be written for this customer — archived, or not in this Mandant '
      + '(company).',
    kontakt_fremd: 'This contact person does not belong to the chosen customer.',
    abgewiesen: 'The database refused the operation — is angebot.schreiben missing?',
    lead_unbekannt: 'This enquiry (Lead) is not reachable in this Mandant (company).',
    lead_ohne_kunde:
      'The enquiry has no customer yet. Take it over as a customer on the Lead page, or '
      + 'assign an existing one.',
    lead_kunde_abweichend:
      'The enquiry belongs to a different customer than the one chosen. An offer for another '
      + 'customer would count for the wrong enquiry in the origin report.',
  },
};

export const ANGEBOT_HAND_TEXTE: Readonly<Record<InternSprache, AngebotHandTexte>> = {
  de: DE, en: EN,
};
