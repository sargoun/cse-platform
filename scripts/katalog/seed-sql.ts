/**
 * Schreibt den Seed-Block von `0008` aus dem erzeugten Katalog.
 *
 * Zwischen Dokument, TypeScript-Katalog und Migration steht damit genau eine
 * Ableitungskette. Ein Test prüft, dass der Block in der Migration der ist,
 * den dieses Skript erzeugt — drift ist damit ein roter Build, kein Fund im
 * Betrieb.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';

const WURZEL = resolve(import.meta.dirname, '../..');
export const MIGRATION = join(WURZEL, 'drizzle/0008_berechtigung_matrix.sql');
export const BEGINN = '-- <<< generiert aus docs §12 via `pnpm katalog` — nicht von Hand ändern';
export const ENDE = '-- >>> Ende des generierten Katalogs';

const q = (s: string): string => `'${s.replace(/'/gu, "''")}'`;

/** Ein deutsches Label, das im Rechte-Editor lesbar ist. */
function bezeichnung(schluessel: string): string {
  return schluessel;
}

export function erzeugeSeed(): string {
  const zeilen: string[] = [BEGINN, ''];

  zeilen.push('insert into berechtigung (schluessel, modul, objekt, aktion, bezeichnung, nur_global, sortierung) values');
  zeilen.push(
    KATALOG.map((e, i) =>
      `  (${q(e.schluessel)}, ${q(e.modul)}, ${q(e.objekt)}, ${q(e.aktion)}::berechtigung_aktion, `
      + `${q(bezeichnung(e.schluessel))}, ${String(e.nurGlobal)}, ${String(i)})`,
    ).join(',\n') + ';',
  );
  zeilen.push('');

  /**
   * Die Plattform-Vorgaben: `mandant_id IS NULL`. Nur die `✔`-Zellen werden
   * gebunden — `○` heisst "in der UI bindbar", und eine Vorgabe daraus zu
   * machen hiesse, die Matrix umzuschreiben.
   */
  zeilen.push('insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)');
  const paare = KATALOG.flatMap((e) => e.gebunden.map((r) => [r, e.schluessel] as const));
  zeilen.push('select r.id, b.id, null, true from (values');
  zeilen.push(
    paare.map(([rolle, schluessel]) => `  (${q(rolle)}, ${q(schluessel)})`).join(',\n'),
  );
  zeilen.push(') as v(rolle, schluessel)');
  zeilen.push('join rolle r on r.schluessel = v.rolle and r.mandant_id is null');
  zeilen.push('join berechtigung b on b.schluessel = v.schluessel;');
  zeilen.push('');
  zeilen.push(ENDE);
  zeilen.push('');
  return zeilen.join('\n');
}

export function blockAus(inhalt: string): string | null {
  const von = inhalt.indexOf(BEGINN);
  const bis = inhalt.indexOf(ENDE);
  if (von < 0 || bis < 0) return null;
  return inhalt.slice(von, bis + ENDE.length + 1);
}

const direkt = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (direkt) {
  const block = erzeugeSeed();
  const inhalt = readFileSync(MIGRATION, 'utf8');
  const alt = blockAus(inhalt);
  writeFileSync(
    MIGRATION,
    alt === null ? `${inhalt.replace(/\s*$/u, '')}\n\n${block}` : inhalt.replace(alt, block),
  );
  process.stdout.write(`Seed geschrieben: ${KATALOG.length} Rechte\n`);
}
