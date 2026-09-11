/**
 * Jede `insert`-Anweisung im Baum nennt Spalten, die es WIRKLICH gibt.
 *
 * **Der Fehler, gegen den diese Datei steht, ist zweimal passiert.**
 * `src/app/api/anfrage/route.ts` schrieb `dokument.dateiname` und
 * `dokument.sha256`; `services/bau/behinderung.ts` tat dasselbe. Beide Spalten
 * gibt es nicht — der Digest lebt seit `0009` in `dokument_version`. Die
 * Anweisungen scheiterten deshalb IMMER, aber nur auf einem Pfad, den weder
 * ein Test noch die Demo je betrat: eine Angebotsanfrage MIT Datei UND
 * verbundenem Speicher. Monatelang stand da eine Zeile, die im Betrieb sofort
 * geworfen haette.
 *
 * `tsc` findet das nicht: SQL ist fuer den Uebersetzer eine Zeichenkette. Ein
 * Test, der jeden Aufrufweg durchspielt, faende es auch nicht — er muesste
 * jeden Pfad kennen. Diese Pruefung braucht keinen Pfad: sie liest die
 * Spaltenlisten aus dem Quelltext und haelt sie gegen `information_schema`.
 *
 * **Was sie NICHT prueft:** Reihenfolge, Typen, Anzahl der Werte. Das ist
 * Aufgabe der Datenbank und der Fachtests. Hier geht es um die eine Klasse von
 * Fehlern, die sich erst in Produktion zeigt und dort nach einem Tippfehler
 * aussieht.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { schliessen, sql } from './harness.js';

const WURZEL = resolve(import.meta.dirname, '../..');

function dateien(verzeichnis: string): readonly string[] {
  const treffer: string[] = [];
  const gehe = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner)) {
      const pfad = join(ordner, eintrag);
      if (statSync(pfad).isDirectory()) {
        if (eintrag === 'node_modules' || eintrag === '.next') continue;
        gehe(pfad);
      } else if (pfad.endsWith('.ts') || pfad.endsWith('.tsx')) {
        treffer.push(pfad);
      }
    }
  };
  gehe(join(WURZEL, verzeichnis));
  return treffer;
}

interface Fundstelle {
  readonly datei: string;
  readonly zeile: number;
  readonly tabelle: string;
  readonly spalten: readonly string[];
}

/**
 * `insert into <tabelle> (<spalten>)` — und sonst nichts.
 *
 * Eine Spaltenliste enthaelt keine Klammern; alles mit `(` darin ist ein
 * `insert … select` oder eine Funktion und wird uebersprungen. Ebenso alles
 * mit `${`: ein zur Laufzeit gebauter Name laesst sich hier nicht pruefen, und
 * ihn zu raten waere schlechter als ihn auszulassen.
 */
const MUSTER = /insert\s+into\s+([a-z_][a-z0-9_.]*)\s*\(([^)]*?)\)/giu;

function fundstellen(): readonly Fundstelle[] {
  const gefunden: Fundstelle[] = [];
  for (const datei of [...dateien('src'), ...dateien('scripts')]) {
    const inhalt = readFileSync(datei, 'utf8');
    for (const treffer of inhalt.matchAll(MUSTER)) {
      const tabelle = treffer[1] ?? '';
      const rohSpalten = treffer[2] ?? '';
      if (rohSpalten.includes('${') || tabelle.includes('${')) continue;
      const spalten = rohSpalten
        .split(',')
        .map((s) => s.replace(/--[^\n]*/gu, '').trim())
        .filter((s) => s !== '');
      if (spalten.length === 0) continue;
      // Ein Name, der kein Bezeichner ist, kommt aus einer Anweisung, die das
      // Muster falsch getroffen hat — nicht aus einer Spaltenliste.
      if (spalten.some((s) => !/^[a-z_][a-z0-9_]*$/u.test(s))) continue;
      const zeile = inhalt.slice(0, treffer.index).split('\n').length;
      gefunden.push({ datei: relative(WURZEL, datei), zeile, tabelle, spalten });
    }
  }
  return gefunden;
}

afterAll(async () => { await schliessen(); });

describe('keine `insert`-Anweisung nennt eine Spalte, die es nicht gibt', () => {
  it('jede Spalte steht in `information_schema.columns`', async () => {
    const stellen = fundstellen();
    // Ohne diese Zusage bestuende der Test auch, wenn das Muster nichts faende.
    expect(stellen.length).toBeGreaterThan(50);

    const bekannt = new Map<string, Set<string>>();
    for (const z of await sql.unsafe<{ schema: string; tabelle: string; spalte: string }[]>(
      `select table_schema as schema, table_name as tabelle, column_name as spalte
         from information_schema.columns
        where table_schema in ('public', 'kern', 'app', 'auth', 'zeit_intern')`,
    )) {
      for (const schluessel of [`${z.schema}.${z.tabelle}`, z.tabelle]) {
        const menge = bekannt.get(schluessel) ?? new Set<string>();
        menge.add(z.spalte);
        bekannt.set(schluessel, menge);
      }
    }

    const fehler: string[] = [];
    for (const s of stellen) {
      const spaltenDerTabelle = bekannt.get(s.tabelle);
      // Eine Tabelle, die es nicht gibt, ist ein eigener Befund — aber kein
      // Grund, hier zu raten: sie kann in einer Migration stehen, die diese
      // Datenbank nicht kennt (etwa `auth.users` der Attrappe).
      if (spaltenDerTabelle === undefined) continue;
      for (const spalte of s.spalten) {
        if (!spaltenDerTabelle.has(spalte)) {
          fehler.push(`${s.datei}:${String(s.zeile)} — ${s.tabelle}.${spalte}`);
        }
      }
    }

    expect(fehler, 'Diese Spalten gibt es nicht').toEqual([]);
  });

  it('das Muster findet die Stelle wirklich, an der der Fehler saß', () => {
    /**
     * Ohne diesen Fall bestuende der Test auch dann, wenn das Muster genau die
     * Anweisung uebersieht, wegen der es ihn gibt: den Dokumentenschreibweg
     * der oeffentlichen Angebotsanfrage (REQ-04).
     */
    const anfrage = fundstellen().filter(
      (s) => s.datei === 'src/app/api/anfrage/route.ts' && s.tabelle === 'dokument');
    expect(anfrage).toHaveLength(1);
    expect(anfrage[0]!.spalten).toContain('objekt_schluessel');
    expect(anfrage[0]!.spalten).not.toContain('dateiname');
  });

  it('und die Prüfung ist scharf — eine erfundene Spalte fällt durch', async () => {
    const [z] = await sql.unsafe<{ da: boolean }[]>(
      `select exists (select 1 from information_schema.columns
                       where table_name = 'dokument'
                         and column_name = 'dateiname') as da`);
    /**
     * Genau die Spalte, an der beide Fehler hingen. Gaebe es sie, pruefte der
     * Fall oben nichts — und dieser hier meldete es.
     */
    expect(z!.da, '`dokument.dateiname` gibt es nicht — der Digest lebt in dokument_version')
      .toBe(false);
  });
});
