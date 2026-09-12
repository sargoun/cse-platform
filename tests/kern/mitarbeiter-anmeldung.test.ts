/**
 * Die reinen Teile der Anmeldung mit Telefon und Einmalcode (PR 20, EMP-01).
 *
 * Was die Datenbank entscheidet, prueft die Isolationssuite; hier stehen die
 * Stellen, an denen ein Fehler NICHT auffaellt: eine Nummer, die zweimal
 * anders geschrieben wird, und ein Code, der vorhersagbar ist.
 */
import { describe, expect, it } from 'vitest';
import {
  codeHash, neuerCode, normalisiereTelefon,
} from '../../src/server/auth/mitarbeiter-anmeldung.js';

describe('eine Telefonnummer hat GENAU EINE Schreibweise (EMP-14)', () => {
  /**
   * **Der Ausfall, gegen den das steht.** `telefon_e164` ist `unique`. Ohne
   * Normalisierung ist diese Zusage wertlos: dieselbe Frau traegt sich
   * einmal als `0170 1234567` und einmal als `+49 170 1234567` ein, die
   * Datenbank sieht zwei verschiedene Zeichenketten und legt ihr zwei
   * Zugaenge an — und EMP-14 („ein Login je Mensch") ist gebrochen, ohne
   * dass irgendein Riegel angeschlagen haette.
   */
  const DIESELBE_NUMMER = [
    '0170 1234567',
    '01701234567',
    '+49 170 1234567',
    '+491701234567',
    '0049 170 1234567',
    '0049-170-1234567',
    '(0170) 123 45 67',
    '0170/1234567',
    '0170.123.4567',
  ];

  it.each(DIESELBE_NUMMER)('„%s" wird zu +491701234567', (eingabe) => {
    expect(normalisiereTelefon(eingabe)).toBe('+491701234567');
  });

  it('alle neun Schreibweisen ergeben EINEN Wert, nicht neun', () => {
    const werte = new Set(DIESELBE_NUMMER.map((n) => normalisiereTelefon(n)));
    expect([...werte]).toEqual(['+491701234567']);
  });

  /** Eine auslaendische Nummer bleibt auslaendisch — siehe der Kommentar dort. */
  it('eine tuerkische Nummer wird NICHT zu einer deutschen', () => {
    expect(normalisiereTelefon('+90 532 1234567')).toBe('+905321234567');
    expect(normalisiereTelefon('0090 532 1234567')).toBe('+905321234567');
  });

  const UNBRAUCHBAR = [
    ['', 'leer'],
    ['   ', 'nur Leerraum'],
    ['1701234567', 'weder + noch fuehrende Null — mehrdeutig'],
    ['0170', 'zu kurz'],
    ['+0170123456', 'Laenderkennung beginnt mit 0'],
    ['0170ABC4567', 'Buchstaben'],
    ['+4917012345678901234', 'laenger als E.164 erlaubt'],
  ] as const;

  it.each(UNBRAUCHBAR)('„%s" ergibt null (%s)', (eingabe) => {
    expect(normalisiereTelefon(eingabe)).toBeNull();
  });
});

describe('der Einmalcode', () => {
  it('hat immer sechs Stellen — auch mit fuehrenden Nullen', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(neuerCode()).toMatch(/^[0-9]{6}$/u);
    }
  });

  /**
   * **Keine harte Zusage ueber Zufall, aber eine ueber Nicht-Konstanz.**
   *
   * Ein Test kann nicht beweisen, dass eine Quelle kryptografisch ist. Er
   * kann aber zeigen, dass sie sich bewegt: ein Code-Generator, der aus
   * Versehen einen konstanten oder streng aufsteigenden Wert liefert — der
   * haeufigste Weg, das kaputtzumachen —, faellt hier.
   */
  it('liefert nicht denselben Wert und nicht eine Reihe', () => {
    const codes = Array.from({ length: 200 }, () => neuerCode());
    expect(new Set(codes).size).toBeGreaterThan(150);

    const zahlen = codes.map(Number);
    const aufsteigend = zahlen.every((z, i) => i === 0 || z >= zahlen[i - 1]!);
    expect(aufsteigend, 'die Codes laufen der Reihe nach — das ist kein Zufall')
      .toBe(false);
  });

  it('deckt den ganzen Bereich ab, auch die kleinen Zahlen', () => {
    const codes = Array.from({ length: 5000 }, () => neuerCode());
    // Bei Gleichverteilung sind rund 1 % unter 010000; die Schranke ist weit
    // genug, um nicht zu flattern, und eng genug, um `randomInt(100000,…)`
    // — den haeufigsten Denkfehler „sechsstellig heisst ab 100000" — zu fangen.
    expect(codes.filter((c) => c.startsWith('0')).length).toBeGreaterThan(5);
  });

  it('der Hash ist stabil und nicht der Code selbst', () => {
    expect(codeHash('123456')).toBe(codeHash('123456'));
    expect(codeHash('123456')).not.toBe(codeHash('123457'));
    expect(codeHash('123456')).toMatch(/^[0-9a-f]{64}$/u);
    expect(codeHash('123456')).not.toContain('123456');
  });
});
