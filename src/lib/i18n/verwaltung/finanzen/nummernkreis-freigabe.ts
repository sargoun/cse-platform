/**
 * Einen Platzhalterkreis freigeben — das Formular „Maske festlegen und
 * freigeben" in beiden Sprachen (FIN-03, V-284, O-134, O-352, D-779, D-848,
 * D-592).
 *
 * **`Nummernkreis` bleibt im englischen Text stehen** (D-592): es ist der
 * Name des Registers, dessen Lückenlosigkeit § 14 UStG verlangt.
 */
import type { InternSprache } from '../../intern.js';
import type {
  FreigabeGrund, MaskenMangel, Ruecksetzung,
} from '../../../../server/services/finanz/nummernkreis-freigabe.js';

export interface FreigabeTexte {
  readonly abschnittTitel: string;
  readonly titel: (bezeichnung: string) => string;
  readonly erklaerung: string;
  readonly voreinstellung: string;
  readonly feldMaske: string;
  readonly maskeHilfe: string;
  readonly feldRuecksetzung: string;
  readonly ruecksetzung: Readonly<Record<Ruecksetzung, string>>;
  readonly feldBezeichnung: string;
  readonly ersteNummer: string;
  readonly ersteNummerHinweis: string;
  readonly keineVorschau: string;
  readonly bestaetigen: string;
  readonly freigeben: string;
  readonly ohneRechtVor: string;
  readonly ohneRechtNach: string;
  readonly erfolg: (bezeichnung: string, ersteNummer: string) => string;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<FreigabeGrund, string>>;
  readonly mangel: Readonly<Record<MaskenMangel, string>>;
  readonly fehlerUnbekannt: string;
}

export const FREIGABE_TEXTE: Readonly<Record<InternSprache, FreigabeTexte>> = {
  de: {
    abschnittTitel: 'Freigabe',
    titel: (b) => `${b}: Maske festlegen und freigeben`,
    erklaerung: 'Dieser Kreis ist ein Platzhalter: er vergibt keine Nummer, und in ihm wird '
      + 'nichts festgeschrieben. Nach der Freigabe zählt er ab 1; Maske und Rücksetzung lassen '
      + 'sich nach der ersten Nummer nicht mehr ändern (§ 14 UStG: fortlaufend, einmalig).',
    voreinstellung: 'Voreinstellung (O-134, D-779): ein Kreis je Gesellschaft und Belegart, '
      + 'Neustart am 1. Januar. Bestätigen Sie sie, oder passen Sie Maske und Rücksetzung an.',
    feldMaske: 'Maske',
    maskeHilfe: '{jahr} setzt das Jahr ein, {nr:5} die laufende Nummer mit fünf Stellen; sonst '
      + 'Buchstaben, Ziffern und - / _ . — höchstens 40 Zeichen.',
    feldRuecksetzung: 'Rücksetzung',
    ruecksetzung: {
      jaehrlich: 'Am 1. Januar neu bei 1 — die Maske braucht {jahr}',
      nie: 'Fortlaufend, ohne Neustart — die Maske ohne {jahr}',
    },
    feldBezeichnung: 'Bezeichnung',
    ersteNummer: 'Erste Nummer',
    ersteNummerHinweis: 'mit der Maske, wie sie im Formular steht',
    keineVorschau: '— (die Maske taugt so nicht)',
    bestaetigen: 'Ich habe Maske und Rücksetzung geprüft; nach der ersten Nummer lassen sie '
      + 'sich nicht mehr ändern.',
    freigeben: 'Kreis freigeben',
    ohneRechtVor: 'Freigeben kann, wer',
    ohneRechtNach: 'hält.',
    erfolg: (b, n) => `Der Kreis „${b}" ist freigegeben; die erste Nummer lautet ${n}.`,
    abgewiesen: 'Nichts wurde geändert.',
    fehler: {
      nicht_gefunden: 'Diesen Nummernkreis gibt es hier nicht.',
      geschlossen: 'Dieser Kreis ist geschlossen.',
      schon_freigegeben: 'Dieser Kreis ist schon freigegeben.',
      maske_unbestaetigt: 'Bitte bestätigen Sie Maske und Rücksetzung.',
      maske_ungueltig: 'Die Maske taugt so nicht.',
      ruecksetzung_ungueltig: 'Bitte wählen Sie die Rücksetzung: am 1. Januar oder nie.',
      bezeichnung_fehlt: 'Die Bezeichnung fehlt oder ist länger als 120 Zeichen.',
      bezeichnung_vorbehalt: 'Die Bezeichnung nennt einen Vorbehalt (Platzhalter, unbestätigt, '
        + 'zur Freigabe, Demo, O-134), den der freigegebene Kreis nicht mehr hat.',
      schon_vorhanden: 'Für dieses Jahr gibt es schon einen Kreis dieses Geltungsbereichs.',
      kein_recht: 'Frei gibt, wer das Recht zur Verwaltung der Nummernkreise hält.',
    },
    mangel: {
      leer: 'Die Maske ist leer.',
      zu_lang: 'Die Maske ist länger als 40 Zeichen.',
      nr_fehlt: 'Die Maske enthält kein {nr} — jede Nummer wäre dieselbe.',
      nr_breite: 'Die Breite in {nr:…} ist eine Ziffer von 1 bis 9.',
      nr_mehrfach: 'Die Maske enthält {nr} mehr als einmal.',
      jahr_fehlt: 'Wer am 1. Januar neu beginnt, braucht {jahr} in der Maske — sonst kehrte jede '
        + 'Nummer im nächsten Jahr wieder.',
      jahr_ohne_ruecksetzung: 'Ein fortlaufender Kreis hat kein Jahr: {jahr} gehört nicht in '
        + 'seine Maske.',
      zeichen: 'Die Maske enthält ein Zeichen ausser Buchstaben, Ziffern, - / _ . und den '
        + 'Platzhaltern {jahr}, {nr} bis {nr:9}.',
    },
    fehlerUnbekannt: 'Die Freigabe wurde abgewiesen.',
  },
  en: {
    abschnittTitel: 'Release',
    titel: (b) => `${b}: set the mask and release`,
    erklaerung: 'This Nummernkreis is a placeholder: it issues no number, and nothing is '
      + 'finalised in it. Once released it counts from 1; mask and reset cannot be changed '
      + 'after the first number (§ 14 UStG: sequential, unique).',
    voreinstellung: 'Default (O-134, D-779): one Nummernkreis per company and document type, '
      + 'restart on 1 January. Confirm it, or adjust mask and reset.',
    feldMaske: 'Mask',
    maskeHilfe: '{jahr} inserts the year, {nr:5} the running number with five digits; '
      + 'otherwise letters, digits and - / _ . — at most 40 characters.',
    feldRuecksetzung: 'Reset',
    ruecksetzung: {
      jaehrlich: 'Restart at 1 on 1 January — the mask needs {jahr}',
      nie: 'Continuous, no restart — the mask without {jahr}',
    },
    feldBezeichnung: 'Label',
    ersteNummer: 'First number',
    ersteNummerHinweis: 'with the mask as it stands in the form',
    keineVorschau: '— (the mask does not work like this)',
    bestaetigen: 'I have checked mask and reset; they cannot be changed after the first number.',
    freigeben: 'Release Nummernkreis',
    ohneRechtVor: 'Whoever holds',
    ohneRechtNach: 'may release it.',
    erfolg: (b, n) => `The Nummernkreis "${b}" is released; its first number is ${n}.`,
    abgewiesen: 'Nothing was changed.',
    fehler: {
      nicht_gefunden: 'This Nummernkreis does not exist here.',
      geschlossen: 'This Nummernkreis is closed.',
      schon_freigegeben: 'This Nummernkreis is already released.',
      maske_unbestaetigt: 'Please confirm mask and reset.',
      maske_ungueltig: 'The mask does not work like this.',
      ruecksetzung_ungueltig: 'Please choose the reset: on 1 January or never.',
      bezeichnung_fehlt: 'The label is missing or longer than 120 characters.',
      bezeichnung_vorbehalt: 'The label names a reservation (placeholder, unconfirmed, for '
        + 'release, demo, O-134) the released Nummernkreis no longer has.',
      schon_vorhanden: 'A Nummernkreis of this scope already exists for this year.',
      kein_recht: 'Releasing is for whoever holds the right to manage Nummernkreise.',
    },
    mangel: {
      leer: 'The mask is empty.',
      zu_lang: 'The mask is longer than 40 characters.',
      nr_fehlt: 'The mask contains no {nr} — every number would be the same.',
      nr_breite: 'The width in {nr:…} is one digit from 1 to 9.',
      nr_mehrfach: 'The mask contains {nr} more than once.',
      jahr_fehlt: 'Restarting on 1 January needs {jahr} in the mask — otherwise every number '
        + 'would recur next year.',
      jahr_ohne_ruecksetzung: 'A continuous Nummernkreis has no year: {jahr} does not belong in '
        + 'its mask.',
      zeichen: 'The mask contains a character other than letters, digits, - / _ . and the '
        + 'placeholders {jahr}, {nr} to {nr:9}.',
    },
    fehlerUnbekannt: 'The release was refused.',
  },
};
