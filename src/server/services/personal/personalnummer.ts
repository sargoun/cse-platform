/**
 * Die Personalnummer ist in dieser Gesellschaft schon vergeben — EIN Befund,
 * EINE Klasse, EIN Code (V-273, D-771 Nachtrag).
 *
 * **Der Befund.** Die Klasse gab es zweimal: in `einstellung.ts` mit dem Code
 * `ungueltiger_zustand`, in `anstellung.ts` mit `ungueltige_eingabe` — beide
 * mit Status 409. Eine Schnittstelle bekam für dieselbe Kollision zwei Codes,
 * je nachdem, ob sie einstellte oder den Vertrag änderte, und ein
 * `instanceof` der einen Klasse fing die andere nicht.
 *
 * **`ungueltiger_zustand`, weil die Kollision am BESTAND liegt**, nicht an der
 * Form der Eingabe: „R-7" ist eine gültige Personalnummer, nur eben schon die
 * eines anderen Menschen in dieser Gesellschaft. Derselbe Code wie
 * `DubletteImHaus` und derselbe Status 409.
 *
 * Beide Dienste führen die Klasse weiter unter ihrem Namen (sie reichen sie
 * nur durch), damit kein Aufrufer seinen Import ändern muss.
 */
export class PersonalnummerVergeben extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  /** Der Grund für `?fehler=` (D-771) — der Satz unten wiederholt die Eingabe, die Seite nicht. */
  readonly grund = 'personalnummer_vergeben';
  constructor(nummer: string) {
    super(
      `Die Personalnummer „${nummer}" ist in dieser Gesellschaft schon vergeben. `
      + 'Jede Gesellschaft führt ihre eigene Systematik (D-09) — dieselbe Nummer in '
      + 'der Schwestergesellschaft wäre in Ordnung, hier nicht.',
    );
    this.name = 'PersonalnummerVergeben';
  }
}
