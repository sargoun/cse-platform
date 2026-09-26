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

  /* V-141 — den Ansprechpartner wählen oder anlegen, und mit welchem Zweck. */
  readonly kontaktBlatt: string;
  readonly kontaktWaehlenTitel: string;
  readonly kontaktWaehlenErklaerung: string;
  readonly kontaktWaehlen: string;
  readonly kontaktUebernehmen: string;
  readonly kontaktNeuTitel: string;
  readonly kontaktNeuMitKunde: string;
  readonly kontaktNeuOhneKunde: string;
  readonly vorname: string;
  readonly nachname: string;
  readonly email: string;
  readonly telefon: string;
  readonly kontaktAnlegen: string;
  readonly kontaktVorhanden: string;
  /** Ausgehend gilt bei dieser Herkunft als Werbung — offen bis O-907. */
  readonly kontaktWerbungOffen: string;
  /** Ausgehend ist bei einem Akquise-Lead Werbung — entschieden. */
  readonly kontaktWerbungAkquise: string;
  /** Die Abweisungen beim Wählen und Anlegen — sie stehen am Kontakt, nicht am nächsten Schritt. */
  readonly kontaktFehler: Readonly<Record<string, string>>;

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
      uwg_werbung:
        'Bei dieser Herkunft gilt ein ausgehender Kontakt als Werbung, und dafür fehlt dem '
        + 'Ansprechpartner eine Rechtsgrundlage — oder ihm wurde widersprochen (§ 7 UWG / '
        + 'Art. 21 DSGVO). Es wurde nichts festgehalten. Die Grundlage stellt ein Mensch mit '
        + 'Quelle und Datum auf dem Kontaktblatt fest.',
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
      + 'Anruf lässt sich dann nicht belegen (§ 7 UWG) — wählen Sie unten einen oder legen Sie '
      + 'ihn an.',
    kontaktKunde: 'gehört zum Kunden',

    kontaktBlatt: 'Kontaktblatt öffnen',
    kontaktWaehlenTitel: 'Einen Kontakt des Kunden wählen',
    kontaktWaehlenErklaerung:
      'Zur Wahl stehen die Ansprechpartner des Kunden dieser Anfrage, die noch im Unternehmen '
      + 'sind.',
    kontaktWaehlen: 'Ansprechpartner wählen',
    kontaktUebernehmen: 'Übernehmen',
    kontaktNeuTitel: 'Neuen Ansprechpartner anlegen',
    kontaktNeuMitKunde:
      'Der Kontakt entsteht beim Kunden dieser Anfrage. Gibt es die E-Mail-Adresse im Bereich '
      + 'schon, zeigt die Anfrage auf diesen Kontakt — ein Mensch, ein Kontakt. Eine '
      + 'Rechtsgrundlage für Werbung hat er danach nicht; die stellt ein Mensch mit Quelle und '
      + 'Datum auf dem Kontaktblatt fest.',
    kontaktNeuOhneKunde:
      'Die Anfrage hat noch keinen Kunden: der Kontakt entsteht ohne Kunden und wandert mit, '
      + 'sobald sie einen bekommt. Gibt es die E-Mail-Adresse im Bereich schon, zeigt die '
      + 'Anfrage auf diesen Kontakt. Eine Rechtsgrundlage für Werbung hat er danach nicht.',
    vorname: 'Vorname',
    nachname: 'Nachname',
    email: 'E-Mail',
    telefon: 'Telefon',
    kontaktAnlegen: 'Anlegen und zuordnen',
    kontaktVorhanden:
      'Unter dieser E-Mail-Adresse gibt es den Kontakt schon — die Anfrage zeigt jetzt auf ihn. '
      + 'Ein Mensch, ein Kontakt.',
    kontaktWerbungOffen:
      'Diese Anfrage kam nicht über das Webformular. Ein ausgehender Anruf oder eine ausgehende '
      + 'E-Mail geht deshalb bis auf Weiteres als Werbung durch das Tor (§ 7 UWG): der '
      + 'Ansprechpartner braucht eine Rechtsgrundlage mit Quelle und Datum. Ob eine Erfassung '
      + 'von Hand, eine Empfehlung oder eine Bekanntmachung selbst schon eine Anfrage ist, ist '
      + 'eine offene Frage an die Geschäftsleitung (O-907).',
    kontaktWerbungAkquise:
      'Diese Anfrage stammt aus der Akquise — niemand hat angefragt. Ein ausgehender Anruf oder '
      + 'eine ausgehende E-Mail ist Werbung (§ 7 UWG) und braucht beim Ansprechpartner eine '
      + 'Rechtsgrundlage mit Quelle und Datum.',
    kontaktFehler: {
      kontakt_unbekannt: 'Diesen Ansprechpartner gibt es in dieser Gesellschaft nicht.',
      kontakt_fremd: 'Dieser Ansprechpartner gehört nicht zum Kunden dieser Anfrage.',
      kontakt_ausgeschieden:
        'Dieser Ansprechpartner ist aus dem Unternehmen ausgeschieden. Post an ihn liest sein '
        + 'Nachfolger — wählen Sie einen anderen.',
      nachname_fehlt: 'Ein Ansprechpartner braucht einen Nachnamen.',
      email_ungueltig: 'Diese E-Mail-Adresse ist nicht lesbar.',
      kontakt_email_vergeben:
        'Unter dieser E-Mail-Adresse führt der Kunde schon einen Ansprechpartner, der aus dem '
        + 'Unternehmen ausgeschieden ist. Legen Sie den Kontakt ohne diese Adresse an oder mit '
        + 'der, unter der er heute erreichbar ist.',
    },

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
      uwg_werbung:
        'For this origin an outgoing contact counts as advertising, and the contact person has '
        + 'no legal basis for it — or has objected (§ 7 UWG / Art. 21 GDPR). Nothing was '
        + 'recorded. A person establishes the basis, with source and date, on the contact sheet.',
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
      + 'evidenced then (§ 7 UWG) — choose one below or create one.',
    kontaktKunde: 'belongs to customer',

    kontaktBlatt: 'Open the contact sheet',
    kontaktWaehlenTitel: 'Choose a contact of the customer',
    kontaktWaehlenErklaerung:
      'The choice lists the contact persons of this enquiry’s customer who are still with the '
      + 'company.',
    kontaktWaehlen: 'Choose a contact person',
    kontaktUebernehmen: 'Apply',
    kontaktNeuTitel: 'Create a contact person',
    kontaktNeuMitKunde:
      'The contact is created at this enquiry’s customer. If the e-mail address is already on '
      + 'file in this area, the enquiry points to that contact — one person, one contact. It has '
      + 'no legal basis for advertising afterwards; a person establishes that, with source and '
      + 'date, on the contact sheet.',
    kontaktNeuOhneKunde:
      'The enquiry has no customer yet: the contact is created without one and moves along as '
      + 'soon as the enquiry gets a customer. If the e-mail address is already on file in this '
      + 'area, the enquiry points to that contact. It has no legal basis for advertising '
      + 'afterwards.',
    vorname: 'First name',
    nachname: 'Last name',
    email: 'E-mail',
    telefon: 'Phone',
    kontaktAnlegen: 'Create and link',
    kontaktVorhanden:
      'This e-mail address is already on file — the enquiry now points to that contact. One '
      + 'person, one contact.',
    kontaktWerbungOffen:
      'This enquiry did not come in through the website form. An outgoing call or e-mail '
      + 'therefore passes the gate as advertising for now (§ 7 UWG): the contact person needs a '
      + 'legal basis with source and date. Whether an entry by hand, a referral or a tender '
      + 'notice is itself an enquiry is an open question to management (O-907).',
    kontaktWerbungAkquise:
      'This enquiry comes from Akquise (prospecting) — nobody asked. An outgoing call or e-mail '
      + 'is advertising (§ 7 UWG) and needs a legal basis with source and date at the contact '
      + 'person.',
    kontaktFehler: {
      kontakt_unbekannt: 'There is no such contact person in this Mandant (company).',
      kontakt_fremd: 'This contact person does not belong to this enquiry’s customer.',
      kontakt_ausgeschieden:
        'This contact person has left the company. Mail to them is read by their successor — '
        + 'choose someone else.',
      nachname_fehlt: 'A contact person needs a last name.',
      email_ungueltig: 'This e-mail address cannot be read.',
      kontakt_email_vergeben:
        'The customer already has a contact person under this e-mail address who has left the '
        + 'company. Create the contact without this address, or with the one they can be '
        + 'reached at today.',
    },

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
