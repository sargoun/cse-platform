/**
 * `POST /api/mein/abwesenheit` und `POST /api/personal/abwesenheit` — eine
 * doppelte Meldung, ein verkehrter Zeitraum oder eine Bescheinigung vor dem
 * ersten Tag enden auf der Maske, nicht als 500 und nicht als JSON (V-188).
 *
 * **Der Befund.** Die Route der Arbeiterin übersetzte nur Fehler mit
 * numerischem `status`. Die Ausschlussbedingung `ab_keine_dublette` (23P01)
 * und die Prüfbedingung `ab_au_bis` (23514) tragen keinen — beide endeten als
 * rohe 500. Die Büroroute kannte 23P01, nicht aber 23514. Jede andere
 * Abweisung kam als JSON.
 *
 * Geprüft werden die ECHTEN Routen; ersetzt sind Sitzung, Datenbank, die
 * Rechteprüfung und der Dienst (dessen Prüfungen
 * `tests/isolation/meldung-rueckweg.test.ts` an echten Zeilen hält).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  AbwesenheitNichtGefunden, ArtUngeklaertFehler, AuBisVorBeginn,
} from '../../src/server/services/abwesenheit/index.js';
import { rechneTage, ZeitraumFehler } from '../../src/server/services/abwesenheit/tage.js';
import { NichtGefundenFehler } from '../../src/server/auth/fehler.js';
import { MELDUNG_GRUENDE } from '../../src/lib/i18n/mein-formulare.js';
import { ABWESENHEIT_AUFNAHME_TEXTE } from '../../src/lib/i18n/verwaltung/personal.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  melde: vi.fn(),
  authorize: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withPersonScope: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) => fn({}),
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/zeit/einwand', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  mandantDerAnstellung: () => Promise.resolve('00000000-0000-4000-8000-0000000000aa'),
}));
vi.mock('@/server/services/abwesenheit/index', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  meldeAbwesenheit: zustand.melde,
}));

const { POST: meldung } = await import('../../src/app/api/mein/abwesenheit/route.js');
const { POST: buero } = await import('../../src/app/api/personal/abwesenheit/route.js');

const HIER = 'http://localhost:3001';
const MASKE = '/portal/mein/abwesenheit/neu';
const ANSTELLUNG = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const ART = '6c1e5b0d-0a41-4c55-9d1c-1c2f3b4a5d6f';
const AUFNAHME = '/portal/reinigung/personal/abwesenheiten/erfassen';

function anfrage(pfad: string, felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

const GUELTIG = {
  anstellung: ANSTELLUNG, abwesenheitsart: ART, von: '2029-03-02', bis: '2029-03-04',
  au_vorliegt: 'ja', au_bis: '2029-03-06', von_halbtags: 'ja',
  bemerkung: 'Grippe, Fieber', zurueck: '/portal/mein/antraege',
};

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
  zustand.melde.mockReset();
  zustand.melde.mockResolvedValue({ id: 'neu' });
  zustand.authorize.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
});

describe('POST /api/mein/abwesenheit — die Maske statt der 500', () => {
  it('Erfolg: 303 auf die Anträge', async () => {
    const antwort = await meldung(anfrage('/api/mein/abwesenheit', GUELTIG));
    expect(antwort.status).toBe(303);
    expect(ziel(antwort).pathname).toBe('/portal/mein/antraege');
  });

  it('VORHER 500: die doppelte Meldung (23P01) wird „ueberlappt" — mit Eingaben, ohne Bemerkung', async () => {
    zustand.melde.mockRejectedValue(Object.assign(
      new Error('conflicting key value violates exclusion constraint "ab_keine_dublette"'),
      { name: 'PostgresError', code: '23P01' }));
    const antwort = await meldung(anfrage('/api/mein/abwesenheit', GUELTIG));
    expect(antwort.status).toBe(303);
    const z = ziel(antwort);
    expect(z.pathname).toBe(MASKE);
    expect(z.searchParams.get('fehler')).toBe('ueberlappt');
    expect(z.searchParams.get('anstellung')).toBe(ANSTELLUNG);
    expect(z.searchParams.get('abwesenheitsart')).toBe(ART);
    expect(z.searchParams.get('von')).toBe('2029-03-02');
    expect(z.searchParams.get('au_bis')).toBe('2029-03-06');
    expect(z.searchParams.get('von_halbtags')).toBe('ja');
    expect(z.searchParams.get('bis_halbtags')).toBeNull();
    // Art. 9 DSGVO: die Bemerkung reist nie in der Adresse.
    expect(z.toString()).not.toContain('Grippe');
    expect(z.searchParams.get('bemerkung_neu')).toBe('ja');
  });

  it('VORHER 500: ein 23514 der Datenbank wird „ungueltige_eingabe"', async () => {
    zustand.melde.mockRejectedValue(Object.assign(new Error('ab_au_bis'),
      { name: 'PostgresError', code: '23514' }));
    const z = ziel(await meldung(anfrage('/api/mein/abwesenheit', GUELTIG)));
    expect(z.searchParams.get('fehler')).toBe('ungueltige_eingabe');
  });

  it('die Abweisungen des Dienstes behalten ihren Grund', async () => {
    const faelle: readonly [Error, string][] = [
      [new AuBisVorBeginn(), 'au_bis_vor_von'],
      [new ZeitraumFehler('x', 'zeitraum_verkehrt'), 'zeitraum_verkehrt'],
      [new ZeitraumFehler('x', 'zeitraum_zu_lang'), 'zeitraum_zu_lang'],
      [new ArtUngeklaertFehler('Krankheit'), 'art_ungeklaert'],
      [new AbwesenheitNichtGefunden(ART), 'art_nicht_waehlbar'],
    ];
    for (const [fehler, grund] of faelle) {
      zustand.melde.mockRejectedValueOnce(fehler);
      const antwort = await meldung(anfrage('/api/mein/abwesenheit', GUELTIG));
      expect(antwort.status).toBe(303);
      expect(ziel(antwort).pathname).toBe(MASKE);
      expect(ziel(antwort).searchParams.get('fehler')).toBe(grund);
      expect(MELDUNG_GRUENDE as readonly string[]).toContain(grund);
    }
  });

  it('der echte Dienst: „Bis" vor „Von" wirft den Grund, den die Route braucht', () => {
    let gefangen: unknown = null;
    try {
      rechneTage({ von: '2029-03-04', bis: '2029-03-02' });
    } catch (fehler) {
      gefangen = fehler;
    }
    expect(gefangen).toBeInstanceOf(ZeitraumFehler);
    expect((gefangen as ZeitraumFehler).grund).toBe('zeitraum_verkehrt');
  });

  it('fehlende Auswahl oder unlesbares Datum — auch „Bescheinigung gültig bis" — gehen nie zum Dienst', async () => {
    for (const [felder, grund] of [
      [{ ...GUELTIG, anstellung: '' }, 'keine_anstellung'],
      [{ ...GUELTIG, abwesenheitsart: 'krank' }, 'keine_art'],
      [{ ...GUELTIG, bis: '' }, 'kein_datum'],
      [{ ...GUELTIG, au_bis: '06.03.2029' }, 'kein_datum'],
    ] as const) {
      const z = ziel(await meldung(anfrage('/api/mein/abwesenheit', felder)));
      expect(z.pathname).toBe(MASKE);
      expect(z.searchParams.get('fehler')).toBe(grund);
    }
    expect(zustand.melde).not.toHaveBeenCalled();
  });

  it('ein fehlendes Recht bleibt 404 (D-656), ein Serverfehler bleibt einer', async () => {
    zustand.authorize.mockRejectedValueOnce(new NichtGefundenFehler());
    expect((await meldung(anfrage('/api/mein/abwesenheit', GUELTIG))).status).toBe(404);
    zustand.melde.mockRejectedValueOnce(Object.assign(new Error('connection reset'),
      { code: 'ECONNRESET' }));
    await expect(meldung(anfrage('/api/mein/abwesenheit', GUELTIG)))
      .rejects.toThrow('connection reset');
  });
});

describe('POST /api/personal/abwesenheit — auch das Büro kommt zurück', () => {
  beforeEach(() => {
    zustand.sitzung = { ...zustand.sitzung, portal: 'intern', aal: 'aal2', personId: null };
  });

  it('VORHER 500: ein 23514 und die Bescheinigung vor Beginn führen auf die Aufnahmeseite', async () => {
    for (const [fehler, grund] of [
      [Object.assign(new Error('ab_au_bis'), { name: 'PostgresError', code: '23514' }),
        'ungueltige_eingabe'],
      [new AuBisVorBeginn(), 'au_bis_vor_von'],
      [new ZeitraumFehler('x', 'zeitraum_verkehrt'), 'zeitraum_verkehrt'],
    ] as const) {
      zustand.melde.mockRejectedValueOnce(fehler);
      const antwort = await buero(anfrage('/api/personal/abwesenheit',
        { ...GUELTIG, zurueck: AUFNAHME, fehlerweg: AUFNAHME }));
      expect(antwort.status).toBe(303);
      expect(ziel(antwort).pathname).toBe(AUFNAHME);
      expect(ziel(antwort).searchParams.get('fehler')).toBe(grund);
      // Die Aufnahmeseite hat für jeden dieser Gründe einen Satz, in beiden Sprachen.
      for (const t of Object.values(ABWESENHEIT_AUFNAHME_TEXTE)) {
        expect(Object.hasOwn(t.abgewiesen, grund)).toBe(true);
      }
    }
  });

  it('die doppelte Meldung bleibt, wie sie war', async () => {
    zustand.melde.mockRejectedValueOnce(Object.assign(new Error('x'),
      { name: 'PostgresError', code: '23P01' }));
    const antwort = await buero(anfrage('/api/personal/abwesenheit',
      { ...GUELTIG, zurueck: AUFNAHME, fehlerweg: AUFNAHME }));
    expect(ziel(antwort).searchParams.get('fehler')).toBe('ueberlappt');
  });
});
