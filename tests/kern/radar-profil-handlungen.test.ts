/**
 * Zwei neue Handlungen am Radarprofil — was ohne Datenbank feststeht (V-309,
 * V-312, O-15, O-98, D-809).
 *
 * Der Weg durch die echte Datenbank (Fassung, Protokoll, Policy) steht in
 * `tests/isolation/radar-profil-schreiben.test.ts` (10) und (11). Hier: die
 * Prüfung der eigenen Schwelle und dass die Route die Felder richtig an den
 * Dienst gibt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const zustand = vi.hoisted(() => ({
  bestaetigeCpv: vi.fn(),
  setzeEmpfaenger: vi.fn(),
  setzeEmpfaengerSchwelle: vi.fn(),
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
    fn({ abfrage: () => Promise.resolve([{ slug: 'reinigung' }]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/services/radar/profil', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  bestaetigeCpv: zustand.bestaetigeCpv,
  setzeEmpfaenger: zustand.setzeEmpfaenger,
  setzeEmpfaengerSchwelle: zustand.setzeEmpfaengerSchwelle,
}));

const { ProfilFehler, pruefeEmpfaengerSchwelle } = await import(
  '../../src/server/services/radar/profil.js');
const { POST } = await import('../../src/app/api/radar/profil/route.js');

const HIER = 'http://localhost:3001';
const PROFIL = '11111111-1111-4111-8111-111111111111';
const ZEILE = '22222222-2222-4222-8222-222222222222';

function anfrage(felder: Readonly<Record<string, string>>): NextRequest {
  const daten = new FormData();
  daten.set('profil', PROFIL);
  for (const [k, v] of Object.entries(felder)) daten.set(k, v);
  return new NextRequest(`${HIER}/api/radar/profil`, {
    method: 'POST', body: daten, headers: { origin: HIER },
  });
}

beforeEach(() => {
  for (const f of Object.values(zustand)) {
    f.mockReset();
    f.mockResolvedValue(undefined);
  }
});

describe('die eigene Schwelle: 1 bis zur Skala, oder die des Profils', () => {
  it('nimmt 1, die Skala und leer', () => {
    expect(pruefeEmpfaengerSchwelle(1, 100)).toBe(1);
    expect(pruefeEmpfaengerSchwelle(100, 100)).toBe(100);
    expect(pruefeEmpfaengerSchwelle(null, 100)).toBeNull();
  });

  it('weist 0, Brüche, NaN und mehr als die Skala ab', () => {
    for (const falsch of [0, -1, 2.5, Number.NaN, 101]) {
      expect(() => pruefeEmpfaengerSchwelle(falsch, 100), String(falsch)).toThrow(ProfilFehler);
    }
  });
});

describe('die Route gibt die Felder richtig weiter', () => {
  it('`cpv_bestaetigen`: Profil und Zeile, zurück mit `vermerkt=cpv_bestaetigen`', async () => {
    const r = await POST(anfrage({ was: 'cpv_bestaetigen', cpv: ZEILE }));
    expect(zustand.bestaetigeCpv).toHaveBeenCalledWith(expect.anything(), PROFIL, ZEILE);
    expect(r.headers.get('location'))
      .toBe(`${HIER}/portal/reinigung/radar/profile/${PROFIL}?vermerkt=cpv_bestaetigen`);
  });

  it('`empfaenger_hinzu` mit Schwelle — und ohne: `null`, die des Profils', async () => {
    await POST(anfrage({ was: 'empfaenger_hinzu', benutzer: ZEILE, abPunkte: '75' }));
    expect(zustand.setzeEmpfaenger).toHaveBeenCalledWith(expect.anything(), PROFIL, ZEILE, 75);
    await POST(anfrage({ was: 'empfaenger_hinzu', benutzer: ZEILE, abPunkte: '' }));
    expect(zustand.setzeEmpfaenger).toHaveBeenLastCalledWith(
      expect.anything(), PROFIL, ZEILE, null);
  });

  it('`empfaenger_schwelle`: „12 Punkte" ist keine Zwölf — der Dienst bekommt NaN', async () => {
    await POST(anfrage({ was: 'empfaenger_schwelle', empfaenger: ZEILE, abPunkte: '12 Punkte' }));
    const [, , , wert] = zustand.setzeEmpfaengerSchwelle.mock.calls[0] as unknown[];
    expect(Number.isNaN(wert)).toBe(true);
  });

  it('eine abgewiesene Schwelle kommt als `fehler=schwelle` zurück', async () => {
    zustand.setzeEmpfaengerSchwelle.mockRejectedValue(new ProfilFehler('schwelle', 'x'));
    const r = await POST(anfrage({ was: 'empfaenger_schwelle', empfaenger: ZEILE, abPunkte: '0' }));
    expect(r.headers.get('location')).toContain('fehler=schwelle');
  });
});
