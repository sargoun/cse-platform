/**
 * Ein Tag, den es nicht gibt, ist ein Grund und keine 500 — auf den beiden
 * Personalwegen, die ihn bis an ein `::date` durchreichten (V-273, D-771
 * Nachtrag).
 *
 * **Der Befund.** `POST /api/personal/urlaubsanspruch` prüfte „Verfällt am"
 * nur gegen das Muster `JJJJ-MM-TT`; `2026-02-30` ging an `setzeAnspruch`
 * und dort an `$4::date`, die Datenbank antwortete mit 22008, und die Route
 * kannte den Fehler nicht. `POST /api/personal/nachweise` prüfte Beginn, Ende
 * und Ausstellungstag GAR nicht — `nimmNachweisAuf` reichte sie an drei
 * `::date`. Beides endete als 500.
 *
 * Geprüft werden die ECHTEN Routen; ersetzt sind Sitzung, Datenbank, Recht
 * und — beim Urlaubsanspruch — der Dienst. Der Nachweisdienst läuft echt,
 * gegen eine Datenbank, die jede Abfrage verweigert: kommt der Grund, fiel
 * der Tag vor der ersten Abfrage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  NachweisFehler, nimmNachweisAuf,
} from '../../src/server/services/nachweis/aufnahme.js';
import { NACHWEIS_ERFASSEN_TEXTE } from '../../src/lib/i18n/verwaltung/personal-nachweis.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  abfrage: vi.fn(),
  eroeffne: vi.fn(),
  setze: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: zustand.abfrage, schreibe: zustand.abfrage }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/zeit/urlaubskonto', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  eroeffneUrlaubskonto: zustand.eroeffne,
  setzeAnspruch: zustand.setze,
}));

const { POST: anspruch } = await import('../../src/app/api/personal/urlaubsanspruch/route.js');
const { POST: nachweis } = await import('../../src/app/api/personal/nachweise/route.js');

const HIER = 'http://localhost:3001';
const ANSTELLUNG = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const PERSON = '6c1e5b0d-0a41-4c55-9d1c-1c2f3b4a5d6f';
const QUALI = '7d2f6c1e-0a41-4c55-9d1c-1c2f3b4a5d70';
const VERBOTEN = 'Abfrage verboten — der Tag hätte vorher fallen müssen.';

function anfrage(pfad: string, felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

function ziel(antwort: Response): URL {
  return new URL(antwort.headers.get('location') ?? '');
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.abfrage.mockReset();
  zustand.abfrage.mockRejectedValue(new Error(VERBOTEN));
  zustand.eroeffne.mockReset();
  zustand.eroeffne.mockResolvedValue(undefined);
  zustand.setze.mockReset();
  zustand.setze.mockResolvedValue(undefined);
});

describe('POST /api/personal/urlaubsanspruch — „Verfällt am" ist ein Tag, den es gibt', () => {
  const SEITE = '/portal/reinigung/personal/urlaubskonten';
  const FORMULAR = {
    anstellung: ANSTELLUNG, jahr: '2026', anspruch: '28', uebertrag: '2',
    zurueck: `${SEITE}?jahr=2026&gespeichert=1`, fehlerweg: `${SEITE}?jahr=2026`,
  };

  it.each(['2026-02-30', '2026-04-31', '2026-13-01', '31.03.2026'])(
    '%s → 400 „kein_datum" — der Grund, den die Route für ein unlesbares Datum schon hat',
    async (tag) => {
      const antwort = await anspruch(anfrage('/api/personal/urlaubsanspruch',
        { ...FORMULAR, verfaellt_am: tag }));
      expect(antwort.status).toBe(400);
      expect(await antwort.json()).toEqual({ fehler: 'kein_datum' });
      expect(zustand.eroeffne).not.toHaveBeenCalled();
      expect(zustand.setze).not.toHaveBeenCalled();
    });

  it('ein Tag, den es gibt — auch der 29. Februar eines Schaltjahrs —, geht an den Dienst', async () => {
    const antwort = await anspruch(anfrage('/api/personal/urlaubsanspruch',
      { ...FORMULAR, verfaellt_am: '2028-02-29' }));
    expect(antwort.status).toBe(303);
    expect(zustand.setze).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ uebertragVerfaelltAm: '2028-02-29' }));
  });
});

describe('POST /api/personal/nachweise — Beginn, Ende und Ausstellungstag sind Tage, die es gibt', () => {
  const ERFASSEN = '/portal/reinigung/personal/nachweise/erfassen';
  const FORMULAR = {
    aktion: 'aufnehmen', person: PERSON, qualifikation: QUALI, gueltig_ab: '2026-03-01',
    zurueck: '/portal/reinigung/personal/nachweise', fehlerweg: ERFASSEN,
  };

  it.each([
    ['gueltig_ab', '2026-02-30'], ['gueltig_bis', '2026-04-31'],
    ['ausgestellt_am', '2026-13-01'], ['gueltig_ab', '01.03.2026'],
  ])('%s = %s → zurück aufs Formular mit „kein_datum", ohne eine einzige Abfrage', async (feld, tag) => {
    const antwort = await nachweis(anfrage('/api/personal/nachweise', { ...FORMULAR, [feld]: tag }));
    expect(antwort.status).toBe(303);
    expect(ziel(antwort).pathname).toBe(ERFASSEN);
    expect(ziel(antwort).searchParams.get('fehler')).toBe('kein_datum');
    expect(zustand.abfrage).not.toHaveBeenCalled();
  });

  it('ein neuer Grund, also ein Satz auf der Seite — in beiden Sprachen', () => {
    for (const sprache of ['de', 'en'] as const) {
      expect(eigenerEintrag(NACHWEIS_ERFASSEN_TEXTE[sprache].fehler, 'kein_datum'), sprache)
        .toBeTruthy();
    }
  });

  it('der Dienst selbst: jeder der drei Tage fällt vor der ersten Abfrage', async () => {
    const stumm = { abfrage: () => Promise.reject(new Error(VERBOTEN)) };
    const grund = { personId: PERSON, qualifikationId: QUALI, gueltigAb: '2026-03-01' };
    for (const anders of [
      { gueltigAb: '2026-02-29' }, { gueltigBis: '2026-06-31' }, { ausgestelltAm: '2025-02-29' },
    ]) {
      const fehler = await nimmNachweisAuf(stumm, { ...grund, ...anders }).catch((e: unknown) => e);
      expect(fehler, JSON.stringify(anders)).toBeInstanceOf(NachweisFehler);
      expect((fehler as NachweisFehler).grund).toBe('kein_datum');
    }
    /* Die Gegenprobe: Tage, die es gibt, und leere Felder gehen bis zur ersten Abfrage. */
    for (const anders of [
      { gueltigAb: '2028-02-29', gueltigBis: '2030-02-28', ausgestelltAm: '2028-02-01' },
      { gueltigBis: null, ausgestelltAm: '' },
    ]) {
      const fehler = await nimmNachweisAuf(stumm, { ...grund, ...anders }).catch((e: unknown) => e);
      expect((fehler as Error).message, JSON.stringify(anders)).toBe(VERBOTEN);
    }
  });
});
