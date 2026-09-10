import type { ReactNode } from 'react';
import type { SemantikTon } from '@/lib/design/theme';

/**
 * DESIGN §5 KPI stat card: a 40×40 icon tile on a `-soft` tint, a `micro`
 * uppercase label, the value at `h2`, and the delta below with an arrow.
 *
 * The arrow is there because §9 forbids colour as the only signal — a green
 * and a red number differ for a colour-blind reader only by the glyph.
 */
const TINT: Record<SemantikTon, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  muted: 'bg-surface-3 text-text-muted',
};

export interface KpiStatProps {
  readonly label: string;
  readonly wert: string;
  readonly ton?: SemantikTon;
  readonly icon?: ReactNode;
  readonly delta?: { readonly richtung: 'auf' | 'ab'; readonly text: string };
}

export function KpiStat({ label, wert, ton = 'info', icon, delta }: KpiStatProps) {
  return (
    <div className="rounded-lg border border-line bg-surface p-s5">
      <div className={`mb-s4 flex h-10 w-10 items-center justify-center rounded-md ${TINT[ton]}`}>
        {icon ?? <span aria-hidden="true">◆</span>}
      </div>
      <div className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div data-cse="kpi-wert" className="mt-s1 text-h2 text-text">{wert}</div>
      {delta !== undefined && (
        <div
          className={`mt-s2 text-sm ${delta.richtung === 'auf' ? 'text-success' : 'text-danger'}`}
        >
          <span aria-hidden="true">{delta.richtung === 'auf' ? '▲' : '▼'}</span>{' '}
          {delta.text}
        </div>
      )}
    </div>
  );
}
