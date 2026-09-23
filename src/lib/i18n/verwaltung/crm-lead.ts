/**
 * Die Wörter der Leadpflege und der Wiedervorlage — in beiden Sprachen
 * (V-077, V-079, CRM-04, CRM-06, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** `Lead`,
 * `Wiedervorlage` und `Mandant` sind die Wörter, mit denen im Betrieb
 * gesprochen wird; erklärt wird in Klammern, ersetzt wird nicht.
 */
import type { InternSprache } from '../intern.js';

export interface LeadTexte {
  readonly standTitel: string;
  readonly standErklaerung: string;
  readonly stand: string;
  readonly standWerte: Readonly<Record<string, string>>;
  readonly verlustGrund: string;
  readonly verlustGrundErklaerung: string;
  readonly standSpeichern: string;

  readonly wvTitel: string;
  readonly wvErklaerung: string;
  readonly wvBetreff: string;
  readonly wvFaellig: string;
  readonly wvErinnerung: string;
  readonly wvNotiz: string;
  readonly wvZustaendig: string;
  readonly wvNiemand: string;
  readonly wvMirSelbst: string;
  readonly wvOhneNamensrecht: string;
  readonly wvAnlegen: string;
  readonly freiwillig: string;

  readonly keinSchreibrecht: string;
  readonly fehler: Readonly<Record<string, string>>;
}

export const LEAD_TEXTE: Readonly<Record<InternSprache, LeadTexte>> = {
  de: {
    standTitel: 'Stand der Anfrage',
    standErklaerung:
      'Der Stand entscheidet, ob die Anfrage in der Arbeitsliste steht und ob sie in der '
      + 'Auswertung als gewonnen oder verloren zählt. Er wird gesetzt, nicht erschlossen — '
      + 'eine Anfrage, die niemand weiterstellt, bleibt für immer „neu".',
    stand: 'Stand',
    standWerte: {
      neu: 'neu',
      in_bearbeitung: 'in Bearbeitung',
      angebot: 'Angebot abgegeben',
      gewonnen: 'gewonnen',
      verloren: 'verloren',
      kein_bedarf: 'kein Bedarf',
    },
    verlustGrund: 'Grund',
    verlustGrundErklaerung:
      'Pflicht bei „verloren" und „kein Bedarf": ohne ihn sagt die Auswertung nichts '
      + 'darüber, WARUM verloren wurde — und genau das ist die Zahl, für die es sie gibt.',
    standSpeichern: 'Stand speichern',

    wvTitel: 'Wiedervorlage zu dieser Anfrage',
    wvErklaerung:
      'Ein Termin, an dem sich jemand wieder meldet. Sie erscheint in der Wiedervorlagenliste, '
      + 'in den Aufgaben und im Kalender.',
    wvBetreff: 'Betreff',
    wvFaellig: 'Fällig am',
    wvErinnerung: 'Erinnerung am',
    wvNotiz: 'Notiz',
    wvZustaendig: 'Zuständig',
    wvNiemand: 'niemandem zugewiesen',
    wvMirSelbst: 'Mir selbst zuweisen',
    wvOhneNamensrecht:
      'Andere Menschen stehen hier nicht zur Wahl — dafür fehlt das Recht, Benutzernamen zu '
      + 'lesen. Eine Auswahlliste, die Namen nennt, wäre selbst die Auskunft.',
    wvAnlegen: 'Wiedervorlage anlegen',
    freiwillig: '(freiwillig)',

    keinSchreibrecht: 'Zum Ändern fehlt das Recht',
    fehler: {
      unbekannter_status: 'Diesen Stand gibt es nicht.',
      verlust_ohne_grund:
        'Ein verlorener Lead trägt einen Grund — sonst sagt die Auswertung nichts darüber, '
        + 'warum verloren wurde.',
      nicht_gefunden: 'Diese Anfrage oder Wiedervorlage ist nicht erreichbar.',
      unvollstaendig: 'Es fehlt eine Angabe.',
    },
  },

  en: {
    standTitel: 'State of the enquiry',
    standErklaerung:
      'The state decides whether the enquiry sits in the work list and whether it counts as '
      + 'won or lost in the reporting. It is set, not inferred — an enquiry nobody moves on '
      + 'stays “new” forever.',
    stand: 'State',
    standWerte: {
      neu: 'new',
      in_bearbeitung: 'in progress',
      angebot: 'quote sent',
      gewonnen: 'won',
      verloren: 'lost',
      kein_bedarf: 'no need',
    },
    verlustGrund: 'Reason',
    verlustGrundErklaerung:
      'Required for “lost” and “no need”: without it the reporting says nothing about WHY it '
      + 'was lost — and that is the very figure it exists for.',
    standSpeichern: 'Save state',

    wvTitel: 'Follow-up on this enquiry',
    wvErklaerung:
      'A date on which somebody gets back in touch. It shows up in the follow-up list, in the '
      + 'tasks and in the calendar.',
    wvBetreff: 'Subject',
    wvFaellig: 'Due on',
    wvErinnerung: 'Remind on',
    wvNotiz: 'Note',
    wvZustaendig: 'Assigned to',
    wvNiemand: 'nobody assigned',
    wvMirSelbst: 'Assign to me',
    wvOhneNamensrecht:
      'Other people are not offered here — that needs the right to read user names. A picker '
      + 'listing names would itself be the disclosure.',
    wvAnlegen: 'Create follow-up',
    freiwillig: '(optional)',

    keinSchreibrecht: 'Changing this needs the right',
    fehler: {
      unbekannter_status: 'There is no such state.',
      verlust_ohne_grund:
        'A lost lead carries a reason — otherwise the reporting says nothing about why it was '
        + 'lost.',
      nicht_gefunden: 'This enquiry or follow-up is not reachable.',
      unvollstaendig: 'Something is missing.',
    },
  },
};
