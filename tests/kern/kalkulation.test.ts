/**
 * Die Reinigungskalkulation — Abnahmekriterium der Phase 4:
 * "a cleaning offer can be priced from the Raumbuch
 *  (`Σ m² ÷ performance value × frequency`) without manual arithmetic."
 *
 * Geprueft wird nicht, ob eine Zahl herauskommt, sondern ob es DIE Zahl ist:
 * ganzzahlig gerechnet, einmal gerundet, und die Zeilen ergeben die Summe.
 */
import { describe, expect, it } from 'vitest';
import { basisPunkte, cent, formatiereGeld } from '../../src/server/services/finanz/geld.js';
import {
  addiereMengen, formatiereMenge, mengeAusPostgres, mengeAusPostgresOderNull,
  MengeFehler, milliMenge,
} from '../../src/server/services/finanz/menge.js';
import {
  alsStundenText, sekundenJeDurchgang, sekundenJePeriode, RichtzeitFehler,
  type Flaechenposten,
} from '../../src/server/services/kalkulation/richtzeit.js';
import {
  kalkuliere, lohnkostenAusSekunden, verteileNetto, LEERE_KALKULATION,
} from '../../src/server/services/kalkulation/index.js';
import {
  PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF, PLATZHALTER_TURNUSSE, TarifFehler,
} from '../../src/server/services/kalkulation/tarif.js';

const posten = (flaeche: string, wert: string, name = 'PVC'): Flaechenposten => ({
  belagsartId: `b-${name}`,
  bezeichnung: name,
  flaeche: mengeAusPostgres(flaeche),
  leistungswert: mengeAusPostgres(wert),
});

describe('(1) Mengen sind ganzzahlige Tausendstel, nie Gleitkomma', () => {
  it('die Form, die Postgres liefert, wird gelesen', () => {
    expect(mengeAusPostgres('25.000')).toBe(25_000n);
    expect(mengeAusPostgres('25')).toBe(25_000n);
    expect(mengeAusPostgres('0.001')).toBe(1n);
    expect(mengeAusPostgres('1234.567')).toBe(1_234_567n);
    expect(mengeAusPostgres('-3.5')).toBe(-3_500n);
  });

  it('eine deutsche Schreibweise wird NICHT stillschweigend akzeptiert', () => {
    // "25,000" aus einem Formular heisst 25 — oder 25000, je nach Herkunft.
    // Beides zu erlauben hiesse, die beiden nicht mehr unterscheiden zu koennen.
    expect(() => mengeAusPostgres('25,000')).toThrow(MengeFehler);
  });

  it('eine vierte Nachkommastelle wird abgewiesen statt gerundet', () => {
    expect(() => mengeAusPostgres('1.2345')).toThrow(MengeFehler);
  });

  it('null aus einer Aggregation ueber null Zeilen ist null Menge', () => {
    expect(mengeAusPostgresOderNull(null)).toBe(0n);
  });

  it('Mengen summieren sich exakt — auch die, die als Gleitkomma driften', () => {
    // 0,1 + 0,2 ist als Gleitkomma 0,30000000000000004.
    const summe = addiereMengen(mengeAusPostgres('0.1'), mengeAusPostgres('0.2'));
    expect(summe).toBe(300n);
    expect(formatiereMenge(summe)).toBe('0,30');
  });

  it('die Anzeige ist deutsch und rechnet nicht', () => {
    expect(formatiereMenge(milliMenge(25_500n))).toBe('25,50');
    expect(formatiereMenge(milliMenge(1_234_567n))).toBe('1.234,567');
  });
});

describe('(2) Σ m² ÷ Leistungswert — die Richtzeit', () => {
  it('500 m² bei 250 m²/h sind genau zwei Stunden', () => {
    expect(sekundenJeDurchgang(posten('500', '250'))).toBe(7200n);
  });

  it('und die Anzeige sagt 2,00 Stunden', () => {
    expect(alsStundenText(7200n)).toBe('2,00');
  });

  it('ein krummer Wert wird EINMAL gerundet, kaufmaennisch', () => {
    // 100 m² ÷ 240 m²/h = 0,41666… h = 1500 s exakt.
    expect(sekundenJeDurchgang(posten('100', '240'))).toBe(1500n);
    // 1 m² ÷ 3 m²/h = 1200 s. 1 m² ÷ 7 m²/h = 514,28… → 514 s.
    expect(sekundenJeDurchgang(posten('1', '7'))).toBe(514n);
  });

  it('drei Nachkommastellen in BEIDEN Groessen bleiben exakt', () => {
    // 12,345 m² ÷ 3,7 m²/h = 3,33648… h = 12011,35… s → 12011 s
    expect(sekundenJeDurchgang(posten('12.345', '3.7'))).toBe(12_011n);
  });

  it('ein Leistungswert von 0 ist eine fehlende Angabe, kein Gratisraum', () => {
    expect(() => sekundenJeDurchgang(posten('500', '0'))).toThrow(RichtzeitFehler);
    expect(() => sekundenJeDurchgang(posten('500', '0'))).toThrow(/O-17/u);
  });

  it('eine negative Flaeche gibt es nicht', () => {
    expect(() => sekundenJeDurchgang(posten('-1', '250'))).toThrow(RichtzeitFehler);
  });

  it('der Frequenzfaktor multipliziert die Zeit, mit eigener Rundung', () => {
    const p = posten('500', '250');                       // 7200 s je Durchgang
    expect(sekundenJePeriode(p, milliMenge(21_667n))).toBe(156_002n); // × 21,667
    expect(sekundenJePeriode(p, milliMenge(1_000n))).toBe(7200n);     // × 1
    expect(sekundenJePeriode(p, milliMenge(0n))).toBe(0n);
  });
});

describe('(3) Die Zuschlagskette — und dass die Zeilen die Summe ergeben', () => {
  const tarif = PLATZHALTER_TARIF.tarif('m', 'reinigung');
  const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');

  it('Lohnkosten entstehen an genau einer Stelle aus Sekunden', () => {
    // 7200 s = 2 h bei 29,00 €/h = 58,00 €
    expect(lohnkostenAusSekunden(7200n, cent(2900n))).toBe(5800n);
    // Eine halbe Sekunde Rest rundet kaufmaennisch auf.
    expect(lohnkostenAusSekunden(1n, cent(3600n))).toBe(1n);
  });

  it('die Summe der Zeilen IST die Gesamtsumme', () => {
    const k = kalkuliere({
      posten: [posten('500', '250', 'PVC'), posten('120.5', '180', 'Teppich'),
               posten('33.333', '90', 'Naturstein')],
      frequenz, tarif,
    });
    const summeDerZeilen = k.zeilen.reduce((s, z) => s + z.lohnkosten, 0n);
    expect(k.lohnkosten).toBe(summeDerZeilen);
    expect(k.sekundenJePeriode).toBe(k.zeilen.reduce((s, z) => s + z.sekundenJePeriode, 0n));
  });

  it('die Kette rechnet Zuschlag auf Zwischensumme, nicht auf den Lohn', () => {
    const k = kalkuliere({ posten: [posten('500', '250')], frequenz, tarif });
    // 2 h × 29,00 € = 58,00 €
    expect(k.lohnkosten).toBe(5800n);
    expect(k.gemeinkosten).toBe(870n);                    // 15 % von 58,00
    expect(k.wagnis).toBe(200n);                          // 3 % von 66,70 = 2,001 → 2,00
    expect(k.gewinn).toBe(344n);                          // 5 % von 68,70 = 3,435 → 3,44
    expect(k.netto).toBe(5800n + 870n + 200n + 344n);
    expect(formatiereGeld(k.netto)).toBe('72,14 €');
  });

  it('die Gesamtflaeche ist die Summe der Posten', () => {
    const k = kalkuliere({
      posten: [posten('500', '250', 'A'), posten('120.5', '180', 'B')], frequenz, tarif,
    });
    expect(k.flaecheGesamt).toBe(620_500n);
  });

  it('eine Kalkulation ohne Posten ist null Euro — und sagt es', () => {
    const k = kalkuliere({ posten: [], frequenz, tarif });
    expect(k.netto).toBe(0n);
    expect(k.zeilen).toHaveLength(0);
    expect(LEERE_KALKULATION.netto).toBe(0n);
  });

  it('Flaeche OHNE Belagsart wird durchgereicht, nicht verschluckt', () => {
    const k = kalkuliere({
      posten: [posten('500', '250')], frequenz, tarif,
      flaecheOhneBelagsart: mengeAusPostgres('42.5'),
    });
    expect(k.flaecheOhneBelagsart).toBe(42_500n);
    // Und sie faellt NICHT in die Gesamtflaeche der kalkulierten Posten.
    expect(k.flaecheGesamt).toBe(500_000n);
  });
});

describe('(4) Platzhalter bleiben sichtbar (CLAUDE.md: never invent a business rule)', () => {
  it('das Ergebnis traegt die offenen Fragen, mit denen es gerechnet wurde', () => {
    const k = kalkuliere({
      posten: [posten('500', '250')],
      frequenz: PLATZHALTER_FREQUENZ.frequenz('5_pro_woche'),
      tarif: PLATZHALTER_TARIF.tarif('m', 'reinigung'),
    });
    expect(k.istPlatzhalter).toBe(true);
    expect(k.offeneFragen).toEqual(['O-16', 'O-56']);
  });

  it('ein echter Tarif ohne Platzhalter macht das Ergebnis endgueltig', () => {
    const k = kalkuliere({
      posten: [posten('500', '250')],
      frequenz: { faktor: milliMenge(1000n), istPlatzhalter: false, offeneFragen: [] },
      tarif: {
        stundensatz: cent(3000n), gemeinkostenSatz: basisPunkte(1000),
        wagnisSatz: basisPunkte(0), gewinnSatz: basisPunkte(0),
        istPlatzhalter: false, offeneFragen: [],
      },
    });
    expect(k.istPlatzhalter).toBe(false);
    expect(k.offeneFragen).toEqual([]);
    expect(k.netto).toBe(6600n);   // 2 h × 30,00 € + 10 %
  });

  it('ein unbekannter Turnus bekommt KEINEN Ersatzwert', () => {
    expect(() => PLATZHALTER_FREQUENZ.frequenz('alle_paar_wochen')).toThrow(TarifFehler);
    expect(() => PLATZHALTER_FREQUENZ.frequenz('alle_paar_wochen')).toThrow(/O-56/u);
  });

  it('die bekannten Turnusse stehen an EINER Stelle', () => {
    expect(PLATZHALTER_TURNUSSE).toContain('5_pro_woche');
    expect(PLATZHALTER_TURNUSSE).toContain('einmalig');
    for (const t of PLATZHALTER_TURNUSSE) {
      expect(PLATZHALTER_FREQUENZ.frequenz(t).faktor).toBeGreaterThan(0n);
    }
  });
});

describe('(5) Der Beweis gegen Gleitkomma', () => {
  it('tausend Raeume à 0,001 m² ergeben exakt einen Quadratmeter — nicht 0,9999', () => {
    const viele = Array.from({ length: 1000 }, () => mengeAusPostgres('0.001'));
    expect(addiereMengen(...viele)).toBe(1000n);
  });

  it('dieselbe Rechnung als Gleitkomma waere daneben — hier ist sie es nicht', () => {
    // 0,1 m² bei 0,3 m²/h: als double 1199,9999999999998 s.
    expect(sekundenJeDurchgang(posten('0.1', '0.3'))).toBe(1200n);
  });

  it('hundert Kalkulationen summieren sich ohne Cent-Drift', () => {
    const tarif = PLATZHALTER_TARIF.tarif('m', 'reinigung');
    const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
    let summe = 0n;
    for (let i = 0; i < 100; i += 1) {
      summe += kalkuliere({ posten: [posten('33.333', '7')], frequenz, tarif }).netto;
    }
    const einzeln = kalkuliere({ posten: [posten('33.333', '7')], frequenz, tarif }).netto;
    expect(summe).toBe(einzeln * 100n);
  });
});

describe('(7) Der Nettoanteil je Zeile — sonst geht das Angebot zum Selbstkostenpreis', () => {
  const tarif = PLATZHALTER_TARIF.tarif('m', 'reinigung');
  const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');

  it('die verteilten Preise ergeben EXAKT das Netto, nicht die Lohnsumme', () => {
    const k = kalkuliere({
      posten: [posten('500', '250', 'PVC'), posten('120.5', '180', 'Teppich'),
               posten('33.333', '90', 'Naturstein')],
      frequenz, tarif,
    });
    const preise = verteileNetto(k.zeilen, k.netto);
    expect(preise).toHaveLength(3);
    expect(preise.reduce((s, p) => s + p, 0n)).toBe(k.netto);
    // Und ausdruecklich NICHT die Lohnsumme — das war der Fehler.
    expect(preise.reduce((s, p) => s + p, 0n)).not.toBe(k.lohnkosten);
    expect(k.netto).toBeGreaterThan(k.lohnkosten);
  });

  it('jede Zeile bekommt mindestens ihren Lohnanteil — keine faellt unter Kosten', () => {
    const k = kalkuliere({
      posten: [posten('500', '250', 'PVC'), posten('7.001', '90', 'Winzig')],
      frequenz, tarif,
    });
    const preise = verteileNetto(k.zeilen, k.netto);
    for (const [i, zeile] of k.zeilen.entries()) {
      expect(preise[i]!).toBeGreaterThanOrEqual(zeile.lohnkosten);
    }
  });

  /**
   * Der Fall, an dem eine naive Verteilung Cent verliert: drei gleich schwere
   * Zeilen und ein Netto, das nicht durch drei teilbar ist. Abrunden ergaebe
   * 3 × 2404 = 7212 statt 7214 — zwei Cent, die niemand sucht und die den
   * Summentrigger gegen die Zeilen stellen.
   */
  it('der Rest wird verteilt und nicht verschluckt', () => {
    const k = kalkuliere({
      posten: [posten('500', '250', 'A'), posten('500', '250', 'B'),
               posten('500', '250', 'C')],
      frequenz, tarif,
    });
    const preise = verteileNetto(k.zeilen, k.netto);
    expect(preise.reduce((s, p) => s + p, 0n)).toBe(k.netto);
    // Drei gleiche Gewichte: die Differenz zwischen groesster und kleinster
    // Zeile ist hoechstens ein Cent.
    const sortiert = [...preise].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sortiert[2]! - sortiert[0]!).toBeLessThanOrEqual(1n);
  });

  it('zweimal dieselbe Kalkulation ergibt zweimal dieselben Zeilenpreise', () => {
    const k = kalkuliere({
      posten: [posten('333.333', '90', 'A'), posten('111.111', '90', 'B'),
               posten('7.777', '90', 'C')],
      frequenz, tarif,
    });
    expect(verteileNetto(k.zeilen, k.netto)).toEqual(verteileNetto(k.zeilen, k.netto));
  });

  it('keine Zeile, kein Preis — und Null bleibt Null', () => {
    expect(verteileNetto([], cent(0n))).toEqual([]);
    const k = kalkuliere({ posten: [posten('0', '250')], frequenz, tarif });
    expect(k.netto).toBe(0n);
    expect(verteileNetto(k.zeilen, k.netto)).toEqual([0n]);
  });

  it('ein Netto ohne Lohnkosten laesst sich nicht zuordnen und wird abgewiesen', () => {
    const k = kalkuliere({ posten: [posten('0', '250')], frequenz, tarif });
    expect(() => verteileNetto(k.zeilen, cent(100n)))
      .toThrow(/laesst sich nicht zuordnen/u);
  });
});

describe('(8) Die offenen Fragen reisen mit — auch die des Leistungswerts', () => {
  const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');

  /** Ein Tarif, den jemand bestaetigt hat — O-16 und O-56 sind beantwortet. */
  const bestaetigterTarif = {
    stundensatz: cent(2900n),
    gemeinkostenSatz: basisPunkte(1500),
    wagnisSatz: basisPunkte(300),
    gewinnSatz: basisPunkte(500),
    istPlatzhalter: false,
    offeneFragen: [] as readonly string[],
  };
  const bestaetigteFrequenz = { ...frequenz, istPlatzhalter: false, offeneFragen: [] };

  it('ein Platzhalter-Leistungswert macht die Kalkulation vorlaeufig (O-17)', () => {
    const k = kalkuliere({
      posten: [{ ...posten('500', '250'), leistungswertIstPlatzhalter: true }],
      frequenz: bestaetigteFrequenz, tarif: bestaetigterTarif,
    });
    // Tarif und Frequenz bestaetigt — und trotzdem kein bestaetigter Preis.
    expect(k.istPlatzhalter).toBe(true);
    expect(k.offeneFragen).toContain('O-17');
  });

  it('sind alle drei bestaetigt, ist die Kalkulation es auch', () => {
    const k = kalkuliere({
      posten: [{ ...posten('500', '250'), leistungswertIstPlatzhalter: false }],
      frequenz: bestaetigteFrequenz, tarif: bestaetigterTarif,
    });
    expect(k.istPlatzhalter).toBe(false);
    expect(k.offeneFragen).toEqual([]);
  });

  it('eine einzige Platzhalter-Belagsart unter vielen genuegt', () => {
    const k = kalkuliere({
      posten: [
        { ...posten('500', '250', 'A'), leistungswertIstPlatzhalter: false },
        { ...posten('300', '180', 'B'), leistungswertIstPlatzhalter: false },
        { ...posten('100', '90', 'C'), leistungswertIstPlatzhalter: true },
      ],
      frequenz: bestaetigteFrequenz, tarif: bestaetigterTarif,
    });
    expect(k.istPlatzhalter).toBe(true);
  });

  it('die nicht bepreisbare Flaeche steht im Ergebnis, statt zu verschwinden', () => {
    const k = kalkuliere({
      posten: [posten('500', '250')],
      frequenz, tarif: PLATZHALTER_TARIF.tarif('m', 'reinigung'),
      flaecheOhneBelagsart: milliMenge(42_000n),
      ohneGueltigenLeistungswert: ['b-1', 'b-2'],
    });
    expect(k.flaecheOhneBelagsart).toBe(42_000n);
    expect(k.ohneGueltigenLeistungswert).toEqual(['b-1', 'b-2']);
  });
});
