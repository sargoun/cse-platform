/**
 * **Eine Zelle ist einzeilig — und ein Datenbankwert weiss das nicht.**
 *
 * Drei Dienste erzeugen Markdown-Tabellen aus Werten, die jemand in ein
 * Formular geschrieben hat: die Verfahrensdokumentation (ACC-10), das
 * Verarbeitungsverzeichnis und das Löschkonzept (LEG-09). Ein Firmenname oder
 * eine Rechtsgrundlage mit einem Zeilenumbruch darin beendet die Tabelle an
 * dieser Stelle; alles danach wird zu freien Zeilen, eine davon womöglich zu
 * einer neuen Kopfzeile.
 *
 * **Das Dokument sieht danach aus wie ein Dokument.** Es geht an eine
 * Aufsicht, und dort fehlt eine Zeile, die niemand vermisst, weil niemand
 * weiss, dass sie da sein sollte. Gemeldet hat es die Copilot-Runde auf PR 17.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { markdownZelle } from '../../src/lib/markdown.js';

describe('markdownZelle', () => {
  it('maskiert den senkrechten Strich', () => {
    expect(markdownZelle('a | b')).toBe('a \\| b');
  });

  it('macht aus jedem Zeilenumbruch ein Leerzeichen — auch aus dem alten Mac-`\\r`', () => {
    expect(markdownZelle('Zeile 1\nZeile 2')).toBe('Zeile 1 Zeile 2');
    expect(markdownZelle('Zeile 1\r\nZeile 2')).toBe('Zeile 1 Zeile 2');
    expect(markdownZelle('Zeile 1\rZeile 2')).toBe('Zeile 1 Zeile 2');
  });

  it('eine Tabellenzeile bleibt eine Zeile', () => {
    const zelle = markdownZelle('Muster GmbH\n| Kopf | Kopf |\n|---|---|');
    expect(`| ${zelle} | x |`.split('\n').length).toBe(1);
  });

  it('lässt heilen Text in Ruhe', () => {
    expect(markdownZelle('§ 147 AO')).toBe('§ 147 AO');
  });
});

/**
 * **Die Maskierung steht an EINER Stelle** — drei Kopien wären drei
 * Gelegenheiten, eine davon zu vergessen, und genau das war der Befund: zwei
 * Dienste maskierten den Strich und liessen den Umbruch stehen.
 */
describe('keine zweite Maskierung neben der gemeinsamen', () => {
  const WURZEL = fileURLToPath(new URL('../../src/server/services', import.meta.url));

  /**
   * `freigabe/diff.ts` ist ausgenommen, und zwar begründet: es maskiert
   * Backslash UND Strich, um Felder mit `|` zu VERKETTEN — eine
   * verlustfreie Kodierung, kein Markdown. Ein Umbruch darf dort gerade
   * nicht zum Leerzeichen werden, das verfälschte den Vergleichstext.
   */
  const AUSNAHMEN = ['freigabe/diff.ts'];

  function dateien(ordner: string): string[] {
    return readdirSync(ordner).flatMap((n) => {
      const pfad = join(ordner, n);
      if (statSync(pfad).isDirectory()) return dateien(pfad);
      return pfad.endsWith('.ts') ? [pfad] : [];
    });
  }

  it('kein Dienst maskiert den Strich noch einmal selbst', () => {
    const treffer = dateien(WURZEL)
      .filter((p) => !AUSNAHMEN.some((a) => p.replaceAll('\\', '/').endsWith(a)))
      .filter((p) => /replaceAll\('\|'|replace\(\/\\\|\/g/u.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(WURZEL.length + 1));
    expect(treffer, 'eigene Strich-Maskierung statt `markdownZelle` aus `lib/markdown`')
      .toEqual([]);
  });
});
