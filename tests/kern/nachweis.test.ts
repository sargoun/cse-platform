/**
 * PR 31 — die Teile, die ohne Datenbank pruefbar sind.
 *
 * Die fuenf Abnahmekriterien selbst stehen in `tests/isolation/nachweis.test.ts`
 * und laufen gegen echtes Postgres: eine Hartsperre, die nur in TypeScript
 * gilt, ist keine. Hier steht, was die Sperre BEDEUTET — die Stichtagsregel,
 * die Tagesarithmetik und die drei Benachrichtigungsarten —, und das gehoert
 * hierher, weil es auf einem Rechner ohne Postgres fehlschlagen muss.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  decktStichtag, stichtagVon, tageZwischen, type NachweisTatsache,
} from '../../src/server/services/nachweis/gueltigkeit.js';
import { faelligeStufen } from '../../src/server/services/nachweis/ablauf.js';
import {
  WARNSTUFEN, artSchluessel, registriereNachweisArten,
} from '../../src/server/services/nachweis/benachrichtigung.js';
import {
  erzeuge, findeArt, leereArten,
} from '../../src/server/benachrichtigung/registry.js';

const sachkunde = (teil: Partial<NachweisTatsache> = {}): NachweisTatsache => ({
  qualifikationId: 'q-34a',
  gueltigAb: '2026-01-01',
  gueltigBis: '2026-03-03',
  status: 'gueltig',
  widerrufenAm: null,
  ...teil,
});

describe('die Gueltigkeit wird zum SCHICHTDATUM bewertet, nie zu now()', () => {
  it('der Ablauftag selbst ist noch gedeckt', () => {
    expect(decktStichtag(sachkunde(), '2026-03-03')).toBe(true);
  });

  it('der Tag danach nicht mehr', () => {
    expect(decktStichtag(sachkunde(), '2026-03-04')).toBe(false);
  });

  it('vor dem Gueltigkeitsbeginn ebenso wenig', () => {
    // Ein Nachweis, der erst im Maerz ausgestellt wird, deckt die Januarschicht
    // nicht — auch wenn er heute gueltig ist.
    expect(decktStichtag(sachkunde(), '2025-12-31')).toBe(false);
  });

  it('ein unbefristeter Nachweis deckt jeden Tag ab Beginn', () => {
    const n = sachkunde({ gueltigBis: null });
    expect(decktStichtag(n, '2099-01-01')).toBe(true);
    expect(decktStichtag(n, '2025-12-31')).toBe(false);
  });

  it('ein WIDERRUFENER deckt nichts, auch nicht rueckwirkend', () => {
    // Der Widerruf ist die eine Ausnahme von der Stichtagsregel: er sagt, die
    // Grundlage habe nie bestanden oder bestehe nicht mehr — anders als ein
    // Ablauf, der einen Zeitraum beendet.
    expect(decktStichtag(sachkunde({ widerrufenAm: '2026-02-01' }), '2026-01-15'))
      .toBe(false);
  });

  it('das Statusliteral ist Teil des Vertrags — `abgelaufen` deckt nichts', () => {
    expect(decktStichtag(sachkunde({ status: 'abgelaufen' }), '2026-01-15')).toBe(false);
    expect(decktStichtag(sachkunde({ status: 'beantragt' }), '2026-01-15')).toBe(false);
  });
});

describe('der Stichtag ist der BERLINER Kalendertag des Schichtbeginns (K-11)', () => {
  it('eine Nachtschicht am 3. um 22:00 Ortszeit ist der 3., nicht der 4.', () => {
    // 21:00Z ist 22:00 Berliner Zeit (CET). `(beginn)::date` in UTC waere hier
    // noch der 3. — der Fall, an dem eine UTC-Umsetzung NICHT auffliegt.
    expect(stichtagVon(new Date('2026-03-03T21:00:00Z'))).toBe('2026-03-03');
  });

  it('und um 23:30 Ortszeit im Sommer ebenso — hier faellt UTC durch', () => {
    // 21:30Z ist im Sommer 23:30 Berliner Zeit. UTC-gerechnet waere es der 3.,
    // was hier zufaellig stimmt; eine halbe Stunde spaeter nicht mehr:
    expect(stichtagVon(new Date('2026-07-03T21:30:00Z'))).toBe('2026-07-03');
    // 22:30Z = 00:30 Ortszeit am 4. Juli. Der Berliner Tag ist der 4.
    expect(stichtagVon(new Date('2026-07-03T22:30:00Z'))).toBe('2026-07-04');
  });
});

describe('tageZwischen rechnet auf der UTC-Achse — sonst zaehlt die Umstellung falsch', () => {
  it('ueber die Ruecknacht hinweg sind es genau die Kalendertage', () => {
    // 24.-26. Oktober 2026: in der Nacht auf den 25. hat der Ortstag 25
    // Stunden. Ortszeit-Mitternachte voneinander abgezogen ergaebe 2,04 Tage.
    expect(tageZwischen('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('und ueber die Vorstellungsnacht ebenso', () => {
    expect(tageZwischen('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('rueckwaerts ist negativ', () => {
    expect(tageZwischen('2026-03-10', '2026-03-03')).toBe(-7);
  });
});

describe('welche Warnstufe ist faellig (SPEC §14)', () => {
  const stufen = [...WARNSTUFEN];

  it('61 Tage vorher noch keine', () => {
    expect(faelligeStufen('2026-03-03', stufen, '2026-01-01')).toEqual([]);
  });

  it('genau 60 Tage vorher die 60er', () => {
    expect(faelligeStufen('2026-03-03', stufen, '2026-01-02')).toEqual([60]);
  });

  it('bei 30 sind 60 UND 30 faellig — die Quittung entscheidet, was noch feuert', () => {
    // Die Funktion ist bewusst nicht "genau heute erreicht": ein verpasster
    // Lauf darf keine Warnung verschlucken. Dass die 60er nicht zweimal
    // hinausgeht, sichert der eindeutige Schluessel auf `nachweis_warnung`,
    // nicht diese Liste.
    expect(faelligeStufen('2026-03-03', stufen, '2026-02-01')).toEqual([60, 30]);
  });

  it('am Ablauftag selbst alle drei', () => {
    expect(faelligeStufen('2026-03-03', stufen, '2026-03-03')).toEqual([60, 30, 7]);
  });

  it('ein bereits abgelaufener Nachweis wird NICHT gewarnt', () => {
    // „Laeuft in 7 Tagen ab" ueber ein seit gestern ungueltiges Dokument waere
    // eine falsche Aussage. Ab dem Ablauf ist die Hartsperre zustaendig.
    expect(faelligeStufen('2026-03-03', stufen, '2026-03-04')).toEqual([]);
  });

  it('ein eigener Stufensatz wird respektiert, nicht 60/30/7 unterstellt', () => {
    expect(faelligeStufen('2026-03-03', [180], '2026-01-01')).toEqual([180]);
  });
});

describe('die drei Benachrichtigungsarten (NOT-01, NOT-02, NOT-03)', () => {
  beforeEach(leereArten);

  it('60, 30 und 7 sind DREI Arten — sonst laesst sich nur alles abschalten', () => {
    const arten = registriereNachweisArten();
    expect(arten).toHaveLength(3);
    for (const stufe of WARNSTUFEN) {
      expect(findeArt(artSchluessel(stufe)), String(stufe)).toBeDefined();
    }
  });

  it('keine ist sammelbar — am naechsten Morgen gelesen heisst zu spaet', () => {
    for (const a of registriereNachweisArten()) expect(a.sammelbar, a.schluessel).toBe(false);
  });

  it('das Ziel ist die eigene Nachweisseite des Menschen (§11.2, EMP-08)', () => {
    registriereNachweisArten();
    const b = erzeuge(artSchluessel(30), {
      mandantId: 'm1', objektTyp: 'nachweis', objektId: 'n1',
      daten: { bezeichnung: 'Sachkunde §34a', gueltigBis: '2026-03-03', blockiertEinsatz: true },
    });
    expect(b.ziel).toBe('/portal/mein/nachweise');
    expect(b.titel).toContain('30 Tagen');
    expect(b.text).toContain('2026-03-03');
    // Eine Hartsperre wird benannt, nicht abgemildert.
    expect(b.text).toContain('§34a');
  });

  it('eine nicht sperrende Qualifikation bekommt keinen Sperrsatz', () => {
    registriereNachweisArten();
    const b = erzeuge(artSchluessel(7), {
      mandantId: 'm1', objektTyp: 'nachweis', objektId: 'n1',
      daten: { bezeichnung: 'Ersthelfer', gueltigBis: '2026-03-03', blockiertEinsatz: false },
    });
    expect(b.text).not.toContain('§34a');
    expect(b.text).toContain('verlängern');
  });
});
