// FIXTURE — must FAIL `cse/no-float-money`. Never imported by application code.
export interface RechnungsZeile {
  betrag_cent: number;
}
export function summiere(preis_cent: number): number {
  return preis_cent * 1.19;
}
