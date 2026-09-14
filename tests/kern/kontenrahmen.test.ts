/**
 * Der Kontenrahmen-Adapter (PR 58, ACC-01).
 *
 * **Die wichtigste Prüfung hier ist die letzte:** dass in diesem Modul keine
 * Kontonummer steht. Welches Erlöskonto zu welcher Leistung gehört, ist O-05
 * — offen. Eine Tabelle mit „8400" sähe richtig aus, liefe durch und fiele
 * erst beim Steuerberater auf, auf Belegen, die nach §14 UStG nicht mehr
 * geändert werden dürfen. Ein Kommentar, der das verspricht, altert; ein Test,
 * der die Datei liest, nicht.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KONTENRAHMEN, RAHMEN_NAME, RECHNUNG_BRAUCHT, istKontenrahmen, pruefeKontonummer,
} from '../../src/server/services/buchhaltung/kontenrahmen.js';

const QUELLE = resolve(
  import.meta.dirname, '../../src/server/services/buchhaltung/kontenrahmen.ts');

describe('die beiden Rahmen', () => {
  it('sind SKR03 und SKR04 — und nichts sonst', () => {
    expect([...KONTENRAHMEN]).toEqual(['skr03', 'skr04']);
    expect(istKontenrahmen('skr03')).toBe(true);
    expect(istKontenrahmen('skr07')).toBe(false);
    expect(Object.keys(RAHMEN_NAME).sort()).toEqual(['skr03', 'skr04']);
  });

  it('eine Ausgangsrechnung braucht drei Zuordnungen', () => {
    expect([...RECHNUNG_BRAUCHT].sort())
      .toEqual(['debitor_kunde', 'erloes_leistung', 'steuer_gruppe']);
  });
});

describe('die Gestalt einer Kontonummer', () => {
  it('nur Ziffern', () => {
    const befund = pruefeKontonummer('84a0', { kontenrahmen: 'skr03', sachkontenlaenge: 4 });
    expect(befund.gueltig).toBe(false);
    expect(befund.grund).toMatch(/nur aus Ziffern/u);
  });

  it('ohne bekannte Länge wird die Länge NICHT geprüft (O-05 offen)', () => {
    // Eine Länge anzunehmen hiesse, die Einrichtung des Steuerberaters zu
    // raten — und eine richtige Nummer als falsch zu melden.
    for (const konto of ['8400', '84000', '12345678']) {
      expect(pruefeKontonummer(konto, { kontenrahmen: null, sachkontenlaenge: null }).gueltig)
        .toBe(true);
    }
  });

  it('mit bekannter Länge gilt sie — und für Personenkonten eine Stelle mehr', () => {
    const e = { kontenrahmen: 'skr03' as const, sachkontenlaenge: 4 };
    expect(pruefeKontonummer('8400', e).gueltig).toBe(true);
    expect(pruefeKontonummer('84000', e).gueltig).toBe(false);
    expect(pruefeKontonummer('10001', e, 'personenkonto').gueltig).toBe(true);
    expect(pruefeKontonummer('1000', e, 'personenkonto').gueltig).toBe(false);
  });

  it('die Meldung nennt beide Zahlen, nicht nur „falsch"', () => {
    const befund = pruefeKontonummer('840', { kontenrahmen: 'skr03', sachkontenlaenge: 4 });
    expect(befund.grund).toContain('4 Stellen');
    expect(befund.grund).toContain('3');
  });
});

describe('und keine einzige Kontonummer im Modul (O-05)', () => {
  it('der Quelltext enthält keine Sachkontonummer', () => {
    const quelle = readFileSync(QUELLE, 'utf8');
    /*
     * Geprüft wird der CODE, nicht der Kommentar: die Begründung darf „8400"
     * als Beispiel nennen, die Logik nicht. Kommentare fallen deshalb heraus,
     * danach bleibt kein vier- bis achtstelliger Zifferblock übrig.
     */
    const ohneKommentare = quelle
      .replace(/\/\*[\s\S]*?\*\//gu, ' ')
      .split('\n').map((z) => z.replace(/(^|\s)\/\/.*$/u, '$1')).join('\n');
    const treffer = ohneKommentare.match(/(?<![0-9A-Za-z_])[0-9]{4,8}(?![0-9A-Za-z_])/gu) ?? [];
    expect(treffer, 'eine Kontonummer im Code waere eine erfundene Geschaeftsregel')
      .toEqual([]);
  });
});
