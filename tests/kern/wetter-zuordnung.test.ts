/**
 * Die automatische Wetterzuordnung — ohne Datenbank (V-183, D-677, BAU-08).
 *
 * Der Weg durch die echte Datenbank als `cse_job` steht in
 * `tests/isolation/wetter-zuordnung.test.ts`. Hier steht die Zusage, die an
 * keiner Datenbank haengt:
 *
 *  1. ohne verbundene Quelle wird nur GELESEN — kein schreibender Lauf, kein
 *     Abruf, kein Befund, der wie ein Versuch aussieht;
 *  2. mit Quelle bekommt jeder offene Tag seinen EIGENEN schreibenden Lauf
 *     (eine Transaktion je Tag), und abgeschlossene Tage keinen;
 *  3. der Lauf ist registriert, je Mandant, und steht im Zeitplan;
 *  4. die Tagesseite verspricht den Lauf nur, wo er ihn halten kann
 *     (`nachtlaufAussicht`): im Fenster der letzten sieben Tage — echt
 *     groesser, nicht groesser-gleich —, mit Koordinaten und Station; sonst
 *     sagt sie, warum nicht.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  nachtlaufAussicht, nachtlaufErreichtTag, ordneWetterZu, WETTER_ZUORDNUNG_TAGE,
  type KontextLauf,
} from '../../src/server/services/bau/wetter.js';
import {
  NichtVerbundenerWetterPort, type WetterMessung, type WetterPort,
} from '../../src/server/versand/dwd.js';
import { leereRegister } from '../../src/server/jobs/registry.js';
import { registriereWetterZuordnung } from '../../src/server/jobs/wetterZuordnung.js';

const MANDANT = '00000000-0000-4000-8000-000000000001';

/** Ein Lauf ohne Datenbank: die Kandidatenliste steht fest, jede andere Abfrage ist leer. */
function falscherLauf(kandidaten: readonly { id: string; abgeschlossen: boolean }[]): {
  lauf: KontextLauf; schreibend: number; lesend: number; anweisungen: string[];
} {
  const zaehler = { schreibend: 0, lesend: 0, anweisungen: [] as string[] };
  const lauf: KontextLauf = async (arbeit, optionen) => {
    if (optionen.schreibend) zaehler.schreibend += 1; else zaehler.lesend += 1;
    const antwort = <R,>(s: string): Promise<readonly R[]> => {
      zaehler.anweisungen.push(s);
      return Promise.resolve(
        (s.includes('wetter_quelle = \'keine\'') ? kandidaten : []) as unknown as readonly R[]);
    };
    const kontext: SchreibKontext = {
      scope: 'mandant', portal: 'intern', benutzerId: '', aktiverMandantId: MANDANT,
      mandantIds: [MANDANT], abfrage: antwort, schreibe: antwort,
    };
    return arbeit(kontext);
  };
  return Object.assign(zaehler, { lauf });
}

class ZaehlendeQuelle implements WetterPort {
  readonly verbunden = true;
  readonly bezeichnung = 'ZaehlendeQuelle (Test)' as const;
  anfragen = 0;
  beobachtungen(): Promise<readonly WetterMessung[]> {
    this.anfragen += 1;
    return Promise.resolve([]);
  }
}

afterEach(() => { leereRegister(); });

describe('(1) ohne verbundene Quelle wird nur gelesen', () => {
  it('kein schreibender Lauf, gezaehlt werden die Tage', async () => {
    const f = falscherLauf([
      { id: 'a', abgeschlossen: false }, { id: 'b', abgeschlossen: false },
      { id: 'c', abgeschlossen: true },
    ]);
    const ergebnis = await ordneWetterZu(f.lauf, new NichtVerbundenerWetterPort());
    expect(ergebnis).toEqual({
      verbunden: false, offen: 2, angeheftet: 0, befunde: {}, abgeschlossenOhneWetter: 1,
    });
    expect(f.schreibend).toBe(0);
    expect(f.lesend).toBe(1);
  });
});

describe('(2) mit Quelle: je offenem Tag ein eigener schreibender Lauf', () => {
  it('zwei offene Tage, zwei Laeufe — der abgeschlossene bekommt keinen', async () => {
    const f = falscherLauf([
      { id: 'a', abgeschlossen: false }, { id: 'b', abgeschlossen: true },
      { id: 'c', abgeschlossen: false },
    ]);
    const quelle = new ZaehlendeQuelle();
    const ergebnis = await ordneWetterZu(f.lauf, quelle);
    expect(f.schreibend).toBe(2);
    expect(ergebnis.verbunden).toBe(true);
    expect(ergebnis.offen).toBe(2);
    expect(ergebnis.abgeschlossenOhneWetter).toBe(1);
    /* Die Tage selbst liefert der falsche Lauf nicht — `hefteWetterAn` sagt „keine_daten". */
    expect(ergebnis.befunde).toEqual({ keine_daten: 2 });
    expect(ergebnis.angeheftet).toBe(0);
  });

  it('das Fenster sind die Tage VOR heute, aus der Datenbankuhr', async () => {
    const f = falscherLauf([]);
    await ordneWetterZu(f.lauf, new ZaehlendeQuelle());
    const liste = f.anweisungen[0] ?? '';
    expect(liste).toContain('b.datum < app.berlin_heute()');
    expect(liste).toContain('b.storniert_am is null');
    expect(WETTER_ZUORDNUNG_TAGE).toBe(7);
  });
});

describe('(3) der Lauf ist registriert', () => {
  it('je Mandant, taeglich nach Mitternacht Berliner Zeit', () => {
    const job = registriereWetterZuordnung({
      begin: () => Promise.reject(new Error('keine Datenbank im Kerntest')),
    } as never);
    expect(job).toMatchObject({
      schluessel: 'wetter_zuordnung', bereich: 'je_mandant', zeitplan: '40 4 * * *',
    });
  });
});

describe('(4) die Tagesseite verspricht den Nachtlauf nur, wo er kommt (V-183)', () => {
  const MIT = { koordinaten: true, station: true } as const;

  it('das Fenster: heute bis heute-6 ja, heute-7 und aelter nein', () => {
    const heute = '2026-03-10';
    expect(nachtlaufErreichtTag('2026-03-10', heute)).toBe(true);
    expect(nachtlaufErreichtTag('2026-03-09', heute)).toBe(true);
    expect(nachtlaufErreichtTag('2026-03-04', heute)).toBe(true);
    /* heute-7: der Lauf von heute 04:40 UTC war sein letzter Versuch. */
    expect(nachtlaufErreichtTag('2026-03-03', heute)).toBe(false);
    expect(nachtlaufErreichtTag('2026-02-17', heute)).toBe(false);
    /* Ein kuenftiger Tag wird erreicht, sobald er vorbei ist. */
    expect(nachtlaufErreichtTag('2026-03-12', heute)).toBe(true);
  });

  it('in Kalendertagen, ueber Monats-, Jahres- und Schaltjahresgrenzen und die Zeitumstellung', () => {
    expect(nachtlaufErreichtTag('2025-12-27', '2026-01-02')).toBe(true);
    expect(nachtlaufErreichtTag('2025-12-26', '2026-01-02')).toBe(false);
    expect(nachtlaufErreichtTag('2028-02-23', '2028-03-01')).toBe(true);
    expect(nachtlaufErreichtTag('2028-02-22', '2028-03-01')).toBe(false);
    /* Die Nacht der Vorstellung (29.03.2026) liegt im Fenster — ein Tag bleibt ein Tag. */
    expect(nachtlaufErreichtTag('2026-03-27', '2026-04-02')).toBe(true);
    expect(nachtlaufErreichtTag('2026-03-26', '2026-04-02')).toBe(false);
    /* Eine unlesbare Angabe verspricht nichts. */
    expect(nachtlaufErreichtTag('kaputt', '2026-04-02')).toBe(false);
  });

  it('das Fenster ist dieselbe Konstante, die der Lauf benutzt', () => {
    expect(nachtlaufErreichtTag('2026-03-04', '2026-03-10', WETTER_ZUORDNUNG_TAGE)).toBe(true);
    expect(nachtlaufErreichtTag('2026-03-04', '2026-03-10', 6)).toBe(false);
  });

  it('ohne Koordinaten oder Station kommt der Lauf nie — die Seite sagt den Grund', () => {
    expect(nachtlaufAussicht('2026-03-09', '2026-03-10', MIT)).toBe('automatisch');
    expect(nachtlaufAussicht('2026-02-17', '2026-03-10', MIT)).toBe('ausserhalb_fenster');
    expect(nachtlaufAussicht('2026-03-09', '2026-03-10', { koordinaten: false, station: true }))
      .toBe('ohne_koordinaten');
    expect(nachtlaufAussicht('2026-03-09', '2026-03-10', { koordinaten: true, station: false }))
      .toBe('keine_station');
    expect(nachtlaufAussicht('2026-03-09', '2026-03-10', null)).toBe('ohne_koordinaten');
  });

  it('die Tagesseite waehlt ihren Satz aus nachtlaufAussicht, mit dem Berliner Heute der Datenbank', () => {
    const seite = readFileSync(
      'src/app/portal/[mandant]/bau/projekte/[id]/bautagebuch/[datum]/page.tsx', 'utf8');
    expect(seite).toContain(
      'nachtlaufAussicht(datum, await berlinHeute(), daten.wetterVoraussetzung)');
    expect(seite).toMatch(/aussicht === 'automatisch' \? \(\s*<p[^>]*data-cse="wetter-automatisch"/u);
    expect(seite).toContain('data-cse="wetter-ausserhalb-fenster"');
    expect(seite).toContain('data-cse="wetter-ohne-voraussetzung"');
    /* Keine zweite Zahl neben der Konstante. */
    expect(seite).toContain('{WETTER_ZUORDNUNG_TAGE} Tage');
  });
});
