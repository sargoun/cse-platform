import type { Quelle } from '@/server/services/kalender/eintraege';

/**
 * Die Herkunft einer Kalenderzeile — DESIGN §5 „Calendar".
 *
 * **Warum das keine `StatusPill` ist.** Die Statuspillen sind ein FESTES
 * Vokabular für Zustände eines Datensatzes („Offen", „Abgeschlossen"); eine
 * Herkunft ist keine, sondern eine Art. Sie in das Vokabular aufzunehmen
 * hiesse, `Termin` und `Abgelehnt` in eine Liste zu stellen, in der die eine
 * Hälfte beantwortet, WORUM es geht, und die andere, WIE es steht.
 *
 * **Und es gibt keine sechs Farben.** DESIGN §5 sagt, warum: ein Kalender mit
 * sechs Farbtönen ist Dekoration — niemand lernt, welcher Ton „Vergabefrist"
 * bedeutet, und der eine Ton, der zählt (heute), geht zwischen fünf anderen
 * unter. Drei Töne beantworten die drei Fragen, die eine Kalenderzeile
 * überhaupt stellt: jemand hat es geplant, es ist der Regelbetrieb, oder es
 * läuft ab.
 */
const TON: Record<Quelle, { klassen: string; wort: string }> = {
  termin:   { klassen: 'bg-info-soft text-info',        wort: 'Termin' },
  einsatz:  { klassen: 'bg-surface-3 text-text-muted',  wort: 'Schicht' },
  projekt:  { klassen: 'bg-warning-soft text-warning',  wort: 'Projektende' },
  vergabe:  { klassen: 'bg-warning-soft text-warning',  wort: 'Vergabefrist' },
  freigabe: { klassen: 'bg-warning-soft text-warning',  wort: 'Freigabefrist' },
  lead:     { klassen: 'bg-warning-soft text-warning',  wort: 'Anfragefrist' },
};

export const quellenWort = (q: Quelle): string => TON[q].wort;

export function QuellenPill({ quelle }: { readonly quelle: Quelle }) {
  const t = TON[quelle];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-s2 py-[2px] text-xs
                  font-medium ${t.klassen}`}
    >
      {/*
        * Das Wort steht IMMER da (§9): Farbe ist nie das einzige Signal, und
        * ein Bildschirmleser liest keine Hintergrundfarbe vor.
        */}
      {t.wort}
    </span>
  );
}
