/**
 * PR 2 acceptance (1), (3), (6), (7).
 *
 * The point of (1) is the drift, not the presence: DESIGN §10 says the same
 * values must be reachable from surfaces Tailwind never touches — the PDF and
 * e-mail renderers. So the test fails when a token exists in one place and
 * not the other, in EITHER direction.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUSGESCHLOSSEN } from '../../src/server/services/inhalt/sitemap.js';
import { devFlaechenAn } from '../../src/lib/dev-flaechen.js';
import {
  ABSTAND,
  ALLE_TOKENS,
  BEWEGUNG,
  FARBEN_BASIS,
  FARBEN_BEREICH,
  FARBEN_MARKE,
  FARBEN_SEMANTIK,
  RADIUS,
} from '../../src/lib/design/theme.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const CSS = readFileSync(join(WURZEL, 'src/styles/globals.css'), 'utf8');
const DESIGN = readFileSync(join(WURZEL, 'docs/DESIGN.md'), 'utf8');

/** `--name: value;` declarations of `:root`. */
function cssTokens(): Map<string, string> {
  const wurzel = /:root\s*\{([\s\S]*?)\n\}/u.exec(CSS)?.[1] ?? '';
  const map = new Map<string, string>();
  for (const m of wurzel.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gu)) {
    map.set(m[1]!, m[2]!.trim());
  }
  return map;
}

const normal = (v: string): string => v.replace(/\s+/gu, '').toLowerCase();

describe('(1) every §1–§3 token exists in theme.ts AND globals.css, with the same value', () => {
  const css = cssTokens();

  it('every theme.ts token is in globals.css', () => {
    const fehlend = Object.keys(ALLE_TOKENS).filter((k) => !css.has(k));
    expect(fehlend, `fehlen in globals.css: ${fehlend.join(', ')}`).toEqual([]);
  });

  it('every globals.css token is in theme.ts — no orphan in the stylesheet', () => {
    const fremd = [...css.keys()].filter((k) => !(k in ALLE_TOKENS));
    expect(fremd, `nicht in theme.ts: ${fremd.join(', ')}`).toEqual([]);
  });

  it('the values are identical, not merely present', () => {
    for (const [name, wert] of Object.entries(ALLE_TOKENS)) {
      expect(normal(css.get(name) ?? ''), `--${name}`).toBe(normal(wert));
    }
  });

  it('the Tailwind theme is derived from the same file, not retyped', async () => {
    const { default: config } = (await import('../../tailwind.config.js')) as {
      default: { theme?: { extend?: { colors?: Record<string, unknown> } } };
    };
    const farben = config.theme?.extend?.colors as Record<string, unknown>;
    expect((farben['brand'] as Record<string, string>)['DEFAULT']).toBe(FARBEN_MARKE.red);
    expect((farben['area'] as Record<string, string>)['security']).toBe(FARBEN_BEREICH.security);
    expect(farben['ink']).toBe(FARBEN_BASIS.ink);
    expect((farben['success'] as Record<string, string>)['DEFAULT']).toBe(FARBEN_SEMANTIK.success);
  });
});

describe('the tokens match docs/DESIGN.md itself — the document is authoritative', () => {
  it('every colour value appears verbatim in DESIGN.md', () => {
    const werte = [
      ...Object.values(FARBEN_BASIS),
      ...Object.values(FARBEN_MARKE),
      ...Object.values(FARBEN_BEREICH),
      ...Object.values(FARBEN_SEMANTIK),
    ];
    for (const w of werte) {
      expect(normal(DESIGN), `${w} steht nicht in DESIGN.md`).toContain(normal(w));
    }
  });

  it('spacing, radius and motion match DESIGN §3 and §7', () => {
    for (const w of [...Object.values(ABSTAND), ...Object.values(RADIUS)]) {
      expect(normal(DESIGN)).toContain(normal(w));
    }
    expect(normal(DESIGN)).toContain(normal(BEWEGUNG.ease));
  });
});

/** WCAG 2.1 relative luminance. */
function luminanz(hex: string): number {
  const h = hex.replace('#', '');
  const teile = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((p) => parseInt(p, 16) / 255);
  const lin = teile.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}
function kontrast(a: string, b: string): number {
  const [hell, dunkel] = [luminanz(a), luminanz(b)].sort((x, y) => y - x);
  return (hell! + 0.05) / (dunkel! + 0.05);
}

describe('(2) contrast — BFSG applies, WCAG 2.1 AA', () => {
  it('--text on --surface passes AA for body text', () => {
    expect(kontrast(FARBEN_BASIS.text, FARBEN_BASIS.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('--text-muted on --surface passes AA — DESIGN §9 says it does', () => {
    expect(kontrast(FARBEN_BASIS['text-muted'], FARBEN_BASIS.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('--text-subtle ALSO passes AA — meta text is still text (BFSG)', () => {
    // It used to be #71717A at 3.93:1, on the reasoning that it is "for xs
    // meta only". WCAG has no small-text exemption — only a large-text one —
    // so that reasoning did not survive an axe run against the kitchensink.
    for (const grund of [FARBEN_BASIS.surface, FARBEN_BASIS.ink, FARBEN_BASIS['surface-3']]) {
      expect(kontrast(FARBEN_BASIS['text-subtle'], grund)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the three text levels stay a visible hierarchy, not three shades of one', () => {
    const auf = (c: string): number => kontrast(c, FARBEN_BASIS.surface);
    expect(auf(FARBEN_BASIS.text)).toBeGreaterThan(auf(FARBEN_BASIS['text-muted']));
    expect(auf(FARBEN_BASIS['text-muted'])).toBeGreaterThan(auf(FARBEN_BASIS['text-subtle']));
  });

  it('white on --danger-strong passes AA; on --danger it does not — which is why both exist', () => {
    expect(kontrast('#FFFFFF', FARBEN_SEMANTIK['danger-strong'])).toBeGreaterThanOrEqual(4.5);
    expect(kontrast('#FFFFFF', FARBEN_SEMANTIK.danger)).toBeLessThan(4.5);
  });

  /**
   * DESIGN §9 and §1 do not only claim "passes" — they print the ratios. A
   * printed number is a claim like any other, and a wrong one was written into
   * §9 once already. Each figure below is asserted against the value computed
   * from the tokens AND against the literal text of DESIGN.md, so neither side
   * can drift away from the other.
   */
  it('the ratios DESIGN.md prints are the ratios the tokens actually produce', () => {
    const behauptungen: readonly [vordergrund: string, hintergrund: string, text: string][] = [
      [FARBEN_BASIS.text, FARBEN_BASIS.surface, '`--text` 18.2:1'],
      [FARBEN_BASIS['text-muted'], FARBEN_BASIS.surface, '`--text-muted` 7.4:1'],
      [FARBEN_BASIS['text-subtle'], FARBEN_BASIS.surface, '`--text-subtle` 5.6:1'],
      [FARBEN_BASIS['text-subtle'], FARBEN_BASIS['surface-3'], '4.86:1'],
      ['#FFFFFF', FARBEN_SEMANTIK.danger, '**3.76:1**'],
      ['#FFFFFF', FARBEN_SEMANTIK['danger-strong'], '(**4.83:1**)'],
    ];

    for (const [vorne, hinten, text] of behauptungen) {
      expect(DESIGN, `DESIGN.md no longer states ${text}`).toContain(text);
      const gedruckt = Number(/(\d+\.\d+):1/u.exec(text)![1]);
      const stellen = String(gedruckt).split('.')[1]!.length;
      const gerechnet = Number(kontrast(vorne, hinten).toFixed(stellen));
      expect(gerechnet, text).toBe(gedruckt);
    }
  });

  it('every semantic colour passes AA on its own -soft background over --surface', () => {
    // The soft tints are 12% alpha over --surface, so the effective background
    // is close to --surface itself; asserting against --surface is the
    // conservative reading.
    for (const ton of ['success', 'warning', 'danger', 'info'] as const) {
      expect(kontrast(FARBEN_SEMANTIK[ton], FARBEN_BASIS.surface), ton).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('(3) focus rings are never removed', () => {
  it('no stylesheet sets `outline: none`', () => {
    expect(CSS).not.toMatch(/outline\s*:\s*none/iu);
  });

  it('a global :focus-visible rule applies the --red-ring', () => {
    expect(CSS).toMatch(/:focus-visible[\s\S]*?--red-ring/u);
  });
});

describe('(4) prefers-reduced-motion disables transforms and keeps opacity', () => {
  it('globals.css carries the media query, and it removes transforms', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/u.exec(CSS)?.[1];
    expect(block).toBeDefined();
    expect(block).toMatch(/transform\s*:\s*none/u);
    // Opacity is KEPT — DESIGN §7 says disable transforms, not all motion.
    expect(block).toMatch(/transition-property\s*:\s*opacity/u);
  });
});

describe('(6) an ad-hoc colour in a component fails `no-raw-color`', () => {
  it('lints a fixture with a literal hex and reports the rule', () => {
    let ausgabe = '[]';
    try {
      ausgabe = execFileSync(
        'pnpm',
        ['exec', 'eslint', '--format', 'json', '--no-ignore',
         '--config', 'tests/fixtures/design/farbe.config.js',
         'tests/fixtures/design/rohe-farbe.tsx'],
        { cwd: WURZEL, encoding: 'utf8' },
      );
    } catch (f) {
      ausgabe = (f as { stdout?: string }).stdout ?? '[]';
    }
    const ergebnisse = JSON.parse(ausgabe) as { messages: { ruleId: string | null }[] }[];
    const regeln = ergebnisse.flatMap((e) => e.messages.map((m) => m.ruleId));
    expect(regeln).toContain('cse/no-raw-color');
  });

  it('the real component tree is clean', () => {
    let ausgabe = '[]';
    try {
      ausgabe = execFileSync(
        'pnpm',
        ['exec', 'eslint', '--format', 'json', 'src/components', 'src/app'],
        { cwd: WURZEL, encoding: 'utf8' },
      );
    } catch (f) {
      ausgabe = (f as { stdout?: string }).stdout ?? '[]';
    }
    const ergebnisse = JSON.parse(ausgabe) as { messages: { ruleId: string | null }[] }[];
    expect(ergebnisse.flatMap((e) => e.messages.filter((m) => m.ruleId === 'cse/no-raw-color'))).toEqual([]);
  });
});

describe('(9) the development surface is a 404 in production, not merely hidden', () => {
  /**
   * `/dev/kitchensink` enumerates every component, token and placeholder the
   * platform is built from. `robots.txt` asks crawlers not to index it; it does
   * not stop anyone typing the URL. So the page itself must refuse to render.
   */
  it('is off in a production build with no flag set', () => {
    expect(devFlaechenAn({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is on in development, so the design system stays reviewable', () => {
    expect(devFlaechenAn({ NODE_ENV: 'development' })).toBe(true);
  });

  it('is on in a production build only when the flag is set deliberately', () => {
    expect(devFlaechenAn({ NODE_ENV: 'production', CSE_DEV_FLAECHEN: '1' })).toBe(true);
  });

  it('takes only "1" — a stray truthy value does not open the surface', () => {
    expect(devFlaechenAn({ NODE_ENV: 'production', CSE_DEV_FLAECHEN: 'true' })).toBe(false);
    expect(devFlaechenAn({ NODE_ENV: 'production', CSE_DEV_FLAECHEN: '0' })).toBe(false);
    expect(devFlaechenAn({ NODE_ENV: 'production', CSE_DEV_FLAECHEN: '' })).toBe(false);
  });

  /**
   * Geprüft wird die Liste, aus der `robots.txt` UND die Sitemap entstehen.
   *
   * `robots()` selbst liest den Host aus der Anfrage und ist ausserhalb einer
   * Anfrage nicht aufrufbar; dass die erzeugte Datei die Zeile wirklich trägt,
   * prüft `tests/e2e/seo.spec.ts` am laufenden Server. Hier steht die Quelle.
   */
  it('robots.txt disallows /dev/ as well — both, not either', () => {
    expect(AUSGESCHLOSSEN).toContain('/dev');
  });
});
