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
 *  3. der Lauf ist registriert, je Mandant, und steht im Zeitplan.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  ordneWetterZu, WETTER_ZUORDNUNG_TAGE, type KontextLauf,
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
