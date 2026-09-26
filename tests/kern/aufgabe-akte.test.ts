/**
 * Die Aufgaben auf dem Blatt eines Auftrags oder Bau-Projekts (OPS-11, V-176,
 * D-670, Invariante 2).
 *
 * **Was hier festgehalten wird.** Das Blatt zeigt eine Zahl („3 offen"), eine
 * zweite („1 überfällig") und je Zeile eine Frist in Worten. Alle drei sind
 * Regeln und keine Darstellung:
 *
 *  · Die Kopfzahl kommt aus der ZÄHLUNG über denselben Filter, nicht aus der
 *    Liste — die Liste zeigt höchstens zehn, die Zahl zählt alle.
 *  · Überfällig ist nur, was noch OFFEN ist. Eine erledigte Aufgabe mit alter
 *    Frist ist fertig, nicht zu spät.
 *  · Die Frist steht in Berliner Zeit, `TT.MM.JJJJ` — auch in beiden
 *    Umstellungsnächten und auch dann, wenn der UTC-Tag schon ein anderer ist.
 */
import { describe, expect, it } from 'vitest';
import {
  AUFGABEN_JE_BLATT, aufgabenAkte, fristInWorten, type AufgabeStatus, type AufgabeZeile,
} from '../../src/server/services/kern/aufgabe.js';

function zeile(
  id: string, status: AufgabeStatus,
  frist: { faelligAm?: Date | null; faelligDatum?: string | null } = {},
): AufgabeZeile {
  return {
    id, titel: `Aufgabe ${id}`, status, prioritaet: 'normal',
    faelligAm: frist.faelligAm ?? null, faelligDatum: frist.faelligDatum ?? null,
    zugewiesenAn: null, team: null, quelle: 'mensch', quelleJob: null, bezug: null,
  };
}

/** Ein Mittwochmittag im Sommer, in UTC ausgeschrieben. */
const JETZT = new Date('2026-07-01T10:00:00Z');

describe('(1) die Frist in Worten — Europe/Berlin, TT.MM.JJJJ', () => {
  it('ein Tag bleibt ein Tag: 2026-03-29 wird 29.03.2026, ohne über ein Date zu gehen', () => {
    expect(fristInWorten({ faelligAm: null, faelligDatum: '2026-03-29' })).toBe('29.03.2026');
  });

  it('ohne Frist gibt es keinen Text — das Blatt sagt „ohne Frist" in seiner Sprache', () => {
    expect(fristInWorten({ faelligAm: null, faelligDatum: null })).toBeNull();
  });

  it('ein Zeitpunkt trägt die Berliner Uhrzeit — auch wenn der UTC-Tag noch der alte ist', () => {
    // 22:30 UTC am 30.06. ist in Berlin (Sommerzeit) schon der 01.07., 00:30.
    expect(fristInWorten({ faelligAm: new Date('2026-06-30T22:30:00Z'), faelligDatum: null }))
      .toBe('01.07.2026, 00:30');
  });

  it('die Frühjahrsnacht: 00:30 UTC ist 01:30 MEZ, 01:30 UTC schon 03:30 MESZ', () => {
    expect(fristInWorten({ faelligAm: new Date('2026-03-29T00:30:00Z'), faelligDatum: null }))
      .toBe('29.03.2026, 01:30');
    expect(fristInWorten({ faelligAm: new Date('2026-03-29T01:30:00Z'), faelligDatum: null }))
      .toBe('29.03.2026, 03:30');
  });

  it('die Herbstnacht: zwei verschiedene Zeitpunkte heissen beide 02:30', () => {
    // Der Text ist die Wanduhr; die Reihenfolge der Liste bleibt die der Instants.
    expect(fristInWorten({ faelligAm: new Date('2026-10-25T00:30:00Z'), faelligDatum: null }))
      .toBe('25.10.2026, 02:30');
    expect(fristInWorten({ faelligAm: new Date('2026-10-25T01:30:00Z'), faelligDatum: null }))
      .toBe('25.10.2026, 02:30');
  });

  it('sind beide gesetzt, gewinnt der Zeitpunkt — dieselbe Regel wie `fristlage`', () => {
    expect(fristInWorten({
      faelligAm: new Date('2026-07-02T08:00:00Z'), faelligDatum: '2026-12-24',
    })).toBe('02.07.2026, 10:00');
  });
});

describe('(2) die Kopfzahl kommt aus der Zählung, die Liste zeigt nur Offenes', () => {
  it('„offen" zählt offen, in Arbeit und wartend — aus jeZustand, nicht aus den Zeilen', () => {
    const akte = aufgabenAkte(
      [zeile('a', 'offen')],
      { offen: 4, in_arbeit: 2, wartend: 1, erledigt: 5, abgebrochen: 1 },
      JETZT);
    expect(akte.offen).toBe(7);
    expect(akte.geschlossen).toBe(6);
    expect(akte.zeilen.map((z) => z.zeile.id)).toEqual(['a']);
  });

  it('erledigte und abgebrochene Zeilen erscheinen nicht, auch wenn sie mitkommen', () => {
    const akte = aufgabenAkte(
      [zeile('a', 'offen'), zeile('b', 'erledigt'), zeile('c', 'abgebrochen'),
        zeile('d', 'wartend')],
      { offen: 1, wartend: 1, erledigt: 1, abgebrochen: 1 },
      JETZT);
    expect(akte.zeilen.map((z) => z.zeile.id)).toEqual(['a', 'd']);
  });

  it('eine fehlende oder unbrauchbare Zahl ist null, nicht NaN', () => {
    const akte = aufgabenAkte([], { offen: Number.NaN }, JETZT);
    expect(akte.offen).toBe(0);
    expect(akte.geschlossen).toBe(0);
    expect(akte.weitere).toBe(0);
  });
});

describe('(3) überfällig ist nur, was noch offen ist', () => {
  it('eine erledigte Aufgabe mit alter Frist ist fertig, nicht zu spät', () => {
    const akte = aufgabenAkte(
      [
        zeile('gestern', 'offen', { faelligDatum: '2026-06-30' }),
        zeile('erledigt', 'erledigt', { faelligDatum: '2026-01-15' }),
        zeile('heute', 'in_arbeit', { faelligDatum: '2026-07-01' }),
        zeile('morgen', 'wartend', { faelligDatum: '2026-07-02' }),
      ],
      { offen: 1, in_arbeit: 1, wartend: 1, erledigt: 1 },
      JETZT);
    expect(akte.ueberfaellig).toBe(1);
    expect(akte.zeilen.map((z) => [z.zeile.id, z.lage, z.frist])).toEqual([
      ['gestern', 'ueberfaellig', '30.06.2026'],
      ['heute', 'heute', '01.07.2026'],
      ['morgen', 'demnaechst', '02.07.2026'],
    ]);
  });

  it('ein Tag ist bis 24:00 Berliner Zeit nicht überfällig — auch um 23:30', () => {
    // 21:30 UTC am 01.07. ist 23:30 in Berlin: derselbe Tag, noch „heute".
    const akte = aufgabenAkte(
      [zeile('x', 'offen', { faelligDatum: '2026-07-01' })], { offen: 1 },
      new Date('2026-07-01T21:30:00Z'));
    expect(akte.ueberfaellig).toBe(0);
    expect(akte.zeilen[0]?.lage).toBe('heute');
  });

  it('die überfälligen zählen auch jenseits der Anzeigegrenze', () => {
    const viele = Array.from({ length: 12 }, (_, i) =>
      zeile(`u${String(i)}`, 'offen', { faelligDatum: '2026-06-01' }));
    const akte = aufgabenAkte(viele, { offen: 12 }, JETZT);
    expect(akte.ueberfaellig).toBe(12);
    expect(akte.zeilen).toHaveLength(AUFGABEN_JE_BLATT);
    expect(akte.weitere).toBe(12 - AUFGABEN_JE_BLATT);
  });
});

describe('(4) die Anzeigegrenze ist eine Grenze und keine Auswahl', () => {
  it('die Reihenfolge der Liste bleibt — die ersten zehn sind die mit der nächsten Frist', () => {
    const zeilen = Array.from({ length: 11 }, (_, i) => zeile(`z${String(i)}`, 'offen'));
    const akte = aufgabenAkte(zeilen, { offen: 11 }, JETZT);
    expect(akte.zeilen.map((z) => z.zeile.id)).toEqual(
      zeilen.slice(0, AUFGABEN_JE_BLATT).map((z) => z.id));
    expect(akte.weitere).toBe(1);
  });

  it('eine eigene Grenze gilt, und eine negative zeigt nichts statt alles', () => {
    const zeilen = [zeile('a', 'offen'), zeile('b', 'offen'), zeile('c', 'offen')];
    expect(aufgabenAkte(zeilen, { offen: 3 }, JETZT, 2).weitere).toBe(1);
    const nichts = aufgabenAkte(zeilen, { offen: 3 }, JETZT, -1);
    expect(nichts.zeilen).toHaveLength(0);
    expect(nichts.weitere).toBe(3);
  });
});
