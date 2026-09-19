/**
 * Arbeitszeitmodell und Tarifvereinbarung — die reinen Rechenstuecke
 * (EMP-04, TIM-06, TIM-14, LEG-03, O-18, O-50).
 *
 * **Drei Zusicherungen, und jede hat eine Lohn- oder Rechtsfolge:**
 *
 *  - **Ein Tarifvertrag kann die ArbZG-Grenzen nur ANHEBEN.** Ein
 *    schwaecherer Wert wuerde still wirken: `pruefeArbzg` faende dann keinen
 *    Verstoss mehr, wo einer ist. Die Vergleichswerte kommen aus `arbzg.ts`,
 *    also aus der Datei, die auch prueft — eine zweite Liste ginge irgendwann
 *    auseinander, und die falsche saehe richtig aus.
 *  - **Stunden werden als TEXT umgeformt, nie durch eine Gleitkommazahl.**
 *    `39,5` muss `39.500` werden, ohne `Number` zu beruehren (K-16).
 *  - **Die Sollzeitregel antwortet `null`, solange O-18 offen ist** — und ein
 *    hinterlegter, aber nicht gebauter Regelname muss seinen NAMEN in die
 *    Meldung tragen, sonst sucht jemand den Fehler in der Datenbank.
 */
import { describe, expect, it } from 'vitest';
import {
  PAUSE_AB_6H, PAUSE_AB_9H, RUHEZEIT_MINUTEN,
} from '../../src/server/services/zeit/arbzg.js';
import {
  ArbeitszeitFehler, GESETZ, GEWERKE, GEWERK_TEXT, UEBERTRAG_ARTEN, alsMengeText,
  istUebertragArt, pruefeTarifRegel, regelFuerModell, strengerAlsGesetz,
  type TarifEingabe,
} from '../../src/server/services/zeit/arbeitszeitmodell.js';
import {
  SOLLSTUNDEN_OFFEN, SollstundenOffenFehler, sollMinutenOderFehler,
} from '../../src/server/services/zeit/sollstunden.js';

function tarif(o: Partial<TarifEingabe>): TarifEingabe {
  return {
    gewerk: 'reinigung',
    bezeichnung: 'RTV Gebäudereinigung',
    fundstelle: '§ 5 RTV',
    pauseAb6hMinuten: null,
    pauseAb9hMinuten: null,
    ruhezeitMinuten: null,
    giltAb: '2026-10-01',
    bestaetigt: false,
    ...o,
  };
}

describe('GESETZ', () => {
  it('ist dieselbe Quelle wie die Pruefung — keine zweite Liste', () => {
    expect(GESETZ.pause6h).toBe(PAUSE_AB_6H);
    expect(GESETZ.pause9h).toBe(PAUSE_AB_9H);
    expect(GESETZ.ruhezeit).toBe(RUHEZEIT_MINUTEN);
  });

  it('nennt die Werte des ArbZG: 30 / 45 Minuten Pause, 11 Stunden Ruhezeit', () => {
    expect(GESETZ.pause6h).toBe(30);
    expect(GESETZ.pause9h).toBe(45);
    expect(GESETZ.ruhezeit).toBe(11 * 60);
  });
});

describe('pruefeTarifRegel', () => {
  it('nimmt an, was gleich oder strenger ist', () => {
    expect(() => pruefeTarifRegel(tarif({
      pauseAb6hMinuten: 30, pauseAb9hMinuten: 45, ruhezeitMinuten: 660,
    }))).not.toThrow();
    expect(() => pruefeTarifRegel(tarif({
      pauseAb6hMinuten: 45, pauseAb9hMinuten: 60, ruhezeitMinuten: 720,
    }))).not.toThrow();
  });

  it('nimmt leere Felder an — „der Tarif sagt dazu nichts"', () => {
    expect(() => pruefeTarifRegel(tarif({}))).not.toThrow();
  });

  it('weist jeden schwaecheren Wert ab und nennt ihn', () => {
    for (const [feld, wert] of [
      ['pauseAb6hMinuten', 29], ['pauseAb9hMinuten', 44], ['ruhezeitMinuten', 659],
    ] as const) {
      let gefangen: unknown = null;
      try {
        pruefeTarifRegel(tarif({ [feld]: wert }));
      } catch (f: unknown) {
        gefangen = f;
      }
      expect(gefangen, feld).toBeInstanceOf(ArbeitszeitFehler);
      expect((gefangen as ArbeitszeitFehler).grund, feld).toBe('schwaecher_als_gesetz');
      /* Die Meldung nennt den Wert, damit niemand raten muss, welcher gemeint ist. */
      expect((gefangen as ArbeitszeitFehler).message, feld).toContain(String(wert));
    }
  });

  it('nennt ALLE zu schwachen Werte in einer Meldung, nicht nur den ersten', () => {
    try {
      pruefeTarifRegel(tarif({
        pauseAb6hMinuten: 10, pauseAb9hMinuten: 20, ruhezeitMinuten: 30,
      }));
      expect.unreachable('haette werfen muessen');
    } catch (f: unknown) {
      const m = (f as ArbeitszeitFehler).message;
      expect(m).toContain('Pause ab 6 h');
      expect(m).toContain('Pause ab 9 h');
      expect(m).toContain('Ruhezeit');
    }
  });

  it('die 9-Stunden-Pause kann nicht kuerzer sein als die ab 6 Stunden', () => {
    /* Beide ueber dem Gesetz, aber falsch geordnet: 60 min ab 6 h, 45 ab 9 h. */
    expect(() => pruefeTarifRegel(tarif({
      pauseAb6hMinuten: 60, pauseAb9hMinuten: 45,
    }))).toThrowError(ArbeitszeitFehler);
  });
});

describe('strengerAlsGesetz', () => {
  it('eine Regel, die dem Gesetz gleicht, wirkt nicht', () => {
    expect(strengerAlsGesetz({
      pauseAb6hMinuten: 30, pauseAb9hMinuten: 45, ruhezeitMinuten: 660,
    })).toBe(false);
    expect(strengerAlsGesetz({
      pauseAb6hMinuten: null, pauseAb9hMinuten: null, ruhezeitMinuten: null,
    })).toBe(false);
  });

  it('ein einziger strengerer Wert genuegt', () => {
    expect(strengerAlsGesetz({
      pauseAb6hMinuten: 31, pauseAb9hMinuten: null, ruhezeitMinuten: null,
    })).toBe(true);
    expect(strengerAlsGesetz({
      pauseAb6hMinuten: null, pauseAb9hMinuten: null, ruhezeitMinuten: 661,
    })).toBe(true);
  });
});

describe('alsMengeText', () => {
  it('macht aus der Eingabe drei Nachkommastellen — ohne Gleitkommazahl', () => {
    expect(alsMengeText('39')).toBe('39.000');
    expect(alsMengeText('39,5')).toBe('39.500');
    expect(alsMengeText('38.75')).toBe('38.750');
    expect(alsMengeText('5')).toBe('5.000');
    expect(alsMengeText(' 40 ')).toBe('40.000');
  });

  it('weist ab, was keine Stundenzahl ist', () => {
    for (const roh of ['', 'viel', '39,5555', '1e3', '-5', '39.5.5', '1234']) {
      expect(() => alsMengeText(roh), roh).toThrowError(ArbeitszeitFehler);
    }
  });
});

describe('regelFuerModell', () => {
  it('„offen" ist die ausgelieferte Regel: sie antwortet null', () => {
    const regel = regelFuerModell({ schluessel: 'vollzeit', sollzeitregel: 'offen' });
    expect(regel).toBe(SOLLSTUNDEN_OFFEN);
    expect(regel.sollMinuten({
      anstellungId: 'a1', jahr: 2026, monat: 3, wochenstunden: null,
      arbeitszeitmodell: 'vollzeit',
    })).toBeNull();
  });

  it('ein benannter, aber nicht gebauter Regelname traegt seinen NAMEN', () => {
    const regel = regelFuerModell({
      schluessel: 'vollzeit', sollzeitregel: 'monatsdurchschnitt',
    });
    expect(regel.schluessel).toContain('monatsdurchschnitt');
    expect(regel.schluessel).toContain('nicht gebaut');
  });

  it('keine Regel liefert je eine Zahl — es gibt keine Ersatzformel', () => {
    for (const name of ['offen', 'monatsdurchschnitt', 'ausgleichszeitraum']) {
      const regel = regelFuerModell({ schluessel: 'x', sollzeitregel: name });
      expect(regel.sollMinuten({
        anstellungId: 'a1', jahr: 2026, monat: 3, wochenstunden: 39_000n as never,
        arbeitszeitmodell: 'x',
      }), name).toBeNull();
    }
  });

  it('sollMinutenOderFehler wirft statt 0 zurueckzugeben', () => {
    /*
     * Eine Null waere die gefaehrlichste Antwort von allen:
     * `saldo = vortrag + ist - soll` machte damit jede geleistete Minute zur
     * Ueberstunde — jeden Monat, jahrelang, plausibel.
     */
    expect(() => sollMinutenOderFehler(
      regelFuerModell({ schluessel: 'x', sollzeitregel: 'offen' }),
      { anstellungId: 'a1', jahr: 2026, monat: 3, wochenstunden: null,
        arbeitszeitmodell: 'x' },
    )).toThrowError(SollstundenOffenFehler);
  });
});

describe('UEBERTRAG_ARTEN', () => {
  /*
   * Solange O-18 offen ist, gibt es genau EINEN Wert. Vorher stand an dieser
   * Stelle ein Freitextfeld: „verfalen" liess sich speichern und sah in der
   * Tabelle danach aus wie eine hinterlegte Uebertragsregel — mit Lohnfolge.
   * Ein offener Punkt gehoert hinter einen benannten Platzhalter, nicht in
   * ein Textfeld (CLAUDE.md, „Never invent a business rule").
   */
  it('ist eine geschlossene Menge mit genau „offen"', () => {
    expect([...UEBERTRAG_ARTEN]).toEqual(['offen']);
  });

  it('nimmt nur, was in der Menge steht', () => {
    expect(istUebertragArt('offen')).toBe(true);
    expect(istUebertragArt('verfalen')).toBe(false);
    expect(istUebertragArt('verfall')).toBe(false);
    expect(istUebertragArt('')).toBe(false);
    expect(istUebertragArt('OFFEN')).toBe(false);
  });
});

describe('Gewerke', () => {
  it('die drei Gewerke aus CLAUDE.md, jedes mit deutschem Namen', () => {
    expect([...GEWERKE]).toEqual(['reinigung', 'security', 'bau']);
    for (const g of GEWERKE) expect(GEWERK_TEXT[g], g).toBeTruthy();
  });
});
