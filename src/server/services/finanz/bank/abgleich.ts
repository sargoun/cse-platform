/**
 * Der Abgleich zwischen Kontoauszug und offenen Posten (ACC-04 Abnahme (2),
 * `05-FINANZEN.md` §7.4, PR 61).
 *
 * **Diese Datei ordnet nichts zu — sie SCHLÄGT VOR.** Das ist die ganze
 * Fachlichkeit von ACC-04 Abnahme (2): ein eindeutiger Treffer wird gebucht,
 * ein mehrdeutiger geht in eine Schlange, die ein Mensch abarbeitet. Wer die
 * Grenze verschiebt, bezahlt irgendwann die falsche Rechnung als bezahlt.
 *
 * **Sie ist rein**, und deshalb steht jede Regel hier als Funktion und nicht
 * als `where`-Zweig irgendwo in einem SQL-Text: eine Zuordnungsregel, die man
 * nicht ohne Datenbank prüfen kann, prüft niemand.
 *
 * **Drei Merkmale, und jedes zählt für sich** (§7.4): der Betrag, die
 * Rechnungsnummer im Verwendungszweck und die IBAN des Zahlers. Ein Treffer
 * ist EINDEUTIG, wenn genau ein offener Posten alle drei erfüllt — oder wenn
 * genau einer Betrag und Nummer erfüllt und kein zweiter auch nur nahe kommt.
 * Alles andere ist mehrdeutig.
 */

export type Trefferart =
  /** Betrag, Nummer und IBAN — der Regelfall einer Überweisung mit Zweck. */
  | 'eindeutig'
  /** Genau ein Posten mit Betrag und Nummer; die IBAN fehlt oder weicht ab. */
  | 'eindeutig_ohne_iban'
  /** Mehrere Kandidaten. Ein Mensch entscheidet. */
  | 'mehrdeutig'
  /** Keiner. Der Umsatz bleibt in der Schlange, er verschwindet nicht. */
  | 'kein_treffer';

export interface OffenerPosten {
  readonly id: string;
  readonly rechnungId: string;
  readonly nummer: string;
  /** Was noch offen ist, nicht der Rechnungsbetrag. */
  readonly offenCent: bigint;
  readonly kundeIban: string | null;
}

export interface AbgleichUmsatz {
  readonly betragCent: bigint;
  readonly richtung: 'eingang' | 'ausgang';
  readonly verwendungszweck: string;
  readonly referenz: string | null;
  readonly gegenIban: string | null;
}

export interface Vorschlag {
  readonly art: Trefferart;
  /** Bei `eindeutig*` genau einer; bei `mehrdeutig` die Kandidaten. */
  readonly kandidaten: readonly OffenerPosten[];
  /** Im Klartext, für die Schlange — nie eine Zahl ohne Satz. */
  readonly begruendung: string;
}

/**
 * Rechnungsnummern aus einem Verwendungszweck.
 *
 * **Erkannt wird das Muster, nicht ein Vorrat.** Eine Liste bekannter Nummern
 * zu durchsuchen wäre schneller und falsch: der Zahler tippt die Nummer ab,
 * und `RE 2026 00017` ist dieselbe Rechnung wie `RE-2026-00017`. Deshalb wird
 * normalisiert — alles ausser Buchstaben und Ziffern fällt weg — und danach
 * verglichen.
 *
 * Ein Zweck kann mehrere Nummern nennen (eine Sammelüberweisung, die als ein
 * Umsatz ankommt). Dann sind es mehrere.
 */
export function normalisiere(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/gu, '');
}

/**
 * Ob die Nummer im Zweck vorkommt.
 *
 * Verglichen wird auf dem normalisierten Text, und mit einer Grenze: eine
 * Nummer unter vier Zeichen wird NICHT gesucht. `RE1` käme in fast jedem
 * Zweck vor, und ein Treffer, der immer trifft, ist keiner.
 */
export function nummerImZweck(zweck: string, nummer: string): boolean {
  const n = normalisiere(nummer);
  if (n.length < 4) return false;
  return normalisiere(zweck).includes(n);
}

/** IBANs vergleichen sich ohne Leerzeichen und ohne Grossschreibung. */
export function gleicheIban(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return normalisiere(a) === normalisiere(b);
}

/**
 * Der Vorschlag zu EINEM Umsatz.
 *
 * **Ein Ausgang wird nie einer Ausgangsrechnung zugeordnet.** Das klingt
 * selbstverständlich und ist der Fehler, der bei einer Rückbuchung entsteht:
 * Betrag und Verwendungszweck passen dann perfekt, und die Rechnung gälte als
 * ein zweites Mal bezahlt.
 */
export function schlageVor(
  umsatz: AbgleichUmsatz, offene: readonly OffenerPosten[],
): Vorschlag {
  if (umsatz.richtung !== 'eingang') {
    return {
      art: 'kein_treffer',
      kandidaten: [],
      begruendung:
        'Ein Ausgang wird keiner Ausgangsrechnung zugeordnet. Bei einer '
        + 'Rückbuchung passen Betrag und Zweck, und die Rechnung gälte sonst '
        + 'ein zweites Mal als bezahlt.',
    };
  }

  const betragGleich = offene.filter((p) => p.offenCent === umsatz.betragCent);
  const zweck = `${umsatz.verwendungszweck} ${umsatz.referenz ?? ''}`;
  const mitNummer = betragGleich.filter((p) => nummerImZweck(zweck, p.nummer));

  if (mitNummer.length === 1) {
    const treffer = mitNummer[0]!;
    if (gleicheIban(treffer.kundeIban, umsatz.gegenIban)) {
      return {
        art: 'eindeutig',
        kandidaten: [treffer],
        begruendung:
          `Betrag, Rechnungsnummer ${treffer.nummer} und IBAN stimmen überein.`,
      };
    }
    return {
      art: 'eindeutig_ohne_iban',
      kandidaten: [treffer],
      begruendung:
        `Betrag und Rechnungsnummer ${treffer.nummer} stimmen überein; die `
        + (umsatz.gegenIban === null
          ? 'IBAN des Zahlers steht nicht im Auszug.'
          : 'IBAN des Zahlers ist eine andere als die hinterlegte.'),
    };
  }

  if (mitNummer.length > 1) {
    return {
      art: 'mehrdeutig',
      kandidaten: mitNummer,
      begruendung:
        `${String(mitNummer.length)} offene Posten passen auf Betrag und `
        + 'Nummer. Ein Mensch entscheidet, welcher gemeint ist.',
    };
  }

  /*
   * Keine Nummer im Zweck. Ein Betrag allein reicht NICHT — auch dann nicht,
   * wenn nur ein einziger Posten ihn trägt. Zwei Rechnungen über 119,00 € im
   * selben Monat sind der Normalfall, und die zweite käme sonst auf die
   * erste. Der Umsatz steht in der Schlange, mit dem Kandidaten daneben.
   */
  if (betragGleich.length > 0) {
    return {
      art: 'mehrdeutig',
      kandidaten: betragGleich,
      begruendung:
        `Der Betrag passt auf ${String(betragGleich.length)} offene(n) Posten, `
        + 'aber im Verwendungszweck steht keine Rechnungsnummer. Ein Betrag '
        + 'allein ordnet nichts zu.',
    };
  }

  /*
   * Auch ohne Betragstreffer wird die Nummer gesucht — eine Teilzahlung oder
   * ein Abzug ergibt einen abweichenden Betrag bei richtiger Nummer, und den
   * Umsatz dann als „kein Treffer" abzulegen hiesse, ihn zu verlieren.
   */
  const nurNummer = offene.filter((p) => nummerImZweck(zweck, p.nummer));
  if (nurNummer.length > 0) {
    return {
      art: 'mehrdeutig',
      kandidaten: nurNummer,
      begruendung:
        'Die Rechnungsnummer steht im Verwendungszweck, der Betrag weicht '
        + 'aber ab — Teilzahlung, Abzug oder Skonto. Ein Mensch entscheidet.',
    };
  }

  return {
    art: 'kein_treffer',
    kandidaten: [],
    begruendung:
      'Weder Betrag noch Rechnungsnummer passen auf einen offenen Posten. '
      + 'Der Umsatz bleibt in der Schlange.',
  };
}

/** Nur ein `eindeutig`-Treffer darf ohne Menschen gebucht werden. */
export function darfAutomatischBuchen(v: Vorschlag): boolean {
  return v.art === 'eindeutig';
}
