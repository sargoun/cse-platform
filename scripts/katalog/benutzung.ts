/**
 * Wo wird ein Rechteschlüssel tatsächlich BENUTZT?
 *
 * Ein Schlüssel gilt als benutzt, wenn Code ihn prüft — nicht, wenn der
 * Katalog ihn aufzählt. Der erzeugte Seed-Block in `0008` enthält
 * naturgemäss jeden Schlüssel; würde er mitgezählt, wäre jeder Schlüssel
 * immer "benutzt" und die Prüfung eine Tautologie. Genau das ist beim ersten
 * Lauf passiert.
 *
 * Zwei Filter, beide gegen falsch-positive Funde:
 *  - die erzeugten Katalogblöcke werden vor dem Scannen herausgeschnitten;
 *  - ein Treffer, dessen letztes Segment eine Dateiendung ist, ist ein Pfad
 *    (`services/zeit.ts`), kein Schlüssel;
 *  - Kommentare werden entfernt. Ein Schlüssel, der in einem Kommentar
 *    ERWÄHNT wird, wird nicht geprüft — und beim ersten Lauf zählten genau
 *    zwei Erwähnungen in Prosa als Benutzung.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { MODULE } from './extrahiere.js';
import { BEGINN, ENDE } from './seed-sql.js';

const WURZEL = resolve(import.meta.dirname, '../..');

/** Endungen, die einen Treffer als Dateipfad entlarven. */
const ENDUNGEN = new Set(['ts', 'tsx', 'js', 'mjs', 'sql', 'md', 'json', 'css', 'png', 'svg']);

/**
 * Zwei Detektoren, und der zweite ist der wichtigere.
 *
 * `MODUL_LITERAL` findet Schlüssel an ihrem Modul — breit, aber blind für
 * genau den Fall, den die Vorgabe als Fixture nennt: `rechnung.lesen`. Das
 * Modul `rechnung` gibt es nicht (der Schlüssel heisst `finanzen.lesen`), also
 * greift der Modulfilter nicht, und ein erfundener Schlüssel käme durch.
 *
 * `AUFRUF` findet stattdessen die STELLE: was in `hat_recht(…)` steht oder
 * unter `recht:` im Routenmanifest, ist ein Rechteschlüssel — egal, wie sein
 * erstes Segment heisst. Was dort steht und keine Katalogzeile hat, ist ein
 * dauerhaft leerer Bildschirm.
 */
const MODUL_LITERAL = new RegExp(
  `['"\`]((?:${MODULE.join('|')})\\.[a-z_]+(?:\\.[a-z_]+)?)['"\`]`, 'gu',
);

const AUFRUF = /(?:hat_recht|hatRecht)\s*\(\s*['"`]([a-z_.]+)['"`]|\brecht:\s*['"`]([a-z_.]+)['"`]/gu;

function dateien(verzeichnis: string, endungen: readonly string[]): readonly string[] {
  const treffer: string[] = [];
  for (const e of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, e);
    if (statSync(voll).isDirectory()) treffer.push(...dateien(voll, endungen));
    else if (endungen.some((x) => e.endsWith(x))) treffer.push(voll);
  }
  return treffer;
}

/** Entfernt Kommentare: `--`, `//` und `/* … *​/`. */
function ohneKommentare(inhalt: string): string {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .split('\n')
    .map((z) => z.replace(/(^|\s)(--|\/\/).*$/u, '$1'))
    .join('\n');
}

/** Schneidet den erzeugten Katalogblock heraus — er ist die Liste, nicht ihre Benutzung. */
function ohneKatalogblock(inhalt: string): string {
  const von = inhalt.indexOf(BEGINN);
  const bis = inhalt.indexOf(ENDE);
  if (von < 0 || bis < 0) return inhalt;
  return inhalt.slice(0, von) + inhalt.slice(bis + ENDE.length);
}

export interface Fund {
  readonly schluessel: string;
  readonly datei: string;
}

export function funde(): readonly Fund[] {
  const quellen = [
    ...dateien(join(WURZEL, 'src'), ['.ts', '.tsx']),
    ...dateien(join(WURZEL, 'drizzle'), ['.sql']),
  ].filter((d) => !d.endsWith('katalog.generiert.ts'));

  const alle: Fund[] = [];
  for (const datei of quellen) {
    const inhalt = ohneKommentare(ohneKatalogblock(readFileSync(datei, 'utf8')));
    for (const m of inhalt.matchAll(MODUL_LITERAL)) {
      const schluessel = m[1]!;
      if (ENDUNGEN.has(schluessel.split('.').at(-1)!)) continue;
      alle.push({ schluessel, datei: relative(WURZEL, datei) });
    }
    for (const m of inhalt.matchAll(AUFRUF)) {
      const schluessel = m[1] ?? m[2]!;
      // Ein Schlüssel hat mindestens zwei Segmente; `null` und dergleichen
      // sind keine.
      if (!schluessel.includes('.')) continue;
      alle.push({ schluessel, datei: relative(WURZEL, datei) });
    }
  }
  return alle;
}

export function benutzteSchluessel(): ReadonlySet<string> {
  return new Set(funde().map((f) => f.schluessel));
}
