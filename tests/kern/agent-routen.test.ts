/**
 * `POST /api/agenten/werkzeug` und `POST /api/agenten/assistent` — was nur die
 * Routen tun (V-228, V-229, V-270, D-722, D-723).
 *
 * **Der Befund der Nachprüfung.** `setzeWerkzeug` und `beantworteFrage` sind
 * an echten Zeilen geprüft (`tests/isolation/agent-werkzeug-pflege.test.ts`,
 * `tests/isolation/agent-assistent.test.ts`); die zwei Routen davor prüfte
 * niemand: dass ein fehlendes Häkchen „aus" heisst, dass die versteckte
 * `freigabe=1` des gesperrten Versandschalters ankommt, die Rückwege
 * `?werkzeug=gesetzt#werkzeuge` und `?werkzeug_fehler=…`, und die 303 des
 * Assistenten auf `?aufgabe=` oder `?fehler=`.
 *
 * Geprüft wird die ECHTE Route; ersetzt sind nur Sitzung, Datenbank und die
 * zwei Dienste (wie in `crm-notiz-route.test.ts`). Den Weg im Browser —
 * ausschalten, fragen, einschalten, fragen — geht `tests/e2e/agenten.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { WerkzeugPflegeFehler } from '../../src/server/services/agent/werkzeug-pflege.js';
import { AssistentFehler } from '../../src/server/services/agent/assistent.js';
import { AgentInaktiv } from '../../src/server/agent/laufzeit.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  setzeWerkzeug: vi.fn(),
  beantworteFrage: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
/* Die Abfrage nach Bereich und Agent: `reinigung`, und der Agent zur Kennung —
   ausser die Kennung ist keine UUID, dann gibt es ihn nicht (`null`). */
vi.mock('@/server/kontext/index', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) => fn({
    abfrage: (_sql: string, werte?: readonly unknown[]) => Promise.resolve([{
      slug: 'reinigung',
      kennung: werte !== undefined && werte[0] === null ? null : 'ceo_assistent',
    }]),
  }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/agent/werkzeug-pflege', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeWerkzeug: zustand.setzeWerkzeug,
}));
vi.mock('@/server/services/agent/assistent', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  beantworteFrage: zustand.beantworteFrage,
}));

const { POST: werkzeugPost } = await import('../../src/app/api/agenten/werkzeug/route.js');
const { POST: assistentPost } = await import('../../src/app/api/agenten/assistent/route.js');

const HIER = 'http://localhost:3001';
const AGENT = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const AUFGABE = '7c1e7d2f-1b52-4d66-8e2d-2d3f4c5b6e7f';

function anfrage(pfad: string, felder: Record<string, string>, ursprung: string | null = HIER,
): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001' });
  if (ursprung !== null) kopf.set('origin', ursprung);
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

const werkzeug = (felder: Record<string, string>, ursprung?: string | null) =>
  werkzeugPost(anfrage('/api/agenten/werkzeug', felder, ursprung));
const frage = (felder: Record<string, string>, ursprung?: string | null) =>
  assistentPost(anfrage('/api/agenten/assistent', felder, ursprung));

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  for (const f of [zustand.authorize, zustand.setzeWerkzeug, zustand.beantworteFrage]) {
    f.mockReset();
  }
  zustand.authorize.mockResolvedValue(undefined);
  zustand.setzeWerkzeug.mockResolvedValue(undefined);
  zustand.beantworteFrage.mockResolvedValue({ aufgabeId: AUFGABE, bestand: false });
});

describe('POST /api/agenten/werkzeug', () => {
  const BLATT = `${HIER}/portal/reinigung/agenten/ceo-assistent`;

  it('beide Häkchen: freigeschaltet und nur mit Freigabe — zurück aufs Blatt, am Abschnitt', async () => {
    const antwort = await werkzeug({
      agent: AGENT, werkzeug: 'suche_bestand', aktiv: '1', freigabe: '1',
    });
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location')).toBe(`${BLATT}?werkzeug=gesetzt#werkzeuge`);
    expect(zustand.setzeWerkzeug).toHaveBeenCalledWith(expect.anything(), {
      agentId: AGENT, werkzeug: 'suche_bestand', istAktiv: true, erfordertFreigabe: true,
    });
    expect(zustand.authorize).toHaveBeenCalledWith(
      zustand.sitzung, { recht: 'agent.werkzeug_verbinden', schreibend: true },
      expect.anything());
  });

  it('ein fehlendes Häkchen heisst „aus" — ein Browser schickt ein leeres Kästchen gar nicht', async () => {
    await werkzeug({ agent: AGENT, werkzeug: 'suche_bestand' });
    expect(zustand.setzeWerkzeug).toHaveBeenCalledWith(expect.anything(), {
      agentId: AGENT, werkzeug: 'suche_bestand', istAktiv: false, erfordertFreigabe: false,
    });
  });

  it('der gesperrte Versandschalter: die Pflicht kommt als verstecktes Feld an', async () => {
    await werkzeug({ agent: AGENT, werkzeug: 'sende_email', freigabe: '1' });
    expect(zustand.setzeWerkzeug).toHaveBeenCalledWith(expect.anything(), {
      agentId: AGENT, werkzeug: 'sende_email', istAktiv: false, erfordertFreigabe: true,
    });
  });

  it('eine Abweisung des Dienstes kommt als Grund aufs Blatt, nicht als JSON', async () => {
    zustand.setzeWerkzeug.mockRejectedValue(
      new WerkzeugPflegeFehler('Ohne Freigabe geht nichts hinaus.', 'freigabe_pflicht'));
    const antwort = await werkzeug({ agent: AGENT, werkzeug: 'sende_email', aktiv: '1' });
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location'))
      .toBe(`${BLATT}?werkzeug_fehler=freigabe_pflicht#werkzeuge`);
  });

  it('eine Kennung, die keine UUID ist: „kein_agent" auf der Agentenliste, der Dienst läuft nicht', async () => {
    const antwort = await werkzeug({ agent: 'x; drop table agent', werkzeug: 'suche_bestand' });
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location'))
      .toBe(`${HIER}/portal/reinigung/agenten?werkzeug_fehler=kein_agent#werkzeuge`);
    expect(zustand.setzeWerkzeug).not.toHaveBeenCalled();
  });

  it('fremder Ursprung: 403, und nichts wird gesetzt', async () => {
    const antwort = await werkzeug(
      { agent: AGENT, werkzeug: 'suche_bestand', aktiv: '1' }, 'https://fremd.example');
    expect(antwort.status).toBe(403);
    expect(zustand.setzeWerkzeug).not.toHaveBeenCalled();
  });
});

describe('POST /api/agenten/assistent', () => {
  const SEITE = `${HIER}/portal/reinigung/agenten/assistent`;

  it('eine Frage wird eine Aufgabe — und die Seite zeigt DIESE Aufgabe', async () => {
    const antwort = await frage({ frage: 'offene_rechnungen_anzahl', schluessel: 's-1' });
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location')).toBe(`${SEITE}?aufgabe=${AUFGABE}`);
    expect(zustand.beantworteFrage).toHaveBeenCalledWith(expect.anything(), {
      abfrageId: 'offene_rechnungen_anzahl', schluessel: 's-1',
      angefordertVon: '00000000-0000-4000-8000-000000000001',
    });
    expect(zustand.authorize).toHaveBeenCalledWith(
      zustand.sitzung, { recht: 'agent.aufgabe_starten', schreibend: true }, expect.anything());
  });

  it('eine Frage, die nicht im Katalog steht: ?fehler=unbekannt', async () => {
    zustand.beantworteFrage.mockRejectedValue(new AssistentFehler('Unbekannt.', 'unbekannt'));
    const antwort = await frage({ frage: 'gibt_es_nicht', schluessel: 's-2' });
    expect(antwort.headers.get('location')).toBe(`${SEITE}?fehler=unbekannt`);
  });

  it('ein abgeschalteter Agent: ?fehler=agent_aus (AGT-01)', async () => {
    zustand.beantworteFrage.mockRejectedValue(new AgentInaktiv('ceo_assistent'));
    const antwort = await frage({ frage: 'offene_rechnungen_anzahl', schluessel: 's-3' });
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location')).toBe(`${SEITE}?fehler=agent_aus`);
  });

  it('fremder Ursprung: 403, und es entsteht keine Aufgabe', async () => {
    const antwort = await frage(
      { frage: 'offene_rechnungen_anzahl', schluessel: 's-4' }, 'https://fremd.example');
    expect(antwort.status).toBe(403);
    expect(zustand.beantworteFrage).not.toHaveBeenCalled();
  });
});
