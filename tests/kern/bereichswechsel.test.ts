/**
 * **Der Bereichswechsel nach DESIGN §6** (TEN-06, TEN-10, V-165, D-659) —
 * was sich ohne Datenbank und ohne Browser pruefen laesst.
 *
 *  1. Welcher Zaehler in einer Zeile steht: eine Regel ueber Gewerke, keine
 *     Liste von Gesellschaften (TEN-08).
 *  2. Wie er klingt: Einzahl, Mehrzahl, deutsche Zahlen, beide Sprachen.
 *  3. Wo er steht: `kopfWechsel` entscheidet aus dem Stand des Tors, was die
 *     Kopfzeile zeigt — Umschalter UND Verweis nur bei mehr als einem Bereich.
 *     Die Regel als Funktion geprueft; dass Rahmen, Blatt, Tor und
 *     Kontoseiten sie auch benutzen, im Quelltext, wie
 *     `rahmen-wurzel.test.ts` es fuer die Wurzel tut.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  waehleZaehler, type UmschalterEintrag, type ZaehlerSchluessel,
} from '../../src/server/services/mandant/umschalter.js';
import {
  ausloeserName, BEREICHSWECHSEL_TEXTE, gewerkText, unterzeile, zaehlerText,
} from '../../src/lib/i18n/verwaltung/bereichswechsel.js';
import { kopfWechsel } from '../../src/components/portal/kopf-wechsel.js';

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

describe('(3) kopfWechsel: was die Kopfzeile aus den Bereichen macht', () => {
  const eintrag = (
    id: string, slug: string, name: string,
    gewerke: readonly string[] | null = [slug],
    zaehler: UmschalterEintrag['zaehler'] = null,
  ): UmschalterEintrag => ({ id, slug, name, istStandard: false, gewerke, zaehler });

  const REINIGUNG = eintrag('m1', 'reinigung', 'CSE Dienstleistungen GmbH', ['reinigung'],
    { schluessel: 'auftraege_aktiv', wert: 24 });
  const BAU = eintrag('m3', 'bau', 'REALTIME Service GmbH', ['bau'],
    { schluessel: 'projekte_laufend', wert: 1 });
  const OPERATIONS = eintrag('m4', 'operations', 'CSE Operations', []);

  const huelle = (
    bereiche: readonly UmschalterEintrag[],
    optionen: { gruppe?: boolean; aktiv?: string | null; gruppenansicht?: boolean } = {},
  ) => ({
    stand: { bereiche, gruppe: optionen.gruppe ?? false },
    aktiverMandantId: optionen.aktiv === undefined ? bereiche[0]?.id ?? null : optionen.aktiv,
    gruppenansicht: optionen.gruppenansicht ?? false,
  });

  it('nicht gefragt (Vorschau, Rahmen ohne Tor): der Verweis bleibt, kein Umschalter', () => {
    expect(kopfWechsel(null, 'intern_admin', 'de')).toEqual({ verweis: true, umschalter: null });
  });

  it.each(['intern_admin', 'intern_leitung', 'intern_global', 'mitarbeiter', 'kunde'] as const)(
    'ein Bereich (%s): weder Umschalter noch Verweis (TEN-06, D-43)', (leiste) => {
      expect(kopfWechsel(huelle([REINIGUNG]), leiste, 'de'))
        .toEqual({ verweis: false, umschalter: null });
    });

  it('kein Bereich: ebenfalls nichts — eine Wahl ohne Zeile ist kein Ausgang', () => {
    expect(kopfWechsel(huelle([]), 'intern_global', 'de'))
      .toEqual({ verweis: false, umschalter: null });
  });

  it.each(['mitarbeiter', 'kunde'] as const)(
    'mehrere Bereiche im Portal %s: nur der Verweis, kein Umschalter', (leiste) => {
      expect(kopfWechsel(huelle([REINIGUNG, BAU]), leiste, 'de'))
        .toEqual({ verweis: true, umschalter: null });
    });

  it('mehrere Bereiche im internen Portal: Umschalter mit Unterzeile, Hue und Namen', () => {
    const k = kopfWechsel(huelle([REINIGUNG, BAU, OPERATIONS], { gruppe: true, aktiv: 'm3' }),
      'intern_admin', 'de');
    expect(k.verweis, 'der Weg ohne JavaScript bleibt').toBe(true);
    expect(k.umschalter).toEqual({
      bereiche: [
        { id: 'm1', slug: 'reinigung', name: 'CSE Dienstleistungen GmbH',
          unterzeile: 'Reinigung · 24 laufende Aufträge', bereich: 'reinigung' },
        { id: 'm3', slug: 'bau', name: 'REALTIME Service GmbH',
          unterzeile: 'Bau · 1 laufendes Projekt', bereich: 'bau' },
        { id: 'm4', slug: 'operations', name: 'CSE Operations',
          unterzeile: null, bereich: 'operations' },
      ],
      aktiv: 'm3',
      gruppenansicht: false,
      gruppeSichtbar: true,
      name: 'REALTIME Service GmbH',
    });
  });

  it('in der Gruppenansicht: der Auslöser heisst wie sie, in der Sprache der Person', () => {
    const stand = huelle([REINIGUNG, BAU], { gruppe: true, aktiv: null, gruppenansicht: true });
    expect(kopfWechsel(stand, 'gruppe', 'de').umschalter?.name).toBe('Gruppenübersicht');
    const en = kopfWechsel(stand, 'gruppe', 'en').umschalter;
    expect(en?.name).toBe('Group overview');
    expect(en?.bereiche[0]?.unterzeile).toBe('Cleaning · 24 active orders');
    expect(en?.aktiv).toBeNull();
    expect(en?.gruppenansicht).toBe(true);
  });

  it('ohne Gruppenrecht kein Gruppeneintrag — der Stand sagt es, nicht der Rahmen', () => {
    expect(kopfWechsel(huelle([REINIGUNG, BAU]), 'intern_leitung', 'de').umschalter?.gruppeSichtbar)
      .toBe(false);
  });

  it('ein fünfter Bereich ohne eigenen Hue traegt das Zeichen der Gruppe (TEN-08)', () => {
    const fuenfter = eintrag('m5', 'facility', 'CSE Facility GmbH', null,
      { schluessel: 'auftraege_aktiv', wert: 3 });
    const k = kopfWechsel(huelle([REINIGUNG, fuenfter], { aktiv: 'm5' }), 'intern_admin', 'de');
    expect(k.umschalter?.bereiche[1]).toEqual({
      id: 'm5', slug: 'facility', name: 'CSE Facility GmbH',
      unterzeile: '3 laufende Aufträge', bereich: null,
    });
    expect(k.umschalter?.name).toBe('CSE Facility GmbH');
  });

  it('ausloeserName: Gruppe, aktiver Bereich, sonst die Aufforderung', () => {
    const t = BEREICHSWECHSEL_TEXTE.de;
    const bereiche = [{ id: 'm1', name: 'CSE Dienstleistungen GmbH' }];
    expect(ausloeserName(bereiche, null, true, t)).toBe('Gruppenübersicht');
    expect(ausloeserName(bereiche, 'm1', false, t)).toBe('CSE Dienstleistungen GmbH');
    expect(ausloeserName(bereiche, 'weg', false, t)).toBe('Bereich wählen');
    expect(ausloeserName(bereiche, null, false, BEREICHSWECHSEL_TEXTE.en)).toBe('Choose area');
  });
});

describe('(4) wo die Regel gilt: Rahmen, Blatt, Tor, Kontoseiten, Bereichswahl', () => {
  const RAHMEN = quelle('src/components/portal/PortalRahmen.tsx');
  const LEISTE = quelle('src/components/portal/TabLeiste.tsx');

  it('der Rahmen fragt `kopfWechsel` mit dem Stand aus dem Anfragespeicher', () => {
    expect(RAHMEN).toMatch(
      /const \{ verweis: bereichsVerweis, umschalter \} = kopfWechsel\(stand\.umschalter, leiste, sprache\);/u);
    expect(RAHMEN).toMatch(/\{umschalter !== null && \([\s\S]{0,400}<BereichsWechsel/u);
  });

  it('der Umschalter ersetzt das Logo: kein zweites Zeichen, kein doppelter Name ab `lg`', () => {
    expect(RAHMEN).toMatch(/const logoImUmschalter = umschalter !== null && titel === umschalter\.name;/u);
    expect(RAHMEN).toMatch(
      /const logoKante = umschalter === null \? '-ms-s2' : logoImUmschalter \? 'lg:hidden' : '';/u);
    expect(RAHMEN).toMatch(/const zeichen = [^\n]*\(umschalter !== null \? null/u);
    /* Beide Fassungen des Logos tragen die Kante — mit und ohne Weg zur Übersicht. */
    expect([...RAHMEN.matchAll(/text-h3 text-text[^`]*\$\{logoKante\}`/gu)].length).toBe(2);
    /* Und der Auslöser zeigt seinen Namen genau ab dort, wo das Logo weicht. */
    expect(quelle('src/components/portal/BereichsUmschalter.tsx'))
      .toMatch(/knapp \? 'hidden lg:inline' : ''/u);
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

  it('die Kontoseiten gehen nicht durch das Tor — und legen den Stand trotzdem ab', () => {
    /*
     * Fuenf Seiten unter `/portal/konto` rendern den Rahmen mit `leseKonto`
     * statt `portalZugang`. Ohne diesen Stand trug ihre Kopfzeile den Verweis
     * fuer jedes Konto — auch fuer eines mit einem einzigen Bereich.
     */
    const konto = quelle('src/app/portal/konto/konto.ts');
    expect(konto).toMatch(/const umschalter = await umschalterStand\(\{/u);
    expect(konto).toMatch(/merkeUmschalter\(\{\s*stand: bild\.umschalter,/u);
    for (const seite of [
      'src/app/portal/konto/[[...rest]]/page.tsx',
      'src/app/portal/konto/profil/page.tsx',
      'src/app/portal/konto/sicherheit/page.tsx',
      'src/app/portal/konto/benachrichtigungen/page.tsx',
      'src/app/portal/konto/kalender-feed/page.tsx',
    ]) {
      const text = quelle(seite);
      expect(text, seite).toMatch(/await leseKonto\(sitzung\)/u);
      /* Der Rahmen erst NACH `leseKonto` — sonst liest er einen leeren Speicher. */
      expect(text.indexOf('await leseKonto(sitzung)'), seite)
        .toBeLessThan(text.indexOf('<PortalRahmen'));
    }
  });

  it('die Kontowurzel nennt die Bereichswahl nur mit einer Auswahl', () => {
    const wurzel = quelle('src/app/portal/konto/[[...rest]]/page.tsx');
    expect(wurzel).toMatch(
      /\{k\.bereiche\.length > 1 && \(\s*<p data-cse="konto-wechsel"[\s\S]{0,200}href="\/auth\/bereich"/u);
    expect([...wurzel.matchAll(/href="\/auth\/bereich"/gu)].length).toBe(1);
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
