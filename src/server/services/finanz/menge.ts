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

const EN_MENGE = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

/**
 * Display a quantity in the language of the page (V-240): German `"1.234,50"`,
 * English `"1,234.50"`. Display only — a form keeps German notation, because
 * the readers of this platform read German numbers. Same guard as
 * `formatiereMenge`.
 */
export function formatiereMengeIn(menge: MilliMenge, sprache: string | null | undefined): string {
  if (sprache !== 'en') return formatiereMenge(menge);
  const negativ = menge < 0n;
  const abs = negativ ? -menge : menge;
  const ganz = abs / 1000n;
  if (!Number.isSafeInteger(Number(ganz))) {
    throw new MengeFehler(`Menge zu gross fuer die Anzeige: ${String(menge)}`);
  }
  const alsZahl = Number(ganz) + Number(abs % 1000n) / 1000;
  return EN_MENGE.format(negativ ? -alsZahl : alsZahl);
}

const DE_TAGE = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const EN_TAGE = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

/**
 * Tage für die Anzeige (V-194): `5_000n` → „5", `1_500n` → „1,5" — englisch
 * „1.5". Anzeige, nie Rechnung (R-15).
 *
 * **Warum nicht `formatiereMenge`.** Die feste zweite Nachkommastelle ist für
 * Quadratmeter und Stunden richtig und für Tage ein Lesefehler: „5,00 Tage"
 * sieht nach einer Rechnung aus, „5 Tage" ist, was auf dem Antrag stand. Ein
 * halber Tag bleibt sichtbar („0,5"), weil die Nachkommastellen nur wegfallen,
 * wo sie null sind.
 *
 * **Warum nicht „durch 1000 teilen".** Genau so zeigte das Arbeiterportal eine
 * Krankmeldung über fünf Tage mit „0": der Text aus der Datenbank ist schon
 * die Zahl (`"5.000"`), nicht ihre Tausendstel.
 */
export function formatiereTage(menge: MilliMenge, sprache?: string | null): string {
  const negativ = menge < 0n;
  const abs = negativ ? -menge : menge;
  const ganz = abs / 1000n;
  if (!Number.isSafeInteger(Number(ganz))) {
    throw new MengeFehler(`Menge zu gross fuer die Anzeige: ${String(menge)}`);
  }
  const alsZahl = Number(ganz) + Number(abs % 1000n) / 1000;
  return (sprache === 'en' ? EN_TAGE : DE_TAGE).format(negativ ? -alsZahl : alsZahl);
}

/**
 * Eine Tageszahl, wie sie aus Postgres kommt (`numeric(12,3)` als Text), für
 * die Anzeige — und `null` als Gedankenstrich (V-194).
 *
 * **Die Null-Prüfung steht HIER und nicht in `mengeAusPostgresOderNull`.**
 * Jene macht aus `null` die Menge null — für eine Summe über keine Zeilen
 * richtig, für „noch nicht berechnet" falsch: „0 Tage" behauptete eine Zahl,
 * die niemand ausgerechnet hat.
 */
export function tageAusPostgres(text: string | null, sprache?: string | null): string {
  return text === null ? '—' : formatiereTage(mengeAusPostgres(text), sprache);
}

const EINGABE_MUSTER = /^(-?)(\d{1,9})(?:[.,](\d{1,3}))?$/u;

/**
 * `"25,5"` oder `"25.5"` → `25_500n` — die Menge aus einem FORMULAR.
 *
 * **Warum das nicht `mengeAusPostgres` ist.** Der Parser oben nimmt genau die
 * Gestalt, die Postgres ausgibt, und mit Absicht keine andere: ein
 * deutschformatierter Wert bedeutet dort, dass er aus einem Formular kam und
 * noch nicht geprüft ist. Diese Funktion ist die andere Seite derselben
 * Unterscheidung — sie nimmt, was ein Mensch tippt, und gibt dieselbe geprüfte
 * `MilliMenge` zurück. Beide Wege enden im selben Typ, und keiner von beiden
 * sieht je eine Gleitkommazahl.
 *
 * **Komma und Punkt gelten beide.** Ein deutsches Tastenfeld schreibt „25,5",
 * ein Ziffernblock schickt „25.5", und beide meinen dasselbe. Die Trennung, an
 * der es hängt, ist die zwischen geprüft und ungeprüft — nicht die zwischen
 * zwei Schreibweisen desselben Zeichens.
 *
 * Eine vierte Nachkommastelle wird abgewiesen und nicht gerundet: die Spalte
 * hält drei, und stilles Runden verstecke, dass jemand etwas anderes gemeint
 * hat.
 */
export function mengeAusEingabe(text: string): MilliMenge {
  const roh = text.trim();
  if (roh === '') {
    throw new MengeFehler('Keine Menge eingegeben.');
  }
  const treffer = EINGABE_MUSTER.exec(roh);
  if (treffer === null) {
    throw new MengeFehler(
      `Das ist keine Zahl mit höchstens drei Nachkommastellen: ${JSON.stringify(text)}`);
  }
  const [, zeichen, ganz, bruch = ''] = treffer;
  const tausendstel = BigInt(ganz ?? '0') * 1000n + BigInt(bruch.padEnd(3, '0'));
  return milliMenge(zeichen === '-' ? -tausendstel : tausendstel);
}
