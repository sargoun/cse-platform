/**
 * Der Jahreswechsel eines Nummernkreises — das Formular „Nachfolgekreis
 * eröffnen" in beiden Sprachen (FIN-03, V-284, O-352, D-848, D-592).
 *
 * **`Nummernkreis` bleibt im englischen Text stehen** (D-592): es ist der
 * Name des Registers, dessen Lückenlosigkeit § 14 UStG verlangt; erklärt
 * wird in Klammern.
 */
import type { InternSprache } from '../../intern.js';
import type { WechselGrund } from '../../../../server/services/finanz/nummernkreis-wechsel.js';

export interface WechselTexte {
  readonly faelligTitel: (bezeichnung: string, jahr: number) => string;
  readonly faelligErklaerung: (altJahr: number) => string;
  readonly ersteNummer: string;
  readonly kette: string;
  readonly maskeBestaetigen: (maske: string) => string;
  readonly eroeffnen: (jahr: number) => string;
  readonly ohneRechtVor: string;
  readonly ohneRechtNach: string;
  readonly keinerFaellig: string;
  readonly laeuftHinweis: (jahr: number) => string;
  readonly erfolg: (jahr: string) => string;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<WechselGrund, string>>;
  readonly fehlerUnbekannt: string;
}

export const WECHSEL_TEXTE: Readonly<Record<InternSprache, WechselTexte>> = {
  de: {
    faelligTitel: (b, j) => `${b}: Nachfolgekreis für ${String(j)} eröffnen`,
    faelligErklaerung: (alt) => `Das Jahr ${String(alt)} ist vergangen. Bis der Nachfolger `
      + 'eröffnet ist, wird in diesem Kreis nichts festgeschrieben. Eröffnen schliesst den '
      + 'Vorgänger mit dem heutigen Tag, beginnt den Nachfolger bei 1 und setzt seine Kette auf '
      + 'das letzte Glied des Vorgängers — in einer Transaktion, protokolliert.',
    ersteNummer: 'Erste Nummer des neuen Jahres',
    kette: 'Die Kette beginnt mit',
    maskeBestaetigen: (maske) => `Ich habe die Maske „${maske}" geprüft; sie gilt für jede `
      + 'Nummer des neuen Jahres und lässt sich nach der ersten Vergabe nicht mehr ändern.',
    eroeffnen: (j) => `Nachfolgekreis ${String(j)} eröffnen`,
    ohneRechtVor: 'Eröffnen kann, wer',
    ohneRechtNach: 'hält.',
    keinerFaellig: 'Kein Kreis wartet auf seinen Jahreswechsel.',
    laeuftHinweis: (j) => `Kreise mit jährlicher Rücksetzung bekommen ihren Nachfolger, sobald `
      + `das Jahr ${String(j)} vergangen ist — dann steht hier der Knopf.`,
    erfolg: (j) => `Der Nachfolgekreis für ${j} ist eröffnet; der Vorgänger ist geschlossen.`,
    abgewiesen: 'Nichts wurde geändert.',
    fehler: {
      nicht_gefunden: 'Diesen Nummernkreis gibt es hier nicht.',
      geschlossen: 'Dieser Kreis ist schon geschlossen — sein Nachfolger steht in der Liste.',
      platzhalter: 'Ein Platzhalterkreis hat nichts vergeben und braucht keinen Nachfolger — '
        + 'seine Freigabe setzt ihn ins laufende Jahr.',
      fortlaufend: 'Ein fortlaufender Kreis hat keinen Jahreswechsel.',
      laeuft_noch: 'Das Jahr dieses Kreises läuft noch; geschlossen wird er erst danach.',
      maske_unbestaetigt: 'Bitte bestätigen Sie die Maske — sie gilt für jede Nummer des Jahres.',
      schon_vorhanden: 'Für das neue Jahr gibt es schon einen Kreis dieses Geltungsbereichs.',
      kein_recht: 'Den Nachfolgekreis eröffnet, wer das Recht zur Verwaltung der Nummernkreise hält.',
    },
    fehlerUnbekannt: 'Der Jahreswechsel wurde abgewiesen.',
  },
  en: {
    faelligTitel: (b, j) => `${b}: open the successor for ${String(j)}`,
    faelligErklaerung: (alt) => `The year ${String(alt)} has ended. Until the successor is `
      + 'open, nothing is finalised in this Nummernkreis. Opening closes the predecessor as of '
      + 'today, starts the successor at 1 and links its chain to the predecessor\'s last link — '
      + 'in one transaction, logged.',
    ersteNummer: 'First number of the new year',
    kette: 'The chain starts with',
    maskeBestaetigen: (maske) => `I have checked the mask "${maske}"; it applies to every `
      + 'number of the new year and cannot be changed after the first number is issued.',
    eroeffnen: (j) => `Open successor ${String(j)}`,
    ohneRechtVor: 'Whoever holds',
    ohneRechtNach: 'may open it.',
    keinerFaellig: 'No Nummernkreis is waiting for its turn of the year.',
    laeuftHinweis: (j) => `Nummernkreise with a yearly reset get their successor once the year `
      + `${String(j)} has ended — the button appears here then.`,
    erfolg: (j) => `The successor for ${j} is open; the predecessor is closed.`,
    abgewiesen: 'Nothing was changed.',
    fehler: {
      nicht_gefunden: 'This Nummernkreis does not exist here.',
      geschlossen: 'This Nummernkreis is already closed — its successor is in the list.',
      platzhalter: 'A placeholder Nummernkreis has issued nothing and needs no successor — '
        + 'releasing it moves it into the current year.',
      fortlaufend: 'A continuous Nummernkreis has no turn of the year.',
      laeuft_noch: 'This Nummernkreis\'s year is still running; it is closed only afterwards.',
      maske_unbestaetigt: 'Please confirm the mask — it applies to every number of the year.',
      schon_vorhanden: 'A Nummernkreis of this scope already exists for the new year.',
      kein_recht: 'The successor is opened by whoever holds the right to manage Nummernkreise.',
    },
    fehlerUnbekannt: 'The turn of the year was refused.',
  },
};
