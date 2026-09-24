/**
 * `POST /api/crm/notiz` — der Rückweg auf das Blatt (V-147, V-153, D-599, D-641).
 *
 * **Der Befund der Nachprüfung.** Die Route hatte keinen Test: weder, dass
 * eine Abweisung als `?notiz=<grund>` und ein Erfolg als `?notiert=1` auf das
 * Blatt zurückkommt, noch dass `zurueck` nur innerhalb des Portals führt
 * (`internesZiel`). Und eine Kennung aus einem veränderten versteckten Feld,
 * die keine UUID ist, endete am `::uuid` als 500 — seit V-153 weist der Dienst
 * sie als `ungueltiger_bezug` ab, und die Route bringt den Satz aufs Blatt.
 *
 * Geprüft wird die ECHTE Route; ersetzt sind nur Sitzung, Datenbank und der
 * Dienst dahinter (dessen Verhalten `tests/isolation/crm-verlauf.test.ts` an
 * echten Zeilen prüft).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CrmFehler } from '../../src/server/services/crm/anlegen.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  halteFest: vi.fn(),
  authorize: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/crm/verlauf', () => ({ halteFest: zustand.halteFest }));

const { POST } = await import('../../src/app/api/crm/notiz/route.js');

const HIER = 'http://localhost:3001';
const BLATT = '/portal/reinigung/crm/kunden/5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';

function anfrage(felder: Record<string, string>, ursprung: string | null = HIER): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001' });
  if (ursprung !== null) kopf.set('origin', ursprung);
  return new NextRequest(new URL('/api/crm/notiz', HIER), { method: 'POST', body: daten, headers: kopf });
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.halteFest.mockReset();
  zustand.authorize.mockReset();
  zustand.halteFest.mockResolvedValue('00000000-0000-4000-8000-00000000000a');
  zustand.authorize.mockResolvedValue(undefined);
});

describe('POST /api/crm/notiz', () => {
  it('Erfolg: zurück aufs Blatt mit ?notiert=1, am Abschnitt „Kommunikation"', async () => {
    const antwort = await POST(anfrage({
      kundeId: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e', art: 'anruf', richtung: 'eingehend',
      zweck: 'vertraglich', betreff: '', inhalt: 'Rückruf zur Glasreinigung', zurueck: BLATT,
    }));
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location')).toBe(`${HIER}${BLATT}?notiert=1#kommunikation`);
    // Leere Felder kommen als „nicht angegeben" an — ein leerer Zweck ist keine Wahl (V-153).
    expect(zustand.halteFest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kundeId: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e', ansprechpartnerId: undefined,
      art: 'anruf', richtung: 'eingehend', zweck: 'vertraglich', betreff: undefined,
      inhalt: 'Rückruf zur Glasreinigung',
    }));
    expect(zustand.authorize).toHaveBeenCalledWith(
      zustand.sitzung, { recht: 'crm.schreiben', schreibend: true }, expect.anything());
  });

  it('Abweisung: der Schlüssel als ?notiz=, nie der Satz — und `&`, wenn das Blatt schon eine Abfrage trägt', async () => {
    zustand.halteFest.mockRejectedValue(
      new CrmFehler('Wählen Sie den Zweck …', 'ohne_zweck'));
    const antwort = await POST(anfrage({
      kundeId: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e', art: 'anruf', richtung: 'ausgehend',
      zweck: '', inhalt: 'x', zurueck: `${BLATT}?tab=verlauf`,
    }));
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location'))
      .toBe(`${HIER}${BLATT}?tab=verlauf&notiz=ohne_zweck#kommunikation`);
    expect(zustand.halteFest).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ zweck: undefined }));
  });

  it('V-153: eine Kennung, die keine UUID ist, kommt als Satz zurück — nicht als 500', async () => {
    zustand.halteFest.mockRejectedValue(
      new CrmFehler('Dieser Bezug ist ungültig.', 'ungueltiger_bezug', 400));
    const antwort = await POST(anfrage({
      kundeId: "x' or 1=1", art: 'notiz', richtung: 'intern', inhalt: 'x', zurueck: BLATT,
    }));
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location'))
      .toBe(`${HIER}${BLATT}?notiz=ungueltiger_bezug#kommunikation`);
  });

  it('`zurueck` führt nie aus dem Portal hinaus (internesZiel)', async () => {
    const antwort = await POST(anfrage({
      kundeId: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e', art: 'notiz', richtung: 'intern',
      inhalt: 'x', zurueck: 'https://fremd.example/portal',
    }));
    expect(antwort.status).toBe(303);
    expect(new URL(antwort.headers.get('location') ?? '').origin).toBe(HIER);
  });

  it('fremder Ursprung: 403, und der Dienst wird nicht gefragt', async () => {
    const antwort = await POST(anfrage({ inhalt: 'x', zurueck: BLATT }, 'https://fremd.example'));
    expect(antwort.status).toBe(403);
    expect(zustand.halteFest).not.toHaveBeenCalled();
  });

  it('ohne Sitzung oder ohne aktiven Bereich: 401', async () => {
    zustand.sitzung = null;
    expect((await POST(anfrage({ inhalt: 'x', zurueck: BLATT }))).status).toBe(401);
    zustand.sitzung = { aktiverMandantId: null };
    expect((await POST(anfrage({ inhalt: 'x', zurueck: BLATT }))).status).toBe(401);
    expect(zustand.halteFest).not.toHaveBeenCalled();
  });
});
