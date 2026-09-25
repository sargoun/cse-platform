/**
 * Die Wörter der neuen Abschnitte des Gesprächsblatts — in beiden Sprachen
 * (REC-06, CAL-01, V-220, D-714, D-592).
 *
 * **Nur die neuen Abschnitte.** Das Blatt steht noch auf der eingefrorenen
 * Ausnahmeliste der Übersetzungswache; was dazukommt, kommt zweisprachig.
 *
 * **Nie der Schlüssel selbst.** Ein unbekannter Grund aus der Adresse fällt
 * auf den allgemeinen Satz zurück (`eigenerEintrag`, D-728).
 */
import type { InternSprache } from '../intern.js';

export type GespraechErledigt = 'abgesagt' | 'verschoben' | 'vermerkt';

export interface RecruitingGespraechTexte {
  readonly statusText: Readonly<Record<'geplant' | 'stattgefunden' | 'abgesagt', string>>;
  /** `{wann}` und `{wer}` werden eingesetzt. */
  readonly abgesagtAm: string;
  readonly abgesagtGrund: string;
  readonly vermerktAm: string;
  readonly unbekanntePerson: string;
  readonly aendernTitel: string;
  readonly ohneRecht: string;
  readonly verschiebenTitel: string;
  readonly neuerTermin: string;
  readonly neuerTerminHinweis: string;
  readonly dauer: string;
  readonly dauerHinweis: string;
  readonly verschiebenKnopf: string;
  readonly absagenTitel: string;
  readonly grund: string;
  readonly grundBeispiel: string;
  readonly grundHinweis: string;
  readonly absagenKnopf: string;
  readonly vermerkenTitel: string;
  readonly vermerkenErklaerung: string;
  readonly vermerkenKnopf: string;
  readonly nochNicht: string;
  readonly nachricht: string;
  readonly nachrichtVerweis: string;
  readonly erledigt: Readonly<Record<GespraechErledigt, string>>;
  readonly nichtGeaendert: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;
}

export const RECRUITING_GESPRAECH_TEXTE:
Readonly<Record<InternSprache, RecruitingGespraechTexte>> = {
  de: {
    statusText: { geplant: 'Geplant', stattgefunden: 'Geführt', abgesagt: 'Abgesagt' },
    abgesagtAm: 'Abgesagt am {wann} von {wer}.',
    abgesagtGrund: 'Grund (intern)',
    vermerktAm: 'Als geführt vermerkt am {wann} von {wer}.',
    unbekanntePerson: 'unbekannt',
    aendernTitel: 'Termin ändern',
    ohneRecht: 'Ändern darf, wer Termine dieser Gesellschaft setzt:',
    verschiebenTitel: 'Verschieben',
    neuerTermin: 'Neuer Termin (Berliner Zeit)',
    neuerTerminHinweis:
      'Gemeint ist Europe/Berlin; gespeichert wird der Zeitpunkt in UTC. Geprüft wird gegen '
      + 'die Uhr des Servers, nicht die dieses Geräts. Der alte Termin steht im Prüfprotokoll.',
    dauer: 'Dauer in Minuten',
    dauerHinweis: '5 bis 240 Minuten.',
    verschiebenKnopf: 'Verschieben',
    absagenTitel: 'Absagen',
    grund: 'Grund (intern)',
    grundBeispiel: 'z. B. Die Bewerberin hat telefonisch abgesagt',
    grundHinweis:
      'Der Grund bleibt im Haus: im Gespräch und im Prüfprotokoll. Das Gespräch bleibt '
      + 'stehen — im Kalender und im abonnierten Kalender als abgesagt, nicht gelöscht.',
    absagenKnopf: 'Gespräch absagen',
    vermerkenTitel: 'Als geführt vermerken',
    vermerkenErklaerung:
      'Hält fest, dass das Gespräch stattgefunden hat — mit Zeitpunkt nach der Uhr des '
      + 'Servers und der Person, die es vermerkt.',
    vermerkenKnopf: 'Als geführt vermerken',
    nochNicht: 'Als geführt vermerken lässt sich das Gespräch, sobald der Termin begonnen hat.',
    nachricht:
      'Die Bewerberin erfährt davon nichts von selbst. Eine Nachricht an sie entsteht als '
      + 'Entwurf und geht erst hinaus, wenn ein Mensch sie freigegeben hat.',
    nachrichtVerweis: 'Nachricht entwerfen',
    erledigt: {
      abgesagt:
        'Das Gespräch ist abgesagt. Im Kalender steht es durchgestrichen, im abonnierten '
        + 'Kalender als abgesagt.',
      verschoben: 'Das Gespräch ist verschoben. Kalender und Abonnement zeigen den neuen Termin.',
      vermerkt: 'Das Gespräch ist als geführt vermerkt.',
    },
    nichtGeaendert: 'Nicht geändert.',
    fehler: {
      unbekannt: 'Dieses Gespräch gibt es nicht.',
      falscher_status:
        'Das Gespräch ist schon abgesagt oder als geführt vermerkt — es wird nicht mehr '
        + 'geändert. Ein neuer Termin ist ein neues Gespräch.',
      gleichzeitig:
        'Das Gespräch hat sich inzwischen geändert — oder diese Sitzung darf es nicht '
        + 'ändern. Die Seite zeigt den aktuellen Stand.',
      ohne_grund: 'Eine Absage nennt ihren Grund.',
      vergangenheit: 'Der neue Termin liegt nicht in der Zukunft.',
      unveraendert: 'Termin und Dauer sind dieselben wie bisher.',
      unbrauchbare_dauer: 'Die Dauer liegt zwischen 5 und 240 Minuten.',
      noch_nicht: 'Das Gespräch hat noch nicht begonnen.',
      zeitpunkt_unlesbar: 'Der Termin ist keiner: erwartet werden Datum und Uhrzeit.',
      kein_kalendertag: 'Diesen Tag gibt es nicht.',
      keine_uhrzeit: 'Diese Uhrzeit gibt es nicht.',
      unbekannte_aktion: 'Diese Änderung gibt es hier nicht.',
    },
    fehlerSonst: 'Die Änderung wurde abgewiesen.',
  },
  en: {
    statusText: { geplant: 'Scheduled', stattgefunden: 'Held', abgesagt: 'Cancelled' },
    abgesagtAm: 'Cancelled on {wann} by {wer}.',
    abgesagtGrund: 'Reason (internal)',
    vermerktAm: 'Recorded as held on {wann} by {wer}.',
    unbekanntePerson: 'unknown',
    aendernTitel: 'Change the appointment',
    ohneRecht: 'Changes are made by whoever sets this company’s appointments:',
    verschiebenTitel: 'Reschedule',
    neuerTermin: 'New date and time (Berlin time)',
    neuerTerminHinweis:
      'Europe/Berlin is meant; the instant is stored in UTC. It is checked against the '
      + 'server clock, not this device. The previous date stays in the audit log.',
    dauer: 'Duration in minutes',
    dauerHinweis: '5 to 240 minutes.',
    verschiebenKnopf: 'Reschedule',
    absagenTitel: 'Cancel',
    grund: 'Reason (internal)',
    grundBeispiel: 'e.g. The applicant cancelled by phone',
    grundHinweis:
      'The reason stays in-house: on the interview and in the audit log. The interview '
      + 'remains — shown as cancelled in the calendar and the subscribed calendar, not deleted.',
    absagenKnopf: 'Cancel the interview',
    vermerkenTitel: 'Record as held',
    vermerkenErklaerung:
      'Records that the interview took place — with the time from the server clock and the '
      + 'person recording it.',
    vermerkenKnopf: 'Record as held',
    nochNicht: 'The interview can be recorded as held once its start time has passed.',
    nachricht:
      'The applicant is not told automatically. A message to her is created as a draft and '
      + 'only goes out once a person has approved it.',
    nachrichtVerweis: 'Draft a message',
    erledigt: {
      abgesagt:
        'The interview is cancelled. The calendar shows it struck through, the subscribed '
        + 'calendar as cancelled.',
      verschoben:
        'The interview is rescheduled. The calendar and the subscription show the new date.',
      vermerkt: 'The interview is recorded as held.',
    },
    nichtGeaendert: 'Not changed.',
    fehler: {
      unbekannt: 'This interview does not exist.',
      falscher_status:
        'The interview is already cancelled or recorded as held — it is no longer changed. A '
        + 'new date is a new interview.',
      gleichzeitig:
        'The interview has changed in the meantime — or this session may not change it. The '
        + 'page shows the current state.',
      ohne_grund: 'A cancellation states its reason.',
      vergangenheit: 'The new date is not in the future.',
      unveraendert: 'Date and duration are the same as before.',
      unbrauchbare_dauer: 'The duration is between 5 and 240 minutes.',
      noch_nicht: 'The interview has not started yet.',
      zeitpunkt_unlesbar: 'That is not a date and time.',
      kein_kalendertag: 'That day does not exist.',
      keine_uhrzeit: 'That time does not exist.',
      unbekannte_aktion: 'That change does not exist here.',
    },
    fehlerSonst: 'The change was rejected.',
  },
};
