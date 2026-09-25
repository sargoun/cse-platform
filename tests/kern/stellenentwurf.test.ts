/**
 * Der Stellenentwurf durch den Agenten und das Bearbeiten eines Entwurfs —
 * was ohne Datenbank prüfbar ist (REC-02, V-222, D-716).
 *
 *  1. **Die Tatsachen kommen aus Angaben und Dienstplan, nie aus dem Modell**
 *     (Invariante 6): jede Zahl, die der Entwurf nennen darf, steht in den
 *     Tatsachen — und nur die.
 *  2. **Ein gestörter Lauf wird ein Schlüssel der Seite**, nie der Code selbst.
 *  3. **Jeder Grund, den das Bearbeiten werfen kann, hat einen Satz** — de und en.
 *  4. **Die Felder liest EINE Prüfung** für alle drei Wege.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fuelleStellenTatsachen, STELLENANZEIGE_AUFTRAG } from '../../src/server/agent/auftraege.js';
import { kiGrund } from '../../src/server/services/recruiting/stellenentwurf.js';
import { leseStellenfelder } from '../../src/app/api/recruiting/stellen/felder.js';
import { RecruitingFehler } from '../../src/server/services/recruiting/dienst.js';
import { RECRUITING_STELLENENTWURF_TEXTE } from '../../src/lib/i18n/verwaltung/recruiting-stellenentwurf.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

const leser = (name: string) => ({
  abfrage: async <T>(): Promise<readonly T[]> => [{ name } as T],
});

describe('(1) die Tatsachen einer Stellenanzeige (Invariante 6)', () => {
  it('Angaben des Menschen und Zählung des Dienstplans — sonst nichts', async () => {
    const t = await fuelleStellenTatsachen(leser('CSE Dienstleistungen GmbH'), {
      titel: '  Reinigungskraft (m/w/d) ', einsatzort: 'Berlin-Mitte', beginn: 'ab sofort',
      aufgaben: ['Unterhaltsreinigung', '', ' Glasreinigung '], objektId: 'x',
    }, { objektName: 'Kurfürstendamm 21', schichten: 6, fehlendeZusagen: 9 });
    expect(t).toEqual({
      titel: 'Reinigungskraft (m/w/d)',
      gesellschaft: 'CSE Dienstleistungen GmbH',
      zusammenfassung: 'Die Aufgaben: Unterhaltsreinigung; Glasreinigung. Im Dienstplan fehlen '
        + 'für Kurfürstendamm 21 in den nächsten vier Wochen 9 Zusagen in 6 Schichten.',
      ort: 'Berlin-Mitte',
      beginn: 'ab sofort',
    });
  });

  it('ohne Objekt nennt der Entwurf keine Zahl aus dem Dienstplan', async () => {
    const t = await fuelleStellenTatsachen(leser('SSE Security'), {
      titel: 'Sicherheitsmitarbeiter', einsatzort: 'Berlin', beginn: 'ab 01.11.2026',
      aufgaben: [], objektId: null,
    }, null);
    expect(t['zusammenfassung']).toBe('');
    expect(Object.values(t).join(' ')).not.toMatch(/Schichten|Zusagen/u);
  });

  it('der Auftrag geht an die Vorlage, die der Demobetrieb kennt — und nicht in den Posteingang', () => {
    expect(STELLENANZEIGE_AUFTRAG.vorlage).toBe('stellenanzeige_entwurf');
    expect(lies('src/server/agent/modell/demo.ts')).toContain('stellenanzeige_entwurf:');
    const dienst = lies('src/server/services/recruiting/stellenentwurf.ts');
    expect(dienst).toContain('vorlegen: false');
    expect(dienst).toContain("entwurfVonArt: 'agent'");
  });
});

describe('(2) ein gestörter Lauf ist ein Schlüssel der Seite', () => {
  it.each([
    ['NOT_CONNECTED', 'ki_nicht_verfuegbar'],
    ['RESIDENCY_BLOCKED', 'ki_nicht_verfuegbar'],
    ['AUTH_FAILED', 'ki_nicht_verfuegbar'],
    ['BUDGET', 'ki_budget'],
    ['BUDGET_EXCEEDED', 'ki_budget'],
    ['PREIS_FEHLT', 'ki_preis_fehlt'],
    ['ZAHL_ERFUNDEN', 'ki_zahl_erfunden'],
    ['AGENT_INAKTIV', 'ki_agent_aus'],
    ['TIMEOUT', 'ki_gestoert'],
    ['<script>', 'ki_gestoert'],
  ])('%s → %s', (code, grund) => {
    expect(kiGrund(code)).toBe(grund);
  });
});

describe('(3) jeder Grund des Bearbeitens und Vorlegens hat einen Satz — de und en', () => {
  const gruende = (quelle: string): string[] => [...quelle.matchAll(
    /new RecruitingFehler\([\s\S]*?'([a-z_]+)'(?:,\s*\d+)?\)/gu)].map((m) => m[1] ?? '');
  const dienst = lies('src/server/services/recruiting/dienst.ts');
  const vorlegen = dienst.slice(dienst.indexOf('export async function legeStelleVor'),
    dienst.indexOf('\nexport ', dienst.indexOf('export async function legeStelleVor') + 1));
  const entwurf = lies('src/server/services/recruiting/stellenentwurf.ts');
  const liste = [...new Set([
    ...gruende(entwurf.slice(entwurf.indexOf('export async function aendereStelle'))),
    ...gruende(lies('src/app/api/recruiting/stellen/[id]/route.ts')),
    ...gruende(lies('src/app/api/recruiting/stellen/felder.ts')),
    ...gruende(vorlegen),
  ])];

  it('die Liste ist nicht leer — der Test liest noch', () => {
    expect(liste).toEqual(expect.arrayContaining(
      ['falscher_status', 'schon_vorgelegt', 'unbrauchbare_frist']));
  });

  it.each(['de', 'en'] as const)('%s', (sprache) => {
    for (const g of liste) {
      expect(RECRUITING_STELLENENTWURF_TEXTE[sprache].fehler[g], `${sprache}: ${g}`).toBeTruthy();
    }
  });

  it('die Seite schlägt über eigenerEintrag nach — ein Schlüssel wie constructor wird der allgemeine Satz', () => {
    const seite = lies('src/app/portal/[mandant]/recruiting/stellen/[id]/page.tsx');
    expect(seite).toContain('eigenerEintrag(t.fehler, abgewiesen)');
    expect(seite).not.toMatch(/FEHLER\[abgewiesen\]/u);
  });
});

describe('(4) die Felder eines Stellenformulars', () => {
  it('Anforderungen zeilenweise, Stunden in halben Stunden, Frist als Kalendertag', () => {
    const f = leseStellenfelder({
      titel: ' Objektleitung ', beschreibung: ' Text ', anforderungen: 'A\n\n B \n',
      wochenstunden: '38,5', bewerbungsfrist: '2026-11-30', einsatzort: ' ',
    });
    expect(f).toEqual({
      titel: 'Objektleitung', beschreibung: 'Text', anforderungen: ['A', 'B'],
      einsatzort: null, wochenstunden: 38.5, bewerbungsfrist: '2026-11-30',
    });
  });

  it.each([
    [{ wochenstunden: '60,5' }, 'unbrauchbare_stunden'],
    [{ wochenstunden: '0' }, 'unbrauchbare_stunden'],
    [{ bewerbungsfrist: '2026-02-30' }, 'unbrauchbare_frist'],
  ])('%j wird abgewiesen: %s', (felder, grund) => {
    expect(() => leseStellenfelder(felder)).toThrow(RecruitingFehler);
    try {
      leseStellenfelder(felder);
    } catch (fehler: unknown) {
      expect((fehler as RecruitingFehler).grund).toBe(grund);
    }
  });
});
