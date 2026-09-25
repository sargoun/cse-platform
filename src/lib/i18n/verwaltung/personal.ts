/**
 * Die Wörter der Abwesenheitsaufnahme im Büro (V-025, EMP-09, D-592).
 *
 * **`Anstellung` bleibt stehen, auch im englischen Text.** Eine Person kann in
 * mehreren Gesellschaften der Gruppe angestellt sein (D-09); „employment"
 * träfe den Begriff, verlöre aber genau die Unterscheidung, um die es geht:
 * die Abwesenheit hängt an EINER Anstellung, die Arbeitszeitgrenze des ArbZG
 * dagegen an der PERSON über alle hinweg. Wo der Begriff steht, steht die
 * Erklärung daneben.
 */
import type { InternSprache } from '../intern.js';

export interface AbwesenheitAufnahmeTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly warumErklaerung: string;

  readonly person: string;
  readonly personWaehlen: string;
  readonly personErklaerung: string;
  readonly art: string;
  readonly artWaehlen: string;
  readonly artErklaerung: string;
  readonly artOffen: string;
  readonly keineGeklaerteArt: string;

  readonly von: string;
  readonly bis: string;
  readonly halbtags: string;
  readonly zeitraumErklaerung: string;

  readonly auVorliegt: string;
  readonly auBis: string;
  readonly auErklaerung: string;

  readonly bemerkung: string;
  readonly bemerkungErklaerung: string;
  readonly freiwillig: string;

  readonly aufnehmen: string;
  readonly statusErklaerung: string;
  readonly antragErklaerung: string;
  readonly keineAnstellung: string;
  readonly keinSchreibrecht: string;
  readonly ueberlappt: string;
  /**
   * Die übrigen Abweisungen, die auf die Aufnahmeseite zurückführen (V-188):
   * vorher endeten „Bescheinigung vor dem ersten Tag" und ein `23514` der
   * Datenbank als 500, ein verkehrter Zeitraum als JSON.
   */
  readonly abgewiesen: Readonly<Record<
    'au_bis_vor_von' | 'zeitraum_verkehrt' | 'zeitraum_zu_lang' | 'kein_datum'
    | 'ungueltige_eingabe', string>>;
}

export const ABWESENHEIT_AUFNAHME_TEXTE:
Readonly<Record<InternSprache, AbwesenheitAufnahmeTexte>> = {
  de: {
    modul: 'Abwesenheiten',
    titel: 'Abwesenheit aufnehmen',
    untertitel: 'Die Krankmeldung am Telefon um 05:40',
    warumErklaerung:
      'Wer morgens anruft, hat kein Telefon in der Hand, mit dem er sich selbst '
      + 'meldet — das ist der Grund, warum er anruft. Was hier entsteht, ist '
      + 'dieselbe Zeile wie auf dem Weg der Arbeiterin; festgehalten wird '
      + 'zusätzlich, wer sie aufgenommen hat.',

    person: 'Anstellung',
    personWaehlen: 'Person wählen',
    personErklaerung:
      'Die Abwesenheit hängt an einer Anstellung, nicht an der Person: wer in '
      + 'zwei Gesellschaften der Gruppe angestellt ist, hat zwei — und die '
      + 'Meldung gilt der, in der hier gearbeitet wird.',
    art: 'Art',
    artWaehlen: 'Art wählen',
    artErklaerung:
      'Krank, Urlaub, Fortbildung, unbezahlt — die Liste pflegt die '
      + 'Stammdatenverwaltung. Welche Art bezahlt ist und unter welchem '
      + 'Lohnartenschlüssel sie läuft, ist noch offen (O-139); die Plattform '
      + 'rechnet deshalb Tage und keine Beträge.',
    artOffen: 'noch nicht hinterlegt, ob bezahlt (O-139)',
    keineGeklaerteArt:
      'Für keine Abwesenheitsart ist hinterlegt, ob sie bezahlt ist (O-139). '
      + 'Ohne diese Angabe entsteht keine Abwesenheit — eine erfundene '
      + 'Lohnregel fiele erst in der Abrechnung auf, und dann als Fehlbetrag. '
      + 'Die Angabe gehört in die Stammdaten der Abwesenheitsarten.',

    von: 'Von',
    bis: 'Bis',
    halbtags: 'halber Tag',
    zeitraumErklaerung:
      'Beide Tage zählen mit. Ein einzelner Tag steht zweimal da — einmal als '
      + 'Von und einmal als Bis. Die angerechneten Tage rechnet die Plattform '
      + 'aus den Arbeitstagen, nicht aus der Kalenderdifferenz.',

    auVorliegt: 'Arbeitsunfähigkeitsbescheinigung liegt vor',
    auBis: 'Bescheinigung gültig bis',
    auErklaerung:
      'Nur bei krankheitsbedingter Abwesenheit. Ab welchem Tag die Gruppe einen '
      + 'Nachweis verlangt, ist je Art hinterlegt — und wo es noch nicht '
      + 'hinterlegt ist, warnt die Plattform nicht (O-139).',

    bemerkung: 'Bemerkung',
    bemerkungErklaerung:
      'Was am Telefon gesagt wurde, in Ihren Worten. Eine Diagnose gehört NICHT '
      + 'hierher: sie ist ein Gesundheitsdatum nach Art. 9 DSGVO, und der '
      + 'Arbeitgeber braucht sie nicht, um eine Abwesenheit zu führen.',
    freiwillig: '(freiwillig)',

    aufnehmen: 'Abwesenheit aufnehmen',
    statusErklaerung:
      'Die Abwesenheit entsteht als „erfasst" — zur Kenntnis genommen, nicht '
      + 'genehmigt. Über eine Krankheit entscheidet niemand.',
    antragErklaerung:
      'Einen Urlaubsantrag stellt die Arbeiterin selbst. Ob das Büro ihn in '
      + 'ihrem Namen stellen darf und wer dann als Antragsteller gilt, ist noch '
      + 'zu entscheiden (O-893).',
    keineAnstellung:
      'In dieser Gesellschaft ist keine aktive Anstellung hinterlegt. Eine '
      + 'Abwesenheit hängt an einer Anstellung — die Person kommt zuerst.',
    keinSchreibrecht: 'Das Aufnehmen verlangt',
    ueberlappt:
      'Für diese Anstellung ist in diesem Zeitraum bereits eine Abwesenheit '
      + 'erfasst. Zwei Abwesenheiten über denselben Tag schliessen einander '
      + 'aus — prüfen Sie die vorhandene, statt eine zweite daneben zu stellen.',
    abgewiesen: {
      au_bis_vor_von:
        '„Bescheinigung gültig bis" liegt vor dem ersten Tag der Abwesenheit. '
        + 'Nichts wurde gespeichert — bitte prüfen Sie das Datum.',
      zeitraum_verkehrt:
        '„Bis" liegt vor „Von". Nichts wurde gespeichert — bitte prüfen Sie die beiden Tage.',
      zeitraum_zu_lang:
        'Der Zeitraum ist länger als ein Jahr. Nichts wurde gespeichert — bitte '
        + 'prüfen Sie die Jahreszahl.',
      kein_datum: 'Ein Datum ließ sich nicht lesen. Nichts wurde gespeichert.',
      ungueltige_eingabe:
        'Die Angaben passen nicht zusammen. Nichts wurde gespeichert — bitte prüfen Sie sie.',
    },
  },

  en: {
    modul: 'Absences',
    titel: 'Record an absence',
    untertitel: 'The 05:40 phone call reporting sick',
    warumErklaerung:
      'Someone who phones in the morning does not have a phone in hand to '
      + 'report it themselves — that is why they are phoning. What is created '
      + 'here is the same row as on the worker’s own path; what is additionally '
      + 'recorded is who took it down.',

    person: 'Anstellung (one employment with one Gesellschaft)',
    personWaehlen: 'Choose a person',
    personErklaerung:
      'An absence hangs off an Anstellung, not off the person: someone employed '
      + 'by two Gesellschaften of the group has two of them — and the report '
      + 'applies to the one worked here.',
    art: 'Type',
    artWaehlen: 'Choose a type',
    artErklaerung:
      'Sick, holiday, training, unpaid — the list is maintained in master data. '
      + 'Which type is paid, and under which payroll key it runs, is still open '
      + '(O-139); the platform therefore counts days, not amounts.',
    artOffen: 'not yet recorded whether paid (O-139)',
    keineGeklaerteArt:
      'For no absence type is it recorded whether it is paid (O-139). Without '
      + 'that, no absence is created — an invented payroll rule would only '
      + 'surface in the payroll run, and then as a wrong amount. The setting '
      + 'belongs in the master data for absence types.',

    von: 'From',
    bis: 'To',
    halbtags: 'half day',
    zeitraumErklaerung:
      'Both days count. A single day appears twice — once as From and once as '
      + 'To. The days credited are computed from working days, not from the '
      + 'calendar difference.',

    auVorliegt: 'Medical certificate is on file',
    auBis: 'Certificate valid until',
    auErklaerung:
      'For sickness absence only. From which day the group requires proof is '
      + 'held per type — and where it is not yet held, the platform does not '
      + 'warn (O-139).',

    bemerkung: 'Note',
    bemerkungErklaerung:
      'What was said on the phone, in your words. A diagnosis does NOT belong '
      + 'here: it is health data under Art. 9 GDPR, and the employer does not '
      + 'need it in order to record an absence.',
    freiwillig: '(optional)',

    aufnehmen: 'Record absence',
    statusErklaerung:
      'The absence is created as “erfasst” (noted) — taken note of, not '
      + 'approved. Nobody decides about an illness.',
    antragErklaerung:
      'A holiday request is made by the worker themselves. Whether the office '
      + 'may file one on their behalf, and who then counts as the applicant, is '
      + 'still to be decided (O-893).',
    keineAnstellung:
      'No active Anstellung is on file for this Gesellschaft. An absence hangs '
      + 'off an Anstellung — the person comes first.',
    keinSchreibrecht: 'Recording one requires',
    ueberlappt:
      'An absence is already on file for this Anstellung in this period. Two '
      + 'absences over the same day exclude each other — check the existing one '
      + 'rather than placing a second beside it.',
    abgewiesen: {
      au_bis_vor_von:
        '"Certificate valid until" is before the first day of the absence. '
        + 'Nothing was saved — please check the date.',
      zeitraum_verkehrt: '"To" is before "From". Nothing was saved — please check both days.',
      zeitraum_zu_lang:
        'The period is longer than a year. Nothing was saved — please check the year.',
      kein_datum: 'A date could not be read. Nothing was saved.',
      ungueltige_eingabe:
        'The details do not fit together. Nothing was saved — please check them.',
    },
  },
};
