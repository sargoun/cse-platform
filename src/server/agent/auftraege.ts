import 'server-only';

/**
 * **Was ein Agent formulieren darf — die Liste, nicht der Rumpf der Anfrage.**
 *
 * Jeder der vier Agenten hat genau einen Auftrag, den ein Mensch von Hand
 * auslösen kann, und er steht hier: Vorlage, Vorgangsart, Titel. Der Rumpf der
 * Route bringt nur mit, WER es auslöst — nie WAS formuliert wird.
 *
 * **Warum das keine Umständlichkeit ist.** Wäre die Vorlage ein Feld im
 * Formular, liesse sich dem Modell jeder beliebige Text als „Tatsache"
 * unterschieben, und der Umweg über die Dienste wäre freiwillig. So ist er es
 * nicht: die Tatsachen kommen aus `tatsachen()`, also aus einer Funktion, die
 * SQL gegen die eigene Gesellschaft stellt.
 *
 * **Und deshalb ist die Liste kurz.** Vier Aufträge, einer je Agent — das ist
 * das, was heute an echten Daten hängt. Jeder weitere ist eine Zeile hier plus
 * die Abfrage, die ihn füttert, plus der Test, der beweist, dass keine Zahl
 * erfunden wird.
 */

export interface EntwurfAuftrag {
  readonly vorgangTyp: string;
  readonly titel: string;
  readonly vorlage: string;
  readonly tatsachen: Readonly<Record<string, string>>;
}

/**
 * Die Vorgaben. `tatsachen` steht hier als Gerüst mit den Schlüsseln, die die
 * Vorlage erwartet — gefüllt werden sie vom Dienst, der die Lage kennt
 * (`fuelleTatsachen`, unten). Ein Schlüssel ohne Wert bleibt als `{platzhalter}`
 * im Entwurf stehen und fällt auf; er wird nicht stillschweigend leer.
 */
export const ENTWURF_AUFTRAEGE: Readonly<Record<string, EntwurfAuftrag>> = {
  ceo_assistent: {
    vorgangTyp: 'interner_hinweis',
    titel: 'Lagebericht: was heute Aufmerksamkeit braucht',
    vorlage: 'interner_hinweis',
    tatsachen: {
      zusammenfassung: 'Offene Freigaben, knappe Fristen und unbesetzte Schichten '
        + 'stehen im Posteingang und im Dienstplan.',
      stand: 'heute',
      empfehlung: 'Zuerst die Vorgänge mit Frist unter vier Stunden ansehen.',
    },
  },
  akquise: {
    vorgangTyp: 'anfrage_antwort_entwurf',
    titel: 'Antwortentwurf auf die jüngste Anfrage',
    vorlage: 'anfrage_antwort_entwurf',
    tatsachen: {
      empfaenger: 'die anfragende Stelle',
      datum: 'dem Eingangsdatum der Anfrage',
      zusammenfassung: 'Die Anfrage ist erfasst; Leistung, Ort und Zeitraum stehen '
        + 'im Vorgang.',
      offen: 'die Angabe zur Personenzahl',
    },
  },
  backoffice: {
    vorgangTyp: 'interner_hinweis',
    titel: 'Hinweis: offene Leistungsnachweise',
    vorlage: 'interner_hinweis',
    tatsachen: {
      zusammenfassung: 'Es liegen Leistungsnachweise ohne Unterschrift des Kunden vor.',
      stand: 'heute',
      empfehlung: 'Objektleitung erinnert den Kunden schriftlich.',
    },
  },
  finanzen: {
    vorgangTyp: 'interner_hinweis',
    titel: 'Hinweis: offene Posten und Fälligkeiten',
    vorlage: 'interner_hinweis',
    tatsachen: {
      zusammenfassung: 'Offene Forderungen und fällige Eingangsrechnungen stehen '
        + 'in der Finanzübersicht.',
      stand: 'heute',
      empfehlung: 'Fällige Posten vor dem Monatsende ansehen.',
    },
  },
};
