/**
 * Das Witterungskennzeichen am Eingang des Bautagebuchs (V-328, O-158, D-808).
 *
 * `POST /api/bau/bautagebuch` mit `vorgang=witterung` kennt drei Werte: `ja`,
 * `nein` und leer („nicht beurteilt"). Was die Datenbank daraus macht —
 * gesetzt am offenen Tag, fest nach dem Abschluss —, steht in
 * `tests/isolation/bau-bautagebuch.test.ts`. Hier steht, dass die Route die
 * drei Werte richtig übersetzt und einen vierten nicht still zu „nicht
 * beurteilt" macht.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const zustand = vi.hoisted(() => ({
  setzeWitterung: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve({
    benutzerId: 'b', personId: null, aktiverMandantId: 'm', ansicht: 'mandant',
    aal: 'aal1', portal: 'intern', sitzungId: 's',
  }),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/services/bau/bautagebuch', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeWitterung: zustand.setzeWitterung,
}));

const { POST } = await import('../../src/app/api/bau/bautagebuch/route.js');

const HIER = 'http://localhost:3001';
const TAG = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const PROJEKT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function anfrage(witterung: string): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries({
    vorgang: 'witterung', witterung, bautag: TAG,
    mandant: 'bau', projekt: PROJEKT, datum: '2026-08-10',
  })) daten.set(k, v);
  return new NextRequest(`${HIER}/api/bau/bautagebuch`, {
    method: 'POST', body: daten, headers: { origin: HIER },
  });
}

beforeEach(() => { zustand.setzeWitterung.mockReset(); zustand.setzeWitterung.mockResolvedValue(undefined); });

describe('vorgang=witterung', () => {
  it('ja, nein und leer werden behindernd, nicht behindernd und nicht beurteilt', async () => {
    for (const [wert, behindernd] of [['ja', true], ['nein', false], ['', null]] as const) {
      zustand.setzeWitterung.mockClear();
      const r = await POST(anfrage(wert));
      expect(r.status, wert).toBe(303);
      expect(r.headers.get('location'))
        .toBe(`${HIER}/portal/bau/bau/projekte/${PROJEKT}/bautagebuch/2026-08-10`);
      expect(zustand.setzeWitterung).toHaveBeenCalledWith(
        expect.anything(), { bautagebuchId: TAG, behindernd });
    }
  });

  it('ein vierter Wert wird abgewiesen, nicht still zu „nicht beurteilt"', async () => {
    const r = await POST(anfrage('vielleicht'));
    expect(r.status).toBe(422);
    expect(((await r.json()) as { fehler: string }).fehler).toBe('ungueltige_eingabe');
    expect(zustand.setzeWitterung).not.toHaveBeenCalled();
  });
});
