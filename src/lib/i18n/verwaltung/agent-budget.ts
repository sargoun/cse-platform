/**
 * Die Wörter der Budgetpflege — in beiden Sprachen (V-015, AGT-05, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** `Mandant`
 * und `Gesellschaft` tragen Rechtsbedeutung; erklärt wird in Klammern.
 */
import type { InternSprache } from '../intern.js';

export interface BudgetTexte {
  readonly titel: string;
  readonly erklaerung: string;
  readonly warumRecht: string;

  readonly geltung: string;
  readonly fuerMandant: string;
  readonly fuerAgent: string;
  readonly jahr: string;
  readonly monat: string;
  readonly betrag: string;
  readonly betragErklaerung: string;
  readonly stopp: string;
  readonly stoppErklaerung: string;
  readonly warnschwelle: string;
  readonly warnschwelleErklaerung: string;
  readonly prozent: string;
  readonly freiwillig: string;
  readonly speichern: string;

  readonly gesetzt: string;
  readonly keinSchreibrecht: string;
  readonly fehler: Readonly<Record<string, string>>;
}

export const BUDGET_TEXTE: Readonly<Record<InternSprache, BudgetTexte>> = {
  de: {
    titel: 'Obergrenze setzen',
    erklaerung:
      'Ohne eingetragene Obergrenze läuft kein Agent: die Prüfung antwortet dann mit '
      + '„kein Budget entschieden" und lehnt jeden Lauf ab. Eine Zeile je Monat — für die '
      + 'Gesellschaft insgesamt oder für einen einzelnen Agenten; die Zeile des Agenten '
      + 'gewinnt, wenn es beide gibt.',
    warumRecht:
      'Diese Maske hängt bewusst an einem anderen Recht als das Starten einer '
      + 'Agentenaufgabe: wer begrenzt wird, verstellt seine Grenze nicht selbst (AGT-05).',

    geltung: 'Gilt für',
    fuerMandant: 'die ganze Gesellschaft',
    fuerAgent: 'nur diesen Agenten',
    jahr: 'Jahr',
    monat: 'Monat',
    betrag: 'Obergrenze in Euro',
    betragErklaerung:
      'Deutsche Schreibweise: Punkt trennt die Tausender, Komma die Cent — „1.250,00". '
      + 'Es gibt keinen Vorschlagswert; welche Höhe richtig ist, ist eine Frage an den '
      + 'Mandanten (O-26), und ein Vorschlag in einer Finanzmaske sähe aus wie eine '
      + 'Abstimmung. 0,00 € ist erlaubt und heisst „in diesem Monat nichts".',
    stopp: 'Bei Überschreitung hart stoppen',
    stoppErklaerung:
      'Ohne Haken läuft der Agent über die Grenze hinaus weiter und die Überschreitung '
      + 'steht nur im Protokoll.',
    warnschwelle: 'Warnschwelle',
    warnschwelleErklaerung:
      'Ab welchem Anteil des Monatsbudgets gewarnt wird. Leer lassen, solange es dafür '
      + 'keine Entscheidung gibt (O-195) — ein erfundener Wert sähe abgestimmt aus.',
    prozent: 'Prozent',
    freiwillig: '(freiwillig)',
    speichern: 'Obergrenze speichern',

    gesetzt:
      'Die Obergrenze ist gesetzt. Ein zuvor gesetzter Stopp ist damit aufgehoben — der '
      + 'nächste Lauf setzt ihn neu, wenn auch die neue Grenze reisst.',
    keinSchreibrecht: 'Zum Setzen der Obergrenze fehlt das Recht',
    fehler: {
      kein_betrag:
        'Das ist kein Betrag in deutscher Schreibweise. Punkt trennt die Tausender, '
        + 'Komma die Cent — „1.250,00".',
      negativ:
        'Eine Obergrenze ist nicht negativ. Wer nichts ausgeben will, trägt 0,00 € ein.',
      zeitraum: 'Jahr und Monat gehören zu einem Monat zwischen 2000 und 2100.',
      schwelle:
        'Die Warnschwelle ist ein Anteil zwischen 1 und 100 Prozent — oder sie bleibt leer.',
      kein_agent: 'Ein Budget je Agent braucht den Agenten.',
      unvollstaendig: 'Es fehlt eine Angabe.',
      abgewiesen:
        'Die Datenbank hat den Schreibversuch abgewiesen. Fehlt `agent.budget_verwalten` '
        + 'in dieser Gesellschaft, oder steht die Ansicht auf „nur lesen"?',
    },
  },

  en: {
    titel: 'Set the cap',
    erklaerung:
      'Without a cap on file no agent runs: the check answers “no budget decided” and '
      + 'refuses every run. One row per month — for the whole Gesellschaft (legal entity) '
      + 'or for a single agent; the agent’s row wins where both exist.',
    warumRecht:
      'This form deliberately hangs off a different right than starting an agent task: '
      + 'whoever is capped does not move their own cap (AGT-05).',

    geltung: 'Applies to',
    fuerMandant: 'the whole Gesellschaft',
    fuerAgent: 'this agent only',
    jahr: 'Year',
    monat: 'Month',
    betrag: 'Cap in euro',
    betragErklaerung:
      'German notation: full stop groups thousands, comma separates the cents — '
      + '“1.250,00”. There is no suggested value; what the right figure is remains a '
      + 'question for the client (O-26), and a suggestion in a financial form would look '
      + 'like agreement. 0,00 € is allowed and means “nothing this month”.',
    stopp: 'Hard stop when exceeded',
    stoppErklaerung:
      'Unticked, the agent keeps running past the cap and the overrun only shows in the '
      + 'audit log.',
    warnschwelle: 'Warning threshold',
    warnschwelleErklaerung:
      'The share of the monthly budget at which to warn. Leave it empty while there is no '
      + 'decision (O-195) — an invented figure would look agreed.',
    prozent: 'percent',
    freiwillig: '(optional)',
    speichern: 'Save cap',

    gesetzt:
      'The cap is set. Any earlier stop is lifted with it — the next run sets it again if '
      + 'the new cap is breached too.',
    keinSchreibrecht: 'Setting the cap needs the right',
    fehler: {
      kein_betrag:
        'That is not an amount in German notation. Full stop groups thousands, comma '
        + 'separates the cents — “1.250,00”.',
      negativ: 'A cap is not negative. To spend nothing, enter 0,00 €.',
      zeitraum: 'Year and month must be a month between 2000 and 2100.',
      schwelle: 'The warning threshold is a share between 1 and 100 percent — or empty.',
      kein_agent: 'A per-agent budget needs the agent.',
      unvollstaendig: 'Something is missing.',
      abgewiesen:
        'The database refused the write. Is `agent.budget_verwalten` missing in this '
        + 'Gesellschaft, or is the view read-only?',
    },
  },
};
