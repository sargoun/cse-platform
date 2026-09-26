/**
 * Ein abgewiesener Anker kommt als Satz auf die Maske — nicht als JSON und
 * nicht als deutscher Satz in der Adresse (V-192, D-686 Nr. 8, D-599).
 *
 * Geprüft werden die ECHTEN Routen der drei Anlagen (Serie, Posten, Turnus
 * der Reinigung) mit ersetztem Dienst, dazu die Quelltexte der Masken und
 * Blätter, die den Grund nachschlagen, und die Sätze. Was der Dienst selbst
 * prüft, prüft `tests/isolation/leistungsanker.test.ts` an echten Zeilen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { LEISTUNGSANKER_TEXTE } from '../../src/lib/i18n/verwaltung/leistungsanker.js';
import { SERIE_PFLEGE_TEXTE } from '../../src/lib/i18n/verwaltung/dienstplan-serie-pflege.js';
import { INTERN_SPRACHEN } from '../../src/lib/i18n/intern.js';

const zustand = vi.hoisted(() => ({
  turnus: vi.fn(),
  posten: vi.fn(),
  serie: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve({
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  }),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve(undefined) }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/auth/kontext-rechte', () => ({
  rechteImKontext: () => Promise.resolve({ 'dienstplan.schreiben': true }),
}));
vi.mock('@/server/services/dienstplan/serie', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legeTurnusSerieAn: zustand.turnus,
  legePlanungsserieAn: zustand.serie,
}));
vi.mock('@/server/services/security/posten', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legePostenAn: zustand.posten,
}));

const { LeistungsankerFehler } = await import('../../src/server/services/dienstplan/leistungsanker.js');
const { SerieEingabeFehlt } = await import('../../src/server/services/dienstplan/serie.js');
const { POST: SERIE } = await import('../../src/app/api/dienstplan/serien/route.js');
const { POST: POSTEN } = await import('../../src/app/api/sicherheit/posten/route.js');
const { POST: TURNUS } = await import('../../src/app/api/reinigung/turnus/route.js');

const HIER = 'http://localhost:3001';
const REVIER = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const LEISTUNG = '6c1e5b0d-0a41-4c55-9d1c-1c2f3b4a5d6f';
const ZEILE = '7d2f6c1e-0a41-4c55-9d1c-1c2f3b4a5d70';
const OBJEKT = '8e3a7d2f-0a41-4c55-9d1c-1c2f3b4a5d71';
const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

function anfrage(pfad: string, felder: readonly (readonly [string, string])[]): NextRequest {
  const daten = new FormData();
  for (const [k, v] of felder) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

function ziel(antwort: Response): URL {
  return new URL(antwort.headers.get('location') ?? '');
}

const TURNUS_FELDER = [
  ['mandant', 'reinigung'], ['art', 'turnus'], ['revier', REVIER], ['leistung', LEISTUNG],
  ['bezeichnung', 'Abendreinigung'], ['wochentag', 'MO'], ['wochentag', 'WE'],
  ['beginn', '18:00'], ['dauer', '120'], ['gueltig_ab', '2026-10-01'],
  ['feiertage', 'unveraendert'], ['auftrag_leistung', ZEILE],
] as const;

beforeEach(() => {
  zustand.turnus.mockReset();
  zustand.posten.mockReset();
  zustand.serie.mockReset();
  zustand.turnus.mockRejectedValue(new LeistungsankerFehler('leistung_beendet'));
  zustand.posten.mockRejectedValue(new LeistungsankerFehler('leistung_beendet'));
});

describe('POST /api/dienstplan/serien — ein Ankerfehler kommt auf die Maske (VORHER JSON-422)', () => {
  it('303 auf /serien/neu, mit Grund und Eingaben', async () => {
    const antwort = await SERIE(anfrage('/api/dienstplan/serien', TURNUS_FELDER));
    expect(antwort.status).toBe(303);
    const z = ziel(antwort);
    expect(z.pathname).toBe('/portal/reinigung/dienstplan/serien/neu');
    expect(z.searchParams.get('fehler')).toBe('leistung_beendet');
    expect(z.searchParams.get('revier')).toBe(REVIER);
    expect(z.searchParams.get('bezeichnung')).toBe('Abendreinigung');
    expect(z.searchParams.get('wochentage')).toBe('MO,WE');
    expect(z.searchParams.get('beginn')).toBe('18:00');
    expect(z.searchParams.get('auftrag_leistung')).toBe(ZEILE);
  });

  it('eine andere Abweisung dieses Wegs bleibt, wie sie war (D-599-Altlast, D-686 Nr. 8)', async () => {
    zustand.turnus.mockRejectedValueOnce(new SerieEingabeFehlt('Mindestens ein Wochentag.'));
    const antwort = await SERIE(anfrage('/api/dienstplan/serien', TURNUS_FELDER));
    expect(antwort.status).toBe(400);
  });
});

describe('POST /api/sicherheit/posten (Anlage) — ein Ankerfehler kommt auf die Maske (VORHER JSON-422)', () => {
  it('303 auf /posten/neu, mit Grund und Eingaben', async () => {
    const antwort = await POSTEN(anfrage('/api/sicherheit/posten', [
      ['mandant', 'security'], ['objekt', OBJEKT], ['bezeichnung', 'Nachtwache Tor'],
      ['min_besetzung', '1'], ['soll_besetzung', '2'], ['rrule', 'FREQ=DAILY'],
      ['dtstart', '2026-10-01T22:00'], ['dauer', '480'], ['gueltig_ab', '2026-10-01'],
      ['auftrag_leistung', ZEILE],
    ]));
    expect(antwort.status).toBe(303);
    const z = ziel(antwort);
    expect(z.pathname).toBe('/portal/security/security/posten/neu');
    expect(z.searchParams.get('fehler')).toBe('leistung_beendet');
    expect(z.searchParams.get('objekt')).toBe(OBJEKT);
    expect(z.searchParams.get('soll_besetzung')).toBe('2');
    expect(z.searchParams.get('dtstart')).toBe('2026-10-01T22:00');
    expect(zustand.serie).not.toHaveBeenCalled();
  });
});

describe('POST /api/reinigung/turnus — der Grund reist als Schlüssel, nicht als Satz (VORHER ?fehler=<Satz>)', () => {
  it('303 zurück in die Vorschau, mit allen Eingaben und dem Schlüssel', async () => {
    const antwort = await TURNUS(anfrage('/api/reinigung/turnus', [
      ...TURNUS_FELDER, ['frequenz', 'woechentlich'], ['interval', '1'],
    ]));
    expect(antwort.status).toBe(303);
    const z = ziel(antwort);
    expect(z.pathname).toBe('/portal/reinigung/reinigung/turnus/neu');
    expect(z.searchParams.get('vorschau')).toBe('1');
    expect(z.searchParams.get('fehler')).toBe('leistung_beendet');
    expect(z.searchParams.getAll('wochentag')).toEqual(['MO', 'WE']);
    expect(z.searchParams.get('revier')).toBe(REVIER);
    expect(z.searchParams.get('auftrag_leistung')).toBe(ZEILE);
    // Kein deutscher Satz in der Adresse.
    expect(decodeURIComponent(z.search)).not.toMatch(/Leistungszeile|Auftrag/u);
  });
});

describe('die Masken und Blätter schlagen den Grund nach — nie der Schlüssel, nie der Satz aus der Adresse', () => {
  it('Serie, Posten und Turnus anlegen: ein bekannter Grund wird ein Satz in der Sprache der Sitzung', () => {
    for (const seite of ['src/app/portal/[mandant]/dienstplan/serien/neu/page.tsx',
      'src/app/portal/[mandant]/security/posten/neu/page.tsx']) {
      const text = lies(seite);
      expect(text, seite).toContain('eigenerEintrag(tL.fehler, fehler) ?? tL.fehlerSonst');
      expect(text, seite).toContain('searchParams');
      expect(text, seite).toContain('<strong>{tL.nichtAngelegt}</strong>');
    }
    expect(lies('src/app/portal/[mandant]/reinigung/turnus/neu/page.tsx'))
      .toContain('eigenerEintrag(tL.fehler, fehlerAusApi)');
  });

  it('das Serienblatt zeigt für einen unbekannten Grund einen Satz, nicht den Schlüssel', () => {
    const text = lies('src/app/portal/[mandant]/dienstplan/serien/[id]/page.tsx');
    expect(text).not.toMatch(/\?\? pflegeFehler\}/u);
    expect(text).toContain('?? tP.fehlerSonst');
    expect(text).toContain('eigenerEintrag(tP.erledigt, gepflegt)');
    for (const sprache of INTERN_SPRACHEN) {
      expect(SERIE_PFLEGE_TEXTE[sprache].fehlerSonst.trim(), sprache).not.toBe('');
    }
  });

  it('das Schichtblatt: der Dauerhinweis ist kein Fehlersatz, „gespeichert" spricht von DIESER Schicht', () => {
    const text = lies('src/app/portal/[mandant]/dienstplan/einsatz/[id]/page.tsx');
    expect(text).toContain('{tL.hatZeiten}');
    expect(text).toContain('{tL.gesetztEinzeln}');
    expect(text).not.toContain('tL.fehler.leistung_hat_zeiten');
    expect(LEISTUNGSANKER_TEXTE.de.hatZeiten).not.toContain('Nichts wurde gespeichert');
    expect(LEISTUNGSANKER_TEXTE.en.hatZeiten).not.toContain('Nothing was saved');
    expect(LEISTUNGSANKER_TEXTE.de.gesetztEinzeln).not.toMatch(/Künftige/u);
    expect(LEISTUNGSANKER_TEXTE.en.gesetztEinzeln).not.toMatch(/Future/u);
  });

  it('das Postenblatt: am archivierten Posten ein Satz statt des Formulars', () => {
    const text = lies('src/app/portal/[mandant]/security/posten/[id]/page.tsx');
    expect(text).toContain('kopf.archiviert ?');
    expect(text).toContain('{tL.postenArchiviert}');
    expect(text).toContain('?? tL.fehlerSonst');
  });

  it('jeder neue Satz steht in beiden Sprachen', () => {
    for (const sprache of INTERN_SPRACHEN) {
      const t = LEISTUNGSANKER_TEXTE[sprache];
      for (const s of [t.nichtWaehlbar, t.gesetztEinzeln, t.hatZeiten, t.postenArchiviert,
        t.nichtAngelegt, t.fehlerSonst, t.fehler.posten_archiviert]) {
        expect(s.trim(), sprache).not.toBe('');
      }
    }
  });
});
