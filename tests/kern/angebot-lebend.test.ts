/**
 * **Das Angebot druckt, zeigt und zählt nur, was darauf steht** (V-202, V-203).
 *
 * Zwei Befunde aus demselben Beleg:
 *
 *  - V-203: Seit 0392 wird eine Position aus einem Entwurf nicht gelöscht,
 *    sondern mit `entfernt_am` markiert. Drei Leser hatten den Filter nicht —
 *    das Dokument, das Kundenportal und die Preisfreigabe. Ein Leser ohne
 *    Filter fällt hier auf, egal in welcher Datei er entsteht.
 *  - V-202: Das Angebotsdokument schrieb „19 %", das Kundenportal für dasselbe
 *    Angebot „19,0 %". D-629 legt `prozentText` als die eine Schreibweise
 *    eines Belegs fest.
 *
 * Das Verhalten gegen die Datenbank prüft
 * `tests/isolation/angebotsentwurf.test.ts` §7.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lebendeLeistungenZahl } from '../../src/server/services/angebot/lebend.js';
import { prozentText } from '../../src/server/services/finanz/prozent.js';

const WURZEL = join(import.meta.dirname, '..', '..');

function quellen(verzeichnis: string): string[] {
  return readdirSync(join(WURZEL, verzeichnis), { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && /\.(?:ts|tsx)$/u.test(d.name))
    .map((d) => join(d.parentPath, d.name));
}

/** Jedes Template-Literal einer Datei, das `angebotsposition` LIEST. */
function leserVonPositionen(datei: string): string[] {
  const text = readFileSync(datei, 'utf8');
  const teile = text.split('`');
  const funde: string[] = [];
  for (let i = 1; i < teile.length; i += 2) {
    const sql = teile[i] ?? '';
    if (!/\b(?:from|join)\s+(?:public\.)?angebotsposition\b/u.test(sql)) continue;
    if (/^\s*(?:insert|update)\b/iu.test(sql)) continue;
    funde.push(sql);
  }
  return funde;
}

describe('V-203 — jede lesende Abfrage auf angebotsposition kennt entfernt_am', () => {
  it('im ganzen Quellbaum', () => {
    const ohne: string[] = [];
    let gesehen = 0;
    for (const datei of quellen('src')) {
      for (const sql of leserVonPositionen(datei)) {
        gesehen += 1;
        if (!/entfernt_am/u.test(sql)) {
          ohne.push(`${relative(WURZEL, datei)}: ${sql.trim().slice(0, 80)}`);
        }
      }
    }
    /* Eine leere Suche sähe aus wie ein sauberer Baum. */
    expect(gesehen).toBeGreaterThanOrEqual(5);
    expect(ohne).toEqual([]);
  });

  it('die Zählung der Leistungen zählt nur lebende Zeilen', () => {
    const sql = lebendeLeistungenZahl('a');
    expect(sql).toMatch(/lp\.entfernt_am is null/u);
    expect(sql).toMatch(/lp\.typ = 'leistung'/u);
    expect(sql).toMatch(/lp\.angebot_id = a\.id/u);
  });

  it('ein Alias ist ein Bezeichner und kein SQL', () => {
    expect(() => lebendeLeistungenZahl('a; drop table angebot')).toThrow(/Tabellenalias/u);
    expect(() => lebendeLeistungenZahl('')).toThrow(/Tabellenalias/u);
  });

  it('Dokument, Freigabe, Versand und Kundenportal fragen den einen Leser', () => {
    const dateien = [
      'src/app/portal/[mandant]/angebote/[id]/pdf/page.tsx',
      'src/app/portal/[mandant]/angebote/[id]/freigabe/page.tsx',
      'src/app/portal/[mandant]/angebote/[id]/versand/page.tsx',
      'src/server/services/kundenportal/angebot.ts',
      'src/server/services/angebot/index.ts',
    ];
    for (const d of dateien) {
      expect(readFileSync(join(WURZEL, d), 'utf8'), d).toMatch(/(?:angebot\/|\.\/)lebend(?:\.js)?'/u);
    }
  });
});

describe('V-202 — ein Angebot schreibt den Steuersatz wie das Kundenportal', () => {
  const seiten = [
    'src/app/portal/[mandant]/angebote/[id]/pdf/page.tsx',
    'src/app/portal/[mandant]/angebote/[id]/page.tsx',
    'src/app/portal/[mandant]/angebote/[id]/freigabe/page.tsx',
    'src/app/portal/kunde/angebote/[id]/page.tsx',
  ];

  it.each(seiten)('%s teilt keine Basispunkte in eine Gleitkommazahl', (seite) => {
    const text = readFileSync(join(WURZEL, seite), 'utf8');
    expect(text).not.toMatch(/_bp\s*\/\s*100\b/u);
    expect(text).not.toMatch(/Bp\s*\/\s*100\b/u);
    expect(text).toMatch(/prozentText\(/u);
  });

  it('19 % heisst auf jedem Angebotsbeleg „19,0 %"', () => {
    expect(prozentText(1900)).toBe('19,0 %');
    expect(prozentText(700)).toBe('7,0 %');
  });
});
