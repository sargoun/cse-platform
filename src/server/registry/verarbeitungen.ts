/**
 * **Das Register der Verarbeitungstätigkeiten (Art. 30 Abs. 1 DSGVO, LEG-09).**
 *
 * Art. 30 verlangt ein Verzeichnis, das je Tätigkeit sagt: wozu, über wen,
 * welche Daten, an wen, wie lange. Diese Datei ist die eine Stelle, an der
 * das steht — und zwar als **Beschreibung dessen, was die Software tut**,
 * nicht als Rechtsauskunft.
 *
 * **Die Trennlinie, die hier zählt.** Was die Plattform verarbeitet, weiss
 * dieses Projekt; auf WELCHER Rechtsgrundlage (Art. 6 Abs. 1) eine
 * Gesellschaft das tut, weiss ihre Geschäftsführung. Das eine steht hier als
 * Tatsache, das andere als offene Frage — eine erfundene Rechtsgrundlage
 * wäre die teuerste Zeile dieses Projekts, weil sie vor einer Aufsicht wie
 * eine Prüfung aussieht (`CLAUDE.md`, „Never invent a business rule").
 *
 * **Warum ein Code-Register und keine Tabelle.** Dieselbe Entscheidung wie
 * bei `rls.ts` (K-16) und `auftragsverarbeiter.ts`: die Liste ändert sich mit
 * dem CODE, nicht mit dem Betrieb. Eine neue Tätigkeit entsteht, wenn jemand
 * ein Modul baut — und dann soll sie im selben PR entstehen, gelesen und
 * geprüft, statt später von jemandem nachgetragen zu werden, der die Tabellen
 * nicht mehr kennt. `tests/kern/verarbeitungen.test.ts` hält das Register
 * gegen die Modulliste: ein Modul ohne Tätigkeit fällt auf.
 *
 * Welche Tätigkeiten für eine Gesellschaft GELTEN, entscheidet dagegen der
 * Betrieb: `mandant.module` schaltet die Gewerke frei, und das Verzeichnis
 * zeigt nur, was dort gebucht ist (`services/datenschutz/verzeichnis.ts`).
 */

/** Über wen die Tätigkeit Daten verarbeitet (Art. 30 Abs. 1 lit. c). */
export type Betroffene =
  | 'beschaeftigte'
  | 'bewerbende'
  | 'kundenkontakte'
  | 'lieferantenkontakte'
  | 'interessenten'
  | 'nutzende';

export const BETROFFENE_LABEL: Readonly<Record<Betroffene, string>> = {
  beschaeftigte: 'Beschäftigte der Gesellschaft',
  bewerbende: 'Bewerberinnen und Bewerber',
  kundenkontakte: 'Ansprechpersonen bei Kundinnen und Kunden',
  lieferantenkontakte: 'Ansprechpersonen bei Lieferanten und Nachunternehmen',
  interessenten: 'Interessenten aus Anfragen der Website',
  nutzende: 'Nutzende der Plattform (Konten)',
};

export interface Verarbeitung {
  /** Die Nummer im Verzeichnis — stabil, damit eine Aufsicht sie zitieren kann. */
  readonly nummer: string;
  readonly bezeichnung: string;
  /**
   * Das Rechtemodul, an dem die Tätigkeit hängt (`registry/modul.ts`).
   * Bestimmt, ob sie für eine Gesellschaft überhaupt gilt.
   */
  readonly modul: string;
  /** Was die Software damit TUT — Tatsache, kein Rechtssatz. */
  readonly zweck: string;
  readonly betroffene: readonly Betroffene[];
  /** Die Datenarten, in der Sprache der Fachlichkeit und nicht der Tabellen. */
  readonly daten: readonly string[];
  /**
   * Besondere Kategorien nach Art. 9 — `null`, wo keine anfallen.
   *
   * **Gesundheitsdaten stehen hier NICHT.** Die Plattform führt
   * Abwesenheiten mit Art und Zeitraum; eine Diagnose erfasst sie nirgends,
   * und eine Arbeitsunfähigkeitsbescheinigung ist ein Dokument mit Frist,
   * kein Befund. Wo die Grenze im Betrieb verläuft, ist eine Frage an die
   * Gesellschaft (O-514) — behauptet wird hier nichts.
   */
  readonly besondereKategorien: string | null;
  /**
   * Woher die Aufbewahrungsfrist kommt — als VERWEIS, nicht als Zahl.
   *
   * Die Zahl steht in der Konfiguration der Gesellschaft
   * (`aufbewahrungsregel`, `plattform_einstellung`) und wird beim Abruf
   * gelesen. Eine Zahl in dieser Datei wäre eine zweite Wahrheit, die beim
   * ersten Wechsel der Regel falsch wird.
   */
  readonly fristQuelle:
    | { readonly art: 'dokumentklasse'; readonly kategorie: string }
    | { readonly art: 'einstellung'; readonly schluessel: string }
    | { readonly art: 'gesetz'; readonly text: string }
    | { readonly art: 'offen'; readonly frage: string };
  /** Die Empfänger aus `auftragsverarbeiter.ts`, über die Plattform hinaus. */
  readonly empfaenger: readonly string[];
  /** SPEC-Kennungen, damit die Zeile zu ihrem Kapitel zurückführt. */
  readonly spec: readonly string[];
}

/**
 * **Jede Tätigkeit genau einmal.**
 *
 * Geordnet nach dem Lebenszyklus eines Menschen im Betrieb: erst wer
 * arbeitet, dann was er tut, dann wem gegenüber, dann wer die Plattform
 * bedient.
 */
export const VERARBEITUNGEN: readonly Verarbeitung[] = [
  {
    nummer: 'V-01',
    bezeichnung: 'Personalstammdaten und Anstellungen',
    modul: 'personal',
    zweck: 'Führen der Person und ihrer Anstellungen je Gesellschaft, '
      + 'Qualifikationsnachweise mit Ablaufdatum, Zugang zum Mitarbeiterportal',
    betroffene: ['beschaeftigte'],
    daten: [
      'Name, Anschrift, Geburtsdatum, Kontaktdaten',
      'Anstellung je Gesellschaft: Eintritt, Austritt, Stundensatz, Wochenstunden',
      'Nachweise: § 34a GewO, Erste Hilfe, Führerschein — mit Ablaufdatum',
    ],
    besondereKategorien: null,
    fristQuelle: { art: 'offen', frage: 'O-514' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['EMP-01', 'EMP-02', 'SEC-03'],
  },
  {
    nummer: 'V-02',
    bezeichnung: 'Arbeitszeiterfassung',
    modul: 'zeit',
    zweck: 'Erfassen von Beginn, Ende und Dauer je Einsatz über die Serveruhr, '
      + 'Nachweis nach § 17 MiLoG, Prüfung der ArbZG-Grenzen über alle Gesellschaften',
    betroffene: ['beschaeftigte'],
    daten: [
      'Zeiteintrag: Beginn, Ende, Pause, Objekt, Abweichung der Geräteuhr',
      'Ein einzelner Standortpunkt bei Beginn und Ende des Einsatzes (LEG-10)',
      'Korrekturen und Einwände mit Begründung',
    ],
    besondereKategorien: null,
    fristQuelle: { art: 'gesetz', text: '§ 17 Abs. 2 MiLoG — zwei Jahre ab Aufzeichnung' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['TIM-01', 'TIM-08', 'LEG-02', 'LEG-03', 'LEG-10'],
  },
  {
    nummer: 'V-03',
    bezeichnung: 'Dienstplanung und Einsätze',
    modul: 'dienstplan',
    zweck: 'Planen von Schichten je Objekt, Zuordnung von Personen, '
      + 'Warnung bei Ruhezeit- und Höchstgrenzenverstössen',
    betroffene: ['beschaeftigte'],
    daten: ['Schicht, Objekt, Zuordnung, Qualifikation für den Posten', 'Absagen und Vertretungen'],
    besondereKategorien: null,
    fristQuelle: { art: 'offen', frage: 'O-514' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['TIM-05', 'SEC-01'],
  },
  {
    nummer: 'V-04',
    bezeichnung: 'Abwesenheiten',
    modul: 'abwesenheit',
    zweck: 'Führen von Urlaub, Krankheit und sonstigen Abwesenheiten mit Zeitraum '
      + 'und Genehmigungsstand — für Planung und Lohnvorbereitung',
    betroffene: ['beschaeftigte'],
    daten: ['Art der Abwesenheit, Zeitraum, Genehmigung', 'Belegdokument, wo eines vorliegt'],
    /*
     * „Gesundheitsnah" und „Gesundheitsdatum" sind zwei Dinge. Die Plattform
     * kennt „krank von–bis" und ein Dokument; eine Diagnose erfasst sie nicht.
     * Ob die Gesellschaft das dennoch als Art. 9 führt, entscheidet sie.
     */
    besondereKategorien: 'Die Art „Krankheit" berührt Art. 9, ohne eine Diagnose zu '
      + 'erfassen — die Einordnung trifft die Gesellschaft (O-514)',
    fristQuelle: { art: 'offen', frage: 'O-514' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['EMP-05', 'TIM-06'],
  },
  {
    nummer: 'V-05',
    bezeichnung: 'Bewerbungen und Auswahl',
    modul: 'recruiting',
    zweck: 'Entgegennehmen von Bewerbungen über die Karriereseite, Auswertung der '
      + 'Unterlagen, Rangliste nach sichtbaren Kriterien, Gespräche, '
      + 'Einstellungsentscheidung durch einen Menschen (Art. 22)',
    betroffene: ['bewerbende'],
    daten: [
      'Name, Kontaktdaten, Anschreiben, Lebenslaufdaten',
      'Bewertungen mit Begründung, Gesprächsnotizen',
      'Die Entscheidung und der Mensch, der sie getroffen hat',
    ],
    besondereKategorien: null,
    fristQuelle: { art: 'einstellung', schluessel: 'recruiting.aufbewahrung_tage' },
    empfaenger: ['supabase', 'vercel', 'openai'],
    spec: ['REC-03', 'REC-05', 'REC-07', 'REC-08', 'LEG-11', 'LEG-12'],
  },
  {
    nummer: 'V-06',
    bezeichnung: 'Kundenbeziehungen und Anfragen',
    modul: 'crm',
    zweck: 'Führen von Kundinnen und Kunden mit ihren Ansprechpersonen, '
      + 'Anfragen von der Website, Angebote und ihre Nachverfolgung',
    betroffene: ['kundenkontakte', 'interessenten'],
    daten: [
      'Firma, Ansprechperson, Kontaktdaten, Notizen zum Vorgang',
      'Rechtsgrundlage der Ansprache und ein etwaiger Werbewiderspruch (§ 7 UWG)',
    ],
    besondereKategorien: null,
    fristQuelle: { art: 'dokumentklasse', kategorie: 'kunde' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['CRM-01', 'CRM-08', 'LEG-08'],
  },
  {
    nummer: 'V-07',
    bezeichnung: 'Rechnungen und Buchführung',
    modul: 'finanzen',
    zweck: 'Erstellen und Festschreiben von Rechnungen, Offene Posten, Mahnwesen, '
      + 'Übergabe an die Buchhaltung — mit Nummernkreis und Prüfsummenkette',
    betroffene: ['kundenkontakte', 'lieferantenkontakte'],
    daten: [
      'Rechnungsempfänger mit Anschrift, Leistungszeitraum, Beträge',
      'Zahlungen und ihre Zuordnung, Mahnstufen',
    ],
    besondereKategorien: null,
    fristQuelle: { art: 'dokumentklasse', kategorie: 'rechnung' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['FIN-01', 'FIN-06', 'ACC-01', 'LEG-01', 'LEG-05'],
  },
  {
    nummer: 'V-08',
    bezeichnung: 'Dokumente und Archiv',
    modul: 'dokument',
    zweck: 'Ablage von Verträgen, Belegen und Nachweisen in privaten Buckets, '
      + 'Aufbewahrung je Klasse, unveränderliches Archiv nach GoBD',
    betroffene: ['beschaeftigte', 'kundenkontakte', 'lieferantenkontakte'],
    daten: ['Dokument mit Kategorie, Entstehungsdatum und Bezug', 'Wer es hochgeladen und wer es gelesen hat'],
    besondereKategorien: null,
    fristQuelle: { art: 'dokumentklasse', kategorie: 'vertrag' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['DOC-01', 'DOC-03', 'LEG-01'],
  },
  {
    nummer: 'V-09',
    bezeichnung: 'Objektbetrieb: Wachbuch, Leistungsnachweise, Bautagebuch',
    modul: 'objekt',
    zweck: 'Festhalten, was auf einem Objekt geschah — mit Serverzeit und '
      + 'unveränderlich, weil es im Streit vorgelegt wird',
    betroffene: ['beschaeftigte', 'kundenkontakte'],
    daten: [
      'Eintrag mit Zeitpunkt, Objekt, Art und Text',
      'Unterschrift der abnehmenden Person, wo eine verlangt ist',
      'Fotos, wo sie zum Eintrag gehören',
    ],
    besondereKategorien: null,
    fristQuelle: { art: 'gesetz', text: 'Unveränderlich; Löschung nur über das Löschkonzept' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['SEC-05', 'CLN-04', 'BAU-05', 'LEG-01'],
  },
  {
    nummer: 'V-10',
    bezeichnung: 'Konten, Anmeldung und Protokoll',
    modul: 'system',
    zweck: 'Anmeldung mit zweitem Faktor für verwaltende Rollen, Rechtevergabe je '
      + 'Gesellschaft, Protokoll sicherheitsrelevanter Vorgänge',
    betroffene: ['nutzende'],
    daten: [
      'Konto: E-Mail, Name, Rolle je Gesellschaft, Faktoren',
      'Protokoll: wer wann was getan hat, mit Kennung des Vorgangs',
    ],
    besondereKategorien: null,
    fristQuelle: { art: 'offen', frage: 'O-514' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['AUT-01', 'AUT-02', 'SEC-A5'],
  },
  {
    nummer: 'V-11',
    bezeichnung: 'Agentenläufe',
    modul: 'agent',
    zweck: 'Lesen, Zuordnen und Entwerfen durch Sprachmodelle — jeder Vorschlag '
      + 'geht durch eine menschliche Freigabe, und gerechnet wird nie (Invariante 6)',
    betroffene: ['beschaeftigte', 'bewerbende', 'kundenkontakte'],
    daten: ['Nur die Textausschnitte der jeweiligen Aufgabe', 'Lauf, Werkzeuge, Kosten und Ergebnis'],
    besondereKategorien: null,
    fristQuelle: { art: 'offen', frage: 'O-514' },
    empfaenger: ['supabase', 'vercel', 'openai'],
    spec: ['AGT-01', 'AGT-02', 'APR-01'],
  },
  {
    nummer: 'V-12',
    bezeichnung: 'Betroffenenrechte',
    modul: 'datenschutz',
    zweck: 'Entgegennehmen und Bearbeiten von Anfragen nach Art. 15 bis 21 mit '
      + 'der Monatsfrist des Art. 12 Abs. 3',
    betroffene: ['beschaeftigte', 'bewerbende', 'kundenkontakte', 'interessenten', 'nutzende'],
    daten: ['Die Anfrage selbst, die Zuordnung zur Person, die Entscheidung mit Begründung'],
    besondereKategorien: null,
    fristQuelle: { art: 'offen', frage: 'O-514' },
    empfaenger: ['supabase', 'vercel'],
    spec: ['LEG-09'],
  },
];

/** Eine Tätigkeit über ihre Nummer — für Verweise aus anderen Registern. */
export function verarbeitung(nummer: string): Verarbeitung | undefined {
  return VERARBEITUNGEN.find((v) => v.nummer === nummer);
}
