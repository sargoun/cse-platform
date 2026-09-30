/**
 * Was die Verwaltung mit einem LAUFENDEN Zeiteintrag tut — in beiden Sprachen
 * (V-064, TIM-11, D-82, D-592).
 *
 * **Ein Begriff bleibt deutsch, und es ist der wichtigste hier:**
 * `Nacherfassung` — das nachträgliche Eintragen einer Arbeitszeit durch einen
 * anderen Menschen als den, der sie geleistet hat. „Manual entry" trifft es
 * nicht: das Wort steht so in `erfassungs_art`, in jedem Prüfbericht und in
 * der Dienstanweisung. Im englischen Text steht deshalb
 * `Nacherfassung (an entry recorded afterwards by someone else)`.
 *
 * **Die Sätze über die Begründungspflicht sind KEIN Kleingedrucktes.** Was
 * hier entsteht, ist eine Behauptung der Verwaltung über die Arbeitszeit
 * eines anderen Menschen (Invariante 5). Wer das Formular ausfüllt, soll es
 * gelesen haben — deshalb steht es am Feld und nicht in einer Fussnote.
 */
import type { InternSprache } from '../intern.js';
import type { LaufendGrund } from '../../../server/services/zeit/laufender-eintrag.js';
import type { NacherfassungGrund } from '../../../server/services/zeit/nacherfassung.js';

export interface LaufendTexte {
  readonly aufklappen: string;
  readonly feierabend: string;
  readonly pause: string;
  readonly pauseLeer: string;
  readonly begruendung: string;
  readonly begruendungBeispiel: string;
  /** `{n}` = Mindestlänge, `{person}` = wessen Zeit gesetzt wird. */
  readonly begruendungErklaerung: string;
  readonly schliessen: string;
  readonly stornogrund: string;
  readonly stornogrundBeispiel: string;
  readonly stornoErklaerung: string;
  readonly stornieren: string;
  readonly ohneRecht: string;
}

export const LAUFEND_TEXTE: Readonly<Record<InternSprache, LaufendTexte>> = {
  de: {
    aufklappen: 'Feierabend eintragen oder stornieren',
    feierabend: 'Feierabend (Berliner Zeit)',
    pause: 'Pause in Minuten',
    pauseLeer: '(leer = unverändert)',
    begruendung: 'Begründung',
    begruendungBeispiel: 'z. B. Ausstempeln vergessen, Ende laut Objektleitung',
    begruendungErklaerung:
      'Mindestens {n} Zeichen. Eingetragen wird eine Behauptung der Verwaltung '
      + 'über die Arbeitszeit von {person} — sie wird als solche gespeichert '
      + 'und bleibt als solche erkennbar.',
    schliessen: 'Eintrag schliessen',
    stornogrund: 'Stornogrund',
    stornogrundBeispiel: 'z. B. versehentlich eingestempelt, Dienst nicht angetreten',
    stornoErklaerung:
      'Stornieren löscht nichts — die Zeile bleibt mit Grund und Zeitstempel '
      + 'stehen. Sie zählt danach aber in keiner Stunde mehr.',
    stornieren: 'Eintrag stornieren',
    ohneRecht:
      'Zum Schliessen oder Stornieren eines laufenden Eintrags fehlt Ihnen das '
      + 'Recht. Ein vergessener Feierabend bleibt sonst stehen — und solange er '
      + 'steht, kann dieselbe Person nicht wieder einstempeln.',
  },
  en: {
    aufklappen: 'Record the end of the shift, or cancel',
    feierabend: 'End of shift (Berlin time)',
    pause: 'Break in minutes',
    pauseLeer: '(empty = unchanged)',
    begruendung: 'Reason',
    begruendungBeispiel: 'e.g. forgot to clock out, end time per site manager',
    begruendungErklaerung:
      'At least {n} characters. What you record is an assertion by the office '
      + 'about {person}’s working time — it is stored as such and stays '
      + 'recognisable as such (a Nacherfassung: an entry recorded afterwards by '
      + 'someone else).',
    schliessen: 'Close entry',
    stornogrund: 'Reason for cancelling',
    stornogrundBeispiel: 'e.g. clocked in by mistake, shift not started',
    stornoErklaerung:
      'Cancelling deletes nothing — the row stays, with reason and timestamp. '
      + 'It simply no longer counts towards any hours.',
    stornieren: 'Cancel entry',
    ohneRecht:
      'Closing or cancelling a running entry requires a right you do not hold. '
      + 'A forgotten end of shift otherwise stays open — and while it does, the '
      + 'same person cannot clock in again.',
  },
};

/**
 * Warum ein laufender Eintrag nicht geschlossen oder storniert wurde — als
 * SATZ, nachgeschlagen nach dem GRUND, den `POST /api/zeit/laufend` als
 * `?fehler=` zurückschickt (V-275, D-773, D-769).
 *
 * Bis dahin reiste der deutsche Satz des Dienstes als `?meldung=` mit und
 * stand roh auf dem Live-Brett — bei `nicht_gefunden` mit der vollen Kennung
 * des Eintrags, und jeder präparierte Link schrieb seine eigene Warnung. Die
 * Seite schlägt jetzt nur als eigenen Eintrag nach (D-728); ein Grund, den
 * die Tabelle nicht kennt, bekommt `sonst`, nie den Schlüssel und nie Text
 * aus der Adresse. Die Sprache ist die der Sitzung wie beim Formular darüber
 * (`LAUFEND_TEXTE`), auch wenn die Seite selbst noch auf der Ausnahmeliste
 * steht (wie D-753).
 *
 * **`nicht_gefunden` nennt den häufigen Fall:** der Eintrag läuft nicht mehr,
 * weil jemand anders ihn inzwischen geschlossen oder storniert hat — der
 * Dienst ändert nur Einträge, die noch laufen.
 */
export interface LaufendFehlerTexte {
  /** Die fett gesetzten ersten Worte des Kastens (DESIGN §5 „Notices"). */
  readonly titel: string;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly sonst: string;
  readonly fehler: Readonly<Record<LaufendGrund, string>>;
}

export const LAUFEND_FEHLER_TEXTE: Readonly<Record<InternSprache, LaufendFehlerTexte>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: 'Der Eintrag wurde nicht geändert. Prüfen Sie die Angaben und versuchen Sie es '
      + 'noch einmal.',
    fehler: {
      nicht_gefunden:
        'Dieser Eintrag läuft nicht mehr — jemand hat ihn inzwischen geschlossen oder '
        + 'storniert, oder es gibt ihn in dieser Gesellschaft nicht. Die Seite zeigt den '
        + 'aktuellen Stand.',
      ende_fehlt: 'Ohne Feierabendzeit lässt sich der Eintrag nicht schliessen.',
      pause_ungueltig: 'Die Pause ist eine ganze Zahl von Minuten, mindestens null.',
      begruendung_zu_kurz:
        'Eine gesetzte Arbeitszeit braucht eine Begründung. Im Streitfall steht sonst da, '
        + 'dass jemand eine Zahl eingetragen hat.',
      fenster_ungueltig:
        'Das Ende liegt vor dem Beginn oder auf ihm. Eine Nachtschicht endet am Folgetag — '
        + 'dann gehört der nächste Tag in das Feld.',
      ende_in_zukunft:
        'Das Ende liegt in der Zukunft. Ein Feierabend, der noch nicht war, lässt sich '
        + 'nicht nacherfassen.',
      grund_zu_kurz:
        'Eine Stornierung braucht einen Grund — sie ist der Vorgang, mit dem erfasste '
        + 'Arbeitszeit verschwindet.',
    },
  },
  en: {
    titel: 'Not saved.',
    sonst: 'The entry was not changed. Check the details and try again.',
    fehler: {
      nicht_gefunden:
        'This entry is no longer running — someone has closed or cancelled it in the '
        + 'meantime, or it does not exist in this Gesellschaft (legal entity). The page '
        + 'shows the current state.',
      ende_fehlt: 'Without an end time the entry cannot be closed.',
      pause_ungueltig: 'The break is a whole number of minutes, zero or more.',
      begruendung_zu_kurz:
        'A working time set by the office needs a reason. Otherwise, in a dispute, all the '
        + 'record shows is that someone typed in a number.',
      fenster_ungueltig:
        'The end is before the start or equal to it. A night shift ends on the following '
        + 'day — then the next date belongs in the field.',
      ende_in_zukunft:
        'The end lies in the future. An end of shift that has not happened yet cannot be '
        + 'recorded afterwards.',
      grund_zu_kurz:
        'Cancelling needs a reason — it is the step by which recorded working time '
        + 'disappears.',
    },
  },
};

/**
 * Warum eine Arbeitszeit nicht nacherfasst wurde — der Satz zum GRUND, den
 * `POST /api/zeit/nacherfassung` als `?fehler=` zurückschickt (V-275, D-773,
 * D-769).
 *
 * **Nur deutsch, in derselben Form wie die zweisprachigen Tabellen:**
 * `/zeiten/nacherfassung` steht noch auf der Ausnahmeliste der
 * Übersetzungswache und ist fest deutsch; stellt jemand sie um, kommt hier
 * nur `en` dazu. Die Seite schlägt nur als eigenen Eintrag nach (D-728), ein
 * unbekannter Grund bekommt `sonst`.
 *
 * Die Sätze nennen kein Recht als Schlüssel (D-741) und keine Kennung; die
 * Beschäftigung, um die es ging, steht im Formular darüber.
 */
export interface NacherfassungFehlerTexte {
  readonly titel: string;
  readonly sonst: string;
  readonly fehler: Readonly<Record<NacherfassungGrund, string>>;
}

export const NACHERFASSUNG_FEHLER_TEXTE: Readonly<Record<'de', NacherfassungFehlerTexte>> = {
  de: {
    titel: 'Nicht nacherfasst.',
    sonst: 'Es wurde keine Zeit eingetragen. Prüfen Sie die Angaben und versuchen Sie es '
      + 'noch einmal.',
    fehler: {
      begruendung_zu_kurz:
        'Eine nacherfasste Arbeitszeit braucht eine Begründung. Im Lohnstreit steht sonst '
        + 'da, dass jemand eine Zahl eingetragen hat.',
      fenster_ungueltig:
        'Das Ende liegt vor dem Beginn oder auf ihm. Eine Nachtschicht endet am Folgetag — '
        + 'dann gehört der nächste Tag in das Feld.',
      pause_ungueltig: 'Die Pause ist eine ganze Zahl von Minuten, mindestens null.',
      kein_nacherfassungsrecht:
        'Eine Arbeitszeit nachträglich einzutragen ist eine Entscheidung über die Zeit eines '
        + 'anderen Menschen. Dafür fehlt Ihrem Konto das Recht, Nacherfassungen zu prüfen.',
      beginn_in_zukunft:
        'Der Beginn liegt in der Zukunft. Nacherfasst wird, was gearbeitet wurde.',
      nicht_selbst:
        'Das ist Ihre eigene Arbeitszeit. Niemand erfasst die eigene Aufzeichnung nach: Sie '
        + 'melden eine Abweichung, eine andere Person entscheidet darüber.',
      nicht_angelegt:
        'Diese Beschäftigung gibt es in dieser Gesellschaft nicht, oder Ihrem Konto fehlt das '
        + 'Recht, Zeiten zu erfassen. Es wurde nichts eingetragen.',
    },
  },
};

/** `{n}` und `{person}` einsetzen — kein Formatierer, nur zwei Platzhalter. */
export function mitWerten(
  vorlage: string, werte: Readonly<Record<string, string>>,
): string {
  return Object.entries(werte).reduce(
    (text, [schluessel, wert]) => text.split(`{${schluessel}}`).join(wert), vorlage);
}
