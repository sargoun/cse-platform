/**
 * PR 48 — was sich ohne Datenbank entscheiden lässt (FIN-01, O-04).
 *
 * Die Beträge prüft `tests/isolation/abrechnungsart.test.ts` gegen eine echte
 * Datenbank; hier stehen die drei Dinge, die reine Funktionen sind und deren
 * Fehler sich sonst hinter einer Abfrage verstecken:
 *
 *  1. **Das Register ist offen.** Eine sechste Abrechnungsart einzutragen
 *     verlangt keine Änderung an einer bestehenden Datei (Abnahme 5). Das ist
 *     eine Aussage über Typen und eine Karte, nicht über Postgres.
 *  2. **Der Kalender ist der gregorianische**, nicht der der Systemzeitzone.
 *     Ein Quartal sind drei Monatsabschnitte, und der Februar 2028 hat
 *     29 Tage — daran hängt jede anteilige Monatspauschale.
 *  3. **Ein fehlender Parameter blockiert.** Der Befund entsteht, bevor
 *     irgendetwas gerechnet wird, und er nennt die offene Frage.
 */
import { describe, expect, it } from 'vitest';
import {
  ABRECHNUNGSARTEN,
  AbrechnungFehler,
  alleAbrechnungsarten,
  entferne,
  hole,
  istRegistriert,
  registriere,
  type Abrechnungsart,
} from '../../src/server/services/finanz/abrechnungsart/index.js';
import {
  alsTag, belegBenannt, leistungszeitraum, monateDerPeriode, pruefeNachweisZeitraum,
  pruefeParameter, tageImMonat, ueberschneidet, zeitraumAusNachweisen, zerlegeTag,
  type BisherigerAnspruch, type SignierterNachweis, type VertragAbrechnung,
} from '../../src/server/services/finanz/abrechnungsart/typen.js';
import { MONATSPAUSCHALE } from '../../src/server/services/finanz/abrechnungsart/monatspauschale.js';
import {
  FESTPREIS_LOS, anteiligerRest,
} from '../../src/server/services/finanz/abrechnungsart/festpreis-los.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import type { Abfrage } from '../../src/server/services/finanz/rechnung.js';

function konfiguration(
  art: string, parameter: Record<string, unknown> = {},
  modus = 'kalendermonat',
): VertragAbrechnung {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    mandantId: '00000000-0000-0000-0000-000000000002',
    auftragId: '00000000-0000-0000-0000-000000000003',
    auftragLeistungId: null,
    abrechnungsart: art,
    parameter,
    pauschaleNettoCent: null,
    stundensatzCent: null,
    festpreisNettoCent: null,
    mindestabnahmeStunden: null,
    abrechnungsintervall: 'monatlich',
    leistungszeitraumModus: modus,
    zahlungszielTage: null,
    reverseCharge13b: false,
    unterliegtBauabzugsteuer: false,
    gueltigAb: '2026-01-01',
    gueltigBis: null,
  };
}

describe('das Register der fünf — und der sechsten (Abnahme 5)', () => {
  it('kennt genau die fünf Namen aus FIN-01', () => {
    expect(alleAbrechnungsarten().map((a) => a.schluessel).sort())
      .toEqual([...ABRECHNUNGSARTEN].sort());
  });

  it('jede der fünf ist als provisorisch markiert (O-04)', () => {
    // Eine Art ohne diese Marke behauptet, jemand hätte ihre Regeln bestätigt.
    expect(alleAbrechnungsarten().filter((a) => !a.istProvisorisch)).toEqual([]);
  });

  it('jede der fünf nennt mindestens eine offene Frage, und jede trägt O-04', () => {
    for (const art of alleAbrechnungsarten()) {
      expect(art.offeneParameter.length, art.schluessel).toBeGreaterThan(0);
      for (const p of art.offeneParameter) {
        expect(p.offeneFrage, `${art.schluessel}.${p.schluessel}`).toBe('O-04');
        // Die Frage steht im Klartext, damit die Oberfläche sie stellen kann.
        expect(p.frage.length, `${art.schluessel}.${p.schluessel}`).toBeGreaterThan(20);
      }
    }
  });

  it('eine sechste trägt sich ein, ohne dass eine der fünf sich ändert', () => {
    const doppel: Abrechnungsart = {
      schluessel: 'kern_pruef_art',
      bezeichnung: 'Prüf-Art',
      istProvisorisch: true,
      offeneParameter: [],
      pruefe: () => Promise.resolve([]),
      positionen: () => Promise.resolve([]),
    };
    expect(istRegistriert('kern_pruef_art')).toBe(false);
    registriere(doppel);
    try {
      expect(hole('kern_pruef_art')).toBe(doppel);
      expect(alleAbrechnungsarten()).toHaveLength(ABRECHNUNGSARTEN.length + 1);
    } finally {
      entferne('kern_pruef_art');
    }
    expect(istRegistriert('kern_pruef_art')).toBe(false);
  });

  it('ein unbekannter Schlüssel wirft — es gibt keine Standardart', () => {
    // Ein Rückfall auf „dann eben stundenbasiert" wäre eine Rechnung nach
    // einer Regel, die im Vertrag nicht steht, und sie ist eine Sekunde
    // später festgeschrieben und unveränderlich.
    try {
      hole('gibt_es_nicht');
      expect.unreachable('hole() hätte werfen müssen');
    } catch (e) {
      expect(e).toBeInstanceOf(AbrechnungFehler);
      expect((e as AbrechnungFehler).grund).toBe('unbekannte_abrechnungsart');
    }
  });
});

describe('der Kalender ist der gregorianische, nicht die Systemzeitzone', () => {
  it('kennt die Schaltjahrregel bis zur Hundert- und Vierhundertgrenze', () => {
    expect(tageImMonat(2026, 2)).toBe(28);
    expect(tageImMonat(2028, 2)).toBe(29);
    expect(tageImMonat(1900, 2)).toBe(28);
    expect(tageImMonat(2000, 2)).toBe(29);
  });

  it('ein Quartal zerfällt in drei Monatsabschnitte, jeder voll', () => {
    expect(monateDerPeriode({ von: '2026-07-01', bis: '2026-09-30' })).toEqual([
      { von: '2026-07-01', bis: '2026-07-31' },
      { von: '2026-08-01', bis: '2026-08-31' },
      { von: '2026-09-01', bis: '2026-09-30' },
    ]);
  });

  it('ein angebrochener erster und letzter Monat bleiben angebrochen', () => {
    expect(monateDerPeriode({ von: '2026-01-20', bis: '2026-03-10' })).toEqual([
      { von: '2026-01-20', bis: '2026-01-31' },
      { von: '2026-02-01', bis: '2026-02-28' },
      { von: '2026-03-01', bis: '2026-03-10' },
    ]);
  });

  it('ein Zeitraum über den Jahreswechsel zählt richtig weiter', () => {
    expect(monateDerPeriode({ von: '2026-12-15', bis: '2027-01-14' })).toEqual([
      { von: '2026-12-15', bis: '2026-12-31' },
      { von: '2027-01-01', bis: '2027-01-14' },
    ]);
  });

  it('ein Zeitraum, der vor seinem Beginn endet, wird abgewiesen', () => {
    expect(() => monateDerPeriode({ von: '2026-08-31', bis: '2026-08-01' }))
      .toThrow(AbrechnungFehler);
  });

  it('ein Tag in falscher Form wird abgewiesen statt geraten', () => {
    // `31.08.2026` ist deutsche Anzeige, kein Kalendertag der Schnittstelle.
    expect(() => zerlegeTag('31.08.2026')).toThrow(AbrechnungFehler);
    expect(alsTag(2026, 8, 1)).toBe('2026-08-01');
  });
});

describe('ein fehlender Parameter blockiert, bevor gerechnet wird', () => {
  it('meldet den Schlüssel, die Frage und die offene Nummer', () => {
    const art = hole('stundenbasiert');
    const befunde = pruefeParameter(art, konfiguration('stundenbasiert'));
    const treffer = befunde.find((b) => b.feld === 'parameter.minuten_rundung');
    expect(treffer?.art).toBe('fehler');
    expect(treffer?.offeneFrage).toBe('O-04');
    expect(treffer?.textDe).toMatch(/Unbestätigter Wert/u);
  });

  it('ein Wert ausserhalb der zulässigen Liste ist ebenfalls ein Fehler', () => {
    const art = hole('stundenbasiert');
    const befunde = pruefeParameter(art, konfiguration('stundenbasiert', { minuten_rundung: 7 }));
    expect(befunde.some((b) => b.feld === 'parameter.minuten_rundung')).toBe(true);
  });

  it('mit gesetztem Parameter bleibt kein Befund übrig', () => {
    const art = hole('stundenbasiert');
    expect(pruefeParameter(art, konfiguration('stundenbasiert', { minuten_rundung: 15 })))
      .toEqual([]);
  });

  it('`nach_leistungsnachweis` sperrt nicht mehr pauschal — die Prüfung je Abschnitt übernimmt (V-337)', () => {
    /**
     * Bis V-337 blockierte der Modus hier für sich allein, weil die
     * Herleitung aus den Nachweisen fehlte. Jetzt sperrt
     * `pruefeNachweisZeitraum` nur noch den Abschnitt ohne gegengezeichneten
     * Nachweis (unten); ein pauschaler Befund hier sperrte auch den, der einen
     * hat.
     */
    const art = hole('monatspauschale');
    const befunde = pruefeParameter(
      art,
      konfiguration('monatspauschale', { teilmonat: 'keine' }, 'nach_leistungsnachweis'),
    );
    expect(befunde.find((b) => b.feld === 'leistungszeitraum_modus')).toBeUndefined();
  });
});

/*
 * V-337 (D-838): der Leistungszeitraum aus den gegengezeichneten Nachweisen
 * des Abschnitts — frühester Beginn bis spätestes Ende, beschnitten auf den
 * Abschnitt (O-54). Gegen Postgres: `tests/isolation/leistungszeitraum-nachweis.test.ts`.
 */
describe('der Leistungszeitraum aus den Leistungsnachweisen (V-337, O-54)', () => {
  const nachweis = (von: string, bis: string, nummer = 'LN-1'): SignierterNachweis =>
    ({ id: `id-${nummer}`, nummer, von, bis });
  /** Zwei Nachweise über die Monatsgrenze. */
  const ZWEI = [nachweis('2026-08-20', '2026-08-31', 'LN-1'), nachweis('2026-09-01', '2026-09-10', 'LN-2')];
  const AUGUST = { von: '2026-08-01', bis: '2026-08-31' };
  const SEPTEMBER = { von: '2026-09-01', bis: '2026-09-30' };

  it('zwei Nachweise über eine Monatsgrenze: frühester Beginn bis spätestes Ende', () => {
    expect(zeitraumAusNachweisen(ZWEI, { von: '2026-08-15', bis: '2026-09-15' }))
      .toEqual({ von: '2026-08-20', bis: '2026-09-10' });
    // Die Reihenfolge der Liste spielt keine Rolle.
    expect(zeitraumAusNachweisen([...ZWEI].reverse(), { von: '2026-08-15', bis: '2026-09-15' }))
      .toEqual({ von: '2026-08-20', bis: '2026-09-10' });
  });

  it('je Monatsabschnitt nur, was in ihm liegt', () => {
    expect(zeitraumAusNachweisen(ZWEI, AUGUST)).toEqual({ von: '2026-08-20', bis: '2026-08-31' });
    expect(zeitraumAusNachweisen(ZWEI, SEPTEMBER)).toEqual({ von: '2026-09-01', bis: '2026-09-10' });
    expect(zeitraumAusNachweisen(ZWEI, { von: '2026-10-01', bis: '2026-10-31' })).toBeNull();
  });

  it('ein Nachweis über die Monatsgrenze wird auf den Abschnitt beschnitten', () => {
    /*
     * Ohne den Schnitt stünde auf der Augustzeile „bis 05.09." — und die
     * Doppelabrechnungssperre der Pauschale hielte den September für schon
     * berechnet.
     */
    const ueber = [nachweis('2026-08-25', '2026-09-05')];
    expect(zeitraumAusNachweisen(ueber, AUGUST)).toEqual({ von: '2026-08-25', bis: '2026-08-31' });
    expect(zeitraumAusNachweisen(ueber, SEPTEMBER)).toEqual({ von: '2026-09-01', bis: '2026-09-05' });
    const augustZeile: BisherigerAnspruch = {
      rechnungId: 'r', nummer: 'RE-1', angelegtAm: '2026-09-01',
      leistungVon: '2026-08-25', leistungBis: '2026-08-31', nettoCent: cent(100n),
    };
    expect(ueberschneidet(augustZeile, SEPTEMBER)).toBe(false);
  });

  it('beide Grenzen gehören dazu: ein Nachweis, der am Monatsletzten endet, berührt den Monat', () => {
    expect(zeitraumAusNachweisen([nachweis('2026-07-20', '2026-08-01')], AUGUST))
      .toEqual({ von: '2026-08-01', bis: '2026-08-01' });
    expect(zeitraumAusNachweisen([nachweis('2026-07-01', '2026-07-31')], AUGUST)).toBeNull();
  });

  it('leistungszeitraum: im Modus aus den Nachweisen, sonst der Abschnitt', () => {
    const modus = konfiguration('stundenbasiert', {}, 'nach_leistungsnachweis');
    expect(leistungszeitraum(modus, AUGUST, ZWEI)).toEqual({ von: '2026-08-20', bis: '2026-08-31' });
    expect(leistungszeitraum(modus, AUGUST, [])).toEqual({ von: null, bis: null });
    expect(leistungszeitraum(konfiguration('stundenbasiert'), AUGUST, ZWEI)).toEqual(AUGUST);
  });

  /** Ein Testdoppel der Datenbank: das Recht und die Nachweise, sonst nichts. */
  function db(antwort: { darf?: boolean; nachweise?: readonly SignierterNachweis[] }) {
    const fragen: string[] = [];
    const abfrage = async <T,>(anweisung: string): Promise<readonly T[]> => {
      fragen.push(anweisung);
      if (anweisung.includes('app.hat_recht')) return [{ darf: antwort.darf ?? true }] as unknown as T[];
      if (anweisung.includes('from leistungsnachweis')) return (antwort.nachweise ?? []) as unknown as T[];
      /* Die Turnusse der Vereinbarung (V-327) — hier keine. */
      if (anweisung.includes('fin.turnusse_der_abrechnung')) {
        return [{ daten: { turnusse: [], ausnahmen: [] } }] as unknown as T[];
      }
      throw new Error(`unerwartete Abfrage: ${anweisung}`);
    };
    return { db: { abfrage } as Abfrage, fragen };
  }

  it('pruefeNachweisZeitraum: ein Befund je Abschnitt OHNE Nachweis, blockierend, mit O-54', async () => {
    const { db: d } = db({ nachweise: [nachweis('2026-08-20', '2026-08-31')] });
    const befunde = await pruefeNachweisZeitraum(
      d, konfiguration('monatspauschale', { teilmonat: 'keine' }, 'nach_leistungsnachweis'),
      [AUGUST, SEPTEMBER]);
    expect(befunde).toHaveLength(1);
    expect(befunde[0]).toMatchObject({ art: 'fehler', feld: 'leistungszeitraum_modus', offeneFrage: 'O-54' });
    expect(befunde[0]!.textDe).toContain('01.09.2026 bis 30.09.2026');
  });

  it('ohne das Recht, Nachweise zu lesen, sagt der Befund das — nicht „kein Nachweis"', async () => {
    const { db: d, fragen } = db({ darf: false, nachweise: [nachweis('2026-08-20', '2026-08-31')] });
    const befunde = await pruefeNachweisZeitraum(
      d, konfiguration('stundenbasiert', {}, 'nach_leistungsnachweis'), [AUGUST]);
    expect(befunde).toHaveLength(1);
    expect(befunde[0]!.textDe).toContain('Sie zu lesen verlangt das Recht');
    expect(befunde[0]!.textDe).not.toContain('nachweis.lesen');
    expect(fragen.some((q) => q.includes('from leistungsnachweis'))).toBe(false);
  });

  it('in den anderen Modi fragt die Prüfung die Datenbank gar nicht', async () => {
    const { db: d, fragen } = db({});
    expect(await pruefeNachweisZeitraum(d, konfiguration('stundenbasiert'), [AUGUST])).toEqual([]);
    expect(fragen).toEqual([]);
  });

  it('die Pauschale vergleicht im Modus den ganzen Monat mit dem schon Berechneten', async () => {
    /*
     * Anteilig nach Kalendertagen vergleicht die Pauschale sonst nur ihren
     * Abschnitt. Im Modus trägt die Zeile aber den Zeitraum ihrer Nachweise —
     * kürzer als die berechneten Tage —, und gegen ihn verglichen bliebe ein
     * schon berechneter Tag abrechenbar.
     */
    const schon: BisherigerAnspruch = {
      rechnungId: 'r', nummer: 'RE-00007', angelegtAm: '2026-08-20',
      leistungVon: '2026-08-05', leistungBis: '2026-08-10', nettoCent: cent(50_000n),
    };
    const eingabe = (modus: string) => ({
      konfiguration: {
        ...konfiguration('monatspauschale', { teilmonat: 'kalendertage' }, modus),
        pauschaleNettoCent: cent(189_000n),
      },
      periode: { von: '2026-08-15', bis: '2026-08-31' },
      bisher: [schon],
    });
    const { db: d } = db({ nachweise: [nachweis('2026-08-16', '2026-08-30')] });
    const ohne = await MONATSPAUSCHALE.pruefe(d, eingabe('kalendermonat'));
    expect(ohne.filter((b) => b.feld === 'leistung_von')).toEqual([]);
    const mit = await MONATSPAUSCHALE.pruefe(d, eingabe('nach_leistungsnachweis'));
    expect(mit.filter((b) => b.feld === 'leistung_von').map((b) => b.textDe).join(' '))
      .toContain('RE-00007');
  });
});

/*
 * V-207 (D-700): dieselbe Vereinbarung auf zwei Belegen. Die Beträge gegen
 * Postgres prüft `tests/isolation/rechnung-entwurf.test.ts` §7; hier steht,
 * was ohne Datenbank entschieden wird.
 */
describe('ein Anspruch aus der Vereinbarung wird einmal berechnet (V-207)', () => {
  const anspruch = (
    von: string | null, bis: string | null, netto = 0n, nummer: string | null = 'RE-00007',
  ): BisherigerAnspruch => ({
    rechnungId: '00000000-0000-0000-0000-00000000000a', nummer, angelegtAm: '2026-09-01',
    leistungVon: von, leistungBis: bis, nettoCent: cent(netto),
  });
  /*
   * Ohne Datenbank — bis auf die eine Frage, die die Pauschale seit V-327
   * immer stellt: die Turnusse der Vereinbarung (hier keine). Jede andere
   * Abfrage wirft.
   */
  const ohneDb: Abfrage = {
    abfrage: async <T,>(anweisung: string): Promise<readonly T[]> => {
      if (anweisung.includes('fin.turnusse_der_abrechnung')) {
        return [{ daten: { turnusse: [], ausnahmen: [] } }] as unknown as T[];
      }
      throw new Error(`unerwartete Abfrage: ${anweisung}`);
    },
  };

  it('überschneiden heisst: mindestens ein gemeinsamer Tag, beide Grenzen einschließlich', () => {
    const august = { von: '2026-08-01', bis: '2026-08-31' };
    expect(ueberschneidet(anspruch('2026-08-31', '2026-09-30'), august)).toBe(true);
    expect(ueberschneidet(anspruch('2026-07-01', '2026-08-01'), august)).toBe(true);
    expect(ueberschneidet(anspruch('2026-09-01', '2026-09-30'), august)).toBe(false);
    /* Ohne Zeitraum weiss niemand, welche Tage er deckt — er gilt als überall. */
    expect(ueberschneidet(anspruch(null, null), august)).toBe(true);
  });

  it('der Beleg wird beim Namen genannt — mit Nummer oder als Entwurf mit Tag', () => {
    expect(belegBenannt(anspruch(null, null))).toBe('Rechnung RE-00007');
    expect(belegBenannt(anspruch(null, null, 0n, null))).toBe('einem Entwurf vom 01.09.2026');
  });

  it('nur die Arten mit eigenem Beleg verzichten auf die Liste', () => {
    const ohneListe = alleAbrechnungsarten()
      .filter((a) => a.sperrtUeberBeleg === true).map((a) => a.schluessel).sort();
    expect(ohneListe).toEqual(['einheitspreis_aufmass', 'einzelabruf', 'stundenbasiert']);
  });

  it('Monatspauschale: ein schon berechneter Monat blockiert — mit Nummer und Tagen', async () => {
    const k = { ...konfiguration('monatspauschale', { teilmonat: 'keine' }),
      pauschaleNettoCent: cent(240_000n) };
    const befunde = await MONATSPAUSCHALE.pruefe(ohneDb, {
      konfiguration: k, periode: { von: '2026-07-01', bis: '2026-09-30' },
      bisher: [anspruch('2026-08-01', '2026-08-31', 240_000n)],
    });
    const fehler = befunde.filter((b) => b.art === 'fehler');
    expect(fehler).toHaveLength(1);
    expect(fehler[0]!.textDe).toMatch(/August 2026 \(01\.08\.2026 bis 31\.08\.2026\).*RE-00007/u);
  });

  it('„teilmonat = keine": ein halber Monat beansprucht den ganzen', async () => {
    const k = { ...konfiguration('monatspauschale', { teilmonat: 'keine' }),
      pauschaleNettoCent: cent(240_000n) };
    const befunde = await MONATSPAUSCHALE.pruefe(ohneDb, {
      konfiguration: k, periode: { von: '2026-10-16', bis: '2026-10-31' },
      bisher: [anspruch('2026-10-01', '2026-10-15', 240_000n)],
    });
    expect(befunde.some((b) => b.art === 'fehler')).toBe(true);

    const anteilig = { ...k, parameter: { teilmonat: 'kalendertage' } };
    const frei = await MONATSPAUSCHALE.pruefe(ohneDb, {
      konfiguration: anteilig, periode: { von: '2026-10-16', bis: '2026-10-31' },
      bisher: [anspruch('2026-10-01', '2026-10-15', 116_129n)],
    });
    expect(frei.filter((b) => b.art === 'fehler')).toEqual([]);
  });

  it('Festpreis anteilig: der Grad ist der Gesamtstand — EINE Rundung über den Stand', () => {
    const festpreis = cent(1_000_001n);
    const erste = anteiligerRest(festpreis, 3333, cent(0n));
    const zweite = anteiligerRest(festpreis, 6667, erste);
    const dritte = anteiligerRest(festpreis, 10_000, cent(erste + zweite));
    /* In der Summe genau der Festpreis — kein Cent aus drei Rundungen. */
    expect(erste + zweite + dritte).toBe(1_000_001n);
    /* Ein Stand unter dem schon Berechneten ergibt nichts Neues. */
    expect(anteiligerRest(festpreis, 5000, cent(erste + zweite))).toBeLessThan(0n);
  });

  it('Festpreis anteilig: kein Zuwachs ist ein Befund mit O-932, keine Zeile über null', async () => {
    const k = { ...konfiguration('festpreis_los', { teilleistung: 'anteilig' }),
      festpreisNettoCent: cent(1_000_000n) };
    const befunde = await FESTPREIS_LOS.pruefe(ohneDb, {
      konfiguration: k, periode: { von: '2026-08-01', bis: '2026-08-31' },
      fertigstellungBp: 6000, bisher: [anspruch('2026-07-01', '2026-07-31', 600_000n)],
    });
    const fehler = befunde.find((b) => b.feld === 'fertigstellung_bp');
    expect(fehler?.offeneFrage).toBe('O-932');
    expect(fehler?.textDe).toMatch(/Gesamtstand/u);
  });
});
