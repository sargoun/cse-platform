/**
 * Rücknahme von Abwesenheit und Antrag: ein Wettlauf ist nicht „gibt es
 * nicht" (V-198, D-692 Nr. 2, AUT-06).
 *
 * **Der Befund.** Nahm eine Kraft eine Abwesenheit oder einen Antrag zurück,
 * über den inzwischen entschieden war, warf der Dienst `…NichtGefunden`, und
 * die Route schickte `?fehler=nicht_gefunden` auf das Blatt desselben
 * Vorgangs. Das Blatt zeigte den Vorgang mit seinem neuen Stand — und darüber
 * in vier Sprachen, es gebe ihn nicht (mehr).
 *
 * Geprüft wird die ECHTE Route; ersetzt sind nur Sitzung, Datenbank und die
 * Dienste dahinter. Deren Verhalten — kein Update auf einen entschiedenen
 * Vorgang, und dann `…NichtGefunden` — prüft `tests/isolation/abwesenheit.test.ts`
 * an echten Zeilen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  findeAbwesenheit: vi.fn(),
  storniereAbwesenheit: vi.fn(),
  findeAntrag: vi.fn(),
  zieheAntragZurueck: vi.fn(),
  mandantDerAnstellung: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withPersonScope: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) => fn({}),
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) => fn({}),
}));
vi.mock('@/server/services/abwesenheit/index', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  findeAbwesenheit: zustand.findeAbwesenheit,
  storniereAbwesenheit: zustand.storniereAbwesenheit,
}));
vi.mock('@/server/services/abwesenheit/antrag', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  findeAntrag: zustand.findeAntrag,
  zieheAntragZurueck: zustand.zieheAntragZurueck,
}));
vi.mock('@/server/services/zeit/einwand', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  mandantDerAnstellung: zustand.mandantDerAnstellung,
}));

const { AbwesenheitNichtGefunden } = await import('../../src/server/services/abwesenheit/index.js');
const { AntragNichtGefunden } = await import('../../src/server/services/abwesenheit/antrag.js');
const { KeineAnstellungFehler } = await import('../../src/server/services/zeit/einwand.js');
const abwesenheit = await import('../../src/app/api/mein/abwesenheit/[id]/zurueckziehen/route.js');
const antrag = await import('../../src/app/api/mein/antraege/[id]/zurueckziehen/route.js');

const HIER = 'http://localhost:3001';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const ANSTELLUNG = '00000000-0000-4000-8000-0000000000a1';

function anfrage(pfad: string, felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

const params = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: null,
    personId: '00000000-0000-4000-8000-000000000004',
    ansicht: 'person', aal: 'aal1', portal: 'mitarbeiter',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  for (const f of [zustand.findeAbwesenheit, zustand.storniereAbwesenheit, zustand.findeAntrag,
    zustand.zieheAntragZurueck, zustand.mandantDerAnstellung]) f.mockReset();
  zustand.mandantDerAnstellung.mockResolvedValue('00000000-0000-4000-8000-000000000002');
});

describe('Rücknahme einer Abwesenheit', () => {
  const PFAD = `/api/mein/abwesenheit/${ID}/zurueckziehen`;
  const BLATT = `/portal/mein/abwesenheit/${ID}`;

  it('entschieden, während das Blatt offen war: `ungueltiger_zustand`, nicht „gibt es nicht"', async () => {
    zustand.findeAbwesenheit.mockResolvedValue({ anstellungId: ANSTELLUNG });
    zustand.storniereAbwesenheit.mockRejectedValue(new AbwesenheitNichtGefunden(ID));
    const r = await abwesenheit.POST(anfrage(PFAD, {
      grund: 'x', zurueck: '/portal/mein/antraege', fehlerweg: BLATT,
    }), params);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=ungueltiger_zustand`);
  });

  it('eine fremde oder fehlende Abwesenheit bleibt `nicht_gefunden` (AUT-06)', async () => {
    zustand.findeAbwesenheit.mockResolvedValue(null);
    const r = await abwesenheit.POST(anfrage(PFAD, { grund: 'x', fehlerweg: BLATT }), params);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=nicht_gefunden`);
    expect(zustand.storniereAbwesenheit).not.toHaveBeenCalled();
  });

  it('eine Beschäftigung, die es für die Anmeldung nicht (mehr) gibt, bleibt `nicht_gefunden`', async () => {
    zustand.findeAbwesenheit.mockResolvedValue({ anstellungId: ANSTELLUNG });
    zustand.mandantDerAnstellung.mockRejectedValue(new KeineAnstellungFehler());
    const r = await abwesenheit.POST(anfrage(PFAD, { grund: 'x', fehlerweg: BLATT }), params);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=nicht_gefunden`);
  });

  it('ohne Formularfelder ist der Aufrufer ein Programm: JSON 409 mit dem Grund', async () => {
    zustand.findeAbwesenheit.mockResolvedValue({ anstellungId: ANSTELLUNG });
    zustand.storniereAbwesenheit.mockRejectedValue(new AbwesenheitNichtGefunden(ID));
    const r = await abwesenheit.POST(anfrage(PFAD, { grund: 'x' }), params);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ fehler: 'ungueltiger_zustand' });
  });

  it('Erfolg: auf `zurueck`', async () => {
    zustand.findeAbwesenheit.mockResolvedValue({ anstellungId: ANSTELLUNG });
    zustand.storniereAbwesenheit.mockResolvedValue(undefined);
    const r = await abwesenheit.POST(anfrage(PFAD, {
      grund: 'x', zurueck: '/portal/mein/antraege', fehlerweg: BLATT,
    }), params);
    expect(r.headers.get('location')).toBe(`${HIER}/portal/mein/antraege`);
  });
});

describe('Rücknahme eines Antrags', () => {
  const PFAD = `/api/mein/antraege/${ID}/zurueckziehen`;
  const BLATT = `/portal/mein/antraege/${ID}`;

  it('entschieden, während das Blatt offen war: `ungueltiger_zustand`', async () => {
    zustand.findeAntrag.mockResolvedValue({ anstellungId: ANSTELLUNG });
    zustand.zieheAntragZurueck.mockRejectedValue(new AntragNichtGefunden(ID));
    const r = await antrag.POST(anfrage(PFAD, { zurueck: '/portal/mein/antraege', fehlerweg: BLATT }),
      params);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=ungueltiger_zustand`);
  });

  it('ein fremder oder fehlender Antrag bleibt `nicht_gefunden`', async () => {
    zustand.findeAntrag.mockResolvedValue(null);
    const r = await antrag.POST(anfrage(PFAD, { fehlerweg: BLATT }), params);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=nicht_gefunden`);
    expect(zustand.zieheAntragZurueck).not.toHaveBeenCalled();
  });
});
