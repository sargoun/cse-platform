/**
 * Die Wörter der Terminpflege im Kalender — in beiden Sprachen (CAL-01,
 * V-221, D-715, D-592).
 *
 * `/kalender/neu` ist neu und ganz zweisprachig; auf `/kalender` und
 * `/kalender/[id]` (noch auf der Ausnahmeliste der Übersetzungswache) kommen
 * nur die neuen Teile zweisprachig dazu.
 */
import type { InternSprache } from '../intern.js';
import type { EigeneArt, TerminAbweisung } from '../../../server/services/kalender/termin.js';

export interface KalenderTerminTexte {
  readonly neuerTermin: string;
  readonly neuTitel: string;
  readonly neuEinleitung: string;
  readonly zumKalender: string;
  readonly art: string;
  readonly arten: Readonly<Record<EigeneArt, string>>;
  readonly titel: string;
  readonly titelBeispiel: string;
  readonly ganztaegig: string;
  readonly ganztaegigHinweis: string;
  readonly beginn: string;
  readonly ende: string;
  readonly vonTag: string;
  readonly bisTag: string;
  readonly zeitHinweis: string;
  readonly ort: string;
  readonly beschreibung: string;
  readonly teilnehmende: string;
  readonly teilnehmendeHinweis: string;
  readonly teilnehmendeOhneRecht: string;
  readonly anlegen: string;
  readonly nichtGespeichert: string;
  readonly bearbeitenTitel: string;
  readonly speichern: string;
  readonly absagenTitel: string;
  readonly absageGrund: string;
  readonly absageGrundBeispiel: string;
  readonly absageHinweis: string;
  readonly absagen: string;
  readonly ohneRecht: string;
  readonly fremdeArtWiedervorlage: string;
  readonly fremdeArtGespraech: string;
  readonly abgesagtNichtAenderbar: string;
  readonly angelegt: string;
  readonly geaendert: string;
  readonly abgesagt: string;
  readonly fehler: Readonly<Record<TerminAbweisung, string>>;
  readonly fehlerSonst: string;
}

export const KALENDER_TERMIN_TEXTE: Readonly<Record<InternSprache, KalenderTerminTexte>> = {
  de: {
    neuerTermin: 'Neuer Termin',
    neuTitel: 'Neuer Termin',
    neuEinleitung:
      'Besprechungen, Kundentermine und sonstige Termine besitzt der Kalender selbst. '
      + 'Schichten entstehen im Dienstplan, Wiedervorlagen im CRM, Bewerbungsgespräche im '
      + 'Recruiting — der Kalender zeigt sie aus ihrer Quelle.',
    zumKalender: 'Zum Kalender',
    art: 'Art',
    arten: { besprechung: 'Besprechung', kundentermin: 'Kundentermin', sonstiges: 'Termin' },
    titel: 'Titel',
    titelBeispiel: 'z. B. Objektbegehung mit der Hausverwaltung',
    ganztaegig: 'Ganztägig',
    ganztaegigHinweis:
      'Ein ganztägiger Termin belegt Tage, keine Uhrzeit — im Abonnement steht er als '
      + 'Tagestermin.',
    beginn: 'Beginn (Berliner Zeit)',
    ende: 'Ende (Berliner Zeit)',
    vonTag: 'Erster Tag',
    bisTag: 'Letzter Tag',
    zeitHinweis:
      'Gemeint ist Europe/Berlin; gespeichert werden zwei Zeitpunkte in UTC. Ein Termin über '
      + 'die Zeitumstellung behält seine wirkliche Dauer.',
    ort: 'Ort',
    beschreibung: 'Beschreibung',
    teilnehmende: 'Teilnehmende',
    teilnehmendeHinweis:
      'Wer den Termin anlegt, führt ihn. Die Teilnehmenden sehen ihn unter „Nur meine" und '
      + 'in ihrem abonnierten Kalender.',
    teilnehmendeOhneRecht:
      'Andere Teilnehmende wählt, wer die Namen der Benutzer dieser Gesellschaft lesen darf:',
    anlegen: 'Termin anlegen',
    nichtGespeichert: 'Nicht gespeichert.',
    bearbeitenTitel: 'Termin ändern',
    speichern: 'Änderungen speichern',
    absagenTitel: 'Termin absagen',
    absageGrund: 'Grund',
    absageGrundBeispiel: 'z. B. Kunde hat verschoben — neuer Termin folgt',
    absageHinweis:
      'Der Termin bleibt stehen, durchgestrichen und mit Grund — wer ihn abonniert hat, '
      + 'sieht die Absage, statt dass er stillschweigend verschwindet.',
    absagen: 'Termin absagen',
    ohneRecht: 'Termine ändert und sagt ab, wer',
    fremdeArtWiedervorlage:
      'Eine Wiedervorlage ändert man an ihrer Anfrage im CRM — der Kalender zeigt sie nur.',
    fremdeArtGespraech:
      'Ein Bewerbungsgespräch ändert man im Recruiting — der Kalender zeigt es nur.',
    abgesagtNichtAenderbar: 'Ein abgesagter Termin wird nicht mehr geändert.',
    angelegt: 'Der Termin ist angelegt.',
    geaendert: 'Die Änderungen sind gespeichert.',
    abgesagt: 'Der Termin ist abgesagt. Er bleibt stehen, damit jeder die Absage sieht.',
    fehler: {
      nicht_gefunden: 'Diesen Termin gibt es nicht.',
      titel_fehlt: 'Ein Termin braucht einen Titel.',
      titel_zu_lang: 'Der Titel ist zu lang (höchstens 200 Zeichen).',
      text_zu_lang: 'Beschreibung oder Ort sind zu lang.',
      art_unbekannt: 'Besprechung, Kundentermin oder sonstiger Termin — eine andere Art gibt es hier nicht.',
      fremde_art: 'Dieser Termin gehört einer anderen Quelle und wird dort geändert.',
      ende_vor_beginn: 'Das Ende liegt nicht nach dem Beginn.',
      teilnehmer_unbekannt: 'Unter den Teilnehmenden ist jemand, der nicht zu dieser Gesellschaft gehört.',
      abgesagt: 'Dieser Termin ist abgesagt — er wird nicht mehr geändert.',
      ohne_grund: 'Eine Absage nennt ihren Grund.',
      gleichzeitig:
        'Der Termin hat sich inzwischen geändert — oder diese Sitzung darf ihn nicht ändern. '
        + 'Die Seite zeigt den aktuellen Stand.',
      zeitpunkt_unlesbar: 'Das ist kein Zeitpunkt: erwartet werden Datum und Uhrzeit.',
      kein_kalendertag: 'Diesen Tag gibt es nicht.',
      keine_uhrzeit: 'Diese Uhrzeit gibt es nicht.',
    },
    fehlerSonst: 'Der Termin wurde abgewiesen.',
  },
  en: {
    neuerTermin: 'New appointment',
    neuTitel: 'New appointment',
    neuEinleitung:
      'Meetings, customer appointments and other appointments belong to the calendar itself. '
      + 'Shifts are created in the Dienstplan, follow-ups in the CRM, interviews in Recruiting '
      + '— the calendar shows them from their source.',
    zumKalender: 'Back to the calendar',
    art: 'Type',
    arten: { besprechung: 'Meeting', kundentermin: 'Customer appointment', sonstiges: 'Appointment' },
    titel: 'Title',
    titelBeispiel: 'e.g. Site walk with the property manager',
    ganztaegig: 'All day',
    ganztaegigHinweis:
      'An all-day appointment occupies days, not a time — the subscribed calendar shows it '
      + 'as a day event.',
    beginn: 'Start (Berlin time)',
    ende: 'End (Berlin time)',
    vonTag: 'First day',
    bisTag: 'Last day',
    zeitHinweis:
      'Europe/Berlin is meant; two instants are stored in UTC. An appointment across the '
      + 'clock change keeps its real duration.',
    ort: 'Location',
    beschreibung: 'Description',
    teilnehmende: 'Participants',
    teilnehmendeHinweis:
      'Whoever creates the appointment leads it. Participants see it under “Only mine” and in '
      + 'their subscribed calendar.',
    teilnehmendeOhneRecht:
      'Other participants are chosen by whoever may read the names of this company’s users:',
    anlegen: 'Create appointment',
    nichtGespeichert: 'Not saved.',
    bearbeitenTitel: 'Change the appointment',
    speichern: 'Save changes',
    absagenTitel: 'Cancel the appointment',
    absageGrund: 'Reason',
    absageGrundBeispiel: 'e.g. Customer postponed — a new date will follow',
    absageHinweis:
      'The appointment stays, struck through and with its reason — whoever subscribed sees '
      + 'the cancellation instead of it silently disappearing.',
    absagen: 'Cancel the appointment',
    ohneRecht: 'Appointments are changed and cancelled by whoever holds',
    fremdeArtWiedervorlage:
      'A follow-up is changed on its enquiry in the CRM — the calendar only shows it.',
    fremdeArtGespraech: 'An interview is changed in Recruiting — the calendar only shows it.',
    abgesagtNichtAenderbar: 'A cancelled appointment is no longer changed.',
    angelegt: 'The appointment has been created.',
    geaendert: 'The changes have been saved.',
    abgesagt: 'The appointment is cancelled. It stays so that everyone sees the cancellation.',
    fehler: {
      nicht_gefunden: 'This appointment does not exist.',
      titel_fehlt: 'An appointment needs a title.',
      titel_zu_lang: 'The title is too long (200 characters at most).',
      text_zu_lang: 'Description or location are too long.',
      art_unbekannt: 'Meeting, customer appointment or other appointment — there is no other type here.',
      fremde_art: 'This appointment belongs to another source and is changed there.',
      ende_vor_beginn: 'The end is not after the start.',
      teilnehmer_unbekannt: 'One of the participants does not belong to this company.',
      abgesagt: 'This appointment is cancelled — it is no longer changed.',
      ohne_grund: 'A cancellation states its reason.',
      gleichzeitig:
        'The appointment has changed in the meantime — or this session may not change it. The '
        + 'page shows the current state.',
      zeitpunkt_unlesbar: 'That is not a date and time.',
      kein_kalendertag: 'That day does not exist.',
      keine_uhrzeit: 'That time does not exist.',
    },
    fehlerSonst: 'The appointment was rejected.',
  },
};
