/**
 * Die Wörter der Serienpflege — in beiden Sprachen (V-021, TIM-02, TIM-03,
 * D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** `Turnus`,
 * `Posten`, `Revier` und `Mandant` tragen Bedeutung aus Vertrag und Recht;
 * erklärt wird in Klammern, ersetzt wird nicht.
 */
import type { InternSprache } from '../intern.js';

export interface SeriePflegeTexte {
  readonly pflegeTitel: string;
  readonly pflegeErklaerung: string;

  readonly regelTitel: string;
  readonly regelErklaerung: string;
  readonly bezeichnung: string;
  readonly wochentage: string;
  readonly beginn: string;
  readonly dauer: string;
  readonly minuten: string;
  readonly feiertage: string;
  readonly feiertageAusfall: string;
  readonly feiertageUnveraendert: string;
  readonly regelSpeichern: string;
  readonly nurTurnus: string;

  readonly laufTitel: string;
  readonly laufErklaerung: string;
  readonly horizont: string;
  readonly horizontErklaerung: string;
  readonly bundesland: string;
  readonly laufSpeichern: string;

  readonly beendenTitel: string;
  readonly beendenErklaerung: string;
  readonly beendenBis: string;
  readonly beenden: string;

  readonly archivTitel: string;
  readonly archivErklaerung: string;
  readonly archivGrund: string;
  readonly archivGrundBeispiel: string;
  readonly archivieren: string;
  readonly schonArchiviert: string;

  readonly erledigt: Readonly<Record<string, string>>;
  readonly bilanz: string;
  readonly keinSchreibrecht: string;
  readonly fehler: Readonly<Record<string, string>>;
}

export const SERIE_PFLEGE_TEXTE: Readonly<Record<InternSprache, SeriePflegeTexte>> = {
  de: {
    pflegeTitel: 'Serie pflegen',
    pflegeErklaerung:
      'Jede Änderung wirkt sofort: der Generator läuft mit und schreibt die künftigen '
      + 'Schichten um. Angefasst werden nur Schichten, die noch nicht begonnen haben und '
      + 'auf denen keine Zeit erfasst ist — die Vergangenheit wird nicht umgeschrieben.',

    regelTitel: 'Regel ändern',
    regelErklaerung:
      'Wochentage, Beginn, Dauer und die Feiertagsregel stehen auf dem Turnus, nicht auf '
      + 'der Serie — die Serie ist das Ausführungsprotokoll des Generators.',
    bezeichnung: 'Bezeichnung',
    wochentage: 'Wochentage',
    beginn: 'Beginn',
    dauer: 'Dauer',
    minuten: 'Minuten',
    feiertage: 'An gesetzlichen Feiertagen',
    feiertageAusfall: 'fällt aus',
    feiertageUnveraendert: 'findet statt',
    regelSpeichern: 'Regel speichern',
    nurTurnus:
      'Die Regel dieser Serie steht nicht auf einem Turnus. Eine Postenserie ändern Sie am '
      + 'Posten (Sicherheit → Posten); eine Veranstaltung ist ein einzelnes Fenster und '
      + 'gar keine Regel.',

    laufTitel: 'Lauf des Generators',
    laufErklaerung:
      'Wie weit im Voraus Schichten entstehen und was an Feiertagen gilt. Das gehört der '
      + 'Serie selbst, nicht dem Turnus.',
    horizont: 'Horizont',
    horizontErklaerung:
      'Tage im Voraus, 1 bis 400. Ein grosser Horizont zeigt früh, was kommt — und '
      + 'erzeugt früh Schichten, die eine Vertragsänderung wieder absagt.',
    bundesland: 'Bundesland für die Feiertage',
    laufSpeichern: 'Lauf speichern',

    beendenTitel: 'Serie beenden',
    beendenErklaerung:
      'Bis einschliesslich diesem Tag läuft die Serie weiter; was danach schon im Plan '
      + 'steht, wird abgesagt. Der Turnus bleibt stehen und trägt sein Ende — gelöscht '
      + 'wird nichts (Invariante 8).',
    beendenBis: 'Letzter Tag',
    beenden: 'Serie beenden',

    archivTitel: 'Serie archivieren',
    archivErklaerung:
      'Die Serie erzeugt ab sofort nichts mehr, und alle noch nicht begonnenen Schichten '
      + 'werden abgesagt — ein Generator, der die Serie nicht mehr liest, könnte sie auch '
      + 'nicht mehr aufräumen. Der Turnus oder Posten bleibt bestehen; für ihn lässt sich '
      + 'später wieder eine Serie anlegen.',
    archivGrund: 'Grund',
    archivGrundBeispiel: 'Vertrag gekündigt, Objekt abgegeben …',
    archivieren: 'Serie archivieren',
    schonArchiviert:
      'Diese Serie ist archiviert und erzeugt nichts mehr. Sie bleibt als Spur stehen; '
      + 'für denselben Träger lässt sich eine neue Serie anlegen.',

    erledigt: {
      lauf: 'Der Lauf der Serie ist geändert.',
      regel: 'Die Regel ist geändert.',
      beenden: 'Die Serie ist beendet.',
      archivieren: 'Die Serie ist archiviert.',
    },
    bilanz: 'Schichten erzeugt bzw. abgesagt',
    keinSchreibrecht: 'Zum Pflegen fehlt das Recht',

    fehler: {
      nicht_gefunden: 'Diese Serie oder ihr Träger ist nicht erreichbar.',
      kein_turnus:
        'Die Regel dieser Serie steht nicht auf einem Turnus — eine Postenserie ändern Sie '
        + 'am Posten, eine Veranstaltung an der Veranstaltung.',
      unvollstaendig:
        'Es fehlt eine Angabe oder sie liegt ausserhalb des Erlaubten: Horizont 1–400 Tage, '
        + 'Dauer 15 Minuten bis knapp 24 Stunden, Beginn als HH:MM, Datum als JJJJ-MM-TT.',
      zeitraum: 'Das Ende liegt vor dem Beginn der Serie.',
      schon_archiviert: 'Diese Serie ist schon archiviert und erzeugt nichts mehr.',
      grund_fehlt:
        'Eine Archivierung ohne Grund ist keine Auskunft — mindestens drei Zeichen. Der '
        + 'Grund steht später an jeder abgesagten Schicht.',
      abgewiesen:
        'Die Datenbank hat den Schreibversuch abgewiesen. Fehlt das Gewerkerecht in dieser '
        + 'Gesellschaft, oder steht die Ansicht auf „nur lesen"?',
    },
  },

  en: {
    pflegeTitel: 'Maintain series',
    pflegeErklaerung:
      'Every change takes effect at once: the generator runs with it and rewrites the '
      + 'upcoming shifts. Only shifts that have not started and carry no recorded time are '
      + 'touched — the past is not rewritten.',

    regelTitel: 'Change the rule',
    regelErklaerung:
      'Weekdays, start, duration and the public-holiday rule live on the Turnus (recurring '
      + 'cleaning pattern), not on the series — the series is the generator’s execution log.',
    bezeichnung: 'Name',
    wochentage: 'Weekdays',
    beginn: 'Start',
    dauer: 'Duration',
    minuten: 'minutes',
    feiertage: 'On public holidays',
    feiertageAusfall: 'does not run',
    feiertageUnveraendert: 'runs as usual',
    regelSpeichern: 'Save rule',
    nurTurnus:
      'This series’ rule does not live on a Turnus. Change a Posten (guard post) series at '
      + 'the Posten (Security → Posten); a Veranstaltung (event) is a single window and not '
      + 'a rule at all.',

    laufTitel: 'Generator run',
    laufErklaerung:
      'How far ahead shifts are created and what applies on public holidays. This belongs '
      + 'to the series itself, not to the Turnus.',
    horizont: 'Horizon',
    horizontErklaerung:
      'Days ahead, 1 to 400. A long horizon shows what is coming early — and creates shifts '
      + 'early that a contract change then calls off again.',
    bundesland: 'Federal state for public holidays',
    laufSpeichern: 'Save run settings',

    beendenTitel: 'End the series',
    beendenErklaerung:
      'The series runs up to and including this day; anything already scheduled after it is '
      + 'called off. The Turnus stays and carries its end date — nothing is deleted '
      + '(invariant 8).',
    beendenBis: 'Last day',
    beenden: 'End series',

    archivTitel: 'Archive the series',
    archivErklaerung:
      'The series creates nothing from now on, and every shift that has not started is '
      + 'called off — a generator that no longer reads the series could not tidy it up '
      + 'either. The Turnus or Posten stays; a new series can be created for it later.',
    archivGrund: 'Reason',
    archivGrundBeispiel: 'Contract terminated, site handed back …',
    archivieren: 'Archive series',
    schonArchiviert:
      'This series is archived and creates nothing. It stays as a record; a new series can '
      + 'be created for the same carrier.',

    erledigt: {
      lauf: 'The series’ run settings were changed.',
      regel: 'The rule was changed.',
      beenden: 'The series was ended.',
      archivieren: 'The series was archived.',
    },
    bilanz: 'shifts created / called off',
    keinSchreibrecht: 'Maintaining this needs the right',

    fehler: {
      nicht_gefunden: 'This series or its carrier is not reachable.',
      kein_turnus:
        'This series’ rule does not live on a Turnus — change a Posten series at the Posten, '
        + 'an event at the event.',
      unvollstaendig:
        'Something is missing or out of range: horizon 1–400 days, duration 15 minutes to '
        + 'just under 24 hours, start as HH:MM, date as YYYY-MM-DD.',
      zeitraum: 'The end lies before the start of the series.',
      schon_archiviert: 'This series is already archived and creates nothing.',
      grund_fehlt:
        'Archiving without a reason tells nobody anything — at least three characters. The '
        + 'reason ends up on every shift that is called off.',
      abgewiesen:
        'The database refused the write. Is the trade right missing in this Gesellschaft '
        + '(legal entity), or is the view read-only?',
    },
  },
};
