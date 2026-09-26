/**
 * **Ein Recht steht als SATZ auf dem Schirm, nicht als Schlüssel.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund (Nutzerbericht).**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     „ان كان ب اي صفحة الكود ظاهر صلحلي ياهن خليه اطار وجملة بدال كود"
 *     — wo auf einer Seite Quelltext steht, mach einen Rahmen und einen
 *     Satz daraus.
 *
 * Über hundert Stellen im Portal zeigten einem Menschen den rohen Schlüssel:
 *
 *     Ihnen fehlt `kalkulation.lesen`; die Spalte bleibt leer.
 *     Bestätigen darf, wer `bau.schreiben` hält.
 *
 * Für die Objektleitung, die das liest, ist `kalkulation.lesen` Quelltext.
 * Sie erfährt, dass ihr etwas fehlt, aber nicht WAS — und kann deshalb auch
 * nicht danach fragen. Ein Hinweis, den der Adressat nicht in eine Bitte
 * übersetzen kann, ist kein Hinweis.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was diese Sperrklinke hält.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `<Recht schluessel="kalkulation.lesen" />` schreibt „Kalkulationen lesen"
 * und behält den Schlüssel in `title` und `data-recht` — für die
 * Administration, die ihn wortwörtlich braucht, und für die Browserläufe,
 * die nicht am übersetzten Wort hängen dürfen.
 *
 * Geprüft wird die Rückrichtung: **kein Katalogschlüssel darf wieder roh in
 * einem `<code>` landen.** Die nächste Seite, die aus einer bestehenden
 * kopiert wird, bringt den alten Zustand sonst unbemerkt zurück.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { alleRechteschluessel, rechtName } from '../../src/lib/i18n/rechtname.js';

const APP = fileURLToPath(new URL('../../src/app', import.meta.url));

function dateien(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return dateien(p);
    return e.endsWith('.tsx') ? [p] : [];
  });
}

const SCHLUESSEL = new Set(KATALOG.map((e) => e.schluessel));

/**
 * `<code …>irgendwas</code>` — der Inhalt wird getrimmt, weil ein führendes
 * Leerzeichen im Element (`<code> crm.lesen</code>`) genau dieselbe Anzeige
 * ergibt und die Prüfung sonst daran vorbeiliefe.
 */
const CODE = /<code(?:\s[^>]*?)?>\s*([^<>{}]+?)\s*<\/code>/gu;
/**
 * Dieselbe Hülle, aber mit einem Bezeichner darin: `<code>{RECHT}</code>`,
 * `<code>{RECHT_SCHREIBEN}</code>`, `<code>{schreibrecht}</code>`.
 *
 * Gesucht wird das Wort `recht` im Namen, gross wie klein: der Umweg über
 * eine Variable sieht im Quelltext harmlos aus und ergibt auf dem Schirm
 * genau denselben rohen Schlüssel. `ausnahmeSchreibrecht(blatt)` war so
 * einer — eine Zeile, die der Suche nach `RECHT` entging.
 */
const CODE_KONSTANTE = /<code(?:\s[^>]*?)?>\{([A-Za-z_][A-Za-z0-9_]*[Rr]echt[A-Za-z0-9_]*)\}<\/code>/gu;

describe('ein Rechteschlüssel steht als Satz auf dem Schirm', () => {
  const alle = dateien(APP);

  it('die Umstellung ist geschehen und nicht nur beschrieben', () => {
    const treffer = alle.reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/<Recht\b/gu)?.length ?? 0), 0);
    expect(treffer, 'so viele Stellen tragen den Satz').toBeGreaterThan(100);
  });

  it('kein Katalogschlüssel steht roh in einem `code`-Element', () => {
    const befunde: string[] = [];
    for (const f of alle) {
      const inhalt = readFileSync(f, 'utf8');
      if (!inhalt.includes('<code')) continue;
      for (const m of inhalt.matchAll(CODE)) {
        if (!SCHLUESSEL.has(m[1] ?? '')) continue;
        const zeile = inhalt.slice(0, m.index ?? 0).split('\n').length;
        befunde.push(`${relative(APP, f)}:${String(zeile)} — ${m[1] ?? ''}`);
      }
    }
    expect(befunde, 'roher Rechteschlüssel statt `<Recht schluessel=…>`').toEqual([]);
  });

  it('auch nicht über den Umweg einer Konstanten', () => {
    const befunde: string[] = [];
    for (const f of alle) {
      const inhalt = readFileSync(f, 'utf8');
      if (!inhalt.includes('<code')) continue;
      for (const m of inhalt.matchAll(CODE_KONSTANTE)) {
        const zeile = inhalt.slice(0, m.index ?? 0).split('\n').length;
        befunde.push(`${relative(APP, f)}:${String(zeile)} — {${m[1] ?? ''}}`);
      }
    }
    expect(befunde, 'ein `RECHT…` in einem `code`-Element ist derselbe Befund').toEqual([]);
  });

  /**
   * Die andere Hälfte: der Satz muss auch für JEDEN Schlüssel entstehen, den
   * eine Seite anzeigen kann. Ein leerer oder roher Rückfall wäre hier das
   * Schlimmste — die Seite sähe aufgeräumt aus und sagte nichts mehr.
   */
  it('jeder Schlüssel des Katalogs ergibt einen Satz ohne Punkt darin', () => {
    const roh = alleRechteschluessel().filter((s) => {
      const de = rechtName(s, 'de');
      const en = rechtName(s, 'en');
      return de.trim() === '' || en.trim() === '' || de.includes('.') || en.includes('.');
    });
    expect(roh, 'Schlüssel ohne Satz — in `rechtname.ts` nachtragen').toEqual([]);
  });
});
