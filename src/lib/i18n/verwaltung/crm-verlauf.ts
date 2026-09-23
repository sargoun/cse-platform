/**
 * Der Kommunikationsverlauf am Kunden und am Ansprechpartner — in beiden
 * Sprachen (CRM-03, V-147, D-641, D-592).
 *
 * **Keine rohen Schlüssel auf dem Bildschirm.** Der Verlauf auf dem
 * Kontaktblatt zeigte `ausgehend · email`, `vertraglich`, `anruf` — die
 * Werte der Aufzählungen, wie die Datenbank sie führt. Hier steht je Wert
 * der Satz; ein unbekannter Wert fällt auf einen neutralen Strich zurück,
 * nie auf den Schlüssel selbst.
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `./basis.ts`): `Lead`, `Wiedervorlage`, `§ 7 UWG`.
 */
import type { InternSprache } from '../intern.js';

export interface VerlaufTexte {
  readonly titel: string;
  readonly erklaerungKunde: string;
  readonly erklaerungKontakt: string;
  readonly leer: string;
  readonly beschriftungKunde: string;
  readonly beschriftungKontakt: string;
  readonly beschriftungListe: string;
  readonly jungste: (n: number) => string;

  /* V-149 — die Liste hinter der Kachel „Aktivität (7 Tage)". */
  readonly aktivitaetTitel: string;
  readonly aktivitaetErklaerung: (tage: number) => string;

  readonly spalteWann: string;
  readonly spalteWas: string;
  readonly spalteWeg: string;
  readonly spalteBezug: string;
  readonly spalteWer: string;
  readonly spalteBeleg: string;

  readonly arten: Readonly<Record<string, string>>;
  readonly richtungen: Readonly<Record<string, string>>;
  readonly kanaele: Readonly<Record<string, string>>;
  readonly zwecke: Readonly<Record<string, string>>;
  readonly grundlagen: Readonly<Record<string, string>>;
  readonly zustellung: Readonly<Record<string, string>>;
  readonly grundlageAmTag: (grundlage: string) => string;
  readonly faellig: (wann: string) => string;
  readonly erledigt: string;
  readonly offen: string;
  readonly system: string;
  readonly lead: (nummer: string) => string;
  readonly unbekannt: string;

  readonly namenVerdeckt: string;
  readonly nachrichtenVerdeckt: string;

  readonly notizTitel: string;
  readonly notizErklaerung: string;
  readonly notizArt: string;
  readonly notizArten: Readonly<Record<string, string>>;
  readonly notizRichtung: string;
  readonly notizZweck: string;
  readonly notizZweckErklaerung: string;
  readonly notizAnsprechpartner: string;
  readonly notizOhneAnsprechpartner: string;
  readonly notizBetreff: string;
  readonly notizBetreffErklaerung: string;
  readonly notizInhalt: string;
  readonly notizSpeichern: string;
  readonly notizKeinRecht: string;
  readonly notizOhneKunde: string;
  readonly notiert: string;
  readonly nichtGespeichert: string;
  /** Die Abweisungen von `POST /api/crm/notiz`, je `grund`. */
  readonly notizFehler: Readonly<Record<string, string>>;
}

export const VERLAUF_TEXTE: Readonly<Record<InternSprache, VerlaufTexte>> = {
  de: {
    titel: 'Kommunikation',
    erklaerungKunde:
      'Alles, was mit diesem Kunden festgehalten oder ausgetauscht wurde — an ihm selbst, an '
      + 'seinen Leads und an seinen Ansprechpartnern: Notizen, Anrufe, E-Mails, Termine, '
      + 'Wiedervorlagen und Nachrichten, die neuesten zuerst. Bei allem, was hinausging, steht '
      + 'die Rechtsgrundlage, die im Moment des Sendens galt.',
    erklaerungKontakt:
      'Notizen, Anrufe, E-Mails und Termine mit diesem Menschen und jede Nachricht an ihn, die '
      + 'neuesten zuerst. Bei allem, was hinausging, steht die Rechtsgrundlage, die im Moment '
      + 'des Sendens galt.',
    leer: 'Noch nichts festgehalten.',
    beschriftungKunde: 'Kommunikation mit diesem Kunden, neueste zuerst',
    beschriftungKontakt: 'Kommunikation mit diesem Ansprechpartner, neueste zuerst',
    beschriftungListe: 'Aktivitäten dieser Gesellschaft, neueste zuerst',
    jungste: (n) => `Die jüngsten ${String(n)} Einträge.`,

    aktivitaetTitel: 'Aktivität',
    aktivitaetErklaerung: (tage) =>
      `Was in den letzten ${String(tage)} Tagen festgehalten wurde — Notizen, Anrufe, E-Mails, `
      + 'Termine und Wiedervorlagen an Leads, Kunden und Ansprechpartnern, die neuesten zuerst. '
      + 'Dieselbe Menge zählt die Kachel „Aktivität" der Übersicht.',

    spalteWann: 'Wann',
    spalteWas: 'Was',
    spalteWeg: 'Richtung und Weg',
    spalteBezug: 'Bezug',
    spalteWer: 'Wer',
    spalteBeleg: 'Beleg',

    arten: {
      notiz: 'Notiz', anruf: 'Anruf', email: 'E-Mail', termin: 'Termin',
      aufgabe: 'Wiedervorlage', system: 'Systemeintrag', nachricht: 'Nachricht',
    },
    richtungen: { intern: 'intern', eingehend: 'eingehend', ausgehend: 'ausgehend' },
    kanaele: {
      email: 'E-Mail', telefon: 'Telefon', sms: 'SMS', post: 'Post',
      whatsapp: 'WhatsApp', vor_ort: 'vor Ort', portal: 'Portal',
    },
    zwecke: {
      intern: 'intern', vertraglich: 'vertraglich', transaktional: 'transaktional',
      werbung: 'Werbung',
    },
    grundlagen: {
      einwilligung: 'Einwilligung', bestandskunde: 'Bestandskunde (§ 7 Abs. 3 UWG)',
      anfrage: 'Anfrage', keine: 'keine',
    },
    zustellung: {
      ausstehend: 'nicht versendet', gesendet: 'gesendet', zugestellt: 'zugestellt',
      fehlgeschlagen: 'fehlgeschlagen', unterdrueckt: 'unterdrückt',
    },
    grundlageAmTag: (g) => `Grundlage beim Senden: ${g}`,
    faellig: (w) => `fällig ${w}`,
    erledigt: 'erledigt',
    offen: 'offen',
    system: 'System',
    lead: (n) => `Lead ${n}`,
    unbekannt: '—',

    namenVerdeckt:
      'Ein „—" in der Spalte „Wer" heißt nicht, dass niemand gehandelt hat: die Namen der '
      + 'Handelnden sind Ihnen nicht sichtbar. Dafür fehlt',
    nachrichtenVerdeckt:
      'Nachrichten erscheinen hier nur, soweit Sie sie selbst geschrieben haben oder sie an '
      + 'Sie gerichtet sind. Das heißt nicht, dass es keine weiteren gibt. Für alle fehlt',

    notizTitel: 'Festhalten',
    notizErklaerung:
      'Ein Anruf, eine E-Mail, ein Termin oder eine Notiz — angelegt, nie geändert. Die Zeit '
      + 'setzt der Server.',
    notizArt: 'Art',
    notizArten: { notiz: 'Notiz', anruf: 'Anruf', email: 'E-Mail', termin: 'Termin' },
    notizRichtung: 'Richtung',
    notizZweck: 'Zweck',
    notizZweckErklaerung:
      'Nur bei ein- und ausgehend. Ausgehende Anrufe und E-Mails prüft das Sendetor gegen die '
      + 'Rechtsgrundlage des Ansprechpartners (§ 7 UWG); Werbung ohne Grundlage wird nicht '
      + 'festgehalten.',
    notizAnsprechpartner: 'Ansprechpartner',
    notizOhneAnsprechpartner: 'keiner — nur am Kunden',
    notizBetreff: 'Betreff',
    notizBetreffErklaerung: 'Freiwillig. Ohne Betreff steht die erste Zeile in der Liste.',
    notizInhalt: 'Was ist passiert?',
    notizSpeichern: 'Festhalten',
    notizKeinRecht: 'Festhalten kann, wer dieses Recht hält:',
    notizOhneKunde:
      'Dieser Ansprechpartner hängt an keinem Kunden. Eine Notiz hängt aber an einem Lead oder '
      + 'an einem Kunden — halten Sie sie am Lead fest oder ordnen Sie ihn zuerst einem Kunden zu.',
    notiert: 'Festgehalten — mit der Serverzeit.',
    nichtGespeichert: 'Nicht festgehalten.',
    notizFehler: {
      ohne_inhalt: 'Was ist passiert? Ohne Text gibt es nichts festzuhalten.',
      unbekannte_art: 'Diese Art gibt es nicht.',
      unbekannte_richtung: 'Diese Richtung gibt es nicht.',
      unbekannter_zweck: 'Diesen Zweck gibt es nicht.',
      ohne_bezug: 'Eine Notiz hängt an einem Kunden oder an einem Ansprechpartner.',
      kein_kontakt: 'Diesen Ansprechpartner gibt es hier nicht.',
      kontakt_ohne_kunde:
        'Dieser Ansprechpartner hängt an keinem Kunden. Halten Sie die Notiz am Lead fest oder '
        + 'ordnen Sie ihn zuerst einem Kunden zu.',
      fremder_kontakt: 'Dieser Ansprechpartner gehört zu einem anderen Kunden.',
      ohne_ansprechpartner:
        'Ein ausgehender Anruf oder eine ausgehende E-Mail geht an einen Menschen. Wählen Sie '
        + 'den Ansprechpartner — sonst lässt sich nicht belegen, dass er kontaktiert werden '
        + 'durfte (§ 7 UWG).',
      uwg:
        'Für diesen Kanal und diesen Zweck ist keine Rechtsgrundlage aufgezeichnet, oder der '
        + 'Kontakt hat widersprochen (§ 7 UWG). Es wurde nichts festgehalten.',
      kein_schreibrecht: 'Die Notiz wurde nicht festgehalten. Dafür fehlt das Recht.',
    },
  },
  en: {
    titel: 'Communication',
    erklaerungKunde:
      'Everything recorded or exchanged with this Kunde (customer) — on the customer, on its '
      + 'Leads and on its contacts: notes, calls, e-mails, appointments, Wiedervorlagen '
      + '(follow-ups) and messages, newest first. Whatever went out shows the legal basis that '
      + 'applied at the moment of sending.',
    erklaerungKontakt:
      'Notes, calls, e-mails and appointments with this person and every message to them, '
      + 'newest first. Whatever went out shows the legal basis that applied at the moment of '
      + 'sending.',
    leer: 'Nothing recorded yet.',
    beschriftungKunde: 'Communication with this customer, newest first',
    beschriftungKontakt: 'Communication with this contact, newest first',
    beschriftungListe: 'Activities of this company, newest first',
    jungste: (n) => `The ${String(n)} most recent entries.`,

    aktivitaetTitel: 'Activity',
    aktivitaetErklaerung: (tage) =>
      `What was recorded in the last ${String(tage)} days — notes, calls, e-mails, appointments `
      + 'and Wiedervorlagen (follow-ups) on Leads, customers and contacts, newest first. The '
      + '"Activity" tile on the overview counts the same set.',

    spalteWann: 'When',
    spalteWas: 'What',
    spalteWeg: 'Direction and channel',
    spalteBezug: 'Relates to',
    spalteWer: 'Who',
    spalteBeleg: 'Evidence',

    arten: {
      notiz: 'Note', anruf: 'Call', email: 'E-mail', termin: 'Appointment',
      aufgabe: 'Wiedervorlage (follow-up)', system: 'System entry', nachricht: 'Message',
    },
    richtungen: { intern: 'internal', eingehend: 'incoming', ausgehend: 'outgoing' },
    kanaele: {
      email: 'e-mail', telefon: 'telephone', sms: 'SMS', post: 'post',
      whatsapp: 'WhatsApp', vor_ort: 'on site', portal: 'portal',
    },
    zwecke: {
      intern: 'internal', vertraglich: 'contractual', transaktional: 'transactional',
      werbung: 'advertising',
    },
    grundlagen: {
      einwilligung: 'consent', bestandskunde: 'existing customer (§ 7(3) UWG)',
      anfrage: 'enquiry', keine: 'none',
    },
    zustellung: {
      ausstehend: 'not sent', gesendet: 'sent', zugestellt: 'delivered',
      fehlgeschlagen: 'failed', unterdrueckt: 'suppressed',
    },
    grundlageAmTag: (g) => `Basis when sent: ${g}`,
    faellig: (w) => `due ${w}`,
    erledigt: 'done',
    offen: 'open',
    system: 'System',
    lead: (n) => `Lead ${n}`,
    unbekannt: '—',

    namenVerdeckt:
      'A "—" in the "Who" column does not mean nobody acted: the names of the people involved '
      + 'are not visible to you. This requires',
    nachrichtenVerdeckt:
      'Messages appear here only where you wrote them or they are addressed to you. That does '
      + 'not mean there are no others. Seeing all of them requires',

    notizTitel: 'Record',
    notizErklaerung:
      'A call, an e-mail, an appointment or a note — created, never edited. The server sets '
      + 'the time.',
    notizArt: 'Type',
    notizArten: { notiz: 'Note', anruf: 'Call', email: 'E-mail', termin: 'Appointment' },
    notizRichtung: 'Direction',
    notizZweck: 'Purpose',
    notizZweckErklaerung:
      'Incoming and outgoing only. Outgoing calls and e-mails are checked against the '
      + 'contact’s legal basis (§ 7 UWG); advertising without a basis is not recorded.',
    notizAnsprechpartner: 'Contact',
    notizOhneAnsprechpartner: 'none — customer only',
    notizBetreff: 'Subject',
    notizBetreffErklaerung: 'Optional. Without a subject the first line appears in the list.',
    notizInhalt: 'What happened?',
    notizSpeichern: 'Record',
    notizKeinRecht: 'Recording requires this right:',
    notizOhneKunde:
      'This contact belongs to no Kunde (customer). A note belongs to a Lead or a customer — '
      + 'record it on the Lead or assign the contact to a customer first.',
    notiert: 'Recorded — with the server time.',
    nichtGespeichert: 'Not recorded.',
    notizFehler: {
      ohne_inhalt: 'What happened? Without text there is nothing to record.',
      unbekannte_art: 'This type does not exist.',
      unbekannte_richtung: 'This direction does not exist.',
      unbekannter_zweck: 'This purpose does not exist.',
      ohne_bezug: 'A note belongs to a customer or to a contact.',
      kein_kontakt: 'This contact does not exist here.',
      kontakt_ohne_kunde:
        'This contact belongs to no customer. Record the note on the Lead or assign the contact '
        + 'to a customer first.',
      fremder_kontakt: 'This contact belongs to a different customer.',
      ohne_ansprechpartner:
        'An outgoing call or e-mail goes to a person. Choose the contact — otherwise there is '
        + 'no evidence that they could be contacted (§ 7 UWG).',
      uwg:
        'No legal basis is recorded for this channel and purpose, or the contact has objected '
        + '(§ 7 UWG). Nothing was recorded.',
      kein_schreibrecht: 'The note was not recorded. The right to do so is missing.',
    },
  },
};
