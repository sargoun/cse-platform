/**
 * Der Regelbauer eines Turnus und seine Lesbarkeit — ohne Datenbank.
 *
 * **Der Befund, der diese Datei gebracht hat.** `wochenRegel` baute
 * ausschliesslich `FREQ=WEEKLY;BYDAY=…`. Der Seed fuehrt aber seit dem ersten
 * Tag `FREQ=MONTHLY;BYMONTHDAY=15`, und `leseRegel` versteht MONTHLY ebenso
 * lange: ein monatlicher Turnus liess sich LESEN, aber nicht ANLEGEN. Die
 * Seitenkarte verlangt fuer `/reinigung/turnus/neu` einen RRULE-Bauer nach
 * RFC 5545 — der Zweig gehoert in den Dienst, nicht ins Formular, sonst gibt
 * es zwei Stellen, die eine Regel zusammensetzen, und die zweite ist
 * ungetestet.
 *
 * Zweiter Befund: zwei Grenzen fuer dasselbe Feld. `pruefeTurnusEingabe`
 * liess bis 1440 Minuten zu, `nominalesEnde` bis 1439. Ein Turnus mit genau
 * 1440 liess sich anlegen und brachte danach jede Nacht den Generator zum
 * Stehen.
 */
import { describe, expect, it } from 'vitest';
import {
  monatsRegel, SerieEingabeFehlt, turnusRegel, wochenRegel,
} from '@/server/services/dienstplan/serie';
import { MAX_DAUER_MINUTEN } from '@/server/services/dienstplan/vorkommnisse';
import { leseRegel } from '@/lib/datum/rrule';
import { lesbareRegel, regelFehler } from '@/lib/datum/regeltext';

describe('monatsRegel', () => {
  it('ordnet, entdoppelt und liefert, was der Parser liest', () => {
    expect(monatsRegel([15])).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(monatsRegel([15, 1, 15])).toBe('FREQ=MONTHLY;BYMONTHDAY=1,15');
    const r = leseRegel(monatsRegel([1, 15]));
    expect(r.freq).toBe('MONTHLY');
    expect(r.bymonthday).toEqual([1, 15]);
  });

  it('nimmt den 29. bis 31. an und deutet sie NICHT um', () => {
    /*
     * RFC 5545 laesst den Monat ohne diesen Tag einfach aus, und die
     * Entfaltung tut dasselbe. Auf „letzter Tag des Monats" zu verschieben
     * waere eine erfundene Geschaeftsregel — `BYMONTHDAY=-1` waere ihre
     * Schreibweise, und die weist `leseRegel` ausdruecklich ab.
     */
    expect(monatsRegel([31])).toBe('FREQ=MONTHLY;BYMONTHDAY=31');
    expect(() => leseRegel('FREQ=MONTHLY;BYMONTHDAY=-1')).toThrow();
  });

  it('weist Unbekanntes und Leeres ab', () => {
    expect(() => monatsRegel([])).toThrow(SerieEingabeFehlt);
    expect(() => monatsRegel([0])).toThrow(/kein Monatstag/u);
    expect(() => monatsRegel([32])).toThrow(/kein Monatstag/u);
    expect(() => monatsRegel([1.5])).toThrow(/kein Monatstag/u);
  });
});

describe('das Intervall', () => {
  it('bleibt bei 1 weg und steht sonst in der Regel', () => {
    expect(wochenRegel(['MO'], 1)).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(wochenRegel(['MO'], 2)).toBe('FREQ=WEEKLY;BYDAY=MO;INTERVAL=2');
    expect(monatsRegel([15], 3)).toBe('FREQ=MONTHLY;BYMONTHDAY=15;INTERVAL=3');
    expect(leseRegel(wochenRegel(['MO'], 2)).interval).toBe(2);
  });

  it('weist Unsinn ab, statt ihn auf 1 zu runden', () => {
    expect(() => wochenRegel(['MO'], 0)).toThrow(SerieEingabeFehlt);
    expect(() => wochenRegel(['MO'], 53)).toThrow(SerieEingabeFehlt);
    expect(() => monatsRegel([1], 1.5)).toThrow(SerieEingabeFehlt);
  });
});

describe('turnusRegel — EIN Einstieg fuer beide Frequenzen', () => {
  it('waehlt nach der Frequenz die richtige Liste', () => {
    expect(turnusRegel({ frequenz: 'woechentlich', wochentage: ['MO', 'WE'] }))
      .toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(turnusRegel({ frequenz: 'monatlich', wochentage: [], monatstage: [15] }))
      .toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });

  it('ohne Frequenz ist es woechentlich — der Weg, den api/dienstplan/serien geht', () => {
    expect(turnusRegel({ wochentage: ['FR'] })).toBe('FREQ=WEEKLY;BYDAY=FR');
  });

  it('monatlich ohne Monatstag ist ein Fehler, keine Auslassung', () => {
    expect(() => turnusRegel({ frequenz: 'monatlich', wochentage: ['MO'] }))
      .toThrow(/Monatstag/u);
  });
});

describe('die EINE Dauergrenze', () => {
  it('MAX_DAUER_MINUTEN ist 1439 — eine Schicht ist kuerzer als ein Tag', () => {
    expect(MAX_DAUER_MINUTEN).toBe(24 * 60 - 1);
  });
});

describe('lesbareRegel — dieselbe Auslegung wie der Generator', () => {
  it('setzt Wochen-, Monats- und Tagesregeln in einen Satz', () => {
    expect(lesbareRegel('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('jede Woche · Mo, Mi, Fr');
    expect(lesbareRegel('FREQ=WEEKLY;BYDAY=MO;INTERVAL=2')).toBe('jede 2. Woche · Mo');
    expect(lesbareRegel('FREQ=MONTHLY;BYMONTHDAY=15')).toBe('jeden Monat · 15.');
    expect(lesbareRegel('FREQ=DAILY')).toBe('täglich');
    expect(lesbareRegel('FREQ=DAILY;INTERVAL=3')).toBe('jeden 3. Tag');
  });

  it('zeigt eine unlesbare Regel als ROHTEXT, statt sie zu raten', () => {
    /*
     * Eine erfundene Zusammenfassung waere schlimmer als die Regel selbst:
     * `BYSETPOS` meint „einmal pro Woche, am ersten dieser Tage" — ohne ihn
     * entstehen drei Schichten statt einer, und beide Anzeigen saehen richtig
     * aus.
     */
    const kaputt = 'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYSETPOS=1';
    expect(lesbareRegel(kaputt)).toBe(kaputt);
    expect(regelFehler(kaputt)).toMatch(/BYSETPOS/u);
  });

  it('regelFehler sagt NULL, wenn die Regel lesbar ist', () => {
    expect(regelFehler('FREQ=WEEKLY;BYDAY=MO')).toBeNull();
    expect(regelFehler('FREQ=MONTHLY;BYMONTHDAY=1,15')).toBeNull();
  });

  it('eine Regel mit Anker wird abgewiesen — der Anker steht in der Spalte', () => {
    expect(regelFehler('RRULE:FREQ=WEEKLY;BYDAY=MO')).toMatch(/RRULE:/u);
  });
});
