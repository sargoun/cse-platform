import { describe, expect, it } from 'vitest';
import {
  berlinerTag, nachTagen,
} from '../../src/server/services/kalender/tagesraster.js';
import type { KalenderZeile } from '../../src/server/services/kalender/eintraege.js';

/**
 * Das Tagesraster (CAL-01) — die Rechnung zwischen SPANNE und TAG.
 *
 * Drei Fälle machen sie schwer, und alle drei standen falsch in der Seite:
 * das exklusive Ende eines ganztägigen Eintrags, Mitternacht als Ende einer
 * Nachtschicht, und die Reihenfolge innerhalb eines Tages, in den etwas
 * hineinläuft, das gestern begann.
 */

function zeile(teil: Partial<KalenderZeile> = {}): KalenderZeile {
  return {
    id: '1', quelle: 'termin', titel: 'Begehung',
    beginn: '2026-09-15T06:00:00.000Z', ende: '2026-09-15T08:00:00.000Z',
    ganztaegig: false, ort: null, beschreibung: null, abgesagt: false,
    geaendert: null, weg: null,
    ...teil,
  };
}

const tage = (m: ReadonlyMap<string, readonly unknown[]>): string[] => [...m.keys()].sort();

describe('Der Berliner Tag', () => {
  it('ist nicht der UTC-Tag — abends im Sommer liegt ein Tag dazwischen', () => {
    expect(berlinerTag('2026-09-15T22:30:00Z')).toBe('2026-09-16');
    expect(berlinerTag('2026-09-15T06:00:00Z')).toBe('2026-09-15');
  });
});

describe('nachTagen', () => {
  it('ein Termin innerhalb eines Tages steht an genau einem Tag', () => {
    expect(tage(nachTagen([zeile()]))).toEqual(['2026-09-15']);
  });

  /**
   * **Das Ende einer ganztägigen Zeile ist der Tag DANACH** (Migration 0160,
   * wie in iCal). Vorher zog `berlinerTag(ende)` sie einen Tag zu weit: ein
   * eintägiger Termin stand an zwei Tagen, ein dreitägiger an vieren.
   */
  it('ein ganztägiger Eintrag endet am Vortag seines exklusiven Endes', () => {
    const eintaegig = nachTagen([zeile({
      ganztaegig: true,
      beginn: '2026-09-14T22:00:00.000Z',   // 15.09. 00:00 Berlin
      ende: '2026-09-15T22:00:00.000Z',     // 16.09. 00:00 Berlin, exklusiv
    })]);
    expect(tage(eintaegig)).toEqual(['2026-09-15']);

    const dreitaegig = nachTagen([zeile({
      ganztaegig: true,
      beginn: '2026-09-14T22:00:00.000Z',   // 15.09.
      ende: '2026-09-17T22:00:00.000Z',     // 18.09. 00:00, exklusiv
    })]);
    expect(tage(dreitaegig)).toEqual(['2026-09-15', '2026-09-16', '2026-09-17']);
  });

  /**
   * **Mitternacht ist der erste Augenblick des Folgetags, nicht der letzte
   * des Vortags.** Eine Schicht 22:00–00:00 stand im Folgetag, an dem sie
   * keine Sekunde läuft — und dort wegen der Sortierung nach `beginn` ganz
   * oben, über allem, was an diesem Morgen wirklich anfängt.
   */
  it('eine Schicht, die um Mitternacht endet, steht nicht im Folgetag', () => {
    const m = nachTagen([zeile({
      quelle: 'einsatz',
      beginn: '2026-09-15T20:00:00.000Z',   // 22:00 Berlin
      ende: '2026-09-15T22:00:00.000Z',     // 00:00 Berlin
    })]);
    expect(tage(m)).toEqual(['2026-09-15']);
  });

  it('eine Nachtschicht über Mitternacht steht in beiden Tagen', () => {
    const m = nachTagen([zeile({
      quelle: 'einsatz',
      beginn: '2026-09-15T20:00:00.000Z',   // 22:00 Berlin
      ende: '2026-09-16T04:00:00.000Z',     // 06:00 Berlin
    })]);
    expect(tage(m)).toEqual(['2026-09-15', '2026-09-16']);
    expect(m.get('2026-09-15')![0]!.beginnt, 'am ersten Tag beginnt sie').toBe(true);
    expect(m.get('2026-09-16')![0]!.beginnt, 'am zweiten läuft sie nur').toBe(false);
  });

  /**
   * **Was hineinläuft, steht oben; was heute beginnt, danach in Uhrzeiten.**
   * Die Abfrage sortiert nach `beginn` — eine Schicht von gestern 22:00 stand
   * damit vor der Frühschicht um 07:00 desselben Morgens.
   */
  it('sortiert je Tag: Ganztägiges und Laufendes zuerst, dann die Uhrzeiten', () => {
    const m = nachTagen([
      zeile({ id: 'frueh', quelle: 'einsatz', titel: 'Frühschicht',
        beginn: '2026-09-16T05:00:00.000Z', ende: '2026-09-16T13:00:00.000Z' }),
      zeile({ id: 'nacht', quelle: 'einsatz', titel: 'Nachtschicht',
        beginn: '2026-09-15T20:00:00.000Z', ende: '2026-09-16T04:00:00.000Z' }),
      zeile({ id: 'frist', quelle: 'vergabe', titel: 'Angebotsfrist', ganztaegig: true,
        beginn: '2026-09-15T22:00:00.000Z', ende: '2026-09-16T22:00:00.000Z' }),
    ]);
    expect(m.get('2026-09-16')!.map((t) => t.zeile.id))
      .toEqual(['frist', 'nacht', 'frueh']);
  });

  /**
   * Die Wanderung über einen Monatswechsel und über beide DST-Nächte: der
   * Tagesschritt läuft über `T12:00:00Z`, damit er nie in die verschobene
   * Stunde fällt.
   */
  it('läuft über Monatswechsel und die DST-Nächte ohne einen Tag zu verlieren', () => {
    const winter = nachTagen([zeile({
      ganztaegig: true,
      beginn: '2026-10-23T22:00:00.000Z',   // 24.10.
      ende: '2026-10-27T23:00:00.000Z',     // 28.10. 00:00 (Winterzeit, +01:00)
    })]);
    expect(tage(winter))
      .toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);

    const sommer = nachTagen([zeile({
      ganztaegig: true,
      beginn: '2026-03-26T23:00:00.000Z',   // 27.03.
      ende: '2026-03-30T22:00:00.000Z',     // 31.03. 00:00 (Sommerzeit, +02:00)
    })]);
    expect(tage(sommer))
      .toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30']);
  });
});
