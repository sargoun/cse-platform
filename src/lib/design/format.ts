import { assertSafeCents, type Cent } from '@/server/services/finanz/geld';

/**
 * German display formats. DESIGN §5: money always `1.234,56 €`, with a
 * NON-BREAKING space before the sign so an amount never wraps across a line.
 *
 * The value arrives as `Cent`, which is where it stays: nothing here converts
 * money to a float, and `formatiereGeld` in the finance service is the same
 * function — this module only re-exports it for the UI so a component never
 * reaches into `server/services` for a formatter and pulls the rest with it.
 */
export { formatiereGeld as geld } from '@/server/services/finanz/geld';

const DE_ZAHL = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** Quantities are exact scaled decimals with three places (K-16), never floats. */
export function menge(mengeMilli: bigint): string {
  const negativ = mengeMilli < 0n;
  const abs = negativ ? -mengeMilli : mengeMilli;
  const ganz = abs / 1000n;
  const rest = abs % 1000n;
  const text = `${DE_ZAHL.format(Number(ganz) + Number(rest) / 1000)}`;
  return negativ ? `-${text}` : text;
}

/** The one JSON projection of money, kept beside the display form (R-12). */
export const alsJsonCents = assertSafeCents;

export type { Cent };
