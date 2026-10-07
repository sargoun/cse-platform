/**
 * **Teams pflegen: jeder Grund und jeder Erfolg hat einen Satz** (V-378,
 * O-650, D-813) — de und en.
 *
 * Die Route schickt nur Schlüssel zurück (`?erfolg=<vorgang>`,
 * `?fehler=<grund>`); die Seite schlägt sie nach. Ein Schlüssel ohne Satz
 * stünde als „Der Vorgang wurde abgewiesen." da.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KALENDER_TEAMS_TEXTE } from '../../src/lib/i18n/verwaltung/kalender-teams.js';
import { TEAM_ROLLEN_VORSCHLAG } from '../../src/server/services/kern/team.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

describe('V-378 — die Sätze der Teamseite', () => {
  const dienst = lies('src/server/services/kern/team.ts');
  const route = lies('src/app/api/kalender/teams/route.ts');
  const gruende = [...new Set([...`${dienst}\n${route}`.matchAll(/new TeamFehler\('([a-z_]+)'\)/gu)]
    .map((m) => m[1] ?? ''))];
  const vorgaenge = [...new Set([...route.matchAll(/vorgang === '([a-z_]+)'/gu)].map((m) => m[1] ?? ''))];

  it('liest der Test noch?', () => {
    expect(gruende).toEqual(expect.arrayContaining(['ohne_name', 'schon_mitglied']));
    expect(vorgaenge.sort()).toEqual(['anlegen', 'beenden', 'zuordnen']);
  });

  it.each(['de', 'en'] as const)('%s: jeder Grund und jeder Erfolg', (sprache) => {
    const t = KALENDER_TEAMS_TEXTE[sprache];
    for (const g of gruende) expect(t.fehler[g], `${sprache}: ${g}`).toBeTruthy();
    for (const v of vorgaenge) expect(t.erfolg[v], `${sprache}: ${v}`).toBeTruthy();
  });

  it('die Vorschlagsliste der Rollen ist die Voreinstellung zu O-650', () => {
    expect([...TEAM_ROLLEN_VORSCHLAG]).toEqual(['Leitung', 'Stellvertretung', 'Mitglied', 'Springer']);
  });
});
