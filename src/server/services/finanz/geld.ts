/**
 * Money — invariant 1, K-16.
 *
 * Money is an integer number of cents held in a `bigint`, and the type is
 * branded so a plain `number` cannot reach a money parameter: the compiler
 * refuses it, and `no-float-money` refuses it a second time in review. Both
 * layers exist because the failure this prevents is silent — a float cent is
 * wrong by a fraction that only shows up after it has been invoiced.
 *
 * There is no `toNumber`. Serialisation to JSON goes through `assertSafeCents`
 * at the HTTP boundary (R-12: money crosses as an integer number of cents,
 * never a formatted string — that form is reserved for quantities, R-15).
 */

declare const CENT: unique symbol;

/** An integer number of euro cents. `1999n` is 19,99 €. */
export type Cent = bigint & { readonly [CENT]: 'Cent' };

/** Basis points. `1900` is 19,00 %. Rates are integers, never floats (K-16). */
export type BasisPunkte = number & { readonly [CENT]: 'BasisPunkte' };

export const NULL_CENT = 0n as Cent;

export class GeldFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeldFehler';
  }
}

/** The only constructor. Rejects anything that is not an integer bigint. */
export function cent(wert: bigint): Cent {
  if (typeof wert !== 'bigint') {
    throw new GeldFehler(`cent() nimmt bigint, nicht ${typeof wert}`);
  }
  return wert as Cent;
}

export function basisPunkte(wert: number): BasisPunkte {
  if (!Number.isInteger(wert)) {
    throw new GeldFehler(`Basispunkte sind ganzzahlig, nicht ${wert}`);
  }
  if (wert < 0) throw new GeldFehler(`Basispunkte sind nicht negativ: ${wert}`);
  return wert as BasisPunkte;
}

export function addiere(...werte: readonly Cent[]): Cent {
  let summe = 0n;
  for (const w of werte) summe += w;
  return summe as Cent;
}

export function subtrahiere(a: Cent, b: Cent): Cent {
  return (a - b) as Cent;
}

export function negiere(a: Cent): Cent {
  return -a as Cent;
}

/**
 * Multiply by a whole quantity. Exact — no rounding is possible, which is why
 * the quantity is an integer and a fractional quantity has to go through
 * `multipliziereMitMenge` where the rounding rule is stated at the call site.
 */
export function multipliziere(betrag: Cent, faktor: bigint): Cent {
  return (betrag * faktor) as Cent;
}

/** Half-up on a non-negative value, half-away-from-zero on a negative one. */
function teileHalbAuf(zaehler: bigint, nenner: bigint): bigint {
  if (nenner <= 0n) throw new GeldFehler('Nenner muss positiv sein');
  const negativ = zaehler < 0n;
  const abs = negativ ? -zaehler : zaehler;
  const gerundet = (abs * 2n + nenner) / (nenner * 2n);
  return negativ ? -gerundet : gerundet;
}

/**
 * Apply a basis-point rate. Rounds half-up, and the rule is named here because
 * K-16 requires the rounding rule to be stated where the rounding happens.
 */
export function anteilInBasisPunkten(betrag: Cent, satz: BasisPunkte): Cent {
  return teileHalbAuf(betrag * BigInt(satz), 10_000n) as Cent;
}

/**
 * Multiply by a quantity given as an exact scaled decimal with three places
 * (K-16: quantities are `numeric(12,3)`, and cross the wire as strings —
 * never as a float, which is the whole point of taking a string here).
 */
export function multipliziereMitMenge(einzelpreis: Cent, mengeMilli: bigint): Cent {
  return teileHalbAuf(einzelpreis * mengeMilli, 1000n) as Cent;
}

const DE_GELD = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `1999n` → `"19,99 €"`, with the non-breaking space Intl produces. */
export function formatiereGeld(betrag: Cent): string {
  const negativ = betrag < 0n;
  const abs = negativ ? -betrag : betrag;
  const euro = abs / 100n;
  const rest = abs % 100n;
  const alsZahl = Number(euro) + Number(rest) / 100;
  if (!Number.isSafeInteger(Number(euro))) {
    throw new GeldFehler(`Betrag zu groß für die Anzeige: ${betrag}`);
  }
  return DE_GELD.format(negativ ? -alsZahl : alsZahl);
}

const DE_MUSTER = /^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/u;

/**
 * `"19,99 €"` → `1999n`. German notation only: `.` groups, `,` is the decimal
 * separator. A string in another notation is refused rather than guessed —
 * `1.234` is one thousand two hundred and thirty-four euro here, and reading it
 * as one euro twenty-three is the kind of error nobody notices until an invoice
 * is out.
 */
export function parseGeld(eingabe: string): Cent {
  const roh = eingabe.replace(/ /gu, ' ').replace(/\s*€\s*$/u, '').trim();
  if (roh === '') throw new GeldFehler('Leere Eingabe');
  if (!DE_MUSTER.test(roh)) {
    throw new GeldFehler(`Kein deutsches Geldformat: ${JSON.stringify(eingabe)}`);
  }
  const negativ = roh.startsWith('-');
  const ohneVorzeichen = negativ ? roh.slice(1) : roh;
  const [ganz = '', bruch = ''] = ohneVorzeichen.split(',');
  const ganzZiffern = ganz.replace(/\./gu, '');
  const bruchZiffern = (bruch + '00').slice(0, 2);
  const betrag = BigInt(ganzZiffern) * 100n + BigInt(bruchZiffern);
  return (negativ ? -betrag : betrag) as Cent;
}

/**
 * The one projection to a JSON number, at the HTTP boundary (R-12). Refuses a
 * value JSON cannot carry exactly rather than emitting a rounded one.
 */
export function assertSafeCents(betrag: Cent): number {
  const alsZahl = Number(betrag);
  if (!Number.isSafeInteger(alsZahl)) {
    throw new GeldFehler(`Betrag überschreitet Number.MAX_SAFE_INTEGER: ${betrag}`);
  }
  return alsZahl;
}

/**
 * Distribute one amount across shares, exactly.
 *
 * **Why this is not a loop of `anteilInBasisPunkten`.** Rounding each share on
 * its own loses or gains cents: three equal shares of `100n` each round to
 * `33n`, and one cent disappears. Money that disappears in a split is money a
 * tax office asks about — §14 UStG requires the tax shown to equal the sum of
 * its parts, and an invoice whose group amounts do not add up to its total is
 * not correctable after finalisation.
 *
 * Largest remainder: floor every share, then hand the remaining cents to the
 * shares with the largest fractional part, ties going to the earlier index so
 * the result is deterministic and a test can state it.
 *
 * A `gesamt` of zero, or all-zero weights, distributes zero. Negative weights
 * are refused: a share of a negative size has no meaning here, and silently
 * treating it as zero would hide a caller's bug.
 */
export function verteileNachAnteil(
  gesamt: Cent,
  gewichte: readonly bigint[],
): readonly Cent[] {
  if (gewichte.some((g) => g < 0n)) {
    throw new GeldFehler('Negative Gewichte lassen sich nicht verteilen');
  }
  const summe = gewichte.reduce((a, b) => a + b, 0n);
  if (summe === 0n) return gewichte.map(() => 0n as Cent);

  const negativ = gesamt < 0n;
  const betrag = negativ ? -gesamt : gesamt;

  const roh = gewichte.map((g) => (betrag * g) / summe);
  const reste = gewichte.map((g, i) => ({ i, rest: (betrag * g) % summe }));
  let offen = betrag - roh.reduce((a, b) => a + b, 0n);

  reste.sort((a, b) => (b.rest === a.rest ? a.i - b.i : (b.rest > a.rest ? 1 : -1)));
  for (const { i } of reste) {
    if (offen <= 0n) break;
    roh[i] = roh[i]! + 1n;
    offen -= 1n;
  }

  return roh.map((w) => (negativ ? -w : w) as Cent);
}
