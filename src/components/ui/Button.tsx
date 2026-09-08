import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * DESIGN §5 Buttons.
 *
 * Four variants and no fifth. `primary` is `--red`, and DESIGN's rule is one
 * primary per view — red is scarce, and a screen with three red buttons has
 * no primary action at all.
 *
 * The focus ring is not set here: `globals.css` applies it to every
 * interactive element, because a component that opts out is exactly the
 * failure §5 forbids ("never remove focus rings").
 */
export type ButtonVariante = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTE: Record<ButtonVariante, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover active:bg-brand-press font-semibold',
  secondary: 'bg-transparent border border-line-strong text-text hover:bg-surface-2',
  ghost: 'bg-transparent text-text-muted hover:bg-surface-2 hover:text-text',
  // --danger-strong, not --danger: white on --danger is 3.76:1 and fails AA.
  danger: 'bg-danger-strong text-white hover:brightness-110 font-semibold',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variante?: ButtonVariante;
  readonly children: ReactNode;
}

export function Button({
  variante = 'secondary',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      // min-h-11 is 44px — DESIGN §8's non-negotiable tap target.
      className={[
        'inline-flex min-h-11 items-center justify-center gap-s2 rounded-md px-s5 py-s3',
        'text-base transition-colors duration-fast ease-brand',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTE[variante],
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
