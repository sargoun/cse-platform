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
