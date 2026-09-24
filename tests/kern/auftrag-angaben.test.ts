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
  istKalendertag, pruefeAuftragsangaben,
} from '../../src/server/services/auftrag/angaben.js';

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

  it('die Masken schicken kein ?mandant= mehr und zeigen den Grund', () => {
    const neu = readFileSync('src/app/portal/[mandant]/auftraege/neu/page.tsx', 'utf8');
    const kalk = readFileSync('src/app/portal/[mandant]/angebote/[id]/kalkulation/page.tsx', 'utf8');
    expect(neu).toContain('action="/api/auftrag"');
    expect(neu).toContain('auftrag-neu-fehler');
    expect(kalk).toContain('action="/api/kalkulation"');
    expect(kalk).toContain('kalkulation-fehler');
  });
});
