import type { ReactNode } from 'react';
import type { SemantikTon } from '@/lib/design/theme';
import type { IconName } from '@/lib/design/icons';
import { Icon } from '@/components/ui/Icon';

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
  /** Ein Name aus dem Satz (DESIGN §5) — oder eigenes JSX, wenn es sein muss. */
  readonly icon?: IconName | ReactNode;
  readonly delta?: { readonly richtung: 'auf' | 'ab'; readonly text: string };
  /**
   * Die Kachel ist ein Weg (DSH-04) — dann zeigt sie es wie jede
   * interaktive Karte (DESIGN §5): Rand auf `--border-strong`, 2px hoch,
   * 200ms. `group-hover`, weil der Verweis das Elternelement ist.
   */
  readonly interaktiv?: boolean;
}

export function KpiStat({
  label, wert, ton = 'info', icon, delta, interaktiv = false,
}: KpiStatProps) {
  return (
    <div
      className={[
        'rounded-lg border border-line bg-surface p-s5',
        interaktiv
          ? 'transition duration-base ease-brand group-hover:-translate-y-0.5 group-hover:border-line-strong'
          : '',
      ].join(' ')}
    >
      <div className={`mb-s4 flex h-10 w-10 items-center justify-center rounded-md ${TINT[ton]}`}>
        {typeof icon === 'string' ? <Icon name={icon as IconName} /> : (icon ?? <Icon name="info" />)}
      </div>
      <div className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</div>
      {/* `cse-zahl`: der Wert ist eine Zahl mit Einheit und darf in einem
          RTL-Absatz nicht umgeordnet werden — siehe globals.css. */}
      <div data-cse="kpi-wert" className="cse-zahl-frei mt-s1 text-h2 text-text">{wert}</div>
      {delta !== undefined && (
        <div
          className={`mt-s2 text-sm ${delta.richtung === 'auf' ? 'text-success' : 'text-danger'}`}
        >
          {/* §9: die Farbe allein traegt die Richtung nicht — die Form auch. */}
          <Icon
            name="pfeil-runter"
            groesse="sm"
            className={`inline-block align-[-2px] ${delta.richtung === 'auf' ? 'rotate-180' : ''}`}
          />{' '}
          {delta.text}
        </div>
      )}
    </div>
  );
}
