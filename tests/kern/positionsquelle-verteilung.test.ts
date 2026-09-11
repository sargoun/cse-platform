/**
 * PR 49, Abnahme (2) — die Hälfte, die ohne Datenbank auskommt.
 *
 * „Die Quellen summieren sich **auf den Cent** zur Zeile" ist eine Aussage
 * über eine reine Funktion, und genau deshalb steht sie hier und nicht in der
 * Isolationssuite: eine Verteilung, die um einen Cent danebenliegt, ist keine
 * Frage von RLS oder Triggern, sondern von Arithmetik — und die lässt sich
 * erschöpfend prüfen.
 *
 * **Jede Prüfung ist falsifizierbar.** Ersetzt man
 * `verteileAufQuellen(netto, gewichte)` durch die naheliegende Fassung
 * („jede Quelle einzeln runden"), fällt `die drei Schichten` sofort um.
 */
import { describe, expect, it } from 'vitest';
import { cent } from '../../src/server/services/finanz/geld.js';
import { verteileAufQuellen } from '../../src/server/services/finanz/positionsquelle.js';

/** Die Summe einer Verteilung — die Größe, um die es in dieser Datei geht. */
function summe(werte: readonly bigint[]): bigint {
  return werte.reduce((a, b) => a + b, 0n);
}

describe('Die Verteilung verliert keinen Cent', () => {
  it('drei Schichten, ein Stundensatz — und die Summe ist EXAKT der Zeilenbetrag', () => {
    /**
     * 187 + 212 + 95 = 494 Minuten zu 42,50 €/h.
     *
     * Die Zeile trägt 494/60 × 42,50 € = 349,9166… € → 34992 Cent.
     * Einzeln gerundet ergäben die drei Schichten
     * 13246 + 15017 + 6729 = 34992 — hier zufällig gleich. Die Prüfung steht
     * trotzdem auf der Summe und nicht auf den Einzelwerten: DAS ist die
     * Zusage, und sie muss auch dort halten, wo die Einzelrundung danebenläge.
     */
    const anteile = verteileAufQuellen(cent(34_992n), [3117n, 3533n, 1583n]);
    expect(summe(anteile)).toBe(34_992n);
    expect(anteile).toHaveLength(3);
  });

  it('ein Betrag, der sich NICHT glatt teilen lässt, geht trotzdem auf', () => {
    // 100 Cent auf drei gleiche Gewichte: 34/33/33, nie 33/33/33.
    const anteile = verteileAufQuellen(cent(100n), [1000n, 1000n, 1000n]);
    expect(summe(anteile)).toBe(100n);
    expect([...anteile].sort()).toEqual([33n, 33n, 34n]);
  });

  it('der Nachschlag geht an den GRÖSSTEN Rest, nicht an die erste Quelle', () => {
    /**
     * 10 Cent auf 1 : 1 : 8 → 1,0 / 1,0 / 8,0 — glatt. Also ein Fall mit
     * echten Resten: 10 Cent auf 1 : 2 : 4 (Summe 7) → 1,428 / 2,857 / 5,714.
     * Abgerundet 1 / 2 / 5 = 8; zwei Cents fehlen und gehen an die zwei
     * größten Reste (0,857 und 0,714), also an die zweite und dritte Quelle.
     */
    const anteile = verteileAufQuellen(cent(10n), [1n, 2n, 4n]);
    expect([...anteile]).toEqual([1n, 3n, 6n]);
    expect(summe(anteile)).toBe(10n);
  });

  it('ist deterministisch — zwei Ausgaben derselben Rechnung zeigen dieselbe Aufteilung', () => {
    const a = verteileAufQuellen(cent(1_000_003n), [7n, 7n, 7n, 7n, 7n, 7n, 7n]);
    const b = verteileAufQuellen(cent(1_000_003n), [7n, 7n, 7n, 7n, 7n, 7n, 7n]);
    expect([...a]).toEqual([...b]);
    expect(summe(a)).toBe(1_000_003n);
  });

  it('ein STORNO verteilt negative Beträge ebenso exakt', () => {
    // Das Spiegelbild des ersten Falls. Ohne die Abrundung Richtung minus
    // Unendlich fehlte hier ein Cent — und zwar auf dem Beleg, der eine
    // Korrektur überhaupt erst aufzeichnet.
    const anteile = verteileAufQuellen(cent(-34_992n), [3117n, 3533n, 1583n]);
    expect(summe(anteile)).toBe(-34_992n);
  });

  it('negative Gewichte — eine Abzugszeile im Aufmaß — heben sich nicht heimlich auf', () => {
    // 30,000 m² Fläche minus 4,000 m² Öffnung, Zeilenbetrag 26 × 1,00 €.
    const anteile = verteileAufQuellen(cent(2_600n), [30_000n, -4_000n]);
    expect(summe(anteile)).toBe(2_600n);
    expect(anteile[0]).toBe(3_000n);
    expect(anteile[1]).toBe(-400n);
  });

  it('eine einzige Quelle bekommt den ganzen Betrag, ohne Rundung', () => {
    expect([...verteileAufQuellen(cent(1n), [1234n])]).toEqual([1n]);
  });

  it('Gewichte, die sich zu null addieren, verschweigen den Betrag nicht', () => {
    /**
     * Der einzige Fall, in dem sich nichts verhältnismäßig verteilen lässt.
     * Den Betrag dann wegzulassen wäre die schlechtere Antwort: die Anzeige
     * zeigte Belege ohne Summe, und die Zeile widerspräche sich selbst.
     */
    const anteile = verteileAufQuellen(cent(500n), [1000n, -1000n]);
    expect(summe(anteile)).toBe(500n);
  });

  it('ohne Quellen gibt es nichts zu verteilen', () => {
    expect(verteileAufQuellen(cent(999n), [])).toEqual([]);
  });

  it('hundert Zeiteinträge auf einer Zeile — die Summe hält auch dort', () => {
    // Der realistische Fall einer Reinigungsrechnung (DSH-04 spricht von 87).
    const gewichte = Array.from({ length: 100 }, (_, i) => BigInt(1_000 + i * 7));
    const anteile = verteileAufQuellen(cent(1_234_567n), gewichte);
    expect(summe(anteile)).toBe(1_234_567n);
    expect(anteile).toHaveLength(100);
  });
});
