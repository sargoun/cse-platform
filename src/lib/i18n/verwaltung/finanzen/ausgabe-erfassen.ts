/**
 * Die Wörter der Ausgabenerfassung — in beiden Sprachen (V-011, FIN-14).
 *
 * **Der Erfasser gibt NETTO je Steuersatz, nicht Brutto.** Das ist die eine
 * Stelle, an der das Formular etwas verlangt, was der Kassenbon nicht
 * hergibt — und deshalb steht der Grund als Satz daneben und nicht als
 * Sternchen: aus einem Bruttobetrag lässt sich der Satz nicht zurückrechnen,
 * ohne einen Mischsatz zu erfinden, und den verbietet Invariante 1. Auf dem
 * Bon steht beides; abgetippt wird das Netto.
 */
import type { InternSprache } from '../../intern.js';

export interface AusgabeErfassenTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly warum: string;

  readonly bezeichnung: string;
  readonly bezeichnungBeispiel: string;
  readonly kategorie: string;
  readonly kategorieWaehlen: string;
  readonly kategoriePlatzhalter: string;
  readonly ausgabedatum: string;
  readonly ausgabedatumErklaerung: string;

  readonly zahlungsmittel: string;
  readonly zahlungsmittelListe: Readonly<Record<string, string>>;
  readonly kasse: string;
  readonly kasseErklaerung: string;
  readonly keineKasse: string;

  readonly steuer: string;
  readonly steuerErklaerung: string;
  readonly steuerGruppe: string;
  readonly steuerNetto: string;
  readonly steuerZeileLeer: string;

  readonly beleg: string;
  readonly belegErklaerung: string;
  readonly ohneBeleg: string;

  readonly zuordnung: string;
  readonly zuordnungErklaerung: string;
  readonly objekt: string;
  readonly auftrag: string;
  readonly projekt: string;
  readonly ohne: string;
  readonly weiterberechenbar: string;
  readonly weiterberechenbarErklaerung: string;

  readonly speichern: string;
  readonly abbrechen: string;
  readonly keinSchreibrecht: string;
  readonly keineKategorien: string;
  readonly keineKategorienErklaerung: string;

  /* ── Die Entscheidung auf dem Einzelblatt ─────────────────────────── */
  readonly entscheidung: string;
  readonly entscheidungErklaerung: string;
  readonly freigeben: string;
  readonly freigebenErklaerung: string;
  readonly ablehnen: string;
  readonly ablehnenGrund: string;
  readonly buchen: string;
  readonly buchenErklaerung: string;
  readonly keinEntscheidungsrecht: string;
  readonly keinBuchungsrecht: string;
  readonly entschieden: string;

  readonly fehler: Readonly<Record<string, string>>;
  /**
   * Der Satz für einen Grund, den `fehler` nicht kennt (V-197) — nie der rohe
   * Schlüssel aus der Adresse.
   */
  readonly fehlerAllgemein: string;
}

export const AUSGABE_ERFASSEN_TEXTE:
Readonly<Record<InternSprache, AusgabeErfassenTexte>> = {
  de: {
    modul: 'Finanzen',
    titel: 'Ausgabe erfassen',
    untertitel: 'Der Aufwand, der keine Lieferantenrechnung ist — Tankquittung, '
      + 'Parkgebühr, Material aus dem Baumarkt.',
    warum:
      'Erfasst heisst: festgehalten, noch nicht entschieden. Freigegeben wird '
      + 'in einem zweiten Schritt und von jemandem mit dem Recht dazu — wer '
      + 'eine Quittung eintippt, gibt sie nicht schon deshalb frei.',

    bezeichnung: 'Bezeichnung',
    bezeichnungBeispiel: 'Diesel, Tankstelle Kurfürstendamm',
    kategorie: 'Aufwandskategorie',
    kategorieWaehlen: 'Kategorie wählen',
    kategoriePlatzhalter:
      '(unbestätigt) — welche Kategorien der Steuerberater erwartet, ist offen (O-05)',
    ausgabedatum: 'Ausgabedatum',
    ausgabedatumErklaerung:
      'Der Berliner Kalendertag des Belegs, nicht der Tag der Eingabe.',

    zahlungsmittel: 'Zahlungsmittel',
    zahlungsmittelListe: {
      ueberweisung: 'Überweisung',
      lastschrift: 'Lastschrift',
      bar: 'Bar (aus einer Kasse)',
      karte: 'Karte',
      verrechnung: 'Verrechnung',
    },
    kasse: 'Kasse',
    kasseErklaerung:
      'Bar heisst: aus einer Kasse. Ohne Kasse gäbe es keinen fortgeschriebenen '
      + 'Bestand und damit keine Kassensturzfähigkeit (GoBD).',
    keineKasse:
      'Für diese Gesellschaft ist keine Kasse geführt — bar lässt sich damit '
      + 'nichts erfassen.',

    steuer: 'Aufteilung je Steuersatz',
    steuerErklaerung:
      'Tragen Sie den NETTOBETRAG je Satz ein; die Steuer rechnet die Plattform. '
      + 'Ein Kassenbon mit Kraftstoff zu 19 % und Verpflegung zu 7 % ist der '
      + 'gewöhnliche Fall, und aus dem Bruttobetrag allein liesse sich kein Satz '
      + 'mehr ableiten — das wäre ein Mischsatz.',
    steuerGruppe: 'Steuersatz',
    steuerNetto: 'Netto',
    steuerZeileLeer: '— nicht verwendet —',

    beleg: 'Beleg',
    belegErklaerung:
      'Ohne Beleg keine Freigabe (ACC-03). Erfassen geht auch ohne: die Quittung '
      + 'kommt oft später als der Betrag.',
    ohneBeleg: 'noch kein Beleg',

    zuordnung: 'Kostenzuordnung',
    zuordnungErklaerung:
      'Wohin der Aufwand gehört — und ob er weiterberechnet werden darf.',
    objekt: 'Objekt',
    auftrag: 'Auftrag',
    projekt: 'Projekt',
    ohne: 'ohne',
    weiterberechenbar: 'Darf weiterberechnet werden',
    weiterberechenbarErklaerung:
      'Dann darf die Ausgabe EINMAL auf einer Rechnungszeile erscheinen (FIN-07).',

    speichern: 'Ausgabe erfassen',
    abbrechen: 'Zurück zur Liste',
    keinSchreibrecht: 'Eine Ausgabe zu erfassen verlangt',
    keineKategorien: 'Für diese Gesellschaft ist keine Aufwandskategorie angelegt.',
    keineKategorienErklaerung:
      'Ohne Kategorie entsteht keine Ausgabe: an ihr hängt die Kontierung, und '
      + 'eine Ausgabe ohne Konto wäre eine Buchung, die niemand einordnen kann.',

    entscheidung: 'Entscheidung',
    entscheidungErklaerung:
      'Erfasst heisst festgehalten. Freigegeben heisst: geprüft und zur Buchung '
      + 'bereit — und ab da ist der Beleg Pflicht. Gebucht ist das Ende; korrigiert '
      + 'wird danach durch eine Gegenbuchung, nie durch Änderung.',
    freigeben: 'Freigeben',
    freigebenErklaerung:
      'Verlangt einen Beleg (ACC-03) und das Recht dazu — wer erfasst hat, gibt '
      + 'nicht schon deshalb frei.',
    ablehnen: 'Ablehnen',
    ablehnenGrund: 'Grund der Ablehnung',
    buchen: 'Buchen',
    buchenErklaerung:
      'Der unumkehrbare Schritt: Zustand und Buchungssatz entstehen in derselben '
      + 'Transaktion. Fehlt eine Kontenzuordnung, entsteht die Zeile trotzdem — '
      + 'ohne Konto, mit Hinweis, und sie steht in der Arbeitsliste und hält den '
      + 'Monatsabschluss auf (O-05).',
    keinEntscheidungsrecht: 'Über eine Ausgabe zu entscheiden verlangt',
    keinBuchungsrecht:
      'Buchen schreibt ins Hauptbuch und verlangt deshalb zusätzlich',
    entschieden: 'Diese Ausgabe ist entschieden — sie wechselt nicht mehr (ACC-06).',

    fehler: {
      unvollstaendig: 'Es fehlt eine Angabe — bitte sehen Sie die Felder durch.',
      betrag_unlesbar:
        'Ein Betrag liess sich nicht lesen. Deutsche Schreibweise mit Komma, '
        + 'zum Beispiel 82,50.',
      abgewiesen: 'Die Datenbank hat die Zeile abgewiesen.',
      nicht_gefunden: 'Diese Ausgabe ist nicht erreichbar.',
      kein_beleg: 'Ohne Beleg keine Freigabe (ACC-03).',
      kein_uebergang:
        'Dieser Schritt gilt nicht mehr — wahrscheinlich hat jemand anderes '
        + 'inzwischen entschieden.',
      grund_fehlt: 'Eine Ablehnung ohne Grund ist keine Auskunft.',
    },
    fehlerAllgemein: 'Der Schritt lief nicht durch. Die Ausgabe steht, wie sie war.',
  },

  en: {
    modul: 'Finance',
    titel: 'Record an expense',
    untertitel: 'The cost that is not a supplier invoice — fuel, parking, '
      + 'materials from the builders’ merchant.',
    warum:
      '“Erfasst” (recorded) means noted, not yet decided. Releasing it is a '
      + 'second step by somebody holding that right — typing in a receipt does '
      + 'not release it.',

    bezeichnung: 'Description',
    bezeichnungBeispiel: 'Diesel, filling station Kurfürstendamm',
    kategorie: 'Expense category',
    kategorieWaehlen: 'Choose a category',
    kategoriePlatzhalter:
      '(unconfirmed) — which categories the tax adviser expects is open (O-05)',
    ausgabedatum: 'Expense date',
    ausgabedatumErklaerung:
      'The Berlin calendar day on the receipt, not the day it was typed in.',

    zahlungsmittel: 'Means of payment',
    zahlungsmittelListe: {
      ueberweisung: 'Bank transfer',
      lastschrift: 'Direct debit',
      bar: 'Cash (from a Kasse)',
      karte: 'Card',
      verrechnung: 'Set-off',
    },
    kasse: 'Kasse (cash register)',
    kasseErklaerung:
      'Cash means: out of a Kasse. Without one there is no running balance and '
      + 'therefore no cash-count capability (GoBD).',
    keineKasse:
      'This Gesellschaft (legal entity) keeps no Kasse — nothing can be recorded '
      + 'as cash.',

    steuer: 'Split per tax rate',
    steuerErklaerung:
      'Enter the NET amount per rate; the platform computes the tax. A till '
      + 'receipt with fuel at 19 % and food at 7 % is the ordinary case, and from '
      + 'a gross total alone no rate can be derived — that would be a blended rate.',
    steuerGruppe: 'Tax rate',
    steuerNetto: 'Net',
    steuerZeileLeer: '— not used —',

    beleg: 'Beleg (source document)',
    belegErklaerung:
      'No release without a document (ACC-03). Recording works without one: the '
      + 'receipt often arrives after the amount.',
    ohneBeleg: 'no document yet',

    zuordnung: 'Cost allocation',
    zuordnungErklaerung:
      'Where the cost belongs — and whether it may be passed on.',
    objekt: 'Objekt (site)',
    auftrag: 'Auftrag (order)',
    projekt: 'Projekt',
    ohne: 'none',
    weiterberechenbar: 'May be re-charged',
    weiterberechenbarErklaerung:
      'It may then appear ONCE on an invoice line (FIN-07).',

    speichern: 'Record expense',
    abbrechen: 'Back to the list',
    keinSchreibrecht: 'Recording an expense requires',
    keineKategorien: 'This Gesellschaft has no expense category.',
    keineKategorienErklaerung:
      'Without a category no expense is created: the account mapping hangs off '
      + 'it, and an expense without an account is a booking nobody can place.',

    entscheidung: 'Decision',
    entscheidungErklaerung:
      '“Erfasst” means noted. “Freigegeben” (released) means checked and ready to '
      + 'book — and from then on the Beleg is mandatory. “Gebucht” (booked) is the '
      + 'end; after that you correct by a reversing entry, never by editing.',
    freigeben: 'Release',
    freigebenErklaerung:
      'Requires a Beleg (ACC-03) and the right to do it — whoever recorded it does '
      + 'not thereby release it.',
    ablehnen: 'Reject',
    ablehnenGrund: 'Reason for rejection',
    buchen: 'Book',
    buchenErklaerung:
      'The irreversible step: state and booking entry arise in the same '
      + 'transaction. If an account mapping is missing the line is still created — '
      + 'without an account, with a note, and it sits in the work list and holds up '
      + 'the month-end close (O-05).',
    keinEntscheidungsrecht: 'Deciding about an expense requires',
    keinBuchungsrecht:
      'Booking writes to the ledger and therefore additionally requires',
    entschieden: 'This expense is decided — it does not change any more (ACC-06).',

    fehler: {
      unvollstaendig: 'Something is missing — please check the fields.',
      betrag_unlesbar:
        'An amount could not be read. German notation with a comma, for '
        + 'example 82,50.',
      abgewiesen: 'The database refused the row.',
      nicht_gefunden: 'This expense is not reachable.',
      kein_beleg: 'No release without a document (ACC-03).',
      kein_uebergang:
        'This step no longer applies — somebody else has probably decided in '
        + 'the meantime.',
      grund_fehlt: 'A rejection without a reason is no answer.',
    },
    fehlerAllgemein: 'The step did not go through. The expense is as it was.',
  },
};
