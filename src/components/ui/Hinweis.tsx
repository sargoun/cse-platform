import type { ReactNode } from 'react';

/**
 * Der Hinweiskasten — ein Satz mit Gewicht, in einem Rahmen (DESIGN §5
 * „Notices").
 *
 * Drei Arten, drei Toene aus dem semantischen Satz (§1): `hinweis` in der
 * Flaeche, `warnung` in `--warning`, `erfolg` in `--success`. Kein `danger`:
 * ein Fehler steht am Feld (§5 Forms) oder im Statuspill, nicht in einem
 * Kasten, der wie ein Hinweis aussieht. Die Farbe traegt die Bedeutung nicht
 * allein — der erste Satz sagt sie (§9).
 */
export type HinweisArt = 'hinweis' | 'warnung' | 'erfolg';

const KLASSE: Record<HinweisArt, string> = {
  hinweis: 'border-line bg-surface text-text',
  warnung: 'border-warning bg-warning-soft text-warning',
  erfolg: 'border-success bg-success-soft text-success',
};

export function Hinweis({
  art = 'hinweis', cse, rolle, groesse = 'sm', children, className = '',
}: {
  readonly art?: HinweisArt;
  /** Der `data-cse`-Anker fuer die Browsersuite. */
  readonly cse: string;
  /**
   * Die ARIA-Rolle, wenn der Kasten den Ausgang eines abgeschickten
   * Formulars meldet (DESIGN §5 „Notices", §9 „errors announced via
   * aria-live"): `alert` fuer eine Abweisung, `status` fuer eine Bestaetigung.
   * Ohne sie waere ein Kasten, der eine seitenweit nachgebaute Meldung mit
   * `role="alert"` ersetzt, fuer einen Screenreader stumm (V-217).
   */
  readonly rolle?: 'alert' | 'status';
  /**
   * `sm` nach DESIGN §5 „Notices"; `base` in den Bildschirmen der
   * Beschäftigten, wo Fliesstext nie kleiner als 16 px ist (§8, D-738). Eine
   * Klasse `text-base` über `className` stritte mit `text-sm` um dieselbe
   * Eigenschaft — gewinnen würde die Reihenfolge im erzeugten CSS (V-198).
   */
  readonly groesse?: 'sm' | 'base';
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section data-cse={cse} data-art={art} role={rolle}
             className={`rounded-lg border p-s5 ${groesse === 'base' ? 'text-base' : 'text-sm'} ${KLASSE[art]} ${className}`}>
      {children}
    </section>
  );
}
