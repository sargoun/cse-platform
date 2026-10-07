/**
 * Die Wörter des Zeichnungsvermerks der Verfahrensdokumentation — in beiden
 * Sprachen (V-316, O-188, D-837).
 *
 * Die Seite der Verfahrensdokumentation selbst steht noch auf der
 * Ausnahmeliste der Übersetzungswache; dieser Abschnitt ist neu und wird
 * deshalb zweisprachig gebaut (`scripts/guards/uebersetzung-ausnahmen.ts`).
 *
 * „Verfahrensdokumentation", „Schemastand" und „GoBD" bleiben auch englisch
 * stehen: sie sind Begriffe mit Rechtsbedeutung, keine Oberfläche.
 */
import type { InternSprache } from '../intern.js';

export interface ZeichnungTexte {
  readonly titel: string;
  readonly erklaerung: string;
  readonly ungezeichnet: string;
  readonly schemastandGewechselt: (gezeichnet: string) => string;
  readonly schemastandUnbekannt: string;
  readonly turnusAbgelaufen: (seit: string) => string;
  readonly inhaltGeaendert: (faellig: string) => string;
  readonly aktuell: (faellig: string) => string;
  readonly verlauf: string;
  readonly verlaufLeer: string;
  readonly spalteAm: string;
  readonly spalteVon: string;
  readonly spalteFunktion: string;
  readonly spalteSchemastand: string;
  readonly spalteHash: string;
  readonly spalteBemerkung: string;
  readonly unbekannt: string;
  readonly dieseFassung: string;
  readonly formular: string;
  readonly formularErklaerung: string;
  readonly funktion: string;
  readonly funktionHinweis: string;
  readonly bemerkung: string;
  readonly freiwillig: string;
  readonly zeichnen: string;
  readonly zeichnenRechtVor: string;
  readonly zeichnenRechtNach: string;
  readonly gezeichnet: string;
  readonly fehler: Readonly<Record<string, string>>;
  /** Für einen Grund, den die Seite nicht kennt — nie der Grund selbst (V-250). */
  readonly fehlerSonst: string;
  readonly voreinstellung: string;
}

export const ZEICHNUNG_TEXTE: Readonly<Record<InternSprache, ZeichnungTexte>> = {
  de: {
    titel: 'Prüfung und Zeichnung',
    erklaerung:
      'Die Geschäftsführung prüft diese Dokumentation und zeichnet sie — jährlich und bei '
      + 'jedem neuen Schemastand. Gezeichnet wird die Fassung, die beim Zeichnen entsteht: der '
      + 'Hash und der Schemastand oben auf dieser Seite. Wer zeichnet und wann, hält die '
      + 'Datenbank fest; eine Zeichnung lässt sich weder ändern noch löschen.',
    ungezeichnet: 'Diese Dokumentation ist noch nicht gezeichnet.',
    schemastandGewechselt: (gezeichnet) =>
      `Seit der letzten Zeichnung hat sich der Schemastand geändert (gezeichnet: ${gezeichnet}). `
      + 'Die Dokumentation ist neu zu prüfen und zu zeichnen.',
    schemastandUnbekannt: 'nicht ablesbar',
    turnusAbgelaufen: (seit) => `Die jährliche Prüfung ist seit dem ${seit} fällig.`,
    inhaltGeaendert: (faellig) =>
      'Gezeichnet ist eine frühere Fassung desselben Schemastands — Konfiguration oder '
      + 'ausgelieferter Code haben sich seither geändert. Ob ein Verfahren betroffen ist, klärt '
      + `die Prüfung; fällig wird sie spätestens am ${faellig}.`,
    aktuell: (faellig) =>
      `Diese Fassung ist gezeichnet. Die nächste Prüfung ist am ${faellig} fällig.`,
    verlauf: 'Bisherige Zeichnungen',
    verlaufLeer: 'Noch keine Zeichnung.',
    spalteAm: 'Gezeichnet am',
    spalteVon: 'Von',
    spalteFunktion: 'Funktion',
    spalteSchemastand: 'Schemastand',
    spalteHash: 'SHA-256 (Anfang)',
    spalteBemerkung: 'Bemerkung',
    unbekannt: '—',
    dieseFassung: 'diese Fassung',
    formular: 'Diese Fassung zeichnen',
    formularErklaerung:
      'Mit dem Zeichnen bestätigen Sie, dass Sie die Dokumentation in dieser Fassung geprüft '
      + 'haben. Hash und Schemastand stellt der Server fest, nicht dieses Formular.',
    funktion: 'Ihre Funktion',
    funktionHinweis: 'Zum Beispiel „Geschäftsführung" oder „Prokura".',
    bemerkung: 'Bemerkung',
    freiwillig: '(freiwillig)',
    zeichnen: 'Geprüft — jetzt zeichnen',
    zeichnenRechtVor: 'Zeichnen kann, wer',
    zeichnenRechtNach: 'hält.',
    gezeichnet: 'Gezeichnet. Die Zeichnung steht unten im Verlauf und im Prüfprotokoll.',
    fehler: {
      fassung_geaendert:
        'Die Dokumentation hat sich geändert, seit Sie diese Seite geöffnet haben — gezeichnet '
        + 'wurde nichts. Bitte die Fassung oben prüfen und dann zeichnen.',
      funktion_fehlt: 'Die Funktion fehlt — etwa „Geschäftsführung".',
      funktion_zu_lang: 'Die Funktion ist länger als 200 Zeichen.',
      bemerkung_zu_lang: 'Die Bemerkung ist länger als 2000 Zeichen.',
      wirtschaftsjahr:
        'Die Dokumentation ließ sich nicht erzeugen — das Wirtschaftsjahr ist nicht lesbar '
        + 'eingestellt. Gezeichnet wurde nichts.',
    },
    fehlerSonst: 'Die Zeichnung ließ sich nicht speichern.',
    voreinstellung:
      'Voreinstellung (O-188): die Geschäftsführung zeichnet; geprüft wird jährlich und bei jedem '
      + 'Wechsel des Schemastands.',
  },
  en: {
    titel: 'Review and sign-off',
    erklaerung:
      'Management reviews this Verfahrensdokumentation and signs it off — once a year and with '
      + 'every new Schemastand. What is signed is the version that exists at the moment of '
      + 'signing: the hash and the Schemastand at the top of this page. The database records who '
      + 'signed and when; a sign-off can be neither changed nor deleted.',
    ungezeichnet: 'This documentation has not been signed off yet.',
    schemastandGewechselt: (gezeichnet) =>
      `The Schemastand has changed since the last sign-off (signed: ${gezeichnet}). `
      + 'The documentation needs a new review and sign-off.',
    schemastandUnbekannt: 'not readable',
    turnusAbgelaufen: (seit) => `The annual review has been due since ${seit}.`,
    inhaltGeaendert: (faellig) =>
      'An earlier version with the same Schemastand was signed — configuration or deployed code '
      + 'have changed since. The review decides whether a procedure is affected; it is due by '
      + `${faellig} at the latest.`,
    aktuell: (faellig) =>
      `This version is signed off. The next review is due on ${faellig}.`,
    verlauf: 'Previous sign-offs',
    verlaufLeer: 'No sign-off yet.',
    spalteAm: 'Signed on',
    spalteVon: 'By',
    spalteFunktion: 'Position',
    spalteSchemastand: 'Schemastand',
    spalteHash: 'SHA-256 (start)',
    spalteBemerkung: 'Remark',
    unbekannt: '—',
    dieseFassung: 'this version',
    formular: 'Sign off this version',
    formularErklaerung:
      'By signing you confirm that you have reviewed the documentation in this version. The '
      + 'server determines hash and Schemastand, not this form.',
    funktion: 'Your position',
    funktionHinweis: 'For example “Managing director” or “Authorised officer”.',
    bemerkung: 'Remark',
    freiwillig: '(optional)',
    zeichnen: 'Reviewed — sign off now',
    zeichnenRechtVor: 'Whoever holds',
    zeichnenRechtNach: 'may sign off.',
    gezeichnet: 'Signed off. The sign-off is listed below and in the audit log.',
    fehler: {
      fassung_geaendert:
        'The documentation has changed since you opened this page — nothing was signed. Please '
        + 'review the version above, then sign off.',
      funktion_fehlt: 'The position is missing — for example “Managing director”.',
      funktion_zu_lang: 'The position is longer than 200 characters.',
      bemerkung_zu_lang: 'The remark is longer than 2000 characters.',
      wirtschaftsjahr:
        'The documentation could not be generated — the financial year setting is not readable. '
        + 'Nothing was signed.',
    },
    fehlerSonst: 'The sign-off could not be saved.',
    voreinstellung:
      'Default (O-188): management signs off; the review is annual and with every change of '
      + 'Schemastand.',
  },
};
