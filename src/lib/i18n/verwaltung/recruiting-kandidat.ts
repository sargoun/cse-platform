/**
 * Die Wörter des Kandidatendatensatzes und der Postfach-Erfassung — in
 * beiden Sprachen (REC-03, REC-04, V-223, V-224, D-717, D-718, D-592).
 *
 * `/recruiting/bewerbungen/neu` ist neu und ganz zweisprachig; auf dem
 * Bewerbungsblatt (noch auf der Ausnahmeliste der Übersetzungswache) kommt
 * nur der neue Abschnitt zweisprachig dazu.
 */
import type { InternSprache } from '../intern.js';

export interface RecruitingKandidatTexte {
  /* ── Strukturierte Angaben (V-223) ─────────────────────────────────── */
  readonly kTitel: string;
  readonly kErklaerung: string;
  readonly kQuelleMensch: string;
  readonly kQuelleAgent: string;
  readonly kBestaetigt: string;
  readonly kUnbestaetigt: string;
  readonly kKeiner: string;
  readonly kQualifikationen: string;
  readonly kSprachen: string;
  readonly kErfahrung: string;
  readonly kErfahrungUnbekannt: string;
  readonly kJahre: string;
  readonly kNotiz: string;
  readonly kKeineEintraege: string;
  readonly kErfassenTitel: string;
  readonly kJeZeile: string;
  readonly kErfahrungHinweis: string;
  readonly kSpeichern: string;
  readonly kSpeichernHinweis: string;
  readonly kBestaetigen: string;
  readonly kBestaetigenHinweis: string;
  readonly kVorschlagTitel: string;
  readonly kVorschlagErklaerung: string;
  readonly kVorschlagKnopf: string;
  readonly kVorschlagDemo: string;
  readonly kVorschlagNichtVerfuegbar: string;
  readonly kLebenslauf: string;
  readonly kOhneRecht: string;
  readonly kErfassenOhneRecht: string;
  readonly kErledigt: Readonly<Record<'erfasst' | 'bestaetigt' | 'vorgeschlagen', string>>;
  readonly kNichtGespeichert: string;
  readonly kFehler: Readonly<Record<string, string>>;
  readonly kFehlerSonst: string;

  /* ── Aus dem Postfach erfassen (V-224) ─────────────────────────────── */
  readonly pTitel: string;
  readonly pZurListe: string;
  readonly pEinleitung: string;
  readonly pNichtVerbunden: string;
  readonly pStelle: string;
  readonly pInitiativ: string;
  readonly pName: string;
  readonly pEmail: string;
  readonly pTelefon: string;
  readonly pNachricht: string;
  readonly pNachrichtHinweis: string;
  readonly pFrist: string;
  readonly pAnlegen: string;
  readonly pVerweis: string;
  readonly pNichtGespeichert: string;
  readonly pErfasst: string;
  readonly pFehler: Readonly<Record<string, string>>;
  readonly pFehlerSonst: string;
}

export const RECRUITING_KANDIDAT_TEXTE: Readonly<Record<InternSprache, RecruitingKandidatTexte>> = {
  de: {
    kTitel: 'Strukturierte Angaben',
    kErklaerung:
      'Qualifikationen, Sprachen und Berufserfahrung als Datensatz (REC-04). Er gilt erst, '
      + 'wenn ein Mensch ihn bestätigt hat — auch wenn er ihn selbst eingetragen hat. Jede '
      + 'Änderung nimmt eine frühere Bestätigung zurück.',
    kQuelleMensch: 'Von einem Menschen erfasst',
    kQuelleAgent: 'Vom Agenten ausgelesen — ungeprüft, bis ein Mensch bestätigt',
    kBestaetigt: 'Bestätigt am {wann} von {wer}.',
    kUnbestaetigt: 'Noch nicht bestätigt — der Datensatz gilt noch nicht.',
    kKeiner: 'Noch kein Datensatz erfasst.',
    kQualifikationen: 'Qualifikationen',
    kSprachen: 'Sprachen',
    kErfahrung: 'Berufserfahrung',
    kErfahrungUnbekannt: 'nicht bekannt',
    kJahre: 'Jahre',
    kNotiz: 'Notiz',
    kKeineEintraege: '—',
    kErfassenTitel: 'Erfassen oder berichtigen',
    kJeZeile: 'je Zeile ein Eintrag',
    kErfahrungHinweis:
      'Ganze Jahre, wie in den Unterlagen angegeben — leer, wenn sie nicht genannt sind. '
      + 'Hier wird nichts geschätzt.',
    kSpeichern: 'Angaben speichern',
    kSpeichernHinweis: 'Gespeichert wird unbestätigt; bestätigt wird eigens.',
    kBestaetigen: 'Angaben bestätigen',
    kBestaetigenHinweis:
      'Sie bestätigen, dass die Angaben den Unterlagen der Bewerbung entsprechen. Zeitpunkt '
      + 'und Person stehen danach am Datensatz.',
    kVorschlagTitel: 'Vom Agenten auslesen lassen',
    kVorschlagErklaerung:
      'Der Back-office-Agent liest Qualifikationen, Sprachen und Erfahrungsjahre aus der '
      + 'Nachricht der Bewerbung. Er rechnet nichts und bewertet nichts; eine Zahl, die nicht '
      + 'in der Nachricht steht, übernimmt er nicht. Das Ergebnis steht unbestätigt da.',
    kVorschlagKnopf: 'Angaben auslesen lassen',
    kVorschlagDemo:
      'Es läuft der Demobetrieb, kein Sprachmodell: für das Auslesen hat er keine Vorlage und '
      + 'sagt das — es entsteht dann kein Datensatz.',
    kVorschlagNichtVerfuegbar:
      'KI-Funktion nicht verfügbar: für das Auslesen ist kein Modell mit EU-Verarbeitung und '
      + 'Nullspeicherung freigegeben. Die Angaben trägt ein Mensch ein.',
    kLebenslauf:
      'Ein Lebenslauf kommt als Datei nicht an, solange offen ist, wohin Bewerbungsunterlagen '
      + 'gehen (O-375) — ausgelesen wird nur die Nachricht der Bewerbung.',
    kOhneRecht: 'Den Agenten startet, wer',
    kErfassenOhneRecht: 'Erfassen und bestätigen darf, wer dieses Recht hält:',
    kErledigt: {
      erfasst: 'Die Angaben sind gespeichert — unbestätigt, bis ein Mensch sie bestätigt.',
      bestaetigt: 'Die Angaben sind bestätigt.',
      vorgeschlagen:
        'Der Agent hat die Angaben ausgelesen. Sie gelten erst, wenn ein Mensch sie bestätigt.',
    },
    kNichtGespeichert: 'Nicht gespeichert.',
    kFehler: {
      unbekannt: 'Diese Bewerbung gibt es nicht.',
      unbrauchbare_jahre: 'Erfahrungsjahre als ganze Zahl zwischen 0 und 60 — oder leer.',
      kein_datensatz: 'Es gibt noch keinen Datensatz, der bestätigt werden könnte.',
      schon_bestaetigt: 'Der Datensatz ist bereits bestätigt.',
      ohne_quelle: 'Die Bewerbung trägt keinen Text, aus dem sich etwas auslesen liesse.',
      kein_schreibrecht: 'Der Datensatz wurde nicht geschrieben.',
      ki_nicht_verfuegbar:
        'KI-Funktion nicht verfügbar — es ist kein Modell freigegeben. Die Angaben trägt ein '
        + 'Mensch ein.',
      ki_budget: 'Das Budget der Agenten ist für diesen Monat erschöpft.',
      ki_preis_fehlt: 'Für das Modell ist kein Preis hinterlegt — der Lauf wurde nicht gestartet.',
      ki_zahl_erfunden: 'Das Modell hat eine Zahl genannt, die in keiner Angabe stand.',
      ki_agent_aus: 'Der Back-office-Agent ist ausgeschaltet.',
      ki_unbrauchbar: 'Die Antwort des Modells war kein Datensatz — nichts wurde übernommen.',
      ki_gestoert: 'Der Lauf des Agenten hat nichts ergeben. Das Agentenzentrum nennt den Grund.',
      unbekannte_aktion: 'Diese Änderung gibt es hier nicht.',
      kein_schluessel: 'Das Formular war veraltet. Bitte die Seite neu laden und erneut absenden.',
    },
    kFehlerSonst: 'Der Vorgang wurde abgewiesen.',

    pTitel: 'Bewerbung aus dem Postfach erfassen',
    pZurListe: 'Zurück zu den Bewerbungen',
    pEinleitung:
      'Eine Bewerbung, die per E-Mail kam, wird hier übertragen. Sie bekommt die Quelle '
      + '„E-Mail-Postfach" und dieselbe Löschfrist wie eine Bewerbung über die Karriereseite.',
    pNichtVerbunden: 'Bewerbungspostfach: nicht verbunden.',
    pStelle: 'Stelle',
    pInitiativ: 'keine — Initiativbewerbung',
    pName: 'Name',
    pEmail: 'E-Mail-Adresse',
    pTelefon: 'Telefon (freiwillig)',
    pNachricht: 'Nachricht',
    pNachrichtHinweis:
      'Der Text der E-Mail, soweit er zur Bewerbung gehört. Anhänge bleiben im Postfach '
      + '(O-375).',
    pFrist: 'Gelöscht wird nach der Frist, die für alle Bewerbungen gilt (REC-07).',
    pAnlegen: 'Bewerbung anlegen',
    pVerweis: 'Aus dem Postfach erfassen',
    pNichtGespeichert: 'Nicht gespeichert.',
    pErfasst:
      'Die Bewerbung aus dem Postfach ist angelegt — mit Quelle „E-Mail-Postfach" und Löschfrist. '
      + 'Eine Antwort an die Bewerberin entsteht nur als Entwurf und geht erst nach Freigabe hinaus.',
    pFehler: {
      unvollstaendig: 'Name und eine lesbare E-Mail-Adresse sind Pflicht.',
      zu_lang: 'Eine Angabe ist zu lang.',
      stelle_unbekannt: 'Diese Stelle gibt es hier nicht — oder sie ist geschlossen.',
      keine_frist: 'Es ist keine Aufbewahrungsfrist hinterlegt — ohne sie wird nichts angelegt.',
    },
    pFehlerSonst: 'Die Bewerbung wurde nicht angelegt.',
  },
  en: {
    kTitel: 'Structured details',
    kErklaerung:
      'Qualifications, languages and work experience as a record (REC-04). It only counts '
      + 'once a person has confirmed it — even if they entered it themselves. Every change '
      + 'withdraws an earlier confirmation.',
    kQuelleMensch: 'Entered by a person',
    kQuelleAgent: 'Read out by the agent — unchecked until a person confirms',
    kBestaetigt: 'Confirmed on {wann} by {wer}.',
    kUnbestaetigt: 'Not confirmed yet — the record does not count yet.',
    kKeiner: 'No record entered yet.',
    kQualifikationen: 'Qualifications',
    kSprachen: 'Languages',
    kErfahrung: 'Work experience',
    kErfahrungUnbekannt: 'not known',
    kJahre: 'years',
    kNotiz: 'Note',
    kKeineEintraege: '—',
    kErfassenTitel: 'Enter or correct',
    kJeZeile: 'one entry per line',
    kErfahrungHinweis:
      'Whole years as stated in the documents — empty if not stated. Nothing is estimated here.',
    kSpeichern: 'Save details',
    kSpeichernHinweis: 'Saved unconfirmed; confirming is a separate step.',
    kBestaetigen: 'Confirm details',
    kBestaetigenHinweis:
      'You confirm that the details match the application documents. Time and person are '
      + 'then recorded on the record.',
    kVorschlagTitel: 'Have the agent read them out',
    kVorschlagErklaerung:
      'The back-office agent reads qualifications, languages and years of experience from the '
      + 'application message. It calculates nothing and rates nothing; a number that is not in '
      + 'the message is not taken over. The result stands unconfirmed.',
    kVorschlagKnopf: 'Read out details',
    kVorschlagDemo:
      'The demo mode is running, not a language model: it has no template for reading out and '
      + 'says so — no record is created then.',
    kVorschlagNichtVerfuegbar:
      'AI function not available: no model with EU processing and zero retention is approved '
      + 'for reading out. A person enters the details.',
    kLebenslauf:
      'A CV does not arrive as a file while it is open where application documents go (O-375) '
      + '— only the application message is read.',
    kOhneRecht: 'The agent is started by whoever holds',
    kErfassenOhneRecht: 'Entering and confirming is for whoever holds this permission:',
    kErledigt: {
      erfasst: 'The details are saved — unconfirmed until a person confirms them.',
      bestaetigt: 'The details are confirmed.',
      vorgeschlagen:
        'The agent has read out the details. They only count once a person confirms them.',
    },
    kNichtGespeichert: 'Not saved.',
    kFehler: {
      unbekannt: 'This application does not exist.',
      unbrauchbare_jahre: 'Years of experience as a whole number between 0 and 60 — or empty.',
      kein_datensatz: 'There is no record yet that could be confirmed.',
      schon_bestaetigt: 'The record is already confirmed.',
      ohne_quelle: 'The application has no text to read anything from.',
      kein_schreibrecht: 'The record was not written.',
      ki_nicht_verfuegbar:
        'AI function not available — no model is approved. A person enters the details.',
      ki_budget: 'The agents’ budget for this month is used up.',
      ki_preis_fehlt: 'No price is recorded for the model — the run was not started.',
      ki_zahl_erfunden: 'The model gave a number that was in none of the details.',
      ki_agent_aus: 'The back-office agent is switched off.',
      ki_unbrauchbar: 'The model’s answer was not a record — nothing was taken over.',
      ki_gestoert: 'The agent’s run produced nothing. The agent centre gives the reason.',
      unbekannte_aktion: 'That change does not exist here.',
      kein_schluessel: 'The form was out of date. Please reload the page and submit again.',
    },
    kFehlerSonst: 'The action was rejected.',

    pTitel: 'Record an application from the mailbox',
    pZurListe: 'Back to the applications',
    pEinleitung:
      'An application that arrived by e-mail is transferred here. It gets the source “E-mail '
      + 'mailbox” and the same deletion deadline as an application via the careers page.',
    pNichtVerbunden: 'Application mailbox: not connected.',
    pStelle: 'Position',
    pInitiativ: 'none — speculative application',
    pName: 'Name',
    pEmail: 'E-mail address',
    pTelefon: 'Phone (optional)',
    pNachricht: 'Message',
    pNachrichtHinweis:
      'The text of the e-mail as far as it belongs to the application. Attachments stay in the '
      + 'mailbox (O-375).',
    pFrist: 'It is deleted after the deadline that applies to all applications (REC-07).',
    pAnlegen: 'Create application',
    pVerweis: 'Record from the mailbox',
    pNichtGespeichert: 'Not saved.',
    pErfasst:
      'The application from the mailbox has been created — with source “e-mail mailbox” and a '
      + 'deletion date. A reply to the applicant only arises as a draft and goes out after approval.',
    pFehler: {
      unvollstaendig: 'A name and a readable e-mail address are required.',
      zu_lang: 'One of the details is too long.',
      stelle_unbekannt: 'This position does not exist here — or it is closed.',
      keine_frist: 'No retention period is recorded — nothing is created without it.',
    },
    pFehlerSonst: 'The application was not created.',
  },
};
