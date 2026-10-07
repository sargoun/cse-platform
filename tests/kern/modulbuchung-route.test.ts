/**
 * Die Modulbuchung einer Gesellschaft — was ohne Datenbank feststeht (V-298,
 * O-355, D-809).
 *
 * Der Weg durch die echte Datenbank (Super-Administration, Protokoll, was
 * nicht geht) steht in `tests/isolation/mandant-module-buchen.test.ts`. Hier:
 * die Formularprüfung, der Rückweg der Route mit genau einem Schlüssel, das
 * Manifest und die Sätze in beiden Sprachen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const zustand = vi.hoisted(() => ({
  bucheModule: vi.fn(),
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
    fn({ abfrage: () => Promise.resolve([{ slug: 'bau' }]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/services/system/mandant-module', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  bucheModule: zustand.bucheModule,
}));

const {
  ModulbuchungFehler, gewerkeAusFormular,
} = await import('../../src/server/services/system/mandant-module.js');
const { POST } = await import('../../src/app/api/einstellungen/module/route.js');
const { MODULBUCHUNG_TEXTE } = await import(
  '../../src/lib/i18n/verwaltung/einstellungen/modulbuchung.js');
const { ROUTEN } = await import('../../src/server/auth/route-manifest.js');
const { GEWERKE } = await import('../../src/server/registry/modul.js');

const HIER = 'http://localhost:3001';

function anfrage(gewerke: readonly string[]): NextRequest {
  const daten = new FormData();
  for (const g of gewerke) daten.append('gewerk', g);
  return new NextRequest(`${HIER}/api/einstellungen/module`, {
    method: 'POST', body: daten, headers: { origin: HIER },
  });
}

beforeEach(() => {
  zustand.bucheModule.mockReset();
  zustand.bucheModule.mockResolvedValue({ geaendert: true });
});

describe('das Formular: nur Gewerke, jedes einmal, geordnet', () => {
  it('doppelt und ungeordnet wird einmal und geordnet', () => {
    expect(gewerkeAusFormular(['security', 'bau', 'security'])).toEqual(['bau', 'security']);
  });

  it('keines ist erlaubt und heißt „kein Gewerk"', () => {
    expect(gewerkeAusFormular([])).toEqual([]);
  });

  it('ein Querschnittsmodul oder ein Tippfehler ist kein Gewerk', () => {
    for (const roh of ['crm', 'finanzen', 'Reinigung', '']) {
      expect(() => gewerkeAusFormular([roh]), roh).toThrow(ModulbuchungFehler);
    }
  });
});

describe('der Rückweg trägt genau einen Schlüssel', () => {
  it('gespeichert: zurück auf die Modulseite der Sitzung mit `erfolg=gebucht`', async () => {
    const r = await POST(anfrage(['security', 'bau']));
    expect(r.status).toBe(303);
    expect(r.headers.get('location'))
      .toBe(`${HIER}/portal/bau/einstellungen/module?erfolg=gebucht`);
    expect(zustand.bucheModule).toHaveBeenCalledWith(expect.anything(), ['bau', 'security']);
  });

  it('unverändert: `erfolg=unveraendert`', async () => {
    zustand.bucheModule.mockResolvedValue({ geaendert: false });
    const r = await POST(anfrage(['bau']));
    expect(r.headers.get('location'))
      .toBe(`${HIER}/portal/bau/einstellungen/module?erfolg=unveraendert`);
  });

  it('kein Gewerk: `fehler=unbekanntes_gewerk`, und geschrieben wird nichts', async () => {
    const r = await POST(anfrage(['crm']));
    expect(r.headers.get('location'))
      .toBe(`${HIER}/portal/bau/einstellungen/module?fehler=unbekanntes_gewerk`);
    expect(zustand.bucheModule).not.toHaveBeenCalled();
  });

  it('keine Super-Administration: `fehler=nur_super_admin`', async () => {
    zustand.bucheModule.mockRejectedValue(
      new ModulbuchungFehler('x', 'nur_super_admin', 403));
    const r = await POST(anfrage(['bau']));
    expect(r.headers.get('location'))
      .toBe(`${HIER}/portal/bau/einstellungen/module?fehler=nur_super_admin`);
  });

  it('die zweite Linie hinter `authorize` antwortet wie diese: 404', async () => {
    zustand.bucheModule.mockRejectedValue(new ModulbuchungFehler('x', 'nicht_erlaubt', 404));
    const r = await POST(anfrage(['bau']));
    expect(r.status).toBe(404);
  });
});

describe('Manifest und Sätze', () => {
  it('die Route verlangt `system.module_zuweisen`', () => {
    const zeile = ROUTEN.find((z) => z.pfad === 'api/einstellungen/module');
    expect(zeile?.recht).toBe('system.module_zuweisen');
  });

  it('beide Sprachen benennen jedes Gewerk und jeden Schlüssel des Rückwegs', () => {
    for (const t of [MODULBUCHUNG_TEXTE.de, MODULBUCHUNG_TEXTE.en]) {
      for (const g of GEWERKE) expect(t.gewerk[g], g).toMatch(/\S/u);
      for (const satz of [t.titel, t.erklaerung, t.keinesHeisst, t.speichern, t.nurSuperAdmin,
        t.seedStand, t.erfolg.gebucht, t.erfolg.unveraendert, t.fehler.nur_super_admin,
        t.fehler.unbekanntes_gewerk, t.eingetragen('01.01.2027 10:00', null)]) {
        expect(satz).toMatch(/\S/u);
      }
      expect(t.eingetragen('01.01.2027 10:00', 'Chef')).toContain('Chef');
    }
  });
});
