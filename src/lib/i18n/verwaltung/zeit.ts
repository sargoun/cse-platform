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

/** `{n}` und `{person}` einsetzen — kein Formatierer, nur zwei Platzhalter. */
export function mitWerten(
  vorlage: string, werte: Readonly<Record<string, string>>,
): string {
  return Object.entries(werte).reduce(
    (text, [schluessel, wert]) => text.split(`{${schluessel}}`).join(wert), vorlage);
}
