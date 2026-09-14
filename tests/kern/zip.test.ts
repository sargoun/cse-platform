/**
 * Der ZIP-Schreiber (`archiv/zip.ts`) — STORE, Nullzeit, sortiert, geprueft.
 *
 *  1. CRC-32 stimmt mit dem bekannten Pruefvektor ueberein.
 *  2. Was hineingeht, kommt heraus — Verzeichnis und Bytes.
 *  3. Zwei Laeufe, dieselben Bytes; die Reihenfolge der Eingabe ist egal.
 *  4. Gefaehrliche Pfade, Doppelte und zu viele Eintraege sind Fehler.
 *  5. Ein gekipptes Byte faellt beim Lesen auf.
 */
import { describe, expect, it } from 'vitest';
import {
  ZipFehler, crc32, leseZipEintrag, leseZipVerzeichnis, schreibeZip,
} from '../../src/server/services/archiv/zip.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('(1) CRC-32', () => {
  it('liefert den Pruefvektor der Norm fuer „123456789"', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('(2) hin und zurueck', () => {
  it('Verzeichnis und Inhalte stimmen, Methode ist STORE', () => {
    const zip = schreibeZip([
      { pfad: 'manifest.json', bytes: enc.encode('{"a":1}') },
      { pfad: 'belege/RE-00001.pdf', bytes: enc.encode('%PDF-1.4 fake') },
    ]);
    const v = leseZipVerzeichnis(zip);
    expect(v.map((e) => e.pfad)).toEqual(['belege/RE-00001.pdf', 'manifest.json']);
    expect(v.every((e) => e.methode === 0)).toBe(true);
    expect(dec.decode(leseZipEintrag(zip, v[1]!))).toBe('{"a":1}');
    expect(dec.decode(leseZipEintrag(zip, v[0]!))).toBe('%PDF-1.4 fake');
    // Signaturen: lokaler Kopf am Anfang, Endekopf am Ende.
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...zip.subarray(zip.length - 22, zip.length - 18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it('ein leeres Archiv ist nur der Endekopf', () => {
    const zip = schreibeZip([]);
    expect(zip.length).toBe(22);
    expect(leseZipVerzeichnis(zip)).toEqual([]);
  });

  it('UTF-8-Pfade ueberleben', () => {
    const zip = schreibeZip([{ pfad: 'belege/Bündel ä.pdf', bytes: enc.encode('x') }]);
    expect(leseZipVerzeichnis(zip)[0]?.pfad).toBe('belege/Bündel ä.pdf');
  });
});

describe('(3) reproduzierbar', () => {
  it('dieselben Eintraege ergeben dieselben Bytes — in jeder Reihenfolge', () => {
    const a = { pfad: 'a.txt', bytes: enc.encode('A') };
    const b = { pfad: 'b/c.txt', bytes: enc.encode('BC') };
    const eins = schreibeZip([a, b]);
    const zwei = schreibeZip([b, a]);
    expect(Buffer.from(eins).equals(Buffer.from(zwei))).toBe(true);
    // Kein Zeitstempel aus der Uhr: DOS-Zeit 0, DOS-Datum 1980-01-01.
    const sicht = new DataView(eins.buffer, eins.byteOffset, eins.byteLength);
    expect(sicht.getUint16(10, true)).toBe(0);
    expect(sicht.getUint16(12, true)).toBe(0x0021);
  });
});

describe('(4) Grenzen', () => {
  it('weist Pfade ab, die aus dem Ordner fuehren', () => {
    for (const pfad of ['../x', '/abs', 'a/../b', 'a\\b', '', 'ordner/', 'a/./b']) {
      expect(() => schreibeZip([{ pfad, bytes: enc.encode('x') }]),
        pfad).toThrow(ZipFehler);
    }
  });

  it('weist einen doppelten Pfad ab', () => {
    expect(() => schreibeZip([
      { pfad: 'x', bytes: enc.encode('1') }, { pfad: 'x', bytes: enc.encode('2') },
    ])).toThrow(/zweimal/u);
  });

  it('weist mehr als 65 535 Eintraege ab — kein ZIP64', () => {
    const viele = Array.from({ length: 65_536 }, (_, i) => ({ pfad: `e${String(i)}`, bytes: new Uint8Array(0) }));
    expect(() => schreibeZip(viele)).toThrow(/ZIP64/u);
  });
});

describe('(5) Integritaet', () => {
  it('ein gekipptes Byte im Inhalt faellt beim Lesen auf', () => {
    const zip = schreibeZip([{ pfad: 'a.txt', bytes: enc.encode('hallo welt') }]);
    const kaputt = new Uint8Array(zip);
    const v = leseZipVerzeichnis(kaputt);
    const e = v[0]!;
    const stelle = e.offset + 30 + 5;   // ein Byte im Datenbereich
    kaputt[stelle] = (kaputt[stelle] ?? 0) ^ 0x01;
    expect(() => leseZipEintrag(kaputt, e)).toThrow(/CRC/u);
  });

  it('kein ZIP ist ein Formatfehler, kein Absturz', () => {
    expect(() => leseZipVerzeichnis(enc.encode('nicht zip, aber lang genug fuer 22 bytes'))).toThrow(ZipFehler);
    expect(() => leseZipVerzeichnis(new Uint8Array(3))).toThrow(ZipFehler);
  });
});
