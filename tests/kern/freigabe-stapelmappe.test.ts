/**
 * Wer darf in den Stapel — die eine Regel, an EINER Stelle (APR-03, APR-04).
 *
 * **Warum diese Datei existiert.** Die Regel stand zweimal: als Schleife in
 * `entscheideStapel` und als Bedingung in der Häkchenspalte des Posteingangs.
 * Mit der Stapelmappe wäre sie ein drittes Mal entstanden — und die dritte
 * Fassung ist erfahrungsgemäss die, die den teuren Fall vergisst:
 * `stapel_faehig = true` UND ein unsicheres Feld. Genau der hebelt APR-03 aus
 * („uncertain fields highlighted" hiesse nichts, wenn ein Sammelklick sie
 * mitnähme). Jetzt steht die Regel in `posteingang.ts`, und dieser Test hält
 * sie fest.
 */
import { describe, expect, it } from 'vitest';
import { istStapelbar, stapelGrund } from '../../src/server/services/freigabe/posteingang.js';
import { teileStapel, type StapelFall }
  from '../../src/server/services/freigabe/stapel-mappe.js';

function lage(ueber: Partial<{
  stapelFaehig: boolean; unsichereFelder: number; stapelSperreGrund: string | null;
}> = {}) {
  return {
    stapelFaehig: true, unsichereFelder: 0, stapelSperreGrund: null, ...ueber,
  };
}

describe('stapelGrund', () => {
  it('eine stapelfähige Zeile ohne unsicheres Feld darf — `null` heisst „darf"', () => {
    expect(stapelGrund(lage())).toBeNull();
    expect(istStapelbar(lage())).toBe(true);
  });

  it('eine markierte Zeile darf nicht, und der Grund ist DER DES DIENSTES', () => {
    /*
     * `stapel_sperre_grund` setzt der Dienst, der die Freigabe erzeugt hat.
     * Ihn zu verwerfen und einen eigenen Satz zu schreiben, hiesse die
     * Begründung wegzuwerfen, die der Mensch sehen soll.
     */
    expect(stapelGrund(lage({
      stapelFaehig: false, stapelSperreGrund: 'Neuer Lieferant — erste Rechnung',
    }))).toBe('Neuer Lieferant — erste Rechnung');
  });

  it('ohne hinterlegten Grund steht ein Satz da, nicht „null"', () => {
    const grund = stapelGrund(lage({ stapelFaehig: false }));
    expect(grund).toMatch(/APR-04/u);
    expect(grund).not.toBe('');
  });

  it('**stapelfähig UND unsicher darf trotzdem nicht** — der Fall, um den es geht', () => {
    const grund = stapelGrund(lage({ stapelFaehig: true, unsichereFelder: 2 }));
    expect(grund).toMatch(/APR-03/u);
    expect(grund).toMatch(/2/u);
    expect(istStapelbar(lage({ stapelFaehig: true, unsichereFelder: 2 }))).toBe(false);
  });

  it('die Sperre des Dienstes gewinnt vor der Zahl der unsicheren Felder', () => {
    // Beides zugleich: der Satz, den ein Mensch geschrieben hat, sagt mehr als
    // „1 unsicheres Feld".
    expect(stapelGrund(lage({
      stapelFaehig: false, unsichereFelder: 1, stapelSperreGrund: 'Betrag über Budget',
    }))).toBe('Betrag über Budget');
  });
});

describe('teileStapel', () => {
  const fall = (id: string, grund: string | null): StapelFall => ({
    eintrag: { id } as StapelFall['eintrag'],
    felder: [],
    grund,
  });

  it('trennt in ankreuzbar und ausgenommen — und verliert keinen Fall', () => {
    const faelle = [
      fall('a', null),
      fall('b', '1 unsichere(s) Feld(er) — einzeln prüfen (APR-03)'),
      fall('c', null),
    ];
    const { stapelbar, ausgenommen } = teileStapel(faelle);
    expect(stapelbar.map((f) => f.eintrag.id)).toEqual(['a', 'c']);
    expect(ausgenommen.map((f) => f.eintrag.id)).toEqual(['b']);
    // Nichts fällt zwischen die beiden Listen: eine ausgenommene Zeile, die
    // nirgends steht, ist eine, die niemand mehr einzeln prüft.
    expect(stapelbar.length + ausgenommen.length).toBe(faelle.length);
  });

  it('behält die Reihenfolge des Posteingangs — Frist, Risiko, Betrag, Alter', () => {
    const faelle = [fall('z', null), fall('a', null)];
    expect(teileStapel(faelle).stapelbar.map((f) => f.eintrag.id)).toEqual(['z', 'a']);
  });

  it('eine leere Mappe ergibt zwei leere Listen und keinen Fehler', () => {
    expect(teileStapel([])).toEqual({ stapelbar: [], ausgenommen: [] });
  });
});
