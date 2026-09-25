/**
 * Die Koordinaten eines Objekts — Dezimalgrad in, `numeric(9,6)` heraus
 * (V-170, OPS-01, BAU-08).
 *
 * `objekt.geo_lat`/`geo_lon` gab es seit 0021, und kein Weg schrieb sie. Die
 * Eingabe kommt jetzt als Text aus einem Formular — mit deutschem Komma oder
 * mit dem Punkt einer Karte — und darf auf dem Weg in die Spalte weder zur
 * Gleitkommazahl werden noch still verrutschen. Diese Datei hält fest, was
 * angenommen, was gerundet und was abgewiesen wird.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  koordinateAlsText, koordinatenAus, leseKoordinate, ObjektFehler,
} from '../../src/server/services/objekt/anlegen.js';
import { cent, formatiereGeld, formatiereGeldIn } from '../../src/server/services/finanz/geld.js';
import { formatiereMengeIn, milliMenge } from '../../src/server/services/finanz/menge.js';
import { tagInSprache } from '../../src/lib/datum/kalendertag.js';
import { fristInWorten } from '../../src/server/services/kern/aufgabe.js';
import { OBJEKTE_TEXTE } from '../../src/lib/i18n/verwaltung/objekte.js';
import { VORGANG_AKTE_TEXTE } from '../../src/lib/i18n/verwaltung/vorgang-akte.js';

function grundVon(f: () => unknown): string {
  try {
    f();
  } catch (fehler) {
    if (fehler instanceof ObjektFehler) return fehler.grund;
    throw fehler;
  }
  throw new Error('kein Fehler geworfen');
}

describe('leseKoordinate', () => {
  it.each([
    ['52,520008', 'breite', '52.520008'],
    ['52.520008', 'breite', '52.520008'],
    ['13,404954', 'laenge', '13.404954'],
    [' 52,52 ', 'breite', '52.520000'],
    ['52', 'breite', '52.000000'],
    ['52°', 'breite', '52.000000'],
    ['-33,868820', 'breite', '-33.868820'],
    ['+151,209296', 'laenge', '151.209296'],
    ['-0,0000001', 'laenge', '0.000000'],
  ] as const)('%s (%s) → %s', (roh, art, erwartet) => {
    expect(leseKoordinate(roh, art)).toBe(erwartet);
  });

  it('rundet auf sechs Stellen halb aufwärts vom Nullpunkt weg — in ganzen Zahlen', () => {
    // Das liefert eine Karte beim Kopieren; die siebte Stelle entscheidet.
    expect(leseKoordinate('52.52000659999999', 'breite')).toBe('52.520007');
    expect(leseKoordinate('52.5200064', 'breite')).toBe('52.520006');
    expect(leseKoordinate('52.5200065', 'breite')).toBe('52.520007');
    expect(leseKoordinate('-13.4049545', 'laenge')).toBe('-13.404955');
    // Das Aufrunden trägt über die Grenze einer Stelle hinweg.
    expect(leseKoordinate('13.9999995', 'laenge')).toBe('14.000000');
  });

  it('nimmt die Ränder an und weist dahinter ab — die CHECKs aus 0021', () => {
    expect(leseKoordinate('90', 'breite')).toBe('90.000000');
    expect(leseKoordinate('-90', 'breite')).toBe('-90.000000');
    expect(leseKoordinate('180', 'laenge')).toBe('180.000000');
    expect(grundVon(() => leseKoordinate('90,000001', 'breite'))).toBe('koordinate_bereich');
    expect(grundVon(() => leseKoordinate('-180,5', 'laenge'))).toBe('koordinate_bereich');
    expect(grundVon(() => leseKoordinate('181', 'laenge'))).toBe('koordinate_bereich');
    // Geprüft wird der GERUNDETE Wert — der, der in der Spalte landet.
    expect(leseKoordinate('89.9999996', 'breite')).toBe('90.000000');
    expect(grundVon(() => leseKoordinate('90.0000005', 'breite'))).toBe('koordinate_bereich');
  });

  it.each([
    'abc', '52,5,1', '1.234,5', '52.', ',5', '5 2', '1234', '52,5 N', '',
  ])('weist „%s" ab, statt zu raten', (roh) => {
    expect(grundVon(() => leseKoordinate(roh, 'breite'))).toBe('koordinate_ungueltig');
  });
});

describe('koordinatenAus — das Paar', () => {
  it('beide leer heisst: keine Koordinaten', () => {
    expect(koordinatenAus(undefined, undefined)).toBeNull();
    expect(koordinatenAus('', '  ')).toBeNull();
  });

  it('ein halbes Paar ist kein Ort', () => {
    expect(grundVon(() => koordinatenAus('52,5', ''))).toBe('koordinaten_paar');
    expect(grundVon(() => koordinatenAus(undefined, '13,4'))).toBe('koordinaten_paar');
  });

  it('gibt beide Werte in der Form von numeric(9,6) zurück', () => {
    expect(koordinatenAus('52,503100', '13.3324')).toEqual(
      { lat: '52.503100', lon: '13.332400' });
  });

  it('prüft Breite und Länge je gegen ihren eigenen Bereich', () => {
    // 120 ist als Länge gültig, als Breite nicht — vertauschte Felder fallen auf.
    expect(grundVon(() => koordinatenAus('120', '52'))).toBe('koordinate_bereich');
    expect(koordinatenAus('52', '120')).toEqual({ lat: '52.000000', lon: '120.000000' });
  });
});

describe('koordinateAlsText', () => {
  it('zeigt die gespeicherte Koordinate mit deutschem Komma, ohne Umweg über Number', () => {
    expect(koordinateAlsText('52.520008')).toBe('52,520008');
    expect(koordinateAlsText('-0.000001')).toBe('-0,000001');
    expect(koordinateAlsText(null)).toBe('');
  });
});

/**
 * V-240: eine Seite, die ihre Sprache kennt, zeigt Zahlen und Tage in ihr —
 * die englische Oberfläche las bis dahin „52,520008", „12.500,00 €" und
 * „29.03.2026". Formulare bleiben deutsch geschrieben; das hier ist ANZEIGE.
 */
describe('(V-240) Anzeige in der Sprache der Seite', () => {
  it('die Koordinate behält im Englischen den Punkt — und liest sich zurück', () => {
    expect(koordinateAlsText('52.520008', 'en')).toBe('52.520008');
    expect(koordinateAlsText('52.520008', 'de')).toBe('52,520008');
    expect(leseKoordinate(koordinateAlsText('52.520008', 'en'), 'breite')).toBe('52.520008');
  });

  it('Geld: deutsch „12.500,00 €", englisch „€12,500.00" — aus ganzen Cent', () => {
    expect(formatiereGeldIn(cent(1_250_000n), 'de')).toBe(formatiereGeld(cent(1_250_000n)));
    expect(formatiereGeldIn(cent(1_250_000n), 'en')).toBe('€12,500.00');
    expect(formatiereGeldIn(cent(-1n), 'en')).toBe('-€0.01');
    expect(formatiereGeldIn(cent(1_250_000n), null)).toBe(formatiereGeld(cent(1_250_000n)));
  });

  it('Mengen: englisch mit Komma als Tausender- und Punkt als Dezimaltrenner', () => {
    expect(formatiereMengeIn(milliMenge(1_234_500n), 'en')).toBe('1,234.50');
    expect(formatiereMengeIn(milliMenge(1_234_500n), 'de')).toBe('1.234,50');
  });

  it('ein Kalendertag: englisch „29 Mar 2026", ohne Zonenversatz; Unlesbares bleibt stehen', () => {
    expect(tagInSprache('2026-03-29', 'en')).toBe('29 Mar 2026');
    expect(tagInSprache('2026-03-29', 'de')).toBe('29.03.2026');
    expect(tagInSprache('2026-02-30', 'en')).toBe('2026-02-30');
    expect(tagInSprache(null, 'en')).toBe('');
  });

  it('eine Frist: englisch, aber Berliner Uhrzeit', () => {
    // 22:30 UTC am 30.06. ist in Berlin schon der 01.07., 00:30.
    expect(fristInWorten({ faelligAm: new Date('2026-06-30T22:30:00Z'), faelligDatum: null }, 'en'))
      .toBe('1 Jul 2026, 00:30');
    expect(fristInWorten({ faelligAm: null, faelligDatum: '2026-03-29' }, 'en')).toBe('29 Mar 2026');
    expect(fristInWorten({ faelligAm: null, faelligDatum: '2026-03-29' })).toBe('29.03.2026');
  });

  it('offene Einsätze beim Archivieren: der Satz in beiden Sprachen, mit der Zahl', () => {
    expect(OBJEKTE_TEXTE.en.einsaetzeOffen(3)).toContain('3 future Einsätze');
    expect(OBJEKTE_TEXTE.en.einsaetzeOffen(1)).toContain('1 future Einsatz ');
    expect(OBJEKTE_TEXTE.de.einsaetzeOffen(3)).toContain('noch 3 Einsätze');
    expect(OBJEKTE_TEXTE.de.einsaetzeOffen(null)).toContain('noch Einsätze');
  });

  it('kein Warnkasten der Objektseiten zeigt Text aus der Adresse (V-153)', () => {
    for (const seite of [
      'src/app/portal/[mandant]/objekte/neu/page.tsx',
      'src/app/portal/[mandant]/objekte/[id]/bearbeiten/page.tsx',
    ]) {
      expect(readFileSync(seite, 'utf8'), seite).not.toContain("suche['meldung']");
    }
    expect(readFileSync('src/app/api/objekt/route.ts', 'utf8')).not.toContain('&meldung=${');
  });

  it('das Recht heisst beim Namen, nicht beim Schlüssel', () => {
    expect(OBJEKTE_TEXTE.de.fehler['kein_schreibrecht']).not.toContain('objekt.schreiben');
    expect(OBJEKTE_TEXTE.en.fehler['kein_schreibrecht']).not.toContain('objekt.schreiben');
  });

  it('ein unbekannter Aufgabenstand heisst so — nicht „offen"', () => {
    expect(VORGANG_AKTE_TEXTE.de.zustandUnbekannt).not.toBe(VORGANG_AKTE_TEXTE.de.zustand.offen);
    expect(VORGANG_AKTE_TEXTE.en.zustandUnbekannt).not.toBe(VORGANG_AKTE_TEXTE.en.zustand.offen);
    expect(readFileSync('src/components/portal/VorgangAkte.tsx', 'utf8'))
      .not.toContain('?? t.zustand.offen');
  });
});
