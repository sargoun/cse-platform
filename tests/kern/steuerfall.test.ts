/**
 * §13b UStG und §48 EStG — die reinen Entscheidungen (FIN-09, FIN-10, PR 51).
 *
 * **Beide Richtungen kosten, und beide hängen an einem Datum.** Wer die
 * Bauabzugsteuer nicht einbehält, obwohl er müsste, haftet für den Betrag
 * (§48a Abs. 3 EStG); wer einbehält, obwohl eine gültige Bescheinigung vorlag,
 * zieht dem Kunden Geld ab, das ihm zusteht. Deshalb stehen hier die
 * GRENZTAGE: der Tag davor und der Tag danach, beide einzeln.
 */
import { describe, expect, it } from 'vitest';
import { cent } from '../../src/server/services/finanz/geld.js';
import {
  HINWEIS_13B, reverseChargeLage, type StatusZeile,
} from '../../src/server/services/finanz/steuer/nachweis.js';
import {
  abzugLage, giltAm, type Bescheinigung,
} from '../../src/server/services/finanz/estg48/abzug.js';

// ---------------------------------------------------------------------------
// §13b UStG
// ---------------------------------------------------------------------------

const BAULEISTENDER: StatusZeile = {
  leistungsart: 'bau',
  istBauleistender: true,
  giltAb: '2026-01-01',
  giltBis: '2026-12-31',
  grundlage: 'USt 1 TG vom 15.12.2025',
};

describe('§13b UStG — die Steuerschuld geht über, oder sie geht nicht über', () => {
  it('Bauleistung an einen Bauleistenden: sie geht über, mit Pflichthinweis', () => {
    const lage = reverseChargeLage([BAULEISTENDER], '2026-08-15', 'bau');
    expect(lage.greift).toBe(true);
    expect(lage.hinweis).toBe(HINWEIS_13B);
    expect(lage.grund).toContain('Nr. 4');
  });

  /**
   * **Die Gegenprobe, ohne die die Zusage oben nichts bewiese**: dieselbe
   * Leistung an denselben Kunden, aber der Status sagt ausdrücklich Nein.
   */
  it('an einen NICHT-Bauleistenden: sie geht nicht über', () => {
    const lage = reverseChargeLage(
      [{ ...BAULEISTENDER, istBauleistender: false }], '2026-08-15', 'bau');
    expect(lage.greift).toBe(false);
    expect(lage.hinweis).toBeNull();
    expect(lage.grund).toContain('ausdrücklich KEIN');
  });

  it('ohne hinterlegten Status wird die Steuer ausgewiesen — die sichere Richtung', () => {
    const lage = reverseChargeLage([], '2026-08-15', 'bau');
    expect(lage.greift).toBe(false);
    expect(lage.grund).toContain('§14c');
  });

  /**
   * **Nr. 8 ist der häufigere Fall dieser Gruppe.** Ein Status für `bau` sagt
   * über eine Gebäudereinigungsleistung nichts — und andersherum ebenso.
   */
  it('ein Bau-Status deckt keine Gebäudereinigungsleistung', () => {
    const lage = reverseChargeLage([BAULEISTENDER], '2026-08-15', 'gebaeudereinigung');
    expect(lage.greift).toBe(false);
  });

  it('ein Reinigungs-Status trägt seine eigene Fundstelle (Nr. 8)', () => {
    const lage = reverseChargeLage(
      [{ ...BAULEISTENDER, leistungsart: 'gebaeudereinigung' }],
      '2026-08-15', 'gebaeudereinigung');
    expect(lage.greift).toBe(true);
    expect(lage.grund).toContain('Nr. 8');
  });

  it('weder Bau noch Reinigung: §13b ist gar nicht berührt', () => {
    const lage = reverseChargeLage([BAULEISTENDER], '2026-08-15', null);
    expect(lage.greift).toBe(false);
    expect(lage.grund).toContain('weder');
  });

  describe('die Grenztage des Status', () => {
    it('am ersten Gültigkeitstag greift er', () => {
      expect(reverseChargeLage([BAULEISTENDER], '2026-01-01', 'bau').greift).toBe(true);
    });
    it('am letzten Gültigkeitstag greift er', () => {
      expect(reverseChargeLage([BAULEISTENDER], '2026-12-31', 'bau').greift).toBe(true);
    });
    it('einen Tag davor nicht', () => {
      expect(reverseChargeLage([BAULEISTENDER], '2025-12-31', 'bau').greift).toBe(false);
    });
    it('einen Tag danach nicht', () => {
      expect(reverseChargeLage([BAULEISTENDER], '2027-01-01', 'bau').greift).toBe(false);
    });
    it('ohne Enddatum gilt er weiter', () => {
      const offen = { ...BAULEISTENDER, giltBis: null };
      expect(reverseChargeLage([offen], '2030-06-01', 'bau').greift).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// §48 EStG
// ---------------------------------------------------------------------------

const FSB: Bescheinigung = {
  id: 'b-1',
  nummer: 'FSB-2026-0001',
  gueltigVon: '2026-01-01',
  gueltigBis: '2026-12-31',
  widerrufenAm: null,
  umfang: 'unbeschraenkt',
  auftragId: null,
};

const BASIS = {
  gegenleistungCent: cent(1_190_000n),   // 11.900,00 € brutto
  istBauleistung: true,
  satzBp: 1500,
  leistungVon: '2026-08-01',
  leistungBis: '2026-08-31',
  auftragId: 'a-1',
} as const;

describe('§48 EStG — 15 % oder nichts, und das entscheidet ein Datum', () => {
  it('ohne gültige Bescheinigung werden 15 % einbehalten, in ganzen Cent', () => {
    const lage = abzugLage({ ...BASIS, stichtag: '2026-08-31', bescheinigungen: [] });
    expect(lage.einbehalten).toBe(true);
    expect(lage.einbehaltCent).toBe(178_500n);   // 15 % von 11.900,00 €
    expect(lage.bescheinigungId).toBeNull();
  });

  it('mit gültiger Bescheinigung wird nichts einbehalten', () => {
    const lage = abzugLage({ ...BASIS, stichtag: '2026-08-31', bescheinigungen: [FSB] });
    expect(lage.einbehalten).toBe(false);
    expect(lage.einbehaltCent).toBe(0n);
    expect(lage.bescheinigungId).toBe('b-1');
  });

  it('keine Bauleistung: §48 ist gar nicht berührt', () => {
    const lage = abzugLage({
      ...BASIS, istBauleistung: false, stichtag: '2026-08-31', bescheinigungen: [],
    });
    expect(lage.einbehalten).toBe(false);
    expect(lage.grund).toContain('nur für Bauleistungen');
  });

  /**
   * **Die zwei Grenztage, einzeln.** Eine Bescheinigung, die am Tag VOR dem
   * Stichtag abläuft, befreit nicht; eine, die am Tag DANACH abläuft, befreit.
   * Zwischen beiden liegen 1.785,00 €, und es ist derselbe Kunde.
   */
  describe('die Grenztage der Bescheinigung', () => {
    it('sie läuft am Tag VOR dem Stichtag ab: es wird einbehalten', () => {
      const lage = abzugLage({
        ...BASIS, stichtag: '2026-08-31',
        bescheinigungen: [{ ...FSB, gueltigBis: '2026-08-30' }],
      });
      expect(lage.einbehalten).toBe(true);
    });

    it('sie läuft AM Stichtag ab: sie gilt noch', () => {
      const lage = abzugLage({
        ...BASIS, stichtag: '2026-08-31',
        bescheinigungen: [{ ...FSB, gueltigBis: '2026-08-31' }],
      });
      expect(lage.einbehalten).toBe(false);
    });

    it('sie beginnt am Tag NACH dem Stichtag: es wird einbehalten', () => {
      const lage = abzugLage({
        ...BASIS, stichtag: '2026-08-31',
        bescheinigungen: [{ ...FSB, gueltigVon: '2026-09-01' }],
      });
      expect(lage.einbehalten).toBe(true);
    });

    it('ein Widerruf am Stichtag beendet sie', () => {
      const lage = abzugLage({
        ...BASIS, stichtag: '2026-08-31',
        bescheinigungen: [{ ...FSB, widerrufenAm: '2026-08-31' }],
      });
      expect(lage.einbehalten).toBe(true);
    });

    it('ein Widerruf einen Tag SPÄTER beendet sie noch nicht', () => {
      const lage = abzugLage({
        ...BASIS, stichtag: '2026-08-31',
        bescheinigungen: [{ ...FSB, widerrufenAm: '2026-09-01' }],
      });
      expect(lage.einbehalten).toBe(false);
    });
  });

  /**
   * **Eine auftragsbezogene Bescheinigung befreit EINEN Auftrag** (§48b EStG
   * kennt beide Formen). Ohne diese Unterscheidung nähme der Prüfer sie für
   * jeden anderen mit an — und die Gruppe haftete für den nicht einbehaltenen
   * Betrag.
   */
  it('eine auftragsbezogene Bescheinigung gilt nur für ihren Auftrag', () => {
    const bezogen: Bescheinigung = {
      ...FSB, umfang: 'auftragsbezogen', auftragId: 'a-1',
    };
    expect(giltAm(bezogen, '2026-08-31', 'a-1')).toBe(true);
    expect(giltAm(bezogen, '2026-08-31', 'a-2')).toBe(false);
    expect(giltAm(bezogen, '2026-08-31', null)).toBe(false);
  });

  /**
   * **Die Warnung zu O-21 — sichtbar statt still entschieden.** Die
   * Bescheinigung gilt am Stichtag, aber ihre Gültigkeit endet MITTEN im
   * Leistungszeitraum. Welches Datum dann maßgeblich ist, hat niemand
   * beantwortet; der Mensch, der unterschreibt, soll es sehen.
   */
  it('endet die Gültigkeit im Leistungszeitraum, warnt die Lage', () => {
    const lage = abzugLage({
      ...BASIS, stichtag: '2026-08-01',
      bescheinigungen: [{ ...FSB, gueltigBis: '2026-08-15' }],
    });
    expect(lage.einbehalten).toBe(false);
    expect(lage.warnung).toContain('O-21');
    expect(lage.warnung).toContain('2026-08-15');
  });

  it('und ohne diesen Fall gibt es keine Warnung', () => {
    const lage = abzugLage({ ...BASIS, stichtag: '2026-08-31', bescheinigungen: [FSB] });
    expect(lage.warnung).toBeNull();
  });

  /**
   * §13b und §48 auf EINER Rechnung: die Kombination wird geprüft, nicht nur
   * jede Regel für sich. Eine Bauleistung an einen Bauleistenden OHNE
   * Freistellungsbescheinigung weist 0,00 € Umsatzsteuer aus UND behält 15 %
   * der Gegenleistung ein — beides zugleich, und das ist richtig so.
   */
  it('§13b und §48 zusammen: kein Umsatzsteuerausweis UND 15 % Einbehalt', () => {
    const rc = reverseChargeLage([BAULEISTENDER], '2026-08-31', 'bau');
    // Bei §13b ist die Gegenleistung netto = brutto (es gibt keine Steuer).
    const netto = cent(1_000_000n);
    const abzug = abzugLage({
      ...BASIS, gegenleistungCent: netto, stichtag: '2026-08-31', bescheinigungen: [],
    });

    expect(rc.greift).toBe(true);
    expect(rc.hinweis).toBe(HINWEIS_13B);
    expect(abzug.einbehalten).toBe(true);
    expect(abzug.einbehaltCent).toBe(150_000n);
    // Zahlbar bleiben 8.500,00 € von 10.000,00 € — und der Kunde schuldet die
    // Umsatzsteuer selbst.
    expect(netto - abzug.einbehaltCent).toBe(850_000n);
  });
});
