/**
 * Die Benachrichtigungsarten der Agenten (NOT-01, NOT-03, AGT-05).
 *
 * Bislang genau eine — und die wichtigste, die es hier geben kann: das
 * Monatsbudget ist erschoepft und die Agenten laufen nicht mehr. Ein
 * Hartstopp, den niemand erfaehrt, ist von einem Ausfall nicht zu
 * unterscheiden; wer morgens sieht, dass seit gestern 18 Uhr kein Angebot mehr
 * vorbereitet wurde, sucht den Fehler im Code und findet ihn nicht.
 *
 * **Nicht sammelbar.** Eine Tageszusammenfassung erreicht den Empfaenger am
 * naechsten Morgen — nach einer Nacht, in der nichts lief. Genau wie bei
 * `crm.lead_sla_ueberschritten` ist Warten hier dasselbe wie Nichtstun.
 *
 * **Das Ziel ist die Budgetseite, nicht die Aufgabenliste.** NOT-03 verlangt
 * eine Meldung, an deren Ende etwas zu TUN ist: das Budget erhoehen oder den
 * Stopp bestaetigen. Die Liste der abgelehnten Laeufe zeigt nur die Folge.
 */
import { registriereArt, type ArtDefinition } from '../benachrichtigung/registry.js';

/**
 * Die Definition steht VOR der Registrierung, und der Schluessel wird aus ihr
 * gelesen — nicht als eigenes Literal danebengeschrieben.
 *
 * Das ist kein Stilentscheid: die K-19-Pruefung sucht Rechteschluessel im
 * Code, und eine Benachrichtigungsart hat dieselbe Form (`<modul>.<etwas>`,
 * von der Tabelle sogar per CHECK erzwungen). Sie schneidet Registerkennungen
 * an `schluessel:` heraus — steht der Schluessel zusaetzlich als freies
 * Literal da, meldet die Pruefung ihn als Recht ohne Katalogzeile. Wer das
 * einmal sieht, benennt seine Art um, statt den echten Fund zu suchen; genau
 * davor warnt `scripts/katalog/benutzung.ts`.
 *
 * Derselbe Schluessel steht in `app.agent_stopp_vermerken` (Migration 0128).
 */
const BUDGET_ERSCHOEPFT = {
  schluessel: 'agent.budget_erschoepft',
  titel: () => 'KI-Budget erschöpft — die Agenten sind gestoppt',
  text: (k) => {
    const monat = String(k.daten['monat'] ?? '');
    return 'Das Monatsbudget für die KI-Agenten'
      + (monat === '' ? '' : ` (${monat})`)
      + ' ist erreicht. Weitere Läufe werden abgelehnt, bis das Budget '
      + 'erhöht wird oder der Monat wechselt. Manuelle Arbeit ist nicht '
      + 'betroffen.';
  },
  ziel: (k) => (k.objektId === '' ? null : `/portal/${k.mandantId}/agenten/budget`),
  kanaeleVorgabe: ['app', 'email'],
  sammelbar: false,
} as const satisfies ArtDefinition;

export const ART_BUDGET_ERSCHOEPFT: string = BUDGET_ERSCHOEPFT.schluessel;

export function registriereAgentArten(): readonly ArtDefinition[] {
  return [registriereArt(BUDGET_ERSCHOEPFT)];
}
