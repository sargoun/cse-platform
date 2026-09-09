import type { ReactNode } from 'react';

/**
 * DESIGN §5 Cards. Depth on dark comes from the border and the surface step,
 * never from a shadow (§3).
 */
export interface CardProps {
  readonly children: ReactNode;
  readonly interaktiv?: boolean;
  readonly className?: string;
}

export function Card({ children, interaktiv = false, className = '' }: CardProps) {
  return (
    <div
      className={[
        'rounded-lg border border-line bg-surface p-s5',
        interaktiv
          ? 'transition duration-base ease-brand hover:-translate-y-0.5 hover:border-line-strong'
          : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}
