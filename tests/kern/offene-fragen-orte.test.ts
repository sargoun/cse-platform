/**
 * Eine offene Frage nennt die Stellen, an denen ihre Antwort etwas ändert —
 * und die gibt es (V-268, Prüfung der Gruppe kalender-dokumente).
 *
 * **Der Befund.** O-939 nannte als Ort `src/server/services/inhalt/medien.ts`;
 * die Datei gab es nie, `legeBeitragsbildAn` und das `TODO(client, O-939)`
 * stehen in `services/social/beitragsbild.ts`. Wer die Frage beantwortet,
 * hätte an der falschen Stelle gesucht.
 *
 * Geprüft für die offenen Fragen der Gruppe: jeder genannte Pfad besteht, und
 * jede Datei, die das TODO der Frage trägt, steht in ihrer Zeile.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WURZEL = join(import.meta.dirname, '..', '..');
const ENTSCHEIDUNGEN = readFileSync(join(WURZEL, 'docs/DECISIONS.md'), 'utf8');

const FRAGEN = ['O-939', 'O-954', 'O-955'] as const;

function zeile(frage: string): string {
  const z = ENTSCHEIDUNGEN.split('\n').find((l) => l.startsWith(`| ${frage} |`));
  if (z === undefined) throw new Error(`${frage} steht nicht in DECISIONS.md`);
  return z;
}

/** Die Pfade in Backticks — ohne Muster (`{a,b}`, `*`), die sind keine Datei. */
function pfade(text: string): string[] {
  return [...text.matchAll(/`((?:src|drizzle|tests)\/[^`\s]+)`/gu)]
    .map((m) => m[1]!)
    .filter((p) => !/[{}*]/u.test(p));
}

function dateienMit(marke: string): string[] {
  const treffer: string[] = [];
  for (const wurzel of ['src', 'drizzle']) {
    const eintraege = readdirSync(join(WURZEL, wurzel), { recursive: true, encoding: 'utf8' });
    for (const e of eintraege) {
      if (!/\.(?:ts|tsx|sql)$/u.test(e)) continue;
      const pfad = `${wurzel}/${e.split('\\').join('/')}`;
      if (readFileSync(join(WURZEL, pfad), 'utf8').includes(marke)) treffer.push(pfad);
    }
  }
  return treffer;
}

/** Der Abschnitt „Open" — bis zur nächsten Überschrift, nicht bis zum Dateiende. */
function abschnittOffen(): string {
  const start = ENTSCHEIDUNGEN.indexOf('## Open — ask, do not guess');
  const ende = ENTSCHEIDUNGEN.indexOf('\n## ', start + 1);
  return ENTSCHEIDUNGEN.slice(start, ende);
}

describe('offene Fragen nennen bestehende Orte', () => {
  it.each(FRAGEN)('%s steht im Abschnitt „Open"', (frage) => {
    expect(abschnittOffen()).toContain(`\n| ${frage} |`);
  });

  it.each(FRAGEN)('%s: jeder genannte Pfad besteht', (frage) => {
    const genannt = pfade(zeile(frage));
    expect(genannt.length, 'mindestens ein Ort').toBeGreaterThan(0);
    for (const p of genannt) expect(existsSync(join(WURZEL, p)), p).toBe(true);
  });

  it.each(FRAGEN)('%s: jede Datei mit seinem TODO steht in der Zeile', (frage) => {
    const genannt = pfade(zeile(frage));
    const mitTodo = dateienMit(`TODO(client, ${frage})`);
    expect(mitTodo.length, 'das TODO steht im Code').toBeGreaterThan(0);
    for (const d of mitTodo) expect(genannt, d).toContain(d);
  });
});
