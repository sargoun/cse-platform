/**
 * PR 55 — die Verzugszinsen, ohne Datenbank (§288 BGB, FIN-15).
 *
 * Die Tageszählung ist keine Rechenregel, sondern eine kaufmännische Wahl:
 * dieselbe Forderung ergibt unter `act/365`, `act/360` und `act/act`
 * verschiedene Beträge. Deshalb steht sie auf jeder Position — und deshalb
 * steht hier für jede eine Prüfung.
 */
import { describe, expect, it } from 'vitest';
import { naechsteHaelfte } from '../../src/server/jobs/basiszinssatz.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import {
  ZinsFehler, berechneVerzugszins, verzugstage,
} from '../../src/server/services/finanz/mahnung/zins.js';
import {
  AUFSCHLAG_B2B_BP, AUFSCHLAG_B2C_BP, MAHNREGEL_PLATZHALTER,
} from '../../src/server/services/finanz/mahnung/stufen.platzhalter.js';

describe('(1) Die Verzugstage sind eine Differenz von KALENDERTAGEN', () => {
  it('zählt die Tage zwischen zwei Daten', () => {
    expect(verzugstage('2026-01-01', '2026-01-31')).toBe(30);
    expect(verzugstage('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('und über die Sommerzeitumstellung hinweg genauso', () => {
    /*
     * Invariante 2: eine Differenz zweier Kalendertage darf nicht davon
     * abhängen, ob dazwischen die Uhr umgestellt wurde. Der 29. März 2026 ist
     * der Umstellungstag; März hat trotzdem 31 Tage.
     */
    expect(verzugstage('2026-03-01', '2026-04-01')).toBe(31);
    expect(verzugstage('2026-10-01', '2026-11-01')).toBe(31);
  });

  it('ein Ende vor dem Anfang ergibt null Tage, keinen negativen Zins', () => {
    expect(verzugstage('2026-05-01', '2026-04-01')).toBe(0);
  });
});

describe('(2) Die drei Tageszählungen ergeben drei Beträge', () => {
  const gemein = { betragCent: cent(100_000n), zinsBp: 900, von: '2026-01-01' } as const;

  it('act/365 auf 100 Tage: 1.000,00 € zu 9 % → 24,66 €', () => {
    // 100000 · 900 / 10000 · 100/365 = 2465,75… → 2466
    expect(berechneVerzugszins({ ...gemein, bis: '2026-04-11', methode: 'act_365' }))
      .toBe(2466n);
  });

  it('act/360 auf dieselben 100 Tage ergibt MEHR — 25,00 €', () => {
    expect(berechneVerzugszins({ ...gemein, bis: '2026-04-11', methode: 'act_360' }))
      .toBe(2500n);
  });

  it('act/act ist im Gemeinjahr gleich act/365', () => {
    expect(berechneVerzugszins({ ...gemein, bis: '2026-04-11', methode: 'act_act' }))
      .toBe(berechneVerzugszins({ ...gemein, bis: '2026-04-11', methode: 'act_365' }));
  });

  /**
   * **Der Fall, für den einmal gerundet wird und nicht zweimal.**
   *
   * Ein Zeitraum über den Jahreswechsel läuft unter `act/act` durch zwei
   * Nenner: 2027 hat 365 Tage, 2028 ist ein Schaltjahr mit 366. Jeden Teil
   * einzeln zu runden verschöbe den Betrag an jeder Jahresgrenze um bis zu
   * einen Cent — und eine Zinsforderung, die sich nicht nachrechnen lässt,
   * bestreitet der Empfänger.
   */
  it('über den Jahreswechsel zählt act/act jedes Jahr mit seiner eigenen Länge', () => {
    const ueber = berechneVerzugszins({
      betragCent: cent(100_000n), zinsBp: 900,
      von: '2027-12-01', bis: '2028-02-01', methode: 'act_act',
    });
    /*
     * 31 Tage in 2027 (365) + 31 in 2028 (366). Über dem gemeinsamen Nenner
     * 365·366 = 133 590 sind das 31·366 + 31·365 = 22 661 Zähler:
     *   1 000,00 € · 900 bp · 22 661 / (10 000 · 133 590) = 1 526,79 … → 1 527
     * Die 79 Hundertstel sind der Grund, warum EINMAL am Ende gerundet wird:
     * getrennt gerundet ergäbe jedes Jahresstück seinen eigenen Fehler.
     */
    expect(ueber).toBe(1527n);
    // Und act/365 über dieselben 62 Tage ist geringfügig höher.
    expect(berechneVerzugszins({
      betragCent: cent(100_000n), zinsBp: 900,
      von: '2027-12-01', bis: '2028-02-01', methode: 'act_365',
    })).toBe(1529n);
  });

  it('ohne Tage und ohne Satz gibt es keinen Zins', () => {
    expect(berechneVerzugszins({ ...gemein, bis: '2026-01-01', methode: 'act_365' })).toBe(0n);
    expect(berechneVerzugszins({ ...gemein, zinsBp: 0, bis: '2026-04-11', methode: 'act_365' }))
      .toBe(0n);
  });

  it('und eine negative Forderung oder ein negativer Satz werden abgewiesen', () => {
    expect(() => berechneVerzugszins({
      betragCent: cent(-100n), zinsBp: 900, von: '2026-01-01', bis: '2026-02-01',
      methode: 'act_365',
    })).toThrow(ZinsFehler);
    expect(() => berechneVerzugszins({
      ...gemein, zinsBp: -1, bis: '2026-02-01', methode: 'act_365',
    })).toThrow(ZinsFehler);
  });

  it('ein Datum in falscher Form wird benannt, nicht geraten', () => {
    expect(() => verzugstage('01.01.2026', '2026-02-01')).toThrow(ZinsFehler);
  });
});

describe('(3) §288 BGB steht im Gesetz — ob er angewandt wird, nicht', () => {
  it('die beiden Aufschläge sind die des Gesetzes', () => {
    expect(AUFSCHLAG_B2B_BP).toBe(900);
    expect(AUFSCHLAG_B2C_BP).toBe(500);
  });

  it('aber die Mahnregel selbst ist ein Platzhalter und sagt es', () => {
    expect(MAHNREGEL_PLATZHALTER.istPlatzhalter).toBe(true);
    expect(MAHNREGEL_PLATZHALTER.stufen).toBeNull();
    expect(MAHNREGEL_PLATZHALTER.zinsMethode).toBeNull();
    expect(MAHNREGEL_PLATZHALTER.gebuehrCent).toEqual([]);
    expect(MAHNREGEL_PLATZHALTER.herkunft).toContain('O-19');
  });
});

/**
 * **Der Waechter zaehlt die Haelfte, nicht die Tage.**
 *
 * § 247 BGB wechselt zum 1. Januar und zum 1. Juli. Der Lauf faellt am
 * 15. Juni und am 15. Dezember; er muss dann auf die KOMMENDE Haelfte sehen,
 * nicht auf die laufende — sonst meldet er zwei Wochen zu spaet, naemlich
 * dann, wenn schon gemahnt wird.
 */
describe('naechsteHaelfte', () => {
  it('der 15. Juni sieht auf den 1. Juli desselben Jahres', () => {
    expect(naechsteHaelfte('2026-06-15')).toBe('2026-07-01');
  });

  it('der 15. Dezember sieht auf den 1. Januar des FOLGENDEN Jahres', () => {
    expect(naechsteHaelfte('2026-12-15')).toBe('2027-01-01');
  });

  /* Die Ränder: der 30. Juni gehoert noch zur ersten, der 1. Juli zur zweiten. */
  it('der 30. Juni sieht auf den 1. Juli, der 1. Juli auf den 1. Januar danach', () => {
    expect(naechsteHaelfte('2026-06-30')).toBe('2026-07-01');
    expect(naechsteHaelfte('2026-07-01')).toBe('2027-01-01');
  });

  it('der 1. Januar sieht auf den 1. Juli desselben Jahres', () => {
    expect(naechsteHaelfte('2026-01-01')).toBe('2026-07-01');
  });
});
