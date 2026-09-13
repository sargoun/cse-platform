/**
 * PR 61 — der Abgleich schlägt vor, er ordnet nicht zu (ACC-04 Abnahme (2)).
 *
 * Die eine Zusage dieser Datei: **ein mehrdeutiger Treffer wird NIE
 * automatisch zugeordnet.** Alles andere hier dient dazu, die Grenze zwischen
 * eindeutig und mehrdeutig an jeder Stelle festzunageln, an der sie sich
 * verschieben liesse.
 */
import { describe, expect, it } from 'vitest';
import {
  darfAutomatischBuchen, gleicheIban, normalisiere, nummerImZweck, schlageVor,
  type AbgleichUmsatz, type OffenerPosten,
} from '../../src/server/services/finanz/bank/abgleich.js';

const IBAN_KUNDE = 'DE89370400440532013000';

function posten(
  nummer: string, offenCent: bigint, kundeIban: string | null = IBAN_KUNDE,
): OffenerPosten {
  return { id: `op-${nummer}`, rechnungId: `r-${nummer}`, nummer, offenCent, kundeIban };
}

function umsatz(teil: Partial<AbgleichUmsatz> = {}): AbgleichUmsatz {
  return {
    betragCent: 119_000n,
    richtung: 'eingang',
    verwendungszweck: 'Rechnung RE-2026-00017',
    referenz: null,
    gegenIban: IBAN_KUNDE,
    ...teil,
  };
}

describe('(1) die drei Merkmale', () => {
  it('Betrag, Nummer und IBAN — das ist der eindeutige Fall', () => {
    const v = schlageVor(umsatz(), [posten('RE-2026-00017', 119_000n)]);
    expect(v.art).toBe('eindeutig');
    expect(v.kandidaten).toHaveLength(1);
    expect(darfAutomatischBuchen(v)).toBe(true);
  });

  it('ohne IBAN im Auszug: eindeutig, aber benannt anders', () => {
    const v = schlageVor(umsatz({ gegenIban: null }), [posten('RE-2026-00017', 119_000n)]);
    expect(v.art).toBe('eindeutig_ohne_iban');
    expect(v.begruendung).toContain('steht nicht im Auszug');
    // Und er wird NICHT automatisch gebucht.
    expect(darfAutomatischBuchen(v)).toBe(false);
  });

  it('mit ABWEICHENDER IBAN ebenso — der Satz nennt den Unterschied', () => {
    const v = schlageVor(umsatz({ gegenIban: 'DE11520513735120710131' }),
      [posten('RE-2026-00017', 119_000n)]);
    expect(v.art).toBe('eindeutig_ohne_iban');
    expect(v.begruendung).toContain('eine andere als die hinterlegte');
    expect(darfAutomatischBuchen(v)).toBe(false);
  });
});

describe('(2) ein Betrag allein ordnet nichts zu', () => {
  it('genau ein Posten mit diesem Betrag, aber keine Nummer im Zweck', () => {
    /*
     * Der verführerische Fall: es gibt nur EINEN Posten über 1190,00 €, also
     * „muss" er es sein. Zwei Rechnungen über denselben Betrag im selben
     * Monat sind aber der Normalfall — und die zweite käme dann auf die
     * erste.
     */
    const v = schlageVor(umsatz({ verwendungszweck: 'Zahlung' }),
      [posten('RE-2026-00017', 119_000n)]);
    expect(v.art).toBe('mehrdeutig');
    expect(v.kandidaten).toHaveLength(1);
    expect(v.begruendung).toContain('Ein Betrag allein ordnet nichts zu');
    expect(darfAutomatischBuchen(v)).toBe(false);
  });

  it('zwei Posten mit demselben Betrag und derselben Nummer im Zweck', () => {
    const v = schlageVor(
      umsatz({ verwendungszweck: 'RE-2026-00017 RE-2026-00018' }),
      [posten('RE-2026-00017', 119_000n), posten('RE-2026-00018', 119_000n)]);
    expect(v.art).toBe('mehrdeutig');
    expect(v.kandidaten).toHaveLength(2);
    expect(darfAutomatischBuchen(v)).toBe(false);
  });
});

describe('(3) die Nummer wird als MUSTER erkannt, nicht als Zeichenkette', () => {
  it('abgetippt mit Leerzeichen statt Strichen ist dieselbe Nummer', () => {
    const v = schlageVor(umsatz({ verwendungszweck: 'Ueberweisung RE 2026 00017' }),
      [posten('RE-2026-00017', 119_000n)]);
    expect(v.art).toBe('eindeutig');
  });

  it('Kleinschreibung und Punkte ebenso', () => {
    expect(nummerImZweck('bezahlt: re.2026.00017, danke', 'RE-2026-00017')).toBe(true);
    expect(normalisiere('RE-2026/00017')).toBe('RE202600017');
  });

  it('eine Nummer unter vier Zeichen wird NICHT gesucht', () => {
    // `RE1` käme in fast jedem Zweck vor. Ein Treffer, der immer trifft,
    // ist keiner.
    expect(nummerImZweck('MIETE1 UND ANDERES', 'RE1')).toBe(false);
    expect(nummerImZweck('MIETE1 UND ANDERES', 'ETE1')).toBe(true);
  });

  it('die Nummer darf auch in der EndToEnd-Referenz stehen', () => {
    const v = schlageVor(
      umsatz({ verwendungszweck: 'Zahlung', referenz: 'RE-2026-00017' }),
      [posten('RE-2026-00017', 119_000n)]);
    expect(v.art).toBe('eindeutig');
  });

  it('IBANs vergleichen sich ohne Leerzeichen', () => {
    expect(gleicheIban('DE89 3704 0044 0532 0130 00', IBAN_KUNDE)).toBe(true);
    expect(gleicheIban(null, IBAN_KUNDE)).toBe(false);
    expect(gleicheIban(IBAN_KUNDE, null)).toBe(false);
  });
});

describe('(4) die Fälle, die den Umsatz sonst verlieren würden', () => {
  it('eine Teilzahlung: Nummer stimmt, Betrag nicht — mehrdeutig, nicht verloren', () => {
    const v = schlageVor(umsatz({ betragCent: 50_000n }),
      [posten('RE-2026-00017', 119_000n)]);
    expect(v.art).toBe('mehrdeutig');
    expect(v.kandidaten[0]?.nummer).toBe('RE-2026-00017');
    expect(v.begruendung).toContain('Teilzahlung');
  });

  it('gar kein Bezug: kein Treffer, aber er BLEIBT in der Schlange', () => {
    const v = schlageVor(umsatz({ betragCent: 777n, verwendungszweck: 'Spende' }),
      [posten('RE-2026-00017', 119_000n)]);
    expect(v.art).toBe('kein_treffer');
    expect(v.begruendung).toContain('bleibt in der Schlange');
  });

  it('ohne offene Posten überhaupt', () => {
    expect(schlageVor(umsatz(), []).art).toBe('kein_treffer');
  });
});

describe('(5) ein AUSGANG wird keiner Ausgangsrechnung zugeordnet', () => {
  it('auch dann nicht, wenn Betrag, Nummer und IBAN perfekt passen', () => {
    /*
     * Der Rückbuchungsfall. Alle drei Merkmale stimmen — genau deshalb ist
     * die Richtung die erste Prüfung und nicht die letzte.
     */
    const v = schlageVor(umsatz({ richtung: 'ausgang' }),
      [posten('RE-2026-00017', 119_000n)]);
    expect(v.art).toBe('kein_treffer');
    expect(v.kandidaten).toHaveLength(0);
    expect(v.begruendung).toContain('zweites Mal als bezahlt');
    expect(darfAutomatischBuchen(v)).toBe(false);
  });
});

describe('(6) nur EIN Zustand darf ohne Menschen gebucht werden', () => {
  it('und das ist `eindeutig` — keine Ausnahme', () => {
    const alle = ['eindeutig', 'eindeutig_ohne_iban', 'mehrdeutig', 'kein_treffer'] as const;
    const erlaubt = alle.filter((art) =>
      darfAutomatischBuchen({ art, kandidaten: [], begruendung: '' }));
    expect(erlaubt).toEqual(['eindeutig']);
  });
});
