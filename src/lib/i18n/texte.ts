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
  /** Der Fussbereich fuehrt dieselben Ziele — unter eigenem Namen (PUB-14). */
  readonly gesellschaftenNav: string;
  readonly rechtlichesNav: string;
  readonly sprachwahl: string;
  readonly zurStartseite: string;
  /**
   * Die Aufforderung auf der Markenkarte und das Schild am Platzhalterbild.
   *
   * Sie standen als deutsche Literale in `MarkenKarte.tsx`. Die Karten
   * erscheinen auf `/` UND auf `/en`, also las die englische Startseite
   * „Mehr erfahren →" und „Platzhalterbild" — genau der Fall, den der
   * Kopfkommentar dieser Datei beschreibt: ein deutsches Wort auf der Seite,
   * die jemand liest, WEIL er kein Deutsch kann.
   */
  readonly mehrErfahren: string;
  readonly platzhalterbild: string;
  /**
   * Der rote Knopf rechts in der Kopfzeile — DESIGN §5 nennt ihn woertlich:
   * „rot *Angebot anfragen* + ghost *Login* rechts".
   *
   * Er fehlte, und mit ihm der einzige Weg, den der oeffentliche Auftritt
   * geschaeftlich hat: `/angebot` war gebaut und stand in KEINER Navigation.
   */
  readonly angebotAnfragen: string;
  /** Das Vollbild-Menue des Telefons (DESIGN §5) — Beschriftung und Schliessen. */
  readonly menue: string;
  readonly menueSchliessen: string;
  /**
   * Der Weg vom oeffentlichen Auftritt IN die Plattform.
   *
   * Er fehlte, und das war kein Schoenheitsfehler: es gab von `/` aus
   * ueberhaupt keinen Verweis auf das Portal — wer sich anmelden wollte,
   * musste die Adresse kennen und tippen. Zwei Flaechen derselben Anwendung
   * lasen sich dadurch wie zwei Anwendungen.
   */
  readonly anmelden: string;
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
  /** Der eine Satz unter dem Logo im Fussbereich — was die Gruppe ist. */
  readonly leitsatz: string;
  /** „Alle Rechte vorbehalten." hinter dem Jahr. */
  readonly alleRechte: string;
  /** Beschriftung der Spalte mit Anschriften. */
  readonly anschriften: string;
}

export const SHELL_TEXTE: Readonly<Record<Sprache, ShellTexte>> = {
  de: {
    hauptnavigation: 'Hauptnavigation',
    bereicheNav: 'Unsere Bereiche',
    gesellschaftenNav: 'Gesellschaften der Gruppe',
    rechtlichesNav: 'Rechtliches',
    sprachwahl: 'Sprache',
    zurStartseite: 'Zur Startseite',
    mehrErfahren: 'Mehr erfahren →',
    platzhalterbild: 'Platzhalterbild',
    angebotAnfragen: 'Angebot anfragen',
    menue: 'Menü',
    menueSchliessen: 'Menü schliessen',
    anmelden: 'Anmelden',
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
    leitsatz: 'Gebäudereinigung, Sicherheitsdienste und Bau — vier Gesellschaften, ein Standort in Berlin.',
    alleRechte: 'Alle Rechte vorbehalten.',
    anschriften: 'Anschriften',
  },
  en: {
    hauptnavigation: 'Main navigation',
    bereicheNav: 'Our divisions',
    gesellschaftenNav: 'Group companies',
    rechtlichesNav: 'Legal',
    sprachwahl: 'Language',
    zurStartseite: 'To the home page',
    mehrErfahren: 'Learn more →',
    platzhalterbild: 'Placeholder image',
    angebotAnfragen: 'Request a quote',
    menue: 'Menu',
    menueSchliessen: 'Close menu',
    anmelden: 'Sign in',
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
    leitsatz: 'Cleaning, security and construction — four companies, one base in Berlin.',
    alleRechte: 'All rights reserved.',
    anschriften: 'Addresses',
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

/**
 * Die Dankseite `/angebot/[bereich]/danke` (§2.3, REQ-01).
 *
 * **Sie nennt die Vorgangsnummer**, und das ist kein Schmuck: sie ist das
 * einzige, womit ein Anfragender bei einem Rueckruf auf seine Anfrage zeigen
 * kann. Ohne sie heisst es „ich habe da mal was geschickt".
 *
 * **Und sie verspricht keine Frist.** Wie schnell geantwortet wird, ist die
 * offene Frage O-14 — die Plattform kennt eine Frist je Formular, aber ob sie
 * dem Kunden GENANNT werden soll, ist eine Zusage des Mandanten und keine des
 * Entwicklers. Ein „wir melden uns binnen 24 Stunden" auf einer Website ist
 * eine Werbeaussage, an der man gemessen wird.
 */
export interface DankTexte {
  readonly titel: string;
  readonly satz: string;
  readonly nummerLabel: string;
  readonly nummerHinweis: string;
  readonly weiter: string;
  readonly zurStartseite: string;
}

export const DANK_TEXTE: Readonly<Record<Sprache, DankTexte>> = {
  de: {
    titel: 'Ihre Anfrage ist angekommen',
    satz: 'Vielen Dank. Wir haben Ihre Anfrage aufgenommen und sehen sie uns an. '
      + 'Sobald wir sie durchgegangen sind, melden wir uns bei Ihnen.',
    nummerLabel: 'Ihre Vorgangsnummer',
    nummerHinweis: 'Bitte nennen Sie diese Nummer, wenn Sie sich auf die Anfrage beziehen.',
    weiter: 'Noch eine Anfrage stellen',
    zurStartseite: 'Zur Startseite',
  },
  en: {
    titel: 'Your enquiry has arrived',
    satz: 'Thank you. We have recorded your enquiry and are looking at it. '
      + 'We will get in touch as soon as we have been through it.',
    nummerLabel: 'Your reference number',
    nummerHinweis: 'Please quote this number when referring to your enquiry.',
    weiter: 'Send another enquiry',
    zurStartseite: 'Back to the home page',
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

// ---------------------------------------------------------------------------
// Das Mitarbeiterportal — vier Sprachen (EMP-12, SEITENKARTE §12)
// ---------------------------------------------------------------------------

/**
 * Die vier Sprachen der arbeitenden Oberflaechen — und warum sie NICHT
 * `SPRACHEN` sind.
 *
 * `src/lib/sprache.ts` beschreibt die oeffentliche Website: zwei Sprachen, und
 * die englische traegt einen Pfadpraefix, weil eine Seite je Sprache eine
 * eigene `seite`-Zeile ist (D-82). Das Mitarbeiterportal ist das Gegenteil:
 * **kein Sprachsegment im Pfad** (SEITENKARTE §12), weil vierzig Arbeiterrouten
 * mal vier Sprachen vierzig Adressen zu hundertsechzig machten — und weil dann
 * zwei URLs auf denselben § 17-MiLoG-Bildschirm zeigten.
 *
 * Die Sprache kommt stattdessen aus `person.sprache` (D-09: sie ist eine
 * Tatsache ueber den MENSCHEN, nicht ueber eine Beschaeftigung). Die Spalte
 * traegt genau diese vier Werte als CHECK.
 */
export const PORTAL_SPRACHEN = ['de', 'en', 'ar', 'tr'] as const;
export type PortalSprache = (typeof PORTAL_SPRACHEN)[number];

export function istPortalSprache(wert: string): wert is PortalSprache {
  return (PORTAL_SPRACHEN as readonly string[]).includes(wert);
}

/** Was in `lang` steht (WCAG 3.1.1). */
export const PORTAL_BCP47: Readonly<Record<PortalSprache, string>> = {
  de: 'de-DE', en: 'en', ar: 'ar', tr: 'tr',
};

/**
 * Die Schreibrichtung. Arabisch ist RTL, und das ist kein Schoenheitsfehler,
 * wenn es fehlt: die Zeile beginnt dann auf der falschen Seite, der
 * Zurueck-Pfeil zeigt in die falsche Richtung, und die Bedienung kehrt sich
 * gegen den Lesefluss.
 */
export const PORTAL_RICHTUNG: Readonly<Record<PortalSprache, 'ltr' | 'rtl'>> = {
  de: 'ltr', en: 'ltr', ar: 'rtl', tr: 'ltr',
};

/** Der Name der Sprache IN ihrer Sprache — nie uebersetzt. */
export const PORTAL_EIGENNAME: Readonly<Record<PortalSprache, string>> = {
  de: 'Deutsch', en: 'English', ar: 'العربية', tr: 'Türkçe',
};

/**
 * Die Beschriftungen des Mitarbeiterportals.
 *
 * **Ein `Record` ueber `PortalSprache`, kein `t()` mit freiem Schluessel** —
 * dieselbe Begruendung wie oben fuer die Website: ein vergessener Eintrag ist
 * ein Uebersetzungsfehler zur Bauzeit und nicht ein deutsches Wort auf dem
 * Bildschirm eines Menschen, der WEGEN der Uebersetzung hier liest.
 *
 * **Was hier NICHT uebersetzt wird**: Zahlen, Geld, Datum und Uhrzeit. Sie
 * stehen in jeder Sprache in der gesetzlichen Form — `1.234,56 €`,
 * `Europe/Berlin` (Invarianten 1 und 2, SEITENKARTE §12). Wer auf Tuerkisch
 * liest, sieht genau die Stunden, die in seiner MiLoG-Aufzeichnung stehen.
 */
export interface MeinTexte {
  readonly heute: string;
  readonly schichten: string;
  readonly zeiten: string;
  readonly stundenkonto: string;
  readonly urlaub: string;
  readonly antraege: string;
  readonly nachweise: string;
  readonly monatsnachweis: string;
  readonly abwesenheit: string;
  /** Die Ueberschrift ueber den Zielen, die nicht in die Leiste passen. */
  readonly weiteres: string;

  readonly laufendeSchicht: string;
  readonly naechsteSchicht: string;
  readonly keineSchicht: string;
  readonly gesellschaft: string;
  readonly objekt: string;
  readonly beginn: string;
  readonly ende: string;
  readonly dauer: string;
  readonly pause: string;
  readonly status: string;
  readonly datum: string;

  readonly stundenHeute: string;
  readonly stundenWoche: string;
  readonly stundenMonat: string;
  readonly kombiniert: string;
  readonly jeBeschaeftigung: string;

  readonly soll: string;
  readonly ist: string;
  readonly saldo: string;
  readonly vortrag: string;
  readonly monat: string;
  readonly gesperrt: string;
  readonly offen: string;
  readonly vorlaeufig: string;
  /** Die Antwort auf O-18 — nie eine erfundene Zahl. */
  readonly nichtHinterlegt: string;
  readonly nichtHinterlegtErklaerung: string;

  readonly anspruch: string;
  readonly genommen: string;
  readonly verplant: string;
  readonly rest: string;
  readonly tage: string;

  readonly keinBearbeiten: string;
  readonly einwandMelden: string;
  readonly einwandArt: string;
  readonly einwandBegruendung: string;
  readonly serverZeit: string;
  readonly geraeteZeit: string;
  readonly abweichung: string;
  readonly meineMeldungen: string;

  readonly antragNeu: string;
  readonly antragArt: string;
  readonly von: string;
  readonly bis: string;
  readonly nachricht: string;
  readonly zurueckziehen: string;
  readonly abwesenheitMelden: string;
  readonly abwesenheitArt: string;
  readonly absenden: string;

  readonly gueltigBis: string;
  readonly unbefristet: string;
  readonly abgelaufen: string;
  readonly laeuftAb: string;
  readonly sperrtEinteilung: string;
  readonly registerBewacher: string;
  readonly nichtVerbunden: string;

  readonly keineEintraege: string;
  readonly pflichtfeld: string;
  readonly sprache: string;
  readonly drucken: string;
  readonly summe: string;

  /**
   * Die Dienstanweisung auf dem Telefon (EMP-09, SEC-06, PR 42).
   *
   * `pruefsumme` steht hier, weil sie auf dem Bildschirm steht: die
   * Bestaetigung kopiert den Digest der Fassung, und wer spaeter fragt, was
   * bestaetigt wurde, soll dieselbe Zeichenfolge sehen wie die Wache damals.
   */
  readonly dienstanweisungen: string;
  readonly dienstanweisungLesen: string;
  readonly bestaetigen: string;
  readonly bestaetigtAm: string;
  readonly nichtBestaetigt: string;
  readonly neueFassung: string;
  readonly fassung: string;
  readonly giltAb: string;
  readonly pruefsumme: string;
  readonly nurAufDeutsch: string;
  readonly vorNaechsterSchicht: string;

  /**
   * Die Leiste und die Kopfzeile des Portals (D-419).
   *
   * Die fuenf Tabs kamen aus `registry/tableiste.ts` und standen dort nur auf
   * Deutsch — die arabische Oberflaeche trug unten „Heute · Schichten ·
   * Stunden · Nachrichten · Profil", und die Spur oben las „‹ Heute ›". Wer
   * WEGEN der Uebersetzung hier liest, fand die Navigation unuebersetzt.
   */
  readonly nachrichten: string;
  /** Der Posteingang der Person (EMP-11, NOT-03) — der vierte Tab. */
  readonly keineNachrichten: string;
  readonly ungelesen: string;
  readonly gelesen: string;
  readonly oeffnen: string;
  /**
   * Die zweite Quelle desselben Bildschirms (EMP-11, NOT-03, 0350).
   *
   * `/portal/mein/nachrichten` zeigte bis 0350 ausschliesslich
   * `benachrichtigung` — Waechter-, Ablauf- und Fristmeldungen. Eine interne
   * Nachricht der Leitung steht in `nachricht`, einer ANDEREN Tabelle, und kam
   * deshalb nie an. Die Seite fuehrt jetzt beides zusammen; damit die Kraft
   * die zwei Arten auseinanderhaelt, traegt jede Zeile ihre Beschriftung.
   */
  readonly systemmeldung: string;
  readonly nachrichtenFaden: string;
  readonly verlauf: string;
  readonly absender: string;
  /** Eine Zeile, die ich selbst geschrieben habe — kein fremder Name davor. */
  readonly ichSelbst: string;
  readonly unbekannterAbsender: string;
  readonly antworten: string;
  readonly ihreAntwort: string;
  readonly alsGelesenMarkieren: string;
  readonly fadenGeschlossen: string;
  /** Invariante 7: nichts verlaesst das System. Und das steht auf dem Schirm. */
  readonly antwortNurImPortal: string;
  /** Die Rueckmeldung nach einem POST — sie sagt, WAS geschehen ist. */
  readonly gespeichert: string;
  readonly antwortImVorgang: string;
  /** Der Stempel traf null eigene Zeilen. „Gespeichert." waere hier unwahr. */
  readonly schonGelesen: string;
  /**
   * Zwei offene Geschaeftsfragen, als SATZ auf dem Bildschirm (O-830, O-831).
   *
   * Nicht ein ausgegrauter Knopf und nicht ein weggelassener Absatz: wer eine
   * Anlage erwartet und keine sieht, sucht sie — und wer schreiben will und
   * keinen Knopf findet, haelt das Portal fuer kaputt.
   */
  readonly neuerFadenOffen: string;
  readonly anlagen: string;
  readonly anlagenNichtAbrufbar: string;
  readonly profil: string;
  readonly bereichWechseln: string;
  readonly konto: string;
  readonly website: string;
  readonly abmelden: string;
  /** Die Landmarken der Kopfzeile — ein Screenreader liest sie vor. */
  readonly sitzung: string;
  readonly pfad: string;

  /**
   * Die Seiten, die AUF der Schicht entstehen (SEC-05, CLN-04, TIM-10,
   * BAU-07) — und der Antrag und die Nachricht im Einzelnen.
   *
   * Sie stehen hier und nicht als zweite Karte daneben, weil `MEIN_TEXTE` die
   * einzige Stelle ist, die `tests/kern/mitarbeiter-sprachen.test.ts` auf
   * Vollstaendigkeit prueft. Ein zweiter Datensatz waere ein zweiter, den
   * niemand prueft — und die halbe Uebersetzung faellt genau dort an.
   *
   * **Was NICHT uebersetzt wird**: der Bestaetigungstext, unter dem der Kunde
   * unterschreibt. Er ist die Erklaerung, an die die Gesellschaft gebunden
   * ist, und bleibt deutsch (SEITENKARTE §12, 0066).
   */
  readonly zurueck: string;
  readonly empfangenAm: string;
  readonly zumDatensatz: string;
  readonly eingereichtAm: string;
  readonly entschiedenAm: string;
  readonly entscheidung: string;
  readonly zurueckgezogen: string;
  readonly zurueckziehenHinweis: string;

  readonly wachbuch: string;
  readonly wachbuchNeu: string;
  readonly uebergabe: string;
  /**
   * Das Uebergabefenster ist GAR NICHT eingestellt (`uebergabeFenster ===
   * null`) — die offene Frage O-151 ist noch nicht beantwortet.
   *
   * Getrennt von `uebergabeAus`, weil `Schichtbuch.uebergabeFenster` die zwei
   * Faelle mit Absicht unterscheidet: `null` heisst „nie eingerichtet",
   * `00:00:00` heisst „eingestellt und abgeschaltet" (der Seed-Vorgabewert aus
   * 0033). Ein Satz fuer beide behauptete auf jedem Seed-Bildschirm etwas,
   * das dort nicht stimmt.
   */
  readonly uebergabeNichtEingestellt: string;
  /** Das Fenster ist eingestellt und steht auf 0 — bewusst abgeschaltet. */
  readonly uebergabeAus: string;
  readonly art: string;
  readonly betreff: string;
  readonly eintragstext: string;
  readonly kontrollpunkt: string;
  readonly praesenz: string;
  readonly polizei: string;
  readonly nummer: string;
  readonly erfasstAm: string;
  readonly unveraenderlich: string;

  readonly leistungsnachweis: string;
  readonly leistungszeitraum: string;
  readonly positionen: string;
  readonly menge: string;
  readonly einheit: string;
  readonly entwurfAnlegen: string;
  readonly vorlegen: string;
  readonly unterschrift: string;
  readonly unterzeichnerName: string;
  readonly unterschreiben: string;
  readonly unterschrieben: string;

  readonly fotos: string;
  readonly aufnahmeHinzufuegen: string;
  readonly beschreibung: string;
  readonly keineAufnahmen: string;
  readonly ohneOrtsdaten: string;

  readonly bautagebuch: string;
  readonly mannstunden: string;
  readonly gewerk: string;
  readonly anzahlPersonen: string;
  readonly geraet: string;
  readonly lieferung: string;
  readonly vorkommnis: string;
  readonly bezeichnung: string;
  readonly hinzufuegen: string;
  readonly tagGeschlossen: string;
  readonly abgleich: string;
  /**
   * Die vier Befunde des Mannstundenabgleichs — als SCHLUESSEL und nicht als
   * fertiger Satz.
   *
   * `gleicheMannstundenAb` liefert in `text` einen deutschen Satz. Er gehoert
   * dem internen Portal; auf einem Arbeiterbildschirm, der nach SPEC §10 auch
   * arabisch und tuerkisch kann, waere er die einzige deutsche Zeile der
   * Seite. Die Zahl steht daneben und kommt weiter aus dem Dienst — nur der
   * Satz wird hier gewaehlt.
   */
  readonly abgleichDeckungsgleich: string;
  readonly abgleichAbweichung: string;
  readonly abgleichOhneAngabe: string;
  readonly abgleichZeitNichtLesbar: string;
  /** Beschriftung ueber der Wetterquelle — nicht „Status" (die Pille daneben). */
  readonly wetterQuelle: string;
  /**
   * Die Schicht ist vorbei — erfasst wird nichts mehr.
   *
   * `app.ist_eingesetzt_auf_objekt`/`…_projekt` verlangen
   * `ende_zeitpunkt >= now()`; mit der Minute des Schichtendes schliessen
   * Wachbuch, Fotos, Leistungsnachweis und Bautagebuch. Bis O-740 beantwortet
   * ist, ist das die Grenze — und sie steht auf dem Bildschirm, statt dass ein
   * Formular scheitert.
   */
  readonly schichtBeendet: string;
  /** Die Einteilung wurde aus dem Plan genommen (`entfernt_am`). */
  readonly schichtEntfernt: string;
  /**
   * Der Nachweis ist vorgelegt, traegt aber keine Nummer.
   *
   * `legeVor` gibt diesen Fall als `nummerOffen` zurueck; ohne den Satz stuende
   * das Blatt ohne Nummer da und niemand wuesste, ob das so gehoert (O-147).
   */
  readonly nummerOffen: string;
  readonly offeneFrage: string;

  /**
   * Die eigenen Dokumente und die eigenen Objekte (EMP-02, EMP-11, DOC-03,
   * DOC-04, OPS-01) — `/portal/mein/dokumente` und `/portal/mein/objekte`.
   *
   * **`dokumenteOffenerBezug` traegt eine offene Frage als SATZ.** „Die
   * Dokumente, die diesen Menschen betreffen" und „die Dokumente, die der
   * Belegschaft freigegeben sind" sind nicht dasselbe, und `dokument` traegt
   * keine `person_id` (O-850). Wer eine Lohnabrechnung sucht und eine
   * Betriebsanweisung findet, soll lesen koennen, warum — nicht raten.
   *
   * **`zutrittNurWaehrendEinteilung` ist keine Entschuldigung, sondern die
   * Regel.** Ein Schluessel- oder Alarmcode gehoert dem, der dort eingeteilt
   * IST, und nur, solange er es ist (`app.ist_eingesetzt_auf_objekt`, 0069,
   * 0360). Der Satz steht da, wo der Hinweis stuende — sonst liest sich ein
   * leeres Feld wie „ist nichts hinterlegt", und die Kraft steht vor der Tuer
   * und sucht weiter.
   */
  readonly dokumente: string;
  readonly keineDokumente: string;
  readonly kategorie: string;
  readonly alleKategorien: string;
  readonly dateiOeffnen: string;
  readonly signaturHinweis: string;
  readonly gueltigMinuten: string;
  readonly groesse: string;
  readonly abgelegtAm: string;
  readonly dokumenteOffenerBezug: string;
  readonly abrufProtokolliert: string;
  /** Die Liste ist an ihrer Obergrenze — und sagt es, statt still abzuschneiden. */
  readonly listeGekuerzt: string;

  readonly objekte: string;
  readonly keineObjekte: string;
  readonly objektnummer: string;
  readonly anschrift: string;
  readonly gebaeudetyp: string;
  readonly etagen: string;
  readonly zutritt: string;
  readonly ansprechpartner: string;
  readonly telefon: string;
  readonly mobil: string;
  readonly aktuellEingeteilt: string;
  readonly nichtMehrEingeteilt: string;
  readonly zutrittNurWaehrendEinteilung: string;
  readonly keinZutrittHinterlegt: string;
  readonly letzteSchicht: string;
  readonly meineSchichtenHier: string;
}

export const MEIN_TEXTE: Readonly<Record<PortalSprache, MeinTexte>> = {
  de: {
    heute: 'Heute',
    schichten: 'Schichten',
    zeiten: 'Meine Zeiten',
    stundenkonto: 'Stundenkonto',
    urlaub: 'Urlaub',
    antraege: 'Anträge',
    nachweise: 'Nachweise',
    monatsnachweis: 'Monatsnachweis',
    abwesenheit: 'Abwesenheit',
    weiteres: 'Weiteres',
    laufendeSchicht: 'Laufende Schicht',
    naechsteSchicht: 'Nächste Schicht',
    keineSchicht: 'Für Sie ist derzeit keine Schicht eingeteilt.',
    gesellschaft: 'Gesellschaft',
    objekt: 'Objekt',
    beginn: 'Beginn',
    ende: 'Ende',
    dauer: 'Dauer',
    pause: 'Pause',
    status: 'Status',
    datum: 'Datum',
    stundenHeute: 'Stunden heute',
    stundenWoche: 'Stunden Woche',
    stundenMonat: 'Stunden Monat',
    kombiniert: 'Zusammen',
    jeBeschaeftigung: 'Je Beschäftigung',
    soll: 'Soll',
    ist: 'Ist',
    saldo: 'Saldo',
    vortrag: 'Vortrag',
    monat: 'Monat',
    gesperrt: 'Abgeschlossen',
    offen: 'Offen',
    vorlaeufig: 'Vorläufig',
    nichtHinterlegt: 'nicht hinterlegt',
    nichtHinterlegtErklaerung:
      'Die Sollstunden sind für diese Beschäftigung nicht hinterlegt. Hier steht '
      + 'bewusst keine Zahl: eine geratene Sollzeit sähe richtig aus und verschöbe '
      + 'Ihren Saldo.',
    anspruch: 'Anspruch',
    genommen: 'Genommen',
    verplant: 'Verplant',
    rest: 'Rest',
    tage: 'Tage',
    keinBearbeiten:
      'Zeiten lassen sich hier nicht ändern. Wenn etwas nicht stimmt, melden Sie '
      + 'einen Einwand — die Planung entscheidet darüber.',
    einwandMelden: 'Einwand melden',
    einwandArt: 'Art des Einwands',
    einwandBegruendung: 'Was stimmt nicht?',
    serverZeit: 'Serverzeit',
    geraeteZeit: 'Gerätezeit',
    abweichung: 'Abweichung',
    meineMeldungen: 'Meine Meldungen',
    antragNeu: 'Neuer Antrag',
    antragArt: 'Art des Antrags',
    von: 'Von',
    bis: 'Bis',
    nachricht: 'Nachricht',
    zurueckziehen: 'Zurückziehen',
    abwesenheitMelden: 'Abwesenheit melden',
    abwesenheitArt: 'Art der Abwesenheit',
    absenden: 'Absenden',
    gueltigBis: 'Gültig bis',
    unbefristet: 'unbefristet',
    abgelaufen: 'Abgelaufen',
    laeuftAb: 'Läuft ab',
    sperrtEinteilung: 'Ohne diesen Nachweis darf Sie niemand einteilen.',
    registerBewacher: 'Bewacherregister',
    nichtVerbunden: 'nicht verbunden',
    keineEintraege: 'Keine Einträge.',
    pflichtfeld: 'Pflichtfeld',
    sprache: 'Sprache',
    drucken: 'Drucken',
    summe: 'Summe',
    dienstanweisungen: 'Dienstanweisungen',
    dienstanweisungLesen: 'Anweisung lesen',
    bestaetigen: 'Gelesen und verstanden',
    bestaetigtAm: 'Bestätigt am',
    nichtBestaetigt: 'Noch nicht bestätigt',
    neueFassung: 'Neue Fassung — bitte erneut bestätigen',
    fassung: 'Fassung',
    giltAb: 'Gilt ab',
    pruefsumme: 'Prüfsumme der Fassung',
    nurAufDeutsch: 'Dieser Text liegt nur auf Deutsch vor.',
    vorNaechsterSchicht: 'Vor Ihrer nächsten Schicht',
    nachrichten: 'Nachrichten',
    keineNachrichten: 'Keine Nachrichten. Das heisst: nichts Offenes — nicht, dass etwas fehlt.',
    ungelesen: 'ungelesen',
    gelesen: 'gelesen',
    oeffnen: 'Öffnen',
    systemmeldung: 'Systemmeldung',
    nachrichtenFaden: 'Nachricht',
    verlauf: 'Verlauf',
    absender: 'Von',
    ichSelbst: 'Ich',
    unbekannterAbsender: 'Unbekannt',
    antworten: 'Antworten',
    ihreAntwort: 'Ihre Antwort',
    alsGelesenMarkieren: 'Als gelesen markieren',
    fadenGeschlossen:
      'Dieser Vorgang ist abgeschlossen. Er bleibt lesbar und nimmt keine Antwort mehr auf.',
    antwortNurImPortal:
      'Ihre Antwort bleibt im Portal. Sie geht nicht per E-Mail oder SMS hinaus.',
    gespeichert: 'Gespeichert.',
    antwortImVorgang: 'Ihre Antwort steht im Vorgang.',
    schonGelesen: 'Für Sie war dieser Vorgang schon gelesen.',
    neuerFadenOffen:
      'Von sich aus eine Nachricht zu schreiben ist noch nicht eingerichtet — wen Sie dann anschreiben dürfen, ist eine offene Frage (O-830). Auf einen Vorgang zu antworten funktioniert.',
    anlagen: 'Anlagen',
    anlagenNichtAbrufbar:
      'Die Dateien erhalten Sie auf dem bisherigen Weg; ob Anlagen im Portal zu öffnen sind, ist noch nicht entschieden (O-831).',
    profil: 'Profil',
    bereichWechseln: 'Bereich wechseln',
    konto: 'Konto',
    website: 'Website',
    abmelden: 'Abmelden',
    sitzung: 'Sitzung',
    pfad: 'Pfad',
     zurueck: 'Zurück',
    empfangenAm: 'Empfangen am',
    zumDatensatz: 'Zum Vorgang',
    eingereichtAm: 'Eingereicht am',
    entschiedenAm: 'Entschieden am',
    entscheidung: 'Entscheidung',
    zurueckgezogen: 'Zurückgezogen',
    zurueckziehenHinweis:
      'Zurückziehen geht, solange niemand entschieden hat. Der Antrag bleibt lesbar.',
    wachbuch: 'Wachbuch',
    wachbuchNeu: 'Eintrag schreiben',
    uebergabe: 'Übergabe',
    uebergabeNichtEingestellt:
      'Das Übergabefenster ist noch nicht eingestellt (offene Frage O-151). Bis dahin '
      + 'stehen hier nur die eigenen Einträge.',
    uebergabeAus:
      'Das Übergabefenster ist eingestellt und steht auf null — die Einträge der '
      + 'Vorschicht bleiben verdeckt. Hier stehen nur die eigenen Einträge.',
    art: 'Art',
    betreff: 'Betreff',
    eintragstext: 'Was ist passiert?',
    kontrollpunkt: 'Kontrollpunkt',
    praesenz: 'Präsenz bestätigt',
    polizei: 'Polizei informiert',
    nummer: 'Nummer',
    erfasstAm: 'Erfasst am',
    unveraenderlich:
      'Ein Eintrag bleibt stehen. Falsches wird richtiggestellt, nicht gelöscht.',
    leistungsnachweis: 'Leistungsnachweis',
    leistungszeitraum: 'Leistungszeitraum',
    positionen: 'Positionen',
    menge: 'Menge',
    einheit: 'Einheit',
    entwurfAnlegen: 'Nachweis anlegen',
    vorlegen: 'Vorlegen',
    unterschrift: 'Unterschrift',
    unterzeichnerName: 'Name des Unterzeichners',
    unterschreiben: 'Unterschreiben',
    unterschrieben: 'Unterschrieben',
    fotos: 'Fotos',
    aufnahmeHinzufuegen: 'Aufnahme hinzufügen',
    beschreibung: 'Beschreibung',
    keineAufnahmen: 'Zu dieser Schicht ist noch keine Aufnahme abgelegt.',
    ohneOrtsdaten: 'Ortsdaten werden vor dem Ablegen entfernt.',
    bautagebuch: 'Bautagebuch',
    mannstunden: 'Mannstunden',
    gewerk: 'Gewerk',
    anzahlPersonen: 'Personen',
    geraet: 'Gerät',
    lieferung: 'Lieferung',
    vorkommnis: 'Vorkommnis',
    bezeichnung: 'Bezeichnung',
    hinzufuegen: 'Hinzufügen',
    tagGeschlossen: 'Dieser Bautag ist geschlossen — es kommt nichts mehr hinzu.',
    abgleich: 'Abgleich mit der Zeiterfassung',
    abgleichDeckungsgleich: 'Die eigenen Stunden decken sich mit der Zeiterfassung dieses Tages.',
    abgleichAbweichung: 'Bautagebuch und Zeiterfassung weichen voneinander ab.',
    abgleichOhneAngabe: 'Für diesen Tag sind weder Mannstunden noch Zeiten erfasst.',
    abgleichZeitNichtLesbar:
      'Der Abgleich mit der Zeiterfassung ist diesem Zugang nicht möglich — es wird '
      + 'deshalb kein Befund gezeigt.',
    wetterQuelle: 'Wetterquelle',
    schichtBeendet:
      'Diese Schicht ist beendet. Erfasst wird hier nichts mehr; was fehlt, meldet '
      + 'die Einsatzleitung nach.',
    schichtEntfernt:
      'Diese Einteilung wurde aus dem Plan genommen. Sie bleibt lesbar, aber es kann '
      + 'nichts mehr dazu erfasst werden.',
    nummerOffen:
      'Dieser Nachweis hat noch keine Nummer — in dieser Gesellschaft ist kein '
      + 'Nummernkreis dafür eingerichtet.',
    offeneFrage: 'offen',

    dokumente: 'Dokumente',
    keineDokumente: 'Für Sie ist zurzeit kein Dokument freigegeben.',
    kategorie: 'Kategorie',
    alleKategorien: 'Alle',
    dateiOeffnen: 'Datei öffnen',
    signaturHinweis:
      'Die Datei liegt in einem geschützten Speicher. Der Link wird bei jedem Öffnen '
      + 'neu ausgestellt und verfällt danach.',
    gueltigMinuten: 'Minuten gültig',
    groesse: 'Größe',
    abgelegtAm: 'Abgelegt am',
    dokumenteOffenerBezug:
      'Hier steht, was Ihre Gesellschaft der Belegschaft freigegeben hat. Unterlagen, '
      + 'die nur Sie persönlich betreffen, sind noch nicht zugeordnet — offen (O-850).',
    abrufProtokolliert: 'Jeder Abruf wird mit Ihrem Konto protokolliert.',
    listeGekuerzt:
      'Es werden nur die neuesten Einträge angezeigt. Grenzen Sie die Liste über die '
      + 'Kategorie ein.',

    objekte: 'Meine Objekte',
    keineObjekte: 'Sie sind auf keinem Objekt eingeteilt.',
    objektnummer: 'Objektnummer',
    anschrift: 'Anschrift',
    gebaeudetyp: 'Gebäudetyp',
    etagen: 'Etagen',
    zutritt: 'Zutritt',
    ansprechpartner: 'Ansprechpartner vor Ort',
    telefon: 'Telefon',
    mobil: 'Mobil',
    aktuellEingeteilt: 'Aktuell eingeteilt',
    nichtMehrEingeteilt: 'Sie sind hier zurzeit nicht eingeteilt.',
    zutrittNurWaehrendEinteilung:
      'Zutrittsangaben und Ansprechpartner sehen Sie, solange Sie auf diesem Objekt '
      + 'eingeteilt sind.',
    keinZutrittHinterlegt: 'Für dieses Objekt ist kein Zutrittshinweis hinterlegt.',
    letzteSchicht: 'Letzte Schicht',
    meineSchichtenHier: 'Meine Schichten hier',
  },
  en: {
    heute: 'Today',
    schichten: 'Shifts',
    zeiten: 'My hours',
    stundenkonto: 'Hours account',
    urlaub: 'Leave',
    antraege: 'Requests',
    nachweise: 'Certificates',
    monatsnachweis: 'Monthly statement',
    abwesenheit: 'Absence',
    weiteres: 'More',
    laufendeSchicht: 'Current shift',
    naechsteSchicht: 'Next shift',
    keineSchicht: 'You are not scheduled for a shift at the moment.',
    gesellschaft: 'Company',
    objekt: 'Site',
    beginn: 'Start',
    ende: 'End',
    dauer: 'Duration',
    pause: 'Break',
    status: 'Status',
    datum: 'Date',
    stundenHeute: 'Hours today',
    stundenWoche: 'Hours this week',
    stundenMonat: 'Hours this month',
    kombiniert: 'Combined',
    jeBeschaeftigung: 'Per employment',
    soll: 'Target',
    ist: 'Actual',
    saldo: 'Balance',
    vortrag: 'Carried forward',
    monat: 'Month',
    gesperrt: 'Closed',
    offen: 'Open',
    vorlaeufig: 'Provisional',
    nichtHinterlegt: 'not on file',
    nichtHinterlegtErklaerung:
      'No target hours are on file for this employment. No number is shown on '
      + 'purpose: a guessed target would look right and would shift your balance.',
    anspruch: 'Entitlement',
    genommen: 'Taken',
    verplant: 'Booked',
    rest: 'Remaining',
    tage: 'days',
    keinBearbeiten:
      'Time records cannot be edited here. If something is wrong, raise an '
      + 'objection — the planning team decides on it.',
    einwandMelden: 'Raise an objection',
    einwandArt: 'Type of objection',
    einwandBegruendung: 'What is wrong?',
    serverZeit: 'Server time',
    geraeteZeit: 'Device time',
    abweichung: 'Deviation',
    meineMeldungen: 'My objections',
    antragNeu: 'New request',
    antragArt: 'Type of request',
    von: 'From',
    bis: 'To',
    nachricht: 'Message',
    zurueckziehen: 'Withdraw',
    abwesenheitMelden: 'Report an absence',
    abwesenheitArt: 'Type of absence',
    absenden: 'Submit',
    gueltigBis: 'Valid until',
    unbefristet: 'no expiry',
    abgelaufen: 'Expired',
    laeuftAb: 'Expiring',
    sperrtEinteilung: 'Without this certificate nobody may schedule you.',
    registerBewacher: 'Guard register',
    nichtVerbunden: 'not connected',
    keineEintraege: 'No entries.',
    pflichtfeld: 'Required',
    sprache: 'Language',
    drucken: 'Print',
    summe: 'Total',
    dienstanweisungen: 'Duty instructions',
    dienstanweisungLesen: 'Read instruction',
    bestaetigen: 'Read and understood',
    bestaetigtAm: 'Acknowledged on',
    nichtBestaetigt: 'Not acknowledged yet',
    neueFassung: 'New version — please acknowledge again',
    fassung: 'Version',
    giltAb: 'Valid from',
    pruefsumme: 'Version checksum',
    nurAufDeutsch: 'This text is available in German only.',
    vorNaechsterSchicht: 'Before your next shift',
    nachrichten: 'Messages',
    keineNachrichten: 'No messages. That means nothing is pending — not that something is missing.',
    ungelesen: 'unread',
    gelesen: 'read',
    oeffnen: 'Open',
    systemmeldung: 'System notice',
    nachrichtenFaden: 'Message',
    verlauf: 'History',
    absender: 'From',
    ichSelbst: 'Me',
    unbekannterAbsender: 'Unknown',
    antworten: 'Reply',
    ihreAntwort: 'Your reply',
    alsGelesenMarkieren: 'Mark as read',
    fadenGeschlossen:
      'This thread is closed. It stays readable and takes no further reply.',
    antwortNurImPortal:
      'Your reply stays in the portal. It is not sent by email or SMS.',
    gespeichert: 'Saved.',
    antwortImVorgang: 'Your reply is now part of the thread.',
    schonGelesen: 'For you this thread was already read.',
    neuerFadenOffen:
      'Starting a message yourself is not set up yet — who you would be allowed to write to is an open question (O-830). Replying to a thread works.',
    anlagen: 'Attachments',
    anlagenNichtAbrufbar:
      'You receive the files the way you did before; whether attachments can be opened in the portal has not been decided yet (O-831).',
    profil: 'Profile',
    bereichWechseln: 'Switch area',
    konto: 'Account',
    website: 'Website',
    abmelden: 'Sign out',
    sitzung: 'Session',
    pfad: 'Path',
     zurueck: 'Back',
    empfangenAm: 'Received on',
    zumDatensatz: 'Go to record',
    eingereichtAm: 'Submitted on',
    entschiedenAm: 'Decided on',
    entscheidung: 'Decision',
    zurueckgezogen: 'Withdrawn',
    zurueckziehenHinweis:
      'You can withdraw while nobody has decided. The request stays readable.',
    wachbuch: 'Security log',
    wachbuchNeu: 'Write an entry',
    uebergabe: 'Handover',
    uebergabeNichtEingestellt:
      'The handover window has not been configured yet (open question O-151). Until then '
      + 'only your own entries appear here.',
    uebergabeAus:
      'The handover window is configured and set to zero — the previous shift\u2019s entries '
      + 'stay hidden. Only your own entries appear here.',
    art: 'Type',
    betreff: 'Subject',
    eintragstext: 'What happened?',
    kontrollpunkt: 'Checkpoint',
    praesenz: 'Presence confirmed',
    polizei: 'Police informed',
    nummer: 'Number',
    erfasstAm: 'Recorded on',
    unveraenderlich:
      'An entry stays. What is wrong is corrected alongside it, never deleted.',
    leistungsnachweis: 'Proof of service',
    leistungszeitraum: 'Service period',
    positionen: 'Line items',
    menge: 'Quantity',
    einheit: 'Unit',
    entwurfAnlegen: 'Create proof',
    vorlegen: 'Submit',
    unterschrift: 'Signature',
    unterzeichnerName: 'Name of the signatory',
    unterschreiben: 'Sign',
    unterschrieben: 'Signed',
    fotos: 'Photos',
    aufnahmeHinzufuegen: 'Add a photo',
    beschreibung: 'Description',
    keineAufnahmen: 'No photo has been stored for this shift yet.',
    ohneOrtsdaten: 'Location data is removed before storing.',
    bautagebuch: 'Site diary',
    mannstunden: 'Labour hours',
    gewerk: 'Trade',
    anzahlPersonen: 'People',
    geraet: 'Equipment',
    lieferung: 'Delivery',
    vorkommnis: 'Incident',
    bezeichnung: 'Designation',
    hinzufuegen: 'Add',
    tagGeschlossen: 'This site day is closed — nothing more is added.',
    abgleich: 'Comparison with time tracking',
    abgleichDeckungsgleich: 'Your own hours match this day\u2019s time tracking.',
    abgleichAbweichung: 'The site diary and the time tracking differ.',
    abgleichOhneAngabe: 'Neither man-hours nor times are recorded for this day.',
    abgleichZeitNichtLesbar:
      'This account cannot compare against time tracking — no finding is shown.',
    wetterQuelle: 'Weather source',
    schichtBeendet:
      'This shift has ended. Nothing more is recorded here; anything missing is filed '
      + 'by the dispatcher.',
    schichtEntfernt:
      'This assignment was removed from the plan. It stays readable, but nothing can '
      + 'be recorded against it any more.',
    nummerOffen:
      'This record does not have a number yet — no number range is configured for it '
      + 'in this company.',
    offeneFrage: 'open',

    dokumente: 'Documents',
    keineDokumente: 'No document has been released to you at the moment.',
    kategorie: 'Category',
    alleKategorien: 'All',
    dateiOeffnen: 'Open file',
    signaturHinweis:
      'The file sits in protected storage. The link is issued afresh each time you open '
      + 'it and expires afterwards.',
    gueltigMinuten: 'minutes valid',
    groesse: 'Size',
    abgelegtAm: 'Filed on',
    dokumenteOffenerBezug:
      'What you see here is what your company released to the workforce. Papers that '
      + 'concern you personally are not linked yet — open (O-850).',
    abrufProtokolliert: 'Every retrieval is logged against your account.',
    listeGekuerzt:
      'Only the most recent entries are shown. Narrow the list down by category.',

    objekte: 'My sites',
    keineObjekte: 'You are not assigned to any site.',
    objektnummer: 'Site number',
    anschrift: 'Address',
    gebaeudetyp: 'Building type',
    etagen: 'Floors',
    zutritt: 'Access',
    ansprechpartner: 'Contact on site',
    telefon: 'Phone',
    mobil: 'Mobile',
    aktuellEingeteilt: 'Currently assigned',
    nichtMehrEingeteilt: 'You are not assigned here at the moment.',
    zutrittNurWaehrendEinteilung:
      'Access details and the site contact are shown while you are assigned to this '
      + 'site.',
    keinZutrittHinterlegt: 'No access note is on file for this site.',
    letzteSchicht: 'Last shift',
    meineSchichtenHier: 'My shifts here',
  },
  ar: {
    heute: 'اليوم',
    schichten: 'المناوبات',
    zeiten: 'ساعاتي',
    stundenkonto: 'حساب الساعات',
    urlaub: 'الإجازة',
    antraege: 'الطلبات',
    nachweise: 'الشهادات',
    monatsnachweis: 'كشف الساعات الشهري',
    abwesenheit: 'الغياب',
    weiteres: 'المزيد',
    laufendeSchicht: 'المناوبة الجارية',
    naechsteSchicht: 'المناوبة القادمة',
    keineSchicht: 'لا توجد مناوبة مجدولة لك حالياً.',
    gesellschaft: 'الشركة',
    objekt: 'الموقع',
    beginn: 'البداية',
    ende: 'النهاية',
    dauer: 'المدة',
    pause: 'الاستراحة',
    status: 'الحالة',
    datum: 'التاريخ',
    stundenHeute: 'ساعات اليوم',
    stundenWoche: 'ساعات الأسبوع',
    stundenMonat: 'ساعات الشهر',
    kombiniert: 'الإجمالي',
    jeBeschaeftigung: 'لكل عقد عمل',
    soll: 'المطلوب',
    ist: 'الفعلي',
    saldo: 'الرصيد',
    vortrag: 'المرحّل',
    monat: 'الشهر',
    gesperrt: 'مُقفل',
    offen: 'مفتوح',
    vorlaeufig: 'مبدئي',
    nichtHinterlegt: 'غير مسجّل',
    nichtHinterlegtErklaerung:
      'ساعات العمل المطلوبة غير مسجّلة لعقد العمل هذا. لا يظهر أي رقم هنا عن قصد: '
      + 'رقم مُقدَّر سيبدو صحيحاً وسيغيّر رصيدك.',
    anspruch: 'الاستحقاق',
    genommen: 'المستهلك',
    verplant: 'المحجوز',
    rest: 'المتبقي',
    tage: 'أيام',
    keinBearbeiten:
      'لا يمكن تعديل سجلات الوقت هنا. إذا كان هناك خطأ، قدّم اعتراضاً — قسم التخطيط '
      + 'هو من يبتّ فيه.',
    einwandMelden: 'تقديم اعتراض',
    einwandArt: 'نوع الاعتراض',
    einwandBegruendung: 'ما الخطأ؟',
    serverZeit: 'وقت الخادم',
    geraeteZeit: 'وقت الجهاز',
    abweichung: 'الفارق',
    meineMeldungen: 'اعتراضاتي',
    antragNeu: 'طلب جديد',
    antragArt: 'نوع الطلب',
    von: 'من',
    bis: 'إلى',
    nachricht: 'رسالة',
    zurueckziehen: 'سحب الطلب',
    abwesenheitMelden: 'الإبلاغ عن غياب',
    abwesenheitArt: 'نوع الغياب',
    absenden: 'إرسال',
    gueltigBis: 'صالحة حتى',
    unbefristet: 'بدون تاريخ انتهاء',
    abgelaufen: 'منتهية',
    laeuftAb: 'توشك على الانتهاء',
    sperrtEinteilung: 'بدون هذه الشهادة لا يجوز لأحد جدولتك.',
    registerBewacher: 'سجل الحراسة',
    nichtVerbunden: 'غير متصل',
    keineEintraege: 'لا توجد إدخالات.',
    pflichtfeld: 'إلزامي',
    sprache: 'اللغة',
    drucken: 'طباعة',
    summe: 'المجموع',
    dienstanweisungen: 'تعليمات الخدمة',
    dienstanweisungLesen: 'اقرأ التعليمات',
    bestaetigen: 'قرأتُ التعليمات وفهمتُها',
    bestaetigtAm: 'تم التأكيد في',
    nichtBestaetigt: 'لم يتم التأكيد بعد',
    neueFassung: 'نسخة جديدة — يرجى التأكيد من جديد',
    fassung: 'النسخة',
    giltAb: 'سارية اعتباراً من',
    pruefsumme: 'بصمة النسخة',
    nurAufDeutsch: 'هذا النص متوفر باللغة الألمانية فقط.',
    vorNaechsterSchicht: 'قبل ورديتك القادمة',
    nachrichten: 'الرسائل',
    keineNachrichten: 'لا توجد رسائل. يعني ما في شي معلّق — مش إنّو في شي ناقص.',
    ungelesen: 'غير مقروءة',
    gelesen: 'مقروءة',
    oeffnen: 'فتح',
    systemmeldung: 'إشعار من النظام',
    nachrichtenFaden: 'رسالة',
    verlauf: 'المسار',
    absender: 'من',
    ichSelbst: 'أنا',
    unbekannterAbsender: 'غير معروف',
    antworten: 'ردّ',
    ihreAntwort: 'ردّك',
    alsGelesenMarkieren: 'وضع علامة مقروء',
    fadenGeschlossen:
      'هذه المحادثة مغلقة. تبقى للقراءة ولا تقبل ردًّا جديدًا.',
    antwortNurImPortal:
      'ردّك يبقى داخل البوابة ولا يُرسل عبر البريد الإلكتروني أو الرسائل القصيرة.',
    gespeichert: 'تم الحفظ.',
    antwortImVorgang: 'ردّك صار ضمن المحادثة.',
    schonGelesen: 'بالنسبة إلك هذه المحادثة كانت مقروءة أصلاً.',
    neuerFadenOffen:
      'إرسال رسالة من طرفك لسّا مش مفعّل — لمين بيحقّ لك تكتب سؤال مفتوح (O-830). الردّ على محادثة شغّال.',
    anlagen: 'المرفقات',
    anlagenNichtAbrufbar:
      'بتوصلك الملفات بالطريقة المعتادة؛ وهل تنفتح المرفقات داخل البوابة لسّا ما تقرّر (O-831).',
    profil: 'الملف الشخصي',
    bereichWechseln: 'تبديل القسم',
    konto: 'الحساب',
    website: 'الموقع',
    abmelden: 'تسجيل الخروج',
    sitzung: 'الجلسة',
    pfad: 'المسار',
     zurueck: 'رجوع',
    empfangenAm: 'تاريخ الاستلام',
    zumDatensatz: 'إلى السجل',
    eingereichtAm: 'تاريخ التقديم',
    entschiedenAm: 'تاريخ القرار',
    entscheidung: 'القرار',
    zurueckgezogen: 'مسحوب',
    zurueckziehenHinweis: 'يمكن سحب الطلب ما لم يُتخذ قرار بعد. ويبقى الطلب قابلاً للقراءة.',
    wachbuch: 'دفتر الحراسة',
    wachbuchNeu: 'كتابة قيد',
    uebergabe: 'التسليم',
    uebergabeNichtEingestellt:
      'لم تُضبط فترة التسليم بعد (مسألة مفتوحة، O-151). حتى ذلك الحين تظهر هنا قيودك أنت فقط.',
    uebergabeAus:
      'فترة التسليم مضبوطة على صفر — تبقى قيود الوردية السابقة مخفية. تظهر هنا قيودك أنت فقط.',
    art: 'النوع',
    betreff: 'الموضوع',
    eintragstext: 'ماذا حدث؟',
    kontrollpunkt: 'نقطة التفتيش',
    praesenz: 'تم تأكيد الحضور',
    polizei: 'تم إبلاغ الشرطة',
    nummer: 'الرقم',
    erfasstAm: 'تاريخ التسجيل',
    unveraenderlich: 'القيد يبقى. الخطأ يُصحَّح إلى جانبه ولا يُحذف.',
    leistungsnachweis: 'إثبات الخدمة',
    leistungszeitraum: 'فترة الخدمة',
    positionen: 'البنود',
    menge: 'الكمية',
    einheit: 'الوحدة',
    entwurfAnlegen: 'إنشاء الإثبات',
    vorlegen: 'تقديم',
    unterschrift: 'التوقيع',
    unterzeichnerName: 'اسم الموقِّع',
    unterschreiben: 'توقيع',
    unterschrieben: 'موقَّع',
    fotos: 'الصور',
    aufnahmeHinzufuegen: 'إضافة صورة',
    beschreibung: 'الوصف',
    keineAufnahmen: 'لا توجد صورة محفوظة لهذه المناوبة بعد.',
    ohneOrtsdaten: 'تُزال بيانات الموقع قبل الحفظ.',
    bautagebuch: 'يوميات الموقع',
    mannstunden: 'ساعات العمل',
    gewerk: 'الحرفة',
    anzahlPersonen: 'عدد الأشخاص',
    geraet: 'المعدات',
    lieferung: 'التوريد',
    vorkommnis: 'حادثة',
    bezeichnung: 'التسمية',
    hinzufuegen: 'إضافة',
    tagGeschlossen: 'أُغلق يوم الموقع هذا — لا يُضاف إليه شيء بعد الآن.',
    abgleich: 'المقارنة مع تسجيل الوقت',
    abgleichDeckungsgleich: 'ساعاتك تطابق تسجيل الوقت لهذا اليوم.',
    abgleichAbweichung: 'يوجد فرق بين يومية الموقع وتسجيل الوقت.',
    abgleichOhneAngabe: 'لم تُسجَّل لهذا اليوم ساعات عمل ولا أوقات.',
    abgleichZeitNichtLesbar:
      'لا يمكن لهذا الحساب المقارنة مع تسجيل الوقت — لذلك لا تُعرض أي نتيجة.',
    wetterQuelle: 'مصدر بيانات الطقس',
    schichtBeendet:
      'انتهت هذه الوردية. لم يعد بالإمكان التسجيل هنا؛ وما ينقص تستدركه إدارة العمليات.',
    schichtEntfernt:
      'أُزيل هذا التكليف من الخطة. يبقى قابلاً للقراءة، لكن لا يمكن تسجيل أي شيء عليه بعد الآن.',
    nummerOffen:
      'لا يحمل هذا المحضر رقماً بعد — لا يوجد نطاق ترقيم مُعدّ له في هذه الشركة.',
    offeneFrage: 'مفتوح',

    dokumente: 'المستندات',
    keineDokumente: 'لا يوجد حالياً أي مستند متاح لك.',
    kategorie: 'الفئة',
    alleKategorien: 'الكل',
    dateiOeffnen: 'فتح الملف',
    signaturHinweis:
      'الملف محفوظ في مخزن محمي. يُصدر الرابط من جديد عند كل فتح ثم تنتهي صلاحيته.',
    gueltigMinuten: 'دقيقة صلاحية',
    groesse: 'الحجم',
    abgelegtAm: 'تاريخ الحفظ',
    dokumenteOffenerBezug:
      'ما تراه هنا هو ما أتاحته شركتك للعاملين. أما الأوراق التي تخصّك شخصياً فلم تُربط '
      + 'بعد — مفتوح (O-850).',
    abrufProtokolliert: 'يُسجَّل كل استدعاء للملف باسم حسابك.',
    listeGekuerzt: 'تُعرض أحدث المدخلات فقط. ضيّق القائمة حسب الفئة.',

    objekte: 'مواقعي',
    keineObjekte: 'لست مكلّفاً بأي موقع.',
    objektnummer: 'رقم الموقع',
    anschrift: 'العنوان',
    gebaeudetyp: 'نوع المبنى',
    etagen: 'الطوابق',
    zutritt: 'الدخول',
    ansprechpartner: 'جهة الاتصال في الموقع',
    telefon: 'هاتف',
    mobil: 'جوال',
    aktuellEingeteilt: 'مكلّف حالياً',
    nichtMehrEingeteilt: 'لست مكلّفاً بهذا الموقع في الوقت الحالي.',
    zutrittNurWaehrendEinteilung:
      'تظهر لك بيانات الدخول وجهة الاتصال ما دمت مكلّفاً بهذا الموقع.',
    keinZutrittHinterlegt: 'لا توجد إرشادات دخول مسجّلة لهذا الموقع.',
    letzteSchicht: 'آخر مناوبة',
    meineSchichtenHier: 'مناوباتي هنا',
  },
  tr: {
    heute: 'Bugün',
    schichten: 'Vardiyalar',
    zeiten: 'Saatlerim',
    stundenkonto: 'Saat hesabı',
    urlaub: 'İzin',
    antraege: 'Talepler',
    nachweise: 'Belgeler',
    monatsnachweis: 'Aylık saat belgesi',
    abwesenheit: 'Devamsızlık',
    weiteres: 'Diğer',
    laufendeSchicht: 'Devam eden vardiya',
    naechsteSchicht: 'Sonraki vardiya',
    keineSchicht: 'Şu anda size atanmış bir vardiya yok.',
    gesellschaft: 'Şirket',
    objekt: 'Nesne',
    beginn: 'Başlangıç',
    ende: 'Bitiş',
    dauer: 'Süre',
    pause: 'Mola',
    status: 'Durum',
    datum: 'Tarih',
    stundenHeute: 'Bugünkü saatler',
    stundenWoche: 'Bu haftaki saatler',
    stundenMonat: 'Bu ayki saatler',
    kombiniert: 'Toplam',
    jeBeschaeftigung: 'Her iş ilişkisi için',
    soll: 'Hedef',
    ist: 'Gerçekleşen',
    saldo: 'Bakiye',
    vortrag: 'Devir',
    monat: 'Ay',
    gesperrt: 'Kapatıldı',
    offen: 'Açık',
    vorlaeufig: 'Geçici',
    nichtHinterlegt: 'kayıtlı değil',
    nichtHinterlegtErklaerung:
      'Bu iş ilişkisi için hedef saatler kayıtlı değil. Burada bilerek bir sayı '
      + 'gösterilmiyor: tahmini bir hedef doğru görünür ve bakiyenizi kaydırır.',
    anspruch: 'Hak ediş',
    genommen: 'Kullanılan',
    verplant: 'Planlanan',
    rest: 'Kalan',
    tage: 'gün',
    keinBearbeiten:
      'Zaman kayıtları burada değiştirilemez. Bir yanlışlık varsa itiraz bildirin — '
      + 'kararı planlama birimi verir.',
    einwandMelden: 'İtiraz bildir',
    einwandArt: 'İtiraz türü',
    einwandBegruendung: 'Ne yanlış?',
    serverZeit: 'Sunucu saati',
    geraeteZeit: 'Cihaz saati',
    abweichung: 'Sapma',
    meineMeldungen: 'İtirazlarım',
    antragNeu: 'Yeni talep',
    antragArt: 'Talep türü',
    von: 'Başlangıç',
    bis: 'Bitiş',
    nachricht: 'Mesaj',
    zurueckziehen: 'Geri çek',
    abwesenheitMelden: 'Devamsızlık bildir',
    abwesenheitArt: 'Devamsızlık türü',
    absenden: 'Gönder',
    gueltigBis: 'Geçerlilik',
    unbefristet: 'süresiz',
    abgelaufen: 'Süresi doldu',
    laeuftAb: 'Süresi doluyor',
    sperrtEinteilung: 'Bu belge olmadan kimse sizi vardiyaya yazamaz.',
    registerBewacher: 'Güvenlik sicili',
    nichtVerbunden: 'bağlı değil',
    keineEintraege: 'Kayıt yok.',
    pflichtfeld: 'Zorunlu alan',
    sprache: 'Dil',
    drucken: 'Yazdır',
    summe: 'Toplam',
    dienstanweisungen: 'Hizmet talimatları',
    dienstanweisungLesen: 'Talimatı oku',
    bestaetigen: 'Okudum ve anladım',
    bestaetigtAm: 'Onaylandığı tarih',
    nichtBestaetigt: 'Henüz onaylanmadı',
    neueFassung: 'Yeni sürüm — lütfen yeniden onaylayın',
    fassung: 'Sürüm',
    giltAb: 'Geçerlilik başlangıcı',
    pruefsumme: 'Sürüm sağlama değeri',
    nurAufDeutsch: 'Bu metin yalnızca Almanca olarak mevcuttur.',
    vorNaechsterSchicht: 'Bir sonraki vardiyanızdan önce',
    nachrichten: 'Mesajlar',
    keineNachrichten: 'Mesaj yok. Bu, bekleyen bir şey olmadığı anlamına gelir - eksik bir şey olduğu değil.',
    ungelesen: 'okunmamış',
    gelesen: 'okunmuş',
    oeffnen: 'Aç',
    systemmeldung: 'Sistem bildirimi',
    nachrichtenFaden: 'Mesaj',
    verlauf: 'Geçmiş',
    absender: 'Gönderen',
    ichSelbst: 'Ben',
    unbekannterAbsender: 'Bilinmiyor',
    antworten: 'Yanıtla',
    ihreAntwort: 'Yanıtınız',
    alsGelesenMarkieren: 'Okundu olarak işaretle',
    fadenGeschlossen:
      'Bu konu kapatıldı. Okunabilir kalır, yeni bir yanıt almaz.',
    antwortNurImPortal:
      'Yanıtınız portalda kalır. E-posta veya SMS ile gönderilmez.',
    gespeichert: 'Kaydedildi.',
    antwortImVorgang: 'Yanıtınız konunun içinde.',
    schonGelesen: 'Sizin için bu konu zaten okunmuştu.',
    neuerFadenOffen:
      'Kendiniz mesaj başlatmak henüz açık değil — kime yazabileceğiniz açık bir soru (O-830). Bir konuya yanıt vermek çalışıyor.',
    anlagen: 'Ekler',
    anlagenNichtAbrufbar:
      'Dosyaları eskisi gibi alırsınız; eklerin portalda açılıp açılamayacağı henüz kararlaştırılmadı (O-831).',
    profil: 'Profil',
    bereichWechseln: 'Alan değiştir',
    konto: 'Hesap',
    website: 'Web sitesi',
    abmelden: 'Çıkış yap',
    sitzung: 'Oturum',
    pfad: 'Yol',
     zurueck: 'Geri',
    empfangenAm: 'Alındığı tarih',
    zumDatensatz: 'Kayda git',
    eingereichtAm: 'Verildiği tarih',
    entschiedenAm: 'Karar tarihi',
    entscheidung: 'Karar',
    zurueckgezogen: 'Geri çekildi',
    zurueckziehenHinweis:
      'Kimse karar vermediği sürece geri çekebilirsiniz. Talep okunabilir kalır.',
    wachbuch: 'Güvenlik defteri',
    wachbuchNeu: 'Kayıt yaz',
    uebergabe: 'Devir teslim',
    uebergabeNichtEingestellt:
      'Devir teslim penceresi henüz ayarlanmadı (açık soru O-151). O zamana kadar burada '
      + 'yalnızca kendi kayıtlarınız görünür.',
    uebergabeAus:
      'Devir teslim penceresi ayarlı ve sıfırda — önceki vardiyanın kayıtları gizli kalır. '
      + 'Burada yalnızca kendi kayıtlarınız görünür.',
    art: 'Tür',
    betreff: 'Konu',
    eintragstext: 'Ne oldu?',
    kontrollpunkt: 'Kontrol noktası',
    praesenz: 'Mevcudiyet onaylandı',
    polizei: 'Polis bilgilendirildi',
    nummer: 'Numara',
    erfasstAm: 'Kaydedildiği tarih',
    unveraenderlich: 'Bir kayıt kalır. Yanlış olan yanında düzeltilir, silinmez.',
    leistungsnachweis: 'Hizmet tutanağı',
    leistungszeitraum: 'Hizmet dönemi',
    positionen: 'Kalemler',
    menge: 'Miktar',
    einheit: 'Birim',
    entwurfAnlegen: 'Tutanak oluştur',
    vorlegen: 'Sun',
    unterschrift: 'İmza',
    unterzeichnerName: 'İmzalayanın adı',
    unterschreiben: 'İmzala',
    unterschrieben: 'İmzalandı',
    fotos: 'Fotoğraflar',
    aufnahmeHinzufuegen: 'Fotoğraf ekle',
    beschreibung: 'Açıklama',
    keineAufnahmen: 'Bu vardiya için henüz fotoğraf kaydedilmedi.',
    ohneOrtsdaten: 'Konum verileri kaydetmeden önce kaldırılır.',
    bautagebuch: 'Şantiye günlüğü',
    mannstunden: 'Adam-saat',
    gewerk: 'Meslek dalı',
    anzahlPersonen: 'Kişi sayısı',
    geraet: 'Ekipman',
    lieferung: 'Teslimat',
    vorkommnis: 'Olay',
    bezeichnung: 'Tanım',
    hinzufuegen: 'Ekle',
    tagGeschlossen: 'Bu şantiye günü kapatıldı — artık hiçbir şey eklenmez.',
    abgleich: 'Zaman kaydıyla karşılaştırma',
    abgleichDeckungsgleich: 'Kendi saatleriniz bu günün zaman kaydıyla örtüşüyor.',
    abgleichAbweichung: 'Şantiye günlüğü ile zaman kaydı birbirinden farklı.',
    abgleichOhneAngabe: 'Bu gün için ne adam-saat ne de süre kaydedilmiş.',
    abgleichZeitNichtLesbar:
      'Bu hesap zaman kaydıyla karşılaştırma yapamıyor — bu nedenle bir bulgu gösterilmiyor.',
    wetterQuelle: 'Hava durumu kaynağı',
    schichtBeendet:
      'Bu vardiya sona erdi. Burada artık kayıt yapılmaz; eksik kalanı operasyon '
      + 'yönetimi sonradan bildirir.',
    schichtEntfernt:
      'Bu görevlendirme plandan çıkarıldı. Okunabilir kalır, ancak buna artık hiçbir '
      + 'şey kaydedilemez.',
    nummerOffen:
      'Bu belgenin henüz bir numarası yok — bu şirkette bunun için bir numara aralığı '
      + 'tanımlı değil.',
    offeneFrage: 'açık',

    dokumente: 'Belgeler',
    keineDokumente: 'Şu anda size açılmış bir belge yok.',
    kategorie: 'Kategori',
    alleKategorien: 'Tümü',
    dateiOeffnen: 'Dosyayı aç',
    signaturHinweis:
      'Dosya korumalı bir depoda durur. Bağlantı her açışta yeniden düzenlenir ve '
      + 'ardından geçersiz olur.',
    gueltigMinuten: 'dakika geçerli',
    groesse: 'Boyut',
    abgelegtAm: 'Kayıt tarihi',
    dokumenteOffenerBezug:
      'Burada gördüğünüz, şirketinizin çalışanlara açtığı belgelerdir. Yalnızca sizi '
      + 'ilgilendiren evraklar henüz eşleştirilmedi — açık (O-850).',
    abrufProtokolliert: 'Her dosya çağrısı hesabınıza kaydedilir.',
    listeGekuerzt:
      'Yalnızca en yeni kayıtlar gösterilir. Listeyi kategoriye göre daraltın.',

    objekte: 'Nesnelerim',
    keineObjekte: 'Hiçbir nesnede görevlendirilmiş değilsiniz.',
    objektnummer: 'Nesne numarası',
    anschrift: 'Adres',
    gebaeudetyp: 'Bina türü',
    etagen: 'Kat sayısı',
    zutritt: 'Giriş',
    ansprechpartner: 'Yerindeki yetkili',
    telefon: 'Telefon',
    mobil: 'Cep',
    aktuellEingeteilt: 'Şu anda görevli',
    nichtMehrEingeteilt: 'Şu anda burada görevli değilsiniz.',
    zutrittNurWaehrendEinteilung:
      'Giriş bilgilerini ve yerindeki yetkiliyi, bu nesnede görevli olduğunuz sürece '
      + 'görürsünüz.',
    keinZutrittHinterlegt: 'Bu nesne için kayıtlı bir giriş açıklaması yok.',
    letzteSchicht: 'Son vardiya',
    meineSchichtenHier: 'Buradaki vardiyalarım',
  },
};

export function meinTexte(sprache: PortalSprache): MeinTexte {
  return MEIN_TEXTE[sprache];
}

/**
 * Die Beschriftungen der Portalhuelle in der Sprache der Person (D-419).
 *
 * Die Schluessel sind die der `mitarbeiter`-Leiste in `registry/tableiste.ts`
 * (`stunden` zeigt auf das Stundenkonto und heisst deshalb so) und die
 * `sitzung.*`/`pfad.*`-Schluessel der Kopfzeile in `PortalRahmen`. An EINER
 * Stelle, weil drei Huellen sie brauchen — die Arbeiterseiten, das Konto und
 * die noch nicht gebauten Ziele der Leiste — und eine Karte, die je Huelle
 * abgeschrieben wird, in einer davon einen Schluessel vergisst.
 */
export function meinBeschriftungen(t: MeinTexte): Readonly<Record<string, string>> {
  return {
    heute: t.heute,
    schichten: t.schichten,
    stunden: t.stundenkonto,
    nachrichten: t.nachrichten,
    profil: t.profil,
    'sitzung.label': t.sitzung,
    'sitzung.bereich': t.bereichWechseln,
    'sitzung.konto': t.konto,
    'sitzung.website': t.website,
    'sitzung.abmelden': t.abmelden,
    'pfad.label': t.pfad,
  };
}

/**
 * Die fuenf Arten eines Zeit-Einwands (EMP-07, `einwand_art`).
 *
 * Sie stehen als eigener Datensatz und nicht in `MeinTexte`, weil ihre
 * Schluessel ein DATENBANK-Vokabular sind: `zeit_einwand.art` ist ein Enum mit
 * genau diesen fuenf Werten. Uebersetzt wird das Label, nie der Wert — der
 * reist in die Datenbank (D-83).
 */
export type EinwandArtSchluessel =
  'eintrag_fehlt' | 'zeit_falsch' | 'pause_falsch' | 'zuordnung_falsch' | 'sonstiges';

export const EINWAND_ARTEN: readonly EinwandArtSchluessel[] = [
  'eintrag_fehlt', 'zeit_falsch', 'pause_falsch', 'zuordnung_falsch', 'sonstiges',
];

export const EINWAND_ART_TEXTE:
Readonly<Record<PortalSprache, Readonly<Record<EinwandArtSchluessel, string>>>> = {
  de: {
    eintrag_fehlt: 'Eintrag fehlt ganz',
    zeit_falsch: 'Beginn oder Ende ist falsch',
    pause_falsch: 'Die Pause ist falsch',
    zuordnung_falsch: 'Falsches Objekt oder falsche Schicht',
    sonstiges: 'Etwas anderes',
  },
  en: {
    eintrag_fehlt: 'The entry is missing entirely',
    zeit_falsch: 'Start or end is wrong',
    pause_falsch: 'The break is wrong',
    zuordnung_falsch: 'Wrong site or wrong shift',
    sonstiges: 'Something else',
  },
  ar: {
    eintrag_fehlt: 'السجل مفقود تماماً',
    zeit_falsch: 'وقت البداية أو النهاية غير صحيح',
    pause_falsch: 'مدة الاستراحة غير صحيحة',
    zuordnung_falsch: 'الموقع أو المناوبة غير صحيحة',
    sonstiges: 'شيء آخر',
  },
  tr: {
    eintrag_fehlt: 'Kayıt tamamen eksik',
    zeit_falsch: 'Başlangıç veya bitiş yanlış',
    pause_falsch: 'Mola süresi yanlış',
    zuordnung_falsch: 'Yanlış nesne veya yanlış vardiya',
    sonstiges: 'Başka bir şey',
  },
};

/**
 * Die Arten eines Wachbucheintrags (SEC-05, `wachbuch_art`).
 *
 * Wie bei den Einwandarten: die SCHLUESSEL sind das Vokabular des Enums und
 * reisen unuebersetzt in die Datenbank; uebersetzt wird nur, was auf dem
 * Bildschirm steht (D-83). Die deutschen Bezeichnungen sind zeichengleich mit
 * `ART_TEXT` in `server/services/security/wachbuch.ts` — sie stehen dort fuer
 * das interne Portal und hier fuer die vier Sprachen der Wache.
 *
 * `schluessel` steht mit dabei, obwohl der Dienst die Art heute abweist: das
 * Wort gehoert zum Enum, und ein Buch, in dem eine Art keinen Namen hat, waere
 * beim Lesen alter Eintraege leer an genau dieser Stelle.
 */
export type WachbuchArtSchluessel =
  'rundgang' | 'vorkommnis' | 'uebergabe' | 'schluessel' | 'alarm';

export const WACHBUCH_ARTEN_I18N: readonly WachbuchArtSchluessel[] = [
  'rundgang', 'vorkommnis', 'uebergabe', 'schluessel', 'alarm',
];

export const WACHBUCH_ART_TEXTE:
Readonly<Record<PortalSprache, Readonly<Record<WachbuchArtSchluessel, string>>>> = {
  de: {
    rundgang: 'Rundgang',
    vorkommnis: 'Vorkommnis',
    uebergabe: 'Übergabe',
    schluessel: 'Schlüssel',
    alarm: 'Alarm',
  },
  en: {
    rundgang: 'Patrol',
    vorkommnis: 'Incident',
    uebergabe: 'Handover',
    schluessel: 'Key',
    alarm: 'Alarm',
  },
  ar: {
    rundgang: 'جولة تفتيش',
    vorkommnis: 'حادثة',
    uebergabe: 'تسليم',
    schluessel: 'مفتاح',
    alarm: 'إنذار',
  },
  tr: {
    rundgang: 'Devriye',
    vorkommnis: 'Olay',
    uebergabe: 'Devir teslim',
    schluessel: 'Anahtar',
    alarm: 'Alarm',
  },
};

/**
 * Der Zustand eines Bautags und die Herkunft seiner Wetterangabe — in vier
 * Sprachen (BAU-07, BAU-08, SPEC §10, EMP-12).
 *
 * **Warum sie hierher umgezogen sind.** Beide Karten standen als deutsche
 * Literale in `app/portal/[mandant]/bau/bautagebuch-anzeige.ts`, also in der
 * Anzeigehilfe des INTERNEN Portals. Die Bautagebuchseite des
 * Mitarbeiterportals las sie von dort — und schrieb damit „Gegengezeichnet
 * (Auftraggeber)" und „keine Quelle" auch auf einen Bildschirm, der gerade auf
 * Arabisch oder Tuerkisch steht. Die Sprachwache sah das nicht, weil sie nur
 * `MEIN_TEXTE` prueft.
 *
 * Dieselbe Bauart wie `WACHBUCH_ART_TEXTE`: die SCHLUESSEL sind das Vokabular
 * der Datenbank (`bautagebuch_status`, `wetter_quelle`) und reisen
 * unuebersetzt; uebersetzt wird nur, was auf dem Bildschirm steht (D-83). Das
 * interne Portal nimmt die `de`-Spalte und liest damit wortgleich wie zuvor.
 *
 * `keine` bekommt den WOERTLICHEN Satz aus BAU-08 und keine Null: „0 °C" und
 * „keine Angabe" sind zwei verschiedene Aussagen, und die erste ist im
 * Bauprozess eine Falschangabe.
 */
export type BautagStatusSchluessel = 'entwurf' | 'abgeschlossen' | 'gegengezeichnet';

export const BAUTAG_STATUS_TEXTE:
Readonly<Record<PortalSprache, Readonly<Record<BautagStatusSchluessel, string>>>> = {
  de: {
    entwurf: 'Entwurf',
    abgeschlossen: 'Abgeschlossen',
    gegengezeichnet: 'Gegengezeichnet (Auftraggeber)',
  },
  en: {
    entwurf: 'Draft',
    abgeschlossen: 'Closed',
    gegengezeichnet: 'Countersigned (client)',
  },
  ar: {
    entwurf: 'مسودة',
    abgeschlossen: 'مُغلق',
    gegengezeichnet: 'موقَّع من صاحب العمل',
  },
  tr: {
    entwurf: 'Taslak',
    abgeschlossen: 'Kapatıldı',
    gegengezeichnet: 'İşveren tarafından imzalandı',
  },
};

export type WetterQuelleSchluessel = 'dwd' | 'manuell' | 'keine';

export const WETTER_QUELLE_TEXTE:
Readonly<Record<PortalSprache, Readonly<Record<WetterQuelleSchluessel, string>>>> = {
  de: {
    dwd: 'DWD Open Data',
    manuell: 'manuell erfasst',
    keine: 'keine Quelle',
  },
  en: {
    dwd: 'DWD Open Data',
    manuell: 'entered manually',
    keine: 'no source',
  },
  ar: {
    dwd: 'DWD Open Data',
    manuell: 'أُدخل يدوياً',
    keine: 'لا يوجد مصدر',
  },
  tr: {
    dwd: 'DWD Open Data',
    manuell: 'elle girildi',
    keine: 'kaynak yok',
  },
};

/**
 * Die neun Dokumentkategorien (DOC-01, `dokument_kategorie`) — in vier
 * Sprachen.
 *
 * Dieselbe Bauart wie `WACHBUCH_ART_TEXTE`: die SCHLUESSEL sind das Vokabular
 * des Enums und reisen unuebersetzt in die Datenbank; uebersetzt wird nur, was
 * auf dem Bildschirm steht (D-83).
 *
 * **Warum die Kategorie im Mitarbeiterportal ueberhaupt gross danebensteht.**
 * Solange O-851 offen ist — welche Kategorien duerfen einer Belegschaft
 * ueberhaupt freigegeben werden —, prueft die Datenbank nur die Freigabe, nicht
 * die Kategorie. Die sichtbare Kategorie ist damit die Stelle, an der eine
 * falsche Freigabe auffaellt: „Rechnung" auf einem Arbeiterbildschirm ist ein
 * Befund, kein Etikett.
 *
 * `mitarbeiter` heisst hier **Personalunterlage** und nicht „Mitarbeiter": die
 * Kategorie bezeichnet die UNTERLAGE, nicht den Menschen, und „Mitarbeiter"
 * als Ueberschrift ueber einem Dokument liest sich wie eine Personalakte, die
 * offen liegt.
 */
export const DOKUMENT_KATEGORIE_TEXTE:
Readonly<Record<PortalSprache, Readonly<Record<string, string>>>> = {
  de: {
    kunde: 'Kundenunterlage',
    vertrag: 'Vertrag',
    angebot: 'Angebot',
    rechnung: 'Rechnung',
    beleg: 'Beleg',
    mitarbeiter: 'Personalunterlage',
    projekt: 'Projektunterlage',
    buchhaltung: 'Buchhaltung',
    unternehmen: 'Unternehmensunterlage',
  },
  en: {
    kunde: 'Customer file',
    vertrag: 'Contract',
    angebot: 'Quotation',
    rechnung: 'Invoice',
    beleg: 'Receipt',
    mitarbeiter: 'Personnel file',
    projekt: 'Project file',
    buchhaltung: 'Accounting',
    unternehmen: 'Company file',
  },
  ar: {
    kunde: 'ملف العميل',
    vertrag: 'عقد',
    angebot: 'عرض سعر',
    rechnung: 'فاتورة',
    beleg: 'إيصال',
    mitarbeiter: 'ملف شؤون الموظفين',
    projekt: 'ملف المشروع',
    buchhaltung: 'المحاسبة',
    unternehmen: 'ملف الشركة',
  },
  tr: {
    kunde: 'Müşteri evrakı',
    vertrag: 'Sözleşme',
    angebot: 'Teklif',
    rechnung: 'Fatura',
    beleg: 'Belge',
    mitarbeiter: 'Personel evrakı',
    projekt: 'Proje evrakı',
    buchhaltung: 'Muhasebe',
    unternehmen: 'Şirket evrakı',
  },
};

/**
 * Das Label einer Kategorie — oder der SCHLUESSEL selbst.
 *
 * Kein Rueckfall auf „Sonstiges": eine unbekannte Kategorie ist eine, die das
 * Enum erweitert hat, und dann soll auf dem Bildschirm ihr Name stehen und
 * nicht ein Sammelbegriff, der sie verschwinden laesst.
 */
export function dokumentKategorieText(
  sprache: PortalSprache, kategorie: string,
): string {
  return DOKUMENT_KATEGORIE_TEXTE[sprache][kategorie] ?? kategorie;
}
