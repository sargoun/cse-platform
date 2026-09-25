/**
 * „Eine Zeit fehlt" — der Einwand OHNE Zeiteintrag ist für Beschäftigte
 * erreichbar (V-189, EMP-07, TIM-11).
 *
 * **Der Befund.** `zeit_einwand.zeiteintrag_id` ist für genau diesen Fall
 * nullbar (0052), und die Planerseite hat den Zweig dafür (V-067). Das einzige
 * Formular der Arbeiterin lag unter `/portal/mein/zeiten/[id]/einwand`,
 * antwortete ohne Eintrag mit 404 und schickte die Kennung des Eintrags immer
 * mit. Und das Absenden endete auf einer weissen Seite mit JSON.
 *
 * Geprüft werden die ECHTE Route (Sitzung, Datenbank und Dienst ersetzt) und
 * die Quelltexte der Seiten; den Dienst an echten Zeilen prüft
 * `tests/isolation/einwand-ohne-eintrag.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { EinwandOhneBezugFehler } from '../../src/server/services/zeit/einwand.js';
import { EINWAND_FORM_TEXTE, EINWAND_GRUENDE } from '../../src/lib/i18n/mein-formulare.js';
import { PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';
import { ROUTEN } from '../../src/server/registry/routen.generiert.js';

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
  reicheEinwandEin: zustand.reiche,
}));

const { POST } = await import('../../src/app/api/zeit/einwand/route.js');

const HIER = 'http://localhost:3001';
const MASKE = '/portal/mein/zeiten/einwand';
const ANSTELLUNG = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

function anfrage(felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL('/api/zeit/einwand', HIER),
    { method: 'POST', body: daten, headers: kopf });
}

const FORMULAR = {
  art: 'eintrag_fehlt', maske: MASKE, zurueck: MASKE, anstellung: ANSTELLUNG,
  datum: '2026-03-28', beginn: '2026-03-28T22:00', ende: '2026-03-29T06:00', pause: '30',
  begruendung: 'Die Marke am Tor ging nicht, ich war da.',
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
  zustand.reiche.mockReset();
  zustand.reiche.mockResolvedValue('00000000-0000-4000-8000-0000000000ee');
});

describe('POST /api/zeit/einwand aus „Eine Zeit fehlt"', () => {
  it('ohne `zeiteintrag` geht die Meldung durch — und die Seite kommt zurück, kein JSON', async () => {
    const antwort = await POST(anfrage(FORMULAR));
    expect(antwort.status).toBe(303);
    expect(ziel(antwort).pathname).toBe(MASKE);
    expect(ziel(antwort).searchParams.get('gemeldet')).toBe('1');
    expect(zustand.reiche).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      anstellungId: ANSTELLUNG, zeiteintragId: null, art: 'eintrag_fehlt',
      betrifftDatum: '2026-03-28', behauptetPauseMinuten: 30,
    }));
    /*
     * Die behauptete Zeit ist Berliner Wanduhrzeit — über Mitternacht und in
     * der Nacht der Zeitumstellung (29.03.2026, 02:00 → 03:00 MESZ). 22:00 MEZ
     * ist 21:00 UTC, 06:00 MESZ ist 04:00 UTC: sieben Stunden, keine acht.
     */
    const eingabe = zustand.reiche.mock.calls[0]![1] as { behauptetBeginn: Date; behauptetEnde: Date };
    expect(eingabe.behauptetBeginn.toISOString()).toBe('2026-03-28T21:00:00.000Z');
    expect(eingabe.behauptetEnde.toISOString()).toBe('2026-03-29T04:00:00.000Z');
  });

  it('eine Abweisung führt als Grund auf die Maske, mit Eingaben, ohne die Begründung', async () => {
    const antwort = await POST(anfrage({ ...FORMULAR, datum: '28.03.2026' }));
    expect(antwort.status).toBe(303);
    const z = ziel(antwort);
    expect(z.pathname).toBe(MASKE);
    expect(z.searchParams.get('fehler')).toBe('kein_datum');
    expect(z.searchParams.get('anstellung')).toBe(ANSTELLUNG);
    expect(z.searchParams.get('beginn')).toBe('2026-03-28T22:00');
    expect(z.toString()).not.toContain('Marke');
    expect(z.searchParams.get('begruendung_neu')).toBe('ja');
    expect(zustand.reiche).not.toHaveBeenCalled();
  });

  it('VORHER 500: ein Ende vor dem Beginn (`ze_fenster`) wird ein Satz, vor der Datenbank', async () => {
    const antwort = await POST(anfrage({ ...FORMULAR, ende: '2026-03-28T21:00' }));
    expect(ziel(antwort).searchParams.get('fehler')).toBe('fenster_verkehrt');
    expect(zustand.reiche).not.toHaveBeenCalled();
    // Und die zweite Linie, falls die Datenbank doch abweist.
    zustand.reiche.mockRejectedValueOnce(Object.assign(new Error('ze_fenster'),
      { name: 'PostgresError', code: '23514' }));
    const zweite = await POST(anfrage(FORMULAR));
    expect(ziel(zweite).searchParams.get('fehler')).toBe('ungueltige_eingabe');
  });

  it('eine andere Art ohne Eintrag: der Grund des Dienstes, auf der Maske', async () => {
    zustand.reiche.mockRejectedValueOnce(new EinwandOhneBezugFehler());
    const antwort = await POST(anfrage({ ...FORMULAR, art: 'zeit_falsch' }));
    expect(ziel(antwort).searchParams.get('fehler')).toBe('kein_zeiteintrag');
  });

  it('ohne `maske` und `zurueck` bleibt die Route, wie sie war: JSON', async () => {
    const ohne: Record<string, string> = { ...FORMULAR };
    delete ohne['maske'];
    delete ohne['zurueck'];
    const erfolg = await POST(anfrage(ohne));
    expect(erfolg.status).toBe(201);
    const abgewiesen = await POST(anfrage({ ...ohne, begruendung: '' }));
    expect(abgewiesen.status).toBe(400);
    expect(await abgewiesen.json()).toEqual({ fehler: 'keine_begruendung' });
  });

  it('ein Rückweg nach draussen wird nicht befolgt (D-560)', async () => {
    const antwort = await POST(anfrage({ ...FORMULAR, zurueck: 'https://boese.example/x' }));
    expect(ziel(antwort).origin).toBe(HIER);
  });
});

describe('die Seiten', () => {
  it('„Eine Zeit fehlt" schickt die Art und KEINEN Eintrag', () => {
    const seite = lies('src/app/portal/mein/zeiten/einwand/page.tsx');
    expect(seite).toContain('action="/api/zeit/einwand"');
    expect(seite).toContain('name="art" value="eintrag_fehlt"');
    expect(seite).not.toContain('name="zeiteintrag"');
    for (const name of ['anstellung', 'datum', 'beginn', 'ende', 'pause', 'begruendung',
      'maske', 'zurueck']) {
      expect(seite).toContain(`name="${name}"`);
    }
    expect(seite).toContain('eigenerEintrag(ft.gruende, fehler) ?? ft.unbekannt');
  });

  it('der Einwand zu einem Eintrag kommt ebenfalls auf seine Seite zurück', () => {
    const seite = lies('src/app/portal/mein/zeiten/[id]/einwand/page.tsx');
    expect(seite).toContain('name="maske"');
    expect(seite).toContain('name="zurueck"');
  });

  it('„Meine Zeiten" und das Blatt einer beendeten Schicht führen dorthin', () => {
    expect(lies('src/app/portal/mein/zeiten/page.tsx')).toContain('href="/portal/mein/zeiten/einwand"');
    const blatt = lies('src/app/portal/mein/schichten/[zuordnungId]/page.tsx');
    expect(blatt).toContain('/portal/mein/zeiten/einwand?anstellung=');
    expect(blatt).toContain('eigenerEintragZurSchicht');
  });

  it('die Seite steht in der Seitenkarte', () => {
    const r = ROUTEN.find((z) => z.pfad === '/portal/mein/zeiten/einwand');
    expect(r?.scope).toBe('PER→M1');
    expect(r?.spec).toContain('EMP-07');
  });

  it('jeder Grund hat in jeder Sprache einen Satz, ohne Entwurfskennung', () => {
    for (const sprache of PORTAL_SPRACHEN) {
      const t = EINWAND_FORM_TEXTE[sprache];
      for (const g of EINWAND_GRUENDE) expect(t.gruende[g].trim(), `${sprache}/${g}`).not.toBe('');
      expect(JSON.stringify(t)).not.toMatch(/\b[ODVK]-\d/u);
    }
  });
});
