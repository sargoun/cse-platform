/**
 * BT-81 — wie gezahlt wird, als Code aus UNTDID 4461 (FIN-11).
 *
 * **Warum das hier steht und nicht als Zeichenkette im Formular.** Der Code
 * verlässt das Haus: er steht in der XRechnung, und das Portal des
 * Empfängers liest ihn maschinell. Ein Tippfehler im Freitextfeld ergibt
 * eine Rechnung, die überall gut aussieht und beim Prüfer über BR-CL-16
 * fällt — nach dem Versand, auf einem Beleg, der nach §14 UStG nicht mehr
 * geändert werden darf.
 *
 * **Die Liste ist normativ, nicht erfunden.** UNTDID 4461 ist eine
 * UN/CEFACT-Codeliste; hier steht die Teilmenge, die in einer deutschen
 * Ausgangsrechnung überhaupt vorkommt. Was die Liste NICHT entscheidet, ist,
 * welches Zahlungsmittel für einen bestimmten Beleg gilt — das setzt ein
 * Mensch je Rechnung, wie das Zahlungsziel auch (§4.2). Es gibt deshalb
 * keinen Vorgabewert.
 *
 * **Zwei Codes tragen eine Folge**, und die steht in der Datenbank und im
 * Erzeuger, nicht hier: bei `58` (SEPA-Überweisung) verlangt BR-DE-13 die
 * IBAN des Zahlungsempfängers (BT-84), bei `59` (SEPA-Lastschrift) verlangen
 * BR-DE-14 und BR-DE-30 Mandatsreferenz und Gläubiger-ID. Die Lastschrift
 * steht hier trotzdem: sie kommt vor, und eine Liste, die einen gültigen
 * Fall weglässt, zwingt den nächsten Menschen zu einer falschen Angabe.
 */

export interface Zahlungsmittel {
  /** Der Code, wie er in BT-81 steht. */
  readonly code: string;
  /** Was ein Mensch im Formular liest. */
  readonly bezeichnung: string;
}

export const ZAHLUNGSMITTEL: readonly Zahlungsmittel[] = [
  { code: '58', bezeichnung: 'SEPA-Überweisung' },
  { code: '30', bezeichnung: 'Überweisung (nicht SEPA)' },
  { code: '59', bezeichnung: 'SEPA-Lastschrift' },
  { code: '57', bezeichnung: 'Dauerauftrag' },
  { code: '48', bezeichnung: 'Kartenzahlung' },
  { code: '10', bezeichnung: 'Barzahlung' },
  { code: '97', bezeichnung: 'Verrechnung zwischen Partnern' },
];

const CODES: ReadonlySet<string> = new Set(ZAHLUNGSMITTEL.map((z) => z.code));

/**
 * Nimmt eine Eingabe an — oder gibt `null`.
 *
 * `null` heisst „nicht gesetzt" und ist ein gültiger Zustand: bei einem
 * Kunden ohne XRechnungspflicht verlangt niemand BT-81. Ein Code, den die
 * Liste nicht kennt, wird dagegen NICHT durchgereicht: er stünde sonst
 * unverändert im Dokument.
 */
export function zahlungsmittelCode(eingabe: string | null | undefined): string | null {
  const wert = (eingabe ?? '').trim();
  return wert !== '' && CODES.has(wert) ? wert : null;
}

export function bezeichnungZu(code: string | null): string | null {
  return ZAHLUNGSMITTEL.find((z) => z.code === code)?.bezeichnung ?? null;
}
