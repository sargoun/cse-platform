/**
 * PR 36 — der Monatsanteil und die § 17-Aufzeichnung, ohne Datenbank.
 *
 * Hier steht der Teil, der auch ohne Postgres falsch sein kann: die
 * Pausenverteilung, die Gegenprobe der Anteile gegen `splitteNachMonat` und
 * die kanonische Form, ueber die der Digest des Artefakts laeuft. Der
 * Datenbankteil — die Sicht, die Sperren, die Fremdschluessel — steht in
 * `tests/isolation/zeit-auftrag.test.ts`.
 *
 * Die Monatsgrenzen sind hier ueberall BERLINER Mitternachte, in Zeitpunkte
 * umgerechnet. Der Runner laeuft in `TZ=UTC`, damit kein Fall gruen wird,
 * weil die Maschine zufaellig in Europe/Berlin steht.
 */
import { describe, expect, it } from 'vitest';
import {
  monatsBeginnInstant, monatsErster, pruefeAnteileGegenSchicht, verteilePauseAufAnteile,
} from '../../src/server/services/zeit/monatsanteil.js';
import { kanonischeZeilen, nachweisHash, type MiLoGZeile }
  from '../../src/server/services/zeit/milog.js';
import { dauerMinuten, splitteNachMonat, ZeitFehler }
  from '../../src/server/services/zeit/dauer.js';

const D = (iso: string): Date => new Date(iso);

/**
 * Die drei Faelle, an denen sich die Monatsgrenze entscheidet.
 *
 * `oktober` und `maerz` liegen NACH der jeweiligen Zeitumstellung 2026
 * (25.10. und 29.03.) — die Grenze liegt deshalb einmal bei 23:00Z (CET) und
 * einmal bei 22:00Z (CEST). Wer einen festen Versatz einbaut, bekommt genau
 * einen der beiden Faelle richtig und merkt es ein halbes Jahr lang nicht.
 */
const GRENZEN = [
  {
    name: 'Oktober → November (CET, Grenze 23:00Z)',
    von: '2026-10-31T21:00:00Z', bis: '2026-11-01T05:00:00Z',
    teile: [{ monat: '2026-10-01', minuten: 120 }, { monat: '2026-11-01', minuten: 360 }],
  },
  {
    name: 'März → April (CEST, Grenze 22:00Z)',
    von: '2026-03-31T20:00:00Z', bis: '2026-04-01T04:00:00Z',
    teile: [{ monat: '2026-03-01', minuten: 120 }, { monat: '2026-04-01', minuten: 360 }],
  },
  {
    name: 'Januar → Februar (K-11 wörtlich)',
    von: '2026-01-31T21:00:00Z', bis: '2026-02-01T05:00:00Z',
    teile: [{ monat: '2026-01-01', minuten: 120 }, { monat: '2026-02-01', minuten: 360 }],
  },
] as const;

describe('(2) die Monatsgrenze ist eine Berliner Mitternacht, kein UTC-Mitternacht', () => {
  for (const f of GRENZEN) {
    it(`${f.name} teilt 120/360 und summiert auf 480`, () => {
      const anteile = splitteNachMonat(D(f.von), D(f.bis)).map((a) => ({
        monat: monatsErster(a.jahr, a.monat), bruttoMinuten: a.minuten,
      }));
      expect(anteile).toEqual(
        f.teile.map((t) => ({ monat: t.monat, bruttoMinuten: t.minuten })),
      );
      // Die Summe ist die Schicht — auf die Minute, nicht ungefaehr.
      expect(anteile.reduce((s, a) => s + a.bruttoMinuten, 0))
        .toBe(dauerMinuten(D(f.von), D(f.bis)));
      // Und ein UTC-Mitternacht-Split gaebe 180/300: ausdruecklich NICHT das.
      expect(anteile[0]?.bruttoMinuten).not.toBe(180);
    });
  }

  it('der Monatsbeginn ist der Zeitpunkt der Berliner Mitternacht', () => {
    // CET: 01.11. 00:00 Berlin = 31.10. 23:00Z.
    expect(monatsBeginnInstant('2026-11-01').toISOString()).toBe('2026-10-31T23:00:00.000Z');
    // CEST: 01.04. 00:00 Berlin = 31.03. 22:00Z.
    expect(monatsBeginnInstant('2026-04-01').toISOString()).toBe('2026-03-31T22:00:00.000Z');
  });

  it('und er weist alles zurück, was kein Monatserster ist', () => {
    expect(() => monatsBeginnInstant('2026-11-02')).toThrow(ZeitFehler);
    expect(() => monatsBeginnInstant('2026-11')).toThrow(ZeitFehler);
    expect(() => monatsErster(2026, 13)).toThrow(ZeitFehler);
  });
});

describe('die Pause wird verteilt, nie je Anteil gerundet (§7.4)', () => {
  it('30 Minuten Pause auf 120/360 ergeben 8/22 — und zusammen wieder 30', () => {
    const verteilt = verteilePauseAufAnteile(
      [{ monat: '2026-10-01', bruttoMinuten: 120 }, { monat: '2026-11-01', bruttoMinuten: 360 }],
      480, 30,
    );
    expect(verteilt.map((v) => v.pauseMinuten)).toEqual([8, 22]);
    expect(verteilt.reduce((s, v) => s + v.pauseMinuten, 0)).toBe(30);
    // Und netto ergibt die Summe wieder die Schicht minus Pause.
    expect(verteilt.reduce((s, v) => s + v.nettoMinuten, 0)).toBe(450);
  });

  it('ein ungerader Rest geht an den groessten Anteil, nicht verloren', () => {
    // 3 Anteile, 1 Minute Pause: genau eine Zeile bekommt sie.
    const verteilt = verteilePauseAufAnteile(
      [
        { monat: '2026-01-01', bruttoMinuten: 100 },
        { monat: '2026-02-01', bruttoMinuten: 100 },
        { monat: '2026-03-01', bruttoMinuten: 100 },
      ],
      300, 1,
    );
    expect(verteilt.reduce((s, v) => s + v.pauseMinuten, 0)).toBe(1);
  });

  it('eine Verteilung über eine unvollständige Teilmenge wirft', () => {
    // Der Fehler, der sonst lautlos passiert: nur den Anteil des gefragten
    // Monats laden und die GANZE Pause darauf verteilen.
    expect(() => verteilePauseAufAnteile(
      [{ monat: '2026-10-01', bruttoMinuten: 120 }], 480, 30,
    )).toThrow(ZeitFehler);
  });

  it('und eine Pause, die länger ist als die Schicht, ebenfalls', () => {
    expect(() => verteilePauseAufAnteile(
      [{ monat: '2026-10-01', bruttoMinuten: 60 }], 60, 90,
    )).toThrow(ZeitFehler);
  });
});

describe('die Gegenprobe hält die Sicht gegen die Rechnung (§7.3)', () => {
  it('stimmige Anteile passieren', () => {
    expect(() => pruefeAnteileGegenSchicht(
      [{ monat: '2026-10-01', bruttoMinuten: 120 }, { monat: '2026-11-01', bruttoMinuten: 360 }],
      D('2026-10-31T21:00:00Z'), D('2026-11-01T05:00:00Z'),
    )).not.toThrow();
  });

  it('ein UTC-Mitternacht-Split fällt auf', () => {
    // Genau die Zahlen, die entstehen, wenn jemand bei 00:00Z teilt.
    expect(() => pruefeAnteileGegenSchicht(
      [{ monat: '2026-10-01', bruttoMinuten: 180 }, { monat: '2026-11-01', bruttoMinuten: 300 }],
      D('2026-10-31T21:00:00Z'), D('2026-11-01T05:00:00Z'),
    )).toThrow(ZeitFehler);
  });

  it('ein fehlender Anteil ebenfalls', () => {
    expect(() => pruefeAnteileGegenSchicht(
      [{ monat: '2026-10-01', bruttoMinuten: 120 }],
      D('2026-10-31T21:00:00Z'), D('2026-11-01T05:00:00Z'),
    )).toThrow(ZeitFehler);
  });
});

const ZEILE: MiLoGZeile = {
  zeiteintragId: '11111111-1111-4111-8111-111111111111',
  kalendertag: '2026-10-31',
  beginn: '2026-10-31T21:00:00.000Z',
  ende: '2026-11-01T05:00:00.000Z',
  pauseMinuten: 30,
  bruttoMinuten: 480,
  nettoMinuten: 450,
  anteilBeginn: '2026-10-31T21:00:00.000Z',
  anteilEnde: '2026-10-31T23:00:00.000Z',
  anteilBruttoMinuten: 120,
  anteilNettoMinuten: 112,
  nacherfasst: false,
};

describe('(5) der Digest des Artefakts hängt am Inhalt, nicht an der Reihenfolge', () => {
  it('dieselben Zeilen in anderer Reihenfolge ergeben denselben Hash', () => {
    const zweite: MiLoGZeile = {
      ...ZEILE,
      zeiteintragId: '22222222-2222-4222-8222-222222222222',
      anteilBeginn: '2026-11-01T00:00:00.000Z',
    };
    // `jsonb` sortiert beim Speichern um; ein Digest, der von der
    // Einfuegereihenfolge abhinge, schluege beim Wiederauslesen fehl — und
    // zwar als „Artefakt veraendert", also als Alarm ohne Anlass.
    expect(nachweisHash([ZEILE, zweite])).toBe(nachweisHash([zweite, ZEILE]));
  });

  it('eine geänderte Minute ergibt einen anderen Hash', () => {
    const verbogen: MiLoGZeile = { ...ZEILE, anteilNettoMinuten: 113 };
    expect(nachweisHash([verbogen])).not.toBe(nachweisHash([ZEILE]));
  });

  it('der Hash ist Hex-64 — die Form, die die Spalte verlangt', () => {
    expect(nachweisHash([ZEILE])).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('die kanonische Form nennt jedes Feld, das der Nachweis zeigt', () => {
    const text = kanonischeZeilen([ZEILE]);
    for (const teil of [
      ZEILE.zeiteintragId, ZEILE.kalendertag, ZEILE.beginn, ZEILE.ende,
      ZEILE.anteilBeginn, ZEILE.anteilEnde,
      String(ZEILE.bruttoMinuten), String(ZEILE.nettoMinuten),
      String(ZEILE.anteilBruttoMinuten), String(ZEILE.anteilNettoMinuten),
    ]) {
      // Ein Feld, das im Digest fehlt, laesst sich im Artefakt aendern, ohne
      // dass die Pruefung anschlaegt — und genau das waere ein Nachweis, der
      // keiner ist.
      expect(text).toContain(teil);
    }
  });
});
