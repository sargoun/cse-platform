/**
 * **Jede Zeile des Registers trägt einen Grad des Blatts** (Prüfung der
 * Gruppe kalender-dokumente).
 *
 * `docs/VOLLSTAENDIGKEIT.md` kennt drei Grade (Legende: blockiert, behindert,
 * Schönheit) und „falsch" für eine Zeile, die etwas Falsches tat. V-219 bis
 * V-225 trugen „fehlt" — als einzige Zeilen des Blatts —, und die Schwere,
 * mit der das Audit sie eingestuft hatte, ging verloren.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BLATT = readFileSync('docs/VOLLSTAENDIGKEIT.md', 'utf8');

/** Nummer → Grad (vierte Spalte), für jede Registerzeile. */
function grade(): Map<string, string> {
  const m = new Map<string, string>();
  for (const zeile of BLATT.split('\n')) {
    const nr = /^\| (V-\d+) \|/u.exec(zeile)?.[1];
    if (nr === undefined) continue;
    m.set(nr, (zeile.split(' | ')[3] ?? '').trim());
  }
  return m;
}

describe('die Grade im Register', () => {
  it('jede Zeile: blockiert, behindert, Schönheit oder falsch', () => {
    const erlaubt = new Set(['blockiert', 'behindert', 'Schönheit', 'falsch']);
    const fremd = [...grade()].filter(([, g]) =>
      !erlaubt.has(g.replace(/^schoenheit$/u, 'Schönheit')));
    expect(fremd).toEqual([]);
  });

  it('V-219 bis V-225 tragen den Grad des Audits (Befunde 46 bis 53)', () => {
    const g = grade();
    expect(Object.fromEntries(
      ['V-219', 'V-220', 'V-221', 'V-222', 'V-223', 'V-224', 'V-225'].map((v) => [v, g.get(v)]),
    )).toEqual({
      'V-219': 'blockiert', 'V-220': 'behindert', 'V-221': 'blockiert', 'V-222': 'behindert',
      'V-223': 'behindert', 'V-224': 'blockiert', 'V-225': 'behindert',
    });
  });
});
