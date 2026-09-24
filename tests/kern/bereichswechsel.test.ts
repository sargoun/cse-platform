/**
 * **Der Bereichswechsel nach DESIGN §6** (TEN-06, TEN-10, V-165, D-659) —
 * was sich ohne Datenbank und ohne Browser pruefen laesst.
 *
 *  1. Welcher Zaehler in einer Zeile steht: eine Regel ueber Gewerke, keine
 *     Liste von Gesellschaften (TEN-08).
 *  2. Wie er klingt: Einzahl, Mehrzahl, deutsche Zahlen, beide Sprachen.
 *  3. Wo er steht: der Rahmen zeigt Umschalter UND Verweis nur bei mehr als
 *     einem Bereich — im Quelltext geprueft, wie `rahmen-wurzel.test.ts` es
 *     fuer die Wurzel tut.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { waehleZaehler, type ZaehlerSchluessel }
  from '../../src/server/services/mandant/umschalter.js';
import {
  BEREICHSWECHSEL_TEXTE, gewerkText, unterzeile, zaehlerText,
} from '../../src/lib/i18n/verwaltung/bereichswechsel.js';

const karte = (e: Partial<Record<ZaehlerSchluessel, number>>): Map<ZaehlerSchluessel, number> =>
  new Map(Object.entries(e) as [ZaehlerSchluessel, number][]);

const quelle = (pfad: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${pfad}`, import.meta.url)), 'utf8');

describe('(1) welcher Zaehler in einer Zeile steht', () => {
  it('Bau gebucht: die laufenden Projekte', () => {
    expect(waehleZaehler(['bau'], karte({ auftraege_aktiv: 3, projekte_laufend: 12 })))
      .toEqual({ schluessel: 'projekte_laufend', wert: 12 });
  });

  it('Bau ohne bau.lesen: die Auftraege, wenn sie sichtbar sind', () => {
    expect(waehleZaehler(['bau'], karte({ auftraege_aktiv: 3 })))
      .toEqual({ schluessel: 'auftraege_aktiv', wert: 3 });
  });

  it('ein anderes Gewerk: die aktiven Auftraege — auch null Stueck', () => {
    expect(waehleZaehler(['reinigung'], karte({ auftraege_aktiv: 0, projekte_laufend: 5 })))
      .toEqual({ schluessel: 'auftraege_aktiv', wert: 0 });
  });

  it('eine nie gepflegte Buchung: die Auftraege', () => {
    expect(waehleZaehler(null, karte({ auftraege_aktiv: 7 })))
      .toEqual({ schluessel: 'auftraege_aktiv', wert: 7 });
  });

  it('kein Gewerk (CSE Operations): kein Zaehler', () => {
    expect(waehleZaehler([], karte({ auftraege_aktiv: 2 }))).toBeNull();
  });

  it('ohne Leserecht: kein Zaehler — nie eine erfundene Null', () => {
    expect(waehleZaehler(['reinigung'], karte({}))).toBeNull();
    expect(waehleZaehler(['bau'], karte({}))).toBeNull();
  });
});

describe('(2) wie er klingt', () => {
  it.each([
    ['auftraege_aktiv', 1, 'de', '1 laufender Auftrag'],
    ['auftraege_aktiv', 24, 'de', '24 laufende Aufträge'],
    ['auftraege_aktiv', 0, 'de', '0 laufende Aufträge'],
    ['projekte_laufend', 1, 'de', '1 laufendes Projekt'],
    ['projekte_laufend', 1234, 'de', '1.234 laufende Projekte'],
    ['auftraege_aktiv', 1, 'en', '1 active order'],
    ['auftraege_aktiv', 1234, 'en', '1.234 active orders'],
    ['projekte_laufend', 12, 'en', '12 running projects'],
  ] as const)('%s %d (%s) → %s', (schluessel, wert, sprache, erwartet) => {
    expect(zaehlerText(schluessel, wert, sprache)).toBe(erwartet);
  });

  it('das Gewerk heisst wie sein Modul — und Unbekanntes wird nicht erfunden', () => {
    expect(gewerkText(['reinigung'], 'de')).toBe('Reinigung');
    expect(gewerkText(['bau'], 'en')).toBe('Construction');
    expect(gewerkText(null, 'de')).toBeNull();
    expect(gewerkText([], 'de')).toBeNull();
  });

  it('die Unterzeile: Gewerk · Zaehler, oder nichts', () => {
    expect(unterzeile(['reinigung'], { schluessel: 'auftraege_aktiv', wert: 24 }, 'de'))
      .toBe('Reinigung · 24 laufende Aufträge');
    expect(unterzeile(null, { schluessel: 'auftraege_aktiv', wert: 2 }, 'de'))
      .toBe('2 laufende Aufträge');
    expect(unterzeile(['bau'], null, 'de')).toBe('Bau');
    expect(unterzeile([], null, 'de')).toBeNull();
  });

  it('die Gruppenzeile nennt die WIRKLICHE Zahl, nicht „vier"', () => {
    expect(BEREICHSWECHSEL_TEXTE.de.gruppeZeile(3)).toContain('3 Gesellschaften');
    expect(BEREICHSWECHSEL_TEXTE.de.gruppeZeile(3)).not.toMatch(/vier/iu);
    expect(BEREICHSWECHSEL_TEXTE.en.gruppeZeile(2)).toContain('2 Gesellschaften');
  });

  it('beide Sprachen tragen dieselben Schluessel', () => {
    expect(Object.keys(BEREICHSWECHSEL_TEXTE.en).sort())
      .toEqual(Object.keys(BEREICHSWECHSEL_TEXTE.de).sort());
  });
});

describe('(3) der Rahmen: Umschalter und Verweis nur bei mehr als einem Bereich', () => {
  const RAHMEN = quelle('src/components/portal/PortalRahmen.tsx');
  const LEISTE = quelle('src/components/portal/TabLeiste.tsx');

  it('der Rahmen leitet beides aus dem Stand des Tors ab', () => {
    expect(RAHMEN).toMatch(
      /const bereichsVerweis = wechsel === null \|\| wechsel\.stand\.bereiche\.length > 1;/u);
    expect(RAHMEN).toMatch(
      /const mitUmschalter = wechsel !== null && wechsel\.stand\.bereiche\.length > 1/u);
    expect(RAHMEN).toMatch(/\{mitUmschalter && \(\s*<BereichsWechsel/u);
  });

  it('jeder Verweis auf die Bereichswahl steht unter `bereichsVerweis`', () => {
    /*
     * Gezaehlt im Quelltext: jede Nennung von `/auth/bereich` im Rahmen und im
     * Blatt hinter `Mehr` braucht ihre Bedingung. Kommt eine dritte dazu, faellt
     * diese Pruefung — und nicht erst ein Mensch mit einem Bereich, der auf
     * eine Wahl ohne Auswahl geschickt wird (TEN-06).
     */
    for (const [name, text] of [['PortalRahmen', RAHMEN], ['TabLeiste', LEISTE]] as const) {
      const verweise = [...text.matchAll(/'\/auth\/bereich'|"\/auth\/bereich"/gu)].length;
      const bedingt = [...text.matchAll(/bereichsVerweis(?: &&|\s*\?\s*\[)/gu)].length;
      expect(verweise, name).toBeGreaterThan(0);
      expect(bedingt, `${name}: jeder Verweis braucht seine Bedingung`).toBe(verweise);
    }
  });

  it('das Tor legt den Stand in den Anfragespeicher — aus seiner eigenen Transaktion', () => {
    const tor = quelle('src/app/portal/zugang.ts');
    expect(tor).toMatch(/const umschalter = await umschalterStand\(\{ abfrage \}/u);
    expect(tor).toMatch(/merkeHuelle\([\s\S]{0,300}stand: befund\.umschalter/u);
  });

  it('die Bereichswahl zeigt Zaehler und die NUR-LESEN-Pille am Gruppeneintrag', () => {
    const wahl = quelle('src/app/auth/bereich/page.tsx');
    expect(wahl).toMatch(/umschalterStand\(\{ abfrage \}\)/u);
    expect(wahl).toMatch(/data-cse="bereich-zaehler"/u);
    expect(wahl).toMatch(/data-cse="gruppe-nur-lesen"[\s\S]{0,120}StatusPill zustand="Nur Lesen"/u);
    expect(wahl).not.toMatch(/Alle vier Gesellschaften/u);
  });

  it('der Wechsel ist ein POST an den einen Schreiber — nie ein GET', () => {
    const huelle = quelle('src/components/portal/BereichsWechsel.tsx');
    expect(huelle).toMatch(/method="post" action="\/api\/sitzung\/mandant"/u);
    expect(huelle).toMatch(/requestSubmit\(\)/u);
    expect(huelle).not.toMatch(/router\.push|location\.href|fetch\(/u);
  });
});
