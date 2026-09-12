/**
 * Die Spaltenrechnung des Dienstplans — TIM-04 ist der Fall, an dem sie
 * entschieden wird.
 */
import { describe, expect, it } from 'vitest';
import {
  stundenText, tagesanteil, verspure, type RasterSchicht,
} from '@/server/services/dienstplan/wochenraster';

function s(id: string, von: string, bis: string): RasterSchicht {
  return { id, beginn: new Date(von), ende: new Date(bis) };
}

describe('TIM-04: zehn Schichten zur selben Sekunde', () => {
  it('ergeben zehn Spuren, nicht eine', () => {
    const zehn = Array.from({ length: 10 }, (_, i) =>
      s(`w${String(i)}`, '2027-01-04T21:00:00Z', '2027-01-05T05:00:00Z'));
    const raster = verspure(zehn);
    expect(raster).toHaveLength(10);
    expect(new Set(raster.map((r) => r.spur)).size).toBe(10);
    // Jede kennt die volle Breite, sonst kann die Anzeige nicht rechnen.
    expect(raster.every((r) => r.spuren === 10)).toBe(true);
  });

  it('und die Spuren sind luecken- und doppelfrei 0 … 9', () => {
    const zehn = Array.from({ length: 10 }, (_, i) =>
      s(`w${String(i)}`, '2027-01-04T21:00:00Z', '2027-01-05T05:00:00Z'));
    const spuren = verspure(zehn).map((r) => r.spur).sort((a, b) => a - b);
    expect(spuren).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('die Breite gilt je Block, nicht je Tag', () => {
  it('eine einzelne Fruehschicht bleibt breit, auch wenn nachts zehn stehen', () => {
    const raster = verspure([
      s('frueh', '2027-01-04T05:00:00Z', '2027-01-04T09:00:00Z'),
      ...Array.from({ length: 3 }, (_, i) =>
        s(`nacht${String(i)}`, '2027-01-04T21:00:00Z', '2027-01-05T05:00:00Z')),
    ]);
    expect(raster.find((r) => r.schicht.id === 'frueh')?.spuren).toBe(1);
    expect(raster.find((r) => r.schicht.id === 'nacht0')?.spuren).toBe(3);
  });
});

describe('Beruehrung ist keine Ueberschneidung', () => {
  it('eine Uebergabe um 14:00 oeffnet keine zweite Spalte', () => {
    const raster = verspure([
      s('a', '2027-01-04T05:00:00Z', '2027-01-04T13:00:00Z'),
      s('b', '2027-01-04T13:00:00Z', '2027-01-04T21:00:00Z'),
    ]);
    expect(raster.every((r) => r.spur === 0)).toBe(true);
    expect(raster.every((r) => r.spuren === 1)).toBe(true);
  });

  it('eine Minute Ueberlappung dagegen schon', () => {
    const raster = verspure([
      s('a', '2027-01-04T05:00:00Z', '2027-01-04T13:01:00Z'),
      s('b', '2027-01-04T13:00:00Z', '2027-01-04T21:00:00Z'),
    ]);
    expect(new Set(raster.map((r) => r.spur)).size).toBe(2);
  });
});

describe('die Reihenfolge ist stabil', () => {
  it('gleiche Eingabe, gleiche Spuren — auch bei gleicher Anfangszeit', () => {
    const eingabe = [
      s('c', '2027-01-04T05:00:00Z', '2027-01-04T09:00:00Z'),
      s('a', '2027-01-04T05:00:00Z', '2027-01-04T13:00:00Z'),
      s('b', '2027-01-04T05:00:00Z', '2027-01-04T11:00:00Z'),
    ];
    const erste = verspure(eingabe).map((r) => `${r.schicht.id}:${String(r.spur)}`);
    const zweite = verspure([...eingabe].reverse()).map((r) => `${r.schicht.id}:${String(r.spur)}`);
    expect(zweite).toEqual(erste);
    // Die laengste steht links — sonst springt der Block bei jedem Laden.
    expect(erste[0]).toBe('a:0');
  });
});

describe('eine Nachtschicht gehoert zwei Tagen', () => {
  const nacht = s('n', '2027-01-04T21:00:00Z', '2027-01-05T05:00:00Z'); // 22:00–06:00 MEZ
  const tag1 = { von: new Date('2027-01-03T23:00:00Z'), bis: new Date('2027-01-04T23:00:00Z') };
  const tag2 = { von: new Date('2027-01-04T23:00:00Z'), bis: new Date('2027-01-05T23:00:00Z') };

  it('am ersten Tag von 22:00 bis Mitternacht, und sie reicht vor', () => {
    const a = tagesanteil(nacht, tag1.von, tag1.bis);
    expect(a).toEqual({
      vonMinute: 22 * 60, bisMinute: 24 * 60, reichtZurueck: false, reichtVor: true,
    });
  });

  it('am zweiten Tag von Mitternacht bis 06:00, und sie reicht zurueck', () => {
    const a = tagesanteil(nacht, tag2.von, tag2.bis);
    expect(a).toEqual({
      vonMinute: 0, bisMinute: 6 * 60, reichtZurueck: true, reichtVor: false,
    });
  });

  it('an einem unbeteiligten Tag gar nicht', () => {
    const tag0 = { von: new Date('2027-01-02T23:00:00Z'), bis: new Date('2027-01-03T23:00:00Z') };
    expect(tagesanteil(nacht, tag0.von, tag0.bis)).toBeNull();
  });
});

describe('die Stundenzahl ist ein Instantabstand (K-11)', () => {
  it('eine gewoehnliche Nacht liest 8,00 h', () => {
    // 20.03.2027 22:00 MEZ → 21.03. 06:00 MEZ
    expect(stundenText(s('x', '2027-03-20T21:00:00Z', '2027-03-21T05:00:00Z'))).toBe('8,00 h');
  });

  it('die Nacht der Vorstellung liest 7,00 h', () => {
    // 27.03.2027 22:00 MEZ → 28.03. 06:00 MESZ
    expect(stundenText(s('x', '2027-03-27T21:00:00Z', '2027-03-28T04:00:00Z'))).toBe('7,00 h');
  });

  it('die Nacht der Rueckstellung liest 9,00 h', () => {
    // 30.10.2027 22:00 MESZ → 31.10. 06:00 MEZ
    expect(stundenText(s('x', '2027-10-30T20:00:00Z', '2027-10-31T05:00:00Z'))).toBe('9,00 h');
  });

  it('und eine halbe Stunde liest 0,50 h — Komma, nicht Punkt', () => {
    expect(stundenText(s('x', '2027-01-04T05:00:00Z', '2027-01-04T05:30:00Z'))).toBe('0,50 h');
  });
});

describe('Randfaelle, die still falsch waeren', () => {
  it('eine leere Woche ergibt ein leeres Raster', () => {
    expect(verspure([])).toEqual([]);
  });

  it('eine Schicht ohne Dauer verschwindet nicht, sie steht in Spur 0', () => {
    const raster = verspure([s('a', '2027-01-04T05:00:00Z', '2027-01-04T05:00:00Z')]);
    expect(raster).toHaveLength(1);
    expect(raster[0]?.spuren).toBe(1);
  });
});
