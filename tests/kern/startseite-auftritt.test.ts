/**
 * Die Startseite als Buehne (DESIGN §4, §5, §7 — D-776): Markenkarten zwei
 * mal zwei, redaktioneller Textabschnitt, Abschluss-Band und der Auftritt
 * beim ersten Sichtkontakt.
 *
 * Gerendert wird `Abschnitte` mit einer Seite, wie der Import sie fuer `/`
 * anlegt — in beiden Sprachen. Geprueft wird der AUFBAU, den die e2e-Wachen
 * nur am fertigen Bau sehen: Reihenfolge, Staffelung, Beschriftung, und dass
 * der Server nichts verbirgt. Was nur der Browser weiss (Format, Farbe der
 * Oberkante, Rollen), steht in `tests/e2e/website.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Seite } from '../../src/server/services/inhalt/seite.js';
import type { Sprache } from '../../src/lib/sprache.js';

/* Die Bauteile erwarten `React` im Geltungsbereich (klassische JSX-Umwandlung, V-153). */
(globalThis as { React?: typeof React }).React = React;

vi.mock('next/image', () => ({
  default: (p: { src: string; alt: string; className?: string }) =>
    createElement('img', { src: p.src, alt: p.alt, className: p.className }),
}));
vi.mock('@/server/inhalt/bilder', () => ({
  bildFuerMotiv: (motiv: string) => ({ pfad: `/bilder/${motiv}.jpg`, alt: motiv, platzhalter: false }),
}));

const { Abschnitte } = await import('../../src/components/oeffentlich/Abschnitte.js');
const { unterDerFalz } = await import('../../src/components/oeffentlich/Auftritt.js');
const { BEWEGUNG } = await import('../../src/lib/design/theme.js');
const { SHELL_TEXTE } = await import('../../src/lib/i18n/texte.js');
const { SEITEN } = await import('../../src/server/db/seed/inhalt.js');
const { SEITEN_EN } = await import('../../src/server/db/seed/inhalt-en.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (p: string): string => readFileSync(join(WURZEL, p), 'utf8');

const OHNE_MARKE = { logoHell: null, logoDunkel: null, avatar: null, cover: null } as const;
const BEREICHE = [
  ['reinigung', 'CSE Dienstleistung'], ['security', 'SSE Security'],
  ['bau', 'REALTIME Service'], ['operations', 'CSE Operations'],
].map(([slug, name]) => ({
  slug: slug!, name: name!, bereich: slug as 'reinigung' | 'security' | 'bau' | 'operations',
  nap: `${name!} · Kurfürstendamm 201 · 10719 Berlin`, marke: OHNE_MARKE,
}));
const ANSPRUECHE = {
  reinigung: 'Gebäudereinigung', security: 'Sicherheits- und Objektschutzdienste',
  bau: 'Hochbau, Ausbau, Rückbau', operations: 'Digitale Abläufe',
};

function abschnitt(
  art: Seite['abschnitte'][number]['art'], reihenfolge: number,
  ueberschrift: string | null, text: string | null, akzentWort: string | null = null,
): Seite['abschnitte'][number] {
  return { id: `a${String(reihenfolge)}`, art, reihenfolge, ueberschrift, akzentWort, text, medium: null, daten: {} };
}

/** Die Startseite, wie `content:import` sie aus dem Seed anlegt. */
function startseite(sprache: Sprache): Seite {
  const de = sprache === 'de';
  return {
    id: 's1', pfad: de ? '/' : '/en', titel: 'CSE Gruppe', beschreibung: null,
    abschnitte: [
      abschnitt('hero', 1, de ? 'Vier Gewerke, eine' : 'Four trades, one', 'Lead.', de ? 'Gruppe' : 'group'),
      abschnitt('markenkarten', 2, de ? 'Vier Gesellschaften, ein Haus' : 'Four companies, one house', 'Leitsatz.'),
      abschnitt('text', 3, de ? 'Warum vier Gesellschaften' : 'Why four companies', 'Erklärung.'),
      abschnitt('kontakt', 4, de ? 'Ein Gespräch genügt.' : 'One conversation is enough.', 'Schildern Sie uns, was ansteht.'),
    ],
  };
}

function html(sprache: Sprache, seite = startseite(sprache)): string {
  return renderToStaticMarkup(createElement(Abschnitte, {
    seite, bereiche: BEREICHE, ansprueche: ANSPRUECHE, sprache, gruppeName: 'CSE Gruppe',
  }));
}

const stelle = (h: string, marke: string): number => {
  const i = h.indexOf(marke);
  expect(i, `${marke} fehlt`).toBeGreaterThanOrEqual(0);
  return i;
};

describe('die Startseite in ihrer Reihenfolge', () => {
  it.each(['de', 'en'] as const)('%s: Hero, Markenkarten, Textabschnitt, Abschluss-Band — und nichts ist verborgen', (sprache) => {
    const h = html(sprache);
    const reihe = ['data-cse="hero"', 'data-cse="marken-abschnitt"', 'data-cse="textabschnitt"', 'data-cse="abschluss"']
      .map((m) => stelle(h, m));
    expect([...reihe].sort((a, b) => a - b)).toEqual(reihe);
    // Ohne Skript bewegt sich nichts: die Klasse setzt allein der Beobachter (§7).
    expect(h).not.toContain('cse-wartet');
    expect(h).not.toContain('cse-sichtkontakt');
    // Genau EIN rotes Akzentwort (DESIGN §2).
    expect(h.match(/data-cse="akzent-wort"/gu)).toHaveLength(1);
  });
});

describe('der Hero tritt beim Laden auf — gestaffelt, das Bild nur ueber die Form', () => {
  it('Bild `cse-hero-bild`, Vorzeile 0ms, Ueberschrift 60ms, Text und Knoepfe 120ms', () => {
    const h = html('de');
    expect(h).toMatch(/<img[^>]*class="[^"]*cse-hero-bild/u);
    expect(h).toMatch(/data-cse="hero-marke" class="cse-auftritt /u);
    expect(h).toMatch(/<h1 class="cse-auftritt cse-auftritt-2 max-w-\[18ch\] text-display/u);
    expect(h).toMatch(/<p class="cse-auftritt cse-auftritt-3 max-w-prose/u);
    expect(h).toMatch(/data-cse="hero-aufrufe" class="cse-auftritt cse-auftritt-3/u);
    // Der Rahmen selbst tritt nicht mehr fuer alle auf — sonst liefe alles zugleich.
    expect(h).not.toMatch(/max-w-content flex-col gap-s3\s+px-s5 py-s6 cse-auftritt/u);
  });
});

describe('die Markenkarten: zwei mal zwei, gerade Oberkante, Zeichen oben links', () => {
  it('vier Karten in einer Liste, jede mit Auftritt, die zweite Spalte 60ms spaeter', () => {
    const h = html('de');
    const karten = h.match(/<li data-auftritt=""[^>]*>/gu) ?? [];
    expect(karten).toHaveLength(4);
    expect(karten.map((k) => k.includes('cse-auftritt-2'))).toEqual([false, true, false, true]);
    expect(h).toMatch(/<ul class="m-0 grid list-none grid-cols-1 gap-s4 p-0 md:grid-cols-2 md:gap-s5">/u);
    expect(h.match(/data-cse="marken-karte"/gu)).toHaveLength(4);
  });

  it('Oberkante 3px im Bereichshue, Radius nur unten, der Pflicht-Gradient, das Zeichen VOR dem Namen', () => {
    const h = html('de');
    for (const b of ['reinigung', 'security', 'bau', 'operations']) {
      const start = stelle(h, `data-bereich="${b}"`);
      const karte = h.slice(start, h.indexOf('</a>', start));
      expect(karte).toContain(`border-top:3px solid var(--area-${b})`);
      expect(karte).toContain('rounded-b-lg');
      expect(karte).not.toMatch(/ rounded-lg/u);
      expect(karte).toContain('data-cse="karten-gradient"');
      expect(karte).toContain('background:var(--bild-overlay)');
      // Das Zeichen steht oben links (§4) — im Markup VOR Name und Anspruch.
      expect(stelle(karte, 'data-cse="marke"')).toBeLessThan(stelle(karte, 'text-h3 text-white'));
      expect(karte).toContain('group-hover:scale-[1.03]');
      expect(karte).toContain('hover:-translate-y-0.5');
    }
  });

  it.each(['de', 'en'] as const)('%s: der Kopf des Abschnitts traegt Vorzeile, h2 und Leitsatz — und „Mehr erfahren" in der Sprache', (sprache) => {
    const h = html(sprache);
    const t = SHELL_TEXTE[sprache];
    const kopf = h.slice(stelle(h, 'data-cse="marken-kopf"'), stelle(h, '<ul class="m-0 grid'));
    expect(kopf).toContain(`text-text-subtle">${t.gruppeNav}</p>`);
    expect(kopf).toContain(sprache === 'de' ? 'Vier Gesellschaften, ein Haus' : 'Four companies, one house');
    expect(kopf).toContain('Leitsatz.');
    expect(h.match(new RegExp(t.mehrErfahren.replace('→', '→'), 'gu'))).toHaveLength(4);
  });

  it('ohne Ueberschrift und Text gibt es keinen Kopf — nur die Karten', () => {
    const seite = startseite('de');
    const h = html('de', {
      ...seite,
      abschnitte: seite.abschnitte.map((a) => (a.art === 'markenkarten'
        ? { ...a, ueberschrift: null, text: null } : a)),
    });
    expect(h).not.toContain('data-cse="marken-kopf"');
    expect(h.match(/data-cse="marken-karte"/gu)).toHaveLength(4);
  });
});

describe('der Textabschnitt ist redaktionell', () => {
  it('mit Ueberschrift UND Text auf 5/7 ab lg, mit Auftritt', () => {
    const h = html('de');
    const start = stelle(h, 'data-cse="textabschnitt"');
    const abschnitt = h.slice(start, h.indexOf('</section>', start));
    expect(h.slice(start - 40, start)).toContain('data-auftritt=""');
    expect(abschnitt).toContain('lg:grid-cols-12');
    expect(abschnitt).toMatch(/<h2 class="m-0 text-h2 text-text lg:col-span-5">Warum vier Gesellschaften<\/h2>/u);
    expect(abschnitt).toMatch(/<p class="m-0 max-w-prose text-text-muted text-lg lg:col-span-7">/u);
  });

  it('mit Text allein gestapelt, in Grundschrift', () => {
    const seite = startseite('de');
    const h = html('de', {
      ...seite,
      abschnitte: [abschnitt('text', 1, null, 'Nur ein Absatz.')],
    });
    expect(h).not.toContain('lg:grid-cols-12');
    expect(h).toMatch(/<p class="m-0 max-w-prose text-text-muted text-base">Nur ein Absatz.<\/p>/u);
  });
});

describe('das Abschluss-Band', () => {
  it.each([
    ['de', '/angebot', '/kontakt', 'Kontakt'],
    ['en', '/en/angebot', '/en/kontakt', 'Contact'],
  ] as const)('%s: fuehrt ins Angebot und zum Kontakt, sekundaer, mit Vorzeile', (sprache, angebot, kontakt, vorzeile) => {
    const h = html(sprache);
    const start = stelle(h, 'data-cse="abschluss"');
    const band = h.slice(start, h.indexOf('</section>', start));
    expect(band).toContain(`href="${angebot}" data-cse="abschluss-angebot"`);
    expect(band).toContain(`href="${kontakt}" data-cse="abschluss-kontakt"`);
    expect(band).toContain(`text-text-subtle">${vorzeile}</p>`);
    expect(band).toContain(SHELL_TEXTE[sprache].angebotAnfragen);
    // Sekundaer: der Kopf traegt den einen roten Knopf (DESIGN §1, §5).
    expect(band).not.toContain('bg-brand');
    expect(band).toContain('border-line-strong');
    expect(band).toContain('data-auftritt=""');
  });
});

describe('der Auftritt beim ersten Sichtkontakt', () => {
  it('verborgen wird nur, was beim Start unter der Falz liegt', () => {
    expect(unterDerFalz(0, 900)).toBe(false);
    expect(unterDerFalz(899, 900)).toBe(false);
    expect(unterDerFalz(900, 900)).toBe(true);
    expect(unterDerFalz(2400, 900)).toBe(true);
  });

  it('die Huelle traegt den Beobachter, das Stylesheet die Klassen, das Token steht ueberall', () => {
    expect(lies('src/components/oeffentlich/OeffentlicheShell.tsx')).toContain('<Auftritt />');
    // Je Pfad, nicht je Einhaengen: die Huelle bleibt bei `<Link>`-Wechseln stehen.
    const beobachter = lies('src/components/oeffentlich/Auftritt.tsx');
    expect(beobachter).toContain("usePathname } from 'next/navigation'");
    expect(beobachter).toMatch(/\}, \[pfad\]\);/u);
    const css = lies('src/styles/globals.css');
    // Nur die Form, nie die Deckkraft: axe misst Kontrast mitten im Fade (§7).
    expect(css).toContain('.cse-wartet { transform: translateY(var(--s5)); }');
    expect(css).toMatch(/\.cse-sichtkontakt \{\s*animation: cse-sichtkontakt var\(--slow\)/u);
    expect(css).not.toContain('cse-verborgen');
    expect(css).toMatch(/\.cse-hero-bild \{ animation: cse-hero-bild var\(--entrance\)/u);
    expect(BEWEGUNG.entrance).toBe('1200ms');
    expect(css).toContain('--entrance: 1200ms;');
    const design = lies('docs/DESIGN.md');
    for (const wort of ['--entrance: 1200ms', 'data-auftritt', '.cse-wartet', 'rounded-b-lg', '18ch']) {
      expect(design, wort).toContain(wort);
    }
  });
});

describe('der Seed der Startseite', () => {
  it.each([['de', SEITEN], ['en', SEITEN_EN]] as const)('%s: Hero, Markenkarten mit Text, Textabschnitt, Abschluss-Band am ENDE', (_, seiten) => {
    const start = seiten.find((s) => s.pfad === '/');
    expect(start).toBeDefined();
    const arten = start!.abschnitte.map((a) => a.art);
    // Der Import ordnet nach `reihenfolge` und schreibt `art` nicht nach —
    // ein neuer Abschnitt gehoert ans Ende (D-776 Nr. 7).
    expect(arten).toEqual(['hero', 'markenkarten', 'text', 'kontakt']);
    const karten = start!.abschnitte[1]!;
    expect(karten.ueberschrift).not.toBeNull();
    expect(karten.text).not.toBeNull();
    const band = start!.abschnitte[3]!;
    expect(band.ueberschrift).not.toBeNull();
    expect(band.text).not.toBeNull();
  });
});
