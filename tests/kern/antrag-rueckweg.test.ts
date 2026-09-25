/**
 * `POST /api/mein/antraege` — jede Abweisung führt auf die Maske zurück, nie
 * auf JSON und nie auf eine 500 (V-187, EMP-10, D-599).
 *
 * **Der Befund.** Das Formular bot den Schichttausch an und schickte weder
 * Schicht noch Partner; der Auslöser `antrag_pflichtfelder` warf
 * `check_violation` (23514), und weil ein PostgresError keinen `status` trägt,
 * warf die Route ihn weiter. Dasselbe beim Urlaubsantrag ohne Zeitraum. Jede
 * andere Abweisung kam als JSON — auf einem Formular ohne JavaScript ebenfalls
 * eine weisse Seite.
 *
 * Geprüft wird die ECHTE Route; ersetzt sind Sitzung, Datenbank und der
 * Dienst (dessen Prüfungen `tests/isolation/antrag-tausch.test.ts` an echten
 * Zeilen hält).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  AntragAbgewiesen, type AntragAbweisung,
} from '../../src/server/services/abwesenheit/antrag.js';
import {
  ANTRAG_FORM_TEXTE, ANTRAG_GRUENDE, MELDUNG_FORM_TEXTE, MELDUNG_GRUENDE,
} from '../../src/lib/i18n/mein-formulare.js';
import { PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';
import { datenbankGrund } from '../../src/app/api/mein/formular.js';
import {
  artEinreichbar, TAUSCHPARTNER_NICHT_FESTGELEGT, TAUSCHPARTNER_QUELLE,
} from '../../src/server/services/mitarbeiter/tausch.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  reiche: vi.fn(),
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
vi.mock('@/server/services/zeit/einwand', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  mandantDerAnstellung: () => Promise.resolve('00000000-0000-4000-8000-0000000000aa'),
}));
vi.mock('@/server/services/abwesenheit/antrag', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  reicheAntragEin: zustand.reiche,
}));

const { POST } = await import('../../src/app/api/mein/antraege/route.js');

const HIER = 'http://localhost:3001';
const MASKE = '/portal/mein/antraege/neu';
const ANSTELLUNG = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const ART = '6c1e5b0d-0a41-4c55-9d1c-1c2f3b4a5d6f';
const SCHICHT = '7d2f6c1e-0a41-4c55-9d1c-1c2f3b4a5d70';

function anfrage(felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL('/api/mein/antraege', HIER),
    { method: 'POST', body: daten, headers: kopf });
}

/** Wohin die Antwort führt — als Pfad und Abfrage. */
function ziel(antwort: Response): URL {
  return new URL(antwort.headers.get('location') ?? '');
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: '00000000-0000-4000-8000-000000000004',
    ansicht: 'mandant', aal: 'aal1', portal: 'mitarbeiter',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.reiche.mockReset();
  zustand.reiche.mockResolvedValue({ id: 'neu' });
});

describe('POST /api/mein/antraege — der Rückweg auf die Maske', () => {
  it('Erfolg: 303 auf die Liste der Anträge, mit den Feldern beim Dienst', async () => {
    const antwort = await POST(anfrage({
      anstellung: ANSTELLUNG, antragsart: ART, von: '2029-07-06', bis: '2029-07-17',
      einsatz: SCHICHT, nachricht: 'Sommer', zurueck: '/portal/mein/antraege',
    }));
    expect(antwort.status).toBe(303);
    expect(ziel(antwort).pathname).toBe('/portal/mein/antraege');
    expect(zustand.reiche).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      anstellungId: ANSTELLUNG, antragsartId: ART, vonDatum: '2029-07-06',
      bisDatum: '2029-07-17', einsatzId: SCHICHT, tauschPartnerAnstellungId: null,
    }));
  });

  it('ohne Beschäftigung, ohne Art, mit unlesbarem Datum: die Maske, nicht JSON', async () => {
    for (const [felder, grund] of [
      [{ antragsart: ART }, 'keine_anstellung'],
      [{ anstellung: ANSTELLUNG }, 'keine_antragsart'],
      [{ anstellung: ANSTELLUNG, antragsart: ART, von: '06.07.2029' }, 'kein_datum'],
    ] as const) {
      const antwort = await POST(anfrage(felder));
      expect(antwort.status).toBe(303);
      expect(ziel(antwort).pathname).toBe(MASKE);
      expect(ziel(antwort).searchParams.get('fehler')).toBe(grund);
    }
    expect(zustand.reiche).not.toHaveBeenCalled();
  });

  it('die Abweisung des Dienstes kommt als Grund zurück — mit den gewählten Werten, ohne die Nachricht', async () => {
    zustand.reiche.mockRejectedValue(new AntragAbgewiesen('schicht_nicht_waehlbar'));
    const antwort = await POST(anfrage({
      anstellung: ANSTELLUNG, antragsart: ART, einsatz: SCHICHT,
      nachricht: 'Mein Kind ist krank',
    }));
    expect(antwort.status).toBe(303);
    const z = ziel(antwort);
    expect(z.pathname).toBe(MASKE);
    expect(z.searchParams.get('fehler')).toBe('schicht_nicht_waehlbar');
    expect(z.searchParams.get('anstellung')).toBe(ANSTELLUNG);
    expect(z.searchParams.get('antragsart')).toBe(ART);
    expect(z.searchParams.get('einsatz')).toBe(SCHICHT);
    // Freitext reist nicht in der Adresse (Datenschutz) — nur der Hinweis darauf.
    expect(z.toString()).not.toContain('Kind');
    expect(z.searchParams.get('nachricht_neu')).toBe('ja');
  });

  it('VORHER eine 500: der check_violation des Auslösers wird zum Grund', async () => {
    zustand.reiche.mockRejectedValue(Object.assign(
      new Error('Diese Antragsart verlangt einen Tauschpartner'),
      { name: 'PostgresError', code: '23514' }));
    const antwort = await POST(anfrage({ anstellung: ANSTELLUNG, antragsart: ART }));
    expect(antwort.status).toBe(303);
    expect(ziel(antwort).searchParams.get('fehler')).toBe('ungueltige_eingabe');
  });

  it('ein Datum, das es nicht gibt (31.02.), wird „kein_datum" — nicht 500', async () => {
    zustand.reiche.mockRejectedValue(Object.assign(new Error('date/time field value out of range'),
      { name: 'PostgresError', code: '22008' }));
    const antwort = await POST(anfrage({
      anstellung: ANSTELLUNG, antragsart: ART, von: '2029-02-31', bis: '2029-03-02',
    }));
    expect(ziel(antwort).searchParams.get('fehler')).toBe('kein_datum');
  });

  it('ein echter Serverfehler bleibt einer — er wird nicht als Eingabefehler verkleidet', async () => {
    zustand.reiche.mockRejectedValue(Object.assign(new Error('connection reset'),
      { code: 'ECONNRESET' }));
    await expect(POST(anfrage({ anstellung: ANSTELLUNG, antragsart: ART })))
      .rejects.toThrow('connection reset');
  });
});

describe('die Sätze der Maske — vier Sprachen, jeder Grund, keine Kennung', () => {
  it('jeder Grund, den Dienst oder Route setzen, hat in jeder Sprache einen Satz', () => {
    const vomDienst: Record<AntragAbweisung, true> = {
      art_nicht_waehlbar: true, zeitraum_fehlt: true, zeitraum_verkehrt: true,
      abwesenheitsart_fehlt: true, schicht_fehlt: true, schicht_nicht_waehlbar: true,
      tauschpartner_fehlt: true, tauschpartner_nicht_waehlbar: true,
    };
    const vonDerRoute = ['keine_anstellung', 'keine_antragsart', 'kein_datum', 'ungueltige_eingabe'];
    for (const g of [...Object.keys(vomDienst), ...vonDerRoute]) {
      expect(ANTRAG_GRUENDE as readonly string[]).toContain(g);
    }
    for (const sprache of PORTAL_SPRACHEN) {
      const t = ANTRAG_FORM_TEXTE[sprache];
      for (const g of ANTRAG_GRUENDE) expect(t.gruende[g].trim(), `${sprache}/${g}`).not.toBe('');
      const m = MELDUNG_FORM_TEXTE[sprache];
      for (const g of MELDUNG_GRUENDE) expect(m.gruende[g].trim(), `${sprache}/${g}`).not.toBe('');
      const alles = JSON.stringify(t) + JSON.stringify(m) + t.nichtMoeglich('X') + t.pflichtBei('Y');
      // Keine Entwurfskennung auf dem Telefon der Kraft (D-663).
      expect(alles).not.toMatch(/\b[ODVK]-\d/u);
    }
  });

  it('die Seite schlägt den Grund als eigenen Eintrag nach, nie roh', () => {
    const seite = readFileSync(resolve(import.meta.dirname,
      '../../src/app/portal/mein/antraege/neu/page.tsx'), 'utf8');
    expect(seite).toContain('eigenerEintrag(ft.gruende, fehler) ?? ft.unbekannt');
    // Jedes Feld, das eine Art verlangen kann, steht im Formular.
    for (const name of ['anstellung', 'antragsart', 'abwesenheitsart', 'von', 'bis',
      'einsatz', 'tauschpartner', 'nachricht']) {
      expect(seite).toContain(`name="${name}"`);
    }
  });
});

describe('die Quelle der Tauschpartner ist offen (O-925)', () => {
  it('ausgeliefert ist der Platzhalter — eine Art mit Partner ist nicht einreichbar', () => {
    expect(TAUSCHPARTNER_QUELLE).toBe(TAUSCHPARTNER_NICHT_FESTGELEGT);
    expect(TAUSCHPARTNER_NICHT_FESTGELEGT).toEqual({ festgelegt: false, offeneFrage: 'O-925' });
    expect(artEinreichbar({ erfordertTauschpartner: true })).toBe(false);
    expect(artEinreichbar({ erfordertTauschpartner: false })).toBe(true);
    expect(artEinreichbar({ erfordertTauschpartner: true },
      { festgelegt: true, lese: () => Promise.resolve([]) })).toBe(true);
  });

  it('datenbankGrund kennt nur Eingabefehler', () => {
    expect(datenbankGrund({ code: '23P01' })).toBe('ueberlappt');
    expect(datenbankGrund({ code: '23514' })).toBe('ungueltige_eingabe');
    expect(datenbankGrund({ code: '23503' })).toBe('ungueltige_eingabe');
    expect(datenbankGrund({ code: '22008' })).toBe('kein_datum');
    expect(datenbankGrund({ code: '22007' })).toBe('kein_datum');
    expect(datenbankGrund({ code: '40001' })).toBeNull();
    expect(datenbankGrund({ code: 'ungueltige_eingabe' })).toBeNull();
    expect(datenbankGrund(null)).toBeNull();
  });
});
