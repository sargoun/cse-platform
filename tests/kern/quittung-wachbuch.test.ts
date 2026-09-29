/**
 * Die Schlüsselquittung schreibt ihre Wachbuchseite nur auf AUSDRÜCKLICHEN
 * Wunsch (V-180, D-674 Nr. 3) — Seite und Route.
 *
 * **Der Befund der Prüfung.** D-674 Nr. 3 und der Dienst sagen „keine
 * Vorgabe": der Urheber einer Seite ist eine Beschäftigung in dieser
 * Gesellschaft, und wer keine hat, bekäme sonst eine gescheiterte Quittung,
 * die er so nicht gewählt hat. Die Quittungsseite setzte das Häkchen
 * „Zugleich im Wachbuch vermerken" trotzdem vor (`defaultChecked`), für jedes
 * Konto mit `wachbuch.schreiben`. Ein Konto ohne Beschäftigung hier (der
 * Super-Admin des Seeds, eine Leitung ohne SSE-Anstellung, D-09) scheiterte
 * damit bei JEDER Übergabe an `kein_urheber`, und wer eine hatte, bekam ohne
 * eigene Wahl eine unveränderliche §34a-Seite. Kein Test sah den
 * Ausgangszustand des Häkchens, und keiner die Route mit `im_wachbuch`.
 *
 * Geprüft wird:
 *  1. die Seite: das Häkchen steht nie vor, und es steht nur, wo die Sitzung
 *     Urheber sein kann — sonst der Satz, warum nicht;
 *  2. die ECHTE Route (ersetzt sind Sitzung, Datenbank, Rechte und `buche`):
 *     ohne Häkchen `imWachbuch: false`, mit Häkchen und Recht `true`, mit
 *     Häkchen ohne Recht die Abweisung `kein_wachbuchrecht` als Seite —
 *     und dann wird nicht gebucht.
 *
 * Dass eine Quittung ohne Häkchen auch ohne Beschäftigung gelingt und die
 * Seite zusammen mit einer scheiternden Quittung zurückrollt, steht an echten
 * Zeilen in `tests/isolation/wachbuch-schluessel.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { QUITTUNG_WACHBUCH_TEXTE } from '../../src/lib/i18n/verwaltung/wachbuch.js';
import type * as SchluesselDienst from '../../src/server/services/security/schluessel.js';

const SEITE = readFileSync(
  'src/app/portal/[mandant]/security/schluessel/[id]/quittung/page.tsx', 'utf8');

describe('(1) die Quittungsseite — das Häkchen ist eine Wahl, keine Vorgabe', () => {
  it('das Häkchen „im_wachbuch" steht nie vor', () => {
    const feld = /<input[^>]*name="im_wachbuch"[^>]*\/>/u.exec(SEITE);
    expect(feld?.[0]).toBeDefined();
    expect(feld?.[0]).not.toMatch(/defaultChecked|checked/u);
    // Und die alte Begründung „vorausgewählt" steht nicht mehr über ihm.
    expect(SEITE).not.toContain('vorausgewählt');
  });

  it('angeboten nur mit Recht UND Urheber — sonst steht der Satz, warum nicht', () => {
    expect(SEITE).toContain("darf['wachbuch.schreiben'] === true && await hatWachbuchUrheber(kontext)");
    expect(SEITE).toMatch(/darf\['wachbuch\.schreiben'\] === true && \(urheber \? \(/u);
    expect(SEITE).toContain('{tQ.imWachbuchOhneUrheber}');
    for (const s of ['de', 'en'] as const) {
      expect(QUITTUNG_WACHBUCH_TEXTE[s].imWachbuchOhneUrheber).toMatch(/\S/u);
    }
  });
});

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  buche: vi.fn(),
  authorize: vi.fn(),
  rechte: vi.fn(),
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
vi.mock('@/server/auth/kontext-rechte', () => ({ rechteImKontext: zustand.rechte }));
vi.mock('@/server/services/security/schluessel', async (original) => ({
  ...(await original<typeof SchluesselDienst>()),
  buche: zustand.buche,
}));

const { POST } = await import('../../src/app/api/sicherheit/schluessel/[id]/quittung/route.js');

const HIER = 'http://localhost:3001';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const SEITENPFAD = `/portal/security/security/schluessel/${ID}/quittung`;

function anfrage(felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL(`/api/sicherheit/schluessel/${ID}/quittung`, HIER),
    { method: 'POST', body: daten, headers: kopf });
}

const UEBERGABE = {
  mandant: 'security', art: 'ausgabe', empfaenger_art: 'mitarbeiter',
  anstellung: '00000000-0000-4000-8000-0000000000aa', empfaenger_name: 'Fatima Yildiz',
  unterzeichner: 'Fatima Yildiz', zurueck_fehler: SEITENPFAD,
  zurueck: `/portal/security/security/schluessel/${ID}`,
};

const params = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.buche.mockReset();
  zustand.authorize.mockReset();
  zustand.rechte.mockReset();
  zustand.buche.mockResolvedValue('00000000-0000-4000-8000-00000000000b');
  zustand.authorize.mockResolvedValue(undefined);
  zustand.rechte.mockResolvedValue({ 'wachbuch.schreiben': true });
});

describe('(2) POST /api/sicherheit/schluessel/[id]/quittung — im_wachbuch', () => {
  it('ohne Häkchen: gebucht mit imWachbuch false, und das Wachbuchrecht wird nicht gefragt',
    async () => {
      const antwort = await POST(anfrage(UEBERGABE), params);
      expect(antwort.status).toBe(303);
      expect(antwort.headers.get('location')).toBe(`${HIER}/portal/security/security/schluessel/${ID}`);
      expect(zustand.buche).toHaveBeenCalledWith(expect.anything(),
        expect.objectContaining({ schluesselId: ID, art: 'ausgabe', imWachbuch: false }));
      expect(zustand.rechte).not.toHaveBeenCalled();
    });

  it('mit Häkchen und wachbuch.schreiben: gebucht mit imWachbuch true', async () => {
    const antwort = await POST(anfrage({ ...UEBERGABE, im_wachbuch: '1' }), params);
    expect(antwort.status).toBe(303);
    expect(zustand.rechte).toHaveBeenCalledWith(expect.anything(), 'wachbuch.schreiben');
    expect(zustand.buche).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ imWachbuch: true }));
  });

  it('mit Häkchen OHNE wachbuch.schreiben: zurück auf die Seite mit dem Grund — nichts gebucht',
    async () => {
      zustand.rechte.mockResolvedValue({ 'wachbuch.schreiben': false });
      const antwort = await POST(anfrage({ ...UEBERGABE, im_wachbuch: '1' }), params);
      expect(antwort.status).toBe(303);
      expect(antwort.headers.get('location'))
        .toBe(`${HIER}${SEITENPFAD}?fehler=kein_wachbuchrecht`);
      expect(zustand.buche).not.toHaveBeenCalled();
      // Und der Grund hat auf der Seite einen eigenen Satz, in beiden Sprachen.
      for (const s of ['de', 'en'] as const) {
        expect(QUITTUNG_WACHBUCH_TEXTE[s].fehler['kein_wachbuchrecht']).toMatch(/\S/u);
      }
    });

  it('scheitert die Seite am Urheber, kommt `kein_urheber` als Seite zurück', async () => {
    zustand.buche.mockRejectedValue(Object.assign(new Error('kein Urheber'), {
      code: 'kein_urheber', status: 422,
    }));
    const antwort = await POST(anfrage({ ...UEBERGABE, im_wachbuch: '1' }), params);
    expect(antwort.status).toBe(303);
    expect(antwort.headers.get('location')).toBe(`${HIER}${SEITENPFAD}?fehler=kein_urheber`);
  });
});
