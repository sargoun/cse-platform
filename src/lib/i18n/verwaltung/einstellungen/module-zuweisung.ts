/**
 * Die Module einer Administration — in beiden Sprachen (AUT-01, V-164, D-658).
 *
 * **Die Modulschlüssel werden nicht gezeigt, sondern benannt.** `crm`,
 * `finanzen`, `oeffentlich` stehen so im Katalog, in `benutzer_mandant.module`
 * und im Protokoll; auf dem Bildschirm steht, was sie bedeuten — auch nicht
 * als Tooltip: ein roher Schlüssel ist keine Beschriftung.
 *
 * **Die Wörter kommen aus den vorhandenen Tabellen, nicht aus einer neuen
 * Erfindung.** Wo das Menü einen Namen führt (`intern.ts`: „Aufträge",
 * „Sites", „Datenschutz (data protection)"), steht hier derselbe; wo nur der
 * Rechtekatalog ihn kennt (`rechtname.ts`), dessen Hauptwort. Ein Modul, das
 * zwei Namen trüge, wäre zwei Module.
 */
import type { InternSprache } from '../../intern.js';

interface Wort { readonly de: string; readonly en: string }

/**
 * Jedes Modul des Rechtekatalogs (`select distinct modul from berechtigung`).
 * `tests/kern/modul-namen.test.ts` hält die Liste gegen den Katalog: ein
 * neues Modul ohne Namen fällt dort auf und nicht als roher Schlüssel auf dem
 * Bildschirm.
 */
export const MODUL_NAMEN: Readonly<Record<string, Wort>> = {
  abrechnung: { de: 'Abrechnung', en: 'Billing' },
  agent: { de: 'KI-Agenten', en: 'AI agents' },
  angebot: { de: 'Angebote', en: 'Quotes' },
  aufgabe: { de: 'Aufgaben', en: 'Tasks' },
  auftrag: { de: 'Aufträge', en: 'Orders' },
  bau: { de: 'Bau', en: 'Construction' },
  bericht: { de: 'Berichte und Übersicht', en: 'Reports and overview' },
  buchhaltung: { de: 'Buchhaltung', en: 'Buchhaltung (bookkeeping)' },
  buchhaltung_konfiguration: { de: 'Buchhaltungseinstellungen', en: 'Bookkeeping settings' },
  crm: { de: 'Kunden (CRM)', en: 'Customers (CRM)' },
  crm_entgelt: { de: 'Kundenkonditionen', en: 'Customer terms' },
  datenschutz: { de: 'Datenschutz', en: 'Datenschutz (data protection)' },
  dienstanweisung: { de: 'Dienstanweisungen', en: 'Standing orders' },
  dienstplan: { de: 'Dienstplan', en: 'Schedule' },
  dokument: { de: 'Dokumente', en: 'Documents' },
  eingang: { de: 'Rechnungseingang', en: 'Supplier invoices' },
  finanzen: { de: 'Finanzen', en: 'Finance' },
  formular: { de: 'Formulare', en: 'Forms' },
  freigabe: { de: 'Freigaben', en: 'Approvals' },
  gruppe: { de: 'Gruppenübersicht', en: 'Group overview' },
  kalender: { de: 'Kalender', en: 'Calendar' },
  kalkulation: { de: 'Kalkulation', en: 'Costing' },
  katalog: { de: 'Leistungskatalog', en: 'Service catalogue' },
  mahnung: { de: 'Mahnwesen', en: 'Dunning' },
  nachricht: { de: 'Nachrichten', en: 'Messages' },
  nachweis: { de: 'Nachweise', en: 'Certificates' },
  nummernkreis: { de: 'Nummernkreise', en: 'Number ranges' },
  objekt: { de: 'Objekte', en: 'Sites' },
  objekt_import: { de: 'Objektimport', en: 'Site import' },
  oeffentlich: { de: 'Website', en: 'Website' },
  personal: { de: 'Personal', en: 'Staff' },
  qualitaet: { de: 'Qualität', en: 'Quality' },
  radar: { de: 'Ausschreibungsradar', en: 'Tender radar' },
  recruiting: { de: 'Recruiting', en: 'Recruiting' },
  referenz: { de: 'Referenzen', en: 'References' },
  reinigung: { de: 'Reinigung', en: 'Cleaning' },
  schluessel: { de: 'Schlüssel', en: 'Keys' },
  security: { de: 'Security', en: 'Security' },
  social: { de: 'Social Media', en: 'Social media' },
  stammdaten: { de: 'Stammdaten', en: 'Master data' },
  system: { de: 'System und Benutzer', en: 'System and users' },
  vergabe: { de: 'Vergabe', en: 'Procurement' },
  versand: { de: 'Versand', en: 'Dispatch' },
  wachbuch: { de: 'Wachbuch', en: 'Wachbuch (guard log)' },
  wissen: { de: 'Wissensquellen', en: 'Knowledge sources' },
  zahlung: { de: 'Zahlungen', en: 'Payments' },
  zeit: { de: 'Zeiten', en: 'Time' },
};

/**
 * Der Name eines Moduls. Ein unbekanntes wird lesbar gemacht statt
 * verschwiegen (`neues_modul` → „Neues modul") — dieselbe Haltung wie
 * `rechtName`: ein leerer Text wäre schlimmer als ein unschöner.
 */
export function modulName(modul: string, sprache: InternSprache): string {
  const wort = MODUL_NAMEN[modul];
  if (wort !== undefined) return wort[sprache];
  const lesbar = modul.replace(/[_-]+/gu, ' ').trim();
  return lesbar.charAt(0).toUpperCase() + lesbar.slice(1);
}

export interface ModulZuweisungTexte {
  readonly abschnitt: string;
  readonly erklaerung: string;
  readonly umfang: string;
  readonly alle: string;
  readonly auswahl: string;
  readonly module: string;
  readonly speichern: string;
  readonly eigenesKonto: string;
  /** Die Zelle „Module" in der Mitgliedschaftstabelle. */
  readonly alleDerRolle: string;
  /** Die Uebersicht auf `einstellungen/module` (03-AUTH, SEITENKARTE §5.24). */
  readonly uebersichtTitel: string;
  readonly uebersichtErklaerung: string;
  readonly uebersichtLeer: string;
  readonly uebersichtBeschriftung: string;
  readonly spalteKonto: string;
  readonly spalteModule: string;
  /** Was nach dem Absenden oben steht — der Schlüssel kommt aus der Adresse. */
  readonly meldung: Readonly<Record<string, string>>;
}

export const MODUL_ZUWEISUNG_TEXTE: Readonly<Record<InternSprache, ModulZuweisungTexte>> = {
  de: {
    abschnitt: 'Module der Administration',
    erklaerung:
      'Eine Administration hält die Rechte ihrer Rolle — hier eingeschränkt auf die '
      + 'gewählten Module dieser Gesellschaft. Was nicht gewählt ist, gilt '
      + 'nicht, auch nicht Einstellungen und Benutzer („System und Benutzer") oder die '
      + 'Übersicht („Berichte und Übersicht"). Die Änderung gilt mit der nächsten Seite.',
    umfang: 'Umfang',
    alle: 'Alle Module der Rolle',
    auswahl: 'Nur die gewählten Module',
    module: 'Module',
    speichern: 'Module speichern',
    eigenesKonto:
      'Die eigenen Module ändert ein anderes Konto — eine Administration, die ihre '
      + 'eigene Liste erweitern könnte, hätte keine.',
    alleDerRolle: 'alle der Rolle',
    uebersichtTitel: 'Module der Administrationen',
    uebersichtErklaerung:
      'Welche Module jede Administration dieser Gesellschaft hält. Geändert wird die '
      + 'Liste auf dem Blatt des Kontos.',
    uebersichtLeer: 'Diese Gesellschaft hat keine Administration.',
    uebersichtBeschriftung: 'Administrationen dieser Gesellschaft und ihre Module',
    spalteKonto: 'Konto',
    spalteModule: 'Module',
    meldung: {
      module_gesetzt: 'Die Module sind gespeichert.',
      module_unveraendert: 'Die Module waren schon so — nichts geändert.',
      keine_module: 'Mindestens ein Modul wählen — oder „Alle Module der Rolle".',
      unbekanntes_modul: 'Ein gewähltes Modul gibt es im Rechtekatalog nicht.',
      nur_admin: 'Module werden nur einer Administration zugewiesen.',
      eigenes_konto: 'Die eigenen Module ändert ein anderes Konto.',
      ueber_eigene_module:
        'Zugewiesen werden nur Module, die das eigene Konto in dieser Gesellschaft hält — '
        + 'und „Alle Module der Rolle" nur von einem Konto, das selbst alle hält.',
      nicht_gefunden: 'Diese Mitgliedschaft gibt es hier nicht (mehr).',
    },
  },
  en: {
    abschnitt: 'Modules of this administrator',
    erklaerung:
      'An administrator holds the rights of the role — restricted here to the modules '
      + 'chosen for this Gesellschaft. Whatever is not chosen does not apply, '
      + 'including settings and users ("System and users") and the overview ("Reports '
      + 'and overview"). The change applies from the next page on.',
    umfang: 'Scope',
    alle: 'All modules of the role',
    auswahl: 'Only the chosen modules',
    module: 'Modules',
    speichern: 'Save modules',
    eigenesKonto:
      'Your own modules are changed from another account — an administrator who could '
      + 'widen their own list would have none.',
    alleDerRolle: 'all of the role',
    uebersichtTitel: 'Modules of the administrators',
    uebersichtErklaerung:
      'Which modules each administrator of this Gesellschaft holds. The list is changed on '
      + 'the page of the account.',
    uebersichtLeer: 'This Gesellschaft has no administrator.',
    uebersichtBeschriftung: 'Administrators of this Gesellschaft and their modules',
    spalteKonto: 'Account',
    spalteModule: 'Modules',
    meldung: {
      module_gesetzt: 'The modules have been saved.',
      module_unveraendert: 'The modules were already set like this — nothing changed.',
      keine_module: 'Choose at least one module — or "All modules of the role".',
      unbekanntes_modul: 'A chosen module does not exist in the rights catalogue.',
      nur_admin: 'Modules are only assigned to an administrator.',
      eigenes_konto: 'Your own modules are changed from another account.',
      ueber_eigene_module:
        'Only modules your own account holds in this Gesellschaft can be assigned — and '
        + '"All modules of the role" only by an account that holds all of them.',
      nicht_gefunden: 'This membership does not exist here (any more).',
    },
  },
};
