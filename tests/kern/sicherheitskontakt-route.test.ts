/**
 * Der Sicherheitskontakt der Plattform — was ohne Datenbank feststeht (V-392,
 * O-35, D-809).
 *
 * Der Weg durch die echte Datenbank (Definer, Policy, Protokoll) steht in
 * `tests/isolation/sicherheitskontakt.test.ts`. Hier: die Prüfung nach
 * RFC 9116 vor der Datenbank, der Rückweg der Route mit genau einem
 * Schlüssel und das Manifest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const zustand = vi.hoisted(() => ({
  setzeSicherheitskontakt: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve({
    benutzerId: 'b', personId: null, aktiverMandantId: 'm', ansicht: 'mandant',
    aal: 'aal2', portal: 'intern', sitzungId: 's',
  }),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([{ slug: 'operations' }]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/services/inhalt/sicherheitskontakt', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeSicherheitskontakt: zustand.setzeSicherheitskontakt,
}));

const {
  SicherheitskontaktFehler, pruefeSicherheitskontakt,
} = await import('../../src/server/services/inhalt/sicherheitskontakt.js');
const { POST } = await import('../../src/app/api/einstellungen/sicherheitskontakt/route.js');
const { ROUTEN } = await import('../../src/server/auth/route-manifest.js');

const HIER = 'http://localhost:3001';

function anfrage(kontakt: string, richtlinie = ''): NextRequest {
  const daten = new FormData();
  daten.set('kontakt', kontakt);
  daten.set('richtlinie', richtlinie);
  return new NextRequest(`${HIER}/api/einstellungen/sicherheitskontakt`, {
    method: 'POST', body: daten, headers: { origin: HIER },
  });
}

function grund(fn: () => unknown): string {
  try {
    fn();
  } catch (fehler) {
    if (fehler instanceof SicherheitskontaktFehler) return fehler.grund;
    throw fehler;
  }
  return 'kein_fehler';
}

beforeEach(() => {
  zustand.setzeSicherheitskontakt.mockReset();
  zustand.setzeSicherheitskontakt.mockResolvedValue({ geaendert: true });
});

describe('RFC 9116: Contact ist eine URI, Policy eine https-URI', () => {
  it('mailto:, https: und tel: gehen — getrimmt', () => {
    expect(pruefeSicherheitskontakt({ kontakt: ' mailto:security@cse.test ', richtlinie: '' }))
      .toEqual({ kontakt: 'mailto:security@cse.test', richtlinie: '' });
    expect(pruefeSicherheitskontakt({
      kontakt: 'https://cse.test/melden', richtlinie: 'https://cse.test/regeln',
    })).toEqual({ kontakt: 'https://cse.test/melden', richtlinie: 'https://cse.test/regeln' });
    expect(pruefeSicherheitskontakt({ kontakt: 'tel:+49 30 1234567', richtlinie: '' }).kontakt)
      .toBe('tel:+49 30 1234567');
  });

  it('leer heißt kein Postfach', () => {
    expect(pruefeSicherheitskontakt({ kontakt: '  ', richtlinie: '' }))
      .toEqual({ kontakt: '', richtlinie: '' });
  });

  it('eine nackte Adresse, http: oder eine Richtlinie ohne Kontakt nicht', () => {
    expect(grund(() => pruefeSicherheitskontakt({ kontakt: 'security@cse.test', richtlinie: '' })))
      .toBe('kontakt_ungueltig');
    expect(grund(() => pruefeSicherheitskontakt({ kontakt: 'http://cse.test', richtlinie: '' })))
      .toBe('kontakt_ungueltig');
    expect(grund(() => pruefeSicherheitskontakt({
      kontakt: 'mailto:a@b.de', richtlinie: 'http://cse.test/regeln',
    }))).toBe('richtlinie_ungueltig');
    expect(grund(() => pruefeSicherheitskontakt({ kontakt: '', richtlinie: 'https://cse.test' })))
      .toBe('richtlinie_ohne_kontakt');
  });
});

describe('der Rückweg trägt genau einen Schlüssel', () => {
  it('gespeichert: zurück auf Einstellungen › Betrieb der Sitzung', async () => {
    const r = await POST(anfrage('mailto:security@cse.test'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(
      `${HIER}/portal/operations/einstellungen/betrieb?sicherheitskontakt=gesetzt#sicherheitskontakt`);
    expect(zustand.setzeSicherheitskontakt).toHaveBeenCalledWith(
      expect.anything(), { kontakt: 'mailto:security@cse.test', richtlinie: '' });
  });

  it('unverändert und abgewiesen tragen ihren Schlüssel', async () => {
    zustand.setzeSicherheitskontakt.mockResolvedValueOnce({ geaendert: false });
    expect((await POST(anfrage('mailto:a@b.de'))).headers.get('location'))
      .toContain('sicherheitskontakt=unveraendert');
    zustand.setzeSicherheitskontakt.mockRejectedValueOnce(
      new SicherheitskontaktFehler('x', 'nur_super_admin', 403));
    expect((await POST(anfrage('mailto:a@b.de'))).headers.get('location'))
      .toContain('sicherheitskontakt=nur_super_admin');
  });

  it('die zweite Linie hinter `authorize` antwortet wie diese: 404', async () => {
    zustand.setzeSicherheitskontakt.mockRejectedValue(
      new SicherheitskontaktFehler('x', 'nicht_erlaubt', 404));
    expect((await POST(anfrage('mailto:a@b.de'))).status).toBe(404);
  });
});

describe('Manifest', () => {
  it('die Route verlangt `system.einstellung_verwalten`', () => {
    const zeile = ROUTEN.find((z) => z.pfad === 'api/einstellungen/sicherheitskontakt');
    expect(zeile?.recht).toBe('system.einstellung_verwalten');
  });
});
