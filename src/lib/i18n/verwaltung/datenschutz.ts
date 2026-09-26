/**
 * Die Wörter des Datenschutz-Schreibtischs (LEG-09, D-592).
 *
 * **Die Artikelnummern übersetzt niemand.** „Art. 15 DSGVO" heisst im
 * englischen Text „Art. 15 GDPR" — die Verordnung selbst ist in beiden
 * Sprachen amtlich, und die Nummer ist in beiden dieselbe. Was übersetzt wird,
 * ist die Beschreibung daneben, nicht die Fundstelle.
 *
 * **`Mandant` und `Gesellschaft` bleiben stehen.** Eine Betroffenenanfrage
 * geht an EINE juristische Person, und das ist der Punkt, an dem eine erfundene
 * englische Entsprechung („company", „client") falsch würde: der Verantwortliche
 * im Sinne des Art. 4 Nr. 7 ist die Gesellschaft, nicht die Gruppe.
 */
import type { InternSprache } from '../intern.js';
import type { AufnahmeWeg } from '../../../server/services/datenschutz/anfrage.js';

export interface AufnahmeTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly warumErklaerung: string;

  readonly anliegen: string;
  readonly anliegenErklaerung: string;
  readonly weg: string;
  readonly wegErklaerung: string;
  readonly eingegangen: string;
  readonly eingegangenErklaerung: string;
  readonly eingegangenJetzt: string;

  readonly name: string;
  readonly nameBeispiel: string;
  readonly email: string;
  readonly emailErklaerung: string;
  readonly rolle: string;
  readonly rolleBeispiel: string;
  readonly rolleErklaerung: string;
  readonly nachricht: string;
  readonly nachrichtErklaerung: string;
  readonly freiwillig: string;

  readonly aufnehmen: string;
  readonly identitaetSpaeter: string;
  readonly keinSchreibrecht: string;

  /** Die Wege in der Sprache des Bildschirms. */
  readonly wege: Readonly<Record<AufnahmeWeg, string>>;
  readonly wegeErklaerung: Readonly<Record<AufnahmeWeg, string>>;
}

export const AUFNAHME_TEXTE: Readonly<Record<InternSprache, AufnahmeTexte>> = {
  de: {
    modul: 'datenschutz.auskunft_erstellen',
    titel: 'Anfrage aufnehmen',
    untertitel: 'Brief, Anruf, E-Mail — was nicht durch das Formular kam',
    warumErklaerung:
      'Art. 12 Abs. 1 DSGVO lässt den Antrag „schriftlich oder in anderer Form, '
      + 'gegebenenfalls auch elektronisch" zu und nennt den mündlichen Antrag '
      + 'ausdrücklich. Ein Brief ist ein Antrag, ein Anruf ist ein Antrag, und '
      + 'beide lösen dieselbe Monatsfrist aus wie das Formular. Was hier '
      + 'entsteht, ist derselbe Vorgang mit derselben Uhr.',

    anliegen: 'Anliegen',
    anliegenErklaerung:
      'Welches Recht geltend gemacht wird. Wer es nicht benennt, meint in aller '
      + 'Regel die Auskunft — fragen Sie nach, statt zu raten: die Art bestimmt, '
      + 'welche Arbeit der Vorgang verlangt.',
    weg: 'Eingangsweg',
    wegErklaerung:
      'Wie der Antrag ankam. Im Streit um die Fristwahrung ist das die erste '
      + 'Frage — und Ihr Name steht danach daneben.',
    eingegangen: 'Eingegangen am (Berliner Zeit)',
    eingegangenErklaerung:
      'Der Tag des Posteingangs, nicht der Tag der Erfassung. Ab ihm läuft die '
      + 'Frist des Art. 12 Abs. 3. Ein Brief vom Ersten, am Zwanzigsten erfasst, '
      + 'hat noch zehn Tage — nicht noch einen Monat. Ein Zeitpunkt in der '
      + 'Zukunft wird abgewiesen.',
    eingegangenJetzt: 'Leer lassen heisst: jetzt.',

    name: 'Name der anfragenden Person',
    nameBeispiel: 'so, wie sie sich genannt hat',
    email: 'E-Mail-Adresse',
    emailErklaerung:
      'An sie geht die Antwort. Auch beim Brief: wer nur eine Anschrift hat, '
      + 'vermerkt sie unten in der Nachricht.',
    rolle: 'Als was sie sich bezeichnet',
    rolleBeispiel: 'z. B. ehemalige Mitarbeiterin, Bewerber, Kundin',
    rolleErklaerung:
      'Ihre eigene Angabe — nicht, was die Plattform über sie weiss. Die '
      + 'Zuordnung zu einer Person trifft ein Mensch auf dem Vorgangsblatt.',
    nachricht: 'Was verlangt wurde',
    nachrichtErklaerung:
      'Beim Anruf das Protokoll, beim Brief der Wortlaut oder seine '
      + 'Zusammenfassung. Das ist der Text, den eine Aufsichtsbehörde liest, '
      + 'wenn sie fragt, worauf geantwortet wurde.',
    freiwillig: '(freiwillig)',

    aufnehmen: 'Anfrage aufnehmen',
    identitaetSpaeter:
      'Nach der Aufnahme geht das Vorgangsblatt auf. Die Zuordnung zu einer '
      + 'Person und die Frage nach der Identität (Art. 12 Abs. 6) stehen dort — '
      + 'nicht hier: nachgefragt wird nur bei begründeten Zweifeln, also im '
      + 'Einzelfall und nicht in einem Formular.',
    keinSchreibrecht: 'Aufnehmen verlangt',

    wege: {
      brief: 'Brief',
      telefon: 'Telefon',
      email: 'E-Mail',
      persoenlich: 'Persönlich vor Ort',
    },
    wegeErklaerung: {
      brief: 'Art. 12 Abs. 1: schriftlich',
      telefon: 'Art. 12 Abs. 1 Satz 3: mündlich',
      email: 'Art. 12 Abs. 1: elektronisch, frei formuliert',
      persoenlich: 'Art. 12 Abs. 1 Satz 3: mündlich, vor Ort',
    },
  },

  en: {
    modul: 'datenschutz.auskunft_erstellen',
    titel: 'Record a request',
    untertitel: 'Letter, phone call, email — whatever did not come through the form',
    warumErklaerung:
      'Art. 12(1) GDPR allows the request to be made “in writing or by other '
      + 'means, including, where appropriate, by electronic means”, and names the '
      + 'oral request explicitly. A letter is a request, a phone call is a '
      + 'request, and both start the same one-month clock as the form. What is '
      + 'created here is the same case with the same clock.',

    anliegen: 'Matter',
    anliegenErklaerung:
      'Which right is being invoked. Someone who does not name it usually means '
      + 'access — ask rather than guess: the type decides what work the case '
      + 'requires.',
    weg: 'How it arrived',
    wegErklaerung:
      'The way the request came in. In a dispute about meeting the deadline this '
      + 'is the first question asked — and your name is recorded next to it.',
    eingegangen: 'Received on (Berlin time)',
    eingegangenErklaerung:
      'The day it arrived, not the day you type it in. The Art. 12(3) deadline '
      + 'runs from it. A letter from the 1st, recorded on the 20th, has ten days '
      + 'left — not another month. A moment in the future is refused.',
    eingegangenJetzt: 'Leave empty for now.',

    name: 'Name of the person requesting',
    nameBeispiel: 'as they gave it',
    email: 'Email address',
    emailErklaerung:
      'The answer goes there. For a letter too: if you only have a postal '
      + 'address, note it in the message below.',
    rolle: 'How they describe themselves',
    rolleBeispiel: 'e.g. former employee, applicant, customer',
    rolleErklaerung:
      'Their own statement — not what the platform knows about them. Linking the '
      + 'case to a person is done by a human on the case sheet.',
    nachricht: 'What was demanded',
    nachrichtErklaerung:
      'For a call, the note you took; for a letter, its wording or a summary. '
      + 'This is the text a supervisory authority reads when it asks what was '
      + 'answered.',
    freiwillig: '(optional)',

    aufnehmen: 'Record request',
    identitaetSpaeter:
      'The case sheet opens once it is recorded. Linking it to a person and the '
      + 'question of identity (Art. 12(6)) live there, not here: identity is '
      + 'queried only where there are reasonable doubts, so case by case and not '
      + 'in a form.',
    keinSchreibrecht: 'Recording one requires',

    wege: {
      brief: 'Letter',
      telefon: 'Telephone',
      email: 'Email',
      persoenlich: 'In person',
    },
    wegeErklaerung: {
      brief: 'Art. 12(1): in writing',
      telefon: 'Art. 12(1) sentence 3: orally',
      email: 'Art. 12(1): electronic, freely worded',
      persoenlich: 'Art. 12(1) sentence 3: orally, on site',
    },
  },
};
