/**
 * **Der Migrator nummeriert nicht, er sortiert.**
 *
 * `src/server/db/migrate.ts` wendet `drizzle/*.sql` in Dateireihenfolge an —
 * `readdirSync(...).sort()`, eine Zeichenkettensortierung. Zwei Dateien mit
 * derselben Nummer sind für ihn keine Fehlermeldung, sondern zwei
 * Migrationen in unbestimmter Reihenfolge; genau das hat
 * `ABGLEICH-AUFTRAG.md` beim Zusammenführen zweier Zweige festgehalten
 * (0085, 0087, 0088 doppelt vergeben, 0086 reserviert). Eine Nummer ohne
 * führende Nullen (`999_…`) stünde in der Zeichenkettensortierung HINTER
 * `0168_…` und vor nichts — sie liefe zuletzt, gleich welche Zahl sie trägt.
 *
 * Deshalb steht die Regel hier als Prüfung, nicht als Satz in einer
 * Handreichung (D-582): jede Datei trägt vier Ziffern und einen Namen, keine
 * Nummer kommt zweimal vor, die Reihenfolge nach Zeichenkette ist die
 * Reihenfolge nach Zahl, und der Migrator sortiert noch.
 *
 * Lücken sind erlaubt: 0037–0039, 0043–0049, 0053–0059 und 0086 sind
 * absichtlich frei geblieben, und eine Lücke ändert die Reihenfolge nicht.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ORDNER = fileURLToPath(new URL('../../drizzle', import.meta.url));
const MIGRATOR = fileURLToPath(new URL('../../src/server/db/migrate.ts', import.meta.url));
const FORM = /^(\d{4})_[a-z0-9_]+\.sql$/u;

const dateien = readdirSync(ORDNER);

describe('Migrationsnummern (D-582)', () => {
  it('es gibt Migrationen zu pruefen', () => {
    expect(dateien.length).toBeGreaterThan(100);
  });

  it('jede Datei unter drizzle/ traegt vier Ziffern, einen Unterstrich und einen Namen', () => {
    expect(dateien.filter((d) => !FORM.test(d)),
      'Dateien ausserhalb der Form NNNN_name.sql').toEqual([]);
  });

  it('keine Nummer ist zweimal vergeben', () => {
    const gesehen = new Map<string, string>();
    const doppelt: string[] = [];
    for (const d of dateien) {
      const nummer = FORM.exec(d)?.[1];
      if (nummer === undefined) continue;
      const erste = gesehen.get(nummer);
      if (erste !== undefined) doppelt.push(`${nummer}: ${erste} und ${d}`);
      else gesehen.set(nummer, d);
    }
    expect(doppelt, 'zwei Migrationen in unbestimmter Reihenfolge').toEqual([]);
  });

  it('die Reihenfolge nach Zeichenkette ist die Reihenfolge nach Zahl', () => {
    const nachText = [...dateien].sort();
    const nachZahl = [...dateien].sort((a, b) =>
      Number(FORM.exec(a)?.[1] ?? -1) - Number(FORM.exec(b)?.[1] ?? -1));
    expect(nachText).toEqual(nachZahl);
  });

  it('der Migrator sortiert noch — sonst prueft das hier die falsche Reihenfolge', () => {
    const quelle = readFileSync(MIGRATOR, 'utf8');
    expect(quelle).toMatch(/readdirSync\(verzeichnis\)[^\n]*\.sort\(\)/u);
  });
});
