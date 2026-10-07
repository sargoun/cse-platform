/**
 * Den Basiszinssatz eintragen — was ohne Datenbank feststeht (V-299, O-358,
 * FIN-15, D-809).
 *
 * Der Weg durch die echte Datenbank (Policy, Protokoll, Wächter) steht in
 * `tests/isolation/basiszinssatz-eingabe.test.ts`. Hier: Halbjahr, Prozent in
 * Basispunkten ohne Gleitkomma, die Anzeige, der Rückweg der Route und das
 * Manifest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const zustand = vi.hoisted(() => ({
  setzeBasiszinssatz: vi.fn(),
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
    fn({ abfrage: () => Promise.resolve([{ slug: 'operations', jahr: 2026 }]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/services/finanz/mahnung/basiszinssatz', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeBasiszinssatz: zustand.setzeBasiszinssatz,
}));

const {
  BasiszinsFehler, basispunkteAlsProzent, pruefeHalbjahr, pruefeQuelle, prozentInBasispunkte,
} = await import('../../src/server/services/finanz/mahnung/basiszinssatz.js');
const { POST } = await import('../../src/app/api/finanzen/basiszinssatz/route.js');
const { ROUTEN } = await import('../../src/server/auth/route-manifest.js');

const HIER = 'http://localhost:3001';

function anfrage(felder: Readonly<Record<string, string>>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.set(k, v);
  return new NextRequest(`${HIER}/api/finanzen/basiszinssatz`, {
    method: 'POST', body: daten, headers: { origin: HIER },
  });
}

function grund(fn: () => unknown): string {
  try {
    fn();
  } catch (fehler) {
    if (fehler instanceof BasiszinsFehler) return fehler.grund;
    throw fehler;
  }
  return 'kein_fehler';
}

beforeEach(() => {
  zustand.setzeBasiszinssatz.mockReset();
  zustand.setzeBasiszinssatz.mockResolvedValue('eingetragen');
});

describe('das Halbjahr', () => {
  it('erste und zweite Hälfte mit erstem und letztem Tag', () => {
    expect(pruefeHalbjahr('2027', '1', 2027))
      .toEqual({ jahr: 2027, haelfte: 1, von: '2027-01-01', bis: '2027-06-30' });
    expect(pruefeHalbjahr(' 2026 ', '2', 2027))
      .toEqual({ jahr: 2026, haelfte: 2, von: '2026-07-01', bis: '2026-12-31' });
  });

  it('vor 2002 und nach dem letzten erlaubten Jahr nicht, und nur die Hälften 1 und 2', () => {
    expect(grund(() => pruefeHalbjahr('2001', '2', 2027))).toBe('halbjahr_ungueltig');
    expect(grund(() => pruefeHalbjahr('2028', '1', 2027))).toBe('halbjahr_ungueltig');
    expect(grund(() => pruefeHalbjahr('2027', '3', 2027))).toBe('halbjahr_ungueltig');
    expect(grund(() => pruefeHalbjahr('27', '1', 2027))).toBe('halbjahr_ungueltig');
  });
});

describe('Prozent in Basispunkten — an den Ziffern, ohne Gleitkomma', () => {
  it('wie bekanntgegeben', () => {
    expect(prozentInBasispunkte('1,27')).toBe(127);
    expect(prozentInBasispunkte('3,62 %')).toBe(362);
    expect(prozentInBasispunkte('-0,88')).toBe(-88);
    expect(prozentInBasispunkte('−0.5')).toBe(-50);
    expect(prozentInBasispunkte('3')).toBe(300);
    expect(prozentInBasispunkte('1,2')).toBe(120);
    expect(prozentInBasispunkte('0,07')).toBe(7);
    expect(prozentInBasispunkte('-0')).toBe(0);
  });

  it('mehr als zwei Nachkommastellen oder keine Zahl: ungültig', () => {
    for (const roh of ['1,234', 'abc', '', '1,', ',5', '127', '1.2.3']) {
      expect(grund(() => prozentInBasispunkte(roh)), roh).toBe('satz_ungueltig');
    }
  });

  it('außerhalb der Prüfgrenze −10 % bis +20 %: unplausibel, etwa eine vertauschte Einheit', () => {
    expect(grund(() => prozentInBasispunkte('25'))).toBe('satz_unplausibel');
    expect(grund(() => prozentInBasispunkte('-11'))).toBe('satz_unplausibel');
    expect(prozentInBasispunkte('20')).toBe(2000);
    expect(prozentInBasispunkte('-10')).toBe(-1000);
  });

  it('die Anzeige mit echtem Minus und zwei Stellen', () => {
    expect(basispunkteAlsProzent(-88)).toBe('−0,88 %');
    expect(basispunkteAlsProzent(127)).toBe('1,27 %');
    expect(basispunkteAlsProzent(0)).toBe('0,00 %');
    expect(basispunkteAlsProzent(1200)).toBe('12,00 %');
  });

  it('die Quelle ist Pflicht', () => {
    expect(grund(() => pruefeQuelle('  '))).toBe('quelle_fehlt');
    expect(pruefeQuelle(' Deutsche Bundesbank ')).toBe('Deutsche Bundesbank');
  });
});

describe('der Rückweg trägt genau einen Schlüssel', () => {
  const GUT = { jahr: '2027', haelfte: '1', satz: '1,27', quelle: 'Deutsche Bundesbank' };

  it('eingetragen: zurück auf das Mahnwesen der Sitzung', async () => {
    const r = await POST(anfrage(GUT));
    expect(r.status).toBe(303);
    expect(r.headers.get('location'))
      .toBe(`${HIER}/portal/operations/einstellungen/mahnwesen?basiszins=eingetragen#basiszins`);
    expect(zustand.setzeBasiszinssatz).toHaveBeenCalledWith(expect.anything(), {
      halbjahr: { jahr: 2027, haelfte: 1, von: '2027-01-01', bis: '2027-06-30' },
      satzBp: 127, quelle: 'Deutsche Bundesbank',
    });
  });

  it('das späteste Jahr ist das nächste — aus der Datenbank, nicht aus der Node-Uhr', async () => {
    const r = await POST(anfrage({ ...GUT, jahr: '2028' }));
    expect(r.headers.get('location')).toContain('basiszins=halbjahr_ungueltig');
    expect(zustand.setzeBasiszinssatz).not.toHaveBeenCalled();
  });

  it('ein ungültiger Satz schreibt nichts', async () => {
    const r = await POST(anfrage({ ...GUT, satz: '127' }));
    expect(r.headers.get('location')).toContain('basiszins=satz_ungueltig');
    expect(zustand.setzeBasiszinssatz).not.toHaveBeenCalled();
  });

  it('keine Super-Administration: `basiszins=nur_super_admin`', async () => {
    zustand.setzeBasiszinssatz.mockRejectedValue(new BasiszinsFehler('nur_super_admin', 'x'));
    const r = await POST(anfrage(GUT));
    expect(r.headers.get('location')).toContain('basiszins=nur_super_admin');
  });
});

describe('Manifest', () => {
  it('die Route verlangt `system.referenzdaten_verwalten` — das Recht der Policies (0125)', () => {
    const zeile = ROUTEN.find((z) => z.pfad === 'api/finanzen/basiszinssatz');
    expect(zeile?.recht).toBe('system.referenzdaten_verwalten');
  });
});
