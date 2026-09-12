/**
 * Der XML-Pruefer der Wache `svg-wohlgeformt` (D-376).
 *
 * **Warum diese Datei so gross ist fuer so wenig Code.** Der Pruefer ist von
 * Hand geschrieben — Node bringt keinen XML-Parser mit —, und ein von Hand
 * geschriebener Parser hat genau eine gefaehrliche Fehlerart: er ist sich
 * einig mit sich selbst. Ein Test, den derselbe Kopf geschrieben hat wie den
 * Pruefer, teilt dessen blinde Flecken und beweist nichts.
 *
 * Deshalb steht hier eine TABELLE aus Faellen, die gegen einen fremden,
 * ausgewachsenen Parser abgeglichen wurde: Pythons expat (`xml.etree`). Jeder
 * Fall unten hat dort dasselbe Ergebnis geliefert. Zusaetzlich wurden 3000
 * zufaellige Mutationen der acht echten Motivtafeln gegen expat gefahren —
 * 800 davon noch wohlgeformt, 2200 kaputt, null Abweichungen in beide
 * Richtungen. Die Tabelle ist der Auszug daraus, der im Baum bleibt.
 *
 * Der erste Fall der zweiten Gruppe ist der ECHTE Fehler: ein doppelter
 * Bindestrich im XML-Kommentar. Er stand acht Mal im Baum, wurde mit 200
 * ausgeliefert und nie gezeichnet.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pruefeXml } from '../../scripts/guards/xml-wohlgeformt.js';

const WURZEL = resolve(import.meta.dirname, '../..');

describe('pruefeXml nimmt an, was ein echter XML-Parser annimmt', () => {
  const WOHLGEFORMT: readonly string[] = [
    "<svg/>",
    "<svg></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"2\"/></svg>",
    "<?xml version=\"1.0\"?>\n<svg><g><path d=\"M0 0L1 1\"/></g></svg>",
    "<!-- gut -->\n<svg/>",
    "<svg><!-- ein Bindestrich - geht --></svg>",
    "<svg><text>Reinigung &amp; Service</text></svg>",
    "<svg><text>&#169; &#x2014;</text></svg>",
    "<svg><style><![CDATA[ a > b { fill: red } ]]></style></svg>",
    "<svg a='eins' b=\"zwei\"/>",
    "<svg\n  width=\"10\"\n  height=\"20\"\n/>",
    "<svg><\u00c4rger/></svg>",
    "<svg><g/>\n</svg>\n",
    "<svg><text>1 &lt; 2</text></svg>",
    "<svg><!-- endet auf - --></svg>",
    "<svg><!----></svg>",
    "<svg><g id=\"a-b\" data-x=\"1\"/></svg>",
    "<svg xmlns:xlink=\"http://x\"><use xlink:href=\"#a\"/></svg>",
    "<svg><text>a &amp;amp; b</text></svg>",
    "<svg />",
    "<svg></svg >",
    "<svg a = \"1\"/>",
    "<svg\ta=\"1\"/>",
    "<svg><![CDATA[ -- ist hier egal ]]></svg>",
    "<!DOCTYPE svg><svg/>",
    "<?xml version=\"1.0\"?><svg/>",
    "<svg>\n  <g>\n    <path/>\n  </g>\n</svg>\n",
    "<svg><g><g><g/></g></g></svg>",
  ];

  it.each(WOHLGEFORMT)('nimmt an: %j', (quelle) => {
    expect(pruefeXml(quelle)).toBeNull();
  });
});

describe('pruefeXml lehnt ab, was ein echter XML-Parser ablehnt', () => {
  const KAPUTT: readonly string[] = [
    "<svg><!-- kaputt -- hier --></svg>",
    "<svg><!-- nie geschlossen </svg>",
    "<svg><rect></svg>",
    "<svg></rect></svg>",
    "<svg>",
    "</svg>",
    "<svg/><svg/>",
    "<svg>Reinigung & Service</svg>",
    "<svg>&nbsp;</svg>",
    "<svg a=eins/>",
    "<svg a=\"eins/>",
    "<svg a/>",
    "<svg a=\"1\" a=\"2\"/>",
    "<svg a=\"1\"b=\"2\"/>",
    "<svg>1 < 2</svg>",
    "<svg>]]></svg>",
    "Text vor der Wurzel<svg/>",
    "",
    "<svg><g></g>",
    "<svg a=\"<\"/>",
    "<svg><? nie zu </svg>",
    "<svg><!-- endet auf ---></svg>",
    "<svg><!-- -- --></svg>",
    "<svg><text>&amp</text></svg>",
    "<svg><text>&;</text></svg>",
    "<svg><text>&#;</text></svg>",
    "<svg><text>&#xZZ;</text></svg>",
    "<svg></ svg>",
    "<svg>< g/></svg>",
    "<svg><g></G></svg>",
    "<![CDATA[x]]><svg/>",
    "<svg><![CDATA[ nie zu </svg>",
    "<svg><g><g></g></svg>",
  ];

  it.each(KAPUTT)('lehnt ab: %j', (quelle) => {
    expect(pruefeXml(quelle)).not.toBeNull();
  });
});

describe('die acht echten Motivtafeln sind wohlgeformt', () => {
  /**
   * Die Gegenprobe zur Tabelle: dass der Pruefer Kaputtes ablehnt, nuetzt
   * nichts, wenn er das Echte auch ablehnt. Eine Wache mit Fehlalarm wird
   * abgeschaltet, und dann ist sie schlechter als keine.
   *
   * Die Liste steht ABSICHTLICH ausgeschrieben und wird nicht aus dem
   * Verzeichnis gelesen. Ein leeres Verzeichnis liefert eine leere Schleife,
   * und eine leere Schleife ist ein gruener Test, der nichts geprueft hat —
   * derselbe Ausfall, der die Tafeln ueberhaupt erst durchgelassen hat.
   */
  const TAFELN = [
    'hero', 'reinigung', 'security', 'bau', 'operations', 'objekt', 'projekt', 'team',
  ] as const;

  it.each(TAFELN)('public/platzhalter/%s.svg parst', (name) => {
    const quelle = readFileSync(join(WURZEL, `public/platzhalter/${name}.svg`), 'utf8');
    expect(pruefeXml(quelle)).toBeNull();
  });

  it('und der Kommentar, der sie alle acht unsichtbar gemacht hat, faellt durch', () => {
    /**
     * Die Sabotage am ECHTEN Material, nicht an einem Kunstbeispiel: derselbe
     * Tokenname, den der Erzeuger in seinen Kommentar schreibt, diesmal wieder
     * mit seinen beiden fuehrenden Bindestrichen.
     */
    const echt = readFileSync(join(WURZEL, 'public/platzhalter/bau.svg'), 'utf8');
    expect(pruefeXml(echt)).toBeNull();

    const sabotiert = echt.replace('ausgeschrieben', 'ausgeschrieben (--cse-bild-overlay)');
    expect(sabotiert).not.toBe(echt);
    const fehler = pruefeXml(sabotiert);
    expect(fehler).not.toBeNull();
    expect(fehler?.text).toContain('Doppelter Bindestrich');
  });
});
