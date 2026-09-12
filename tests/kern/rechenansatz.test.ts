/**
 * PR 43 Akzeptanz (1), (2) und (5) — der Rechenansatz-Parser.
 *
 * Das ist der gefährlichste Code dieser Phase: aus einem Formularfeld entsteht
 * hier eine Menge, aus der Menge wird eine Rechnungszeile, und ein Fehler
 * darin ist NICHT sichtbar — die Formel steht daneben und sieht richtig aus,
 * nur die Zahl stimmt nicht. Also wird hier nicht die Schnittstelle geprüft,
 * sondern die Arithmetik selbst.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ERGEBNIS_SKALA,
  PARSER_VERSION,
  RechenansatzFehler,
  anzeigeAusSkaliert,
  berechneRechenansatz,
  mengeAusSkaliert,
  parseRechenansatz,
  versucheRechenansatz,
  werteAus,
} from '../../src/server/services/bau/rechenansatz.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const QUELLE = join(WURZEL, 'src/server/services/bau/rechenansatz.ts');

describe('(1) das Beispiel aus SPEC §8 und PR 43', () => {
  const FORMEL = '3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)';

  it('„3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)" ergibt 30,87 m²', () => {
    const e = berechneRechenansatz(FORMEL);
    // 3 × 11,55 = 34,65; 2 × 1,89 = 3,78; 34,65 − 3,78 = 30,87.
    expect(e.anzeige).toBe('30,87');
    expect(e.mengePostgres).toBe('30.870');
  });

  it('und wird in fester Skala als GANZE Zahl gehalten — 308700 cm²', () => {
    // Akzeptanz (5). Keine Gleitkommazahl, kein `number`: das Ergebnis ist ein
    // bigint in Quadratzentimetern, und genau diese Zahl steht in der Spalte.
    const e = berechneRechenansatz(FORMEL);
    expect(typeof e.skaliert).toBe('bigint');
    expect(e.skaliert).toBe(308_700n);
    expect(ERGEBNIS_SKALA).toBe(4);
  });

  it('der Formeltext bleibt wörtlich erhalten, nicht normiert', () => {
    // § 14 VOB/B meint den Rechenansatz als Beleg. Ein „aufgeräumter" Text
    // („3*(4.2*2.75)…") wäre ein anderer Beleg als der unterschriebene.
    expect(berechneRechenansatz(FORMEL).formel).toBe(FORMEL);
    expect(berechneRechenansatz(`  ${FORMEL}  `).formel).toBe(FORMEL);
  });

  it('und die Fassung des Parsers steht am Ergebnis', () => {
    // Ohne sie sähe eine Abweichung des Nachrechnungslaufs aus wie eine
    // Manipulation an der Zeile statt wie ein neuer Parser.
    expect(berechneRechenansatz(FORMEL).parserVersion).toBe(PARSER_VERSION);
  });

  it('der Baum trägt jede Zahl so, wie sie dastand', () => {
    const baum = parseRechenansatz('4,20 × 2,75');
    // Der AST ist der Beleg, dass die Menge AUS DIESER Formel stammt. Eine
    // Mantisse als `number` verlöre genau die Genauigkeit, um die es geht.
    expect(JSON.parse(JSON.stringify(baum))).toEqual({
      art: 'binaer',
      operator: 'mal',
      offset: 5,
      links: { art: 'zahl', mantisse: '420', skala: 2, text: '4,20', offset: 0 },
      rechts: { art: 'zahl', mantisse: '275', skala: 2, text: '2,75', offset: 7 },
    });
  });
});

describe('(2) angenommen wird das Vereinbarte — und sonst nichts', () => {
  const gleich = (formel: string, erwartet: bigint): void => {
    expect(berechneRechenansatz(formel).skaliert, formel).toBe(erwartet);
  };

  it('deutsches Dezimalkomma', () => {
    gleich('4,20', 42_000n);
    gleich('0,5', 5_000n);
    gleich('12', 120_000n);
  });

  it('alle drei Malzeichen bedeuten dasselbe', () => {
    for (const mal of ['×', 'x', '*']) gleich(`4,20 ${mal} 2,75`, 115_500n);
  });

  it('beide Minuszeichen bedeuten dasselbe — U+2212 und der Bindestrich', () => {
    for (const minus of ['−', '-']) gleich(`10 ${minus} 2,5`, 75_000n);
  });

  it('Plus, und das einstellige Minus einer Rückbauzeile', () => {
    gleich('1 + 2 + 3', 60_000n);
    // §7.7: „No sign check on `menge`" — Rückbau- und Abzugszeilen sind negativ.
    gleich('−2 × (0,90 × 2,10)', -37_800n);
    gleich('-3', -30_000n);
  });

  it('geschachtelte Klammern, beliebig tief innerhalb der Schranke', () => {
    gleich('((((2))))', 20_000n);
    gleich('2 × (3 + (4 − (1 + 1)))', 100_000n);
  });

  it('Punkt vor Strich, ohne Klammern', () => {
    // 3 × 4 + 2 ist 14, nie 18. Der Vorrang steckt in der Grammatik.
    gleich('3 × 4 + 2', 140_000n);
    gleich('2 + 3 × 4', 140_000n);
  });

  it('Leerraum trennt und rechnet nicht mit — auch das geschützte Leerzeichen', () => {
    gleich('3 × 4', 120_000n);
    gleich('3\n×\n4', 120_000n);
  });

  it('aber ein fremdes Zeichen wird mit OFFSET zurückgewiesen', () => {
    // Der Offset ist der Punkt: „ungültig" schickt den Polier auf die Suche.
    const fehler = fange('4,20 × 2,75 % 3');
    expect(fehler.grund).toBe('zeichen_unbekannt');
    expect(fehler.offset).toBe(12);
  });

  it('und der Offset zeigt wirklich auf das Zeichen, nicht irgendwohin', () => {
    for (const [formel, offset] of [
      ['÷2', 0], ['2 ÷ 2', 2], ['1 + 2 + a', 8], ['12,5 € × 2', 5],
    ] as const) {
      expect(fange(formel).offset, formel).toBe(offset);
    }
  });

  it('der Punkt ist KEIN Dezimaltrennzeichen und kein Tausenderpunkt', () => {
    // `1.234` ist zweideutig — in Deutschland 1234, aus einer Tabelle oft
    // 1,234. Geraten wird nicht; der Mensch entscheidet.
    const fehler = fange('1.234,50');
    expect(fehler.grund).toBe('zeichen_unbekannt');
    expect(fehler.offset).toBe(1);
  });

  it('eine Division gibt es nicht', () => {
    expect(fange('12 / 4').grund).toBe('zeichen_unbekannt');
  });

  it('halbe Formeln sind Fehler, keine ergänzten Zahlen', () => {
    expect(fange('4,').grund).toBe('zahl_ungueltig');
    expect(fange('4,,20').grund).toBe('zahl_ungueltig');
    expect(fange('3 ×').grund).toBe('operand_fehlt');
    expect(fange('× 3').grund).toBe('operand_fehlt');
    expect(fange('(3 + 2').grund).toBe('klammer_offen');
    expect(fange('3 + 2)').grund).toBe('klammer_ueberzaehlig');
    expect(fange('').grund).toBe('leer');
    expect(fange('   ').grund).toBe('leer');
  });

  it('und zu tiefe Schachtelung ist ein Fehler, kein Stapelüberlauf', () => {
    const tief = `${'('.repeat(500)}1${')'.repeat(500)}`;
    expect(fange(tief).grund).toBe('zu_tief');
  });

  it('ein unrealistisch grosses Ergebnis wird benannt, nicht abgeschnitten', () => {
    const riesig = Array.from({ length: 40 }, () => '9999999999').join(' × ');
    expect(fange(riesig).grund).toBe('zu_gross');
  });
});

describe('(2) es gibt kein eval — und das steht im Quelltext', () => {
  it('weder `eval` noch `new Function` noch ein Umweg über den Konstruktor', () => {
    /**
     * Die Prüfung liest den QUELLTEXT, nicht das Verhalten. Ein Parser, der
     * heute rechnet und morgen unter Zeitdruck „nur für den Sonderfall" ein
     * `eval` bekommt, verhielte sich in jedem Test gleich — und führte dabei
     * Text aus einem Formularfeld aus, mit Kundendaten daneben.
     */
    const code = ohneKommentare(readFileSync(QUELLE, 'utf8'));
    expect(code).not.toMatch(/\beval\s*\(/u);
    expect(code).not.toMatch(/\bnew\s+Function\b/u);
    expect(code).not.toMatch(/\bFunction\s*\(/u);
    expect(code).not.toMatch(/\bnew\s+(?:Async|Generator)Function\b/u);
    // `constructor` als Weg zu `Function` — der Umweg, den ein Prüfer sucht.
    expect(code).not.toMatch(/\.constructor\s*\(/u);
  });

  it('und keine Gleitkommaarithmetik auf dem Rechenweg', () => {
    // `parseFloat` oder `Math.round` auf einer Mantisse wäre der zweite Weg,
    // auf dem 0,1 + 0,2 in ein Aufmaß gerät. Geprüft wird der CODE — der Kopf
    // nennt `Math.round` ausdrücklich, um zu sagen, warum es nicht benutzt wird.
    const code = ohneKommentare(readFileSync(QUELLE, 'utf8'));
    expect(code).not.toMatch(/parseFloat/u);
    expect(code).not.toMatch(/Math\.(?:round|floor|ceil|abs)|toFixed/u);
  });
});

describe('(2) zehntausend Eingaben: ein Wert oder ein typisierter Fehler', () => {
  /**
   * **Kein Absturz, kein `NaN`, kein `undefined`.** Der Zufallsgenerator ist
   * mit einer festen Zahl gesetzt: ein Fehlschlag muss reproduzierbar sein,
   * sonst ist er ein Gerücht.
   */
  const ZEICHEN = [
    '0', '1', '2', '3', '7', '9', ',', '.', ' ', ' ', '×', 'x', '*', '+', '-', '−',
    '(', ')', '/', '%', '€', 'm', '²', ':', ';', '\\', '\'', '"', '\n', '\t', '=', '&',
  ];

  /** xorshift32 — deterministisch, ohne Abhängigkeit. */
  function* zufall(start: number): Generator<number> {
    let x = start;
    for (;;) {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      yield x;
    }
  }

  it('10.000 zufällige Eingaben liefern Wert oder Fehler — nie einen Absturz', () => {
    const strom = zufall(20_260_910);
    let werte = 0;
    let fehler = 0;

    for (let n = 0; n < 10_000; n += 1) {
      const laenge = (strom.next().value % 24) + 1;
      let eingabe = '';
      for (let k = 0; k < laenge; k += 1) {
        eingabe += ZEICHEN[strom.next().value % ZEICHEN.length] as string;
      }

      const ergebnis = versucheRechenansatz(eingabe);
      if (ergebnis.ok) {
        werte += 1;
        expect(typeof ergebnis.ergebnis.skaliert, eingabe).toBe('bigint');
        // Ein `bigint` KANN kein NaN sein — genau deshalb ist er hier der Typ.
        // Geprüft wird die Projektion, in der ein NaN entstehen könnte:
        expect(ergebnis.ergebnis.mengePostgres, eingabe).toMatch(/^-?\d+\.\d{3}$/u);
        expect(ergebnis.ergebnis.anzeige, eingabe).not.toMatch(/NaN|Infinity|undefined/u);
      } else {
        fehler += 1;
        expect(ergebnis.grund, eingabe).toBeTypeOf('string');
        expect(Number.isInteger(ergebnis.offset), eingabe).toBe(true);
        expect(ergebnis.offset, eingabe).toBeGreaterThanOrEqual(0);
      }
    }

    // Beide Seiten müssen vorkommen: nur Fehler hiesse, der Generator trifft
    // nie eine gültige Formel, und dann prüfte die Schleife gar nichts.
    expect(werte, 'kein einziger gültiger Zufallstreffer').toBeGreaterThan(0);
    expect(fehler).toBeGreaterThan(0);
    expect(werte + fehler).toBe(10_000);
  });

  it('auch gezielt bösartige Eingaben werfen nur den eigenen Fehler', () => {
    const boese = [
      '(', ')', '((((((((((', '1' + '+'.repeat(5000), ',,,', '--', '−−1',
      '9'.repeat(500), `9,${'9'.repeat(500)}`, ' ', '𝟛 × 2', '3 × 𝟚',
      'process.exit(1)', 'require("fs")', '1;DROP TABLE aufmass', '${1+1}',
    ];
    for (const eingabe of boese) {
      const ergebnis = versucheRechenansatz(eingabe);
      if (ergebnis.ok) {
        expect(typeof ergebnis.ergebnis.skaliert, eingabe).toBe('bigint');
      } else {
        expect(ergebnis.grund, eingabe).toBeTypeOf('string');
      }
    }
  });
});

describe('(5) gerundet wird genau einmal, ganz am Ende', () => {
  it('Zwischenergebnisse behalten jede Stelle', () => {
    // 0,3333 × 3 ist 0,9999 — wer zwischendurch auf drei Stellen rundete,
    // bekäme 1,0000 und läge um eine Stelle daneben.
    expect(berechneRechenansatz('0,3333 × 3').skaliert).toBe(9_999n);
    // Fünf Nachkommastellen im Produkt, EINE Rundung am Schluss.
    expect(berechneRechenansatz('1,005 × 1,005').skaliert).toBe(10_100n);
  });

  it('kaufmännisch, und für negative Mengen symmetrisch', () => {
    expect(berechneRechenansatz('0,00005').skaliert).toBe(1n);
    expect(berechneRechenansatz('−0,00005').skaliert).toBe(-1n);
    expect(berechneRechenansatz('0,00004').skaliert).toBe(0n);
  });

  it('`menge` ist die PROJEKTION der einen Zahl, keine zweite Rechnung', () => {
    // Sie wird aus `skaliert` abgeleitet. Zwei unabhängige Rundungen desselben
    // Werts könnten sich in der dritten Stelle unterscheiden — und dann
    // stritte die Datenbank mit sich selbst über die abgerechnete Menge.
    expect(mengeAusSkaliert(308_700n)).toBe('30.870');
    expect(mengeAusSkaliert(5n)).toBe('0.001');
    expect(mengeAusSkaliert(4n)).toBe('0.000');
    expect(mengeAusSkaliert(-5n)).toBe('-0.001');
    expect(mengeAusSkaliert(0n)).toBe('0.000');
  });

  it('die Anzeige ist deutsch, mit zwei bis drei Stellen', () => {
    expect(anzeigeAusSkaliert(308_700n)).toBe('30,87');
    expect(anzeigeAusSkaliert(12_345_678_900n)).toBe('1.234.567,89');
    expect(anzeigeAusSkaliert(1_234n)).toBe('0,123');
    expect(anzeigeAusSkaliert(0n)).toBe('0,00');
    expect(anzeigeAusSkaliert(-308_700n)).toBe('−30,87');
  });

  it('`werteAus` nimmt eine andere Zielskala, rundet aber immer nur einmal', () => {
    const baum = parseRechenansatz('0,00005');
    expect(werteAus(baum, 4)).toBe(1n);
    expect(werteAus(baum, 3)).toBe(0n);
    expect(werteAus(baum, 5)).toBe(5n);
  });
});

/** Der Fehler, den ein Aufruf wirft — als Wert, damit die Prüfung lesbar bleibt. */
function fange(formel: string): RechenansatzFehler {
  try {
    berechneRechenansatz(formel);
  } catch (fehler: unknown) {
    if (fehler instanceof RechenansatzFehler) return fehler;
    throw fehler;
  }
  throw new Error(`Erwartet wurde ein Fehler für ${JSON.stringify(formel)}`);
}

/** Blockkommentare und Zeilenkommentare raus — eine Erwähnung ist keine Benutzung. */
function ohneKommentare(inhalt: string): string {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .split('\n')
    .map((z) => z.replace(/(^|\s)\/\/.*$/u, '$1'))
    .join('\n');
}
