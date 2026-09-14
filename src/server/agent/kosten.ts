import 'server-only';

/**
 * Was ein Modellaufruf kostet — in **Mikrocent**, exakt und ganzzahlig
 * (AGT-04, AGT-05, K-16(b)).
 *
 * **Warum nicht Cent.** Ein Modell kostet echte Bruchteile eines Cents je
 * Aufruf. Auf Cent gerundet ist der erste Schritt 0, der zweite 0, der
 * hundertste auch — und das Monatsbudget wird nie erreicht, während die
 * Rechnung des Anbieters wächst. Mikrocent (10⁻⁶ €) sind fein genug, dass die
 * Summe stimmt, und ganzzahlig genug, dass sie sich in fünf Jahren
 * nachrechnen lässt.
 *
 * **Warum nicht `number`.** Ein Preis je Million Token mal einer Tokenzahl
 * überschreitet den sicheren Ganzzahlbereich von JavaScript nicht sofort,
 * aber `0.1 + 0.2` genügt als Erinnerung: Geld rechnet man nicht mit
 * Gleitkomma (Invariante 1). Alles hier ist `bigint`.
 *
 * **Die Rundung steht neben dem Ausdruck.** Kaufmännisch, einmal, beim
 * Quantisieren des Produkts — nicht verteilt über drei Funktionen, von denen
 * zwei anders runden.
 */

/** Preise, wie sie in `agent_preisliste` stehen: Mikrocent je Million Token. */
export interface Preis {
  readonly eingabeJeMioToken: bigint;
  readonly ausgabeJeMioToken: bigint;
  /** `null`, wo der Anbieter Denk-Token nicht getrennt berechnet. */
  readonly gedankenJeMioToken: bigint | null;
}

export interface Tokenzahl {
  readonly eingabe: bigint;
  readonly ausgabe: bigint;
  readonly gedanken: bigint;
}

const MIO = 1_000_000n;

/**
 * Ein Produkt `tokens × preis / 1.000.000`, **kaufmännisch gerundet**.
 *
 * `div(a + b/2, b)` ist die ganzzahlige Rundung auf die nächste Einheit; für
 * nicht-negative Werte ist sie half-up. Negative Tokenzahlen gibt es nicht —
 * die Signatur nimmt sie nicht an.
 */
function anteil(tokens: bigint, preisJeMio: bigint): bigint {
  if (tokens < 0n || preisJeMio < 0n) {
    throw new RangeError('Tokens und Preise sind nie negativ.');
  }
  return (tokens * preisJeMio + MIO / 2n) / MIO;
}

/**
 * Die Kosten eines Aufrufs in Mikrocent.
 *
 * Denk-Token ohne eigenen Preis zählen **wie Ausgabe-Token** — das ist die
 * Abrechnungsweise der Anbieter, die sie nicht getrennt ausweisen, und es ist
 * die teurere der beiden Auslegungen. Bei einer Budgetgrenze ist die teurere
 * Auslegung die richtige: sie stoppt früher, nie später.
 */
export function kostenMikrocent(tokens: Tokenzahl, preis: Preis): bigint {
  const gedankenPreis = preis.gedankenJeMioToken ?? preis.ausgabeJeMioToken;
  return anteil(tokens.eingabe, preis.eingabeJeMioToken)
    + anteil(tokens.ausgabe, preis.ausgabeJeMioToken)
    + anteil(tokens.gedanken, gedankenPreis);
}

/**
 * **Die eine Umrechnung nach Cent** (K-16(b), §1.12).
 *
 * Sie geschieht an der Anzeigegrenze und nirgends sonst: `div(Σ + 5000,
 * 10000)`, kaufmännisch. Gäbe es zwei Umrechnungsstellen, zeigte die
 * Budgetansicht einen anderen Betrag als der Aufwandsbericht, und beide
 * hätten recht.
 */
export function mikrocentNachCent(mikrocent: bigint): bigint {
  if (mikrocent < 0n) throw new RangeError('Kosten sind nie negativ.');
  return (mikrocent + 5000n) / 10_000n;
}

/** Für die Anzeige: „12,34 €" aus Mikrocent, ohne Zwischenrundung. */
export function mikrocentAlsEuro(mikrocent: bigint): string {
  const cent = mikrocentNachCent(mikrocent);
  const euro = cent / 100n;
  const rest = cent % 100n;
  return `${euro.toString()},${rest.toString().padStart(2, '0')} €`;
}
