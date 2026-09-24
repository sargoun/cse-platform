/**
 * Die Kalkulation eines Angebots — Abweisungen und Kostenblöcke, in beiden
 * Sprachen (V-172, V-174, OPS-07, D-592).
 *
 * **Fachbegriffe bleiben deutsch** (`Kalkulation`, `Gemeinkosten`, `Wagnis
 * und Gewinn`, `Selbstkosten`): sie sind die Begriffe der Preisbegründung,
 * erklärt in Klammern, nicht ersetzt.
 *
 * **Die Abweisungen sind SCHLÜSSEL** der Route (`?fehler=…&feld=…`); die
 * Seite zeigt den Satz zum Schlüssel und nennt das Feld — nie den Schlüssel.
 */
import type { InternSprache } from '../intern.js';

export interface KalkulationTexte {
  readonly nichtBestaetigt: string;
  readonly fehler: Readonly<Record<string, string>>;
  /** Der Name des Feldes, das die Abweisung ausgelöst hat. */
  readonly feld: Readonly<Record<string, string>>;
  readonly imFeld: (feld: string) => string;
}

export const KALKULATION_TEXTE: Readonly<Record<InternSprache, KalkulationTexte>> = {
  de: {
    nichtBestaetigt: 'Nichts bestätigt, nichts neu gerechnet.',
    fehler: {
      keine_zahl:
        'Ein Wert ist keine gültige Zahl oder liegt außerhalb des Bereichs — der '
        + 'Stundensatz in Euro und größer als null (z. B. 29,00), die Zuschläge in Prozent '
        + 'von 0 bis 1.000, der Frequenzfaktor größer als null.',
      unvollstaendig:
        'Es fehlt eine Angabe: Stundensatz, Gemeinkostenbasis, Gemeinkosten- und '
        + 'Wagnis-/Gewinnzuschlag gehören zusammen.',
      eingefroren:
        'Diese Kalkulation ist festgeschrieben — das Angebot ist versendet. Ein anderer '
        + 'Preis braucht ein neues Angebot.',
      nicht_gefunden: 'Zu diesem Angebot gibt es keine Kalkulation.',
    },
    feld: {
      stundensatz: 'Stundenverrechnungssatz',
      gemeinkosten: 'Gemeinkostenzuschlag',
      wagnisGewinn: 'Wagnis und Gewinn',
      frequenzFaktor: 'Frequenzfaktor',
      gemeinkostenBasis: 'Gemeinkosten rechnen auf',
    },
    imFeld: (feld) => `Betroffen: ${feld}.`,
  },
  en: {
    nichtBestaetigt: 'Nothing was confirmed and nothing recalculated.',
    fehler: {
      keine_zahl:
        'A value is not a valid number or is out of range — the hourly rate in euro and above '
        + 'zero (e.g. 29,00), the surcharges in percent from 0 to 1,000, the frequency factor '
        + 'above zero.',
      unvollstaendig:
        'A value is missing: hourly rate, overhead base, overhead surcharge and risk/profit '
        + 'surcharge belong together.',
      eingefroren:
        'This Kalkulation (costing) is locked — the offer has been sent. A different price '
        + 'needs a new offer.',
      nicht_gefunden: 'There is no Kalkulation (costing) for this offer.',
    },
    feld: {
      stundensatz: 'Hourly charge-out rate',
      gemeinkosten: 'Gemeinkosten (overhead) surcharge',
      wagnisGewinn: 'Wagnis und Gewinn (risk and profit)',
      frequenzFaktor: 'Frequency factor',
      gemeinkostenBasis: 'Overhead is charged on',
    },
    imFeld: (feld) => `Affected: ${feld}.`,
  },
};
