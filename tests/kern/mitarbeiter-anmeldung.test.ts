/**
 * Die reinen Teile der Anmeldung mit Telefon und Einmalcode (PR 20, EMP-01).
 *
 * Was die Datenbank entscheidet, prueft die Isolationssuite; hier stehen die
 * Stellen, an denen ein Fehler NICHT auffaellt: eine Nummer, die zweimal
 * anders geschrieben wird, und ein Code, der vorhersagbar ist.
 */
import { describe, expect, it } from 'vitest';
import {
  codeAnfordern, codeHash, neuerCode, normalisiereTelefon,
} from '../../src/server/auth/mitarbeiter-anmeldung.js';
import {
  EntwicklungsSmsDienst, NichtVerbundenerSmsDienst,
} from '../../src/server/auth/sms.js';

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

/**
 * **Der Klartextcode verlaesst die Anwendung nur auf der Entwicklungsflaeche.**
 *
 * Das stand hier nicht, und die erste Fassung war deshalb falsch: sie gab den
 * Code frei, wenn `!sms.verbunden` — und BEIDE Dienste sind `verbunden =
 * false`. Der eine, weil O-82 offen ist, der andere, weil er absichtlich
 * nichts sendet. In einer Auslieferung ohne Gateway haette also jeder
 * Unbekannte die Nummer eines Beschaeftigten eingetippt und den Code daneben
 * gelesen: ein Einmalcode, den der Anfordernde sieht, ohne das Telefon zu
 * haben, ist kein Faktor, sondern eine Tuer.
 *
 * Die Zusage heisst jetzt `zeigtCode` und ist eine EIGENE, kein Umkehrschluss.
 */
describe('der Code wird nur gezeigt, wo er gezeigt werden darf', () => {
  /**
   * Eine Abfrage, die `app.zugang_code_anfordern` immer mit `true` beantwortet
   * — die Datenbankentscheidung selbst steht in der Isolationssuite. Hier geht
   * es nur darum, was die Anwendung mit dem Code TUT.
   */
  const abfrageJa = {
    unsafe: (): Promise<readonly unknown[]> => Promise.resolve([{ ok: true }]),
  };

  it('nicht verbundener Dienst: kein Klartextcode in der Antwort', async () => {
    const ergebnis = await codeAnfordern(
      abfrageJa, '0170 1234567', new NichtVerbundenerSmsDienst(),
    );
    expect(ergebnis.angenommen).toBe(true);
    expect(
      ergebnis.codeFuerEntwicklung,
      'ohne Gateway darf der Code NICHT auf dem Bildschirm dessen landen, der '
      + 'ihn angefordert hat — sonst genuegt eine fremde Nummer zum Anmelden',
    ).toBeNull();
  });

  it('Entwicklungsdienst: Klartextcode, sechsstellig', async () => {
    const ergebnis = await codeAnfordern(
      abfrageJa, '0170 1234567', new EntwicklungsSmsDienst(),
    );
    expect(ergebnis.codeFuerEntwicklung).toMatch(/^[0-9]{6}$/u);
  });

  /**
   * **Die Gegenprobe: `verbunden` allein traegt die Entscheidung NICHT.**
   *
   * Wer `zeigtCode` wieder durch `!verbunden` ersetzt, macht diesen Test
   * gruen — beide Dienste oben sind ja `verbunden = false`. Deshalb hier ein
   * dritter, den es im Baum nicht gibt: verbunden UND anzeigend. Unter der
   * alten Regel gaebe er `null` zurueck, unter der richtigen den Code. Die
   * beiden Faelle sind damit nachweislich unabhaengig.
   */
  it('verbunden und anzeigend zugleich: die Anzeige folgt zeigtCode', async () => {
    const beides = {
      verbunden: true, zeigtCode: true, name: 'Prüfstand',
      sende: (): Promise<void> => Promise.resolve(),
    };
    const ergebnis = await codeAnfordern(abfrageJa, '0170 1234567', beides);
    expect(ergebnis.codeFuerEntwicklung).toMatch(/^[0-9]{6}$/u);
  });

  it('unbrauchbare Nummer: nichts angenommen, nichts gezeigt', async () => {
    const ergebnis = await codeAnfordern(
      abfrageJa, 'keine Nummer', new EntwicklungsSmsDienst(),
    );
    expect(ergebnis.angenommen).toBe(false);
    expect(ergebnis.codeFuerEntwicklung).toBeNull();
  });

  /**
   * Legt die Datenbank keinen Code an — unbekannte Nummer, gesperrt, oder drei
   * offene Codes —, gibt es auch nichts anzuzeigen. Sonst stuende auf dem
   * Bildschirm ein Code, den niemand einloesen kann, und die Anzeige waere
   * genau das Orakel, das 0114 vermeidet.
   */
  it('die Datenbank legt keinen Code an: auch der Entwicklungsdienst zeigt nichts', async () => {
    const abfrageNein = {
      unsafe: (): Promise<readonly unknown[]> => Promise.resolve([{ ok: false }]),
    };
    const ergebnis = await codeAnfordern(
      abfrageNein, '0170 1234567', new EntwicklungsSmsDienst(),
    );
    expect(ergebnis.angenommen, 'nach aussen immer dieselbe Antwort').toBe(true);
    expect(ergebnis.codeFuerEntwicklung).toBeNull();
  });
});
