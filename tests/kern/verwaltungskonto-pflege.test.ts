/**
 * Neuer Link und Rollenwechsel am Benutzerblatt (V-302, O-980, O-981, D-821)
 * — die ECHTE Route mit dem echten Dienst; ersetzt sind nur Sitzung,
 * Datenbank, Tor, Keks und der Anbieter (wie `verwaltungskonto-rueckweg`).
 *
 * Geprüft wird: jede Aktion führt mit genau einem Schlüssel aufs Blatt zurück,
 * der neue Link reist nur im Keks unter dem Pfad des Blatts, eine Abweisung
 * nimmt einen alten Link mit weg, `42501` wird `nicht_erlaubt`, eine fremde
 * Rolle erreicht die Datenbank gar nicht — und jeder Stand hat in beiden
 * Sprachen einen Satz.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  VERWALTUNGSKONTO_PFLEGE_STAENDE, VERWALTUNGSKONTO_PFLEGE_TEXTE,
} from '../../src/lib/i18n/verwaltung/einstellungen/verwaltungskonto-pflege.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  schreibe: vi.fn(),
  anbieter: 'demo' as 'demo' | 'supabase',
  gesetzt: [] as { name: string; wert: string; optionen: Record<string, unknown> }[],
  geloescht: [] as string[],
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    set: (name: string, wert: string, optionen: Record<string, unknown>) => {
      zustand.gesetzt.push({ name, wert, optionen });
    },
    delete: (arg: string | { name: string; path?: string }) => {
      zustand.geloescht.push(typeof arg === 'string' ? arg : `${arg.name}@${arg.path ?? ''}`);
    },
  }),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) => fn({
    abfrage: () => Promise.resolve([]),
    schreibe: zustand.schreibe,
  }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/auth/kennwort-anmeldung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  anbieter: () => zustand.anbieter,
}));

const { LINK_NEU_COOKIE } = await import('../../src/server/services/system/verwaltungskonto.js');
const route = await import('../../src/app/api/system/verwaltungskonto/route.js');

const HIER = 'http://localhost:3001';
const KONTO = '00000000-0000-4000-8000-0000000000aa';
const BLATT = `/portal/reinigung/einstellungen/benutzer/${KONTO}`;

function formular(felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries({ zurueck: BLATT, benutzer: KONTO, ...felder })) {
    daten.append(k, v);
  }
  return new NextRequest(new URL('/api/system/verwaltungskonto', HIER), {
    method: 'POST', body: daten,
    headers: new Headers({ host: 'localhost:3001', origin: HIER }),
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
  zustand.schreibe.mockReset();
  zustand.anbieter = 'demo';
  zustand.gesetzt = [];
  zustand.geloescht = [];
});

async function ort(r: Response): Promise<string> {
  expect(r.status).toBe(303);
  return r.headers.get('location') ?? '';
}

describe('POST /api/system/verwaltungskonto — aktion=link_neu', () => {
  it.each([['einladung', 'link_einladung'], ['zuruecksetzen', 'link_kennwort']] as const)(
    'Zweck %s: `?verwaltung=%s`, der Link nur im Keks unter dem Pfad des Blatts',
    async (zweck, stand) => {
      zustand.schreibe.mockResolvedValue([{ ok: true, grund: 'ausgestellt', zweck }]);
      expect(await ort(await route.POST(formular({ aktion: 'link_neu' }))))
        .toBe(`${HIER}${BLATT}?verwaltung=${stand}`);
      expect(zustand.gesetzt).toHaveLength(1);
      expect(zustand.gesetzt[0]).toMatchObject({
        name: LINK_NEU_COOKIE, optionen: { httpOnly: true, path: BLATT, maxAge: 300 },
      });
      /* Gesendet wird nur der SHA-256 des Klartexts, nie der Klartext. */
      const [sqlText, werte] = zustand.schreibe.mock.calls[0] as [string, readonly unknown[]];
      expect(sqlText).toContain('app.verwaltungskonto_link_neu');
      expect(werte[0]).toBe(KONTO);
      expect(werte[1]).toMatch(/^[0-9a-f]{64}$/u);
      expect(werte[1]).not.toBe(zustand.gesetzt[0]!.wert);
    });

  it.each(['kein_verwaltungskonto', 'deaktiviert', 'gesperrt'])(
    'eine Abweisung (%s) kommt als Schlüssel — und nimmt einen alten Link mit weg', async (grund) => {
      zustand.schreibe.mockResolvedValue([{ ok: false, grund, zweck: null }]);
      expect(await ort(await route.POST(formular({ aktion: 'link_neu' }))))
        .toBe(`${HIER}${BLATT}?verwaltung=${grund}`);
      expect(zustand.gesetzt).toEqual([]);
      expect(zustand.geloescht).toEqual([`${LINK_NEU_COOKIE}@${BLATT}`]);
    });

  it('ein unbekannter Grund der Datenbank wird `nicht_ausgefuehrt`, nie ihr Text', async () => {
    zustand.schreibe.mockResolvedValue([{ ok: false, grund: 'Irgendein Satz', zweck: null }]);
    expect(await ort(await route.POST(formular({ aktion: 'link_neu' }))))
      .toBe(`${HIER}${BLATT}?verwaltung=nicht_ausgefuehrt`);
  });

  it('42501 wird `nicht_erlaubt`; Supabase als Anbieter wird `anbieter_fremd`', async () => {
    zustand.schreibe.mockRejectedValue(Object.assign(new Error('darf nicht'), { code: '42501' }));
    expect(await ort(await route.POST(formular({ aktion: 'link_neu' }))))
      .toBe(`${HIER}${BLATT}?verwaltung=nicht_erlaubt`);
    zustand.anbieter = 'supabase';
    expect(await ort(await route.POST(formular({ aktion: 'link_neu' }))))
      .toBe(`${HIER}${BLATT}?verwaltung=anbieter_fremd`);
  });

  it('ohne gültige Kontokennung: 400, keine Datenbank', async () => {
    const r = await route.POST(formular({ aktion: 'link_neu', benutzer: 'kein-uuid' }));
    expect(r.status).toBe(400);
    expect(zustand.schreibe).not.toHaveBeenCalled();
  });
});

describe('POST /api/system/verwaltungskonto — aktion=rolle', () => {
  it.each(['gewechselt', 'unveraendert'])('`?verwaltung=%s` — und kein Keks', async (grund) => {
    zustand.schreibe.mockResolvedValue([{ ok: true, grund }]);
    expect(await ort(await route.POST(formular({ aktion: 'rolle', rolle: 'leitung' }))))
      .toBe(`${HIER}${BLATT}?verwaltung=${grund}`);
    expect(zustand.gesetzt).toEqual([]);
    const [sqlText, werte] = zustand.schreibe.mock.calls[0] as [string, readonly unknown[]];
    expect(sqlText).toContain('app.verwaltungskonto_rolle_wechseln');
    expect(werte).toEqual([KONTO, 'leitung']);
  });

  it('eine fremde Rolle erreicht die Datenbank nicht', async () => {
    for (const rolle of ['super_admin', 'mitarbeiter', 'kunde', '']) {
      expect(await ort(await route.POST(formular({ aktion: 'rolle', rolle }))), rolle)
        .toBe(`${HIER}${BLATT}?verwaltung=rolle_unzulaessig`);
    }
    expect(zustand.schreibe).not.toHaveBeenCalled();
  });

  it('`selbst` aus der Datenbank kommt als Schlüssel zurück', async () => {
    zustand.schreibe.mockResolvedValue([{ ok: false, grund: 'selbst' }]);
    expect(await ort(await route.POST(formular({ aktion: 'rolle', rolle: 'admin' }))))
      .toBe(`${HIER}${BLATT}?verwaltung=selbst`);
  });
});

describe('die Sätze des Blatts — de und en', () => {
  it('jeder Stand hat in beiden Sprachen einen eigenen Satz, ohne Kennung und Platzhalter', () => {
    for (const sprache of ['de', 'en'] as const) {
      const t = VERWALTUNGSKONTO_PFLEGE_TEXTE[sprache];
      for (const s of VERWALTUNGSKONTO_PFLEGE_STAENDE) {
        const satz = eigenerEintrag(t.stand, s);
        expect(satz, `${sprache}.${s}`).toBeTruthy();
        expect(satz, `${sprache}.${s}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|`/u);
        if (sprache === 'en') expect(satz).not.toBe(VERWALTUNGSKONTO_PFLEGE_TEXTE.de.stand[s]);
      }
    }
  });

  it('ein fremder Schlüssel aus der Adresse findet nichts — auch keinen Prototyp', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'Hallo Welt']) {
      expect(eigenerEintrag(VERWALTUNGSKONTO_PFLEGE_TEXTE.de.stand, k), k).toBeUndefined();
    }
  });
});
