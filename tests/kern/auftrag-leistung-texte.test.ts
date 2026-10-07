/**
 * **Die Leistungszeilen eines Auftrags: jeder Grund und jeder Erfolg hat
 * einen Satz** (V-360, O-921, D-825) — de und en.
 *
 * Die Route schickt nur Schlüssel zurück (`?erfolg=<vorgang>`,
 * `?fehler=<grund>`); die Seite schlägt sie nach. Ein Schlüssel ohne Satz
 * stünde als „Der Vorgang wurde abgewiesen." da. Dazu am Quelltext: die
 * Annahme übernimmt die Positionen, und die Voreinstellung trägt ihr
 * `TODO(client, O-921)` an der Stelle, an der sie gilt.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUFTRAG_LEISTUNGEN_TEXTE } from '../../src/lib/i18n/verwaltung/auftrag-leistungen.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

describe('V-360 — die Sätze der Leistungszeilen', () => {
  const dienst = lies('src/server/services/auftrag/leistung.ts');
  const route = lies('src/app/api/auftrag/leistungen/route.ts');
  const gruende = [...new Set([...`${dienst}\n${route}`.matchAll(/new LeistungFehler\('([a-z_]+)'\)/gu)]
    .map((m) => m[1] ?? ''))];
  const erfolge = [...new Set([...route.matchAll(/erfolg: '([a-z_]+)'/gu)].map((m) => m[1] ?? ''))];

  it('liest der Test noch?', () => {
    expect(gruende).toEqual(expect.arrayContaining([
      'unbekannter_auftrag', 'auftrag_beendet', 'kein_steuersatz', 'zeit_danach',
      'schichten_danach', 'unbekannter_vorgang',
    ]));
    expect(erfolge.sort()).toEqual(['angelegt', 'beendet', 'preis']);
  });

  it.each(['de', 'en'] as const)('%s: jeder Grund und jeder Erfolg', (sprache) => {
    const t = AUFTRAG_LEISTUNGEN_TEXTE[sprache];
    for (const g of gruende) expect(t.fehler[g], `${sprache}: ${g}`).toBeTruthy();
    for (const e of erfolge) expect(t.erfolg[e], `${sprache}: ${e}`).toBeTruthy();
  });

  it('beide Sprachen führen dieselben Schlüssel', () => {
    const { de, en } = AUFTRAG_LEISTUNGEN_TEXTE;
    expect(Object.keys(en.fehler).sort()).toEqual(Object.keys(de.fehler).sort());
    expect(Object.keys(en.erfolg).sort()).toEqual(Object.keys(de.erfolg).sort());
  });

  it('die Annahme übernimmt die Leistungspositionen, ab dem Start des Auftrags', () => {
    const angebot = lies('src/server/services/angebot/index.ts');
    expect(angebot).toMatch(
      /uebernehmeAngebotspositionen\(db, angebotId, auftrag\.id, eingabe\.startDatum\)/u);
    const uebernahme = lies('src/server/services/auftrag/leistung-uebernahme.ts');
    expect(uebernahme).toContain(`ap.typ = 'leistung'`);
  });

  it('die Voreinstellung trägt ihr TODO dort, wo sie gilt, und die Seite nennt sie', () => {
    expect(dienst).toMatch(/TODO\(client, O-921\): Voreinstellung/u);
    expect(AUFTRAG_LEISTUNGEN_TEXTE.de.neuHinweis).toContain('Voreinstellung O-921');
    expect(AUFTRAG_LEISTUNGEN_TEXTE.en.neuHinweis).toContain('default O-921');
  });

  it('das Blatt des Auftrags führt zu den Leistungszeilen', () => {
    const blatt = lies('src/app/portal/[mandant]/auftraege/[id]/page.tsx');
    expect(blatt).toContain('data-cse="zu-den-leistungen"');
    expect(blatt).toContain('/auftraege/${id}/leistungen');
  });
});
