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

/**
 * Der runde Markenavatar aus §6: `32px`, `2px` Ring im Identitäts-Hue.
 *
 * Ohne Bild — O-12 ist offen, und ein erfundenes Logo sähe fertig aus. Bis
 * dahin trägt der Avatar die Initiale und den Ring, und der NAME steht daneben
 * (§9: die Farbe identifiziert, der Name trägt die Bedeutung).
 */
export function BereichsAvatar({
  bereich,
  aktiv = false,
}: {
  readonly bereich: BereichSchluessel;
  readonly aktiv?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      data-bereich={bereich}
      data-cse="bereichs-avatar"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full
                 bg-surface-3 text-xs font-semibold text-text"
      style={{
        boxShadow: `0 0 0 2px var(--area-${bereich})`,
        ...(aktiv ? { outline: '2px solid var(--red)', outlineOffset: '2px' } : {}),
      }}
    >
      {NAME[bereich].slice(0, 1)}
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
