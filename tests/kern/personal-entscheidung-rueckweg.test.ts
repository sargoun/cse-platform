/**
 * Eine abgewiesene Entscheidung über Abwesenheit oder Antrag kommt als GRUND
 * zurück und steht als Satz auf der Seite — nie als Satz des Dienstes, nie
 * mit Kennung, nie als Text aus der Adresse (V-197, D-753, D-599, D-728).
 *
 * **Der Befund.** Die Listen lasen seit V-197 `?meldung=` und zeigten den Text
 * unverändert als rote Systemmeldung. Die Routen schickten dort
 * `(fehler as Error).message`: nach einer schon getroffenen Entscheidung —
 * eine Kollegin war schneller, oder zweimal „Genehmigen" — „Abwesenheit
 * <uuid> gibt es in dieser Gesellschaft nicht.". Eine volle Kennung, eine
 * falsche Aussage, und jeder präparierte Link schrieb seine eigene Meldung.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienst), die Tabelle der Sätze und am Quelltext, dass keine der vier Seiten
 * `?meldung=` noch liest.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  ENTSCHEIDUNG_FEHLER_GRUENDE, ENTSCHEIDUNG_FEHLER_TEXTE,
} from '../../src/lib/i18n/verwaltung/personal-entscheidung.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  genehmigeAbwesenheit: vi.fn(),
  lehneAbwesenheitAb: vi.fn(),
  storniereAbwesenheit: vi.fn(),
  entscheideAntrag: vi.fn(),
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
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/abwesenheit/index', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  genehmigeAbwesenheit: zustand.genehmigeAbwesenheit,
  lehneAbwesenheitAb: zustand.lehneAbwesenheitAb,
  storniereAbwesenheit: zustand.storniereAbwesenheit,
}));
vi.mock('@/server/services/abwesenheit/antrag', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  entscheideAntrag: zustand.entscheideAntrag,
}));

const {
  AbwesenheitNichtGefunden, ArtUngeklaertFehler, GrundFehlt,
} = await import('../../src/server/services/abwesenheit/index.js');
const {
  AntragNichtGefunden, KommentarFehlt, UrlaubskontoFehlt,
} = await import('../../src/server/services/abwesenheit/antrag.js');
const abwesenheit = await import('../../src/app/api/abwesenheiten/[id]/route.js');
const antrag = await import('../../src/app/api/antraege/[id]/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const LISTE_AB = '/portal/reinigung/personal/abwesenheiten';
const LISTE_AN = '/portal/reinigung/personal/antraege';
const params = { params: Promise.resolve({ id: ID }) };

function formular(pfad: string, felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

function json(pfad: string, rumpf: Record<string, string>): NextRequest {
  const kopf = new Headers({
    host: 'localhost:3001', origin: HIER, 'content-type': 'application/json',
  });
  return new NextRequest(new URL(pfad, HIER), {
    method: 'POST', body: JSON.stringify(rumpf), headers: kopf,
  });
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  for (const f of [zustand.genehmigeAbwesenheit, zustand.lehneAbwesenheitAb,
    zustand.storniereAbwesenheit, zustand.entscheideAntrag]) f.mockReset();
});

describe('POST /api/abwesenheiten/[id] — der Rückweg trägt einen Grund', () => {
  it('schon entschieden: `?fehler=nicht_gefunden` — keine Kennung, kein Satz', async () => {
    zustand.genehmigeAbwesenheit.mockRejectedValue(new AbwesenheitNichtGefunden(ID));
    const r = await abwesenheit.POST(formular(`/api/abwesenheiten/${ID}`, {
      entscheidung: 'genehmigt', mandant: 'reinigung', zurueck: LISTE_AB,
    }), params);
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${LISTE_AB}?fehler=nicht_gefunden`);
    expect(ort).not.toContain(ID);
    expect(ort).not.toContain('meldung=');
  });

  it('Ablehnen ohne Grund: `grund_fehlt` — an eine Liste mit Woche angehängt', async () => {
    zustand.lehneAbwesenheitAb.mockRejectedValue(new GrundFehlt('Eine Ablehnung'));
    const r = await abwesenheit.POST(formular(`/api/abwesenheiten/${ID}`, {
      entscheidung: 'abgelehnt', mandant: 'reinigung', zurueck: `${LISTE_AB}?woche=2026-09-07`,
    }), params);
    expect(r.headers.get('location'))
      .toBe(`${HIER}${LISTE_AB}?woche=2026-09-07&fehler=grund_fehlt`);
  });

  it('eine Schnittstelle bekommt weiter JSON mit Status', async () => {
    zustand.storniereAbwesenheit.mockRejectedValue(new GrundFehlt('Ein Storno'));
    const r = await abwesenheit.POST(json(`/api/abwesenheiten/${ID}`, {
      entscheidung: 'storniert', zurueck: LISTE_AB,
    }), params);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ fehler: 'ungueltige_eingabe' });
  });
});

describe('POST /api/antraege/[id] — der Rückweg trägt einen Grund', () => {
  it.each([
    ['nicht_gefunden', () => new AntragNichtGefunden(ID)],
    ['kommentar_fehlt', () => new KommentarFehlt()],
    ['urlaubskonto_fehlt', () => new UrlaubskontoFehlt(2029)],
    ['art_ungeklaert', () => new ArtUngeklaertFehler('Fortbildung')],
  ] as const)('%s', async (grund, fehler) => {
    zustand.entscheideAntrag.mockRejectedValue(fehler());
    const r = await antrag.POST(formular(`/api/antraege/${ID}`, {
      entscheidung: 'genehmigt', mandant: 'reinigung', zurueck: LISTE_AN,
    }), params);
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${LISTE_AN}?fehler=${grund}`);
    expect(ort).not.toContain(ID);
  });

  it('ein Fehler ohne eigenen Grund reist mit seinem `code`', async () => {
    zustand.entscheideAntrag.mockRejectedValue(
      Object.assign(new Error('irgendein Satz mit Kennung 5b0d6c1e'), {
        code: 'ungueltiger_zustand', status: 409,
      }));
    const r = await antrag.POST(formular(`/api/antraege/${ID}`, {
      entscheidung: 'genehmigt', zurueck: LISTE_AN,
    }), params);
    expect(r.headers.get('location')).toBe(`${HIER}${LISTE_AN}?fehler=ungueltiger_zustand`);
  });

  it('`zurueck` führt nie aus dem Portal hinaus', async () => {
    zustand.entscheideAntrag.mockRejectedValue(new KommentarFehlt());
    const r = await antrag.POST(formular(`/api/antraege/${ID}`, {
      entscheidung: 'abgelehnt', zurueck: 'https://fremd.example/portal',
    }), params);
    expect(new URL(r.headers.get('location') ?? '').origin).toBe(HIER);
  });
});

describe('die Sätze', () => {
  it('jede Fehlerklasse der beiden Routen trägt einen Grund, den die Tabelle kennt', () => {
    for (const f of [
      new AbwesenheitNichtGefunden(ID), new GrundFehlt('x'), new ArtUngeklaertFehler('x'),
      new AntragNichtGefunden(ID), new KommentarFehlt(), new UrlaubskontoFehlt(2029),
    ]) {
      expect(ENTSCHEIDUNG_FEHLER_GRUENDE, f.name).toContain(f.grund);
      /* Und ihr `code` hat als Rückfall ebenfalls einen Satz. */
      expect(ENTSCHEIDUNG_FEHLER_GRUENDE, f.name).toContain(f.code);
    }
  });

  it('jeder Grund hat in beiden Sprachen einen Satz — ohne Kennung, ohne Platzhalter', () => {
    for (const sprache of ['de', 'en'] as const) {
      const t = ENTSCHEIDUNG_FEHLER_TEXTE[sprache];
      expect(t.titel.trim()).not.toBe('');
      expect(t.sonst.trim()).not.toBe('');
      for (const g of ENTSCHEIDUNG_FEHLER_GRUENDE) {
        const satz = eigenerEintrag(t.fehler, g);
        expect(satz, `${sprache}.${g}`).toBeTruthy();
        expect(satz, `${sprache}.${g}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}/u);
        if (sprache === 'en') expect(satz).not.toBe(ENTSCHEIDUNG_FEHLER_TEXTE.de.fehler[g]);
      }
    }
  });

  it('„nicht_gefunden" nennt den häufigen Fall: schon entschieden', () => {
    expect(ENTSCHEIDUNG_FEHLER_TEXTE.de.fehler.nicht_gefunden).toMatch(/schon entschieden/u);
    expect(ENTSCHEIDUNG_FEHLER_TEXTE.en.fehler.nicht_gefunden).toMatch(/already been decided/u);
  });

  it('ein fremder Grund aus der Adresse wird kein Satz — und kein Prototyp-Treffer', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'Hallo Welt', '']) {
      expect(eigenerEintrag(ENTSCHEIDUNG_FEHLER_TEXTE.de.fehler, k), k).toBeUndefined();
    }
  });
});

describe('die vier Seiten zeigen nur den nachgeschlagenen Satz', () => {
  const M = 'src/app/portal/[mandant]/personal';
  it.each([
    `${M}/abwesenheiten/page.tsx`, `${M}/antraege/page.tsx`,
    `${M}/abwesenheiten/[id]/page.tsx`, `${M}/antraege/[id]/page.tsx`,
  ])('%s', (seite) => {
    const s = readFileSync(join(WURZEL, seite), 'utf8');
    expect(s).not.toMatch(/\['meldung'\]/u);
    expect(s).toContain('eigenerEintrag(fehlerTexte.fehler, fehler) ?? fehlerTexte.sonst');
    /* Nie der rohe Schlüssel — hier stand auf dem Antragsblatt `{fehler}` in Maschinenschrift. */
    expect(s).not.toMatch(/<span className="font-mono">\{fehler\}<\/span>/u);
  });
});
