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
  readonly nichtGespeichert: string;

  /* V-137 — die Einsendung, der Kontakt, die Pflege, die Aktivität. */
  readonly nummer: string;
  readonly firma: string;
  readonly ersteReaktion: string;
  readonly offen: string;
  readonly offenFrist: (frist: string) => string;
  readonly geschaetzterWert: string;
  readonly besitzer: string;
  readonly niemand: string;
  readonly prioritaet: string;
  readonly prioritaetWerte: Readonly<Record<string, string>>;

  readonly kontaktTitel: string;
  readonly kontaktKeiner: string;
  readonly kontaktKunde: string;

  readonly einsendungTitel: string;
  readonly einsendungErklaerung: (eingang: string) => string;
  readonly einsendungOhneRecht: string;
  readonly lvTitel: string;
  readonly lvOhneRecht: string;
  readonly herkunftTitel: string;
  readonly herkunftUtm: string;
  readonly herkunftReferrer: string;
  readonly herkunftEinstieg: string;
  readonly herkunftKeine: string;

  readonly pflegeTitel: string;
  readonly pflegeErklaerung: string;
  readonly pflegeBesitzerOhneNamensrecht: string;
  readonly pflegeSpeichern: string;

  readonly aktivitaetTitel: string;
  readonly aktivitaetArt: string;
  readonly aktivitaetArten: Readonly<Record<string, string>>;
  readonly richtung: string;
  readonly richtungWerte: Readonly<Record<string, string>>;
  readonly richtungErklaerung: string;
  readonly wasPassiert: string;
  readonly naechsterSchritt: string;
  readonly wann: string;
  readonly festhalten: string;
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
    nichtGespeichert: 'Das ließ sich nicht speichern. Es wurde nichts geändert.',
    fehler: {
      unbekannter_status: 'Diesen Stand gibt es nicht.',
      verlust_ohne_grund:
        'Ein verlorener Lead trägt einen Grund — sonst sagt die Auswertung nichts darüber, '
        + 'warum verloren wurde.',
      nicht_gefunden: 'Diese Anfrage oder Wiedervorlage ist nicht erreichbar.',
      unvollstaendig: 'Es fehlt eine Angabe.',
      kein_kontakt:
        'Ein ausgehender Anruf oder eine ausgehende E-Mail braucht einen Ansprechpartner — '
        + 'dieser Anfrage ist keiner zugeordnet (§ 7 UWG).',
      uwg:
        'Dieser Kontakt ist über diesen Weg nicht zulässig (§ 7 UWG / Art. 21 DSGVO). Es wurde '
        + 'nichts festgehalten.',
      unbekannte_prioritaet: 'Diese Priorität gibt es nicht.',
      unbekannter_besitzer: 'Dieser Mensch arbeitet nicht in diesem Bereich.',
    },
    nummer: 'Nummer',
    firma: 'Firma',
    ersteReaktion: 'Erste Reaktion',
    offen: 'offen',
    offenFrist: (frist) => `offen — Frist ${frist}`,
    geschaetzterWert: 'Geschätzter Wert',
    besitzer: 'Besitzer',
    niemand: 'niemand',
    prioritaet: 'Priorität',
    prioritaetWerte: { niedrig: 'niedrig', normal: 'normal', hoch: 'hoch' },

    kontaktTitel: 'Ansprechpartner',
    kontaktKeiner:
      'Dieser Anfrage ist kein Ansprechpartner zugeordnet. Eine ausgehende E-Mail oder ein '
      + 'Anruf lässt sich dann nicht belegen (§ 7 UWG) — legen Sie den Kontakt am Kunden an.',
    kontaktKunde: 'gehört zum Kunden',

    einsendungTitel: 'Einsendung',
    einsendungErklaerung: (eingang) =>
      `Was über das Formular angegeben wurde, am ${eingang} — mit den Feldern der `
      + 'Formularversion, die damals galt.',
    einsendungOhneRecht: 'Die Angaben der Einsendung sieht, wer dieses Recht hat:',
    lvTitel: 'Hochgeladenes Leistungsverzeichnis',
    lvOhneRecht: 'Das Dokument öffnet, wer dieses Recht hat:',
    herkunftTitel: 'Herkunft',
    herkunftUtm: 'Kampagne (UTM)',
    herkunftReferrer: 'Verweisende Seite',
    herkunftEinstieg: 'Einstiegsseite',
    herkunftKeine: 'Keine Angaben zur Herkunft übermittelt.',

    pflegeTitel: 'Priorität und Besitzer',
    pflegeErklaerung:
      'Der Besitzer ist der Mensch, der die Anfrage beantwortet — ihn benachrichtigt die '
      + 'Plattform bei neuer Anfrage und bei überschrittener Reaktionszeit.',
    pflegeBesitzerOhneNamensrecht:
      'Einen anderen Besitzer wählt, wer Benutzernamen lesen darf. Sie können die Anfrage '
      + 'sich selbst zuweisen.',
    pflegeSpeichern: 'Speichern',

    aktivitaetTitel: 'Aktivität festhalten',
    aktivitaetArt: 'Art',
    aktivitaetArten: {
      notiz: 'Notiz', anruf: 'Anruf', email: 'E-Mail', termin: 'Termin', aufgabe: 'Aufgabe',
    },
    richtung: 'Richtung',
    richtungWerte: {
      intern: 'intern — eine Notiz für das Haus',
      ausgehend: 'ausgehend — wir haben uns gemeldet',
      eingehend: 'eingehend — der Anfragende hat sich gemeldet',
    },
    richtungErklaerung:
      'Nur ein ausgehender Anruf oder eine ausgehende E-Mail ist eine Reaktion auf die '
      + 'Anfrage: sie hält die Reaktionsuhr an und beendet die Eskalation.',
    wasPassiert: 'Was ist passiert?',
    naechsterSchritt: 'Nächster Schritt',
    wann: 'Wann',
    festhalten: 'Festhalten',
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
    nichtGespeichert: 'That could not be saved. Nothing was changed.',
    fehler: {
      unbekannter_status: 'There is no such state.',
      verlust_ohne_grund:
        'A lost lead carries a reason — otherwise the reporting says nothing about why it was '
        + 'lost.',
      nicht_gefunden: 'This enquiry or follow-up is not reachable.',
      unvollstaendig: 'Something is missing.',
      kein_kontakt:
        'An outgoing call or e-mail needs a contact person — none is linked to this enquiry '
        + '(§ 7 UWG).',
      uwg:
        'This contact is not permitted on this channel (§ 7 UWG / Art. 21 GDPR). Nothing was '
        + 'recorded.',
      unbekannte_prioritaet: 'There is no such priority.',
      unbekannter_besitzer: 'This person does not work in this area.',
    },
    nummer: 'Number',
    firma: 'Company',
    ersteReaktion: 'First response',
    offen: 'open',
    offenFrist: (frist) => `open — due ${frist}`,
    geschaetzterWert: 'Estimated value',
    besitzer: 'Owner',
    niemand: 'nobody',
    prioritaet: 'Priority',
    prioritaetWerte: { niedrig: 'low', normal: 'normal', hoch: 'high' },

    kontaktTitel: 'Contact person (Ansprechpartner)',
    kontaktKeiner:
      'No contact person is linked to this enquiry. An outgoing e-mail or call cannot be '
      + 'evidenced then (§ 7 UWG) — create the contact at the customer.',
    kontaktKunde: 'belongs to customer',

    einsendungTitel: 'Submission',
    einsendungErklaerung: (eingang) =>
      `What was entered in the form, on ${eingang} — with the fields of the form version `
      + 'that applied then.',
    einsendungOhneRecht: 'The submitted details are shown to holders of this right:',
    lvTitel: 'Uploaded bill of quantities (Leistungsverzeichnis)',
    lvOhneRecht: 'The document opens for holders of this right:',
    herkunftTitel: 'Origin',
    herkunftUtm: 'Campaign (UTM)',
    herkunftReferrer: 'Referring page',
    herkunftEinstieg: 'Landing page',
    herkunftKeine: 'No origin details were transmitted.',

    pflegeTitel: 'Priority and owner',
    pflegeErklaerung:
      'The owner is the person who answers the enquiry — the platform notifies them of a new '
      + 'enquiry and of an overdue response.',
    pflegeBesitzerOhneNamensrecht:
      'Choosing another owner needs the right to read user names. You can assign the enquiry '
      + 'to yourself.',
    pflegeSpeichern: 'Save',

    aktivitaetTitel: 'Record an activity',
    aktivitaetArt: 'Kind',
    aktivitaetArten: {
      notiz: 'Note', anruf: 'Call', email: 'E-mail', termin: 'Meeting', aufgabe: 'Task',
    },
    richtung: 'Direction',
    richtungWerte: {
      intern: 'internal — a note for the team',
      ausgehend: 'outgoing — we got in touch',
      eingehend: 'incoming — the enquirer got in touch',
    },
    richtungErklaerung:
      'Only an outgoing call or e-mail is a response to the enquiry: it stops the response '
      + 'clock and ends the escalation.',
    wasPassiert: 'What happened?',
    naechsterSchritt: 'Next step',
    wann: 'When',
    festhalten: 'Record',
  },
};
