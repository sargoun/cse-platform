/**
 * Die Angaben eines Auftrags aus dem Formular — und was eine Abweisung ist
 * (V-172, OPS-07, OPS-10, D-599).
 *
 * `POST /api/auftrag` las Wochenstunden mit `Number(roh.replace(',', '.'))`:
 * aus „1.234,5" wurde `NaN` und eine weisse Seite `{"fehler":"keine_zahl"}`.
 * `POST /api/kalkulation` antwortete auf jede `KalkulationFehler` mit JSON.
 * Beide Formulare haben kein JavaScript; ihre Eingabe war danach verloren.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  istKalendertag, leitungWechselt, pruefeAuftragsangaben,
} from '../../src/server/services/auftrag/angaben.js';
import { AUFTRAG_TEXTE } from '../../src/lib/i18n/verwaltung/auftrag.js';
import {
  WERT_AENDERUNG_FRAGE, wertAenderungsweg,
} from '../../src/server/services/auftrag/aendern.js';

describe('(1) pruefeAuftragsangaben — deutsche Zahlen, die Grenzen aus 0025', () => {
  it('liest Tausenderpunkt und Dezimalkomma — „1.234,5" ist 1234,5, nicht NaN', () => {
    expect(pruefeAuftragsangaben({ wochenstunden: '1.234,5' })).toEqual(
      { ok: true, werte: { personalbedarf: null, wochenstunden: '1234.500', wertCent: null } });
    expect(pruefeAuftragsangaben({ wochenstunden: '38,5', personalbedarf: '12' })).toEqual(
      { ok: true, werte: { personalbedarf: 12, wochenstunden: '38.500', wertCent: null } });
  });

  it('leer heisst „nicht angegeben" — nichts wird geschätzt', () => {
    expect(pruefeAuftragsangaben({ personalbedarf: '  ', wochenstunden: null })).toEqual(
      { ok: true, werte: { personalbedarf: null, wochenstunden: null, wertCent: null } });
  });

  it('Unlesbares ist ein FEHLER, kein fehlendes Feld — und nennt seine Felder', () => {
    expect(pruefeAuftragsangaben({ wochenstunden: '40 Std' })).toEqual(
      { ok: false, grund: 'keine_zahl', felder: ['wochenstundenSoll'] });
    expect(pruefeAuftragsangaben({ personalbedarf: 'zwei', wochenstunden: 'abc' })).toEqual(
      { ok: false, grund: 'keine_zahl', felder: ['personalbedarfAnzahl', 'wochenstundenSoll'] });
  });

  it('erst „ist es eine Zahl", dann „liegt sie im Bereich"', () => {
    expect(pruefeAuftragsangaben({ personalbedarf: '6000', wochenstunden: 'x' })).toMatchObject(
      { ok: false, grund: 'keine_zahl' });
  });

  it.each([
    [{ personalbedarf: '5001' }, 'personalbedarfAnzahl'],
    [{ personalbedarf: '2,5' }, 'personalbedarfAnzahl'],
    [{ personalbedarf: '-1' }, 'personalbedarfAnzahl'],
    [{ wochenstunden: '10.000,001' }, 'wochenstundenSoll'],
    [{ wochenstunden: '12.000' }, 'wochenstundenSoll'],
    [{ wochenstunden: '-0,5' }, 'wochenstundenSoll'],
  ])('%o liegt ausserhalb', (roh, feld) => {
    expect(pruefeAuftragsangaben(roh)).toEqual(
      { ok: false, grund: 'ausserhalb_bereich', felder: [feld] });
  });

  it.each([
    [{ wochenstunden: '12.50' }, ['wochenstundenSoll']],
    [{ wochenstunden: '38.5' }, ['wochenstundenSoll']],
    [{ personalbedarf: '2.5' }, ['personalbedarfAnzahl']],
    [{ personalbedarf: '1.25', wochenstunden: '1.5' }, ['personalbedarfAnzahl', 'wochenstundenSoll']],
  ] as const)('V-240: %o hat zwei Lesarten — abgewiesen, nicht gedeutet', (roh, felder) => {
    expect(pruefeAuftragsangaben(roh)).toEqual({ ok: false, grund: 'mehrdeutig', felder });
  });

  it('V-240: eindeutig bleibt eindeutig — Tausendergruppe und Dezimalkomma', () => {
    expect(pruefeAuftragsangaben({ wochenstunden: '1.250', personalbedarf: '1.000' })).toEqual(
      { ok: true, werte: { personalbedarf: 1000, wochenstunden: '1250.000', wertCent: null } });
    expect(pruefeAuftragsangaben({ wochenstunden: '12,5' })).toMatchObject({ ok: true });
  });

  it('V-240: unlesbar geht vor mehrdeutig — erst „ist das eine Zahl"', () => {
    expect(pruefeAuftragsangaben({ wochenstunden: '12.50', personalbedarf: 'zwei' }))
      .toEqual({ ok: false, grund: 'keine_zahl', felder: ['personalbedarfAnzahl'] });
  });

  it('beide Sprachen haben einen Satz für „mehrdeutig"', () => {
    expect(AUFTRAG_TEXTE.de.fehler['mehrdeutig']).toContain('12.50');
    expect(AUFTRAG_TEXTE.en.fehler['mehrdeutig']).toContain('12.50');
  });

  it('die Ränder gehören dazu', () => {
    expect(pruefeAuftragsangaben({ personalbedarf: '5.000', wochenstunden: '10.000' }))
      .toEqual({ ok: true, werte: { personalbedarf: 5000, wochenstunden: '10000.000', wertCent: null } });
    expect(pruefeAuftragsangaben({ personalbedarf: '0', wochenstunden: '0' }))
      .toEqual({ ok: true, werte: { personalbedarf: 0, wochenstunden: '0.000', wertCent: null } });
  });
});

describe('(1b) der Auftragswert — Geld in ganzen Cent, nie über Number (V-173, Invariante 1)', () => {
  it.each([
    ['12.500,00', 1_250_000n],
    ['12500', 1_250_000n],
    ['0,01', 1n],
    ['1.234', 123_400n],
    ['0', 0n],
    [' 99,90 € ', 9_990n],
  ])('„%s" → %s Cent', (roh, cent) => {
    const e = pruefeAuftragsangaben({ wert: roh });
    expect(e.ok).toBe(true);
    if (e.ok) expect(e.werte.wertCent).toBe(cent);
  });

  it.each(['12.50', '1,234', '12,345', '-5,00', 'zwölf', '12 500'])(
    '„%s" ist kein deutscher, nicht negativer Eurobetrag', (roh) => {
      expect(pruefeAuftragsangaben({ wert: roh })).toEqual(
        { ok: false, grund: 'wert_ungueltig', felder: ['auftragswertNetto'] });
    });

  it('leer bleibt null — kein geschätzter Wert', () => {
    const e = pruefeAuftragsangaben({ wert: '' });
    expect(e.ok && e.werte.wertCent).toBeNull();
  });

  it('eine unlesbare Stundenzahl geht vor dem Wert — erst die Zahlen, dann das Geld', () => {
    expect(pruefeAuftragsangaben({ wochenstunden: 'x', wert: 'y' })).toMatchObject(
      { ok: false, grund: 'keine_zahl' });
  });
});

describe('(1c) leitungWechselt — geprüft wird die Mitgliedschaft nur beim Wechsel (V-177)', () => {
  const a = '0b8a3a4e-2f0c-4a57-9d0e-6d1f1c2b3a4e';
  const b = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  it.each([
    [null, a, true],
    [undefined, a, true],
    ['', a, true],
    [a, a, false],
    [a, ` ${a.toUpperCase()} `, false],
    [a, b, true],
  ] as const)('bisher %s, gewählt %s → %s', (bisher, gewaehlt, erwartet) => {
    expect(leitungWechselt(bisher, gewaehlt)).toBe(erwartet);
  });

  it('die Pflege reicht die bisherige Leitung mit — sonst prüfte sie jede Änderung', () => {
    const quelle = readFileSync('src/server/services/auftrag/aendern.ts', 'utf8');
    expect(quelle).toContain('bisherigeLeitung: alt.verantwortlich_benutzer_id');
  });

  it('die drei Auswahllisten fragen dieselbe Mitgliedschaft wie der Dienst', () => {
    for (const datei of [
      'src/app/portal/[mandant]/auftraege/neu/page.tsx',
      'src/app/portal/[mandant]/auftraege/[id]/bearbeiten/page.tsx',
      'src/app/portal/[mandant]/angebote/[id]/annahme/page.tsx',
    ]) {
      const quelle = readFileSync(datei, 'utf8');
      expect(quelle).toContain('waehlbareLeitungen(kontext)');
      expect(quelle).not.toContain('join benutzer_mandant');
    }
  });
});

describe('(1d) der Wert aus einem Angebot — welcher Weg ihn ändert (V-239, O-921)', () => {
  it('nur der Bau kennt einen Nachtrag; sonst ist der Weg offen und die Frage genannt', () => {
    expect(wertAenderungsweg(['bau'])).toBe('nachtrag');
    expect(wertAenderungsweg(['reinigung'])).toBe('offen');
    expect(wertAenderungsweg(['security'])).toBe('offen');
    expect(wertAenderungsweg([])).toBe('offen');
    expect(WERT_AENDERUNG_FRAGE).toBe('O-921');
  });

  it('kein Text behauptet mehr, jede Änderung des Vertragswerts sei ein Nachtrag', () => {
    for (const sprache of ['de', 'en'] as const) {
      const t = AUFTRAG_TEXTE[sprache];
      expect(t.fehler['wert_aus_angebot']).not.toMatch(/Nachtrag/u);
      expect(t.wertAusAngebot('AN-1')).not.toMatch(/Nachtrag/u);
      expect(t.wertWegOffen('O-921')).toContain('O-921');
      expect(t.wertWegNachtrag).toContain('§ 2 VOB/B');
    }
  });
});

describe('(2) istKalendertag', () => {
  it.each([['2026-02-28', true], ['2028-02-29', true], ['2026-02-30', false],
    ['9999-99-99', false], ['26-1-1', false], ['', false]])('%s → %s', (tag, erwartet) => {
    expect(istKalendertag(tag)).toBe(erwartet);
  });
});

describe('(3) die Formulare bekommen ihre Seite zurück, nicht JSON (V-172)', () => {
  const auftrag = readFileSync('src/app/api/auftrag/route.ts', 'utf8');
  const kalkulation = readFileSync('src/app/api/kalkulation/route.ts', 'utf8');

  it('JSON nur noch ohne Seite: fremder Ursprung, keine Sitzung, zweiter Faktor, unbekannt', () => {
    for (const quelle of [auftrag, kalkulation]) {
      const codes = [...quelle.matchAll(/NextResponse\.json\(\{ fehler: '([a-z_]+)'/gu)]
        .map((m) => m[1]);
      expect(new Set(codes)).toEqual(
        new Set(['fremder_ursprung', 'keine_sitzung', 'zweiter_faktor', 'unbekannt']));
      expect(quelle).not.toMatch(/fehler: fehler\.grund/u);
    }
  });

  it('der Bereich der Umleitung kommt aus der SITZUNG, nicht aus ?mandant=', () => {
    for (const quelle of [auftrag, kalkulation]) {
      expect(quelle).not.toContain("searchParams.get('mandant')");
      expect(quelle).toContain('select m.slug from mandant m where m.id = app.aktiver_mandant()');
    }
  });

  it('die Zahlen liest der geprüfte Dienst — kein Number() auf einer Formularzahl', () => {
    expect(auftrag).toContain('pruefeAuftragsangaben(');
    expect(auftrag).not.toMatch(/Number\(roh/u);
  });

  it('V-240: Pflege und Annahme bekommen nach einer Abweisung ihre EINGABEN zurück', () => {
    const geruest = readFileSync('src/app/api/uebergang.ts', 'utf8');
    expect(geruest).toContain('maskeMitEingaben(zurueck, grund, werte)');
    for (const [route, felder] of [
      ['src/app/api/auftrag/aendern/route.ts',
        ['bezeichnung', 'verantwortlichBenutzerId', 'auftragswertNetto', 'wochenstundenSoll']],
      ['src/app/api/angebot/entscheidung/route.ts',
        ['ausgang', 'personalbedarfAnzahl', 'wochenstundenSoll', 'ausstattungHinweis']],
    ] as const) {
      const quelle = readFileSync(route, 'utf8');
      expect(quelle, route).toContain('maskeFelder: [');
      for (const feld of felder) expect(quelle, `${route}: ${feld}`).toContain(`'${feld}'`);
    }
    const pflege = readFileSync('src/app/portal/[mandant]/auftraege/[id]/bearbeiten/page.tsx', 'utf8');
    expect(pflege).toContain("eingabe('wochenstundenSoll', stundenText)");
    const annahme = readFileSync('src/app/portal/[mandant]/angebote/[id]/annahme/page.tsx', 'utf8');
    expect(annahme).toContain("annahmeWert('wochenstundenSoll')");
    expect(annahme).toContain("annahmeWert('personalbedarfAnzahl')");
  });

  it('die Masken schicken kein ?mandant= mehr und zeigen den Grund', () => {
    const neu = readFileSync('src/app/portal/[mandant]/auftraege/neu/page.tsx', 'utf8');
    const kalk = readFileSync('src/app/portal/[mandant]/angebote/[id]/kalkulation/page.tsx', 'utf8');
    expect(neu).toContain('action="/api/auftrag"');
    expect(neu).toContain('auftrag-neu-fehler');
    expect(kalk).toContain('action="/api/kalkulation"');
    expect(kalk).toContain('kalkulation-fehler');
  });
});
