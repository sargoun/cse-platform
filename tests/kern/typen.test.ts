/**
 * PR 1 acceptance (8), second half — a type test proving a `number` cannot
 * reach a money parameter.
 *
 * The brand is the first line: `Cent` is `bigint & {…}`, so `19.99` and even
 * `1999` are rejected by the compiler. This asserts it by compiling fixtures
 * and requiring the errors, rather than trusting that the brand is still
 * there — a brand is one `as` away from being useless, and nothing in a diff
 * makes that obvious.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WURZEL = resolve(import.meta.dirname, '../..');

function typpruefe(quelle: string): { ok: boolean; ausgabe: string } {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'cse-typtest-'));
  const datei = join(verzeichnis, 'fall.ts');
  writeFileSync(datei, quelle, 'utf8');
  try {
    execFileSync(
      'pnpm',
      ['exec', 'tsc', '--noEmit', '--strict', '--target', 'ES2022',
       '--module', 'ESNext', '--moduleResolution', 'bundler', datei],
      { cwd: WURZEL, encoding: 'utf8', stdio: 'pipe' },
    );
    return { ok: true, ausgabe: '' };
  } catch (fehler) {
    return { ok: false, ausgabe: String((fehler as { stdout?: string }).stdout ?? '') };
  } finally {
    rmSync(verzeichnis, { recursive: true, force: true });
  }
}

const importiere = (namen: string): string =>
  `import { ${namen} } from ${JSON.stringify(join(WURZEL, 'src/server/services/finanz/geld.ts').replace(/\.ts$/u, '.js'))};\n`;

describe('Cent is branded — a number cannot reach a money parameter', () => {
  it('rejects a float literal', () => {
    const { ok, ausgabe } = typpruefe(`${importiere('addiere, cent')}addiere(19.99 as never as ReturnType<typeof cent>, cent(1n));\naddiere(19.99, cent(1n));\n`);
    expect(ok).toBe(false);
    expect(ausgabe).toMatch(/not assignable to parameter of type 'Cent'/u);
  });

  it('rejects an integer number — cents in a `number` are still the wrong type', () => {
    const { ok, ausgabe } = typpruefe(`${importiere('addiere, cent')}addiere(1999, cent(1n));\n`);
    expect(ok).toBe(false);
    expect(ausgabe).toMatch(/not assignable to parameter of type 'Cent'/u);
  });

  it('rejects a bare bigint — the brand, not merely the primitive, is required', () => {
    const { ok, ausgabe } = typpruefe(`${importiere('addiere, cent')}addiere(1999n, cent(1n));\n`);
    expect(ok).toBe(false);
    expect(ausgabe).toMatch(/not assignable to parameter of type 'Cent'/u);
  });

  it('accepts a value built through the one constructor', () => {
    const { ok, ausgabe } = typpruefe(
      `${importiere('addiere, cent')}const summe = addiere(cent(1999n), cent(1n));\nvoid summe;\n`,
    );
    expect(ausgabe).toBe('');
    expect(ok).toBe(true);
  });

  it('rejects a float rate where basis points are required', () => {
    const { ok } = typpruefe(
      `${importiere('anteilInBasisPunkten, cent')}anteilInBasisPunkten(cent(100n), 0.19);\n`,
    );
    expect(ok).toBe(false);
  });
});
