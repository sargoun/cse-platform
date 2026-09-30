/**
 * `POST /api/crm/kunde/konditionen` kehrt mit Schlüsseln zurück —
 * `?fehler=<grund>`, `?erfolg=gespeichert` —, und die Konditionen-Seite schlägt
 * sie nach (D-769, D-772, V-274).
 *
 * **Der Befund.** Die Route schickte den Satz des `CrmFehler` und ihren
 * Erfolgssatz durch die Adresse; die Seite zeigte beide roh — samt der Namen
 * aus dem Quelltext, die der Dienst in seinen Sätzen trug (ein Recht in
 * Backticks, der Name einer Prüfbedingung, eine Definer-Funktion).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  KONDITION_GRUENDE, KONDITION_RUECKWEG,
} from '../../src/lib/i18n/verwaltung/crm-rueckweg.js';
import { Abweisung, Bestaetigung } from '../../src/components/portal/Rueckweg.js';
import { NichtGefundenFehler } from '../../src/server/auth/fehler.js';
import { gruendeAb } from './hilfen/gruende.js';

(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  setzeKondition: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/crm/kondition', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeKondition: zustand.setzeKondition,
}));

const { CrmFehler } = await import('../../src/server/services/crm/anlegen.js');
const { POST } = await import('../../src/app/api/crm/kunde/konditionen/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);
const HIER = 'http://localhost:3001';
const KUNDE = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const BLATT = `/portal/reinigung/crm/kunden/${KUNDE}/konditionen`;
const SEITE = 'src/app/portal/[mandant]/crm/kunden/[id]/konditionen/page.tsx';

const ROUTE = gruendeAb({ datei: 'src/app/api/crm/kunde/konditionen/route.ts', funktion: 'POST' },
  ['CrmFehler'], lies, WURZEL);
const ALLE = [...ROUTE.gruende].sort();

function formular(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL('/api/crm/kunde/konditionen', HIER), {
    method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.authorize.mockReset();
  zustand.setzeKondition.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
});

describe('POST /api/crm/kunde/konditionen', () => {
  it('die Route kann genau diese Gründe schicken (am Quelltext gelesen)', () => {
    expect(ROUTE.offen).toEqual([]);
    expect(ALLE).toEqual([...KONDITION_GRUENDE].sort());
  });

  it.each(ALLE)('%s → 303 auf `?fehler=…` — ohne Satz, ohne Kennung', async (g) => {
    zustand.setzeKondition.mockRejectedValue(new CrmFehler(
      `Mehr als 180 Tage nimmt der CHECK \`kunde_zahlungsziel_plausibel\` nicht an (${KUNDE}).`,
      g as never));
    const r = await POST(formular({ kundeId: KUNDE, zahlungszielTage: '999', zurueck: BLATT }));
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${BLATT}?fehler=${g}`);
    expect(ort).not.toContain('meldung=');
    expect(ort.replace(BLATT, '')).not.toContain(KUNDE);
  });

  it('der Erfolg ist ein Schlüssel', async () => {
    const r = await POST(formular({ kundeId: KUNDE, debitorennummer: '10001', zurueck: BLATT }));
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?erfolg=gespeichert`);
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — auch aus einem Formular', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht crm.schreiben fehlt'));
    const r = await POST(formular({ kundeId: KUNDE, zurueck: BLATT }, { accept: 'text/html' }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'nicht_gefunden' });
    expect(zustand.setzeKondition).not.toHaveBeenCalled();
  });

  it('ein unbekannter Fehler bleibt ein Fehler; JSON wie bisher für eine fremde Kennung', async () => {
    zustand.setzeKondition.mockRejectedValue(new Error('Verbindung verloren'));
    await expect(POST(formular({ kundeId: KUNDE, zurueck: BLATT }))).rejects.toThrow();
    const r = await POST(formular({ kundeId: 'x', zurueck: BLATT }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'unbekannte_kennung' });
  });
});

describe('die Konditionen-Seite (deutsch, wie die Seite)', () => {
  const t = KONDITION_RUECKWEG.de;

  it('jeder Grund und der Erfolg haben einen Satz — ohne Namen aus dem Quelltext', () => {
    for (const g of ALLE) {
      const satz = eigenerEintrag(t.fehler, g);
      expect(satz, g).toBeTruthy();
      expect(satz, g).not.toMatch(/`|_plausibel|\w\.lesen|\w\.schreiben|CHECK|app\./u);
    }
    expect(t.erfolg.gespeichert).toBeTruthy();
  });

  it('ein unbekannter Grund wird der allgemeine Satz, ein unbekannter Erfolg kein Kasten', () => {
    for (const k of ['__proto__', 'constructor', 'Die Konditionen sind gespeichert.']) {
      expect(renderToStaticMarkup(createElement(Abweisung, { saetze: t, grund: k, cse: 'k' })), k)
        .toContain(t.sonst);
      expect(renderToStaticMarkup(createElement(Bestaetigung, { saetze: t.erfolg, erfolg: k, cse: 'e' })), k)
        .toBe('');
    }
  });

  it('der Quelltext liest `meldung` nicht mehr', () => {
    const s = readFileSync(resolve(WURZEL, SEITE), 'utf8');
    expect(s).toContain('<Abweisung saetze={KONDITION_RUECKWEG.de} grund={einSchluessel(suche.fehler)}');
    expect(s).toContain('erfolg={einSchluessel(suche.erfolg)}');
    expect(s).not.toMatch(/suche\.meldung|meldung\?: string|\{suche\.erfolg\}/u);
  });
});
