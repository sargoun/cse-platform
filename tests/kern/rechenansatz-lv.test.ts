/**
 * PR 43 Akzeptanz (4) — die OZ-Ordnung und die Σ je Titel und je Los.
 *
 * Beides sind Fehler der leisen Sorte: `1.2.10` vor `1.2.9` sieht in einer
 * langen Liste völlig plausibel aus, und eine Titelsumme, die um drei Cent von
 * der Gesamtsumme abweicht, fällt erst dem Auftraggeber auf, der die
 * Schlussrechnung prüft.
 */
import { describe, expect, it } from 'vitest';
import {
  baueOzBaum,
  flachInOrdnung,
  istUngeprueftMaschinell,
  lvSummeCent,
  ozSortierSchluessel,
  positionsBetragCent,
  vergleicheOz,
  zaehltInSumme,
  type LvZeile,
} from '../../src/server/services/bau/lv.js';

/** Eine Zeile mit den Vorgaben, die für den jeweiligen Fall nicht zählen. */
function zeile(teil: Partial<LvZeile> & Pick<LvZeile, 'id' | 'oz'>): LvZeile {
  return {
    elternId: null,
    ebene: 1,
    art: 'position',
    positionsart: 'normalposition',
    kurztext: teil.oz,
    einheit: 'm²',
    mengeVertrag: null,
    einheitspreisCent: null,
    konfidenz: null,
    geprueftAm: null,
    ...teil,
  };
}

describe('(4) die OZ-Ordnung stellt 1.2.10 HINTER 1.2.9', () => {
  it('der Sortierschlüssel füllt jede Stufe auf feste Breite auf', () => {
    expect(ozSortierSchluessel('1.2.10')).toBe('000001.000002.000010');
    expect(ozSortierSchluessel('01.02.0030')).toBe('000001.000002.000030');
  });

  it('und damit sortiert 1.2.10 hinter 1.2.9 — Text täte das Gegenteil', () => {
    expect(vergleicheOz('1.2.10', '1.2.9')).toBe(1);
    // Die Gegenprobe: der naive Textvergleich, den diese Datei ersetzt.
    expect('1.2.10' < '1.2.9').toBe(true);
  });

  it('eine ganze Liste kommt in LV-Ordnung heraus', () => {
    const ozs = ['1.2.9', '1.10', '1.2.10', '2', '1.2.1', '1.1', '10', '1.2.100'];
    expect([...ozs].sort(vergleicheOz)).toEqual([
      '1.1', '1.2.1', '1.2.9', '1.2.10', '1.2.100', '1.10', '2', '10',
    ]);
  });

  it('Buchstabenzusätze stehen hinter ihrer Zahl, Gross wie Klein gleich', () => {
    // „0030.A" ist eine Unterteilung von „0030" und gehört dahinter.
    expect(vergleicheOz('30', '30.A')).toBe(-1);
    expect(vergleicheOz('30.A', '30.b')).toBe(-1);
    expect(vergleicheOz('30.A', '30.a')).toBe(0);
  });

  it('und der Baum ordnet die Geschwister jeder Ebene, nicht nur die Wurzel', () => {
    const baum = baueOzBaum([
      zeile({ id: 't', oz: '1', art: 'titel', ebene: 1 }),
      zeile({ id: 'p10', oz: '1.10', elternId: 't', ebene: 2 }),
      zeile({ id: 'p9', oz: '1.9', elternId: 't', ebene: 2 }),
      zeile({ id: 'p2', oz: '1.2', elternId: 't', ebene: 2 }),
    ]);
    expect(flachInOrdnung(baum).map((k) => k.zeile.oz)).toEqual(['1', '1.2', '1.9', '1.10']);
  });
});

describe('(4) Σ je Titel und je Los stimmen auf den Cent mit der LV-Summe', () => {
  /**
   * Ein LV mit zwei Losen, drei Titeln und Mengen, die beim Multiplizieren
   * WIRKLICH runden müssen: 3,333 × 12,99 € = 43,29867 € — jede Position
   * verliert hier einen Bruchteil, und genau dort entsteht die Differenz, um
   * die es geht.
   */
  const zeilen: readonly LvZeile[] = [
    zeile({ id: 'los1', oz: '1', art: 'los', ebene: 1, einheit: null }),
    zeile({ id: 't11', oz: '1.1', art: 'titel', ebene: 2, elternId: 'los1', einheit: null }),
    zeile({ id: 'p1', oz: '1.1.1', elternId: 't11', ebene: 3, mengeVertrag: '3.333', einheitspreisCent: 1299n }),
    zeile({ id: 'p2', oz: '1.1.2', elternId: 't11', ebene: 3, mengeVertrag: '17.500', einheitspreisCent: 2450n }),
    zeile({ id: 't12', oz: '1.2', art: 'titel', ebene: 2, elternId: 'los1', einheit: null }),
    zeile({ id: 'p3', oz: '1.2.9', elternId: 't12', ebene: 3, mengeVertrag: '0.125', einheitspreisCent: 99n }),
    zeile({ id: 'p4', oz: '1.2.10', elternId: 't12', ebene: 3, mengeVertrag: '1000.005', einheitspreisCent: 7n }),
    zeile({ id: 'los2', oz: '2', art: 'los', ebene: 1, einheit: null }),
    zeile({ id: 't21', oz: '2.1', art: 'titel', ebene: 2, elternId: 'los2', einheit: null }),
    zeile({ id: 'p5', oz: '2.1.1', elternId: 't21', ebene: 3, mengeVertrag: '30.870', einheitspreisCent: 4599n }),
  ];

  const baum = baueOzBaum(zeilen);
  const knoten = (oz: string): bigint =>
    flachInOrdnung(baum).find((k) => k.zeile.oz === oz)?.summeCent ?? -1n;

  it('jede Position rundet genau einmal, kaufmännisch', () => {
    // 3,333 × 1299 = 4329,867 Cent → 4330. Das ist die einzige Rundung.
    expect(positionsBetragCent('3.333', 1299n)).toBe(4330n);
    expect(positionsBetragCent('0.125', 99n)).toBe(12n);       // 12,375 → 12
    expect(positionsBetragCent('1000.005', 7n)).toBe(7000n);   // 7000,035 → 7000
  });

  it('Σ Titel ist die Summe seiner Positionen', () => {
    expect(knoten('1.1')).toBe(4330n + 42_875n);
    expect(knoten('1.2')).toBe(12n + 7000n);
    expect(knoten('2.1')).toBe(141_971n);   // 30,870 × 45,99 € = 1419,7113 €
  });

  it('Σ Los ist die Summe seiner Titel', () => {
    expect(knoten('1')).toBe(knoten('1.1') + knoten('1.2'));
    expect(knoten('2')).toBe(knoten('2.1'));
  });

  it('und die LV-Summe ist die Summe der Lose — auf den Cent', () => {
    const gesamt = lvSummeCent(baum);
    expect(gesamt).toBe(knoten('1') + knoten('2'));
    // Und dieselbe Zahl, unabhängig vom Weg: Σ über alle Positionen direkt.
    let direkt = 0n;
    for (const z of zeilen.filter(zaehltInSumme)) {
      direkt += positionsBetragCent(z.mengeVertrag, z.einheitspreisCent) ?? 0n;
    }
    expect(gesamt).toBe(direkt);
  });

  it('eine Ebene mehr oder weniger ändert die Summe nicht', () => {
    /**
     * Die eigentliche Zusage. Würde je Ebene gerundet, verschöbe schon ein
     * eingezogener Untertitel die Gesamtsumme — und niemand könnte sagen,
     * welche der beiden Zahlen die richtige ist.
     */
    const mitUntertitel = baueOzBaum([
      ...zeilen.filter((z) => z.id !== 'p1' && z.id !== 'p2'),
      zeile({ id: 'ut', oz: '1.1.0', art: 'untertitel', ebene: 3, elternId: 't11', einheit: null }),
      zeile({ id: 'p1', oz: '1.1.0.1', elternId: 'ut', ebene: 4, mengeVertrag: '3.333', einheitspreisCent: 1299n }),
      zeile({ id: 'p2', oz: '1.1.0.2', elternId: 'ut', ebene: 4, mengeVertrag: '17.500', einheitspreisCent: 2450n }),
    ]);
    expect(lvSummeCent(mitUntertitel)).toBe(lvSummeCent(baum));
  });
});

describe('was NICHT in die Summe geht, und was die Summe unvollständig macht', () => {
  it('Bedarfs- und Alternativpositionen zählen nicht (O-155)', () => {
    const baum = baueOzBaum([
      zeile({ id: 't', oz: '1', art: 'titel', einheit: null }),
      zeile({ id: 'a', oz: '1.1', elternId: 't', mengeVertrag: '2.000', einheitspreisCent: 10_000n }),
      zeile({
        id: 'b', oz: '1.2', elternId: 't', positionsart: 'bedarfsposition',
        mengeVertrag: '2.000', einheitspreisCent: 10_000n,
      }),
      zeile({
        id: 'c', oz: '1.3', elternId: 't', positionsart: 'alternativposition',
        mengeVertrag: '2.000', einheitspreisCent: 10_000n,
      }),
    ]);
    expect(lvSummeCent(baum)).toBe(20_000n);
    expect(baum[0]?.ausgenommen).toBe(2);
  });

  it('ein Titel selbst trägt keinen Preis — nur seine Positionen', () => {
    expect(zaehltInSumme(zeile({ id: 't', oz: '1', art: 'titel' }))).toBe(false);
    expect(zaehltInSumme(zeile({ id: 'h', oz: '1.0', art: 'hinweistext' }))).toBe(false);
  });

  it('ein nicht lesbarer Preis macht die Summe unvollständig, nicht null', () => {
    // K-05: wer `bau.preis_lesen` nicht hält, bekommt die Spalte nicht. Eine
    // Summe, die das verschweigt, behauptete einen Auftragswert von 0 €.
    const baum = baueOzBaum([
      zeile({ id: 't', oz: '1', art: 'titel', einheit: null }),
      zeile({ id: 'a', oz: '1.1', elternId: 't', mengeVertrag: '2.000', einheitspreisCent: null }),
    ]);
    expect(baum[0]?.unvollstaendig).toBe(true);
    expect(baum[0]?.summeCent).toBe(0n);
  });

  it('und eine maschinell extrahierte, ungeprüfte Zeile ist als solche erkennbar', () => {
    expect(istUngeprueftMaschinell(zeile({ id: 'a', oz: '1', konfidenz: '82.00' }))).toBe(true);
    expect(istUngeprueftMaschinell(
      zeile({ id: 'a', oz: '1', konfidenz: '82.00', geprueftAm: '2026-09-10T08:00:00Z' }),
    )).toBe(false);
    // Von Hand eingetragen: der Mensch, der den Preis tippt, IST die Prüfung.
    expect(istUngeprueftMaschinell(zeile({ id: 'a', oz: '1' }))).toBe(false);
  });

  it('eine Zeile mit unauffindbarem Elternteil verschwindet nicht', () => {
    // Sonst fehlte Geld in der Summe, und niemand sähe, dass etwas fehlt.
    const baum = baueOzBaum([
      zeile({ id: 'w', oz: '9.9', elternId: 'gibt-es-nicht', mengeVertrag: '1.000', einheitspreisCent: 500n }),
    ]);
    expect(lvSummeCent(baum)).toBe(500n);
  });
});
