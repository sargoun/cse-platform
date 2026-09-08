import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * DESIGN §1 / §9 — the business-area identity.
 *
 * The hue identifies; the NAME is what carries the meaning. §9: "colour is
 * never the only signal — area identity carries a name, not only a hue." So
 * this component always renders the label, and the hue is a 3px bar beside it
 * rather than a background.
 */
const NAME: Record<BereichSchluessel, string> = {
  reinigung: 'CSE Dienstleistung',
  security: 'SSE Security',
  bau: 'REALTIME Service',
  operations: 'CSE Operations',
};

export function AreaBadge({
  bereich,
  className = '',
}: {
  readonly bereich: BereichSchluessel;
  readonly className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-s2 text-sm text-text ${className}`}
      data-bereich={bereich}
    >
      <span
        aria-hidden="true"
        className="inline-block h-4 w-[3px] rounded-full"
        style={{ background: `var(--area-${bereich})` }}
      />
      {NAME[bereich]}
    </span>
  );
}

/** The tenant strip of §6 — the hue as a full-width rule under the header. */
export function HueBar({ bereich }: { readonly bereich: BereichSchluessel }) {
  return (
    <div
      aria-hidden="true"
      data-bereich={bereich}
      className="h-[3px] w-full"
      style={{ background: `var(--area-${bereich})` }}
    />
  );
}
