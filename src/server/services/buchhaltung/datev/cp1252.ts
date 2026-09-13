/**
 * Windows-1252 als Bytes (ACC-02 Abnahme (1)).
 *
 * **Warum eine eigene Tabelle statt einer Abhängigkeit.** Node kodiert nur
 * UTF-8; `TextEncoder` kennt kein Windows-1252, und `Buffer.from(s, 'latin1')`
 * ist ISO-8859-1 — das ist NICHT dasselbe. Die beiden unterscheiden sich in
 * genau 27 Zeichen im Bereich 0x80–0x9F, und darunter sind `€`, `„`, `"` und
 * die Gedankenstriche: also genau die Zeichen, die in einem deutschen
 * Buchungstext vorkommen. `latin1` bildet sie auf Steuerzeichen ab, und DATEV
 * liest dann ein Kästchen, wo der Betrag in Euro stand.
 *
 * Eine Bibliothek für siebenundzwanzig Zeichen wäre eine Abhängigkeit mehr in
 * einem Pfad, der eine Datei für eine Betriebsprüfung erzeugt. Die Tabelle
 * steht hier, sie ist vollständig, und ein Test prüft jedes ihrer Zeichen.
 */

/** 0x80–0x9F: der einzige Bereich, in dem CP1252 von ISO-8859-1 abweicht. */
const HOCH: Readonly<Record<number, number>> = {
  0x20ac: 0x80, /* € */ 0x201a: 0x82, /* ‚ */ 0x0192: 0x83, /* ƒ */
  0x201e: 0x84, /* „ */ 0x2026: 0x85, /* … */ 0x2020: 0x86, /* † */
  0x2021: 0x87, /* ‡ */ 0x02c6: 0x88, /* ˆ */ 0x2030: 0x89, /* ‰ */
  0x0160: 0x8a, /* Š */ 0x2039: 0x8b, /* ‹ */ 0x0152: 0x8c, /* Œ */
  0x017d: 0x8e, /* Ž */ 0x2018: 0x91, /* ' */ 0x2019: 0x92, /* ' */
  0x201c: 0x93, /* " */ 0x201d: 0x94, /* " */ 0x2022: 0x95, /* • */
  0x2013: 0x96, /* – */ 0x2014: 0x97, /* — */ 0x02dc: 0x98, /* ˜ */
  0x2122: 0x99, /* ™ */ 0x0161: 0x9a, /* š */ 0x203a: 0x9b, /* › */
  0x0153: 0x9c, /* œ */ 0x017e: 0x9e, /* ž */ 0x0178: 0x9f, /* Ÿ */
};

/**
 * Was an die Stelle eines Zeichens tritt, das es in CP1252 nicht gibt.
 *
 * **Ein Fragezeichen und kein Wurf.** Die Alternative wäre, den Export an
 * einem arabischen oder türkischen Namen scheitern zu lassen — und die
 * Plattform führt solche Namen (SPEC §10). Eine Buchung mit einem
 * Fragezeichen im Text ist unschön; eine Buchhaltung, die sich nicht
 * exportieren lässt, weil ein Mitarbeiter Ünal heisst, wäre ein Fehler. `Ü`
 * gibt es übrigens, `ğ` nicht.
 */
const ERSATZ = 0x3f;

/** Ein String als CP1252-Bytes. Kein BOM — CP1252 hat keines. */
export function nachCp1252(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const zeichen of text) {
    const punkt = zeichen.codePointAt(0)!;
    if (punkt <= 0x7f || (punkt >= 0xa0 && punkt <= 0xff)) {
      bytes.push(punkt);
      continue;
    }
    const hoch = HOCH[punkt];
    bytes.push(hoch ?? ERSATZ);
  }
  return Uint8Array.from(bytes);
}

/** Ob ein Text verlustfrei durch CP1252 geht — für die Vorschau im Portal. */
export function passtInCp1252(text: string): boolean {
  for (const zeichen of text) {
    const punkt = zeichen.codePointAt(0)!;
    if (punkt <= 0x7f || (punkt >= 0xa0 && punkt <= 0xff)) continue;
    if (HOCH[punkt] !== undefined) continue;
    return false;
  }
  return true;
}
