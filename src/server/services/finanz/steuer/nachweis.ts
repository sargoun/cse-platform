import 'server-only';

/**
 * §13b UStG — wann die Steuerschuld auf den Leistungsempfänger übergeht
 * (FIN-09, LEG-06, PR 51).
 *
 * **Zwei Tatbestände, nicht einer.** §13b Abs. 2 Nr. 4 UStG verlagert bei
 * BAULEISTUNGEN an einen Unternehmer, der selbst nachhaltig Bauleistungen
 * erbringt; Nr. 8 bei GEBÄUDEREINIGUNGS­leistungen an einen Unternehmer, der
 * selbst Gebäudereinigungsleistungen erbringt. In dieser Gruppe ist der zweite
 * der häufigere — die CSE Dienstleistungen vergibt Reinigung regelmässig an
 * Nachunternehmer —, und ein Bau-only-Kennzeichen hätte ihn nicht darstellen
 * können.
 *
 * **Der Status wird am LEISTUNGSDATUM gelesen, nicht heute.** Ein Kunde, der
 * seit letztem Monat kein Bauleistender mehr ist, war es im August; eine
 * Rechnung über August muss das tragen. Ein boolesches Kennzeichen auf `kunde`
 * hätte jede historische Rechnung beim nächsten Statuswechsel rückwirkend
 * umgedeutet.
 */

/** Die beiden Tatbestände, die es gibt — der Enumwert der Datenbank. */
export type Bauleistungsart = 'bau' | 'gebaeudereinigung';

export interface StatusZeile {
  readonly leistungsart: Bauleistungsart;
  readonly istBauleistender: boolean;
  readonly giltAb: string;
  readonly giltBis: string | null;
  readonly grundlage: string;
}

export interface ReverseChargeLage {
  /** Ob die Steuerschuld übergeht. */
  readonly greift: boolean;
  /** Der Tatbestand — `null`, wenn sie nicht greift. */
  readonly leistungsart: Bauleistungsart | null;
  /**
   * Der Pflichthinweis nach §14a Abs. 5 UStG. **Er ist nicht optional**: eine
   * Rechnung ohne ihn weist keine Steuer aus und sagt auch nicht, warum — der
   * Empfänger weiss dann nicht, dass er sie schuldet.
   */
  readonly hinweis: string | null;
  /** Warum sie NICHT greift — für den Bildschirm, wörtlich anzeigbar. */
  readonly grund: string;
}

/**
 * Der Pflichthinweis, wörtlich.
 *
 * **Die Formulierung ist die des UStAE, nicht meine.** §14a Abs. 5 UStG
 * verlangt „Steuerschuldnerschaft des Leistungsempfängers"; alles, was sinngemäss
 * dasselbe sagt, ist eine Auslegung, und eine Auslegung auf einem
 * unveränderlichen Beleg ist ein Risiko ohne Gegenwert.
 */
export const HINWEIS_13B = 'Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)';

/**
 * Entscheidet über eine Rechnung — rein, aus den Zeilen, die der Aufrufer
 * schon gelesen hat.
 *
 * **Ein Datum, kein Zeitraum.** Welches Datum das ist, wenn der
 * Leistungszeitraum eine Statusgrenze überschreitet, ist offen (O-21); der
 * Aufrufer übergibt es, und `estg48/abzug.ts` daneben benutzt dasselbe.
 */
export function reverseChargeLage(
  zeilen: readonly StatusZeile[],
  stichtag: string,
  leistungsart: Bauleistungsart | null,
): ReverseChargeLage {
  if (leistungsart === null) {
    return {
      greift: false, leistungsart: null, hinweis: null,
      grund: 'Diese Leistung ist weder eine Bauleistung noch eine '
        + 'Gebäudereinigungsleistung — §13b Abs. 2 Nr. 4 und Nr. 8 UStG greifen nicht.',
    };
  }

  const passend = zeilen.filter(
    (z) => z.leistungsart === leistungsart
      && z.giltAb <= stichtag
      && (z.giltBis === null || z.giltBis >= stichtag),
  );

  /*
   * Mehr als eine Zeile kann es nicht geben: `kbs_kein_ueberlapp` schliesst
   * überlappende Zeiträume je Kunde und Leistungsart aus. Stünden hier zwei,
   * wäre die Antwort von der Sortierung abhängig — deshalb steht der
   * Ausschluss in der Datenbank und nicht in einem `[0]` hier.
   */
  const zeile = passend[0];
  if (zeile === undefined) {
    return {
      greift: false, leistungsart: null, hinweis: null,
      grund: `Für den ${stichtag} ist kein §13b-Status hinterlegt. Ohne Nachweis `
        + 'wird die Umsatzsteuer ausgewiesen — die sichere Richtung: zu Unrecht '
        + 'ausgewiesene Steuer wird geschuldet (§14c UStG) und ist korrigierbar, '
        + 'eine zu Unrecht verlagerte ist beim Empfänger ein Ausfall.',
    };
  }

  if (!zeile.istBauleistender) {
    return {
      greift: false, leistungsart: null, hinweis: null,
      grund: `Der Kunde ist am ${stichtag} ausdrücklich KEIN `
        + `${leistungsart === 'bau' ? 'Bauleistender' : 'Gebäudereiniger'} `
        + `(Grundlage: ${zeile.grundlage}).`,
    };
  }

  return {
    greift: true,
    leistungsart,
    hinweis: HINWEIS_13B,
    grund: `§13b Abs. 2 Nr. ${leistungsart === 'bau' ? '4' : '8'} UStG, `
      + `Status gültig ab ${zeile.giltAb} (Grundlage: ${zeile.grundlage}).`,
  };
}
