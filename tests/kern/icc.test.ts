/**
 * PR 53 — das selbst erzeugte sRGB-Profil, zurückgelesen (FIN-12).
 *
 * Ein ICC-Profil ist eine Binärdatei, die niemand ansieht: fällt sie falsch
 * aus, meldet der Prüfer des Empfängers „invalid ICC profile" und nennt keine
 * Zeile. Diese Prüfungen lesen den Kopf und die Tagtabelle so zurück, wie ein
 * Farbmanagement sie liest.
 */
import { describe, expect, it } from 'vitest';
import { sRgbProfil } from '../../src/server/services/finanz/zugferd/icc.js';

const text = (d: Uint8Array, von: number): string =>
  String.fromCharCode(...d.slice(von, von + 4));
const u32 = (d: Uint8Array, von: number): number =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(von, false);

describe('(1) Der Kopf sagt, was die Datei ist', () => {
  const p = sRgbProfil();

  it('die im Kopf genannte Größe ist die tatsächliche', () => {
    /* Die häufigste Art, ein Profil kaputtzuschreiben: die Größe nicht
       nachzuführen, nachdem ein Tag dazukam. */
    expect(u32(p, 0)).toBe(p.length);
  });

  it('`acsp` steht an Byte 36 — daran erkennt jeder Leser die Datei', () => {
    expect(text(p, 36)).toBe('acsp');
  });

  it('Version 2.1, Monitorprofil, RGB nach XYZ', () => {
    expect(u32(p, 8)).toBe(0x0210_0000);
    expect(text(p, 12)).toBe('mntr');
    expect(text(p, 16)).toBe('RGB ');
    expect(text(p, 20)).toBe('XYZ ');
  });

  it('die PCS-Lichtart ist D50 — anderes lässt ICC nicht zu', () => {
    const fest = (von: number): number =>
      new DataView(p.buffer, p.byteOffset, p.byteLength).getInt32(von, false) / 65536;
    expect(fest(68)).toBeCloseTo(0.9642, 4);
    expect(fest(72)).toBeCloseTo(1.0, 4);
    expect(fest(76)).toBeCloseTo(0.8249, 4);
  });
});

describe('(2) Die Tagtabelle ist vollständig und zeigt ins Profil', () => {
  const p = sRgbProfil();
  const anzahl = u32(p, 128);

  it('die neun Pflichttags eines Matrix/TRC-Profils sind da', () => {
    const namen = new Set<string>();
    for (let i = 0; i < anzahl; i += 1) namen.add(text(p, 132 + i * 12));
    for (const t of ['desc', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC', 'cprt']) {
      expect(namen, `Tag ${t} fehlt`).toContain(t);
    }
  });

  it('jeder Versatz plus Länge bleibt INNERHALB der Datei', () => {
    for (let i = 0; i < anzahl; i += 1) {
      const versatz = u32(p, 136 + i * 12);
      const laenge = u32(p, 140 + i * 12);
      expect(versatz % 4, 'Tags stehen auf Vier-Byte-Grenzen').toBe(0);
      expect(versatz + laenge).toBeLessThanOrEqual(p.length);
    }
  });

  it('die drei Tonwertkurven sind identisch und monoton steigend', () => {
    const versatzVon = (name: string): number => {
      for (let i = 0; i < anzahl; i += 1) {
        if (text(p, 132 + i * 12) === name) return u32(p, 136 + i * 12);
      }
      throw new Error(`Tag ${name} fehlt`);
    };
    const r = versatzVon('rTRC');
    expect(versatzVon('gTRC')).toBe(r);
    expect(versatzVon('bTRC')).toBe(r);

    expect(text(p, r)).toBe('curv');
    const punkte = u32(p, r + 8);
    expect(punkte).toBe(1024);
    const sicht = new DataView(p.buffer, p.byteOffset, p.byteLength);
    let vorher = -1;
    for (let i = 0; i < punkte; i += 1) {
      const wert = sicht.getUint16(r + 12 + i * 2, false);
      expect(wert).toBeGreaterThanOrEqual(vorher);
      vorher = wert;
    }
    /* Die Ränder der sRGB-Kurve: 0 bleibt 0, 1 wird voll ausgesteuert. */
    expect(sicht.getUint16(r + 12, false)).toBe(0);
    expect(sicht.getUint16(r + 12 + (punkte - 1) * 2, false)).toBe(65535);
  });

  /**
   * Der lineare Fuss der sRGB-Kurve. Eine reine Gamma-2,2-Kurve läge bei
   * 20 % Eingabe rund 8 % daneben — sichtbar genau dort, wo eine Rechnung
   * ihre grauen Linien hat.
   */
  it('bei 20 % Eingabe steht der linearisierte Wert bei rund 3,3 %', () => {
    const versatz = (() => {
      for (let i = 0; i < anzahl; i += 1) {
        if (text(p, 132 + i * 12) === 'rTRC') return u32(p, 136 + i * 12);
      }
      throw new Error('rTRC fehlt');
    })();
    const sicht = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const bei = Math.round(0.2 * 1023);
    const wert = sicht.getUint16(versatz + 12 + bei * 2, false) / 65535;
    expect(wert).toBeCloseTo(0.0331, 3);
  });
});

describe('(3) Dasselbe Profil bei jedem Aufruf', () => {
  it('zwei Aufrufe ergeben dieselben Bytes — sonst wäre jede Rechnung einmalig', () => {
    expect(Buffer.from(sRgbProfil())).toEqual(Buffer.from(sRgbProfil()));
  });
});
