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
import { eigenerEintrag } from '../nachschlagen.js';

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
  /**
   * Die drei Seiten der GRUPPE, die nicht in die Kopfzeile passen (V-155,
   * D-649): „Über uns", „Aktuelles" und „Karriere". Sie waren gebaut, befüllt
   * und in der Sitemap — und von keiner Seite aus verlinkt. DESIGN §5 hält
   * die Kopfzeile bei vier Punkten; ihr Ort ist der Fuss und das Menü.
   */
  readonly gruppeNav: string;
  readonly gruppe: Readonly<Record<'ueberUns' | 'news' | 'karriere', string>>;
  /**
   * Der Hinweis an einem Verweis, der in eine ANDERE Sprache führt — heute
   * nur `/karriere` von einer englischen Seite aus (`verweisIn`, NUR_DEUTSCH).
   * Leer, wo er nie gebraucht wird: von einer deutschen Seite führt jeder
   * Verweis auf Deutsch.
   */
  readonly aufDeutsch: string;
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
    gruppeNav: 'Die Gruppe',
    gruppe: {
      ueberUns: 'Über uns',
      news: 'Aktuelles',
      karriere: 'Karriere',
    },
    aufDeutsch: '',
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
    gruppeNav: 'The group',
    gruppe: {
      ueberUns: 'About us',
      news: 'News',
      karriere: 'Careers',
    },
    aufDeutsch: '(in German)',
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
  /**
   * Der Verweis auf das Meldeformular (V-156). Es gibt `/barrierefreiheit/feedback`
   * seit D-600, und die Erklärung nannte unter „Barriere melden" nur eine
   * E-Mail-Adresse — der Pflichtweg war von keiner Seite aus verlinkt.
   */
  readonly meldenFormular: string;
  readonly meldenFormularHinweis: string;
  /** Die Zeile vor E-Mail und Telefon: der zweite Weg, nicht der einzige. */
  readonly meldenAndererWeg: string;
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
    meldenFormular: 'Zum Meldeformular',
    meldenFormularHinweis:
      'Ohne Anmeldung und ohne JavaScript. Eine E-Mail-Adresse ist freiwillig — nur, '
      + 'wenn Sie eine Antwort möchten.',
    meldenAndererWeg: 'Oder direkt:',
    keinMeldeweg:
      'Eine E-Mail-Adresse für Meldungen ist derzeit nicht hinterlegt — das Formular '
      + 'nimmt Ihre Meldung trotzdem an.',
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
    meldenFormular: 'To the reporting form',
    meldenFormularHinweis:
      'No sign-in and no JavaScript needed. An e-mail address is optional — only if you '
      + 'would like a reply.',
    meldenAndererWeg: 'Or directly:',
    keinMeldeweg:
      'No e-mail address for reports is on file at the moment — the form still accepts '
      + 'your report.',
    telefon: 'Phone',
    metaBeschreibung: 'Accessibility statement for this website.',
  },
};

/**
 * Die Meldungen der zwei öffentlichen Pflichtformulare — englisch (V-156).
 *
 * **Der Befund.** Mit den englischen Routen (`/en/datenschutz/anfrage`,
 * `/en/barrierefreiheit/feedback`) kam ein zweiter Fehler ans Licht: die
 * Dienste (`services/datenschutz/{anfrage,barriere}.ts`) sprechen deutsch, und
 * die Routen reichten `fehler.message` unverändert zurück. Eine englische
 * Seite hätte „Bitte prüfen Sie die E-Mail-Adresse" als `role="alert"`
 * gezeigt — genau dem Menschen, der die englische Fassung geöffnet hat, weil
 * er kein Deutsch liest.
 *
 * **Übersetzt wird über den GRUND, nicht über den Satz.** Die Dienste tragen
 * je Fehler einen festen Schlüssel (`grund`); ein Abgleich auf den deutschen
 * Wortlaut bräche beim ersten Komma, das jemand ändert. Ein unbekannter Grund
 * bekommt einen allgemeinen englischen Satz — nie den deutschen.
 */
const PFLICHTWEG_FEHLER_EN: Readonly<Record<'anfrage' | 'barriere',
  Readonly<Record<string, string>>>> = {
  anfrage: {
    name_fehlt: 'Please give your name.',
    email_ungueltig: 'Please check the e-mail address — our reply goes to it.',
    art_fehlt: 'Please choose what you would like us to do.',
    nicht_gespeichert: 'Your request could not be saved. Please try again.',
    sonst: 'Your request could not be accepted. Please check your entries.',
  },
  barriere: {
    ohne_beschreibung: 'Please describe briefly what did not work.',
    email_ungueltig: 'Please check the e-mail address — or leave the field empty.',
    nicht_gespeichert: 'Your report could not be saved. Please try again.',
    sonst: 'Your report could not be accepted. Please check your entries.',
  },
};

/**
 * Der Satz für die Seite eines Pflichtformulars — deutsch aus dem Dienst,
 * englisch aus der Tabelle oben.
 */
export function pflichtwegMeldung(
  weg: 'anfrage' | 'barriere', sprache: Sprache, grund: string, deutsch: string,
): string {
  if (sprache === 'de') return deutsch;
  const tabelle = PFLICHTWEG_FEHLER_EN[weg];
  // Nur ein EIGENER Schlüssel (V-159): `tabelle['toString']` wäre eine Funktion.
  return eigenerEintrag(tabelle, grund) ?? tabelle['sonst'] ?? '';
}

/**
 * Die zwei Pflichtwege unter der Datenschutzerklärung (V-156, D-650, LEG-09).
 *
 * **Der Befund.** `/datenschutz/anfrage` (Auskunft, Berichtigung, Löschung —
 * mit laufender Monatsfrist in einem internen Eingang) war von genau EINER
 * Seite aus verlinkt: vom Werbewiderspruch. Die Datenschutzerklärung zählte
 * die Rechte auf und schickte den Leser an „die oben angegebene
 * Kontaktadresse". Art. 12 Abs. 2 DSGVO verlangt, die Ausübung zu
 * ERLEICHTERN; ein Formular, das es gibt und das niemand findet, erleichtert
 * nichts.
 *
 * Der Erklärungstext selbst ist redaktioneller Inhalt (`seite`/`abschnitt`)
 * und bleibt, wie er ist — die Wege hängen darunter, aus dem Code, wie die
 * Pflichtangaben unter dem Impressum (dieselbe Bauart, `OeffentlicheSeite`).
 */
export interface BetroffenenwegeTexte {
  readonly ueberschrift: string;
  readonly text: string;
  readonly anfrage: string;
  readonly anfrageHinweis: string;
  readonly werbewiderspruch: string;
  readonly werbewiderspruchHinweis: string;
  /** Der Hinweis an einem Verweis, der auf eine NUR deutsche Seite führt. */
  readonly aufDeutsch: string;
}

export const BETROFFENENWEGE_TEXTE: Readonly<Record<Sprache, BetroffenenwegeTexte>> = {
  de: {
    ueberschrift: 'Ihre Rechte ausüben',
    text:
      'Zwei Formulare, ohne Anmeldung und ohne JavaScript. Was Sie dort absenden, landet '
      + 'mit Datum im Eingang der Gesellschaft, die Sie wählen — und wird dort bearbeitet.',
    anfrage: 'Auskunft, Berichtigung, Löschung beantragen',
    anfrageHinweis: 'Art. 15 bis 21 DSGVO — wir antworten innerhalb eines Monats.',
    werbewiderspruch: 'Werbung widersprechen',
    werbewiderspruchHinweis: 'Ohne Angabe von Gründen, ein Knopf genügt.',
    aufDeutsch: '',
  },
  en: {
    ueberschrift: 'Exercising your rights',
    text:
      'Two forms, no sign-in and no JavaScript needed. What you send there reaches the '
      + 'inbox of the company you choose, with a date — and is handled there.',
    anfrage: 'Request access, rectification or erasure',
    anfrageHinweis: 'Art. 15 to 21 GDPR — we reply within one month.',
    werbewiderspruch: 'Object to advertising',
    werbewiderspruchHinweis: 'No reason needed, one button is enough.',
    aufDeutsch: '(in German)',
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
  /**
   * Die drei Sammelsätze über dem Formular (V-157).
   *
   * Sie kamen bisher als `fehler.message` aus `lead/annahme.ts` — deutsch, auch
   * auf `/en/angebot/<bereich>`: dort stand über englischen Feldmeldungen
   * „Bitte prüfen Sie die markierten Felder." im `role="alert"`, und nach dem
   * Ratenlimit „Zu viele Anfragen von dieser Verbindung…". Die Feldmeldungen
   * wurden seit D-83 übersetzt, der Satz darüber nicht.
   */
  readonly pruefen: string;
  readonly datenschutzBestaetigen: string;
  readonly zuVieleAnfragen: string;
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
    pruefen: 'Bitte prüfen Sie die markierten Felder.',
    datenschutzBestaetigen:
      'Bitte bestätigen Sie, dass Sie die Datenschutzhinweise gelesen haben.',
    zuVieleAnfragen:
      'Zu viele Anfragen von dieser Verbindung. Bitte versuchen Sie es später erneut.',
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
    pruefen: 'Please check the highlighted fields.',
    datenschutzBestaetigen: 'Please confirm that you have read the privacy notice.',
    zuVieleAnfragen:
      'Too many enquiries from this connection. Please try again later.',
  },
};

/**
 * Der Sammelsatz über einem abgewiesenen Anfrageformular (V-157, V-160).
 *
 * **Über die URSACHE und nicht über `fehler.message`** — und seit V-160 auch
 * nicht mehr über die Felder. Die erste Fassung las die Ursache aus den
 * FELDERN (`datenschutz_hinweis` darunter → „bestätigen"). Die Prüfung gegen
 * die Formularversion meldet die Pflicht-Checkbox aber zusammen mit allen
 * anderen Feldern; bei drei leeren Feldern und fehlendem Häkchen stand dann
 * auf Deutsch „Bitte prüfen Sie die markierten Felder." und auf Englisch
 * „Please confirm that you have read the privacy notice". Jetzt trägt der
 * Fehler seinen Grund (`FormularFehler.grund`), gesetzt an derselben Stelle
 * wie der deutsche Satz — beide Sprachen sagen dasselbe.
 *
 * Auf Deutsch bleibt es beim Satz des Dienstes: er IST der Satz zu diesem
 * Grund. Ein Grund ohne eigenen Satz bekommt den allgemeinen, nie den
 * Sammelsatz einer anderen Ursache.
 */
export function formularSammelmeldung(
  sprache: Sprache,
  fehler: {
    readonly message: string;
    readonly felder: Readonly<Record<string, string>>;
    readonly grund?: string;
  },
): string {
  if (sprache === 'de') return fehler.message;
  const t = API_TEXTE[sprache];
  switch (fehler.grund ?? 'pruefen') {
    case 'pruefen': return t.pruefen;
    case 'datenschutz': return t.datenschutzBestaetigen;
    case 'zu_viele': return t.zuVieleAnfragen;
    default: return t.nichtGespeichert;
  }
}

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
  /** Die Rolle in der Schicht — `dienstplan_zuordnung.funktion`. */
  readonly funktion: string;
  readonly monatsnachweis: string;
  /**
   * Das Blatt nach § 17 MiLoG.
   *
   * **Die Paragraphen bleiben unuebersetzt.** `§ 17 MiLoG` ist eine Fundstelle
   * und kein Wort; sie in „Section 17 Minimum Wage Act" zu verwandeln, machte
   * sie unauffindbar. Was uebersetzt wird, sind die Spalten und die Saetze,
   * die erklaeren, was in ihnen steht.
   */
  readonly nachweisBlatt: Readonly<Record<
    'titel' | 'abgeschlossen' | 'vorlaeufig' | 'gesperrt' | 'zeitenDesMonats'
    | 'tag' | 'beginn' | 'ende' | 'pause' | 'anteilBrutto' | 'anteilNetto'
    | 'summe' | 'erklaerung' | 'stundenkonto' | 'keinKonto' | 'abweichend'
    | 'pruefsumme' | 'fussnote', string>>;
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
  /**
   * Die drei Woerter des Monatswechslers (V-053).
   *
   * **Warum sie hier stehen und nicht als Pfeile auskommen.** Ein blosses
   * `←` und `→` ueber einer Tabelle sagt nicht, was sich aendert — und auf
   * Arabisch laeuft die Schrift von rechts nach links, sodass derselbe Pfeil
   * das Gegenteil bedeutet. Die Beschriftung nennt deshalb den Monat, die
   * Pfeile sind `aria-hidden` und die Richtung uebernimmt das Schriftsystem.
   */
  readonly monatVorher: string;
  readonly monatSpaeter: string;
  readonly monatHeute: string;

  /* ── Der Jahreswechsler auf dem Urlaubskonto (V-054) ────────────────── */
  readonly jahr: string;
  readonly jahrVorher: string;
  readonly jahrSpaeter: string;
  readonly jahrHeute: string;
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
  /**
   * Der Hinweis auf einer Zeile, deren Fassung `> 1` ist — sie wurde
   * korrigiert.
   *
   * **Er nennt den Grund NICHT, und das ist Absicht.** `zeiteintrag_korrektur`
   * traegt Art, Grund und Begruendung, und `p_ma_decke` (0036:403) sperrt die
   * Tabelle fuer dieses Portal ausdruecklich. Der Grund kommt auf dem Weg, der
   * dafuer gebaut ist: als Nachricht (`services/zeit/korrektur.ts`). Dieser
   * Satz sagt, DASS korrigiert wurde, und wohin man fuer das Warum sieht.
   */
  /**
   * Die Stempeluhr im Portal (D-618, O-93).
   *
   * **`laeuftSeit` traegt den Zaehler, nicht die Dauer.** Was dort steht, ist
   * Anzeige: der Nullpunkt kommt aus der Serveruhr, und die abgerechnete
   * Dauer entsteht beim Ausstempeln in der Datenbank aus zwei UTC-Instants
   * (Invariante 2 und 5). Deshalb sagt `serverUhrHinweis` es auch laut — wer
   * eine Minute Unterschied zur eigenen Uhr sieht, soll wissen, welche zaehlt.
   */
  readonly stempeluhr: Readonly<Record<
    'titel' | 'beginnen' | 'beenden' | 'laeuftSeit' | 'seit' | 'keineSchichtJetzt'
    | 'serverUhrHinweis' | 'eingecheckt' | 'ausgecheckt' | 'abgelehnt'
    | 'schonOffen', string>>;
  readonly korrigiertHinweis: string;
  readonly korrigiertFassung: string;
  readonly einwandMelden: string;
  readonly einwandArt: string;
  readonly einwandBegruendung: string;
  /**
   * Die Woerter der ENTSCHEIDUNG (V-051, EMP-07).
   *
   * Ohne sie war „Meine Meldungen" eine Liste dessen, was man geschrieben
   * hat — und nie dessen, was daraus wurde.
   */
  readonly einwandEntscheidung: string;
  readonly einwandEntschiedenAm: string;
  readonly einwandOhneBegruendung: string;
  readonly einwandWartet: string;
  readonly einwandEingereichtAm: string;
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
  /**
   * Halbe Tage und die AU-Bescheinigung (V-057, EMP-10, § 5 EFZG).
   *
   * Die Spalten, die Regel (`rechneTage` zieht je halbem Randtag 0,5 ab) und
   * der Lohnexport standen seit `0073`; die Route las alle vier Felder —
   * **und kein Formular schickte sie.** Wer einen halben Tag krank war,
   * meldete einen ganzen, und die Sollzeitgutschrift im Stundenkonto war um
   * einen halben Tag falsch (EMP-04).
   */
  readonly halberTagBeginn: string;
  readonly halberTagEnde: string;
  readonly halberTagHinweis: string;
  readonly auVorliegt: string;
  readonly auBis: string;
  readonly auHinweis: string;
  readonly absenden: string;

  readonly gueltigBis: string;
  readonly unbefristet: string;
  readonly abgelaufen: string;
  readonly laeuftAb: string;
  readonly sperrtEinteilung: string;

  /* ── Mehr Positionszeilen im Leistungsnachweis (V-059) ──────────────── */
  readonly mehrZeilen: string;
  readonly mehrZeilenHinweis: string;

  /* ── Was nach einem gesperrten Nachweis zu tun ist (V-061) ──────────── */
  readonly nachweisWasTun: string;
  readonly nachweisWasTunText: string;
  readonly nachweisKeinUpload: string;
  readonly nachweisZuNachrichten: string;
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
  /**
   * Die eigene Abwesenheit (V-056, EMP-10).
   *
   * `abwesenheitRuecknahmeHinweis` sagt AUSDRÜCKLICH, was die Rücknahme NICHT
   * kann: eine schon entschiedene Abwesenheit bleibt der Personalstelle. Ein
   * Knopf, der still nichts tut, ist schlimmer als keiner.
   *
   * `abwesenheitArtVerdeckt` erklärt, warum die ART hier nicht steht:
   * `abwesenheitsart_id`, `au_*` und `bemerkung` gibt `abwesenheit` der
   * Anwendungsrolle gar nicht zu lesen (0073, Art. 9 DSGVO) — auch nicht für
   * die eigene Zeile. Ohne den Satz sieht die Lücke aus wie ein Fehler.
   */
  readonly abwesenheitBlatt: string;
  readonly abwesenheitRuecknahme: string;
  readonly abwesenheitRuecknahmeHinweis: string;
  readonly abwesenheitNichtRuecknehmbar: string;
  readonly abwesenheitArtVerdeckt: string;
  readonly gemeldetAm: string;
  readonly storniertAm: string;
  readonly halbeTage: string;
  /**
   * Zwei offene Leistungsnachweise auf einer Schicht (V-058, CLN-04).
   *
   * Bis dahin war das eine Sackgasse: die Seite zeigte das Unterschriftsblatt
   * nur bei GENAU EINEM offenen Nachweis — und darunter, bei zweien, das
   * ANLEGEFORMULAR. Jeder Klick ein dritter. Jetzt wählt der Mensch, der die
   * Schicht gearbeitet hat.
   */
  readonly mehrereOffen: string;
  readonly mehrereOffenHinweis: string;
  readonly diesenUnterschreiben: string;

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

  /* ── Nachgetragen: später getippt, nicht später geschehen (V-078) ────── */
  readonly nachgetragen: string;
  readonly nachgetragenHinweis: string;
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

  /* ── Zusagen und Absagen (V-049, D-622) ─────────────────────────────── */
  readonly zusagen: string;
  readonly absagen: string;
  readonly zusageFrage: string;
  readonly absageGrund: string;
  readonly absageGrundHinweis: string;
  readonly zugesagtHinweis: string;
  readonly abgesagtHinweis: string;
  readonly absageEndgueltig: string;
  readonly antwortZugesagt: string;
  readonly antwortAbgesagt: string;
  readonly antwortSchonZugesagt: string;
  readonly antwortSchonAbgesagt: string;
  readonly antwortVorbei: string;
  readonly antwortNichtMoeglich: string;
  readonly antwortGrundFehlt: string;
  readonly antwortUnbekannt: string;

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
  /**
   * Die Korrektur der EIGENEN Mannstundenzeile (V-063) — Storno und Ersatz in
   * EINEM Schritt. Die Zeile verschwindet nicht; sie steht durchgestrichen
   * neben ihrer Richtigstellung (LEG-01).
   */
  readonly korrigieren: string;
  readonly korrekturGrund: string;
  readonly stornierenUndErsetzen: string;
  readonly korrekturHinweis: string;
  /** Das Tagesfoto am Bautag (V-063). */
  readonly tagesfotoHinzufuegen: string;
  readonly tagesfotoHinweis: string;
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

  /* ── Werte aus der Datenbank als WORT, nie als Schlüssel (V-195) ─────── */
  /**
   * Der Zustand der eigenen Einteilung (`dienstplan_zuordnung.status`).
   *
   * Das Schichtblatt zeigte unter „Status" den rohen Wert — `nicht_erschienen`
   * auch auf Arabisch. Das Vokabular selbst ist ein Platzhalter (O-170); die
   * Wörter übersetzen es, sie erfinden keinen Zustand dazu.
   */
  readonly zuordnungStatus: Readonly<Record<ZuordnungStatusSchluessel, string>>;
  /**
   * Die Lage im Bewacherregister (`bewacher_eintrag.status`, SEC-03). Das
   * Vokabular ist ein Platzhalter (O-40); das Deutsche ist wortgleich mit
   * `STATUS_TEXT` der Verwaltung, damit Büro und Kraft dasselbe lesen.
   */
  readonly bewacherStatus: Readonly<Record<BewacherStatusSchluessel, string>>;
  /**
   * Die Beschriftung über der Fundstelle eines Nachweises („§34a Abs. 1a
   * GewO"). Dort stand „Status" — ein Paragraph ist kein Zustand. Die
   * Fundstelle selbst bleibt unübersetzt (siehe `nachweisBlatt`).
   */
  readonly rechtsgrundlage: string;
  /**
   * Der Tag der Zeitumstellung, an dem eine Schicht liegt (Invariante 2).
   * Stand als deutsches Wort in einem Ternär in `SchichtKarte` — in jeder
   * Sprache „23-Stunden-Tag".
   */
  readonly zeitanomalie: Readonly<Record<'dst_luecke' | 'dst_doppelt', string>>;
}

/**
 * Die Werte von `zuordnung_status` (0028). `tests/kern/mein-rohwerte.test.ts`
 * hält die Liste gegen die Migration — ein neuer Wert ohne Wort fällt dort auf
 * und nicht erst auf dem Telefon einer Kraft.
 */
export const ZUORDNUNG_STATUS_SCHLUESSEL =
  ['geplant', 'zugesagt', 'abgesagt', 'ersetzt', 'nicht_erschienen'] as const;
export type ZuordnungStatusSchluessel = (typeof ZUORDNUNG_STATUS_SCHLUESSEL)[number];

/** Die Werte von `bewacher_status` (0031) — geprüft gegen `BEWACHER_STATUS`. */
export const BEWACHER_STATUS_SCHLUESSEL =
  ['beantragt', 'registriert', 'abgelehnt', 'erloschen', 'gesperrt', 'unbekannt'] as const;
export type BewacherStatusSchluessel = (typeof BEWACHER_STATUS_SCHLUESSEL)[number];

export const MEIN_TEXTE: Readonly<Record<PortalSprache, MeinTexte>> = {
  de: {
    heute: 'Heute',
    schichten: 'Schichten',
    zeiten: 'Meine Zeiten',
    stundenkonto: 'Stundenkonto',
    urlaub: 'Urlaub',
    antraege: 'Anträge',
    nachweise: 'Nachweise',
    funktion: 'Funktion',
    monatsnachweis: 'Monatsnachweis',
    nachweisBlatt: {
      titel: 'Stundennachweis § 17 MiLoG',
      abgeschlossen: 'abgeschlossen und unveränderlich',
      vorlaeufig: 'vorläufig — der Monat ist offen',
      gesperrt: 'gesperrt, aber noch nicht geprägt',
      zeitenDesMonats: 'Zeiten des Monats',
      tag: 'Tag', beginn: 'Beginn', ende: 'Ende', pause: 'Pause',
      anteilBrutto: 'Anteil brutto', anteilNetto: 'Anteil netto', summe: 'Summe',
      erklaerung:
        'Beginn und Ende sind die tatsächlichen Zeitpunkte des Eintrags in '
        + 'Europe/Berlin. Eine Schicht über die Monatsgrenze steht in beiden '
        + 'Monatsblättern mit ihren wahren Zeiten; nur der Anteil ist monatsabhängig.',
      stundenkonto: 'Stundenkonto',
      keinKonto: 'kein Konto geführt',
      abweichend:
        'abweichend, weil der Monat noch offen ist und nur freigegebene Zeiten '
        + 'gebucht werden.',
      pruefsumme: 'Prüfsumme:',
      fussnote:
        'Aufzeichnung nach § 17 Abs. 1 MiLoG. Zeitpunkte gespeichert in UTC, '
        + 'dargestellt in Europe/Berlin. Kein Entgelt: diese Aufzeichnung führt '
        + 'Minuten, bewertet wird sie in der Lohnabrechnung.',
    },
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
    monatVorher: 'Voriger Monat',
    monatSpaeter: 'Nächster Monat',
    monatHeute: 'Aktueller Monat',
    jahr: 'Jahr',
    jahrVorher: 'Voriges Jahr',
    jahrSpaeter: 'Nächstes Jahr',
    jahrHeute: 'Aktuelles Jahr',
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
    stempeluhr: {
      titel: 'Arbeitszeit',
      beginnen: 'Arbeit beginnen',
      beenden: 'Arbeit beenden',
      laeuftSeit: 'Läuft',
      seit: 'seit',
      keineSchichtJetzt: 'Gerade läuft keine Schicht, in die Sie einstempeln können. '
        + 'Der Knopf erscheint, sobald Ihre Schicht beginnt.',
      serverUhrHinweis: 'Gezählt wird die Zeit des Servers, nicht die Ihres Geräts.',
      eingecheckt: 'Eingestempelt. Die Zeit läuft.',
      ausgecheckt: 'Ausgestempelt. Ihre Stunden gehen an die Leitung.',
      abgelehnt: 'Das hat nicht geklappt. Prüfen Sie, ob Ihre Schicht schon begonnen hat.',
      schonOffen: 'Sie sind bereits eingestempelt.',
    },
    korrigiertHinweis: 'Dieser Eintrag wurde korrigiert. Den Grund hat Ihnen die Leitung als Nachricht geschickt — sie steht in Ihrem Posteingang.',
    korrigiertFassung: 'Fassung',
    einwandMelden: 'Einwand melden',
    einwandArt: 'Art des Einwands',
    einwandBegruendung: 'Was stimmt nicht?',
    einwandEntscheidung: 'Entscheidung',
    einwandEntschiedenAm: 'Entschieden am',
    einwandOhneBegruendung: 'Ohne Begründung eingetragen — fragen Sie die Planung.',
    einwandWartet: 'Ihre Meldung liegt bei der Planung. Sobald entschieden ist, '
      + 'steht die Begründung hier und Sie bekommen eine Nachricht.',
    einwandEingereichtAm: 'Gemeldet am',
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
    halberTagBeginn: 'Erster Tag nur halb',
    halberTagEnde: 'Letzter Tag nur halb',
    halberTagHinweis:
      'Wenn Sie am ersten oder letzten Tag noch bzw. schon gearbeitet haben. '
      + 'Ein halber Tag zählt als 0,5.',
    auVorliegt: 'Arbeitsunfähigkeitsbescheinigung liegt vor',
    auBis: 'Bescheinigung gültig bis',
    auHinweis:
      'Nur ankreuzen, wenn Sie die Bescheinigung schon abgegeben haben. Ohne sie bleibt '
      + 'die Meldung gültig — die Personalstelle fragt nach.',
    absenden: 'Absenden',
    gueltigBis: 'Gültig bis',
    unbefristet: 'unbefristet',
    abgelaufen: 'Abgelaufen',
    laeuftAb: 'Läuft ab',
    sperrtEinteilung: 'Ohne diesen Nachweis darf Sie niemand einteilen.',
    mehrZeilen: 'Mehr Zeilen',
    mehrZeilenHinweis:
      'Lädt das Blatt mit drei weiteren Zeilen neu. Getipptes geht dabei verloren — '
      + 'bitte vor dem Ausfüllen.',
    nachweisWasTun: 'Was jetzt zu tun ist',
    nachweisWasTunText:
      'Bringen oder senden Sie den neuen Nachweis an das Büro Ihrer Gesellschaft. '
      + 'Dort wird er eingetragen; danach steht er hier. Bis dahin bleibt die '
      + 'Einteilung gesperrt.',
    nachweisKeinUpload:
      'Hochladen geht hier nicht — das Portal hat keine Ablage für Nachweise, und '
      + 'ein Feld, das nichts speichert, wäre schlimmer als keines.',
    nachweisZuNachrichten: 'Zu den Nachrichten',
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
    abwesenheitBlatt: 'Meine Abwesenheit',
    abwesenheitRuecknahme: 'Abwesenheit zurücknehmen',
    abwesenheitRuecknahmeHinweis:
      'Solange niemand darüber entschieden hat, können Sie eine Abwesenheit selbst '
      + 'zurücknehmen — zum Beispiel, wenn Sie sich im Datum vertan haben. Die Zeile bleibt '
      + 'lesbar, mit Meldung und Rücknahme.',
    abwesenheitNichtRuecknehmbar:
      'Diese Abwesenheit ist entschieden oder schon zurückgenommen. Eine Änderung nimmt '
      + 'jetzt die Personalstelle vor.',
    abwesenheitArtVerdeckt:
      'Die Art der Abwesenheit steht hier nicht: Gesundheitsdaten sind eng geführt, und die '
      + 'Datenbank gibt sie dem Portal auch für die eigene Zeile nicht heraus. Die '
      + 'Personalstelle nennt sie Ihnen.',
    gemeldetAm: 'Gemeldet am',
    storniertAm: 'Zurückgenommen am',
    halbeTage: 'Halbe Tage',
    mehrereOffen: 'Mehrere offene Nachweise',
    mehrereOffenHinweis:
      'Auf dieser Schicht sind mehrere Nachweise offen. Welcher jetzt unterschrieben wird, '
      + 'kann der Bildschirm nicht wissen — Sie waren da. Wählen Sie ihn aus. Ein weiterer '
      + 'Nachweis lässt sich hier nicht anlegen, solange mehrere offen sind.',
    diesenUnterschreiben: 'Diesen unterschreiben',
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
    nachgetragen: 'Nachgetragen',
    nachgetragenHinweis:
      'Der Vorgang ist früher geschehen und wird jetzt erst eingetippt — etwa aus '
      + 'dem Buch am Objekt nach der Schicht. Die Zeit des Eintrags bleibt die des '
      + 'Servers; dieses Häkchen sagt nur, dass sie nicht die Zeit des Vorgangs ist.',
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
    zusagen: 'Zusagen',
    absagen: 'Absagen',
    zusageFrage: 'Können Sie diese Schicht übernehmen?',
    absageGrund: 'Warum können Sie nicht?',
    absageGrundHinweis:
      'Ein Grund ist nötig. Die Disposition muss unterscheiden können zwischen '
      + '„krank" und „Bus verpasst" — das eine besetzt sie nach, das andere ruft sie an.',
    zugesagtHinweis: 'Sie haben zugesagt. Das Büro sieht es.',
    abgesagtHinweis: 'Sie haben abgesagt. Das Büro sieht es und besetzt nach.',
    absageEndgueltig:
      'Eine Absage lässt sich hier nicht zurücknehmen — das Büro hat den Platz '
      + 'möglicherweise schon neu besetzt. Rufen Sie an, wenn es sich geändert hat.',
    antwortZugesagt: 'Zugesagt.',
    antwortAbgesagt: 'Abgesagt. Das Büro ist unterrichtet.',
    antwortSchonZugesagt: 'Sie hatten schon zugesagt — es bleibt dabei.',
    antwortSchonAbgesagt: 'Sie hatten schon abgesagt — es bleibt dabei.',
    antwortVorbei: 'Diese Schicht ist vorbei.',
    antwortNichtMoeglich: 'In diesem Stand geht das nicht mehr. Bitte im Büro melden.',
    antwortGrundFehlt: 'Bitte schreiben Sie dazu, warum.',
    antwortUnbekannt: 'Diese Schicht gibt es nicht.',
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
    korrigieren: 'Korrigieren',
    korrekturGrund: 'Grund der Korrektur',
    stornierenUndErsetzen: 'Stornieren und ersetzen',
    korrekturHinweis: 'Die falsche Zeile verschwindet nicht — sie bleibt durchgestrichen '
      + 'neben der neuen stehen. So sieht jeder, was zuerst dastand.',
    tagesfotoHinzufuegen: 'Foto hinzufügen',
    tagesfotoHinweis: 'Ortsdaten werden vor dem Ablegen aus dem Bild entfernt.',
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

    zuordnungStatus: {
      geplant: 'Geplant',
      zugesagt: 'Zugesagt',
      abgesagt: 'Abgesagt',
      ersetzt: 'Ersetzt',
      nicht_erschienen: 'Nicht erschienen',
    },
    bewacherStatus: {
      beantragt: 'Beantragt',
      registriert: 'Registriert',
      abgelehnt: 'Abgelehnt',
      erloschen: 'Erloschen',
      gesperrt: 'Gesperrt',
      unbekannt: 'Unbekannt',
    },
    rechtsgrundlage: 'Rechtsgrundlage',
    zeitanomalie: {
      dst_luecke: '23-Stunden-Tag (Zeitumstellung)',
      dst_doppelt: '25-Stunden-Tag (Zeitumstellung)',
    },
  },
  en: {
    heute: 'Today',
    schichten: 'Shifts',
    zeiten: 'My hours',
    stundenkonto: 'Hours account',
    urlaub: 'Leave',
    antraege: 'Requests',
    nachweise: 'Certificates',
    funktion: 'Role',
    monatsnachweis: 'Monthly statement',
    nachweisBlatt: {
      titel: 'Record of hours, § 17 MiLoG',
      abgeschlossen: 'closed and immutable',
      vorlaeufig: 'provisional — the month is still open',
      gesperrt: 'locked, but not yet sealed',
      zeitenDesMonats: 'Times recorded this month',
      tag: 'Day', beginn: 'Start', ende: 'End', pause: 'Break',
      anteilBrutto: 'Share, gross', anteilNetto: 'Share, net', summe: 'Total',
      erklaerung:
        'Start and end are the actual instants of the entry, in Europe/Berlin. A '
        + 'shift crossing the month boundary appears on both monthly sheets with '
        + 'its true times; only the share depends on the month.',
      stundenkonto: 'Hours account',
      keinKonto: 'no account kept',
      abweichend:
        'differs, because the month is still open and only released times are '
        + 'booked.',
      pruefsumme: 'Checksum:',
      fussnote:
        'Record under § 17 (1) MiLoG. Instants stored in UTC, shown in '
        + 'Europe/Berlin. Not pay: this record keeps minutes; they are valued in '
        + 'payroll.',
    },
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
    monatVorher: 'Previous month',
    monatSpaeter: 'Next month',
    monatHeute: 'Current month',
    jahr: 'Year',
    jahrVorher: 'Previous year',
    jahrSpaeter: 'Next year',
    jahrHeute: 'Current year',
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
    stempeluhr: {
      titel: 'Working time',
      beginnen: 'Start work',
      beenden: 'End work',
      laeuftSeit: 'Running',
      seit: 'since',
      keineSchichtJetzt: 'No shift is running that you could clock into right now. '
        + 'The button appears once your shift starts.',
      serverUhrHinweis: 'The server clock is counted, not your device clock.',
      eingecheckt: 'Clocked in. The time is running.',
      ausgecheckt: 'Clocked out. Your hours go to management.',
      abgelehnt: 'That did not work. Check whether your shift has already started.',
      schonOffen: 'You are already clocked in.',
    },
    korrigiertHinweis: 'This entry was corrected. Management sent you the reason as a message — it is in your inbox.',
    korrigiertFassung: 'Version',
    einwandMelden: 'Raise an objection',
    einwandArt: 'Type of objection',
    einwandBegruendung: 'What is wrong?',
    einwandEntscheidung: 'Decision',
    einwandEntschiedenAm: 'Decided on',
    einwandOhneBegruendung: 'Recorded without a reason — ask the planners.',
    einwandWartet: 'Your report is with the planners. Once it is decided, the '
      + 'reason appears here and you get a message.',
    einwandEingereichtAm: 'Reported on',
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
    halberTagBeginn: 'First day only half',
    halberTagEnde: 'Last day only half',
    halberTagHinweis:
      'If you still worked on the first day, or already worked again on the last. '
      + 'Half a day counts as 0.5.',
    auVorliegt: 'Medical certificate has been handed in',
    auBis: 'Certificate valid until',
    auHinweis:
      'Only tick this if you have already handed the certificate in. Without it the report '
      + 'still stands — the personnel office will ask.',
    absenden: 'Submit',
    gueltigBis: 'Valid until',
    unbefristet: 'no expiry',
    abgelaufen: 'Expired',
    laeuftAb: 'Expiring',
    sperrtEinteilung: 'Without this certificate nobody may schedule you.',
    mehrZeilen: 'More rows',
    mehrZeilenHinweis:
      'Reloads the sheet with three more rows. Anything typed is lost — so do this '
      + 'before filling it in.',
    nachweisWasTun: 'What to do now',
    nachweisWasTunText:
      'Bring or send the new certificate to the office of your company. It is '
      + 'entered there; after that it appears here. Until then you cannot be '
      + 'scheduled.',
    nachweisKeinUpload:
      'Uploading is not possible here — the portal has no store for certificates, '
      + 'and a field that saves nothing would be worse than none.',
    nachweisZuNachrichten: 'To the messages',
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
    abwesenheitBlatt: 'My absence',
    abwesenheitRuecknahme: 'Withdraw absence',
    abwesenheitRuecknahmeHinweis:
      'As long as nobody has decided on it, you can withdraw an absence yourself — for '
      + 'example if you got the date wrong. The record stays readable, with the report and '
      + 'the withdrawal.',
    abwesenheitNichtRuecknehmbar:
      'This absence has been decided on, or already withdrawn. Any change is now made by '
      + 'the personnel office.',
    abwesenheitArtVerdeckt:
      'The type of absence is not shown here: health data is kept narrow, and the database '
      + 'does not hand it to the portal even for your own record. The personnel office will '
      + 'tell you.',
    gemeldetAm: 'Reported on',
    storniertAm: 'Withdrawn on',
    halbeTage: 'Half days',
    mehrereOffen: 'Several open records',
    mehrereOffenHinweis:
      'Several records are open on this shift. Which one is being signed now is not '
      + 'something the screen can know — you were there. Pick it. No further record can be '
      + 'created here while several are open.',
    diesenUnterschreiben: 'Sign this one',
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
    nachgetragen: 'Entered later',
    nachgetragenHinweis:
      'The event happened earlier and is only being typed in now — for example from '
      + 'the logbook on site after the shift. The entry keeps the server’s time; this '
      + 'checkbox only says that it is not the time of the event.',
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
    zusagen: 'Accept',
    absagen: 'Decline',
    zusageFrage: 'Can you take this shift?',
    absageGrund: 'Why can you not?',
    absageGrundHinweis:
      'A reason is required. Scheduling has to tell "off sick" from "missed the bus" — '
      + 'one they re-staff, the other they call you about.',
    zugesagtHinweis: 'You have accepted. The office can see it.',
    abgesagtHinweis: 'You have declined. The office can see it and will re-staff.',
    absageEndgueltig:
      'A decline cannot be taken back here — the office may already have filled the '
      + 'place. Call them if something has changed.',
    antwortZugesagt: 'Accepted.',
    antwortAbgesagt: 'Declined. The office has been told.',
    antwortSchonZugesagt: 'You had already accepted — it stands.',
    antwortSchonAbgesagt: 'You had already declined — it stands.',
    antwortVorbei: 'This shift is over.',
    antwortNichtMoeglich: 'That is no longer possible at this stage. Please contact the office.',
    antwortGrundFehlt: 'Please write why.',
    antwortUnbekannt: 'There is no such shift.',
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
    korrigieren: 'Correct',
    korrekturGrund: 'Reason for the correction',
    stornierenUndErsetzen: 'Cancel and replace',
    korrekturHinweis: 'The wrong line does not disappear — it stays crossed out next '
      + 'to the new one. Everyone can see what was there first.',
    tagesfotoHinzufuegen: 'Add photo',
    tagesfotoHinweis: 'Location data is removed from the image before it is stored.',
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

    zuordnungStatus: {
      geplant: 'Planned',
      zugesagt: 'Accepted',
      abgesagt: 'Declined',
      ersetzt: 'Replaced',
      nicht_erschienen: 'Did not attend',
    },
    bewacherStatus: {
      beantragt: 'Applied for',
      registriert: 'Registered',
      abgelehnt: 'Rejected',
      erloschen: 'Lapsed',
      gesperrt: 'Blocked',
      unbekannt: 'Unknown',
    },
    rechtsgrundlage: 'Legal basis',
    zeitanomalie: {
      dst_luecke: '23-hour day (clock change)',
      dst_doppelt: '25-hour day (clock change)',
    },
  },
  ar: {
    heute: 'اليوم',
    schichten: 'المناوبات',
    zeiten: 'ساعاتي',
    stundenkonto: 'حساب الساعات',
    urlaub: 'الإجازة',
    antraege: 'الطلبات',
    nachweise: 'الشهادات',
    funktion: 'الوظيفة',
    monatsnachweis: 'كشف الساعات الشهري',
    nachweisBlatt: {
      titel: 'سجل ساعات العمل § 17 MiLoG',
      abgeschlossen: 'مُغلق وغير قابل للتعديل',
      vorlaeufig: 'مبدئي — الشهر ما زال مفتوحاً',
      gesperrt: 'مقفل، لكنه لم يُختم بعد',
      zeitenDesMonats: 'أوقات هذا الشهر',
      tag: 'اليوم', beginn: 'البداية', ende: 'النهاية', pause: 'الاستراحة',
      anteilBrutto: 'الحصة الإجمالية', anteilNetto: 'الحصة الصافية', summe: 'المجموع',
      erklaerung:
        'البداية والنهاية هما الوقتان الفعليان للتسجيل بتوقيت Europe/Berlin. '
        + 'المناوبة التي تعبر حدّ الشهر تظهر في كشفَي الشهرين بأوقاتها الحقيقية؛ '
        + 'الحصة وحدها هي التي تتبع الشهر.',
      stundenkonto: 'حساب الساعات',
      keinKonto: 'لا يوجد حساب',
      abweichend: 'مختلف، لأن الشهر ما زال مفتوحاً ولا تُحتسب إلا الأوقات المُعتمدة.',
      pruefsumme: 'المجموع الرقابي:',
      fussnote:
        'سجل بموجب § 17 الفقرة 1 من MiLoG. الأوقات مخزّنة بتوقيت UTC ومعروضة '
        + 'بتوقيت Europe/Berlin. هذا ليس أجراً: السجل يحفظ الدقائق، وتقييمها يتم '
        + 'في كشف الرواتب.',
    },
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
    monatVorher: 'الشهر السابق',
    monatSpaeter: 'الشهر التالي',
    monatHeute: 'الشهر الحالي',
    jahr: 'السنة',
    jahrVorher: 'السنة السابقة',
    jahrSpaeter: 'السنة التالية',
    jahrHeute: 'السنة الحالية',
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
    stempeluhr: {
      titel: 'وقت العمل',
      beginnen: 'ابدأ العمل',
      beenden: 'أنهِ العمل',
      laeuftSeit: 'جارٍ',
      seit: 'منذ',
      keineSchichtJetzt: 'لا توجد مناوبة جارية يمكنك تسجيل الدخول إليها الآن. '
        + 'يظهر الزرّ فور بدء مناوبتك.',
      serverUhrHinweis: 'المحتسَب هو وقت الخادم، لا وقت جهازك.',
      eingecheckt: 'تم تسجيل البدء. الوقت يجري.',
      ausgecheckt: 'تم تسجيل الانتهاء. ساعاتك تذهب إلى الإدارة.',
      abgelehnt: 'لم ينجح ذلك. تحقّق ممّا إذا كانت مناوبتك قد بدأت.',
      schonOffen: 'أنت مسجَّل البدء أصلاً.',
    },
    korrigiertHinweis: 'تم تصحيح هذا السجلّ. أرسلت لك الإدارة السبب في رسالة — تجدها في صندوق الوارد.',
    korrigiertFassung: 'النسخة',
    einwandMelden: 'تقديم اعتراض',
    einwandArt: 'نوع الاعتراض',
    einwandBegruendung: 'ما الخطأ؟',
    einwandEntscheidung: 'القرار',
    einwandEntschiedenAm: 'تاريخ القرار',
    einwandOhneBegruendung: 'سُجّل دون تعليل — اسأل قسم التخطيط.',
    einwandWartet: 'بلاغك لدى قسم التخطيط. عند صدور القرار سيظهر التعليل هنا '
      + 'وستصلك رسالة.',
    einwandEingereichtAm: 'تاريخ البلاغ',
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
    halberTagBeginn: 'اليوم الأول نصف يوم فقط',
    halberTagEnde: 'اليوم الأخير نصف يوم فقط',
    halberTagHinweis:
      'إذا كنت قد عملت في اليوم الأول، أو عدت للعمل في اليوم الأخير. '
      + 'نصف اليوم يُحتسب 0,5.',
    auVorliegt: 'تم تسليم التقرير الطبي',
    auBis: 'التقرير الطبي صالح حتى',
    auHinweis:
      'ضع علامة فقط إذا كنت قد سلّمت التقرير فعلاً. بدونه يبقى البلاغ ساري المفعول — '
      + 'قسم شؤون الموظفين سيسأل عنه.',
    absenden: 'إرسال',
    gueltigBis: 'صالحة حتى',
    unbefristet: 'بدون تاريخ انتهاء',
    abgelaufen: 'منتهية',
    laeuftAb: 'توشك على الانتهاء',
    sperrtEinteilung: 'بدون هذه الشهادة لا يجوز لأحد جدولتك.',
    mehrZeilen: 'صفوف إضافية',
    mehrZeilenHinweis:
      'يعيد تحميل الورقة بثلاثة صفوف إضافية. ما كُتب يضيع عندها — لذلك قبل التعبئة.',
    nachweisWasTun: 'ما الذي يجب فعله الآن',
    nachweisWasTunText:
      'أحضر الشهادة الجديدة إلى مكتب شركتك أو أرسلها إليه. يتم تسجيلها هناك، وبعد '
      + 'ذلك تظهر هنا. حتى ذلك الحين يبقى إدراجك في الجدول متوقفاً.',
    nachweisKeinUpload:
      'الرفع غير ممكن هنا — لا يوجد في البوابة مكان لحفظ الشهادات، وحقل لا يحفظ '
      + 'شيئاً أسوأ من عدم وجوده.',
    nachweisZuNachrichten: 'إلى الرسائل',
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
    abwesenheitBlatt: 'غيابي',
    abwesenheitRuecknahme: 'سحب بلاغ الغياب',
    abwesenheitRuecknahmeHinweis:
      'ما دام لم يتّخذ أحد قراراً بشأنه، يمكنك سحب بلاغ الغياب بنفسك — مثلاً إذا أخطأت في '
      + 'التاريخ. يبقى السجل قابلاً للقراءة، مع البلاغ والسحب.',
    abwesenheitNichtRuecknehmbar:
      'تم البتّ في هذا الغياب أو سُحب من قبل. أي تعديل الآن يجريه قسم شؤون الموظفين.',
    abwesenheitArtVerdeckt:
      'نوع الغياب غير معروض هنا: البيانات الصحية محدودة التداول، وقاعدة البيانات لا تمنحها '
      + 'للبوابة حتى لسجلك أنت. قسم شؤون الموظفين سيخبرك به.',
    gemeldetAm: 'أُبلغ في',
    storniertAm: 'سُحب في',
    halbeTage: 'أنصاف الأيام',
    mehrereOffen: 'عدة إثباتات مفتوحة',
    mehrereOffenHinweis:
      'على هذه الوردية أكثر من إثبات مفتوح. الشاشة ما بتعرف أي واحد بدّو يتوقّع الآن — إنت كنت '
      + 'هناك. اختار الواحد الصحيح. ما بينفع تنشئ إثبات جديد هون طالما في أكتر من واحد مفتوح.',
    diesenUnterschreiben: 'وقّع هذا',
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
    nachgetragen: 'مُدرج لاحقاً',
    nachgetragenHinweis:
      'الحدث وقع سابقاً ويُكتب الآن فقط — مثلاً من الدفتر في الموقع بعد الوردية. '
      + 'يبقى وقت القيد هو وقت الخادم؛ هذه العلامة تقول فقط إنه ليس وقت الحدث.',
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
    zusagen: 'أوافق',
    absagen: 'أعتذر',
    zusageFrage: 'هل يمكنك تولّي هذه المناوبة؟',
    absageGrund: 'لماذا لا تستطيع؟',
    absageGrundHinweis:
      'السبب مطلوب. على قسم التوزيع أن يفرّق بين «مريض» و«فاتني الباص» — '
      + 'الأول يجد بديلاً، والثاني يتّصل بك.',
    zugesagtHinweis: 'وافقت. المكتب يرى ذلك.',
    abgesagtHinweis: 'اعتذرت. المكتب يرى ذلك ويضع بديلاً.',
    absageEndgueltig:
      'لا يمكن سحب الاعتذار من هنا — ربما يكون المكتب قد ملأ المكان. '
      + 'اتّصل بهم إن تغيّر شيء.',
    antwortZugesagt: 'تمّت الموافقة.',
    antwortAbgesagt: 'تمّ الاعتذار. أُبلغ المكتب.',
    antwortSchonZugesagt: 'كنت قد وافقت — تبقى الموافقة.',
    antwortSchonAbgesagt: 'كنت قد اعتذرت — يبقى الاعتذار.',
    antwortVorbei: 'هذه المناوبة انتهت.',
    antwortNichtMoeglich: 'لم يعد ذلك ممكناً في هذه الحالة. راجع المكتب.',
    antwortGrundFehlt: 'اكتب السبب من فضلك.',
    antwortUnbekannt: 'لا توجد مناوبة بهذا الرقم.',
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
    korrigieren: 'تصحيح',
    korrekturGrund: 'سبب التصحيح',
    stornierenUndErsetzen: 'إلغاء واستبدال',
    korrekturHinweis: 'السطر الخاطئ لا يختفي — يبقى مشطوباً بجانب السطر الجديد، '
      + 'فيرى الجميع ما كان مكتوباً أولاً.',
    tagesfotoHinzufuegen: 'إضافة صورة',
    tagesfotoHinweis: 'تُزال بيانات الموقع من الصورة قبل حفظها.',
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

    zuordnungStatus: {
      geplant: 'مخطّط لها',
      zugesagt: 'تمت الموافقة',
      abgesagt: 'تم الاعتذار',
      ersetzt: 'تم الاستبدال',
      nicht_erschienen: 'لم يحضر',
    },
    bewacherStatus: {
      beantragt: 'قيد الطلب',
      registriert: 'مسجّل',
      abgelehnt: 'مرفوض',
      erloschen: 'منتهٍ',
      gesperrt: 'محظور',
      unbekannt: 'غير معروف',
    },
    rechtsgrundlage: 'الأساس القانوني',
    zeitanomalie: {
      dst_luecke: 'يوم من 23 ساعة (تغيير التوقيت)',
      dst_doppelt: 'يوم من 25 ساعة (تغيير التوقيت)',
    },
  },
  tr: {
    heute: 'Bugün',
    schichten: 'Vardiyalar',
    zeiten: 'Saatlerim',
    stundenkonto: 'Saat hesabı',
    urlaub: 'İzin',
    antraege: 'Talepler',
    nachweise: 'Belgeler',
    funktion: 'Görev',
    monatsnachweis: 'Aylık saat belgesi',
    nachweisBlatt: {
      titel: 'Çalışma saatleri kaydı § 17 MiLoG',
      abgeschlossen: 'kapatıldı ve değiştirilemez',
      vorlaeufig: 'geçici — ay henüz açık',
      gesperrt: 'kilitli, ancak henüz mühürlenmedi',
      zeitenDesMonats: 'Bu ayın saatleri',
      tag: 'Gün', beginn: 'Başlangıç', ende: 'Bitiş', pause: 'Mola',
      anteilBrutto: 'Pay, brüt', anteilNetto: 'Pay, net', summe: 'Toplam',
      erklaerung:
        'Başlangıç ve bitiş, kaydın Europe/Berlin saatindeki gerçek anlarıdır. Ay '
        + 'sınırını aşan bir vardiya her iki ay belgesinde de gerçek saatleriyle '
        + 'yer alır; yalnızca pay aya bağlıdır.',
      stundenkonto: 'Saat hesabı',
      keinKonto: 'hesap tutulmuyor',
      abweichend:
        'farklı, çünkü ay hâlâ açık ve yalnızca onaylanan saatler işleniyor.',
      pruefsumme: 'Kontrol toplamı:',
      fussnote:
        '§ 17 fıkra 1 MiLoG uyarınca kayıt. Anlar UTC olarak saklanır, '
        + 'Europe/Berlin olarak gösterilir. Ücret değildir: bu kayıt dakikaları '
        + 'tutar, değerlendirmesi bordroda yapılır.',
    },
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
    monatVorher: 'Önceki ay',
    monatSpaeter: 'Sonraki ay',
    monatHeute: 'Bu ay',
    jahr: 'Yıl',
    jahrVorher: 'Önceki yıl',
    jahrSpaeter: 'Sonraki yıl',
    jahrHeute: 'Bu yıl',
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
    stempeluhr: {
      titel: 'Çalışma saati',
      beginnen: 'İşe başla',
      beenden: 'İşi bitir',
      laeuftSeit: 'Sürüyor',
      seit: 'başlangıç',
      keineSchichtJetzt: 'Şu anda giriş yapabileceğiniz bir vardiya yok. '
        + 'Vardiyanız başlar başlamaz düğme görünür.',
      serverUhrHinweis: 'Cihazınızın saati değil, sunucunun saati sayılır.',
      eingecheckt: 'Giriş yapıldı. Süre işliyor.',
      ausgecheckt: 'Çıkış yapıldı. Saatleriniz yönetime gidiyor.',
      abgelehnt: 'Bu işe yaramadı. Vardiyanızın başlayıp başlamadığını kontrol edin.',
      schonOffen: 'Zaten giriş yapmış durumdasınız.',
    },
    korrigiertHinweis: 'Bu kayıt düzeltildi. Yönetim size nedenini mesaj olarak gönderdi — gelen kutunuzda.',
    korrigiertFassung: 'Sürüm',
    einwandMelden: 'İtiraz bildir',
    einwandArt: 'İtiraz türü',
    einwandBegruendung: 'Ne yanlış?',
    einwandEntscheidung: 'Karar',
    einwandEntschiedenAm: 'Karar tarihi',
    einwandOhneBegruendung: 'Gerekçesiz kaydedildi — planlamaya sorun.',
    einwandWartet: 'Bildiriminiz planlamada. Karar verildiğinde gerekçe burada '
      + 'görünür ve size bir mesaj gelir.',
    einwandEingereichtAm: 'Bildirim tarihi',
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
    halberTagBeginn: 'İlk gün yalnızca yarım',
    halberTagEnde: 'Son gün yalnızca yarım',
    halberTagHinweis:
      'İlk gün hâlâ çalıştıysanız ya da son gün tekrar çalıştıysanız. '
      + 'Yarım gün 0,5 sayılır.',
    auVorliegt: 'İş göremezlik raporu teslim edildi',
    auBis: 'Rapor şu tarihe kadar geçerli',
    auHinweis:
      'Yalnızca raporu gerçekten teslim ettiyseniz işaretleyin. Rapor olmadan da bildirim '
      + 'geçerlidir — personel birimi soracaktır.',
    absenden: 'Gönder',
    gueltigBis: 'Geçerlilik',
    unbefristet: 'süresiz',
    abgelaufen: 'Süresi doldu',
    laeuftAb: 'Süresi doluyor',
    sperrtEinteilung: 'Bu belge olmadan kimse sizi vardiyaya yazamaz.',
    mehrZeilen: 'Daha fazla satır',
    mehrZeilenHinweis:
      'Sayfayı üç satır daha ekleyerek yeniden yükler. Yazılanlar kaybolur — bu '
      + 'yüzden doldurmadan önce yapın.',
    nachweisWasTun: 'Şimdi ne yapmalı',
    nachweisWasTunText:
      'Yeni belgeyi şirketinizin bürosuna getirin veya gönderin. Belge orada '
      + 'kaydedilir, sonra burada görünür. O zamana kadar vardiyaya yazılamazsınız.',
    nachweisKeinUpload:
      'Buradan yükleme yapılamaz — portalda belgeler için bir depo yok ve hiçbir şey '
      + 'kaydetmeyen bir alan, hiç olmamasından kötüdür.',
    nachweisZuNachrichten: 'Mesajlara',
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
    abwesenheitBlatt: 'Devamsızlığım',
    abwesenheitRuecknahme: 'Devamsızlık bildirimini geri çek',
    abwesenheitRuecknahmeHinweis:
      'Henüz kimse karar vermediği sürece devamsızlığı kendiniz geri çekebilirsiniz — '
      + 'örneğin tarihi yanlış girdiyseniz. Kayıt okunabilir kalır; bildirim ve geri çekme '
      + 'birlikte görünür.',
    abwesenheitNichtRuecknehmbar:
      'Bu devamsızlık karara bağlandı ya da zaten geri çekildi. Değişikliği artık personel '
      + 'birimi yapar.',
    abwesenheitArtVerdeckt:
      'Devamsızlığın türü burada gösterilmez: sağlık verileri dar tutulur ve veritabanı '
      + 'bunu kendi kaydınız için bile portala vermez. Personel birimi size söyleyecektir.',
    gemeldetAm: 'Bildirim tarihi',
    storniertAm: 'Geri çekilme tarihi',
    halbeTage: 'Yarım günler',
    mehrereOffen: 'Birden fazla açık kayıt',
    mehrereOffenHinweis:
      'Bu vardiyada birden fazla kayıt açık. Şimdi hangisinin imzalanacağını ekran bilemez — '
      + 'oradaydınız. Siz seçin. Birden fazlası açıkken burada yeni kayıt oluşturulamaz.',
    diesenUnterschreiben: 'Bunu imzala',
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
    nachgetragen: 'Sonradan girildi',
    nachgetragenHinweis:
      'Olay daha önce gerçekleşti ve şimdi giriliyor — örneğin vardiyadan sonra '
      + 'sahadaki defterden. Kaydın saati sunucunun saati olarak kalır; bu kutucuk '
      + 'yalnızca bunun olayın saati olmadığını söyler.',
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
    zusagen: 'Kabul et',
    absagen: 'Reddet',
    zusageFrage: 'Bu vardiyayı üstlenebilir misiniz?',
    absageGrund: 'Neden üstlenemiyorsunuz?',
    absageGrundHinweis:
      'Bir gerekçe gerekli. Planlama, „hastayım" ile „otobüsü kaçırdım" arasını '
      + 'ayırabilmeli — biri için yerinize birini bulur, diğeri için sizi arar.',
    zugesagtHinweis: 'Kabul ettiniz. Ofis bunu görüyor.',
    abgesagtHinweis: 'Reddettiniz. Ofis bunu görüyor ve yerinize birini bulacak.',
    absageEndgueltig:
      'Bir ret buradan geri alınamaz — ofis yeri çoktan doldurmuş olabilir. '
      + 'Bir şey değiştiyse arayın.',
    antwortZugesagt: 'Kabul edildi.',
    antwortAbgesagt: 'Reddedildi. Ofise bildirildi.',
    antwortSchonZugesagt: 'Zaten kabul etmiştiniz — öyle kalıyor.',
    antwortSchonAbgesagt: 'Zaten reddetmiştiniz — öyle kalıyor.',
    antwortVorbei: 'Bu vardiya bitti.',
    antwortNichtMoeglich: 'Bu aşamada artık mümkün değil. Lütfen ofisle görüşün.',
    antwortGrundFehlt: 'Lütfen nedenini yazın.',
    antwortUnbekannt: 'Böyle bir vardiya yok.',
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
    korrigieren: 'Düzelt',
    korrekturGrund: 'Düzeltme nedeni',
    stornierenUndErsetzen: 'İptal et ve değiştir',
    korrekturHinweis: 'Yanlış satır kaybolmaz — yenisinin yanında üstü çizili olarak '
      + 'kalır. Böylece önce ne yazdığını herkes görür.',
    tagesfotoHinzufuegen: 'Fotoğraf ekle',
    tagesfotoHinweis: 'Konum bilgileri kaydedilmeden önce fotoğraftan silinir.',
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

    zuordnungStatus: {
      geplant: 'Planlandı',
      zugesagt: 'Kabul edildi',
      abgesagt: 'Reddedildi',
      ersetzt: 'Değiştirildi',
      nicht_erschienen: 'Gelmedi',
    },
    bewacherStatus: {
      beantragt: 'Başvuruldu',
      registriert: 'Kayıtlı',
      abgelehnt: 'Reddedildi',
      erloschen: 'Sona erdi',
      gesperrt: 'Engellendi',
      unbekannt: 'Bilinmiyor',
    },
    rechtsgrundlage: 'Yasal dayanak',
    zeitanomalie: {
      dst_luecke: '23 saatlik gün (saat değişimi)',
      dst_doppelt: '25 saatlik gün (saat değişimi)',
    },
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
 * Der ZUSTAND eines Einwands, in vier Sprachen (V-051, EMP-07, TIM-11).
 *
 * **Der Befund: die Entscheidung erreichte die Meldende nirgends.** Auf
 * `/portal/mein/zeiten/[id]/einwand` stand unter „Meine Meldungen" der rohe
 * Enum-Wert — `teilweise_anerkannt` — und weder wann entschieden wurde noch
 * mit welcher Begründung. Beides lag in `zeit_einwand` und wurde von
 * `listeEigeneEinwaende` sogar geladen; nur gezeigt wurde es nicht. Eine
 * Person, die einen falschen Lohn meldet, las damit ein Wort ihrer
 * Datenbank und erfuhr nie, warum.
 *
 * **Wie bei den Einwandarten: die SCHLUESSEL sind das Vokabular des Enums**
 * (`einwand_status`) und reisen unübersetzt in die Datenbank; übersetzt wird
 * nur, was auf dem Bildschirm steht (D-83).
 *
 * **`zurueckgezogen` steht mit dabei, obwohl die Planung es nie setzt.** Es
 * ist der eine Zustand, den die betroffene Person selbst herstellt — und ein
 * Zustandswort, das für genau ihren Fall fehlt, wäre die Lücke an der
 * teuersten Stelle.
 */
export type EinwandStatusSchluessel =
  'offen' | 'in_pruefung' | 'anerkannt' | 'teilweise_anerkannt'
  | 'abgelehnt' | 'zurueckgezogen';

export const EINWAND_STATUS_TEXTE:
Readonly<Record<PortalSprache, Readonly<Record<EinwandStatusSchluessel, string>>>> = {
  de: {
    offen: 'Offen — noch nicht angesehen',
    in_pruefung: 'In Prüfung',
    anerkannt: 'Anerkannt',
    teilweise_anerkannt: 'Teilweise anerkannt',
    abgelehnt: 'Abgelehnt',
    zurueckgezogen: 'Von Ihnen zurückgezogen',
  },
  en: {
    offen: 'Open — not yet reviewed',
    in_pruefung: 'Under review',
    anerkannt: 'Accepted',
    teilweise_anerkannt: 'Partly accepted',
    abgelehnt: 'Rejected',
    zurueckgezogen: 'Withdrawn by you',
  },
  ar: {
    offen: 'مفتوح — لم يُنظر فيه بعد',
    in_pruefung: 'قيد المراجعة',
    anerkannt: 'مقبول',
    teilweise_anerkannt: 'مقبول جزئياً',
    abgelehnt: 'مرفوض',
    zurueckgezogen: 'سحبته بنفسك',
  },
  tr: {
    offen: 'Açık — henüz incelenmedi',
    in_pruefung: 'İnceleniyor',
    anerkannt: 'Kabul edildi',
    teilweise_anerkannt: 'Kısmen kabul edildi',
    abgelehnt: 'Reddedildi',
    zurueckgezogen: 'Tarafınızdan geri çekildi',
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
