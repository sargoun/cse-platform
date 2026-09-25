/**
 * Der Sprachkeks `cse_sprache` — wer ihn schreibt, wann, und wie lange er lebt
 * (V-200, D-694, D-751, O-928, EMP-12).
 *
 * **Der Befund.** V-200 führte den Keks mit einem Jahr Lebensdauer ein,
 * gesetzt vor jeder Anmeldung und nebenbei bei jeder gespeicherten Sprache —
 * auch der Verwaltung —, und die Abmeldung löschte ihn nicht. Die
 * Datenschutzerklärung, auf die die Anmeldung verweist, sagte: ein
 * Sitzungscookie, „es endet mit der Abmeldung". Und die „zwei Riegel" der
 * Sprachwahl (keine fremde Seite, nur vier Werte) hatten keinen Test.
 *
 * Geprüft werden die ECHTEN Routen: `GET /api/geraetesprache` ganz ohne
 * Ersatz, `POST /api/konto/sprache` mit ersetzter Sitzung, Datenbank und
 * Dienst (dessen Verhalten `tests/isolation` an echten Zeilen prüft).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';
import {
  SPRACH_KEKS, SPRACH_KEKS_FRAGE, SPRACH_KEKS_SEKUNDEN,
} from '../../src/lib/i18n/geraetesprache.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  setzeEigeneSprache: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({ unsafe: () => [] }) }),
}));
vi.mock('@/server/kontext/index', () => ({
  bindePersoenlich: () => Promise.resolve(),
}));
vi.mock('@/server/konto/sprache', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeEigeneSprache: zustand.setzeEigeneSprache,
}));

const { sprachKeksOptionen } = await import('../../src/server/konto/sprach-keks.js');
const { GET } = await import('../../src/app/api/geraetesprache/route.js');
const { POST } = await import('../../src/app/api/konto/sprache/route.js');
const {
  SpracheNichtGesetztFehler, UnbekannteSpracheFehler,
} = await import('../../src/server/konto/sprache.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';

function wahl(abfrage: string, herkunft: string | null): NextRequest {
  const kopf = new Headers({ host: 'localhost:3001' });
  if (herkunft !== null) kopf.set('sec-fetch-site', herkunft);
  return new NextRequest(new URL(`/api/geraetesprache?${abfrage}`, HIER), { headers: kopf });
}

function keks(antwort: NextResponse): string | null {
  return antwort.headers.get('set-cookie');
}

describe('GET /api/geraetesprache — die Sprachwahl vor der Anmeldung', () => {
  it('aus der eigenen Seite: der Keks mit einem der vier Werte, httpOnly, lax, Pfad /', () => {
    const r = GET(wahl('sprache=ar&zurueck=%2Fcheck-in%2Fabc', 'same-origin'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}/check-in/abc`);
    const k = keks(r) ?? '';
    expect(k).toMatch(new RegExp(`^${SPRACH_KEKS}=ar;`, 'u'));
    expect(k).toMatch(/HttpOnly/iu);
    expect(k).toMatch(/SameSite=lax/iu);
    expect(k).toMatch(/Path=\//u);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('solange O-928 offen ist, ein SITZUNGSkeks — ohne Max-Age und ohne Expires', () => {
    expect(SPRACH_KEKS_SEKUNDEN).toBeNull();
    const k = keks(GET(wahl('sprache=tr', 'none'))) ?? '';
    expect(k).toMatch(/^cse_sprache=tr;/u);
    expect(k).not.toMatch(/Max-Age/iu);
    expect(k).not.toMatch(/Expires/iu);
  });

  it('aus der Adresszeile (`none`) und ohne den Kopf (ältere Browser) gilt die Wahl', () => {
    expect(keks(GET(wahl('sprache=en', 'none')))).toMatch(/^cse_sprache=en;/u);
    expect(keks(GET(wahl('sprache=en', null)))).toMatch(/^cse_sprache=en;/u);
  });

  it.each(['cross-site', 'same-site'])('Riegel 1: auf Zuruf einer fremden Seite (%s) kein Keks', (h) => {
    const r = GET(wahl('sprache=ar&zurueck=%2Fauth%2Fmitarbeiter', h));
    expect(r.status).toBe(303);
    expect(keks(r)).toBeNull();
  });

  it.each(['__proto__', 'constructor', 'fr', 'AR', '', 'de;x=1'])(
    'Riegel 2: „%s" ist keine der vier Sprachen — kein Keks', (wert) => {
      const r = GET(wahl(`sprache=${encodeURIComponent(wert)}`, 'same-origin'));
      expect(r.status).toBe(303);
      expect(keks(r)).toBeNull();
    });

  it('der Rückweg bleibt im eigenen Ursprung', () => {
    const r = GET(wahl('sprache=en&zurueck=https%3A%2F%2Fboese.example%2F', 'same-origin'));
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.origin).toBe(HIER);
    expect(ziel.pathname).toBe('/auth/mitarbeiter');
  });
});

describe('die Attribute an EINER Stelle', () => {
  it('secure ausserhalb der Entwicklung, kein maxAge bis O-928', () => {
    const prod = sprachKeksOptionen({ NODE_ENV: 'production' });
    expect(prod).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', secure: true });
    expect('maxAge' in prod).toBe(false);
    expect(sprachKeksOptionen({ NODE_ENV: 'development' }).secure).toBe(false);
  });

  it('die offene Frage steht am Wert, im Register und in der Datenschutzerklärung', () => {
    expect(SPRACH_KEKS_FRAGE).toBe('O-928');
    const quelle = readFileSync(join(WURZEL, 'src/lib/i18n/geraetesprache.ts'), 'utf8');
    expect(quelle).toMatch(/TODO\(client, O-928\)/u);
    const register = readFileSync(join(WURZEL, 'docs/DECISIONS.md'), 'utf8');
    expect(register).toMatch(/^\| O-928 \|/mu);
    /* Die Erklärung beschreibt den Platzhalter — und beide Fassungen sagen dasselbe. */
    const de = readFileSync(join(WURZEL, 'src/server/db/seed/inhalt.ts'), 'utf8');
    const en = readFileSync(join(WURZEL, 'src/server/db/seed/inhalt-en.ts'), 'utf8');
    expect(de).toContain('cse_sprache');
    expect(de).toMatch(/Es endet, wenn Sie den Browser '\s*\+ 'schließen; die Abmeldung löscht es nicht\./u);
    expect(en).toContain('cse_sprache');
    expect(en).toMatch(/It ends when you close the browser; signing out does '\s*\+ 'not delete it\./u);
  });
});

describe('POST /api/konto/sprache — der Keks nur nach gespeicherter Wahl, nur für Beschäftigte', () => {
  function speichern(sprache: string): NextRequest {
    const daten = new FormData();
    daten.append('sprache', sprache);
    daten.append('zurueck', '/portal/konto/profil');
    const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
    return new NextRequest(new URL('/api/konto/sprache', HIER), {
      method: 'POST', body: daten, headers: kopf,
    });
  }
  const arbeiterin = {
    benutzerId: '00000000-0000-4000-8000-000000000001', aktiverMandantId: null,
    personId: '00000000-0000-4000-8000-000000000004', ansicht: 'person', aal: 'aal1',
    portal: 'mitarbeiter', sitzungId: '00000000-0000-4000-8000-000000000003',
  };

  beforeEach(() => {
    zustand.setzeEigeneSprache.mockReset();
    zustand.sitzung = arbeiterin;
  });

  it('Beschäftigte: gespeichert → derselbe Wert als Keks für das Gerät', async () => {
    zustand.setzeEigeneSprache.mockResolvedValue('ar');
    const r = await POST(speichern('ar'));
    expect(r.status).toBe(303);
    expect(keks(r)).toMatch(/^cse_sprache=ar;/u);
    expect(keks(r)).not.toMatch(/Max-Age/iu);
  });

  it('Verwaltung: die Sprache wird gespeichert, ein Keks entsteht nicht', async () => {
    zustand.sitzung = { ...arbeiterin, portal: 'intern', ansicht: 'mandant' };
    zustand.setzeEigeneSprache.mockResolvedValue('en');
    const r = await POST(speichern('en'));
    expect(r.status).toBe(303);
    expect(zustand.setzeEigeneSprache).toHaveBeenCalledOnce();
    expect(keks(r)).toBeNull();
  });

  it('abgewiesen (unbekannte Sprache, fremde Zeile) → kein Keks', async () => {
    zustand.setzeEigeneSprache.mockRejectedValue(new UnbekannteSpracheFehler('fr'));
    const a = await POST(speichern('fr'));
    expect(a.status).toBe(400);
    expect(keks(a)).toBeNull();

    zustand.setzeEigeneSprache.mockRejectedValue(new SpracheNichtGesetztFehler());
    const b = await POST(speichern('tr'));
    expect(b.status).toBe(404);
    expect(keks(b)).toBeNull();
  });
});
