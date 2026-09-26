/**
 * Kleine, ECHTE Bilder für die Prüfungen von V-132 — erzeugt, nicht erfunden.
 *
 * Das PNG entsteht hier aus seinen Bausteinen (IHDR, IDAT, IEND, je mit
 * CRC-32), damit eine Prüfung Breite, Höhe und Alphakanal selbst bestimmt.
 * Die drei JPEGs sind je 16 × 8 Pixel in CSE-Rot, einmal mit `sharp` erzeugt
 * und hier als Base64 abgelegt: ein JPEG-Kodierer gehört nicht in die
 * Abhängigkeiten der Plattform, nur um drei Probestücke zu bauen.
 */
import { crc32, deflateSync } from 'node:zlib';

function stueck(art: string, inhalt: Uint8Array): Buffer {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(inhalt.length);
  const kopfUndInhalt = Buffer.concat([Buffer.from(art, 'latin1'), inhalt]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(kopfUndInhalt) >>> 0);
  return Buffer.concat([laenge, kopfUndInhalt, pruef]);
}

/**
 * Ein PNG, 8 Bit je Kanal, RGBA (Farbtyp 6) — mit echter Transparenz: die
 * linke Hälfte deckend, die rechte halb durchsichtig. Genau das, was ein
 * Logo meistens ist, und genau das, was in PDF/A eine `/SMask` braucht.
 */
export function pngMitAlpha(breite: number, hoehe: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8;   // Bittiefe
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const zeilen = Buffer.alloc(hoehe * (1 + breite * 4));
  for (let y = 0; y < hoehe; y += 1) {
    const anfang = y * (1 + breite * 4);
    zeilen[anfang] = 0; // Filter: keiner
    for (let x = 0; x < breite; x += 1) {
      const p = anfang + 1 + x * 4;
      zeilen[p] = 0xe3; zeilen[p + 1] = 0x06; zeilen[p + 2] = 0x13;
      zeilen[p + 3] = x < breite / 2 ? 0xff : 0x80;
    }
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    stueck('IHDR', ihdr),
    stueck('IDAT', deflateSync(zeilen)),
    stueck('IEND', new Uint8Array(0)),
  ]));
}

const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

/** 16 × 8, drei Komponenten (YCbCr) — das gewöhnliche JPEG. */
export const JPEG_RGB = b64(''
  + '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYn'
  + 'KSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo'
  + 'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIABADASIAAhEBAxEB/8QAFQABAQAAAAAA'
  + 'AAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/'
  + 'xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCbgDi+v//Z');

/** 16 × 8, vier Komponenten (CMYK) — das, was in ein sRGB-PDF/A nicht darf. */
export const JPEG_CMYK = b64(''
  + '/9j/7gAOQWRvYmUAZAAAAAAA/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYW'
  + 'Gh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/8AAFAgACAAQBEMRAE0RAFkRAEsRAP/EABUA'
  + 'AQEAAAAAAAAAAAAAAAAAAAAI/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAA4EQwBNAFkASwAAPwCq'
  + 'UxJUVGAP/9k=');
