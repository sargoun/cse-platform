/**
 * Die Postenausnahme in reduzierter Staerke — und die vier Naechte, die vor
 * jeder Planungsoberflaeche stehen (§6.4, §8.2 vierte Art, K-11, TIM-04,
 * O-714).
 *
 * **Der Befund, der diese Datei gebracht hat.** `ladeAusnahmen()` begann mit
 * `if (serie.turnusId === null) return []` und las nur `turnus_ausnahme`.
 * `posten_ausnahme` wurde im ganzen `src/`-Baum NIRGENDS gelesen — und
 * `cse_app` darf hineinschreiben. Eine Einzeltermin-Ausnahme auf einer
 * Sicherheitsserie entstand damit als Zeile und wirkte nie: der Wachdienst
 * fiel am 3. Oktober nicht aus, obwohl ihn jemand ausgetragen hatte. Genau
 * die Sorte Fehler, die CLAUDE.md als „silent, expensive, late-discovered"
 * beschreibt.
 *
 * `posten_ausnahme` traegt eine Spalte mehr als `turnus_ausnahme`:
 * `ersatz_besetzung`. Sie kommt jetzt mit — statt still wegzufallen.
 *
 * **Die vier Faelle unten sind Pflicht** (CLAUDE.md „Test before UI for money
 * and time"): Schicht 22:00–06:00, die Nacht der Umstellung vorwaerts, die
 * Nacht rueckwaerts, und zehn Schichten mit demselben Startinstant auf einem
 * Objekt. Sie stehen hier ein zweites Mal — nicht als Verdopplung von
 * `vorkommnisse.test.ts`, sondern weil DIESER Zweig (die Postenserie mit
 * reduzierter Staerke) sie sonst ungeprueft durchlaufen wuerde.
 */
import { describe, expect, it } from 'vitest';
import {
  PlanungsFehler, besetzungMitAusnahme, planeVorkommnisse, serienSchluessel,
  type Ausnahme, type Bedarfstraeger,
} from '../../src/server/services/dienstplan/vorkommnisse.js';
import { ladeAusnahmen } from '../../src/server/services/dienstplan/generator.js';

/** Eine Postenserie: Nachtwache 22:00–06:00, zwei Wachen, mindestens zwei. */
const WACHE: Bedarfstraeger = {
  planungsserieId: 'ps-1',
  quelle: 'posten',
  rrule: 'FREQ=DAILY',
  dtstartLokal: { datum: '2026-09-21', stunde: 22, minute: 0 },
  zeitzone: 'Europe/Berlin',
  dauerMinuten: 480,
  sollBesetzung: 2,
  minBesetzung: 2,
  feiertagsregel: 'unveraendert',
  gueltigAb: '2026-01-01',
  gueltigBis: null,
};

const KEINE_FEIERTAGE = new Map<string, string>();

describe('die reduzierte Staerke einer Ausnahme (§6.4)', () => {
  it('ohne Wert bleibt die Besetzung des Traegers unveraendert', () => {
    expect(besetzungMitAusnahme(WACHE, null)).toStrictEqual({
      sollBesetzung: 2, minBesetzung: 2,
    });
    expect(besetzungMitAusnahme(WACHE, undefined)).toStrictEqual({
      sollBesetzung: 2, minBesetzung: 2,
    });
  });

  it('NULL heisst „unveraendert" und nicht „null Wachen"', () => {
    expect(besetzungMitAusnahme(WACHE, null).sollBesetzung).toBe(2);
  });

  /**
   * O-714 ist offen: ob eine Ausnahme unter die Mindestbesetzung gehen darf,
   * entscheidet der Vertrag. Bis dahin wird das Minimum MITGESENKT — sonst
   * entstuende eine Schicht, die per Konstruktion unterbesetzt ist
   * (`min > soll`) und in `offene-schichten` als Notfall stuende, den niemand
   * beheben kann.
   */
  it('senkt das Minimum mit, statt eine per Konstruktion unterbesetzte Nacht zu erzeugen', () => {
    const r = besetzungMitAusnahme(WACHE, 1);
    expect(r.sollBesetzung).toBe(1);
    expect(r.minBesetzung).toBe(1);
    expect(r.minBesetzung).toBeLessThanOrEqual(r.sollBesetzung);
  });

  it('eine hoehere Ersatzstaerke hebt das Minimum NICHT an', () => {
    const r = besetzungMitAusnahme(WACHE, 5);
    expect(r.sollBesetzung).toBe(5);
    expect(r.minBesetzung).toBe(2);
  });

  it('eine Staerke unter 1 stammt nicht aus dieser Anwendung', () => {
    expect(() => besetzungMitAusnahme(WACHE, 0)).toThrow(PlanungsFehler);
    expect(() => besetzungMitAusnahme(WACHE, 1.5)).toThrow(PlanungsFehler);
  });
});

describe('die Ausnahme wirkt auf die Vorkommnisse — nicht nur in der Tabelle', () => {
  it('eine Verschiebung mit reduzierter Staerke setzt die Besetzung der Nacht', () => {
    const ausnahme: Ausnahme = {
      id: 'a-1', datum: '2026-09-23', art: 'verschiebung',
      ersatzBeginnLokal: '2026-09-23T23:00', dauerMinuten: null, ersatzBesetzung: 1,
    };
    const { einsaetze } = planeVorkommnisse(
      WACHE, [ausnahme], KEINE_FEIERTAGE,
      { vonDatum: '2026-09-23', bisDatum: '2026-09-23' },
    );
    expect(einsaetze).toHaveLength(1);
    expect(einsaetze[0]?.beginnLokal).toBe('23:00');
    expect(einsaetze[0]?.sollBesetzung).toBe(1);
    expect(einsaetze[0]?.minBesetzung).toBe(1);
    // Der Schluessel nennt den URSPRUENGLICHEN Termin: die Verschiebung
    // erzeugt keine zweite Schicht (§8.3).
    expect(einsaetze[0]?.quellSchluessel)
      .toBe(serienSchluessel('ps-1', '2026-09-23', '22:00'));
  });

  it('ein Zusatztermin mit reduzierter Staerke bekommt seinen eigenen Schluessel', () => {
    const ausnahme: Ausnahme = {
      id: 'a-2', datum: '2026-10-03', art: 'zusatz',
      ersatzBeginnLokal: null, dauerMinuten: 240, ersatzBesetzung: 1,
    };
    const { einsaetze } = planeVorkommnisse(
      { ...WACHE, rrule: null, dtstartLokal: { datum: '2026-09-21', stunde: 22, minute: 0 } },
      [ausnahme], KEINE_FEIERTAGE,
      { vonDatum: '2026-10-01', bisDatum: '2026-10-05' },
    );
    const zusatz = einsaetze.find((e) => e.herkunft === 'ausnahme');
    expect(zusatz).toBeDefined();
    expect(zusatz?.quellSchluessel).toBe('ausnahme:a-2');
    expect(zusatz?.sollBesetzung).toBe(1);
    expect(zusatz?.endeLokal).toBe('02:00');
    expect(zusatz?.endetAmFolgetag).toBe(true);
  });

  it('ein Ausfall nimmt die Nacht heraus und MELDET das (§8.4)', () => {
    const ausnahme: Ausnahme = {
      id: 'a-3', datum: '2026-09-24', art: 'ausfall',
      ersatzBeginnLokal: null, dauerMinuten: null, ersatzBesetzung: null,
    };
    const { einsaetze, uebersprungen } = planeVorkommnisse(
      WACHE, [ausnahme], KEINE_FEIERTAGE,
      { vonDatum: '2026-09-24', bisDatum: '2026-09-24' },
    );
    expect(einsaetze).toHaveLength(0);
    expect(uebersprungen).toHaveLength(1);
    expect(uebersprungen[0]?.grund).toBe('ausnahme_ausfall');
  });
});

/**
 * Die vier Pflichtfaelle — auf der WANDUHR, wie es §7.2 verlangt. Der Instant
 * kommt aus Postgres; hier wird geprueft, dass die Ortszeitfelder in jeder
 * der drei Naechte dieselben sind und dass zehn Serien zehn Schluessel geben.
 */
describe('die vier Naechte, die vor jeder Planungsoberflaeche stehen', () => {
  it('Schicht 22:00–06:00: das Ende ist 06:00 am Folgetag', () => {
    const { einsaetze } = planeVorkommnisse(
      WACHE, [], KEINE_FEIERTAGE, { vonDatum: '2026-09-22', bisDatum: '2026-09-22' },
    );
    expect(einsaetze[0]?.beginnLokal).toBe('22:00');
    expect(einsaetze[0]?.endeLokal).toBe('06:00');
    expect(einsaetze[0]?.endetAmFolgetag).toBe(true);
  });

  /**
   * Die Nacht der Umstellung VORWAERTS (28./29. März 2026, 02:00 → 03:00):
   * 22:00 plus 480 nominale Minuten ist 06:00 — dieselbe Wanduhr wie in jeder
   * anderen Nacht. Nur der INSTANTABSTAND ist kuerzer (420 Minuten), und den
   * setzt Postgres. Genau anders herum waere es falsch: 480 VERSTRICHENE
   * Minuten endeten um 07:00, und die Kolonne stuende eine Stunde laenger im
   * Objekt als geschuldet.
   */
  it('Nacht der Umstellung vorwaerts: die Wanduhr bleibt 22:00–06:00', () => {
    /* Eigener Anker: die Serie oben beginnt erst im September, und ein
       Vorkommnis VOR `dtstart` gibt es nicht — der Test haette sonst „nichts
       geplant" gemessen und nicht die Umstellungsnacht. */
    const abJanuar: Bedarfstraeger = {
      ...WACHE, dtstartLokal: { datum: '2026-01-01', stunde: 22, minute: 0 },
    };
    const { einsaetze } = planeVorkommnisse(
      abJanuar, [], KEINE_FEIERTAGE, { vonDatum: '2026-03-28', bisDatum: '2026-03-28' },
    );
    expect(einsaetze).toHaveLength(1);
    expect(einsaetze[0]?.planDatum).toBe('2026-03-28');
    expect(einsaetze[0]?.beginnLokal).toBe('22:00');
    expect(einsaetze[0]?.endeLokal).toBe('06:00');
    expect(einsaetze[0]?.endetAmFolgetag).toBe(true);
  });

  /** Die Nacht RUECKWAERTS (24./25. Oktober 2026): ebenso 22:00–06:00. */
  it('Nacht der Umstellung rueckwaerts: die Wanduhr bleibt 22:00–06:00', () => {
    const { einsaetze } = planeVorkommnisse(
      WACHE, [], KEINE_FEIERTAGE, { vonDatum: '2026-10-24', bisDatum: '2026-10-24' },
    );
    expect(einsaetze).toHaveLength(1);
    expect(einsaetze[0]?.beginnLokal).toBe('22:00');
    expect(einsaetze[0]?.endeLokal).toBe('06:00');
  });

  /**
   * Zehn Schichten mit demselben Startinstant auf EINEM Objekt (TIM-04).
   *
   * Zehn Serien am selben Objekt zur selben Sekunde ergeben zehn
   * SCHLUESSEL und damit zehn sichtbare Zeilen. Ein Schluessel aus
   * `(objekt_id, beginn)` haette sie zu einer verschmolzen — still, und genau
   * in dem Fall, den die Abnahme prueft.
   */
  it('zehn Serien zur selben Sekunde am selben Objekt ergeben zehn Schluessel', () => {
    const schluessel = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      const { einsaetze } = planeVorkommnisse(
        { ...WACHE, planungsserieId: `ps-${String(i)}` }, [], KEINE_FEIERTAGE,
        { vonDatum: '2026-09-22', bisDatum: '2026-09-22' },
      );
      expect(einsaetze).toHaveLength(1);
      schluessel.add(einsaetze[0]!.quellSchluessel);
    }
    expect(schluessel.size).toBe(10);
  });

  it('und auch mit reduzierter Staerke bleiben es zehn', () => {
    const schluessel = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      const ausnahme: Ausnahme = {
        id: `a-${String(i)}`, datum: '2026-09-22', art: 'verschiebung',
        ersatzBeginnLokal: '2026-09-22T22:00', dauerMinuten: null, ersatzBesetzung: 1,
      };
      const { einsaetze } = planeVorkommnisse(
        { ...WACHE, planungsserieId: `ps-${String(i)}` }, [ausnahme], KEINE_FEIERTAGE,
        { vonDatum: '2026-09-22', bisDatum: '2026-09-22' },
      );
      expect(einsaetze[0]?.sollBesetzung).toBe(1);
      schluessel.add(einsaetze[0]!.quellSchluessel);
    }
    expect(schluessel.size).toBe(10);
  });
});

/**
 * `ladeAusnahmen` — die Regression, um die es hier eigentlich geht.
 *
 * Geprueft wird die ABFRAGE, nicht die Datenbank: welche TABELLE liest die
 * Funktion, und kehrt sie bei einer Postenserie ueberhaupt noch vorzeitig
 * zurueck? Das ist mit einem nachgebauten `Abfrage`-Objekt praezise
 * pruefbar und braucht kein Postgres — der Fehler war eine Zeile
 * Kontrollfluss (`if (serie.turnusId === null) return []`), nicht ein
 * Spaltenname.
 */
describe('ladeAusnahmen liest die Tabelle des TRAEGERS', () => {
  interface Aufruf { readonly sql: string; readonly werte: readonly unknown[] }

  function spion(zeilen: readonly Record<string, unknown>[]) {
    const aufrufe: Aufruf[] = [];
    return {
      aufrufe,
      db: {
        unsafe: (sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]> => {
          aufrufe.push({ sql, werte: werte ?? [] });
          return Promise.resolve(zeilen);
        },
      },
    };
  }

  const basis = {
    ...WACHE,
    mandantId: 'm-1',
    objektId: 'o-1',
    kundeId: 'k-1',
    auftragId: null,
    auftragLeistungId: null,
    turnusId: null as string | null,
    postenId: null as string | null,
    veranstaltungId: null as string | null,
    revierId: null as string | null,
    horizontTage: 56,
    feiertagBundesland: 'BE',
    feiertageUeberspringen: false,
  };

  it('eine POSTENSERIE liest posten_ausnahme — und kehrt nicht leer zurueck', async () => {
    const { aufrufe, db } = spion([{
      id: 'a-1', datum: '2026-10-03', art: 'verschiebung',
      ersatz_beginn_lokal: '2026-10-03T23:00', dauer_minuten: 300, ersatz_besetzung: 1,
    }]);
    const ausnahmen = await ladeAusnahmen(
      db, { ...basis, postenId: 'po-1' }, '2026-10-01', '2026-10-31',
    );
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]?.sql).toContain('from posten_ausnahme');
    expect(aufrufe[0]?.sql).toContain('posten_id = $2');
    expect(aufrufe[0]?.sql).toContain('ersatz_besetzung as ersatz_besetzung');
    expect(aufrufe[0]?.werte[1]).toBe('po-1');
    expect(ausnahmen).toHaveLength(1);
    expect(ausnahmen[0]?.ersatzBesetzung).toBe(1);
    expect(ausnahmen[0]?.dauerMinuten).toBe(300);
  });

  it('eine TURNUSSERIE liest turnus_ausnahme, und dort gibt es keine Ersatzstaerke', async () => {
    const { aufrufe, db } = spion([{
      id: 'a-2', datum: '2026-10-03', art: 'ausfall',
      ersatz_beginn_lokal: null, dauer_minuten: null, ersatz_besetzung: null,
    }]);
    const ausnahmen = await ladeAusnahmen(
      db, { ...basis, turnusId: 't-1' }, '2026-10-01', '2026-10-31',
    );
    expect(aufrufe[0]?.sql).toContain('from turnus_ausnahme');
    expect(aufrufe[0]?.sql).toContain('turnus_id = $2');
    // `null::smallint` und nicht die Spalte: `turnus_ausnahme` traegt sie
    // nicht, und eine Abfrage darauf waere ein Laufzeitfehler auf der
    // Reinigungsseite — beim ersten Klick.
    expect(aufrufe[0]?.sql).toContain('null::smallint as ersatz_besetzung');
    expect(ausnahmen[0]?.ersatzBesetzung).toBeNull();
  });

  it('eine VERANSTALTUNG hat keine Ausnahmetabelle — leere Liste, keine Abfrage', async () => {
    const { aufrufe, db } = spion([]);
    const ausnahmen = await ladeAusnahmen(
      db, { ...basis, veranstaltungId: 'va-1' }, '2026-10-01', '2026-10-31',
    );
    expect(ausnahmen).toStrictEqual([]);
    expect(aufrufe).toHaveLength(0);
  });

  it('das Fenster wird als Grenze mitgegeben und nicht hinterher gefiltert', async () => {
    const { aufrufe, db } = spion([]);
    await ladeAusnahmen(db, { ...basis, postenId: 'po-1' }, '2026-10-01', '2026-10-31');
    expect(aufrufe[0]?.sql).toContain('datum between $3::date and $4::date');
    expect(aufrufe[0]?.werte[2]).toBe('2026-10-01');
    expect(aufrufe[0]?.werte[3]).toBe('2026-10-31');
  });
});
