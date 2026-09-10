/**
 * Quantities — the other half of K-16.
 *
 * `geld.ts` says money is an integer number of cents. A quantity is the same
 * argument one column over: `numeric(12,3)` in the database, a STRING on the
 * wire (R-15), and an integer here — thousandths, so that 25,000 m² is
 * `25_000n` and nothing is ever a float.
 *
 * The parser takes the shape Postgres emits (`"25.000"`, a dot for the decimal
 * point) and nothing else. A German-formatted string (`"25,000"`) means the
 * value came from a form and has not been validated yet; accepting both here
 * would make the two indistinguishable at the one place that could still tell
 * them apart.
 */

declare const MENGE: unique symbol;

/** A quantity in thousandths. `25_000n` is 25,000 — three decimal places. */
export type MilliMenge = bigint & { readonly [MENGE]: 'MilliMenge' };

export const NULL_MENGE = 0n as MilliMenge;

export class MengeFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'MengeFehler'; }
}

/** The only constructor from an integer count of thousandths. */
export function milliMenge(wert: bigint): MilliMenge {
  if (typeof wert !== 'bigint') {
    throw new MengeFehler(`milliMenge() nimmt bigint, nicht ${typeof wert}`);
  }
  return wert as MilliMenge;
}

const PG_MUSTER = /^(-?)(\d+)(?:\.(\d{1,3}))?$/u;

/**
 * `"25.000"` → `25_000n`. The form `numeric(12,3)` takes coming out of
 * Postgres, and — deliberately — no other.
 *
 * A fourth decimal place is refused rather than rounded: the column holds
 * three, so a fourth means the value did not come from that column, and
 * quietly rounding it would hide where it did come from.
 */
export function mengeAusPostgres(text: string): MilliMenge {
  const treffer = PG_MUSTER.exec(text.trim());
  if (treffer === null) {
    throw new MengeFehler(`Keine Menge in der Form numeric(12,3): ${JSON.stringify(text)}`);
  }
  const [, zeichen, ganz, bruch = ''] = treffer;
  const tausendstel = BigInt(ganz ?? '0') * 1000n + BigInt(bruch.padEnd(3, '0'));
  return ((zeichen === '-' ? -tausendstel : tausendstel)) as MilliMenge;
}

/**
 * Der Rueckweg: `25_000n` → `"25.000"`.
 *
 * Die genaue Umkehrung von `mengeAusPostgres`, und genau deshalb hier und
 * nicht am Aufrufort. `formatiereMenge` liefert die DEUTSCHE Anzeige
 * (`"25,000"`); wer die in eine `numeric`-Spalte schreibt, bekommt entweder
 * einen Syntaxfehler oder — schlimmer — in einer anderen Locale eine andere
 * Zahl. Die Datenbank liest Punkte.
 */
export function mengeNachPostgres(menge: MilliMenge): string {
  const negativ = menge < 0n;
  const abs = negativ ? -menge : menge;
  const bruch = String(abs % 1000n).padStart(3, '0');
  return `${negativ ? '-' : ''}${String(abs / 1000n)}.${bruch}`;
}

/** `null` (an aggregate over no rows) becomes zero — every other input parses. */
export function mengeAusPostgresOderNull(text: string | null): MilliMenge {
  return text === null ? NULL_MENGE : mengeAusPostgres(text);
}

export function addiereMengen(...werte: readonly MilliMenge[]): MilliMenge {
  let summe = 0n;
  for (const w of werte) summe += w;
  return summe as MilliMenge;
}

const DE_MENGE = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

/** `25_500n` → `"25,50"` — for display only (R-15), never for arithmetic.
 *  Two decimals minimum, three maximum: `minimumFractionDigits: 2` above. */
export function formatiereMenge(menge: MilliMenge): string {
  const negativ = menge < 0n;
  const abs = negativ ? -menge : menge;
  const ganz = abs / 1000n;
  if (!Number.isSafeInteger(Number(ganz))) {
    throw new MengeFehler(`Menge zu gross fuer die Anzeige: ${String(menge)}`);
  }
  const alsZahl = Number(ganz) + Number(abs % 1000n) / 1000;
  return DE_MENGE.format(negativ ? -alsZahl : alsZahl);
}
