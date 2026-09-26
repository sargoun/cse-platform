import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { schliessen, sql } from './harness.js';

/**
 * **Jede SQL-Anweisung im Quelltext gegen das echte Schema geparst.**
 *
 * Gefunden vom Durchlauf durch den Produktionsbau: `/personal/nachweise/
 * erfassen` fragte `anstellung.ausgeschieden_am` ab — eine Spalte, die es
 * nicht gibt (sie heisst `austritt`). Die Seite endete für JEDEN Aufruf mit
 * 500, und keine Prüfung sah es: Typprüfung und Lint lesen SQL als Text, und
 * kein Test rief genau diese Seite auf.
 *
 * Diese Prüfung schliesst die ganze Klasse, nicht den einen Fall: sie sammelt
 * jede Zeichenkette, die an `abfrage`, `schreibe`, `unsafe` oder ein
 * `sql`-Tag geht, und lässt Postgres sie mit `PREPARE` gegen die migrierte
 * Testdatenbank auflösen. `PREPARE` führt nichts aus — es parst und löst
 * Tabellen, Spalten und Funktionen auf. Eine falsche Spalte (42703) oder eine
 * fehlende Tabelle (42P01) fällt hier auf, bevor ein Mensch die Seite öffnet.
 *
 * **Was sie auslässt, sagt sie:** eine Anweisung, deren Text erst zur
 * Laufzeit entsteht (ein Spaltenname aus einer Variablen), lässt sich nicht
 * vorher parsen; `${…}` in einem `sql`-Tag wird ein Parameter, in einer
 * gewöhnlichen Zeichenkette ein Platzhalter, und was danach nicht parst,
 * zählt als „nicht prüfbar", nicht als Fehler. Die Zahl der geprüften
 * Anweisungen steht im Test und darf nur wachsen.
 */

const WURZEL = join(__dirname, '..', '..', 'src');

function dateien(ordner: string): string[] {
  const aus: string[] = [];
  for (const name of readdirSync(ordner)) {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) aus.push(...dateien(pfad));
    else if (/\.(ts|tsx)$/u.test(name)) aus.push(pfad);
  }
  return aus;
}

interface Anweisung { readonly datei: string; readonly zeile: number; readonly text: string }

/** Zeichenketten an Datenbankaufrufen — mit `${…}` zu Parametern gemacht. */
function anweisungen(
  wurzeln: readonly string[] = [WURZEL],
  verben: RegExp = /^\s*(select|with|insert|update|delete)\b/iu,
): Anweisung[] {
  const aus: Anweisung[] = [];
  const muster = /(\.(?:abfrage|schreibe|unsafe)(?:<[^>()]*>)?\(\s*|\bsql(?:<[^>()]*>)?)`((?:[^`\\]|\\.)*)`/gsu;
  const platzhalter = /\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gu;
  for (const datei of wurzeln.flatMap((w) => dateien(w))) {
    const quelle = readFileSync(datei, 'utf8');
    for (const m of quelle.matchAll(muster)) {
      const tag = (m[1] ?? '').startsWith('sql');
      const roh = m[2] ?? '';
      if (!verben.test(roh)) continue;
      /*
       * Im `sql`-Tag ist jedes `${…}` ein PARAMETER — daraus werden $1, $2, …
       * In einer gewöhnlichen Zeichenkette ist `${…}` Text, der erst zur
       * Laufzeit entsteht (ein Spaltenname): die Anweisung ist vorher nicht
       * prüfbar und wird ausgelassen, nicht geraten.
       */
      if (!tag && roh.includes('${')) continue;
      let n = 0;
      const text = tag ? roh.replace(platzhalter, () => `$${String(++n)}`) : roh;
      const zeile = quelle.slice(0, m.index).split('\n').length;
      aus.push({ datei: relative(WURZEL, datei), zeile, text });
    }
  }
  return aus;
}

afterAll(async () => { await schliessen(); });

describe('SQL im Quelltext gegen das Schema', () => {
  it('keine Anweisung nennt eine Spalte oder Tabelle, die es nicht gibt', async () => {
    const alle = anweisungen();
    const fehler: string[] = [];
    let geprueft = 0;
    for (const [i, a] of alle.entries()) {
      try {
        /* Eine Verbindung für PREPARE und DEALLOCATE — sonst läge die zweite
           auf einer anderen Sitzung des Pools. */
        await sql.begin(async (tx) => {
          await tx.unsafe(`prepare pruefling_${String(i)} as ${a.text}`);
          await tx.unsafe(`deallocate pruefling_${String(i)}`);
        });
        geprueft += 1;
      } catch (e: unknown) {
        const code = (e as { code?: string }).code ?? '';
        const meldung = (e as Error).message;
        if ((code === '42703' || code === '42P01')
            && !AUSSERHALB_DES_SCHEMAS.some((x) => meldung.includes(x))) {
          fehler.push(`${a.datei}:${String(a.zeile)} — ${meldung}`);
        }
      }
    }
    expect(fehler, fehler.join('\n')).toEqual([]);
    /* Die Sperrklinke: so viele Anweisungen liessen sich mindestens prüfen. */
    expect(geprueft).toBeGreaterThan(GEPRUEFT_MINDESTENS);
  });
});

/**
 * Gemessen beim Einführen: 1975 Anweisungen liessen sich gegen das Schema
 * parsen. Die Grenze liegt knapp darunter — sie soll auffallen, wenn die
 * Sammlung still aufhört zu greifen (ein geändertes Aufrufmuster, das die
 * Suche nicht mehr findet), nicht bei jeder gelöschten Abfrage.
 */
const GEPRUEFT_MINDESTENS = 1900;

/**
 * **Die zweite Hälfte: darf `cse_app` das überhaupt lesen?**
 *
 * Gefunden im selben Durchlauf: `/objekte/[id]/bearbeiten` las
 * `objekt.zutritt_hinweis` und `objekt.bemerkung` direkt — beide sind `cse_app`
 * als SPALTE entzogen (0021, K-05), und die Seite endete für jeden Aufruf mit
 * „permission denied for table objekt". `PREPARE` prüft keine Rechte; ein
 * `EXPLAIN (GENERIC_PLAN)` unter `set role cse_app` tut es — ohne auszuführen
 * und ohne Parameterwerte.
 *
 * **Nur lesende Anweisungen, und nur dort, wo `cse_app` liest:** Seiten und
 * Routen, Dienste, der öffentliche Leser, die Agenten. Schreibende Dienste
 * laufen teils als `cse_job` (Nachtläufe) oder hinter Definer-Funktionen; für
 * sie wäre `cse_app` die falsche Rolle, und ein Treffer wäre keiner.
 */
describe('SQL im Quelltext gegen die Spaltenrechte von cse_app', () => {
  it('keine lesende Anweisung greift auf eine Spalte zu, die cse_app entzogen ist', async () => {
    const lesend = anweisungen(
      ['app', join('server', 'services'), join('server', 'inhalt'), join('server', 'agent')]
        .map((t) => join(WURZEL, t)),
      /^\s*(select|with)\b/iu,
    );
    const fehler: string[] = [];
    let geprueft = 0;
    for (const a of lesend) {
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe('set local role cse_app');
          await tx.unsafe(`explain (generic_plan) ${a.text}`);
        });
        geprueft += 1;
      } catch (e: unknown) {
        if ((e as { code?: string }).code === '42501') {
          fehler.push(`${a.datei}:${String(a.zeile)} — ${(e as Error).message}`);
        }
      }
    }
    expect(fehler, fehler.join('\n')).toEqual([]);
    /* Gemessen beim Einführen: rund 1100 lesende Anweisungen liessen sich so prüfen. */
    expect(geprueft).toBeGreaterThan(1000);
  });
});

/**
 * Tabellen, die es in der Testdatenbank mit Absicht NICHT gibt — je mit Grund.
 *
 *  - `__drizzle_migrations`: das Journal, das `migrate.ts` in der ZIELdatenbank
 *    anlegt, bevor es liest. Die Testdatenbank wird aus Vorlagen gebaut und
 *    führt es nicht.
 *  - `cron.job`: gehört der Erweiterung pg_cron, die es nur auf Supabase gibt;
 *    `ueberwachung.ts` fragt vorher, ob das Schema da ist.
 */
const AUSSERHALB_DES_SCHEMAS: readonly string[] = [
  'relation "__drizzle_migrations" does not exist',
  'relation "cron.job" does not exist',
];
