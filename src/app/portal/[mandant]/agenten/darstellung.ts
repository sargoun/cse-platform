import type { PillZustand } from '@/components/ui/StatusPill';

/**
 * Der Zustand einer Agentenaufgabe als Pille — EINE Karte für das
 * Agentenblatt und das Aufgabenblatt (V-231, D-725).
 *
 * **Der Befund:** beide Blätter hatten je eine eigene Karte, und beide
 * kannten `wartet_freigabe` und `fehler` — Werte, die `agent_aufgabe_status`
 * (0128) gar nicht hat. Die echten `wartet_auf_freigabe`, `fehlgeschlagen` und
 * `gestoppt_budget` fielen auf den Rückfall „Wartet": ein gescheiterter Lauf
 * stand als wartend da. Die Schlüssel hier sind genau die sieben des Enums;
 * `tests/kern/beschriftung.test.ts` hält sie gegen die Migration.
 */
export const AUFGABE_PILLE: Readonly<Record<string, PillZustand>> = {
  wartend: 'Wartet',
  laufend: 'In Arbeit',
  wartet_auf_freigabe: 'In Prüfung',
  abgeschlossen: 'Abgeschlossen',
  fehlgeschlagen: 'Fehler',
  abgebrochen: 'Abgelehnt',
  gestoppt_budget: 'Abgelehnt',
};

/**
 * Warum auf dem Vorschaltblatt KEIN Startknopf steht — oder `null`, wenn er
 * steht (`agenten/[agent]/start`, V-230, V-271, D-764).
 *
 * **Ein Knopf, dessen Wirkung das Blatt selbst ausschliesst, steht nicht da.**
 * So hielt es das Blatt schon ohne Modell und beim Budgetstopp; ohne offene
 * Anfrage aber schrieb es „Ein Lauf entstünde deshalb nicht", und darunter
 * stand der Knopf trotzdem — sein Klick führte nur zurück auf „Kein Lauf".
 * Die Reihenfolge ist die der Hinweise auf dem Blatt; `keine_anfrage` steht
 * zuletzt, weil den Grund schon der Abschnitt „Womit er formuliert" nennt.
 */
export type StartSperre =
  'agent_aus' | 'ohne_auftrag' | 'kein_modell' | 'budget_stopp' | 'keine_anfrage';

export function startSperre(lage: {
  readonly istAktiv: boolean;
  readonly hatAuftrag: boolean;
  readonly modell: string | null;
  readonly gestoppt: boolean;
  /** `null`: `fuelleTatsachen` fand keine offene Anfrage (`KeineOffeneAnfrage`). */
  readonly tatsachen: Readonly<Record<string, string>> | null;
}): StartSperre | null {
  if (!lage.istAktiv) return 'agent_aus';
  if (!lage.hatAuftrag) return 'ohne_auftrag';
  if (lage.modell === null) return 'kein_modell';
  if (lage.gestoppt) return 'budget_stopp';
  if (lage.tatsachen === null) return 'keine_anfrage';
  return null;
}

/**
 * Der Satz eines Agentenblatts, auf dem noch kein Lauf steht (V-271).
 *
 * **Er behauptet nichts über den Modellzugang.** Dort stand „Solange kein
 * Modellzugang eingerichtet ist, bleibt das so — die Laufzeit steht, der
 * Anbieterzugang fehlt": seit dem Demobetrieb (0154) zweifelhaft, und für den
 * CEO-Assistenten seit V-229 falsch — jede Katalogfrage wird eine Aufgabe,
 * ganz ohne Modell. Dieselbe Behauptung hat V-231 in der Schrittkette schon
 * gestrichen. Wie ein Lauf entsteht, sagen die Abschnitte darüber (Knopf,
 * Modell, Budget); dieser Satz sagt nur, was ist.
 */
export function ohneLaufSatz(kennung: string): string {
  return kennung === 'ceo_assistent'
    ? 'Dieser Agent hat in dieser Gesellschaft noch keine Aufgabe. Jede Frage an den '
      + 'CEO-Assistenten wird eine — ohne Modell: die Antwort rechnet die Datenbank.'
    : 'Dieser Agent hat in dieser Gesellschaft noch keine Aufgabe.';
}
