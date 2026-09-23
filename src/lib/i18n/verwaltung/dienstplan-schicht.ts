/**
 * Die Wörter der einzelnen Schicht — in beiden Sprachen (V-013, TIM-01,
 * TIM-04, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** `Objekt`,
 * `Revier`, `Auftrag` und `Mandant` tragen Bedeutung aus Vertrag und Recht;
 * erklärt wird in Klammern, ersetzt wird nicht.
 */
import type { InternSprache } from '../intern.js';

export interface SchichtTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly warum: string;
  readonly zumPlan: string;

  readonly objekt: string;
  readonly objektWaehlen: string;
  readonly ohneKunde: string;
  readonly revier: string;
  readonly ohneRevier: string;
  readonly auftrag: string;
  readonly ohneAuftrag: string;
  readonly auftragErklaerung: string;

  readonly datum: string;
  readonly beginn: string;
  readonly ende: string;
  readonly folgetag: string;
  readonly folgetagErklaerung: string;
  readonly pause: string;
  readonly minuten: string;
  readonly soll: string;
  readonly min: string;
  readonly besetzungErklaerung: string;
  readonly notiz: string;
  readonly notizErklaerung: string;
  readonly freiwillig: string;

  readonly anlegen: string;
  readonly abbrechen: string;
  readonly keineObjekte: string;
  readonly keinSchreibrecht: string;

  /* ── Absagen ─────────────────────────────────────────────────────────── */
  readonly absagenTitel: string;
  readonly absagenErklaerung: string;
  readonly absageGrund: string;
  readonly absageGrundBeispiel: string;
  readonly absagen: string;
  readonly abgesagt: string;
  readonly abgesagtAm: string;

  readonly fehler: Readonly<Record<string, string>>;
}

export const SCHICHT_TEXTE: Readonly<Record<InternSprache, SchichtTexte>> = {
  de: {
    modul: 'Dienstplan',
    titel: 'Neue Schicht',
    untertitel: 'Eine einzelne Schicht — ohne Serie, für genau diesen Tag.',
    warum:
      'Für eine Grundreinigung am Samstag, eine zusätzliche Wache für eine Nacht oder '
      + 'einen Einsatz nach einem Wasserschaden braucht es keine Serie. Eine Serie, die '
      + 'einmal feuern soll, generiert ab morgen weiter.',
    zumPlan: 'Zum Dienstplan',

    objekt: 'Objekt',
    objektWaehlen: 'Objekt wählen',
    ohneKunde: 'kein Kunde hinterlegt',
    revier: 'Revier',
    ohneRevier: 'ohne Revier',
    auftrag: 'Auftrag',
    ohneAuftrag: 'ohne Auftrag',
    auftragErklaerung:
      'Ohne Auftrag entsteht die Schicht trotzdem — abgerechnet wird sie dann über '
      + 'eine Sonderleistung oder gar nicht. Mit Auftrag hängt sie an dessen Abrechnung.',

    datum: 'Tag',
    beginn: 'Beginn',
    ende: 'Ende',
    folgetag: 'Endet am Folgetag',
    folgetagErklaerung:
      'Für die Nachtschicht: 22:00 bis 06:00 ist ohne diesen Haken von einem Tippfehler '
      + 'nicht zu unterscheiden. Gerechnet wird in echten Zeitpunkten, auch in der Nacht '
      + 'der Zeitumstellung.',
    pause: 'Geplante Pause',
    minuten: 'Minuten',
    soll: 'Sollbesetzung',
    min: 'Mindestbesetzung',
    besetzungErklaerung:
      'Wie viele Menschen geplant sind und ab wann die Schicht als unterbesetzt gilt. '
      + 'Wer sie besetzt, entscheidet die Einteilung — mit Qualifikations- und '
      + 'ArbZG-Prüfung.',
    notiz: 'Notiz für die Planung',
    notizErklaerung: 'Nie ein Preis und nie ein Stundensatz — der Dienstplan führt kein Geld.',
    freiwillig: '(freiwillig)',

    anlegen: 'Schicht anlegen',
    abbrechen: 'Abbrechen',
    keineObjekte:
      'Diese Gesellschaft hat kein Objekt mit hinterlegtem Kunden. Eine Schicht ohne '
      + 'Kunden liesse sich später nicht abrechnen — legen Sie das Objekt und seinen '
      + 'Kunden zuerst an.',
    keinSchreibrecht: 'Zum Planen fehlt das Recht',

    absagenTitel: 'Schicht absagen',
    absagenErklaerung:
      'Die Schicht bleibt stehen und trägt den Grund — gelöscht wird nichts '
      + '(Invariante 8). Eingeteilte sehen die Absage in ihrem Plan. Ist auf der '
      + 'Schicht schon Zeit erfasst, geht es nicht: die Stunde liesse sich im Lohnlauf '
      + 'niemandem mehr zuordnen.',
    absageGrund: 'Grund der Absage',
    absageGrundBeispiel: 'Kunde hat abgesagt, Objekt nicht zugänglich …',
    absagen: 'Schicht absagen',
    abgesagt: 'Abgesagt',
    abgesagtAm: 'Abgesagt am',

    fehler: {
      unvollstaendig: 'Es fehlt eine Angabe — Objekt, Tag, Beginn und Ende sind Pflicht.',
      zeitfenster:
        'Das Zeitfenster geht so nicht: Das Ende muss nach dem Beginn liegen (oder der '
        + 'Haken „endet am Folgetag" gesetzt sein), die Schicht unter 24 Stunden dauern '
        + 'und die Pause kürzer sein als die Schicht.',
      besetzung:
        'Die Besetzung geht so nicht: Soll und Mindestbesetzung sind mindestens 1, und '
        + 'die Mindestbesetzung ist nicht grösser als das Soll.',
      kein_kunde:
        'Dieses Objekt ist keinem Kunden zugeordnet. Tragen Sie den Kunden am Objekt '
        + 'ein — ohne ihn liesse sich die Schicht nicht abrechnen und wäre für das '
        + 'Kundenportal unsichtbar.',
      nicht_gefunden: 'Diese Schicht oder dieses Objekt gehört nicht zu dieser Gesellschaft.',
      schon_storniert: 'Diese Schicht ist schon abgesagt.',
      hat_zeiten:
        'Auf dieser Schicht ist schon Zeit erfasst. Korrigieren Sie erst die '
        + 'Zeiterfassung — eine abgesagte Schicht mit erfasster Zeit liesse eine Stunde '
        + 'zurück, die im Lohnlauf niemand mehr zuordnen kann.',
      grund_fehlt:
        'Eine Absage ohne Grund ist im Lohnstreit keine Auskunft — mindestens drei Zeichen.',
      abgewiesen:
        'Die Datenbank hat den Schreibversuch abgewiesen. Fehlt das Recht in dieser '
        + 'Gesellschaft, oder steht die Ansicht auf „nur lesen"?',
    },
  },

  en: {
    modul: 'Scheduling',
    titel: 'New shift',
    untertitel: 'A single shift — no series, for this one day.',
    warum:
      'A deep clean on a Saturday, one extra guard for one night, a callout after water '
      + 'damage: none of these need a series. A series meant to fire once keeps '
      + 'generating from tomorrow on.',
    zumPlan: 'To the schedule',

    objekt: 'Objekt (site)',
    objektWaehlen: 'Choose a site',
    ohneKunde: 'no customer on file',
    revier: 'Revier (cleaning area)',
    ohneRevier: 'no Revier',
    auftrag: 'Auftrag (order)',
    ohneAuftrag: 'no Auftrag',
    auftragErklaerung:
      'Without an Auftrag the shift is still created — it is then billed through a '
      + 'Sonderleistung (one-off service) or not at all. With one, it hangs off that '
      + 'order’s billing.',

    datum: 'Day',
    beginn: 'Start',
    ende: 'End',
    folgetag: 'Ends the next day',
    folgetagErklaerung:
      'For the night shift: 22:00 to 06:00 is indistinguishable from a typo without this '
      + 'box. The calculation runs on real instants, including on the clock-change night.',
    pause: 'Planned break',
    minuten: 'minutes',
    soll: 'Planned headcount',
    min: 'Minimum headcount',
    besetzungErklaerung:
      'How many people are planned, and below which number the shift counts as '
      + 'understaffed. Who fills it is decided per shift — with the qualification and '
      + 'ArbZG (working-hours act) checks.',
    notiz: 'Note for the planner',
    notizErklaerung: 'Never a price and never an hourly rate — scheduling carries no money.',
    freiwillig: '(optional)',

    anlegen: 'Create shift',
    abbrechen: 'Cancel',
    keineObjekte:
      'This Gesellschaft (legal entity) has no site with a customer on file. A shift '
      + 'without a customer could not be billed later — create the site and its customer '
      + 'first.',
    keinSchreibrecht: 'Planning needs the right',

    absagenTitel: 'Call off the shift',
    absagenErklaerung:
      'The shift stays and carries the reason — nothing is deleted (invariant 8). '
      + 'Everyone assigned sees it in their plan. If time has already been recorded on '
      + 'the shift it will not go through: the hour could no longer be attributed to '
      + 'anyone in payroll.',
    absageGrund: 'Reason',
    absageGrundBeispiel: 'Customer called it off, site not accessible …',
    absagen: 'Call off shift',
    abgesagt: 'Called off',
    abgesagtAm: 'Called off on',

    fehler: {
      unvollstaendig: 'Something is missing — site, day, start and end are required.',
      zeitfenster:
        'The time window does not work: the end must be after the start (or tick “ends '
        + 'the next day”), the shift must be under 24 hours, and the break shorter than '
        + 'the shift.',
      besetzung:
        'The headcount does not work: planned and minimum are at least 1, and the '
        + 'minimum is not larger than the planned figure.',
      kein_kunde:
        'This site has no customer on file. Enter the customer at the site — without one '
        + 'the shift could not be billed and would be invisible in the customer portal.',
      nicht_gefunden:
        'This shift or this site does not belong to this Gesellschaft (legal entity).',
      schon_storniert: 'This shift has already been called off.',
      hat_zeiten:
        'Time has already been recorded on this shift. Correct the time records first — '
        + 'a cancelled shift with recorded time leaves an hour nobody can attribute in '
        + 'payroll.',
      grund_fehlt:
        'Calling off without a reason tells nobody anything in a wage dispute — at least '
        + 'three characters.',
      abgewiesen:
        'The database refused the write. Is the right missing in this Gesellschaft, or is '
        + 'the view read-only?',
    },
  },
};
