import { describe, expect, it } from 'vitest';
import {
  PIPELINE_GEBOTEN, PIPELINE_LEER, pipelineStufen, summierePipeline, trefferquoteBp,
  type PipelineZahlen,
} from '../../src/server/services/bericht/kennzahlen.js';
import { cent } from '../../src/server/services/finanz/geld.js';

/**
 * Die reinen Teile von REP-06 (V-226, D-720).
 *
 * Die Zählung selbst steht in SQL (`pipelineZahlen`) und wird in
 * `tests/isolation/bericht.test.ts` gegen echte Zeilen geprüft — dort auch,
 * dass Bereichs- und Gruppenfassung dieselben Zahlen nennen. Hier steht, was
 * ohne Datenbank gilt: welche Stufen es gibt, wie sie heissen, wie zwei
 * Gesellschaften zu einer Zahl werden und wann eine Trefferquote eine ist.
 */

const beispiel: PipelineZahlen = {
  gefunden: 12, gesichtet: 9, geboten: 4, gewonnen: 1, verworfen: 3,
  zuschlagswertCent: cent(4_250_000n),
};

describe('pipelineStufen — vier im Trichter, verworfen daneben', () => {
  it('jede Stufe erscheint, auch die leere, in der Reihenfolge von REP-06', () => {
    const stufen = pipelineStufen(PIPELINE_LEER);
    expect(stufen.map((s) => s.stufe)).toEqual(
      ['gefunden', 'gesichtet', 'geboten', 'gewonnen', 'verworfen']);
    expect(stufen.every((s) => s.anzahl === 0)).toBe(true);
  });

  it('verworfen ist ein Ausgang, keine Stufe', () => {
    const stufen = pipelineStufen(beispiel);
    expect(stufen.filter((s) => s.imTrichter).map((s) => s.stufe))
      .toEqual(['gefunden', 'gesichtet', 'geboten', 'gewonnen']);
    expect(stufen.find((s) => s.stufe === 'verworfen')).toMatchObject({
      anzahl: 3, imTrichter: false, zuschlagswertCent: null,
    });
  });

  it('der Zuschlagswert steht nur auf „gewonnen", in ganzen Cent', () => {
    const stufen = pipelineStufen(beispiel);
    expect(stufen.find((s) => s.stufe === 'gewonnen')?.zuschlagswertCent).toBe(4_250_000n);
    expect(stufen.filter((s) => s.zuschlagswertCent !== null)).toHaveLength(1);
  });
});

describe('summierePipeline — was die Bereichsfassung aus RLS bekommt', () => {
  it('keine Zeile ist die leere Zählung, nicht undefined', () => {
    expect(summierePipeline([])).toEqual(PIPELINE_LEER);
  });

  it('addiert jede Stufe und den Wert in Cent', () => {
    const s = summierePipeline([beispiel, { ...beispiel, zuschlagswertCent: cent(1n) }]);
    expect(s).toMatchObject({ gefunden: 24, gesichtet: 18, geboten: 8, gewonnen: 2, verworfen: 6 });
    expect(s.zuschlagswertCent).toBe(4_250_001n);
  });
});

describe('trefferquoteBp — gewonnen je geboten', () => {
  it('ohne ein einziges Angebot gibt es keine Quote — nicht 0 %', () => {
    expect(trefferquoteBp(PIPELINE_LEER)).toBeNull();
  });

  it('eins von vier ist 25,00 %, als Basispunkte', () => {
    expect(trefferquoteBp(beispiel)).toBe(2500);
  });

  it('rundet kaufmännisch: eins von drei sind 3333 Basispunkte', () => {
    expect(trefferquoteBp({ ...beispiel, geboten: 3, gewonnen: 1 })).toBe(3333);
  });
});

describe('„geboten" — jeder Ausgang hat ein Angebot hinter sich', () => {
  it('eingereicht und alle drei Ausgänge, auch das aufgehobene Verfahren', () => {
    expect([...PIPELINE_GEBOTEN].sort()).toEqual(
      ['eingereicht', 'nicht_beruecksichtigt', 'verfahren_aufgehoben', 'zuschlag']);
  });
});
