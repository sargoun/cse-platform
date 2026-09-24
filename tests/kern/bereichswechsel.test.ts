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
  umschalterStand, waehleZaehler, zaehltFuer,
  type Abfrage, type UmschalterEintrag, type ZaehlerSchluessel,
} from '../../src/server/services/mandant/umschalter.js';
import {
  ausloeserName, BEREICHSWECHSEL_TEXTE, gewerkText, unterzeile, zaehlerText,
} from '../../src/lib/i18n/verwaltung/bereichswechsel.js';
import { kopfWechsel } from '../../src/components/portal/kopf-wechsel.js';
import { MODUL_ZUWEISUNG_TEXTE }
  from '../../src/lib/i18n/verwaltung/einstellungen/module-zuweisung.js';

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
    /* Zaehler nur fuer eine interne Sitzung (D-660) — das Kundenportal verweist auch hierher. */
    expect(wahl).toMatch(
      /umschalterStand\(\{ abfrage \}, \{\s*gruppe: true, zaehler: zaehltFuer\(sitzung\),\s*\}\)/u);
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

/**
 * **Zaehler nur fuer interne Sitzungen** (V-166, D-660).
 *
 * Die Bereichswahl liess die Angabe weg, und „mit Zaehlern" war die Vorgabe.
 * Ein Kundenkonto mit zwei Gesellschaften sah dort den Auftragsbestand jeder
 * Gesellschaft ueber alle Kunden. Jetzt ist die Frage Pflicht, und die
 * Antwort kommt aus EINER Regel (`zaehltFuer`). Die Datenbank prueft je
 * Bereich noch einmal (0418, `tests/isolation/bereichswechsel.test.ts` §5).
 */
describe('(5) Zaehler nur fuer interne Sitzungen', () => {
  it.each([
    ['intern', 'mandant', true],
    ['intern', 'gruppe', true],
    ['kunde', 'mandant', false],
    ['kunde', 'kunde', false],
    ['mitarbeiter', 'mandant', false],
    ['mitarbeiter', 'person', false],
  ] as const)('Portal %s, Ansicht %s → %s', (portal, ansicht, erwartet) => {
    expect(zaehltFuer({ portal, ansicht })).toBe(erwartet);
  });

  /** Eine Abfrage, die mitschreibt, welche Funktion gefragt wurde. */
  function mitschrift(): { k: Abfrage; gefragt: string[] } {
    const gefragt: string[] = [];
    const k: Abfrage = {
      abfrage: <T,>(sql: string): Promise<readonly T[]> => {
        gefragt.push(/app\.([a-z_]+)\(/u.exec(sql)?.[1] ?? sql);
        if (sql.includes('umschalter_bereiche')) {
          return Promise.resolve([
            { id: 'm1', slug: 'reinigung', name: 'CSE Dienstleistungen GmbH', ist_standard: true,
              gewerke: ['reinigung'] },
            { id: 'm3', slug: 'bau', name: 'REALTIME Service GmbH', ist_standard: false,
              gewerke: ['bau'] },
          ] as unknown as readonly T[]);
        }
        if (sql.includes('darf_gruppenansicht')) {
          return Promise.resolve([{ ok: true }] as unknown as readonly T[]);
        }
        return Promise.resolve([
          { mandant_id: 'm1', schluessel: 'auftraege_aktiv', wert: 57 },
        ] as unknown as readonly T[]);
      },
    };
    return { k, gefragt };
  }

  it('ohne Zaehlerfrage wird app.mandant_kennzahlen gar nicht gerufen', async () => {
    const { k, gefragt } = mitschrift();
    const stand = await umschalterStand(k, { gruppe: true, zaehler: false });
    expect(gefragt).toEqual(['umschalter_bereiche', 'darf_gruppenansicht']);
    expect(stand.gruppe).toBe(true);
    expect(stand.bereiche.every((b) => b.zaehler === null)).toBe(true);
  });

  it('weder Gruppe noch Zaehler: nur die Bereiche', async () => {
    const { k, gefragt } = mitschrift();
    const stand = await umschalterStand(k, { gruppe: false, zaehler: false });
    expect(gefragt).toEqual(['umschalter_bereiche']);
    expect(stand).toEqual({
      gruppe: false,
      bereiche: [
        expect.objectContaining({ slug: 'reinigung', zaehler: null }),
        expect.objectContaining({ slug: 'bau', zaehler: null }),
      ],
    });
  });

  it('mit Zaehlerfrage: die Zahl steht in ihrer Zeile', async () => {
    const { k, gefragt } = mitschrift();
    const stand = await umschalterStand(k, { gruppe: false, zaehler: true });
    expect(gefragt).toEqual(['umschalter_bereiche', 'mandant_kennzahlen']);
    expect(stand.gruppe).toBe(false);
    expect(stand.bereiche.find((b) => b.slug === 'reinigung')?.zaehler)
      .toEqual({ schluessel: 'auftraege_aktiv', wert: 57 });
  });

  it('kein Aufrufer fragt die Zaehler fest verdrahtet — die Antwort kommt aus der Sitzung', () => {
    for (const datei of [
      'src/app/portal/zugang.ts',
      'src/app/portal/konto/konto.ts',
      'src/app/auth/bereich/page.tsx',
    ]) {
      const text = quelle(datei);
      expect(text, datei).toMatch(/umschalterStand\(/u);
      expect(text, datei).not.toMatch(/zaehler:\s*true/u);
    }
    expect(quelle('src/app/portal/zugang.ts')).toMatch(
      /const intern = istInterneLeiste\(leisteFuer\(sitzung\.portal, sitzung\.ansicht, rolle\)\);\s*const umschalter = await umschalterStand\(\{ abfrage \}, \{ gruppe: intern, zaehler: intern \}\);/u);
    expect(quelle('src/app/portal/konto/konto.ts')).toMatch(
      /const intern = istInterneLeiste\(leiste\);[\s\S]{0,260}\{ gruppe: intern, zaehler: intern \}\);/u);
  });
});

/**
 * **Was der Mensch liest, nennt keine Kennung des Entwurfs** (V-169, D-663).
 *
 * Die Gruppenzeile der Bereichswahl endete auf „(Invariante 10)" bzw.
 * „(invariant 10)", die Erklärung der Modulzuweisung auf „(AUT-01)". Das
 * sind Verweise für die, die den Code lesen — auf dem Bildschirm sagen sie
 * niemandem etwas. Geprüft über jede Zeichenkette beider Tabellen, auch die
 * erzeugten.
 */
describe('(6) Texte ohne Entwicklerbezug, ⌘K ohne Neuanmeldung je Rendern', () => {
  const ENTWURF = /Invariante|invariant|\b(?:AUT|TEN|SEC|EMP|DSH|[DKOV])-\d+\b/u;

  function zeichenketten(wert: unknown): string[] {
    if (typeof wert === 'string') return [wert];
    if (typeof wert === 'function') {
      return [1, 3].map((n) => String((wert as (n: number) => unknown)(n)));
    }
    if (wert !== null && typeof wert === 'object') {
      return Object.values(wert as Record<string, unknown>).flatMap(zeichenketten);
    }
    return [];
  }

  it.each(['de', 'en'] as const)('Bereichswechsel und Modulzuweisung (%s)', (sprache) => {
    const texte = [
      ...zeichenketten(BEREICHSWECHSEL_TEXTE[sprache]),
      ...zeichenketten(MODUL_ZUWEISUNG_TEXTE[sprache]),
    ];
    expect(texte.length).toBeGreaterThan(30);
    expect(texte.filter((t) => ENTWURF.test(t))).toEqual([]);
  });

  it('die Gruppenzeile sagt „nur lesen" weiter — nur ohne Kennung', () => {
    expect(BEREICHSWECHSEL_TEXTE.de.gruppeZeile(3)).toBe('3 Gesellschaften zusammen — nur lesen');
    expect(BEREICHSWECHSEL_TEXTE.en.gruppeZeile(1)).toBe('One Gesellschaft — read only');
  });

  /**
   * `zeilen` entsteht bei jedem Rendern neu. Als Abhängigkeit des globalen
   * ⌘K-Listeners meldete es ihn bei jedem Rendern ab und wieder an. Jetzt
   * hängt er an einer Zahl, die sich nur mit dem aktiven Bereich ändert.
   */
  it('der ⌘K-Listener hängt an einer Zahl, nicht an einer je Rendern neuen Liste', () => {
    const umschalter = quelle('src/components/portal/BereichsUmschalter.tsx');
    expect(umschalter).toMatch(/const startFokus = Math\.max\(0, zeilen\.indexOf\(aktiv\)\);/u);
    expect(umschalter).toMatch(
      /window\.addEventListener\('keydown', beiTaste\);[\s\S]{0,120}\}, \[startFokus\]\);/u);
    expect(umschalter).not.toMatch(/\[aktiv, zeilen\]/u);
  });
});

/**
 * **DESIGN §6 sagt, was gebaut ist** (V-237, D-731 Nr. 4).
 *
 * Vier Abweichungen standen ohne Nachtrag in DESIGN.md. Das Einblenden folgt
 * jetzt dem Muster, die übrigen drei stehen begründet in §6 — und diese
 * Prüfung hält beide Seiten zusammen: die Zeilen des Musters sind die, die
 * `unterzeile` wirklich erzeugt, und das Klappmenü trägt die Einblendung mit
 * den Tokens aus §7.
 */
describe('(7) DESIGN §6 und der Umschalter stimmen überein', () => {
  const design = quelle('docs/DESIGN.md');
  const abschnitt = design.slice(
    design.indexOf('## 6. Business-area switcher'), design.indexOf('## 7. Motion'));

  it('das Klappmenü blendet mit --base und --ease ein — keine eigene Dauer', () => {
    expect(quelle('src/components/portal/BereichsUmschalter.tsx'))
      .toMatch(/data-cse="umschalter-menue"\s+className="cse-klappmenue /u);
    const css = quelle('src/styles/globals.css');
    expect(css).toMatch(
      /@keyframes cse-klappmenue \{\s*from \{ opacity: 0; transform: translateY\(-4px\); \}/u);
    expect(css).toMatch(
      /\.cse-klappmenue \{\s*animation: cse-klappmenue var\(--base\) var\(--ease\) both;/u);
    expect(abschnitt).toContain('`translateY(-4px→0)` over `--base` with `--ease`');
    expect(abschnitt).not.toMatch(/over 180ms/u);
  });

  it('die Zeilen im Muster sind die, die unterzeile erzeugt', () => {
    const zeilen = [
      unterzeile(['reinigung'], { schluessel: 'auftraege_aktiv', wert: 24 }, 'de'),
      unterzeile(['security'], { schluessel: 'auftraege_aktiv', wert: 8 }, 'de'),
      unterzeile(['bau'], { schluessel: 'projekte_laufend', wert: 12 }, 'de'),
    ];
    const erwartet = [
      'Reinigung · 24 laufende Aufträge', 'Security · 8 laufende Aufträge',
      'Bau · 12 laufende Projekte',
    ];
    expect(zeilen).toEqual(erwartet);
    for (const z of erwartet) expect(abschnitt, z).toContain(z);
    /* CSE Operations bucht kein Gewerk: keine zweite Zeile, keine erfundene. */
    expect(unterzeile([], null, 'de')).toBeNull();
    expect(abschnitt).not.toMatch(/│\s+Digital & KI\s+│/u);
  });

  it('der Name im Auslöser erst ab lg — und DESIGN sagt, warum', () => {
    expect(quelle('src/components/portal/BereichsUmschalter.tsx'))
      .toMatch(/knapp \? 'hidden lg:inline' : ''/u);
    expect(abschnitt).toContain('In the portal header the name appears from `lg`.');
  });
});
