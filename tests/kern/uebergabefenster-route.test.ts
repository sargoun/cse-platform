/**
 * Das Übergabefenster des Wachbuchs — was ohne Datenbank feststeht (V-323,
 * O-151, D-808).
 *
 * Der Weg durch die echte Datenbank (Policy, Lesefunktion, Protokoll) steht in
 * `tests/isolation/uebergabefenster.test.ts`. Hier: die Eingabeprüfung, der
 * Rückweg der Route mit genau einem Schlüssel, das Manifest und die Sätze in
 * beiden Sprachen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const zustand = vi.hoisted(() => ({
  setzeUebergabefenster: vi.fn(),
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
    fn({ abfrage: () => Promise.resolve([{ slug: 'security' }]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/services/security/bewacherregister', () => ({
  securityGebucht: () => Promise.resolve(true),
}));
vi.mock('@/server/services/security/uebergabefenster', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeUebergabefenster: zustand.setzeUebergabefenster,
}));

const {
  UebergabefensterFehler, pruefeUebergabeStunden, UEBERGABE_VOREINSTELLUNG_STUNDEN,
} = await import('../../src/server/services/security/uebergabefenster.js');
const { POST } = await import('../../src/app/api/security/uebergabefenster/route.js');
const { UEBERGABEFENSTER_TEXTE } = await import('../../src/lib/i18n/verwaltung/wachbuch.js');
const { ROUTEN } = await import('../../src/server/auth/route-manifest.js');

const HIER = 'http://localhost:3001';

function anfrage(stunden: string): NextRequest {
  const daten = new FormData();
  daten.set('stunden', stunden);
  return new NextRequest(`${HIER}/api/security/uebergabefenster`, {
    method: 'POST', body: daten, headers: { origin: HIER },
  });
}

beforeEach(() => {
  zustand.setzeUebergabefenster.mockReset();
  zustand.setzeUebergabefenster.mockResolvedValue(undefined);
});

describe('die Eingabe: ganze Stunden von 0 bis 24', () => {
  it('nimmt 0, 12 und 24', () => {
    expect(pruefeUebergabeStunden('0')).toBe(0);
    expect(pruefeUebergabeStunden(' 12 ')).toBe(12);
    expect(pruefeUebergabeStunden('24')).toBe(24);
  });

  it('weist Leeres, Brüche, Negatives und mehr als einen Tag ab', () => {
    for (const roh of ['', '25', '-1', '1.5', '1,5', 'zwölf', '100']) {
      expect(() => pruefeUebergabeStunden(roh), roh).toThrow(UebergabefensterFehler);
    }
  });

  it('die Voreinstellung ist zwölf Stunden (O-151, D-789)', () => {
    expect(UEBERGABE_VOREINSTELLUNG_STUNDEN).toBe(12);
  });
});

describe('der Rückweg trägt genau einen Schlüssel', () => {
  it('gespeichert: zurück auf das Wachbuch der Sitzung mit `erfolg=fenster_gesetzt`', async () => {
    const r = await POST(anfrage('12'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location'))
      .toBe(`${HIER}/portal/security/security/wachbuch?erfolg=fenster_gesetzt`);
    expect(zustand.setzeUebergabefenster).toHaveBeenCalledWith(expect.anything(), 12);
  });

  it('ausserhalb: `fehler=fenster_ausserhalb`, und geschrieben wird nichts', async () => {
    const r = await POST(anfrage('30'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location'))
      .toBe(`${HIER}/portal/security/security/wachbuch?fehler=fenster_ausserhalb`);
    expect(zustand.setzeUebergabefenster).not.toHaveBeenCalled();
  });
});

describe('Manifest und Sätze', () => {
  it('die Route verlangt `system.einstellung_verwalten` — das Recht der Policy (0033)', () => {
    const zeile = ROUTEN.find((z) => z.pfad === 'api/security/uebergabefenster');
    expect(zeile?.recht).toBe('system.einstellung_verwalten');
  });

  it('beide Sprachen kennen dieselben Sätze, und eine Stunde ist nicht zwei', () => {
    for (const t of [UEBERGABEFENSTER_TEXTE.de, UEBERGABEFENSTER_TEXTE.en]) {
      for (const satz of [t.titel, t.nieEingestellt, t.aus, t.feld, t.speichern, t.gesetzt,
        t.ausserhalb, t.voreinstellung(12)]) expect(satz).toMatch(/\S/u);
      expect(t.stunden(1)).not.toBe(t.stunden(2).replace('2', '1'));
      expect(t.nieEingestellt).not.toBe(t.aus);
    }
  });
});
