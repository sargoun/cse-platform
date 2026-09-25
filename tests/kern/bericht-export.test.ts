import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  istBericht, koernungAus, MIT_KOERNUNG, zellenFuerBlatt, type BerichtTabelle,
} from '../../src/server/services/bericht/export.js';
import { alsCsv, datumText, type Spalte } from '../../src/server/services/bericht/ausgabe.js';
import { cent, type Cent } from '../../src/server/services/finanz/geld.js';
import { BERICHT_DRUCK_TEXTE } from '../../src/lib/i18n/verwaltung/bericht-druck.js';

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
