/**
 * Die Beschriftungen der oeffentlichen Huelle — in beiden Sprachen.
 *
 * **Nur das Geruest steht hier, nie der Inhalt.** Ueberschriften, Fliesstexte
 * und Leistungen kommen aus `seite`/`abschnitt` (PUB-07): ein Textwechsel ist
 * dort ein UPDATE, hier waere er ein Deployment. Was hier steht, sind die
 * Woerter, die zur Bedienung gehoeren — Navigation, Fussbereich, Sprachwahl.
 *
 * **Ein Record ueber `Sprache`, kein `t()` mit freiem Schluessel.** Ein
 * fehlender Eintrag ist damit ein Uebersetzungsfehler zur Bauzeit und nicht
 * ein englisches Wort mitten in einer deutschen Seite — oder umgekehrt, was
 * schlimmer ist: ein deutsches Wort auf der Seite, die jemand liest, WEIL er
 * kein Deutsch kann.
 */
import type { Sprache } from '../sprache.js';

export interface ShellTexte {
  readonly hauptnavigation: string;
  readonly bereicheNav: string;
  readonly rechtlichesNav: string;
  readonly sprachwahl: string;
  readonly zurStartseite: string;
  readonly navigation: Readonly<Record<'unternehmen' | 'leistungen' | 'projekte' | 'kontakt', string>>;
  readonly rechtlich: Readonly<Record<'impressum' | 'datenschutz' | 'barrierefreiheit', string>>;
  /**
   * Der Hinweis auf der englischen Fassung.
   *
   * Impressum und Datenschutzerklaerung sind nach §5 TMG und DSGVO Art. 13
   * deutschsprachige Pflichtangaben fuer einen deutschen Anbieter. Eine
   * Uebersetzung daneben ist eine Lesehilfe und nicht die Fassung, die gilt —
   * und das gehoert dazugeschrieben, statt es offenzulassen.
   */
  readonly rechtsverbindlichHinweis: string;
}

export const SHELL_TEXTE: Readonly<Record<Sprache, ShellTexte>> = {
  de: {
    hauptnavigation: 'Hauptnavigation',
    bereicheNav: 'Unsere Bereiche',
    rechtlichesNav: 'Rechtliches',
    sprachwahl: 'Sprache',
    zurStartseite: 'Zur Startseite',
    navigation: {
      unternehmen: 'Unternehmen',
      leistungen: 'Leistungen',
      projekte: 'Projekte',
      kontakt: 'Kontakt',
    },
    rechtlich: {
      impressum: 'Impressum',
      datenschutz: 'Datenschutz',
      barrierefreiheit: 'Barrierefreiheit',
    },
    rechtsverbindlichHinweis: '',
  },
  en: {
    hauptnavigation: 'Main navigation',
    bereicheNav: 'Our divisions',
    rechtlichesNav: 'Legal',
    sprachwahl: 'Language',
    zurStartseite: 'To the home page',
    navigation: {
      unternehmen: 'Companies',
      leistungen: 'Services',
      projekte: 'Projects',
      kontakt: 'Contact',
    },
    rechtlich: {
      impressum: 'Legal notice',
      datenschutz: 'Privacy',
      barrierefreiheit: 'Accessibility',
    },
    rechtsverbindlichHinweis:
      'The German version of the legal notice and the privacy policy is the '
      + 'legally binding one (§ 5 TMG, GDPR Art. 13). This translation is '
      + 'provided for convenience.',
  },
};

export function shellTexte(sprache: Sprache): ShellTexte {
  return SHELL_TEXTE[sprache];
}

/**
 * Die Barrierefreiheitserklaerung (LEG-07, PUB-09).
 *
 * Sie ist Code und kein `seite`-Datensatz, weil sie rechtlich verlangt ist und
 * nicht ohne Pruefung geaendert oder geloescht werden soll. Damit muss auch
 * ihre englische Fassung hier stehen — und nicht als zweite Komponente, die
 * beim naechsten Absatz vergessen wird.
 *
 * Was in KEINER der beiden Fassungen steht, ist eine Konformitaetsaussage:
 * die setzt eine tatsaechliche Pruefung voraus (O-205).
 */
export interface BarriereTexte {
  readonly titel: string;
  readonly standardTitel: string;
  readonly standardText: string;
  readonly pruefungTitel: string;
  readonly pruefungText: string;
  readonly pruefungGrenze: string;
  readonly offenTitel: string;
  readonly offenText: string;
  readonly meldenTitel: string;
  readonly meldenText: string;
  readonly keinMeldeweg: string;
  readonly telefon: string;
  readonly metaBeschreibung: string;
}

export const BARRIERE_TEXTE: Readonly<Record<Sprache, BarriereTexte>> = {
  de: {
    titel: 'Erklärung zur Barrierefreiheit',
    standardTitel: 'Angestrebter Standard',
    standardText:
      'Diese Website wird nach den Web Content Accessibility Guidelines 2.1 auf '
      + 'Stufe AA entwickelt. Das ist der Maßstab, den das '
      + 'Barrierefreiheitsstärkungsgesetz für verbraucherorientierte Angebote anlegt.',
    pruefungTitel: 'Wie geprüft wird',
    pruefungText:
      'Jede öffentliche Seite wird bei jeder Änderung automatisiert gegen die Regeln '
      + 'von axe-core geprüft; ein Verstoß hält die Auslieferung an. Zusätzlich wird '
      + 'jede Seite ausschließlich mit der Tastatur bedient und dabei geprüft, ob '
      + 'jedes bedienbare Element erreichbar ist und einen sichtbaren Fokusrahmen zeigt.',
    pruefungGrenze:
      'Automatisierte Prüfungen finden nicht alles. Sie ersetzen keine Prüfung durch '
      + 'Menschen, die auf Hilfsmittel angewiesen sind.',
    offenTitel: 'Noch nicht abgegeben',
    offenText:
      'Die verbindliche Angabe zum Konformitätsstatus, die Benennung der zuständigen '
      + 'Durchsetzungsstelle und das Datum der Erstprüfung stehen noch aus. Sie werden '
      + 'ergänzt, sobald die Prüfung abgeschlossen ist. Bis dahin steht hier bewusst '
      + 'keine Aussage, die noch nicht belegt ist.',
    meldenTitel: 'Barriere melden',
    meldenText:
      'Wenn Ihnen eine Barriere auffällt, melden Sie sie bitte — auch formlos. Wir '
      + 'antworten und beheben, was wir beheben können.',
    keinMeldeweg: 'Ein Meldeweg ist derzeit nicht hinterlegt.',
    telefon: 'Telefon',
    metaBeschreibung: 'Erklärung zur Barrierefreiheit dieser Website.',
  },
  en: {
    titel: 'Accessibility statement',
    standardTitel: 'The standard we build to',
    standardText:
      'This website is built to the Web Content Accessibility Guidelines 2.1, '
      + 'level AA. That is the benchmark the German Accessibility Strengthening Act '
      + '(Barrierefreiheitsstärkungsgesetz) applies to consumer-facing services.',
    pruefungTitel: 'How it is tested',
    pruefungText:
      'Every public page is checked automatically against the axe-core rules on every '
      + 'change; a violation stops the release. In addition, every page is operated '
      + 'with the keyboard alone and checked for whether each operable element can be '
      + 'reached and shows a visible focus ring.',
    pruefungGrenze:
      'Automated checks do not find everything. They are no substitute for testing by '
      + 'people who rely on assistive technology.',
    offenTitel: 'Not yet declared',
    offenText:
      'The binding statement of conformance, the named enforcement body and the date '
      + 'of the first audit are still outstanding. They will be added once the audit '
      + 'is complete. Until then this page deliberately makes no claim that is not '
      + 'yet evidenced.',
    meldenTitel: 'Report a barrier',
    meldenText:
      'If you come across a barrier, please tell us — informally is fine. We will '
      + 'reply and fix what we can fix.',
    keinMeldeweg: 'No reporting channel is on file at the moment.',
    telefon: 'Phone',
    metaBeschreibung: 'Accessibility statement for this website.',
  },
};

/** Die Beschriftungen des Anfrageformulars, die nicht aus der Definition kommen. */
export interface AnfrageTexte {
  readonly absenden: string;
  readonly honigtopf: string;
  readonly pflichtHinweis: string;
  /**
   * Der leere Eintrag einer Auswahl.
   *
   * Er stand fest verdrahtet in `Feld` — deutsch, auch in der englischen
   * Fassung. Die OPTIONEN bleiben unuebersetzt-wertig (D-83): uebersetzt wird
   * ihr Label, nie ihr `wert`, denn der reist in die Datenbank.
   */
  readonly bitteWaehlen: string;
}

export const ANFRAGE_TEXTE: Readonly<Record<Sprache, AnfrageTexte>> = {
  de: {
    absenden: 'Anfrage senden',
    honigtopf: 'Website (bitte leer lassen)',
    pflichtHinweis: 'Pflichtfeld',
    bitteWaehlen: 'Bitte wählen',
  },
  en: {
    absenden: 'Send enquiry',
    honigtopf: 'Website (please leave empty)',
    pflichtHinweis: 'Required',
    bitteWaehlen: 'Please choose',
  },
};

/**
 * Die Antworten der Annahme-Route.
 *
 * Sie gehen als JSON hinaus und werden gelesen — also gehoeren sie in die
 * Sprache, in der das Formular stand. Eine englische Seite, die auf einen
 * Tippfehler mit einem deutschen Satz antwortet, hat ihren Besucher an genau
 * der Stelle verloren, an der er etwas kaufen wollte.
 */
export interface ApiTexte {
  readonly unlesbar: string;
  readonly keinFormular: string;
  readonly nichtVerfuegbar: string;
  readonly dank: string;
  readonly dateiZuGross: string;
  readonly dateityp: string;
  readonly nichtGespeichert: string;
  /** Kein simulierter Erfolg: der Speicher ist nicht verbunden, und das steht da. */
  readonly uploadNichtVerbunden: string;
}

export const API_TEXTE: Readonly<Record<Sprache, ApiTexte>> = {
  de: {
    unlesbar: 'Die Anfrage konnte nicht gelesen werden.',
    keinFormular: 'Für diesen Bereich gibt es kein Anfrageformular.',
    nichtVerfuegbar: 'Das Formular ist derzeit nicht verfügbar.',
    dank: 'Vielen Dank für Ihre Anfrage.',
    dateiZuGross: 'Die Datei ist zu gross.',
    dateityp: 'Dieser Dateityp ist nicht zugelassen.',
    nichtGespeichert: 'Die Anfrage konnte nicht gespeichert werden.',
    uploadNichtVerbunden:
      'Der Datei-Upload ist derzeit nicht verfügbar. Bitte senden Sie die Anfrage '
      + 'ohne Leistungsverzeichnis — wir melden uns und holen die Datei nach.',
  },
  en: {
    unlesbar: 'The request could not be read.',
    keinFormular: 'There is no enquiry form for this division.',
    nichtVerfuegbar: 'The form is currently unavailable.',
    dank: 'Thank you for your enquiry.',
    dateiZuGross: 'The file is too large.',
    dateityp: 'This file type is not permitted.',
    nichtGespeichert: 'The enquiry could not be saved.',
    uploadNichtVerbunden:
      'File upload is currently unavailable. Please send the enquiry without the bill '
      + 'of quantities — we will get in touch and collect the file afterwards.',
  },
};

/** Die Bereichsauswahl `/angebot` (§2.3, REQ-01). */
export interface AuswahlTexte {
  readonly titel: string;
  readonly einleitung: string;
}

export const AUSWAHL_TEXTE: Readonly<Record<Sprache, AuswahlTexte>> = {
  de: {
    titel: 'Angebot anfragen',
    einleitung:
      'Jeder Bereich hat sein eigenes Formular, weil jedes Gewerk anders rechnet — '
      + 'Reinigung über Fläche und Frequenz, Sicherheit über Zeitraum und Kräfte, '
      + 'Bau über Gewerk und Leistungsverzeichnis. Wählen Sie den Bereich, um den '
      + 'es geht; gefragt wird dann genau das, was wir zum Rechnen brauchen.',
  },
  en: {
    titel: 'Request a quote',
    einleitung:
      'Each division has its own form, because each trade is costed differently — '
      + 'cleaning by area and frequency, security by period and staff, construction '
      + 'by trade and bill of quantities. Choose the division you need; the form '
      + 'then asks for exactly what we need in order to quote.',
  },
};
