/**
 * PR 62 — der Diff ist die Pruefung (APR-02).
 *
 * Die eine Zusage dieser Datei: **was sich am Geld aendert, steht im Diff.**
 * Alles Weitere haelt die Stellen fest, an denen eine Aenderung sich
 * unsichtbar machen koennte — ein Add/Remove-Paar statt einer Aenderung, eine
 * Steuergruppe, die nur in der Gesamtsumme auftaucht, zwei Zeilen mit
 * derselben Identitaet.
 */
import { describe, expect, it } from 'vitest';
import {
  anzahlAenderungen, diffVergleich, DiffFehler, istUnveraendert, positionsSchluessel,
  type Vergleichsmodell, type VergleichsPosition,
} from '../../src/server/services/freigabe/diff.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';

const OBJEKT = 'obj-kudamm';
const KATALOG = 'kat-unterhalt';

function position(teil: Partial<VergleichsPosition> = {}): VergleichsPosition {
  return {
    objektId: OBJEKT,
    leistungskatalogId: KATALOG,
    bezeichnung: 'Unterhaltsreinigung',
    menge: milliMenge(100_000n),
    einheit: 'm2',
    einzelpreisCent: cent(120n),
    betragCent: cent(12_000n),
    herkunft: [{ art: 'vertrag', id: 'v-1' }],
    meta: {},
    ...teil,
  };
}

function modell(
  positionen: readonly VergleichsPosition[], teil: Partial<Vergleichsmodell> = {},
): Vergleichsmodell {
  const netto = positionen.reduce((s, p) => s + p.betragCent, 0n);
  return {
    vorgangTyp: 'monatsrechnung_entwurf',
    periode: 'August 2026',
    positionen,
    ustGruppen: [{
      steuersatzGruppeId: 'ust-19',
      nettoCent: cent(netto),
      ustCent: cent((netto * 19n) / 100n),
    }],
    summeNettoCent: cent(netto),
    summeBruttoCent: cent(netto + (netto * 19n) / 100n),
    leistungszeitraum: { von: '2026-08-01', bis: '2026-08-31' },
    ...teil,
  };
}

describe('(1) unveraendert heisst unveraendert', () => {
  it('zwei gleiche Modelle ergeben keinen einzigen Befund', () => {
    const d = diffVergleich(modell([position()]), modell([position()]));
    expect(istUnveraendert(d)).toBe(true);
    expect(anzahlAenderungen(d)).toBe(0);
    expect(d.unveraendert).toHaveLength(1);
    expect(d.deltaNettoCent).toBe(0n);
  });

  it('eine unveraenderte Position steht in `unveraendert`, nicht in `geaendert`', () => {
    const d = diffVergleich(modell([position()]), modell([position()]));
    expect(d.geaendert).toHaveLength(0);
    expect(d.unveraendert[0]).toBe(positionsSchluessel(position()));
  });
});

describe('(2) die Geldaenderung', () => {
  it('ein hoeherer Betrag erscheint als Aenderung MIT Delta', () => {
    const d = diffVergleich(
      modell([position()]),
      modell([position({ betragCent: cent(12_456n) })]),
    );
    const betrag = d.geaendert.find((a) => a.feld === 'betrag');
    expect(betrag).toBeDefined();
    expect(betrag!.deltaCent).toBe(456n);
    expect(d.deltaNettoCent).toBe(456n);
  });

  it('ein niedrigerer Betrag ergibt ein NEGATIVES Delta, nicht den Betrag', () => {
    const d = diffVergleich(
      modell([position()]),
      modell([position({ betragCent: cent(11_000n) })]),
    );
    expect(d.geaendert.find((a) => a.feld === 'betrag')!.deltaCent).toBe(-1000n);
    expect(d.deltaNettoCent).toBe(-1000n);
  });

  it('nur das Feld `betrag` traegt ein Delta — Menge und Preis tragen keines', () => {
    const d = diffVergleich(
      modell([position()]),
      modell([position({ menge: milliMenge(110_000n), einzelpreisCent: cent(130n) })]),
    );
    for (const a of d.geaendert) {
      if (a.feld !== 'betrag') expect(a.deltaCent).toBeNull();
    }
  });
});

describe('(3) Zugang und Wegfall', () => {
  it('eine neue Position steht in `hinzugefuegt`', () => {
    const neu = position({ leistungskatalogId: 'kat-glas', bezeichnung: 'Glasreinigung' });
    const d = diffVergleich(modell([position()]), modell([position(), neu]));
    expect(d.hinzugefuegt).toHaveLength(1);
    expect(d.hinzugefuegt[0]!.bezeichnung).toBe('Glasreinigung');
    expect(d.entfallen).toHaveLength(0);
  });

  it('eine weggefallene Position steht in `entfallen`', () => {
    const alt = position({ leistungskatalogId: 'kat-glas' });
    const d = diffVergleich(modell([position(), alt]), modell([position()]));
    expect(d.entfallen).toHaveLength(1);
    expect(d.entfallen[0]!.leistungskatalogId).toBe('kat-glas');
  });
});

describe('(4) O-114: der Zuschlag gehoert NICHT in den Schluessel', () => {
  /**
   * Der Kern der offenen Frage. Mit dem Zuschlag im Schluessel waere eine
   * geaenderte Zuschlagsgruppe ein Add/Remove-Paar — und die Preisaenderung
   * darin unsichtbar. Solange O-114 offen ist, muss sie als AENDERUNG
   * erscheinen.
   */
  it('eine geaenderte Zuschlagsgruppe ist eine Aenderung, kein Add/Remove-Paar', () => {
    const d = diffVergleich(
      modell([position({ meta: { zuschlag: 'tag' } })]),
      modell([position({ meta: { zuschlag: 'nacht' }, betragCent: cent(15_000n) })]),
    );
    expect(d.hinzugefuegt).toHaveLength(0);
    expect(d.entfallen).toHaveLength(0);
    expect(d.geaendert.some((a) => a.feld === 'meta')).toBe(true);
    // Und die Preisaenderung bleibt sichtbar.
    expect(d.geaendert.find((a) => a.feld === 'betrag')!.deltaCent).toBe(3000n);
  });

  it('der Schluessel besteht aus Objekt, Katalog und Einheit', () => {
    expect(positionsSchluessel(position())).toBe(`${OBJEKT}|${KATALOG}|m2`);
  });

  it('Trenner im Wert kollidieren nicht — sie werden maskiert', () => {
    const a = positionsSchluessel(position({ objektId: 'a|b', leistungskatalogId: 'c' }));
    const b = positionsSchluessel(position({ objektId: 'a', leistungskatalogId: 'b|c' }));
    expect(a).not.toBe(b);
  });

  it('eine andere Einheit ist eine andere Position', () => {
    const d = diffVergleich(
      modell([position()]),
      modell([position({ einheit: 'Stk' })]),
    );
    expect(d.hinzugefuegt).toHaveLength(1);
    expect(d.entfallen).toHaveLength(1);
  });
});

describe('(5) Umsatzsteuer je Gruppe (Invariante 1)', () => {
  it('das Delta wird JE GRUPPE gebildet', () => {
    const vorher = modell([position()], {
      ustGruppen: [
        { steuersatzGruppeId: 'ust-19', nettoCent: cent(10_000n), ustCent: cent(1900n) },
        { steuersatzGruppeId: 'ust-07', nettoCent: cent(2000n), ustCent: cent(140n) },
      ],
    });
    const nachher = modell([position()], {
      ustGruppen: [
        { steuersatzGruppeId: 'ust-19', nettoCent: cent(10_000n), ustCent: cent(1900n) },
        { steuersatzGruppeId: 'ust-07', nettoCent: cent(2500n), ustCent: cent(175n) },
      ],
    });
    const d = diffVergleich(vorher, nachher);
    expect(d.deltaUstGruppen).toHaveLength(1);
    expect(d.deltaUstGruppen[0]).toEqual({
      steuersatzGruppeId: 'ust-07', deltaNettoCent: 500n, deltaUstCent: 35n,
    });
  });

  it('ein Satzwechsel 19 → 7 zeigt BEIDE Gruppen, nicht eine Nettodifferenz von 0', () => {
    const vorher = modell([position()], {
      ustGruppen: [{ steuersatzGruppeId: 'ust-19', nettoCent: cent(10_000n), ustCent: cent(1900n) }],
    });
    const nachher = modell([position()], {
      ustGruppen: [{ steuersatzGruppeId: 'ust-07', nettoCent: cent(10_000n), ustCent: cent(700n) }],
    });
    const d = diffVergleich(vorher, nachher);
    expect(d.deltaUstGruppen).toHaveLength(2);
    expect(d.deltaUstGruppen.map((g) => g.steuersatzGruppeId)).toEqual(['ust-07', 'ust-19']);
    expect(d.deltaUstGruppen.find((g) => g.steuersatzGruppeId === 'ust-19')!.deltaUstCent)
      .toBe(-1900n);
  });

  it('eine unveraenderte Gruppe erscheint nicht', () => {
    const d = diffVergleich(modell([position()]), modell([position()]));
    expect(d.deltaUstGruppen).toHaveLength(0);
  });
});

describe('(6) was NICHT durchgehen darf', () => {
  it('zwei Zeilen mit derselben Identitaet sind ein Fehler, keine Summe', () => {
    expect(() => diffVergleich(
      modell([position(), position()]),
      modell([position()]),
    )).toThrow(DiffFehler);
  });

  it('der Fehler benennt die Seite, auf der die Doppelung steht', () => {
    expect(() => diffVergleich(
      modell([position()]),
      modell([position(), position()]),
    )).toThrow(/dem Vorschlag/u);
  });
});

describe('(7) die Herkunft ist Teil des Vergleichs (FIN-07)', () => {
  it('eine geaenderte Herkunft ist eine sichtbare Aenderung', () => {
    const d = diffVergleich(
      modell([position({ herkunft: [{ art: 'vertrag', id: 'v-1' }] })]),
      modell([position({ herkunft: [{ art: 'aufmass', id: 'a-9' }] })]),
    );
    expect(d.geaendert.some((a) => a.feld === 'herkunft')).toBe(true);
  });

  it('dieselben Quellen in anderer Reihenfolge sind KEINE Aenderung', () => {
    const q1 = [{ art: 'vertrag' as const, id: 'v-1' }, { art: 'aufmass' as const, id: 'a-9' }];
    const q2 = [{ art: 'aufmass' as const, id: 'a-9' }, { art: 'vertrag' as const, id: 'v-1' }];
    const d = diffVergleich(modell([position({ herkunft: q1 })]), modell([position({ herkunft: q2 })]));
    expect(istUnveraendert(d)).toBe(true);
  });
});

describe('(8) die Reihenfolge ist deterministisch — sonst waere `diff_hash` zufaellig', () => {
  it('derselbe Vergleich in anderer Eingabereihenfolge ergibt denselben Diff', () => {
    const a = position({ leistungskatalogId: 'kat-a' });
    const b = position({ leistungskatalogId: 'kat-b' });
    const c = position({ leistungskatalogId: 'kat-c', betragCent: cent(999n) });

    const eins = diffVergleich(modell([a, b]), modell([a, b, c]));
    const zwei = diffVergleich(modell([b, a]), modell([c, b, a]));

    expect(JSON.stringify(eins, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)))
      .toBe(JSON.stringify(zwei, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
  });
});
