import { describe, expect, it } from 'vitest';
import {
  aoFrist, berlinTag, milogFrist,
} from '../../src/server/services/datenschutz/loeschentscheidung.js';
import { alsText, alsMarkdown, type Auskunft }
  from '../../src/server/services/datenschutz/auskunft.js';

/**
 * Die REINEN Rechnungen der Löschprüfung und der Art.-15-Auskunft.
 *
 * **Warum sie hier stehen und nicht in einer Seite.** Eine Löschentscheidung
 * nennt den Tag, an dem die Sperre fällt; dieser Tag ist eine Rechnung, und
 * Invariante 6 verlangt für jede Rechnung eine getestete Funktion. Die
 * gefährlichen Fälle sind alle Kalenderfälle: der Jahreswechsel, der
 * Schalttag und die Zeitzone des Servers.
 */

describe('§ 147 AO — zehn Jahre AB ENDE DES KALENDERJAHRES', () => {
  it('rechnet einen Beleg vom 3. März 2026 auf den 1. Januar 2037', () => {
    /*
     * Der naheliegende Fehler ist „Datum plus zehn Jahre": das gaebe den
     * 3. Maerz 2036 — zehn Monate zu frueh. Zehn Monate sind der Unterschied
     * zwischen einer Loeschung und einer Verletzung der Aufbewahrungspflicht.
     */
    expect(aoFrist('2026-03-03')).toBe('2037-01-01');
  });

  it('behandelt den 31. Dezember wie jeden anderen Tag des Jahres', () => {
    // Ende des Kalenderjahres 2026 ist fuer den 1. Januar und den
    // 31. Dezember DASSELBE — genau das sagt die Vorschrift.
    expect(aoFrist('2026-12-31')).toBe(aoFrist('2026-01-01'));
    expect(aoFrist('2026-12-31')).toBe('2037-01-01');
  });

  it('kennt kein Jahr null und keinen Rundungsfehler über den Jahrtausend', () => {
    expect(aoFrist('1999-07-01')).toBe('2010-01-01');
    expect(aoFrist('2000-01-01')).toBe('2011-01-01');
  });
});

/**
 * **Beide Funktionen geben denselben Begriff zurück: den ERSTEN Tag, an dem
 * gelöscht werden darf.**
 *
 * Diese Datei hat den Befund vorher eingefroren, statt ihn zu fangen:
 * `aoFrist` gab den 1. Januar — den Tag NACH dem Fristende —, `milogFrist`
 * denselben Kalendertag zwei Jahre später, also den LETZTEN Tag der
 * Aufbewahrung. Beide schreiben in `loeschentscheidung.sperre_faellt_am`. Ein
 * Test, der zwei Bedeutungen in einer Spalte grün meldet, ist genau der Test,
 * den niemand mehr liest.
 */
describe('§ 17 Abs. 2 MiLoG — zwei Jahre, kalendarisch', () => {
  it('rechnet vom 15. März 2026 auf den 16. März 2028', () => {
    // Zwei volle Jahre enden am 15. März 2028; gelöscht werden darf am 16.
    expect(milogFrist('2026-03-15')).toBe('2028-03-16');
  });

  it('rundet den 29. Februar AUF den 1. März, nicht ab auf den 28.', () => {
    /*
     * 2024 ist ein Schaltjahr, 2026 nicht. „Zwei Jahre spaeter" hat dann
     * keinen 29. Februar. Die Vorfassung gab den 28.02.2026 und begruendete
     * das mit dem Interesse des Betroffenen — die Grenze setzt hier aber die
     * AUFBEWAHRUNGSPFLICHT: der 28.02. waere ein Tag WENIGER als die
     * „mindestens zwei Jahre" des § 17 Abs. 2 MiLoG.
     */
    expect(milogFrist('2024-02-29')).toBe('2026-03-01');
  });

  it('geht über den Monats- und den Jahreswechsel', () => {
    expect(milogFrist('2026-02-28')).toBe('2028-02-29'); // Zieljahr Schaltjahr
    expect(milogFrist('2024-03-01')).toBe('2026-03-02');
    expect(milogFrist('2024-01-31')).toBe('2026-02-01');
    expect(milogFrist('2024-12-31')).toBe('2027-01-01');
  });

  it('ist nicht 730 Tage — zwei Jahre ueber einen Schalttag sind 731', () => {
    /*
     * 2023-03-01 + 730 Tage waere der 28. Februar 2025: zwischen den beiden
     * Maerztagen liegt der 29. Februar 2024. Kalendarisch sind zwei Jahre der
     * 1. Maerz 2025, und der erste erlaubte Loeschtag ist der 2. — ein Tag
     * Unterschied, und der Tag entscheidet, ob eine Aufzeichnung noch
     * vorzulegen ist.
     */
    const tage = (a: string, b: string): number =>
      Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`))
        / 86_400_000);
    expect(milogFrist('2023-03-01')).toBe('2025-03-02');
    expect(tage('2023-03-01', milogFrist('2023-03-01'))).toBe(732);
  });

  it('beide Fristen meinen dasselbe: den ersten erlaubten Löschtag', () => {
    /*
     * Die Zusage, an der der Befund haengt. `aoFrist` gibt den 1. Januar nach
     * zehn vollen Jahren; `milogFrist` den Tag nach zwei vollen Jahren. Beide
     * Werte landen in DERSELBEN Spalte — steht dort ein Datum, darf ab diesem
     * Tag geloescht werden, und der Tag davor ist noch Aufbewahrung.
     */
    expect(aoFrist('2026-12-31')).toBe('2037-01-01');
    expect(milogFrist('2026-12-31')).toBe('2029-01-01');
  });
});

describe('die offene Aufbewahrungsfrist steht ÜBER den Abschnitten', () => {
  it('nennt Zahl, O-Nummer und die betroffenen Abschnitte', () => {
    /*
     * Der Befund: 12 von 15 Abschnitten trugen „Noch nicht entschieden —
     * O-514" als AUFBEWAHRUNGSFRIST, und die Datei ging mit `vollstaendig =
     * true`, Pruefsumme und dem Wort „Vollstaendig" hinaus. Art. 15 Abs. 1
     * lit. d verlangt die geplante Speicherdauer oder wenigstens die
     * Kriterien; „noch nicht entschieden" ist beides nicht.
     */
    const md = alsMarkdown(auskunft({
      offeneFristen: ['Stammdaten der Person', 'Anstellungen'],
      abschnitte: [{
        schluessel: 'stammdaten', titel: 'Stammdaten der Person',
        zweck: 'Personalverwaltung', quelle: 'person',
        frist: 'Noch nicht entschieden — O-514',
        recht: null, leseweg: 'policy', gesperrt: false, offen: null,
        kopf: ['Vorname'], zeilen: [['Amira']],
      }],
    }));
    const warnung = md.indexOf('Aufbewahrungsfrist');
    const erster = md.indexOf('## Stammdaten der Person');
    expect(warnung).toBeGreaterThan(-1);
    expect(warnung).toBeLessThan(erster);
    expect(md).toContain('O-514');
    expect(md).toContain('2 von 1 Abschnitten');
    expect(md).toContain('Anstellungen');
  });

  it('schweigt, wenn jede Frist beziffert ist', () => {
    const md = alsMarkdown(auskunft({
      abschnitte: [{
        schluessel: 'zeiteintrag', titel: 'Arbeitszeitaufzeichnungen',
        zweck: 'Zeiterfassung', quelle: 'zeiteintrag',
        frist: '§ 17 Abs. 2 MiLoG — zwei Jahre ab Aufzeichnung',
        recht: 'zeit.lesen', leseweg: 'policy', gesperrt: false, offen: null,
        kopf: ['Beginn'], zeilen: [['01.01.2026']],
      }],
    }));
    expect(md).not.toContain('noch nicht entschieden (O-514)');
  });
});

describe('der Kalendertag ist der BERLINER, nicht der des Servers', () => {
  it('rechnet den 1. Januar 00:30 Berliner Zeit ins neue Jahr', () => {
    /*
     * 2026-12-31 23:30 UTC ist in Berlin der 1. Januar 2027, 00:30. Ein
     * `getFullYear()` auf einem Server in UTC gaebe 2026 — und die
     * Zehnjahresfrist faellt ein Jahr zu frueh.
     *
     * Der Vitest-Lauf steht absichtlich auf UTC (`vitest.config.ts`): ein
     * Test, der nur besteht, weil die Maschine in Berlin steht, beweist
     * nichts.
     */
    const zeitpunkt = new Date('2026-12-31T23:30:00Z');
    expect(berlinTag(zeitpunkt)).toBe('2027-01-01');
    expect(aoFrist(berlinTag(zeitpunkt))).toBe('2038-01-01');
  });

  it('rechnet den 1. Januar 00:30 UTC noch ins alte Berliner Jahr NICHT zurück', () => {
    // 2027-01-01 00:30 UTC ist in Berlin 01:30 desselben Tages.
    expect(berlinTag(new Date('2027-01-01T00:30:00Z'))).toBe('2027-01-01');
  });

  it('hält den Kalendertag über die Sommerzeitumstellung', () => {
    // 2026-03-29 ist der Umstellungstag; 00:30 UTC ist in Berlin 01:30 MEZ.
    expect(berlinTag(new Date('2026-03-29T00:30:00Z'))).toBe('2026-03-29');
    // Und 22:30 UTC ist in Berlin schon 00:30 des Folgetags (MESZ, UTC+2).
    expect(berlinTag(new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-30');
  });
});

describe('die Auskunft zeigt Zeitpunkte in Berliner Zeit, Datumsangaben als Datum', () => {
  it('formatiert einen Zeitpunkt nach Europe/Berlin', () => {
    // 2026-01-15 23:30 UTC ist in Berlin der 16. Januar, 00:30.
    expect(alsText(new Date('2026-01-15T23:30:00Z'))).toContain('16.01.2026');
  });

  it('dreht ein reines Datum NICHT durch eine Zeitzone', () => {
    /*
     * `date` kommt als `YYYY-MM-DD` aus dem Treiber. Der naheliegende Weg,
     * `new Date('2026-01-01')` und dann nach Berlin zu formatieren, gaebe den
     * 1. Januar 01:00 — richtig. Aber `new Date('2026-01-01')` in einer Zone
     * WESTLICH von UTC gaebe den 31. Dezember, und ein Eintrittsdatum
     * verschoebe sich um einen Tag. Deshalb wird der Tag als Tag gelesen.
     */
    /*
     * Geprueft wird die EIGENSCHAFT und nicht die ICU-Schreibweise: welches
     * Trennzeichen `de-DE` in `dateStyle: 'medium'` setzt, haengt von der
     * ICU-Fassung des Laufs ab, und ein Test darauf faellt beim naechsten
     * Node — ohne dass etwas kaputt waere. Was NICHT von ICU abhaengt: der
     * Tag darf sich nicht verschieben.
     */
    expect(alsText('2026-01-01')).toContain('2026');
    expect(alsText('2026-01-01')).not.toContain('2025');
    expect(alsText('2026-01-01')).not.toMatch(/31/u);
    expect(alsText('2026-12-31')).toContain('2026');
    expect(alsText('2026-12-31')).not.toContain('2027');
    expect(alsText('2026-12-31')).toMatch(/31/u);
  });

  it('sagt „—" statt „null" und „ja/nein" statt „true/false"', () => {
    expect(alsText(null)).toBe('—');
    expect(alsText(undefined)).toBe('—');
    expect(alsText('')).toBe('—');
    expect(alsText(true)).toBe('ja');
    expect(alsText(false)).toBe('nein');
    expect(alsText(0)).toBe('0');
  });
});

/** Eine Auskunft, wie der Dienst sie liefert — ohne Datenbank. */
function auskunft(teile: Partial<Auskunft> = {}): Auskunft {
  return {
    mandantId: '00000000-0000-0000-0000-000000000001',
    firma: 'CSE Dienstleistungen GmbH',
    anfrageId: '00000000-0000-0000-0000-000000000002',
    art: 'auskunft',
    betroffener: { art: 'person', id: 'x', name: 'Amira Said', pfad: null },
    abschnitte: [],
    fehlendeRechte: [],
    offeneFristen: [],
    vollstaendig: true,
    zeilen: 0,
    sha256: 'a'.repeat(64),
    erstelltAm: '17.09.2026, 12:00 MESZ',
    ...teile,
  };
}

describe('die unvollständige Auskunft sagt es in der DATEI, nicht nur auf dem Schirm', () => {
  it('setzt die Warnung vor den ersten Abschnitt und nennt die fehlenden Rechte', () => {
    /*
     * Der gefaehrliche Fall: die Datei geht an die betroffene Person. Auf dem
     * Bildschirm stand die Warnung, in der Datei nicht — und die Datei ist
     * das, was sie liest.
     */
    const md = alsMarkdown(auskunft({
      vollstaendig: false,
      fehlendeRechte: ['crm.lesen', 'zeit.lesen'],
      abschnitte: [{
        schluessel: 'zeiteintrag', titel: 'Arbeitszeitaufzeichnungen',
        zweck: 'z', quelle: 'zeiteintrag', frist: '2 Jahre',
        recht: 'zeit.lesen', leseweg: 'policy', gesperrt: true, offen: null,
        kopf: ['Beginn'], zeilen: [],
      }],
    }));
    expect(md).toContain('UNVOLLSTÄNDIG');
    expect(md).toContain('crm.lesen, zeit.lesen');
    expect(md.indexOf('UNVOLLSTÄNDIG'))
      .toBeLessThan(md.indexOf('Arbeitszeitaufzeichnungen'));
    expect(md).toContain('Er ist nicht leer — er ist ungelesen.');
  });

  it('unterscheidet „keine Zeile" von „gesperrt"', () => {
    const md = alsMarkdown(auskunft({
      abschnitte: [{
        schluessel: 'nachweis', titel: 'Qualifikationsnachweise',
        zweck: 'z', quelle: 'nachweis', frist: 'offen',
        recht: 'personal.nachweis_lesen', leseweg: 'policy',
        gesperrt: false, offen: null, kopf: ['Nummer'], zeilen: [],
      }],
    }));
    expect(md).toContain('zu dieser Person ist hier nichts gespeichert');
    expect(md).not.toContain('ungelesen');
  });

  it('benennt den offenen Abschnitt statt ihn auszulassen', () => {
    const md = alsMarkdown(auskunft({
      abschnitte: [{
        schluessel: 'agentenlauf', titel: 'Agentenläufe',
        zweck: 'offen', quelle: 'agent_lauf', frist: 'offen',
        recht: null, leseweg: 'offen', gesperrt: false, offen: 'O-113',
        kopf: [], zeilen: [],
      }],
    }));
    expect(md).toContain('(O-113)');
    expect(md).toContain('behauptet, es gäbe sie nicht');
  });

  it('maskiert den senkrechten Strich und den Zeilenumbruch in einer Zelle', () => {
    /*
     * Ein Nachrichtentext mit einem Zeilenumbruch bricht die Markdown-Tabelle
     * an dieser Stelle ab: alles danach wird zu neuen Zeilen, eine davon
     * womoeglich zu einer Kopfzeile. Das Dokument sieht dann aus wie ein
     * Dokument, und eine Zeile fehlt, die niemand vermisst.
     */
    const md = alsMarkdown(auskunft({
      abschnitte: [{
        schluessel: 'antrag', titel: 'Anträge',
        zweck: 'z', quelle: 'antrag', frist: 'offen',
        recht: null, leseweg: 'policy', gesperrt: false, offen: null,
        kopf: ['Nachricht'],
        zeilen: [['Zeile eins\nZeile zwei | mit Strich']],
      }],
    }));
    expect(md).toContain('| Zeile eins Zeile zwei \\| mit Strich |');
    expect(md.split('\n').filter((z) => z.startsWith('| Zeile'))).toHaveLength(1);
  });
});
