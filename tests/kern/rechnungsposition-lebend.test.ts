/**
 * **Die Rechnung zeigt, zählt und bucht nur, was auf dem Beleg steht**
 * (V-356, O-212, D-831).
 *
 * Seit 0522 verlässt eine Position einen Entwurf nicht durch Löschen, sondern
 * mit `entfernt_am`, Person und Grund. Jeder Leser, der den Filter vergisst,
 * zählte sie weiter — in Summen, Nutzlast, XRechnung, Buchung, Kundenportal
 * oder Z3. Ein solcher Leser fällt hier auf, egal in welcher Datei er
 * entsteht: jedes Template, das `rechnungsposition` liest, nennt
 * `entfernt_am` — als Filter oder als ausdrücklicher Vermerk, warum es alle
 * Zeilen liest. Dieselbe Wache wie `angebot-lebend.test.ts` für 0392.
 *
 * Das Verhalten gegen die Datenbank prüft
 * `tests/isolation/rechnungsposition-entfernen.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { steuerzeileAufDemBeleg } from '../../src/server/services/finanz/steuerzeile.js';

const WURZEL = join(import.meta.dirname, '..', '..');

function quellen(verzeichnis: string): string[] {
  return readdirSync(join(WURZEL, verzeichnis), { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && /\.(?:ts|tsx)$/u.test(d.name))
    .map((d) => join(d.parentPath, d.name));
}

/** Jedes Template-Literal einer Datei, das `rechnungsposition` LIEST. */
function leserVonPositionen(datei: string): string[] {
  const teile = readFileSync(datei, 'utf8').split('`');
  const funde: string[] = [];
  for (let i = 1; i < teile.length; i += 2) {
    const sql = teile[i] ?? '';
    // `\b` trennt nicht vor `_`: rechnungsposition_quelle ist eine andere Tabelle.
    if (/\b(?:from|join)\s+(?:public\.)?rechnungsposition\b/u.test(sql)) funde.push(sql);
  }
  return funde;
}

describe('V-356 — jede lesende Abfrage auf rechnungsposition kennt entfernt_am', () => {
  it('im ganzen Quellbaum', () => {
    const ohne: string[] = [];
    let gesehen = 0;
    for (const datei of quellen('src')) {
      for (const sql of leserVonPositionen(datei)) {
        gesehen += 1;
        if (!/entfernt_am/u.test(sql)) {
          ohne.push(`${relative(WURZEL, datei)}: ${sql.trim().slice(0, 90)}`);
        }
      }
    }
    /* Eine leere Suche sähe aus wie ein sauberer Baum. */
    expect(gesehen).toBeGreaterThanOrEqual(25);
    expect(ohne).toEqual([]);
  });

  it('eine leere Steuerzeile gehört nur auf den Beleg, wenn noch etwas sie trägt', () => {
    const sql = steuerzeileAufDemBeleg('s');
    expect(sql).toMatch(/s\.netto_cent <> 0 or s\.steuer_cent <> 0/u);
    expect(sql).toMatch(/lp\.entfernt_am is null/u);
    expect(sql).toMatch(/lp\.positionsart = 'leistung'/u);
    expect(sql).toMatch(/rechnung_zuschlag lz/u);
  });

  it('Nutzlast, Kundenportal und Festschreibeblatt fragen dieselbe Bedingung', () => {
    for (const datei of [
      'src/server/services/finanz/rechnung.ts',
      'src/server/services/kundenportal/rechnung.ts',
      'src/app/portal/[mandant]/finanzen/rechnungen/[id]/festschreiben/page.tsx',
    ]) {
      expect(readFileSync(join(WURZEL, datei), 'utf8'), datei)
        .toContain("steuerzeileAufDemBeleg('s')");
    }
  });

  it('die Migration ersetzt jede Funktion, die Positionen summiert oder zählt', () => {
    const sql = readFileSync(join(WURZEL, 'drizzle/0522_rechnungsposition_entfernen.sql'), 'utf8');
    for (const funktion of [
      'fin.rechnung_summen_stimmig', 'fin.rechnung_beziehung_pruefen',
      'fin.rechnung_ustg14_pflichtfelder', 'fin.auftrag_abschluss_befunde',
    ]) {
      expect(sql).toContain(`create or replace function ${funktion}(`);
    }
    expect(sql).toMatch(/create policy t_kunde on rechnungsposition[\s\S]*entfernt_am is null/u);
  });
});
