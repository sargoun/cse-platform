/**
 * `POST /api/benachrichtigungen/[id]/oeffnen` leitet nur auf DIESE Plattform
 * weiter (V-394, NOT-03, D-814).
 *
 * **Der Befund.** Die Route las das Ziel aus der Zeile und leitete mit
 * `new URL(ziel, ursprung)` weiter; ihr Kommentar versprach, ein CHECK halte
 * `ziel` auf einem fuehrenden Schraegstrich. Den gab es nicht — nur
 * `length(ziel) > 1` (0011). Ein Ziel `//boese.example` waere eine offene
 * Weiterleitung hinter einer echten Anmeldung gewesen.
 *
 * Geprueft wird die ECHTE Route; ersetzt sind nur Sitzung, Datenbank und das
 * Stempeln. Den CHECK selbst prueft `tests/isolation/benachrichtigung.test.ts`
 * an echten Zeilen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  oeffne: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({ unsafe: vi.fn() }) }),
}));
vi.mock('@/server/kontext/index', () => ({
  bindePersoenlich: () => Promise.resolve(),
}));
vi.mock('@/server/benachrichtigung/posteingang', () => ({
  oeffne: zustand.oeffne,
}));

const route = await import('../../src/app/api/benachrichtigungen/[id]/oeffnen/route.js');

const HIER = 'http://localhost:3001';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';

function anfrage(): NextRequest {
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL(`/api/benachrichtigungen/${ID}/oeffnen`, HIER),
    { method: 'POST', headers: kopf });
}

const params = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-0000000000aa',
    mandantIds: ['00000000-0000-4000-8000-0000000000aa'],
    scope: 'mandant', portal: 'intern', readonly: false,
  };
  zustand.oeffne.mockReset();
});

describe('V-394 — die Weiterleitung bleibt auf der Plattform', () => {
  it('ein Pfad der Plattform: weiter dorthin, 303', async () => {
    zustand.oeffne.mockResolvedValue('/portal/reinigung/personal/abwesenheiten/x');
    const antwort = await route.POST(anfrage(), params);
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location'))
      .toBe(`${HIER}/portal/reinigung/personal/abwesenheiten/x`);
  });

  it('ein fremdes Ziel aus der Zeile fuehrt auf den Start des eigenen Portals', async () => {
    for (const ziel of [
      '//boese.example/x', '/\\boese.example/x', 'https://boese.example/x', '/\t/boese.example',
    ]) {
      zustand.oeffne.mockResolvedValue(ziel);
      const antwort = await route.POST(anfrage(), params);
      expect(antwort.status, JSON.stringify(ziel)).toBe(303);
      expect(antwort.headers.get('location'), JSON.stringify(ziel)).toBe(`${HIER}/auth/bereich`);
    }
  });

  it('im Mitarbeiterportal ist der Start /portal/mein', async () => {
    zustand.sitzung = { ...zustand.sitzung!, scope: 'person', portal: 'mitarbeiter' };
    zustand.oeffne.mockResolvedValue('//boese.example/x');
    const antwort = await route.POST(anfrage(), params);
    expect(antwort.headers.get('location')).toBe(`${HIER}/portal/mein`);
  });

  it('eine fremde oder unbekannte Meldung bleibt 404 (AUT-06)', async () => {
    zustand.oeffne.mockResolvedValue(null);
    const antwort = await route.POST(anfrage(), params);
    expect(antwort.status).toBe(404);
  });
});
