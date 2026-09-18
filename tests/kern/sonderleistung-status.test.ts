/**
 * Der Statuswechsel eines Einzelabrufs — die Regel, die eine Doppelabrechnung
 * verhindert.
 *
 * **Der Befund.** `sonderleistung.status` wird schon heute von Hand GESETZT —
 * bei der Rechnungsuebernahme: `positionsquelle.ts` stempelt `erbracht` →
 * `abgerechnet`, und `einzelabruf.ts` liest ausschliesslich `erbracht` als
 * abrechenbar. Ein frei bedienbares `setzeStatus` koennte einen bereits
 * abgerechneten Abruf zurueck auf `erbracht` stellen; dann waere er ein
 * zweites Mal abrechenbar, und nur der Sperrindex `quelle_sonderleistung_uk`
 * (0112) stuende noch dazwischen. Eine Eindeutigkeitsverletzung ist die
 * schlechteste Art, eine Doppelabrechnung zu erfahren.
 *
 * Deshalb ist die Regel eine Funktion und keine Bedingung in einem Formular —
 * die Oberflaeche fragt dieselbe Funktion, die der Dienst anwendet.
 *
 * **Was hier NICHT geprueft wird, weil es nicht so ist:** eine Reihenfolge.
 * 0067 legt fuer die sechs Werte keinen gerichteten Pfad fest, und ein
 * abgesagter Termin geht von `geplant` zurueck auf `beauftragt`. Eine
 * Reihenfolge zu erfinden waere eine Geschaeftsregel.
 */
import { describe, expect, it } from 'vitest';
import {
  ENDZUSTAENDE, PFLEGBARE_STATUS, SONDERLEISTUNG_STATUS, statuswechsel,
  STATUS_TEXT, type SonderleistungStatus,
} from '@/server/services/reinigung/sonderleistung';

describe('das Vokabular', () => {
  it('sind genau die sechs Werte des Aufzaehlungstyps', () => {
    expect([...SONDERLEISTUNG_STATUS]).toEqual([
      'angefragt', 'beauftragt', 'geplant', 'erbracht', 'abgerechnet', 'storniert',
    ]);
  });

  it('jeder Wert hat einen deutschen Text — die Oberflaeche ist deutsch', () => {
    for (const s of SONDERLEISTUNG_STATUS) {
      expect(STATUS_TEXT[s]).toBeTruthy();
    }
  });

  it('pflegbar ist, was KEIN Endzustand ist und nicht der Rechnungsstempel', () => {
    expect([...PFLEGBARE_STATUS]).toEqual(['angefragt', 'beauftragt', 'geplant', 'erbracht']);
    expect([...ENDZUSTAENDE]).toEqual(['abgerechnet', 'storniert']);
    for (const s of PFLEGBARE_STATUS) {
      expect(ENDZUSTAENDE).not.toContain(s);
    }
  });
});

describe('aus einem Endzustand fuehrt kein Weg zurueck', () => {
  it('abgerechnet bleibt abgerechnet — die Rechnung ist festgeschrieben', () => {
    for (const nach of SONDERLEISTUNG_STATUS) {
      const befund = statuswechsel('abgerechnet', nach);
      expect(befund.erlaubt).toBe(false);
      expect(befund.grund).toBeTruthy();
    }
    // Und der Grund nennt den Weg, den es stattdessen gibt (Invariante 4).
    expect(statuswechsel('abgerechnet', 'erbracht').grund).toMatch(/Storno/u);
  });

  it('storniert wird nicht wiederbelebt — Invariante 8', () => {
    for (const nach of SONDERLEISTUNG_STATUS) {
      expect(statuswechsel('storniert', nach).erlaubt).toBe(false);
    }
    expect(statuswechsel('storniert', 'beauftragt').grund).toMatch(/neuer Abruf/u);
  });
});

describe('„abgerechnet" setzt die Rechnungsuebernahme und nur sie', () => {
  it('von Hand ist es nie erlaubt', () => {
    for (const von of PFLEGBARE_STATUS) {
      const befund = statuswechsel(von, 'abgerechnet');
      expect(befund.erlaubt).toBe(false);
      expect(befund.grund).toMatch(/Rechnungs/u);
    }
  });
});

describe('„storniert" laeuft ueber den Stornoweg, nicht ueber den Status', () => {
  it('weil die Tabelle Grund und Urheber gemeinsam verlangt', () => {
    for (const von of PFLEGBARE_STATUS) {
      const befund = statuswechsel(von, 'storniert');
      expect(befund.erlaubt).toBe(false);
      expect(befund.grund).toMatch(/Grund/u);
    }
  });
});

describe('was erlaubt ist', () => {
  it('jeder Wechsel zwischen den pflegbaren Zustaenden — in beide Richtungen', () => {
    /*
     * Auch RUECKWAERTS: ein abgesagter Termin geht von `geplant` zurueck auf
     * `beauftragt`. Eine gerichtete Kette waere bequem und falsch.
     */
    const paare: readonly [SonderleistungStatus, SonderleistungStatus][] = [
      ['angefragt', 'beauftragt'],
      ['beauftragt', 'geplant'],
      ['geplant', 'erbracht'],
      ['geplant', 'beauftragt'],
      ['erbracht', 'geplant'],
      ['beauftragt', 'angefragt'],
    ];
    for (const [von, nach] of paare) {
      const befund = statuswechsel(von, nach);
      expect(befund.erlaubt, `${von} → ${nach}`).toBe(true);
      expect(befund.grund).toBeNull();
    }
  });

  it('derselbe Zustand ist kein Wechsel und sagt es', () => {
    for (const s of PFLEGBARE_STATUS) {
      const befund = statuswechsel(s, s);
      expect(befund.erlaubt).toBe(false);
      expect(befund.grund).toContain(STATUS_TEXT[s]);
    }
  });
});

describe('die Gegenprobe zur Oberflaeche', () => {
  it('ein Abruf in einem Endzustand hat KEINEN pflegbaren Wechsel', () => {
    /*
     * Genau diese Rechnung macht die Seite, um die Auswahlliste zu fuellen.
     * Waere sie hier anders als dort, boete die Oberflaeche einen Wechsel an,
     * den der Dienst gleich darauf ablehnt.
     */
    for (const von of ENDZUSTAENDE) {
      const moeglich = PFLEGBARE_STATUS.filter((s) => statuswechsel(von, s).erlaubt);
      expect(moeglich).toHaveLength(0);
    }
  });

  it('ein erbrachter Abruf hat genau drei pflegbare Wechsel', () => {
    const moeglich = PFLEGBARE_STATUS.filter((s) => statuswechsel('erbracht', s).erlaubt);
    expect(moeglich).toEqual(['angefragt', 'beauftragt', 'geplant']);
  });
});
