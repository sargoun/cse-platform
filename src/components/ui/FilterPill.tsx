/** DESIGN §5 Filter pills. Inactive `--surface-3`; active white on `--ink`. */
export interface FilterPillProps {
  readonly label: string;
  readonly aktiv?: boolean;
  readonly onClick?: () => void;
}

export function FilterPill({ label, aktiv = false, onClick }: FilterPillProps) {
  return (
    <button
      type="button"
      aria-pressed={aktiv}
      onClick={onClick}
      className={[
        'inline-flex min-h-11 shrink-0 items-center rounded-full px-s4 text-sm',
        'transition-colors duration-fast ease-brand',
        aktiv ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
