/**
 * Kalender › Teams (V-378, O-650, D-813).
 *
 * Teams gehören dem Kalendermodul (§7.5): nach ihnen filtert der Kalender
 * (CAL-02), und eine Aufgabe kann an ein Team gehen. Eine Mitgliedschaft
 * endet, statt zu verschwinden.
 */
import type { InternSprache } from '../intern.js';

export interface KalenderTeamsTexte {
  readonly titel: string;
  readonly einleitung: string;
  readonly zumKalender: string;
  readonly keineTeams: string;
  readonly leitung: string;
  readonly bereich: string;
  readonly ohneAngabe: string;
  readonly mitglieder: string;
  readonly keineMitglieder: string;
  /** `{seit}` wird eingesetzt. */
  readonly seit: string;
  /** `{seit}` und `{bis}` werden eingesetzt. */
  readonly seitBis: string;
  readonly beendete: string;
  readonly beenden: string;
  readonly neuTitel: string;
  readonly name: string;
  readonly anlegen: string;
  readonly zuordnenTitel: string;
  readonly beschaeftigung: string;
  readonly beschaeftigungWaehlen: string;
  readonly rolle: string;
  readonly rolleHinweis: string;
  readonly zuordnen: string;
  readonly ohneSchreibrecht: string;
  readonly erfolg: Readonly<Record<string, string>>;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;
}

export const KALENDER_TEAMS_TEXTE: Readonly<Record<InternSprache, KalenderTeamsTexte>> = {
  de: {
    titel: 'Teams',
    einleitung:
      'Nach den Teams filtert der Kalender, und eine Aufgabe kann an ein Team gehen. Zugeordnet '
      + 'wird eine Beschäftigung dieser Gesellschaft; eine beendete Mitgliedschaft bleibt mit '
      + 'ihrem Ende stehen.',
    zumKalender: 'Zum Kalender',
    keineTeams: 'Noch kein Team angelegt.',
    leitung: 'Leitung',
    bereich: 'Bereich',
    ohneAngabe: '—',
    mitglieder: 'Mitglieder',
    keineMitglieder: 'Noch niemand zugeordnet.',
    seit: 'seit {seit}',
    seitBis: '{seit} bis {bis}',
    beendete: 'Beendete Mitgliedschaften',
    beenden: 'Mitgliedschaft beenden',
    neuTitel: 'Neues Team',
    name: 'Name',
    anlegen: 'Team anlegen',
    zuordnenTitel: 'Zuordnen',
    beschaeftigung: 'Beschäftigung',
    beschaeftigungWaehlen: 'Beschäftigung wählen',
    rolle: 'Rolle im Team',
    rolleHinweis: 'Vorschläge: Leitung, Stellvertretung, Mitglied, Springer — jede andere Bezeichnung geht auch.',
    zuordnen: 'Zuordnen',
    ohneSchreibrecht: 'Teams anlegen und zuordnen darf, wer Termine schreiben darf.',
    erfolg: {
      anlegen: 'Das Team ist angelegt.',
      zuordnen: 'Die Beschäftigung ist zugeordnet.',
      beenden: 'Die Mitgliedschaft ist beendet.',
    },
    fehler: {
      ohne_name: 'Ein Team braucht einen Namen.',
      zu_lang: 'Eine Angabe ist zu lang.',
      unbekanntes_team: 'Dieses Team gibt es nicht.',
      unbekannte_beschaeftigung: 'Diese Beschäftigung gibt es in dieser Gesellschaft nicht oder sie ist nicht aktiv.',
      schon_mitglied: 'Diese Beschäftigung ist schon im Team.',
      unbekannte_mitgliedschaft: 'Diese Mitgliedschaft gibt es nicht oder sie ist schon beendet.',
      unbekannte_leitung: 'Die Leitung muss Mitglied dieser Gesellschaft sein.',
      unbekannter_vorgang: 'Dieser Vorgang ist unbekannt.',
    },
    fehlerSonst: 'Der Vorgang wurde abgewiesen.',
  },
  en: {
    titel: 'Teams',
    einleitung:
      'The calendar filters by team, and a task can go to a team. What is assigned is an '
      + 'employment with this company; an ended membership stays on record with its end date.',
    zumKalender: 'To the calendar',
    keineTeams: 'No team yet.',
    leitung: 'Lead',
    bereich: 'Area',
    ohneAngabe: '—',
    mitglieder: 'Members',
    keineMitglieder: 'Nobody assigned yet.',
    seit: 'since {seit}',
    seitBis: '{seit} to {bis}',
    beendete: 'Ended memberships',
    beenden: 'End membership',
    neuTitel: 'New team',
    name: 'Name',
    anlegen: 'Create team',
    zuordnenTitel: 'Assign',
    beschaeftigung: 'Employment',
    beschaeftigungWaehlen: 'Choose an employment',
    rolle: 'Role in the team',
    rolleHinweis: 'Suggestions: Leitung, Stellvertretung, Mitglied, Springer — any other label works too.',
    zuordnen: 'Assign',
    ohneSchreibrecht: 'Creating and assigning teams requires the right to write appointments.',
    erfolg: {
      anlegen: 'The team has been created.',
      zuordnen: 'The employment has been assigned.',
      beenden: 'The membership has been ended.',
    },
    fehler: {
      ohne_name: 'A team needs a name.',
      zu_lang: 'An entry is too long.',
      unbekanntes_team: 'This team does not exist.',
      unbekannte_beschaeftigung: 'This employment does not exist in this company or is not active.',
      schon_mitglied: 'This employment is already in the team.',
      unbekannte_mitgliedschaft: 'This membership does not exist or has already ended.',
      unbekannte_leitung: 'The lead must be a member of this company.',
      unbekannter_vorgang: 'This action is unknown.',
    },
    fehlerSonst: 'The request was refused.',
  },
};
