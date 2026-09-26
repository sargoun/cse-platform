/**
 * Das Bewerbungspostfach ist ein Vertrag, kein vorgetäuschter Anschluss
 * (REC-03, V-224, D-718, CLAUDE.md „No fake integrations").
 *
 * Der einzige Adapter holt nichts und sagt das — er gibt keine leere Liste
 * zurück, die aussähe wie ein Postfach ohne Post. Das Register der
 * Anbindungen liest seinen Zustand aus demselben Adapter und nennt die offene
 * Frage.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NichtVerbundenesPostfach, PostfachNichtVerbundenFehler, bewerbungsPostfach,
} from '../../src/server/integrationen/bewerbungspostfach.js';
import { anbindungen } from '../../src/server/registry/integrationen.js';

const WURZEL = resolve(import.meta.dirname, '../..');

describe('das Bewerbungspostfach', () => {
  it('heute gilt der Adapter, der nicht verbunden ist — und er holt nichts', async () => {
    const p = bewerbungsPostfach();
    expect(p).toBeInstanceOf(NichtVerbundenesPostfach);
    expect(p.verbunden).toBe(false);
    await expect(p.holeNeue()).rejects.toBeInstanceOf(PostfachNichtVerbundenFehler);
  });

  it('das Register zeigt „nicht verbunden" mit der offenen Frage', () => {
    const z = anbindungen().find((a) => a.schluessel === 'bewerbungspostfach');
    expect(z).toMatchObject({ stand: 'nicht_verbunden', offen: 'O-938' });
    expect(z!.hinweis).toMatch(/Aus dem Postfach erfassen/u);
  });

  it('die offene Frage steht in DECISIONS unter „Open"', () => {
    const d = readFileSync(resolve(WURZEL, 'docs/DECISIONS.md'), 'utf8');
    const offen = d.slice(d.indexOf('## Open — ask, do not guess'));
    expect(offen).toMatch(/^\| O-938 \|/mu);
  });
});
