/**
 * Der Erfolg eines Zahlungsausgangs reist als `?erfolg=<schluessel>` — nicht
 * mehr unter dem Namen `meldung` (D-769, D-774).
 *
 * **Der Befund.** `POST /api/finanzen/zahlungen` (aktion `ausgang`) schickte
 * seinen Erfolg schon als Schlüssel (`ausgang_erfasst`, `ausgang_guthaben`),
 * aber als `?meldung=`, und das Blatt der Eingangsrechnung las den
 * Suchparameter `meldung`. Nach D-769 trägt keine Adresse mehr `meldung=`,
 * und keine Seite liest ihn — auch nicht als Schlüssel, damit die Wache über
 * den Baum keine Ausnahme braucht.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * der Zahlungsdienst), die Tabelle in beiden Sprachen und am Quelltext das
 * Blatt.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { EINGANGSRECHNUNGEN_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/eingangsrechnungen.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  ausgang: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
/* Der Slug der Umleitung kommt aus der Sitzung, nicht aus `?mandant=` (V-278). */
vi.mock('@/server/auth/aktiver-slug', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  slugDesAktivenMandanten: () => Promise.resolve('reinigung'),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]), schreibe: () => Promise.resolve([]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/finanz/zahlung/index', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  verbucheZahlungsausgang: zustand.ausgang,
}));

const { ZahlungFehler } = await import('../../src/server/services/finanz/zahlung/index.js');
const route = await import('../../src/app/api/finanzen/zahlungen/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const BLATT = `/portal/reinigung/finanzen/eingangsrechnungen/${ID}`;

function ausgang(felder: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries({
    aktion: 'ausgang', eingangsrechnungId: ID, betrag: '119,00', zahlungsdatum: '2026-09-01',
    zahlungsmittel: 'ueberweisung', ...felder,
  })) daten.append(k, v);
  return new NextRequest(new URL('/api/finanzen/zahlungen?mandant=reinigung', HIER), {
    method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER }),
  });
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.ausgang.mockReset();
});

describe('POST /api/finanzen/zahlungen (ausgang) — der Erfolg als `?erfolg=`', () => {
  it.each([
    [0n, 'ausgang_erfasst'],
    [500n, 'ausgang_guthaben'],
  ] as const)('Überzahlung %s Cent → `?erfolg=%s`', async (ueberzahlungCent, schluessel) => {
    zustand.ausgang.mockResolvedValue({ ueberzahlungCent });
    const r = await route.POST(ausgang());
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${BLATT}?erfolg=${schluessel}`);
    expect(ort).not.toContain('meldung=');
  });

  it('eine Abweisung bleibt `?fehler=<grund>` mit den Eingaben — ohne Satz', async () => {
    zustand.ausgang.mockRejectedValue(new ZahlungFehler('Diese Eingangsrechnung ist bereits bezahlt.', 'schon_ausgeglichen'));
    const r = await route.POST(ausgang());
    const ort = new URL(r.headers.get('location') ?? '');
    expect(ort.pathname).toBe(BLATT);
    expect(ort.searchParams.get('fehler')).toBe('schon_ausgeglichen');
    expect(ort.searchParams.has('meldung')).toBe(false);
  });
});

describe('das Blatt der Eingangsrechnung liest den Erfolg als `erfolg`', () => {
  it('jeder Erfolgsschlüssel hat in beiden Sprachen einen Satz — ein fremder keinen', () => {
    for (const sprache of ['de', 'en'] as const) {
      const t = EINGANGSRECHNUNGEN_TEXTE[sprache].ausgangMeldungen;
      for (const k of ['ausgang_erfasst', 'ausgang_guthaben']) expect(eigenerEintrag(t, k), k).toBeTruthy();
      for (const k of ['__proto__', 'constructor', 'erfasst', 'Hallo Welt']) {
        expect(eigenerEintrag(t, k), k).toBeUndefined();
      }
    }
  });

  it('der Quelltext liest `erfolg`, nicht `meldung`', () => {
    const seite = readFileSync(
      join(WURZEL, 'src/app/portal/[mandant]/finanzen/eingangsrechnungen/[id]/page.tsx'), 'utf8');
    expect(seite).not.toMatch(/'meldung'/u);
    expect(seite).toContain("eigenerEintrag(t.ausgangMeldungen, suche['erfolg'])");
    expect(seite).toMatch(/<Hinweis art="erfolg" rolle="status" cse="ausgang-meldung"/u);
  });
});
