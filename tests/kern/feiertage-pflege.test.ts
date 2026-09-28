/**
 * Der Feiertagskalender bekommt einen Schreiber (V-178, D-672, CLN-03).
 *
 * Geprueft wird hier, was ohne Datenbank pruefbar ist: welche Jahre ein Lauf
 * pflegt, wie Rechnung und Bestand verglichen werden (eingetragen wird nur,
 * was fehlt; eine Abweichung wird gemeldet, nicht ueberschrieben), welche
 * Feiertagsregel eine Serie tatsaechlich hat, und dass der Lauf registriert
 * ist — als Plattformlauf vor dem Generator. Der Weg durch die echte
 * Datenbank steht in `tests/isolation/feiertage-pflege.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PFLEGE_FOLGEJAHRE, pflegeJahre, vergleicheFeiertage,
} from '../../src/server/services/dienstplan/feiertage.js';
import { wirksameFeiertagsregel } from '../../src/server/services/dienstplan/generator.js';
import { feiertageBerlin } from '../../src/lib/datum/feiertage-berlin.js';
import { alleJobs, vergissRegistrierung } from '../../src/server/jobs/bootstrap.js';
import { leereRegister } from '../../src/server/jobs/registry.js';
import { FEIERTAG_TEXTE } from '../../src/lib/i18n/verwaltung/feiertage.js';

describe('(1) welche Jahre ein Lauf pflegt', () => {
  it('das laufende und die zwei folgenden — nicht mehr', () => {
    expect(PFLEGE_FOLGEJAHRE).toBe(2);
    expect(pflegeJahre(2026)).toEqual([2026, 2027, 2028]);
    /* Am 31. Dezember reicht ein Horizont von 400 Tagen ins uebernaechste Jahr. */
    expect(pflegeJahre(2026)).toContain(2028);
  });

  it('eine Kommazahl ist kein Jahr', () => {
    expect(() => pflegeJahre(2026.5)).toThrow(/Ganzzahl/u);
  });
});

describe('(2) Rechnung gegen Bestand', () => {
  const berechnet = feiertageBerlin(2033);

  it('leerer Bestand: alles fehlt, nichts weicht ab', () => {
    const v = vergleicheFeiertage(berechnet, []);
    expect(v.fehlend).toHaveLength(berechnet.length);
    expect(v.gleich).toBe(0);
    expect(v.abweichend).toEqual([]);
    expect(v.ungerechnet).toEqual([]);
    /* Der 3. Oktober 2033 ist ein Montag — genau der Tag des Befunds. */
    expect(v.fehlend.map((f) => f.datum)).toContain('2033-10-03');
    /* Heiligabend reist mit, aber nicht gesetzlich (§5.1, O-167). */
    expect(v.fehlend.find((f) => f.datum === '2033-12-24')?.gesetzlich).toBe(false);
  });

  it('voller Bestand: nichts fehlt — zweimal laufen traegt nichts doppelt ein', () => {
    const v = vergleicheFeiertage(berechnet, berechnet.map((b) => ({
      datum: b.datum, bezeichnung: b.bezeichnung, gesetzlich: b.gesetzlich,
    })));
    expect(v.fehlend).toEqual([]);
    expect(v.gleich).toBe(berechnet.length);
  });

  it('ein anders gefuehrter Tag wird GEMELDET und bleibt, wie er ist', () => {
    const gespeichert = berechnet.map((b) => ({
      datum: b.datum,
      bezeichnung: b.datum === '2033-03-08' ? 'Frauentag (alte Fassung)' : b.bezeichnung,
      gesetzlich: b.gesetzlich,
    }));
    const v = vergleicheFeiertage(berechnet, gespeichert);
    expect(v.fehlend).toEqual([]);
    expect(v.abweichend).toEqual([{
      datum: '2033-03-08',
      gespeichert: { bezeichnung: 'Frauentag (alte Fassung)', gesetzlich: true },
      berechnet: { bezeichnung: 'Internationaler Frauentag', gesetzlich: true },
    }]);
  });

  it('ein Tag, den die Rechnung nicht kennt, wird gemeldet und nicht entfernt', () => {
    const fremd = { datum: '2033-05-08', bezeichnung: 'Eingetragen von Hand', gesetzlich: true };
    const v = vergleicheFeiertage(berechnet, [fremd]);
    expect(v.ungerechnet).toEqual([fremd]);
    expect(v.fehlend).toHaveLength(berechnet.length);
  });
});

describe('(3) die Feiertagsregel, die eine Serie tatsaechlich hat', () => {
  it('ein Turnus traegt seine eigene Regel — sie gewinnt ueber die Serie', () => {
    expect(wirksameFeiertagsregel({ feiertagsregel: 'ausfall', feiertageUeberspringen: false }))
      .toBe('ausfall');
    expect(wirksameFeiertagsregel({ feiertagsregel: 'unveraendert', feiertageUeberspringen: true }))
      .toBe('unveraendert');
  });

  it('ein Posten hat keine Regel — dann gilt die Entscheidung der Serie', () => {
    const ohne = null as unknown as 'ausfall';
    expect(wirksameFeiertagsregel({ feiertagsregel: ohne, feiertageUeberspringen: true }))
      .toBe('ausfall');
    /* Die Vorgabe fuer Posten (0028): eine geplante Schicht nie still entfernen. */
    expect(wirksameFeiertagsregel({ feiertagsregel: ohne, feiertageUeberspringen: false }))
      .toBe('unveraendert');
  });
});

describe('(4) der Lauf ist verdrahtet — als Plattformlauf vor dem Generator', () => {
  const db = {
    unsafe: (): Promise<readonly unknown[]> => Promise.resolve([]),
    begin: <T,>(): Promise<T> => {
      throw new Error('Registrieren oeffnet keine Transaktion.');
    },
  };
  beforeEach(() => { leereRegister(); vergissRegistrierung(); });
  afterEach(() => { leereRegister(); vergissRegistrierung(); });

  it('feiertage_pflegen steht im Register, plattformweit, taeglich', () => {
    const jobs = alleJobs(db);
    const lauf = jobs.find((j) => j.schluessel === 'feiertage_pflegen');
    expect(lauf).toBeDefined();
    /* `feiertag` traegt keine mandant_id — ein Lauf je Mandant schriebe viermal dasselbe. */
    expect(lauf?.bereich).toBe('plattform');
    expect(lauf?.zeitplan).toBe('50 1 * * *');
  });

  it('und er laeuft VOR dem Generator derselben Nacht', () => {
    const jobs = alleJobs(db);
    const minuten = (cron: string): number => {
      const [minute, stunde] = cron.split(/\s+/u).map(Number);
      return (stunde ?? 0) * 60 + (minute ?? 0);
    };
    const pflege = jobs.find((j) => j.schluessel === 'feiertage_pflegen')!;
    const generator = jobs.find((j) => j.schluessel === 'einsaetze_generieren')!;
    expect(minuten(pflege.zeitplan)).toBeLessThan(minuten(generator.zeitplan));
  });
});

describe('(5) der Hinweis auf einen fehlenden Kalender spricht beide Sprachen', () => {
  it('nennt Land und Jahre, deutsch und englisch', () => {
    expect(FEIERTAG_TEXTE.de.kalenderFehlt('BE', [2029, 2030])).toContain('BE 2029 und 2030');
    expect(FEIERTAG_TEXTE.en.kalenderFehlt('BE', [2029])).toContain('BE 2029');
    expect(FEIERTAG_TEXTE.en.kalenderFehltTitel).not.toBe(FEIERTAG_TEXTE.de.kalenderFehltTitel);
  });
});

describe('(6) und beide Turnusseiten zeigen ihn — aus dem, was die Vorschau liefert', () => {
  /*
   * Die Daten dahinter (`feiertageFehlen`, `ohneKalender`) prueft die
   * Isolationssuite (5) an echten Zeilen. Hier steht, dass die Seiten sie
   * auch zeigen: ein Entfernen des Hinweises bliebe sonst so still wie der
   * fehlende Kalender selbst.
   */
  it.each([
    ['Turnusblatt', 'src/app/portal/[mandant]/reinigung/turnus/[id]/page.tsx',
      '(daten.vorschau?.feiertageFehlen.length ?? 0) > 0'],
    ['neuer Turnus', 'src/app/portal/[mandant]/reinigung/turnus/neu/page.tsx',
      'daten.ohneKalender.length > 0'],
  ])('%s', (_name, datei, bedingung) => {
    const seite = readFileSync(datei, 'utf8');
    const stelle = seite.indexOf(bedingung);
    expect(stelle).toBeGreaterThan(-1);
    expect(seite.slice(stelle, stelle + 400)).toContain('cse="turnus-feiertagskalender-fehlt"');
    expect(seite).toContain('tF.kalenderFehlt(');
  });
});
