/**
 * Die Form einer Vorgangsnummer, wie `leadnummerAus` sie baut: `L-` und die
 * ersten zehn Hexziffern der Eingangskennung, groß geschrieben.
 *
 * **Wozu hier, getrennt vom Dienst.** Die Dankseite zeigt die Nummer aus der
 * Adresse (`?nr=`) groß als „Ihre Vorgangsnummer“ (D-599). Ohne Prüfung
 * setzte jeder präparierte Link seinen eigenen Text auf die Website der
 * Firma (D-769). Die Seite zeigt deshalb nur, was diese Form hat — und die
 * Form steht an einer Stelle, die Seite und Test teilen, ohne den Dienst mit
 * seinem Datenbankzugriff in die Seite zu ziehen.
 */
export const LEADNUMMER_MUSTER = /^L-[0-9A-F]{10}$/u;

export function istLeadnummer(wert: string): boolean {
  return LEADNUMMER_MUSTER.test(wert);
}
