/**
 * Die beiden Register der Einstellungen (D-477): Anbindungen und
 * Auftragsverarbeiter. Was hier geprueft wird, ist die Zusicherung „nichts
 * wird vorgetaeuscht": ohne Umgebungsvariablen ist nichts verbunden, jede
 * Luecke nennt ihren Grund, und kein Vertragsdatum ist erfunden.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { anbindungen, STAND_TEXT } from '../../src/server/registry/integrationen.js';
import { AUFTRAGSVERARBEITER } from '../../src/server/registry/auftragsverarbeiter.js';

describe('anbindungen()', () => {
  it('jede Zeile hat einen eindeutigen Schluessel, einen Zustand mit Text und einen Hinweis', () => {
    const zeilen = anbindungen();
    expect(zeilen.length).toBeGreaterThanOrEqual(10);
    expect(new Set(zeilen.map((z) => z.schluessel)).size).toBe(zeilen.length);
    for (const z of zeilen) {
      expect(STAND_TEXT[z.stand]).toBeTruthy();
      expect(z.hinweis.length).toBeGreaterThan(20);
      expect(z.zweck.length).toBeGreaterThan(10);
    }
  });

  it('ohne Umgebungsvariablen ist ausser dem Dateiexport nichts verbunden', () => {
    const vorher = {
      url: process.env['SUPABASE_URL'], key: process.env['SUPABASE_SERVICE_ROLE_KEY'],
      dwd: process.env['DWD_BASIS_URL'],
    };
    delete process.env['SUPABASE_URL'];
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    try {
      const zeilen = anbindungen();
      expect(zeilen.filter((z) => z.stand === 'verbunden').map((z) => z.schluessel))
        .not.toContain('speicher');
      expect(zeilen.find((z) => z.schluessel === 'datev')?.stand).toBe('dateiexport');
      // Was noch nicht gewaehlt ist, verweist auf die Frage, die es klaert (D-477).
      const mitFrage = zeilen.filter((z) => z.offen !== null).map((z) => z.schluessel).sort();
      /*
       * `altsystem` kam mit `/einstellungen/import` dazu (O-128): die
       * Uebernahme aus Aplano, Lexware und den Excel-Dateien ist eine
       * Anbindung wie jede andere, und sie stand in dieser Liste nicht. Ihr
       * Zustand kommt aus demselben Port, der eine Datei annehmen wuerde —
       * eine zweite Liste verpasste den Tag, an dem ein Parser dazukommt.
       */
      expect(mitFrage).toEqual(
        ['altsystem', 'email', 'karte', 'modell', 'n8n', 'ocr', 'sms']);
      for (const z of zeilen.filter((z) => z.offen !== null)) expect(z.offen).toMatch(/^O-\d+$/u);
    } finally {
      if (vorher.url !== undefined) process.env['SUPABASE_URL'] = vorher.url;
      if (vorher.key !== undefined) process.env['SUPABASE_SERVICE_ROLE_KEY'] = vorher.key;
      if (vorher.dwd !== undefined) process.env['DWD_BASIS_URL'] = vorher.dwd;
    }
  });
});

describe('AUFTRAGSVERARBEITER', () => {
  it('nennt die drei Dienste des Stacks mit EU-Region — und kein erfundenes Vertragsdatum', () => {
    expect(AUFTRAGSVERARBEITER.map((v) => v.schluessel).sort()).toEqual(['openai', 'supabase', 'vercel']);
    for (const v of AUFTRAGSVERARBEITER) {
      expect(v.region).toMatch(/^EU/u);
      expect(v.vertragAm).toBeNull();
      expect(v.grundlage).toContain('D-04');
    }
  });
});

/**
 * **Zwei Listen derselben Sache laufen auseinander — also prüft sie ein Test.**
 *
 * `config/rag.ts` sagt der Wissensseite, ob eingebettet werden kann;
 * `agent/modell/auswahl.ts` baut den Adapter. Stünde in der einen Liste ein
 * Anbieter, den die andere nicht kennt, meldete die Seite „verbunden" und der
 * nächste Aufruf fände keinen Adapter — eine Zusage, die erst beim Ausführen
 * zerbricht.
 */
describe('Anbieter mit Adapter', () => {
  it('rag.ts und auswahl.ts kennen dieselben', async () => {
    const [{ ADAPTER_VORHANDEN }, quelle] = await Promise.all([
      import('../../src/server/config/rag.js'),
      readFile(
        new URL('../../src/server/agent/modell/auswahl.ts', import.meta.url), 'utf8'),
    ]);
    /* Die `if (anbieter === 'x')`-Zweige in `baue()` sind die Wahrheit. */
    const gebaut = new Set(
      [...quelle.matchAll(/anbieter === '([a-z0-9_]+)'/gu)].map((m) => m[1]!));
    expect(gebaut.size, 'baue() hat Zweige').toBeGreaterThan(0);
    expect([...ADAPTER_VORHANDEN].sort()).toEqual([...gebaut].sort());
  });
});
