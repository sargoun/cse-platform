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
}

export const SHELL_TEXTE: Readonly<Record<Sprache, ShellTexte>> = {
  de: {
    hauptnavigation: 'Hauptnavigation',
    bereicheNav: 'Unsere Bereiche',
    rechtlichesNav: 'Rechtliches',
    sprachwahl: 'Sprache',
    zurStartseite: 'Zur Startseite',
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
  },
  en: {
    hauptnavigation: 'Main navigation',
    bereicheNav: 'Our divisions',
    rechtlichesNav: 'Legal',
    sprachwahl: 'Language',
    zurStartseite: 'To the home page',
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
  },
};

export function meinTexte(sprache: PortalSprache): MeinTexte {
  return MEIN_TEXTE[sprache];
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
