/**
 * **Stelle schliessen und Rückzug: jeder Grund hat einen Satz** (V-363,
 * D-812) — de und en, wie `formular-rueckwege.test.ts` es für die übrigen
 * Recruiting-Formulare verlangt.
 *
 * Gelesen werden die Gründe aus dem Quelltext von Route und Dienst: ein neuer
 * Grund ohne Satz fällt hier auf, bevor er als „Der Vorgang wurde
 * abgewiesen." auf dem Bildschirm steht.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECRUITING_STELLENENTWURF_TEXTE } from '../../src/lib/i18n/verwaltung/recruiting-stellenentwurf.js';
import { RECRUITING_RUECKZUG_TEXTE } from '../../src/lib/i18n/verwaltung/recruiting-rueckzug.js';
import {
  AKTION_STELLE_GESCHLOSSEN, OFFENE_STAENDE,
} from '../../src/server/services/recruiting/dienst.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

function gruende(quelle: string): readonly string[] {
  return [...new Set([...quelle.matchAll(
    /new RecruitingFehler\([\s\S]*?'([a-z_]+)'(?:,\s*\d+)?\)/gu)].map((m) => m[1] ?? ''))];
}

function funktion(quelle: string, name: string): string {
  const a = quelle.indexOf(`export async function ${name}`);
  expect(a, name).toBeGreaterThan(-1);
  const e = quelle.indexOf('\nexport ', a + 1);
  return quelle.slice(a, e === -1 ? undefined : e);
}

const dienst = lies('src/server/services/recruiting/dienst.ts');

describe('V-363 — jeder Grund hat einen Satz, de und en', () => {
  it('Stelle schliessen', () => {
    const liste = [
      ...gruende(lies('src/app/api/recruiting/stellen/[id]/schliessen/route.ts')),
      ...gruende(funktion(dienst, 'schliesseStelle')),
    ];
    expect(liste).toEqual(expect.arrayContaining(['ohne_grund', 'schon_geschlossen']));
    for (const sprache of ['de', 'en'] as const) {
      for (const g of liste) {
        expect(RECRUITING_STELLENENTWURF_TEXTE[sprache].fehler[g], `${sprache}: ${g}`).toBeTruthy();
      }
    }
  });

  it('Rückzug vermerken', () => {
    const liste = [
      ...gruende(lies('src/app/api/recruiting/bewerbungen/[id]/rueckzug/route.ts')),
      ...gruende(funktion(dienst, 'zieheBewerbungZurueck')),
    ];
    expect(liste).toEqual(expect.arrayContaining(['ohne_vermerk', 'nicht_offen']));
    for (const sprache of ['de', 'en'] as const) {
      for (const g of liste) {
        expect(RECRUITING_RUECKZUG_TEXTE[sprache].fehler[g], `${sprache}: ${g}`).toBeTruthy();
      }
    }
  });
});

describe('V-363 — die festen Grössen', () => {
  it('offen sind genau die drei Stände vor einer Entscheidung', () => {
    expect([...OFFENE_STAENDE]).toEqual(['eingegangen', 'in_pruefung', 'gespraech']);
  });

  it('die Auditaktion ist zusammengesetzt und heisst, was sie tut', () => {
    expect(AKTION_STELLE_GESCHLOSSEN).toBe(['recruiting', 'stelle_geschlossen'].join('.'));
  });

  it('die Bewerbungsseite schickt den Rückzug mit eigenem Vorgang zurück', () => {
    const seite = lies('src/app/portal/[mandant]/recruiting/bewerbungen/[id]/page.tsx');
    expect(seite).toContain('?vorgang=rueckzug');
    expect(seite).toContain('!rueckzugVorgang');
  });
});
