import 'server-only';
import { anteilInBasisPunkten, basisPunkte, NULL_CENT, type Cent } from '../geld.js';

/**
 * §48 EStG — die Bauabzugsteuer (FIN-10, LEG-06, PR 51).
 *
 * **Beide Richtungen kosten.** Wer nicht einbehält, obwohl er müsste, haftet
 * für den Betrag (§48a Abs. 3 EStG). Wer einbehält, obwohl eine gültige
 * Freistellungsbescheinigung vorlag, zieht dem Kunden Geld ab, das ihm
 * zusteht. Und beides entscheidet sich an EINEM Datum — an dem die
 * Bescheinigung gilt oder nicht.
 *
 * **15 % stehen im Gesetz, nicht in einer Annahme** (§48 Abs. 1 EStG). Der
 * Satz kommt trotzdem als datierte Einstellung herein und nicht als Konstante:
 * Sätze sind schon bewegt worden, und eine einkompilierte Zahl bewertete am
 * Tag einer Änderung jede historische Rechnung neu.
 */

export interface Bescheinigung {
  readonly id: string;
  readonly nummer: string;
  readonly gueltigVon: string;
  readonly gueltigBis: string;
  readonly widerrufenAm: string | null;
  readonly umfang: 'unbeschraenkt' | 'auftragsbezogen';
  /** Nur bei `auftragsbezogen` gesetzt. */
  readonly auftragId: string | null;
}

export interface AbzugLage {
  /** Ob einbehalten wird. */
  readonly einbehalten: boolean;
  readonly satzBp: number;
  readonly grundlageCent: Cent;
  readonly einbehaltCent: Cent;
  /** Die Bescheinigung, die befreit hat — `null`, wenn einbehalten wird. */
  readonly bescheinigungId: string | null;
  /** Wörtlich anzeigbar: warum so und nicht anders. */
  readonly grund: string;
  /**
   * **Eine Warnung, keine Ablehnung**: die Gültigkeit der Bescheinigung endet
   * INNERHALB des Leistungszeitraums. Welches Datum dann gilt, ist offen
   * (O-21) — der Mensch, der unterschreibt, soll es sehen statt es still
   * entschieden zu bekommen.
   */
  readonly warnung: string | null;
}

/**
 * Gilt eine Bescheinigung am Stichtag — und für DIESEN Auftrag?
 *
 * Der zweite Teil ist der, den man vergisst: §48b EStG stellt auch
 * auftragsbezogene Bescheinigungen aus, und eine für Auftrag A befreit Auftrag
 * B nicht.
 */
export function giltAm(
  b: Bescheinigung, stichtag: string, auftragId: string | null,
): boolean {
  if (b.gueltigVon > stichtag || b.gueltigBis < stichtag) return false;
  /*
   * Ein Widerruf beendet die Bescheinigung AB seinem Datum. Am Tag des
   * Widerrufs selbst gilt sie nicht mehr — die Finanzverwaltung stellt dann
   * auf den Zugang beim Leistenden ab, und die vorsichtige Lesart ist die,
   * die nicht haftet.
   */
  if (b.widerrufenAm !== null && b.widerrufenAm <= stichtag) return false;
  if (b.umfang === 'auftragsbezogen') {
    return auftragId !== null && b.auftragId === auftragId;
  }
  return true;
}

export interface AbzugEingabe {
  /** Die Gegenleistung — brutto (§48 Abs. 1 Satz 1 EStG). */
  readonly gegenleistungCent: Cent;
  /** Ob die Leistung überhaupt eine Bauleistung im Sinne des §48 ist. */
  readonly istBauleistung: boolean;
  readonly satzBp: number;
  readonly stichtag: string;
  readonly leistungVon: string | null;
  readonly leistungBis: string | null;
  readonly auftragId: string | null;
  readonly bescheinigungen: readonly Bescheinigung[];
}

export function abzugLage(e: AbzugEingabe): AbzugLage {
  if (!e.istBauleistung) {
    return {
      einbehalten: false, satzBp: e.satzBp, grundlageCent: e.gegenleistungCent,
      einbehaltCent: NULL_CENT, bescheinigungId: null,
      grund: '§48 EStG gilt nur für Bauleistungen. Diese Rechnung führt keine.',
      warnung: null,
    };
  }

  const gueltig = e.bescheinigungen.find((b) => giltAm(b, e.stichtag, e.auftragId));

  /*
   * Die Warnung hängt NICHT daran, ob eine gültige gefunden wurde: gerade der
   * Fall „am Stichtag gültig, aber die Gültigkeit endet mitten im
   * Leistungszeitraum" ist der, den O-21 offen lässt.
   */
  const warnung = e.leistungVon !== null && e.leistungBis !== null
    ? e.bescheinigungen
      .filter((b) => b.gueltigBis >= e.leistungVon! && b.gueltigBis < e.leistungBis!)
      .map((b) => `Die Freistellungsbescheinigung ${b.nummer} endet am ${b.gueltigBis} `
        + `und damit INNERHALB des Leistungszeitraums ${e.leistungVon!} bis `
        + `${e.leistungBis!}. Welches Datum für §48 EStG maßgeblich ist — `
        + 'Leistungsende, Zahlung, oder eine geteilte Abrechnung —, ist offen '
        + '(O-21). Geprüft wurde am ' + e.stichtag + '.')
      .join(' ') || null
    : null;

  if (gueltig !== undefined) {
    return {
      einbehalten: false, satzBp: e.satzBp, grundlageCent: e.gegenleistungCent,
      einbehaltCent: NULL_CENT, bescheinigungId: gueltig.id,
      grund: `Freistellungsbescheinigung ${gueltig.nummer} gilt am ${e.stichtag}`
        + `${gueltig.umfang === 'auftragsbezogen' ? ' für diesen Auftrag' : ''}.`,
      warnung,
    };
  }

  return {
    einbehalten: true,
    satzBp: e.satzBp,
    grundlageCent: e.gegenleistungCent,
    einbehaltCent: anteilInBasisPunkten(e.gegenleistungCent, basisPunkte(e.satzBp)),
    bescheinigungId: null,
    grund: `Keine am ${e.stichtag} gültige Freistellungsbescheinigung nach §48b EStG — `
      + `${(e.satzBp / 100).toFixed(2).replace('.', ',')} % werden einbehalten `
      + '(§48 Abs. 1 EStG).',
    warnung,
  };
}
