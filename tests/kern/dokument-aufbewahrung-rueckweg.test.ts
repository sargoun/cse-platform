/**
 * Eine abgewiesene Aufbewahrungsregel kommt als GRUND zurück — ohne den Satz
 * des Dienstes, ohne die Kategorie und die Frist darin (D-769, D-774).
 *
 * **Der Befund.** `POST /api/dokumente/aufbewahrung` schickte zu `?fehler=`
 * den Satz von `AufbewahrungFehler` als `?meldung=` mit („Unbekannte
 * Kategorie „…"", „Für „rechnung" gilt eine gesetzliche Mindestfrist von 10
 * Jahren …"), und die Seite zog ihn ihrer eigenen Tabelle vor — also auch
 * jeden Text eines präparierten Links.
 *
 * Geprüft wird die ECHTE Route mit dem echten Dienst (ersetzt sind nur
 * Sitzung, Datenbank und Tor), die Tabelle der Sätze und am Quelltext, dass
 * die Seite `meldung` nicht mehr liest. Einen JSON-Weg für eine Abweisung hat
 * die Route nicht; ohne Mandant oder Kategorie antwortet sie wie bisher mit
 * JSON.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  AUFBEWAHRUNG_FEHLER_GRUENDE, AUFBEWAHRUNG_RUECKWEG_TEXTE,
} from '../../src/lib/i18n/verwaltung/dokument-rueckweg.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  zeilen: [] as readonly Record<string, unknown>[],
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) => fn({
    abfrage: () => Promise.resolve([]),
    schreibe: (sql: string) => Promise.resolve(
      sql.includes('insert into dokument_aufbewahrung') ? zustand.zeilen : []),
  }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));

const { AufbewahrungFehler } = await import('../../src/server/services/dokument/aufbewahrung.js');
const { NichtAngemeldetFehler, NichtGefundenFehler } = await import('../../src/server/auth/fehler.js');
const route = await import('../../src/app/api/dokumente/aufbewahrung/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const SEITE = '/portal/reinigung/dokumente/aufbewahrung';

function formular(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries({
    mandant: 'reinigung', kategorie: 'vertrag', jahre: '8', grundlage: '§ 257 HGB', ...felder,
  })) {
    if (v !== '') daten.append(k, v);
  }
  return new NextRequest(new URL('/api/dokumente/aufbewahrung', HIER), {
    method: 'POST', body: daten,
    headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.authorize.mockReset().mockResolvedValue(zustand.sitzung);
  zustand.zeilen = [{
    kategorie: 'vertrag', jahre: 8, loeschsperre: false, grundlage: '§ 257 HGB',
    ist_platzhalter: false, mandant_id: '00000000-0000-4000-8000-000000000002',
    geaendert_am: '29.09.2026 12:00',
  }];
});

async function ort(anfrage: NextRequest): Promise<string> {
  const r = await route.POST(anfrage);
  expect(r.status).toBe(303);
  const o = r.headers.get('location') ?? '';
  expect(o).not.toContain('meldung=');
  return o;
}

describe('POST /api/dokumente/aufbewahrung — der Rückweg trägt einen Grund', () => {
  it.each([
    ['jahre — die eigene Prüfung der Route', 'jahre', { jahre: '2,5' }],
    ['jahre — die Prüfung des Dienstes', 'jahre', { jahre: '31' }],
    ['kategorie', 'kategorie', { kategorie: 'sonstiges' }],
    ['grundlage', 'grundlage', { grundlage: 'abc' }],
    ['untergrenze', 'untergrenze', { kategorie: 'rechnung', jahre: '5' }],
  ] as const)('%s', async (_, grund, felder) => {
    const o = await ort(formular(felder));
    expect(o).toBe(`${HIER}${SEITE}?fehler=${grund}`);
    /* Weder die Eingabe noch ein Wert aus dem Satz des Dienstes reist mit. */
    expect(decodeURIComponent(o)).not.toMatch(/sonstiges|10 Jahren|Mindestfrist/u);
  });

  it('nicht_gesetzt: die Datenbank gibt keine Zeile zurück', async () => {
    zustand.zeilen = [];
    expect(await ort(formular({}))).toBe(`${HIER}${SEITE}?fehler=nicht_gesetzt`);
  });

  it('Erfolg bleibt der Schlüssel `?gesetzt=<kategorie>`', async () => {
    expect(await ort(formular({}))).toBe(`${HIER}${SEITE}?gesetzt=vertrag`);
  });

  it('jeder Grund des Dienstes steht in der Liste der Gründe', () => {
    for (const g of ['kategorie', 'jahre', 'untergrenze', 'grundlage', 'nicht_gesetzt'] as const) {
      expect(AUFBEWAHRUNG_FEHLER_GRUENDE).toContain(new AufbewahrungFehler('x', g).grund);
    }
  });
});

describe('Anmeldung und Recht zuerst (AUT-06, D-766)', () => {
  it('ein fehlendes Recht bleibt die byte-gleiche 404', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht fehlt'));
    const r = await route.POST(formular({}));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('{"fehler":"nicht_gefunden"}');
  });

  it('ohne Sitzung: ein Browserformular geht zur Anmeldung zurück auf die Seite', async () => {
    zustand.authorize.mockRejectedValue(new NichtAngemeldetFehler());
    const r = await route.POST(formular({}, { accept: 'text/html', referer: `${HIER}${SEITE}` }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}/auth/login?weiter=${encodeURIComponent(SEITE)}`);
  });

  it('ein unbekannter Fehler bleibt ein Fehler — keine erfundene Abweisung', async () => {
    zustand.authorize.mockRejectedValue(new Error('Verbindung weg'));
    await expect(route.POST(formular({}))).rejects.toThrow('Verbindung weg');
  });

  it('ohne Kategorie bleibt es JSON wie bisher', async () => {
    const r = await route.POST(formular({ kategorie: '' }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ fehler: 'unvollstaendig' });
  });
});

describe('die Sätze der Seite (fest deutsch, Ausnahmeliste)', () => {
  const t = AUFBEWAHRUNG_RUECKWEG_TEXTE.de;

  it('jeder Grund hat einen Satz — ohne Kennung und ohne Wert aus dem Satz des Dienstes', () => {
    expect(t.titel.trim()).not.toBe('');
    expect(t.sonst.trim()).not.toBe('');
    for (const g of AUFBEWAHRUNG_FEHLER_GRUENDE) {
      const satz = eigenerEintrag(t.fehler, g);
      expect(satz, g).toBeTruthy();
      expect(satz, g).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|`|„\w+"/u);
    }
  });

  it('ein fremder Schlüssel aus der Adresse findet nichts — auch keinen Prototyp', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'Hallo Welt']) {
      expect(eigenerEintrag(t.fehler, k), k).toBeUndefined();
    }
  });

  it('die Seite liest `meldung` nicht mehr und fällt auf den allgemeinen Satz zurück', () => {
    const seite = readFileSync(
      join(WURZEL, 'src/app/portal/[mandant]/dokumente/aufbewahrung/page.tsx'), 'utf8');
    expect(seite).not.toMatch(/'meldung'/u);
    expect(seite).toContain('eigenerEintrag(t.fehler, fehler) ?? t.sonst');
    expect(seite).toMatch(/<Hinweis art="warnung" rolle="alert" cse="aufbewahrung-fehler"/u);
    expect(seite).toMatch(/<Hinweis art="erfolg" rolle="status" cse="aufbewahrung-gesetzt"/u);
  });
});
