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

export function Hinweis({ art = 'hinweis', cse, children, className = '' }: {
  readonly art?: HinweisArt;
  /** Der `data-cse`-Anker fuer die Browsersuite. */
  readonly cse: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section data-cse={cse} data-art={art}
             className={`rounded-lg border p-s5 text-sm ${KLASSE[art]} ${className}`}>
      {children}
    </section>
  );
}
