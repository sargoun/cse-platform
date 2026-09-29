import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  istBericht, koernungAus, MIT_KOERNUNG, PROJEKT_STATUS_TEXT, zellenFuerBlatt,
  type BerichtTabelle,
} from '../../src/server/services/bericht/export.js';
import { alsCsv, datumText, type Spalte } from '../../src/server/services/bericht/ausgabe.js';
import { cent, type Cent } from '../../src/server/services/finanz/geld.js';
import { BERICHT_DRUCK_TEXTE } from '../../src/lib/i18n/verwaltung/bericht-druck.js';
import { enumWerte } from './hilfen/beschriftung.js';

/**
 * REP-07: zwei Ausgänge, eine Quelle (V-227, D-721).
 *
 * Die Abfragen hinter `berichtTabelle` prüft `tests/isolation/bericht.test.ts`
 * (dort auch: Datei und Blatt tragen für jeden der sechs Berichte dieselben
 * Spalten und Zeilen). Hier steht, was ohne Datenbank gilt.
 */

interface Zeile { readonly name: string; readonly anzahl: number; readonly betrag: Cent;
  readonly tag: string | null }

const spalten: readonly Spalte<Zeile>[] = [
  { kopf: 'Name', wert: (z) => z.name },
  { kopf: 'Anzahl', wert: (z) => z.anzahl },
  { kopf: 'Betrag', wert: (z) => String(z.betrag), cent: (z) => z.betrag },
  { kopf: 'Tag', wert: (z) => datumText(z.tag) },
];
const zeilen: readonly Zeile[] = [
  { name: 'Nord', anzahl: 1234, betrag: cent(199n), tag: '2026-03-01' },
  { name: 'Süd', anzahl: 7, betrag: cent(0n), tag: null },
];
const tabelle: BerichtTabelle = {
  zeilen, spalten: spalten as unknown as BerichtTabelle['spalten'], zeitraum: '2026',
};

describe('zellenFuerBlatt — die Datei auf Papier', () => {
  it('dieselben Köpfe in derselben Reihenfolge wie die Datei, ohne die Cent-Zwillinge', () => {
    const blatt = zellenFuerBlatt(tabelle);
    const csvKoepfe = alsCsv(spalten, zeilen).replace('﻿', '').split('\r\n')[0]!.split(';');
    expect(csvKoepfe).toEqual(['Name', 'Anzahl', 'Betrag', 'Betrag (Cent)', 'Tag']);
    expect(blatt.koepfe.map((k) => k.text))
      .toEqual(csvKoepfe.filter((k) => !k.endsWith(' (Cent)')));
  });

  it('dieselben Zeilen, und eine ganze Zahl bekommt ihren Tausenderpunkt', () => {
    const blatt = zellenFuerBlatt(tabelle);
    expect(blatt.zeilen).toHaveLength(2);
    expect(blatt.zeilen[0]!.map((z) => z.text)).toEqual(['Nord', '1.234', '199', '01.03.2026']);
    // Ein fehlender Tag ist eine leere Zelle, kein erfundenes Datum.
    expect(blatt.zeilen[1]![3]!.text).toBe('');
  });

  it('Zahlen- und Geldspalten stehen rechtsbündig, Text nicht', () => {
    const blatt = zellenFuerBlatt(tabelle);
    expect(blatt.koepfe.map((k) => k.zahl)).toEqual([false, true, true, false]);
  });
});

/**
 * **Dieselbe Genauigkeit wie die Datei, und rechts, was die Spalte als Zahl
 * ausweist** (V-269). Das Blatt schrieb jede Zahl mit `zahlText(w)` — null
 * Nachkommastellen —, also 37,5 Wochenstunden als „38", während die Datei
 * derselben Quelle 37.5 schrieb. Und die Stundenspalten („163:20 h") standen
 * links, weil ein Muster auf „… h" den Doppelpunkt nicht kannte.
 */
describe('zellenFuerBlatt — Genauigkeit und Ausrichtung aus der Spalte', () => {
  interface Std { readonly name: string; readonly soll: number | null;
    readonly ist: string; readonly minuten: number }
  const stdSpalten: readonly Spalte<Std>[] = [
    { kopf: 'Name', wert: (z) => z.name },
    { kopf: 'Wochenstunden Soll', wert: (z) => z.soll, zahl: true, nachkomma: 2 },
    { kopf: 'Ist', wert: (z) => z.ist, zahl: true },
    { kopf: 'Ist (Minuten)', wert: (z) => z.minuten, zahl: true },
  ];
  const stdZeilen: readonly Std[] = [
    { name: 'A', soll: 37.5, ist: '163:20 h', minuten: 9800 },
    { name: 'B', soll: 19.25, ist: '-2:30 h', minuten: -150 },
    { name: 'C', soll: 40, ist: '0:00 h', minuten: 0 },
    { name: 'D', soll: null, ist: '1234:05 h', minuten: 74045 },
  ];
  const std: BerichtTabelle = {
    zeilen: stdZeilen, zeitraum: '2026',
    spalten: stdSpalten as unknown as BerichtTabelle['spalten'],
  };

  it('37,5 bleibt 37,5 — nicht 38 —, 19,25 bleibt 19,25, 40 bleibt 40', () => {
    const texte = zellenFuerBlatt(std).zeilen.map((z) => z[1]!.text);
    expect(texte).toEqual(['37,5', '19,25', '40', '']);
  });

  it('dieselben Stellen wie die Datei — nur die Schreibweise ist deutsch', () => {
    const csv = alsCsv(stdSpalten, stdZeilen).replace('\uFEFF', '').split('\r\n');
    expect(csv[1]).toContain(';37.5;');
    expect(csv[2]).toContain(';19.25;');
    const blatt = zellenFuerBlatt(std);
    for (const [i, z] of stdZeilen.entries()) {
      if (z.soll === null) continue;
      expect(blatt.zeilen[i]![1]!.text.replace(',', '.'), z.name).toBe(String(z.soll));
    }
  });

  it('die Stundenspalte „163:20 h" steht rechts — auch negativ und über tausend', () => {
    const blatt = zellenFuerBlatt(std);
    expect(blatt.koepfe.map((k) => k.zahl)).toEqual([false, true, true, true]);
    expect(blatt.zeilen.every((z) => z[2]!.zahl)).toBe(true);
    expect(blatt.zeilen.map((z) => z[3]!.text)).toEqual(['9.800', '-150', '0', '74.045']);
  });

  it('eine Zahl ohne erklärte Genauigkeit wird nicht gerundet', () => {
    const t: BerichtTabelle = {
      zeilen: [{ x: 2.345 }], zeitraum: '2026',
      spalten: [{ kopf: 'X', wert: (z: { x: number }) => z.x }] as unknown as
        BerichtTabelle['spalten'],
    };
    expect(zellenFuerBlatt(t).zeilen[0]![0]).toEqual({ text: '2,345', zahl: true });
  });

  it('der Satz unter dem Blatt behauptet keine Zahlenform, die es nicht hat', () => {
    expect(BERICHT_DRUCK_TEXTE.en.tabelleDeutsch).not.toContain('number format as the file');
    expect(BERICHT_DRUCK_TEXTE.de.quelle).toContain('deutscher Schreibweise');
  });
});

describe('datumText — TT.MM.JJJJ ohne Date und ohne Zone', () => {
  it('schreibt den Kalendertag um und erfindet nichts', () => {
    expect(datumText('2026-12-31')).toBe('31.12.2026');
    expect(datumText(null)).toBeNull();
    expect(datumText('kein Tag')).toBe('kein Tag');
  });
});

describe('die Adresse wählt nur aus der Liste', () => {
  it('sechs Berichte, und ein geerbter Name ist keiner', () => {
    for (const b of ['umsatz', 'auftraege', 'attribution', 'mitarbeiter', 'projekte', 'pipeline']) {
      expect(istBericht(b), b).toBe(true);
    }
    expect(istBericht('toString')).toBe(false);
    expect(istBericht('__proto__')).toBe(false);
  });

  it('eine unbekannte Körnung ist „monat", und nur zwei Berichte tragen eine', () => {
    expect(koernungAus('quartal')).toBe('quartal');
    expect(koernungAus('woche')).toBe('monat');
    expect(koernungAus(null)).toBe('monat');
    expect([...MIT_KOERNUNG].sort()).toEqual(['auftraege', 'umsatz']);
  });
});

describe('eine Quelle, zwei Ausgänge', () => {
  it('die CSV-Route und das Druckblatt fragen beide berichtTabelle', () => {
    const csv = readFileSync('src/app/api/berichte/[bericht]/csv/route.ts', 'utf8');
    const blatt = readFileSync('src/app/portal/[mandant]/berichte/druck/[bericht]/page.tsx', 'utf8');
    for (const q of [csv, blatt]) {
      expect(q).toContain('berichtTabelle(');
      expect(q).toContain("'bericht.exportieren'");
    }
    // Keine zweite Spaltenliste in der Route.
    expect(csv).not.toContain("kopf: '");
  });

  it('das Blatt hat seine Wörter in beiden Sprachen, für jeden Bericht', () => {
    for (const s of ['de', 'en'] as const) {
      const t = BERICHT_DRUCK_TEXTE[s];
      expect(Object.keys(t.titel).sort()).toEqual(
        ['attribution', 'auftraege', 'mitarbeiter', 'pipeline', 'projekte', 'umsatz']);
    }
    expect(BERICHT_DRUCK_TEXTE.de.tabelleDeutsch).toBeNull();
    expect(BERICHT_DRUCK_TEXTE.en.tabelleDeutsch).not.toBeNull();
  });
});

/*
 * REP-07 verlangt CSV UND PDF; D-721 trug das in D-506 nach — so meldete es die
 * Gruppe. Der Absatz stand aber am Ende von D-569, einer Entscheidung über
 * Seitenränder, und D-506 („ein Ausgang") nannte den zweiten nicht (V-269).
 */
describe('das Register nennt den zweiten Ausgang dort, wo der erste steht', () => {
  const register = readFileSync('docs/DECISIONS.md', 'utf8');
  const abschnitt = (nr: string): string => {
    const anfang = register.indexOf(`\n### ${nr} `);
    expect(anfang, nr).toBeGreaterThan(0);
    const ende = register.indexOf('\n### ', anfang + 1);
    return register.slice(anfang, ende === -1 ? undefined : ende);
  };

  it('D-506 trägt den Nachtrag — mit dem Druckblatt unter demselben Recht', () => {
    expect(abschnitt('D-506')).toContain('**Nachtrag (D-721, V-227):**');
    expect(abschnitt('D-506')).toContain('/portal/[mandant]/berichte/druck/[bericht]');
  });

  it('D-569 (Seitenränder) nicht', () => {
    expect(abschnitt('D-569')).not.toContain('REP-07');
    expect(abschnitt('D-569')).not.toContain('Nachtrag (D-721');
  });
});

/*
 * Der Projektstand steht seit V-227 als Wort in Datei und Blatt. Die Karte war
 * ein `Record<string, string>`, und anders als die übrigen Karten der Gruppe
 * prüfte sie niemand gegen die Migration: ein neuer Stand stünde in Datei und
 * Blatt unbemerkt roh (`in_abnahme`) — V-269.
 */
describe('PROJEKT_STATUS_TEXT kennt genau die Stände aus der Migration', () => {
  it('jeder Wert von `projekt_status` hat ein Wort — und keiner mehr', () => {
    const werte = enumWerte('projekt_status');
    expect(werte.length).toBeGreaterThan(0);
    expect(Object.keys(PROJEKT_STATUS_TEXT).sort()).toEqual([...werte].sort());
  });

  it('kein Wort ist ein Schlüssel', () => {
    for (const [schluessel, wort] of Object.entries(PROJEKT_STATUS_TEXT)) {
      expect(wort, schluessel).not.toMatch(/_/u);
      expect(wort, schluessel).not.toBe(schluessel);
    }
  });
});
