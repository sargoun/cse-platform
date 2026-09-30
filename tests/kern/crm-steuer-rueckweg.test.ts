/**
 * `POST /api/crm/kunde/steuer` kehrt mit Schlüsseln zurück — `?fehler=<grund>`,
 * `?erfolg=<vorgang>` —, und das Steuerblatt schlägt sie nach (D-769, D-772,
 * V-274).
 *
 * **Der Befund.** Die Route schickte den Satz des `SteuerFehler` und ihren
 * Erfolgssatz durch die Adresse, das Blatt zeigte beide roh. Zwei Sätze
 * wiederholten dabei Eingaben: eine Kennung, die keine war („Eingegeben
 * wurde: „A-2026-001"") und die Daten der kollidierenden Zeitscheibe. Und
 * `RECHT[was]` schlug den Vorgang aus dem Formular in einem gewöhnlichen
 * Objekt nach — `was=__proto__` fand dort einen Prototyp statt `undefined`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { STEUER_RUECKWEG } from '../../src/lib/i18n/verwaltung/crm-rueckweg.js';
import { Abweisung, Bestaetigung } from '../../src/components/portal/Rueckweg.js';
import { NichtGefundenFehler } from '../../src/server/auth/fehler.js';
import { gruendeAb } from './hilfen/gruende.js';

(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  setzeERechnung: vi.fn(),
  legeZeitscheibeAn: vi.fn(),
  legeBescheinigungAn: vi.fn(),
  widerrufeBescheinigung: vi.fn(),
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
vi.mock('@/server/services/finanz/kunde-steuer', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeERechnung: zustand.setzeERechnung,
  legeZeitscheibeAn: zustand.legeZeitscheibeAn,
  legeBescheinigungAn: zustand.legeBescheinigungAn,
  widerrufeBescheinigung: zustand.widerrufeBescheinigung,
}));

const { SteuerFehler, STEUER_GRUENDE, STEUER_VORGAENGE } =
  await import('../../src/server/services/finanz/kunde-steuer.js');
const { POST } = await import('../../src/app/api/crm/kunde/steuer/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);
const HIER = 'http://localhost:3001';
const KUNDE = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const BESCHEINIGUNG = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const BLATT = `/portal/reinigung/crm/kunden/${KUNDE}/steuer`;
const SEITE = 'src/app/portal/[mandant]/crm/kunden/[id]/steuer/page.tsx';

const ROUTE = gruendeAb({ datei: 'src/app/api/crm/kunde/steuer/route.ts', funktion: 'POST' },
  ['SteuerFehler'], lies, WURZEL);
const ALLE = [...ROUTE.gruende].sort();

/** Die Felder je Vorgang — so, wie das Blatt sie schickt. */
const FELDER: Readonly<Record<string, Record<string, string>>> = {
  erechnung: { uebertragungsweg: 'peppol' },
  bauleistender: { leistungsart: 'bau', istBauleistender: '1', giltAb: '2026-01-01', grundlage: 'USt 1 TG' },
  bescheinigung: {
    umfang: 'unbeschraenkt', nummer: 'FB-1', finanzamt: 'Berlin', gueltigVon: '2026-01-01',
    gueltigBis: '2026-12-31',
  },
  widerruf: { bescheinigungId: BESCHEINIGUNG, widerrufenAm: '2026-09-01' },
};

function formular(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL('/api/crm/kunde/steuer', HIER), {
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
  for (const f of [zustand.authorize, zustand.setzeERechnung, zustand.legeZeitscheibeAn,
    zustand.legeBescheinigungAn, zustand.widerrufeBescheinigung]) f.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
});

describe('POST /api/crm/kunde/steuer — Abweisung als `?fehler=<grund>`', () => {
  it('die Route schickt genau die Gründe, die der Dienst kennt (am Quelltext gelesen)', () => {
    expect(ROUTE.offen).toEqual([]);
    expect(ALLE).toEqual([...STEUER_GRUENDE].sort());
  });

  it.each(ALLE)('%s → 303 zurück aufs Blatt — ohne Satz, ohne Eingabe, ohne Kennung', async (g) => {
    zustand.setzeERechnung.mockRejectedValue(new SteuerFehler(
      `„Scan (Dokumentkennung)" erwartet eine Kennung … Eingegeben wurde: „A-2026-001" (${KUNDE}).`,
      g as never));
    const r = await POST(formular({ was: 'erechnung', kundeId: KUNDE, zurueck: BLATT }));
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${BLATT}?fehler=${g}`);
    expect(ort).not.toContain('meldung=');
    expect(decodeURIComponent(ort)).not.toContain('A-2026-001');
    expect(ort.replace(BLATT, '')).not.toContain(KUNDE);
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — kein Rückweg', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht finanzen.schreiben fehlt'));
    const r = await POST(formular({ was: 'bauleistender', kundeId: KUNDE, zurueck: BLATT },
      { accept: 'text/html' }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'nicht_gefunden' });
    expect(zustand.legeZeitscheibeAn).not.toHaveBeenCalled();
  });

  it('ein unbekannter Fehler bleibt ein Fehler', async () => {
    zustand.legeZeitscheibeAn.mockRejectedValue(Object.assign(new Error('exclusion'), { code: '23P01' }));
    await expect(POST(formular({
      was: 'bauleistender', kundeId: KUNDE, zurueck: BLATT, ...FELDER['bauleistender'],
    }))).rejects.toThrow('exclusion');
  });
});

describe('POST /api/crm/kunde/steuer — Erfolg als `?erfolg=<vorgang>`', () => {
  it.each(STEUER_VORGAENGE)('%s', async (was) => {
    const r = await POST(formular({ was, kundeId: KUNDE, zurueck: BLATT, ...FELDER[was] }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?erfolg=${was}`);
  });
});

describe('POST /api/crm/kunde/steuer — Programme bekommen JSON wie bisher', () => {
  it('ein unbekannter Vorgang ist 400 — auch einer, den ein Objekt im Prototyp fände', async () => {
    for (const was of ['loeschen', '__proto__', 'constructor', 'toString', '']) {
      const r = await POST(formular({ was, kundeId: KUNDE, zurueck: BLATT }));
      expect(r.status, was).toBe(400);
      expect(await r.json(), was).toEqual({ fehler: 'unbekannter_vorgang' });
    }
    expect(zustand.authorize).not.toHaveBeenCalled();
  });

  it('eine Kennung, die keine ist, bleibt 404 mit JSON', async () => {
    const r = await POST(formular({ was: 'erechnung', kundeId: 'x', zurueck: BLATT }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'unbekannte_kennung' });
  });
});

describe('das Steuerblatt: jeder Grund und jeder Erfolg hat einen Satz (deutsch, wie die Seite)', () => {
  const t = STEUER_RUECKWEG.de;

  it('jeder Grund, jeder Vorgang — ohne Kennung, ohne Eingabe, ohne Schlüssel eines Rechts', () => {
    for (const g of ALLE) {
      const satz = eigenerEintrag(t.fehler, g);
      expect(satz, g).toBeTruthy();
      expect(satz, g).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|`|\w\.schreiben|Eingegeben wurde/u);
    }
    for (const v of STEUER_VORGAENGE) expect(eigenerEintrag(t.erfolg, v), v).toBeTruthy();
  });

  it('ein unbekannter Grund wird der allgemeine Satz, ein unbekannter Erfolg kein Kasten', () => {
    for (const k of ['__proto__', 'constructor', 'Die Rechnungsangaben sind gespeichert.']) {
      expect(renderToStaticMarkup(createElement(Abweisung, { saetze: t, grund: k, cse: 's' })), k)
        .toContain(t.sonst);
      expect(renderToStaticMarkup(createElement(Bestaetigung, { saetze: t.erfolg, erfolg: k, cse: 'e' })), k)
        .toBe('');
    }
  });

  it('der Quelltext liest Grund und Erfolg als Schlüssel und `meldung` nicht mehr', () => {
    const s = readFileSync(resolve(WURZEL, SEITE), 'utf8');
    expect(s).toContain('<Abweisung saetze={STEUER_RUECKWEG.de} grund={einSchluessel(suche.fehler)}');
    expect(s).toContain('<Bestaetigung saetze={STEUER_RUECKWEG.de.erfolg} erfolg={einSchluessel(suche.erfolg)}');
    expect(s).not.toMatch(/suche\.meldung|meldung\?: string|\{suche\.erfolg\}/u);
    /* Der Überlapp nennt die Zeile nicht mehr im Satz — sie steht in der Liste darüber. */
    expect(s).not.toContain('die kollidierende Zeile genannt');
  });
});
