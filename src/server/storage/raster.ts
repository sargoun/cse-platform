/**
 * **Was ein Rasterbild über seine Farben sagt** — gelesen aus den Bytes,
 * nicht aus einer Endung (V-132).
 *
 * Gebraucht an zwei Stellen, und deshalb hier und nicht in einer davon:
 *
 *  - `mandant/markenbild.ts` nimmt ein CMYK-JPEG nicht als Logo für Papier
 *    an. Ein PDF/A-3 mit sRGB-Ausgabeprofil (`zugferd/icc.ts`) darf kein
 *    DeviceCMYK enthalten (ISO 19005-3, 6.2.4.3) — die Rechnung wäre mit
 *    diesem Logo kein PDF/A mehr, und das fiele erst beim Empfänger auf.
 *  - `zugferd/pdfa3.ts` prüft dasselbe noch einmal, bevor es einbettet: ein
 *    Logo, das VOR dieser Prüfung hochgeladen wurde, kommt sonst an ihr
 *    vorbei.
 */

/**
 * Die Zahl der Farbkomponenten eines JPEG (1 = Grau, 3 = YCbCr/RGB,
 * 4 = CMYK/YCCK) — oder `null`, wenn kein Bildkopf (SOF) zu finden ist.
 *
 * Gelesen wird die Segmentkette bis zum ersten SOF-Marker (`FFC0`–`FFCF`
 * ohne `FFC4` Huffman, `FFC8` reserviert, `FFCC` arithmetische Tabellen).
 * Dort steht nach Länge (2), Genauigkeit (1), Höhe (2) und Breite (2) die
 * Komponentenzahl.
 */
export function jpegKomponenten(daten: Uint8Array): number | null {
  if (daten.length < 4 || daten[0] !== 0xff || daten[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= daten.length) {
    if (daten[i] !== 0xff) return null;
    const marke = daten[i + 1] ?? 0;
    /* Füllbytes (FF FF …) zählen zur nächsten Marke. */
    if (marke === 0xff) { i += 1; continue; }
    /* Marken ohne Länge: TEM und RST0–RST7. */
    if (marke === 0x01 || (marke >= 0xd0 && marke <= 0xd7)) { i += 2; continue; }
    /* Bildende oder Bildanfang ohne Kopf davor: kein Kopf. */
    if (marke === 0xd9 || marke === 0xda) return null;
    const laenge = ((daten[i + 2] ?? 0) << 8) | (daten[i + 3] ?? 0);
    if (laenge < 2) return null;
    const istSof = marke >= 0xc0 && marke <= 0xcf
      && marke !== 0xc4 && marke !== 0xc8 && marke !== 0xcc;
    if (istSof) {
      const stelle = i + 9;
      return stelle < daten.length ? (daten[stelle] ?? null) : null;
    }
    i += 2 + laenge;
  }
  return null;
}

/** Ein JPEG, das in ein PDF/A mit sRGB-Profil nicht hineindarf. */
export function istCmykJpeg(daten: Uint8Array): boolean {
  return jpegKomponenten(daten) === 4;
}
