/**
 * PR 1 acceptance (10) — the two custom rules must actually fail a fixture.
 *
 * A lint rule nobody has seen fire is a rule that may not work. These two
 * guard invariants 1 and 5, so each is asserted against a file written to
 * break it.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface EslintMeldung {
  readonly ruleId: string | null;
}
interface EslintErgebnis {
  readonly filePath: string;
  readonly errorCount: number;
  readonly messages: readonly EslintMeldung[];
}

function lint(datei: string, extraConfig?: string): readonly EslintErgebnis[] {
  const args = ['eslint', '--format', 'json', '--no-ignore'];
  if (extraConfig !== undefined) args.push('--config', extraConfig);
  args.push(datei);
  try {
    const out = execFileSync('pnpm', ['exec', ...args], { encoding: 'utf8' });
    return JSON.parse(out) as EslintErgebnis[];
  } catch (fehler) {
    const stdout = (fehler as { stdout?: string }).stdout ?? '[]';
    return JSON.parse(stdout) as EslintErgebnis[];
  }
}

describe('cse/no-float-money (invariant 1)', () => {
  it('fails a fixture typing money as `number`', () => {
    const [ergebnis] = lint('tests/fixtures/lint/geld-als-number.ts');
    expect(ergebnis).toBeDefined();
    const regeln = ergebnis?.messages.map((m) => m.ruleId) ?? [];
    expect(regeln).toContain('cse/no-float-money');
    expect(ergebnis?.errorCount ?? 0).toBeGreaterThan(0);
  });
});

describe('cse/no-client-clock (invariant 5, R-11)', () => {
  it('fails a fixture reading the ambient clock inside a service path', () => {
    const [ergebnis] = lint('tests/fixtures/lint/eigene-uhr.ts', 'tests/fixtures/lint/uhr.config.js');
    expect(ergebnis).toBeDefined();
    const regeln = ergebnis?.messages.map((m) => m.ruleId) ?? [];
    expect(regeln.filter((r) => r === 'cse/no-client-clock')).toHaveLength(2);
  });

  it('permits `new Date(instant)` — parsing a stored instant is not reading a clock', () => {
    const [ergebnis] = lint(
      'tests/fixtures/lint/geparst.ts',
      'tests/fixtures/lint/uhr.config.js',
    );
    const regeln = ergebnis?.messages.map((m) => m.ruleId) ?? [];
    expect(regeln).not.toContain('cse/no-client-clock');
  });
});

describe('the real service tree is clean under both rules', () => {
  it('src/server/services/** passes', () => {
    const ergebnisse = lint('src/server/services');
    const verstoesse = ergebnisse.flatMap((e) =>
      e.messages.filter((m) => m.ruleId?.startsWith('cse/')),
    );
    expect(verstoesse).toEqual([]);
  });
});
