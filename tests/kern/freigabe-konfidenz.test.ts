/**
 * PR 62 — Konfidenz wird abgeleitet, nicht erfragt (APR-03).
 *
 * Die eine Zusage dieser Datei: **eine gerissene Pruefung schlaegt jede
 * gemeldete Sicherheit.** Ein Modell, das sich seiner Sache sicher ist,
 * aendert nichts daran, dass die Summe nicht aufgeht.
 */
import { describe, expect, it } from 'vitest';
import {
  anzahlUnsicher, bewerte, bewerteAlle, gibWeiter, konfidenzAus, konfidenzText,
  KonfidenzFehler, KONFIDENZ_SCHWELLE, minKonfidenz,
  type Befund, type ExtrahiertesFeld,
} from '../../src/server/services/freigabe/konfidenz.js';

function feld(teil: Partial<ExtrahiertesFeld> = {}): ExtrahiertesFeld {
  return {
    feldPfad: '/rechnungsnummer',
    bezeichnung: 'Rechnungsnummer',
    wertVorher: null,
    wertNachher: 'RE-2026-00017',
    quelle: {
      art: 'dokument', dokumentId: 'dok-1', seite: 1, tabelle: null,
      zelle: null, bbox: null, zitat: 'Rechnungsnummer RE-2026-00017',
    },
    ocrKonfidenz: 0.99,
    befunde: [],
    extraktionModell: null,
    ...teil,
  };
}

function befund(bestanden: boolean, hinweis: string | null = null): Befund {
  return { pruefung: 'rechenprobe', bestanden, hinweis };
}

describe('(1) eine gerissene Pruefung schlaegt alles', () => {
  it('OCR meldet 0,99 — die Rechenprobe reisst — Konfidenz 0', () => {
    const f = feld({ ocrKonfidenz: 0.99, befunde: [befund(false, 'USt-Summe weicht um 0,02 € ab')] });
    expect(konfidenzAus(f)).toBe(0);
    expect(bewerte(f).unsicher).toBe(true);
  });

  it('der Hinweis der gerissenen Pruefung wird der angezeigte Grund', () => {
    const f = feld({ befunde: [befund(false, 'USt-Summe weicht um 0,02 € ab')] });
    expect(bewerte(f).grund).toBe('USt-Summe weicht um 0,02 € ab');
  });

  it('ohne Hinweis nennt der Grund wenigstens die Pruefung', () => {
    const f = feld({ befunde: [befund(false)] });
    expect(bewerte(f).grund).toBe('Pruefung rechenprobe nicht bestanden');
  });

  it('eine bestandene neben einer gerissenen rettet nichts', () => {
    const f = feld({ befunde: [befund(true), befund(false)] });
    expect(konfidenzAus(f)).toBe(0);
  });
});

describe('(2) „nichts geprueft" ist nicht „in Ordnung"', () => {
  it('ohne OCR-Wert und ohne Pruefung ist die Konfidenz 0, nicht 1', () => {
    expect(konfidenzAus(feld({ ocrKonfidenz: null, befunde: [] }))).toBe(0);
  });

  it('ohne OCR-Wert, aber mit bestandener Pruefung: volle Konfidenz', () => {
    expect(konfidenzAus(feld({ ocrKonfidenz: null, befunde: [befund(true)] }))).toBe(1);
  });
});

describe('(3) die Schwelle ist ein PLATZHALTER und irrt nach streng (O-197)', () => {
  it('sie liegt bei 0,95', () => {
    expect(KONFIDENZ_SCHWELLE).toBe(0.95);
  });

  it('knapp darunter ist unsicher', () => {
    const b = bewerte(feld({ ocrKonfidenz: 0.94, befunde: [] }));
    expect(b.unsicher).toBe(true);
    expect(b.grund).toMatch(/PLATZHALTER, O-197/u);
  });

  it('genau auf der Schwelle ist sicher', () => {
    expect(bewerte(feld({ ocrKonfidenz: 0.95 })).unsicher).toBe(false);
  });
});

describe('(4) die Zahl geht in die Hashkette — also ist ihre Schreibweise festgelegt', () => {
  it('drei Nachkommastellen, immer', () => {
    expect(konfidenzText(1)).toBe('1.000');
    expect(konfidenzText(0)).toBe('0.000');
    expect(konfidenzText(0.9)).toBe('0.900');
  });

  it('kaufmaennisch gerundet', () => {
    expect(konfidenzText(0.9994)).toBe('0.999');
    expect(konfidenzText(0.9995)).toBe('1.000');
  });

  it('ein Wert ausserhalb von [0,1] ist ein Fehler, keine Klemmung', () => {
    expect(() => konfidenzText(1.2)).toThrow(KonfidenzFehler);
    expect(() => konfidenzText(-0.1)).toThrow(KonfidenzFehler);
    expect(() => konfidenzAus(feld({ ocrKonfidenz: 1.5 }))).toThrow(KonfidenzFehler);
  });
});

describe('(5) die Kennzahlen des Posteingangs', () => {
  it('`min_konfidenz` ist das Minimum, nicht der Durchschnitt', () => {
    const felder = bewerteAlle([
      feld({ feldPfad: '/a', ocrKonfidenz: 1 }),
      feld({ feldPfad: '/b', ocrKonfidenz: 0.4 }),
      feld({ feldPfad: '/c', ocrKonfidenz: 0.99 }),
    ]);
    expect(minKonfidenz(felder)).toBe(0.4);
  });

  it('ohne Felder ist sie null — nicht 1', () => {
    expect(minKonfidenz([])).toBeNull();
  });

  it('`unsichere_felder_anzahl` zaehlt genau die unsicheren', () => {
    const felder = bewerteAlle([
      feld({ feldPfad: '/a', ocrKonfidenz: 1 }),
      feld({ feldPfad: '/b', ocrKonfidenz: 0.4 }),
      feld({ feldPfad: '/c', befunde: [befund(false)] }),
    ]);
    expect(anzahlUnsicher(felder)).toBe(2);
  });
});

describe('(6) die Weitergabe faerbt Abgeleitetes — und nur das (§5.5 Regel 7)', () => {
  it('ein unsicheres Elternfeld macht sein Kind unsicher', () => {
    const felder = gibWeiter(bewerteAlle([
      feld({ feldPfad: '/positionen/3', ocrKonfidenz: 0.4 }),
      feld({ feldPfad: '/positionen/3/betrag', ocrKonfidenz: 1 }),
    ]));
    expect(felder.find((f) => f.feldPfad === '/positionen/3/betrag')!.unsicher).toBe(true);
  });

  it('der Grund benennt das Quellfeld', () => {
    const felder = gibWeiter(bewerteAlle([
      feld({ feldPfad: '/positionen/3', ocrKonfidenz: 0.4 }),
      feld({ feldPfad: '/positionen/3/betrag', ocrKonfidenz: 1 }),
    ]));
    expect(felder.find((f) => f.feldPfad === '/positionen/3/betrag')!.grund)
      .toMatch(/\/positionen\/3/u);
  });

  /**
   * Der Grund fuer den Vergleich auf der Segmentgrenze: mit einem nackten
   * Praefixvergleich faerbte Position 3 auch Position 30 — dreissig Felder
   * waeren grundlos unsicher, und die Warnung verlaere jede Bedeutung.
   */
  it('/positionen/3 faerbt NICHT /positionen/30', () => {
    const felder = gibWeiter(bewerteAlle([
      feld({ feldPfad: '/positionen/3', ocrKonfidenz: 0.4 }),
      feld({ feldPfad: '/positionen/30/betrag', ocrKonfidenz: 1 }),
    ]));
    expect(felder.find((f) => f.feldPfad === '/positionen/30/betrag')!.unsicher).toBe(false);
  });

  it('ein Feld faerbt sich nicht selbst', () => {
    const felder = gibWeiter(bewerteAlle([feld({ feldPfad: '/a', ocrKonfidenz: 0.4 })]));
    expect(felder[0]!.befunde.filter((b) => b.pruefung === 'weitergabe')).toHaveLength(0);
  });

  it('ohne unsicheres Feld aendert die Weitergabe nichts', () => {
    const vorher = bewerteAlle([feld({ feldPfad: '/a' }), feld({ feldPfad: '/a/b' })]);
    expect(gibWeiter(vorher)).toBe(vorher);
  });
});
