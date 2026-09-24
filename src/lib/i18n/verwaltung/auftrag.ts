/**
 * Der Auftrag — Assistent, Pflege und Abweisungen, in beiden Sprachen
 * (V-172, V-173, OPS-05, OPS-10, D-592).
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text**: `Auftrag`,
 * `Objekt`, `Nummernkreis`, `Mandant`, `Nachtrag` — erklärt in Klammern,
 * nicht ersetzt (siehe `./basis.ts`).
 *
 * **Die Abweisungen sind SCHLÜSSEL**, die die Routen zurückgeben
 * (`?fehler=…`). Die Seite zeigt den Satz zum Schlüssel und für einen
 * unbekannten Schlüssel `nichtGespeichert` — nie den Schlüssel selbst.
 */
import type { InternSprache } from '../intern.js';

export interface AuftragTexte {
  /** Über jeder Abweisung: was NICHT passiert ist. */
  readonly nichtAngelegt: string;
  readonly nichtGespeichert: string;
  /** Die Abweisungen des Assistenten, der Annahme und der Pflege, je Schlüssel. */
  readonly fehler: Readonly<Record<string, string>>;

  /* ── Der Auftragswert (Assistent und Pflege) ───────────────────────── */
  readonly wert: string;
  readonly wertHinweis: string;
  /**
   * Unter dem gesperrten Wert eines Auftrags aus einem Angebot: woher er kommt
   * und auf welchem Weg er sich ändert — im Bau über einen Nachtrag, sonst
   * offen mit der Nummer der Frage (V-239, O-921).
   */
  readonly wertAusAngebot: (angebotsnummer: string) => string;
  readonly wertWegNachtrag: string;
  readonly wertWegOffen: (frage: string) => string;

  /* ── Die OPS-10-Angaben bei der Annahme ────────────────────────────── */
  readonly ops10Titel: string;
  readonly ops10Hinweis: string;
  readonly personalbedarf: string;
  readonly wochenstunden: string;
  readonly ausstattung: string;

  /* ── Die Pflegeseite ───────────────────────────────────────────────── */
  readonly bearbeiten: string;
  readonly bearbeitenTitel: string;
  readonly zumAuftrag: string;
  readonly festBleibt: string;
  readonly bezeichnung: string;
  readonly beschreibung: string;
  readonly leitung: string;
  /** Die bisherige Leitung, die hier nicht mehr Mitglied ist (V-177). */
  readonly leitungAusgeschieden: (name: string) => string;
  readonly laufzeitBis: string;
  readonly unbefristet: string;
  readonly speichern: string;
  readonly gespeichert: string;
  readonly gesperrt: (zustand: string) => string;
  readonly keinSchreibrecht: string;
  /** Die Zustände in Worten — nie der Aufzählungswert. */
  readonly zustand: Readonly<Record<string, string>>;
}

export const AUFTRAG_TEXTE: Readonly<Record<InternSprache, AuftragTexte>> = {
  de: {
    nichtAngelegt: 'Der Auftrag wurde nicht angelegt.',
    nichtGespeichert: 'Es wurde nichts geändert.',
    fehler: {
      unvollstaendig: 'Es fehlt eine Pflichtangabe — Kunde, Bezeichnung, Art, Leitung oder Start.',
      keine_zahl:
        'Personalbedarf oder Wochenstunden ist keine Zahl. Erlaubt sind Ziffern mit '
        + 'Tausenderpunkt und Dezimalkomma, z. B. 1.234,5 — ohne Einheit.',
      ausserhalb_bereich:
        'Personalbedarf (ganze Personen, 0 bis 5.000) oder Wochenstunden (0 bis 10.000) liegt '
        + 'außerhalb des Bereichs.',
      wert_ungueltig:
        'Der Auftragswert ist kein Eurobetrag in deutscher Schreibweise (z. B. 12.500,00) '
        + 'oder er ist negativ.',
      datum_ungueltig: 'Start oder Laufzeit ist kein gültiges Datum.',
      laufzeit_vor_start: 'Die Laufzeit endet vor dem Start.',
      kunde_unbekannt: 'Diesen Kunden gibt es in dieser Gesellschaft nicht (mehr).',
      objekt_unbekannt: 'Dieses Objekt gibt es in dieser Gesellschaft nicht (mehr).',
      verantwortlich_fremd:
        'Die gewählte Leitung arbeitet nicht in dieser Gesellschaft. Verantwortlich kann nur '
        + 'sein, wer hier Mitglied ist.',
      kein_kreis:
        'Für Aufträge ist in dieser Gesellschaft kein Nummernkreis eingerichtet '
        + '(Finanzen › Nummernkreise).',
      platzhalter: 'Der Auftragskreis ist noch ein Platzhalter und vergibt keine Nummer.',
      geschlossen: 'Der Auftragskreis ist geschlossen.',
      definer_kreis: 'Der Auftragskreis ist nicht richtig eingerichtet.',
      maske_ungueltig: 'Die Nummernmaske des Auftragskreises ist ungültig.',
      bezeichnung_fehlt: 'Ein Auftrag braucht eine Bezeichnung.',
      gesperrt:
        'Ein abgeschlossener oder stornierter Auftrag wird nicht mehr geändert. Korrigiert '
        + 'wird über einen Nachtrag oder einen neuen Auftrag.',
      wert_aus_angebot:
        'Der Wert dieses Auftrags kommt aus dem angenommenen Angebot und wird hier nicht '
        + 'geändert. Unter dem Wert steht, auf welchem Weg er sich ändert.',
      nicht_gefunden: 'Diesen Auftrag gibt es nicht — oder diese Sitzung darf ihn nicht ändern.',
      nicht_angelegt:
        'Die Datenbank hat den Auftrag nicht angenommen. Ihre Eingaben stehen noch da.',
    },

    wert: 'Auftragswert netto (€)',
    wertHinweis:
      'Freiwillig. Der Betrag des Vertrags ohne Umsatzsteuer, z. B. 12.500,00 — er zählt in '
      + 'den Wertkennzahlen und ist die Grundlage einer Abschlagsrechnung. Leer lassen, wenn '
      + 'er noch nicht feststeht; geschätzt wird nichts.',
    wertAusAngebot: (nr) =>
      `Kommt aus dem Angebot ${nr} und wird hier weder neu gerechnet noch geändert.`,
    wertWegNachtrag:
      'Eine Änderung des Bauvertrags ist ein Nachtrag nach § 2 VOB/B — am Projekt dieses '
      + 'Auftrags.',
    wertWegOffen: (frage) =>
      'Wie ein Vertragswert aus einem Angebot in dieser Gesellschaft berichtigt oder angepasst '
      + `wird, ist noch nicht entschieden (${frage}). Bis dahin bleibt er, wie der Kunde ihn `
      + 'angenommen hat.',

    ops10Titel: 'Was der Vertrag verlangt (OPS-10)',
    ops10Hinweis:
      'Freiwillig und nicht geschätzt: was hier leer bleibt, bleibt am Auftrag leer und lässt '
      + 'sich dort später eintragen.',
    personalbedarf: 'Personalbedarf (Personen)',
    wochenstunden: 'Wochenstunden',
    ausstattung: 'Ausstattung',

    bearbeiten: 'Bearbeiten',
    bearbeitenTitel: 'Auftrag bearbeiten',
    zumAuftrag: 'Zum Auftrag',
    festBleibt:
      'Nummer, Kunde, Art, Start und Objekt bleiben, wie sie sind: sie stehen auf Rechnungen, '
      + 'Einsätzen und Leistungsnachweisen. Ein anderer Vertragspartner oder Ort ist ein '
      + 'anderer Auftrag. Jede Änderung steht mit Vorher und Nachher im Protokoll.',
    bezeichnung: 'Bezeichnung',
    beschreibung: 'Beschreibung',
    leitung: 'Verantwortliche Leitung',
    leitungAusgeschieden: (name) => `${name} (nicht mehr in dieser Gesellschaft)`,
    laufzeitBis: 'Laufzeit bis',
    unbefristet: 'leer = unbefristet',
    speichern: 'Änderungen speichern',
    gespeichert: 'Die Änderungen sind gespeichert.',
    gesperrt: (zustand) =>
      `Dieser Auftrag ist ${zustand} und wird nicht mehr geändert. Korrigiert wird über einen `
      + 'Nachtrag oder einen neuen Auftrag.',
    keinSchreibrecht: 'Zum Ändern fehlt Ihnen',
    zustand: {
      angelegt: 'geplant', aktiv: 'in Arbeit', pausiert: 'ruhend',
      abgeschlossen: 'abgeschlossen', storniert: 'storniert',
    },
  },
  en: {
    nichtAngelegt: 'The Auftrag (order) was not created.',
    nichtGespeichert: 'Nothing was changed.',
    fehler: {
      unvollstaendig:
        'A required field is missing — customer, name, type, manager or start.',
      keine_zahl:
        'Staff required or weekly hours is not a number. Digits with a thousands dot and a '
        + 'decimal comma are accepted, e.g. 1.234,5 — without a unit.',
      ausserhalb_bereich:
        'Staff required (whole people, 0 to 5,000) or weekly hours (0 to 10,000) is out of '
        + 'range.',
      wert_ungueltig:
        'The order value is not a euro amount in German notation (e.g. 12.500,00), or it is '
        + 'negative.',
      datum_ungueltig: 'Start or end of term is not a valid date.',
      laufzeit_vor_start: 'The term ends before the start.',
      kunde_unbekannt: 'This customer does not exist (any more) in this Mandant (company).',
      objekt_unbekannt: 'This Objekt (site) does not exist (any more) in this Mandant (company).',
      verantwortlich_fremd:
        'The chosen manager does not work in this Mandant (company). Only a member can be '
        + 'responsible.',
      kein_kreis:
        'No Nummernkreis (number sequence) for orders is set up in this Mandant (company) '
        + '(Finance › Number sequences).',
      platzhalter: 'The order number sequence is still a placeholder and issues no number.',
      geschlossen: 'The order number sequence is closed.',
      definer_kreis: 'The order number sequence is not set up correctly.',
      maske_ungueltig: 'The number mask of the order sequence is invalid.',
      bezeichnung_fehlt: 'An order needs a name.',
      gesperrt:
        'A completed or cancelled order is no longer changed. Corrections go through a '
        + 'Nachtrag (change order) or a new order.',
      wert_aus_angebot:
        'The value of this order comes from the accepted offer and is not changed here. Below '
        + 'the value you can read how it can be changed.',
      nicht_gefunden: 'This order does not exist — or this session may not change it.',
      nicht_angelegt: 'The database did not accept the order. Your entries are still there.',
    },

    wert: 'Order value, net (€)',
    wertHinweis:
      'Optional. The contract amount before VAT, e.g. 12.500,00 — it counts in the value '
      + 'figures and is the basis of a progress invoice. Leave it empty if it is not settled '
      + 'yet; nothing is estimated.',
    wertAusAngebot: (nr) =>
      `Comes from offer ${nr} and is neither recalculated nor changed here.`,
    wertWegNachtrag:
      'A change of the construction contract is a Nachtrag (change order) under § 2 VOB/B — '
      + 'on the project of this order.',
    wertWegOffen: (frage) =>
      'How a contract value from an offer is corrected or adjusted in this Mandant (company) '
      + `has not been decided yet (${frage}). Until then it stays as the customer accepted it.`,

    ops10Titel: 'What the contract requires (OPS-10)',
    ops10Hinweis:
      'Optional and never estimated: what stays empty here stays empty on the order and can '
      + 'be entered there later.',
    personalbedarf: 'Staff required (people)',
    wochenstunden: 'Weekly hours',
    ausstattung: 'Equipment',

    bearbeiten: 'Edit',
    bearbeitenTitel: 'Edit order',
    zumAuftrag: 'Back to the order',
    festBleibt:
      'Number, customer, type, start and Objekt (site) stay as they are: they appear on '
      + 'invoices, Einsätze (shifts) and Leistungsnachweise (records of work). A different '
      + 'contracting party or site is a different order. Every change is logged with before '
      + 'and after.',
    bezeichnung: 'Name',
    beschreibung: 'Description',
    leitung: 'Responsible manager',
    leitungAusgeschieden: (name) => `${name} (no longer in this Mandant (company))`,
    laufzeitBis: 'Term until',
    unbefristet: 'empty = open-ended',
    speichern: 'Save changes',
    gespeichert: 'The changes have been saved.',
    gesperrt: (zustand) =>
      `This order is ${zustand} and is no longer changed. Corrections go through a Nachtrag `
      + '(change order) or a new order.',
    keinSchreibrecht: 'To edit you are missing',
    zustand: {
      angelegt: 'planned', aktiv: 'in progress', pausiert: 'paused',
      abgeschlossen: 'completed', storniert: 'cancelled',
    },
  },
};
