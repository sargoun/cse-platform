/**
 * **Eine Kachel, die ein Weg ist, sagt es — im Ruhezustand.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund (Nutzerbericht, zwei Bilder).**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Auf dem Posteingangsschirm öffnet die Kachel „Neue Anfragen" eine Seite.
 * Auf dem Reklamationsschirm tut die Kachel „Vorgänge" nichts. Die beiden
 * Bilder, nebeneinandergelegt, sind **Pixel für Pixel gleich**: dieselbe
 * Fläche, derselbe Rand, dasselbe Kachelsymbol, kein Unterschied.
 *
 *     „في ايقونات بينكبس عليها بتفتحلك صفحة تانية وفي ايقونات ما بينكبس
 *      عليها… وشوف مافي فرق بيناتهن بالتصميم ابدا"
 *
 * Die Hover-Regel aus DESIGN §5 gab es schon. Sie antwortet nur **zu spät**:
 * erst, wenn der Zeiger bereits auf der Kachel liegt — und auf einem Telefon
 * nie.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was diese Sperrklinke hält.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Ruhezustand trägt seit DESIGN §5 einen `pfeil-rechts` in der Ecke —
 * aber nur, wenn `interaktiv` gesetzt ist. Eine Kachel, die in einem
 * `<Link>` steht und das Prop vergisst, ist damit genau der alte Zustand:
 * ein Weg, den man nicht sieht. **Sein Fehlen ist die andere Hälfte des
 * Signals**, und die ist nur lesbar, solange das Vorhandensein verlässlich
 * ist.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function dateien(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return dateien(p);
    return e.endsWith('.tsx') ? [p] : [];
  });
}

/**
 * Die Spannweite jedes Verweises — `<Link>` UND `<a>`.
 *
 * **Beide, und das ist nicht Bequemlichkeit.** `typedRoutes` prüft `Link
 * href` gegen die bekannten Routen; eine Adresse, die erst zur Laufzeit im
 * Dienst entsteht, kommt da nicht durch, und die Kachelraster benutzen
 * deshalb ein gewöhnliches `<a>` (dieselbe Entscheidung wie in
 * `Vorgangskopf.tsx`). Eine Sperrklinke, die nur `<Link>` kennt, übersähe
 * genau die Bildschirme, auf denen die meisten Kacheln stehen.
 *
 * Gezählt wird die SCHACHTELUNG, nicht das erste Ende: ein Verweis um eine
 * Kachel, in der ein zweiter steht, endete sonst zu früh und die äussere
 * Kachel fiele aus der Prüfung.
 */
function linkSpannen(inhalt: string): readonly (readonly [number, number])[] {
  const spannen: (readonly [number, number])[] = [];
  const muster = /<Link\b|<\/Link>|<a\b|<\/a>/gu;
  const stapel: number[] = [];
  for (const m of inhalt.matchAll(muster)) {
    const i = m.index ?? 0;
    if (m[0] === '</Link>' || m[0] === '</a>') {
      const start = stapel.pop();
      if (start !== undefined) spannen.push([start, i] as const);
    } else {
      stapel.push(i);
    }
  }
  return spannen;
}

describe('eine Kachel, die ein Weg ist, zeigt es im Ruhezustand', () => {
  const alle = dateien(SRC);

  it('es gibt Kacheln zu prüfen', () => {
    const anzahl = alle.reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/<KpiStat/gu)?.length ?? 0), 0);
    expect(anzahl).toBeGreaterThan(100);
  });

  it('keine Kachel steht in einem Verweis, ohne es zu zeigen', () => {
    const befunde: string[] = [];
    for (const f of alle) {
      const inhalt = readFileSync(f, 'utf8');
      if (!inhalt.includes('<KpiStat')) continue;
      const spannen = linkSpannen(inhalt);
      if (spannen.length === 0) continue;
      for (const m of inhalt.matchAll(/<KpiStat[\s\S]*?\/>/gu)) {
        const i = m.index ?? 0;
        const drin = spannen.some(([a, b]) => a < i && i < b);
        if (!drin) continue;
        if (/\binteraktiv\b/u.test(m[0])) continue;
        const zeile = inhalt.slice(0, i).split('\n').length;
        befunde.push(`${relative(SRC, f)}:${String(zeile)}`);
      }
    }
    expect(
      befunde,
      'Kacheln in einem Verweis ohne `interaktiv` — ein Weg, den man nicht sieht',
    ).toEqual([]);
  });

  /**
   * Die Gegenrichtung: `interaktiv` an einer Kachel, die in keinem Verweis
   * steht, verspricht einen Weg, den es nicht gibt. Der Pfeil zeigt dann ins
   * Leere, und das ist dieselbe Lüge in die andere Richtung.
   */
  it('keine Kachel zeigt einen Weg, den es nicht gibt', () => {
    const befunde: string[] = [];
    for (const f of alle) {
      const inhalt = readFileSync(f, 'utf8');
      if (!inhalt.includes('<KpiStat')) continue;
      const spannen = linkSpannen(inhalt);
      for (const m of inhalt.matchAll(/<KpiStat[\s\S]*?\/>/gu)) {
        const i = m.index ?? 0;
        if (!/\binteraktiv\b/u.test(m[0])) continue;
        if (spannen.some(([a, b]) => a < i && i < b)) continue;
        const zeile = inhalt.slice(0, i).split('\n').length;
        befunde.push(`${relative(SRC, f)}:${String(zeile)}`);
      }
    }
    expect(befunde, 'Kacheln mit `interaktiv` ausserhalb jedes Verweises').toEqual([]);
  });
});
