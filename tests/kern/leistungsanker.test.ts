/**
 * Die Leistungszeile lässt sich an Einzelschicht, Turnus und Posten setzen
 * (V-191, TIM-12, FIN-07) — die Wege, die Masken und die Sätze.
 *
 * Was die Datenbank daraus macht (Erbe, Ableitung, Generator), prüft
 * `tests/isolation/leistungsanker.test.ts` an echten Zeilen. Hier: die Route
 * der Einzelschicht mit ersetztem Dienst, die Quelltexte der fünf Masken und
 * die Texttabellen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  LEISTUNGSANKER_GRUENDE, LEISTUNGSANKER_TEXTE,
} from '../../src/lib/i18n/verwaltung/leistungsanker.js';
import { SCHICHT_TEXTE } from '../../src/lib/i18n/verwaltung/dienstplan-schicht.js';
import { INTERN_SPRACHEN } from '../../src/lib/i18n/intern.js';

const zustand = vi.hoisted(() => ({
  setze: vi.fn(),
  lege: vi.fn(),
  authorize: vi.fn(),
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
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/dienstplan/einzelschicht', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeLeistungsanker: zustand.setze,
  legeEinzelschichtAn: zustand.lege,
}));

const { SchichtFehler } = await import('../../src/server/services/dienstplan/einzelschicht.js');
const { POST } = await import('../../src/app/api/dienstplan/einsatz/route.js');

const HIER = 'http://localhost:3001';
const EINSATZ = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const ZEILE = '6c1e5b0d-0a41-4c55-9d1c-1c2f3b4a5d6f';
const BLATT = `/portal/reinigung/dienstplan/einsatz/${EINSATZ}`;
const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

function anfrage(felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL('/api/dienstplan/einsatz', HIER),
    { method: 'POST', body: daten, headers: kopf });
}

beforeEach(() => {
  zustand.setze.mockReset();
  zustand.lege.mockReset();
  zustand.authorize.mockReset();
  zustand.setze.mockResolvedValue(undefined);
  zustand.lege.mockResolvedValue({ einsatzId: EINSATZ, zeitanomalie: 'keine' });
  zustand.authorize.mockResolvedValue(undefined);
});

describe('POST /api/dienstplan/einsatz — die Leistungszeile', () => {
  it('beim Anlegen reist sie mit', async () => {
    await POST(anfrage({
      aktion: 'anlegen', mandant: 'reinigung', objekt: EINSATZ, datum: '2026-10-12',
      beginn: '06:00', ende: '10:00', auftrag_leistung: ZEILE, zurueck: '/portal/reinigung',
    }));
    expect(zustand.lege).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      auftragLeistungId: ZEILE, auftragId: null,
    }));
  });

  it('nachtragen: `aktion=leistung` setzt sie, ein leeres Feld löst sie', async () => {
    const gesetzt = await POST(anfrage({
      aktion: 'leistung', einsatz: EINSATZ, mandant: 'reinigung', auftrag_leistung: ZEILE,
      zurueck: `${BLATT}?leistung=gesetzt`, fehlerweg: BLATT,
    }));
    expect(zustand.setze).toHaveBeenCalledWith(expect.anything(), EINSATZ, ZEILE);
    expect(gesetzt.status).toBe(303);
    expect(gesetzt.headers.get('location')).toBe(`${HIER}${BLATT}?leistung=gesetzt`);
    expect(zustand.authorize).toHaveBeenCalledWith(
      expect.anything(), { recht: 'dienstplan.schreiben', schreibend: true }, expect.anything());

    await POST(anfrage({
      aktion: 'leistung', einsatz: EINSATZ, mandant: 'reinigung', auftrag_leistung: '',
      zurueck: BLATT, fehlerweg: BLATT,
    }));
    expect(zustand.setze).toHaveBeenLastCalledWith(expect.anything(), EINSATZ, null);
  });

  it('eine Abweisung kommt als Grund auf das Schichtblatt — nie als JSON', async () => {
    zustand.setze.mockRejectedValueOnce(
      new SchichtFehler('Zeit schon erfasst', 'leistung_hat_zeiten', 409));
    const antwort = await POST(anfrage({
      aktion: 'leistung', einsatz: EINSATZ, mandant: 'reinigung', auftrag_leistung: ZEILE,
      zurueck: `${BLATT}?leistung=gesetzt`, fehlerweg: BLATT,
    }));
    expect(antwort.status).toBe(303);
    const ziel = new URL(antwort.headers.get('location') ?? '');
    expect(ziel.pathname).toBe(BLATT);
    expect(ziel.searchParams.get('fehler')).toBe('leistung_hat_zeiten');
  });
});

describe('die fünf Masken setzen den Anker über EIN Feld', () => {
  const MASKEN = [
    'src/app/portal/[mandant]/dienstplan/einsatz/neu/page.tsx',
    'src/app/portal/[mandant]/dienstplan/einsatz/[id]/page.tsx',
    'src/app/portal/[mandant]/reinigung/turnus/neu/page.tsx',
    'src/app/portal/[mandant]/dienstplan/serien/neu/page.tsx',
    'src/app/portal/[mandant]/dienstplan/serien/[id]/page.tsx',
    'src/app/portal/[mandant]/security/posten/neu/page.tsx',
    'src/app/portal/[mandant]/security/posten/[id]/page.tsx',
  ];

  it('jede Maske benutzt den Baustein `LeistungsankerFeld`', () => {
    for (const m of MASKEN) expect(lies(m), m).toContain('<LeistungsankerFeld');
  });

  it('der Baustein zeigt ohne `auftrag.lesen` KEIN Feld — sonst löschte eine Pflegemaske den Anker', () => {
    const baustein = lies('src/components/portal/LeistungsankerFeld.tsx');
    expect(baustein).toMatch(/if \(leistungen === null\) \{\s*return \(\s*<p/u);
    expect(baustein).toContain('<Recht schluessel="auftrag.lesen"');
    expect(baustein).toContain('name={name}');
  });

  it('die Turnuspflege ändert den Anker nur, wenn das Feld geschickt wurde', () => {
    expect(lies('src/app/api/dienstplan/serien/[id]/route.ts'))
      .toContain("daten.has('auftrag_leistung')");
  });

  it('die Anlage-Routen reichen das Feld an den Dienst', () => {
    for (const r of ['src/app/api/reinigung/turnus/route.ts', 'src/app/api/dienstplan/serien/route.ts',
      'src/app/api/sicherheit/posten/route.ts']) {
      expect(lies(r), r).toContain("auftragLeistungId: text(daten, 'auftrag_leistung')");
    }
  });

  it('der Generator trägt den Anker auf künftige Schichten ohne erfasste Zeit', () => {
    const generator = lies('src/server/services/dienstplan/generator.ts');
    const zweig = generator.slice(generator.indexOf('do update set'));
    expect(zweig).toContain('auftrag_leistung_id = excluded.auftrag_leistung_id');
    expect(zweig).toContain('not app.einsatz_hat_zeiterfassung(einsatz.id)');
  });
});

describe('die Sätze', () => {
  it('jeder Grund hat in beiden Sprachen einen Satz', () => {
    for (const sprache of INTERN_SPRACHEN) {
      for (const g of LEISTUNGSANKER_GRUENDE) {
        expect(LEISTUNGSANKER_TEXTE[sprache].fehler[g].trim(), `${sprache}/${g}`).not.toBe('');
      }
    }
  });

  it('die Einzelschicht verspricht nicht mehr, dass der Auftrag allein abgerechnet wird', () => {
    for (const sprache of INTERN_SPRACHEN) {
      expect(SCHICHT_TEXTE[sprache].auftragErklaerung).not.toMatch(/hängt sie an dessen Abrechnung|hangs off that/u);
      expect(SCHICHT_TEXTE[sprache].auftragErklaerung).toContain('Leistungszeile');
    }
  });
});
