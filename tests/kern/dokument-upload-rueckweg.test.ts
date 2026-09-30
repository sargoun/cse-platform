/**
 * Das Ablageformular bekommt einen GRUND zurück — und die Anmeldung und das
 * fehlende Recht gehen durch, statt vom Rückweg ersetzt zu werden (D-769,
 * D-774, D-766, AUT-06).
 *
 * **Der Befund.** `POST /api/dokumente/upload` schickte zu `?fehler=` einen
 * Satz als `?meldung=` mit: einen festen, den von `MimeFehler`, und für JEDEN
 * Fehler, den `alsAntwort` annahm, `?fehler=eingabe&meldung=<message>`. Das
 * ersetzte auch, was `alsAntwort` selbst geantwortet hätte — die Umleitung
 * auf die Anmeldung oder den Faktor-Schritt und die byte-gleiche 404 eines
 * fehlenden Rechts: wer die Seite ohne `dokument.schreiben` benutzte, las
 * „Nichts abgelegt. Nicht gefunden", und eine abgelaufene Sitzung landete auf
 * dem Formular statt bei der Anmeldung. Die Seite zog den Satz ihrer Tabelle
 * vor.
 *
 * Geprüft wird die ECHTE Route mit dem echten Ablagedienst und der echten
 * Prüfkette (ersetzt sind nur Sitzung, Datenbank, Tor und Speicher; die
 * Grössengrenze ist auf 1000 Bytes gesenkt, damit „zu gross" ohne 256 MB
 * prüfbar ist), die Tabelle der Sätze und am Quelltext, dass die Seite
 * `meldung` nicht mehr liest. Den Rückweg von `ExifFehler` hält
 * `dokument-ablage-rueckweg.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  UPLOAD_FEHLER_GRUENDE, UPLOAD_RUECKWEG_TEXTE,
} from '../../src/lib/i18n/verwaltung/dokument-rueckweg.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  verbunden: true,
  gelegt: [] as string[],
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) => fn({
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    /* Kunde, Objekt und Auftrag sieht diese Sitzung nicht: jede Suche ist leer. */
    abfrage: (sql: string) => Promise.resolve(
      sql.includes('m.slug') ? [{ slug: 'reinigung' }]
        : sql.includes('extract(year') ? [{ jahr: 2026 }] : []),
    schreibe: () => Promise.resolve([]),
  }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/storage/waehle', () => ({
  waehleSpeicher: () => ({
    verbunden: zustand.verbunden,
    lege: (_bucket: string, schluessel: string) => {
      zustand.gelegt.push(schluessel);
      return Promise.resolve();
    },
    hole: () => Promise.reject(new Error('nie')),
    entferne: () => Promise.reject(new Error('nie')),
    signierteUrl: () => Promise.reject(new Error('nie')),
  }),
}));
vi.mock('@/server/storage/mime', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  MAX_BYTES: 1000,
}));

const { AblageFehler, BezugUnbekannt } = await import('../../src/server/services/dokument/ablage.js');
const { MimeFehler } = await import('../../src/server/storage/mime.js');
const { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler } =
  await import('../../src/server/auth/fehler.js');
const upload = await import('../../src/app/api/dokumente/upload/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const FORMULAR = '/portal/reinigung/dokumente/upload';
const KENNUNG = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';

const ascii = (t: string): number[] => [...Buffer.from(t, 'latin1')];
const mit = (kopf: readonly number[], rest = 64): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([...kopf, ...new Array<number>(rest).fill(0x20)]);
const PDF = mit(ascii('%PDF-1.7\n1 0 obj << /Title (Vertrag) >>'));

function ablage(
  felder: Record<string, string>,
  datei: { bytes: Uint8Array<ArrayBuffer>; typ: string; name: string } | null = {
    bytes: PDF, typ: 'application/pdf', name: 'vertrag.pdf',
  },
  kopf: Record<string, string> = {},
): NextRequest {
  const formular = new FormData();
  if (datei !== null) formular.append('datei', new File([datei.bytes], datei.name, { type: datei.typ }));
  for (const [k, v] of Object.entries({
    titel: 'Rahmenvertrag 2026', kategorie: 'vertrag', zurueck: FORMULAR, ...felder,
  })) {
    if (v !== '') formular.append(k, v);
  }
  return new NextRequest(new URL('/api/dokumente/upload', HIER), {
    method: 'POST', body: formular,
    headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.authorize.mockReset().mockResolvedValue(zustand.sitzung);
  zustand.verbunden = true;
  zustand.gelegt = [];
});

async function rueckweg(anfrage: NextRequest): Promise<string> {
  const r = await upload.POST(anfrage);
  expect(r.status).toBe(303);
  const ort = r.headers.get('location') ?? '';
  expect(ort).not.toContain('meldung=');
  expect(ort).not.toContain(KENNUNG);
  return ort;
}

describe('POST /api/dokumente/upload — jeder Grund reist als Schlüssel', () => {
  it.each([
    ['datei_leer', {}, null],
    ['datei_unbekannt', {}, { bytes: mit([]), typ: '', name: 'leerzeichen.bin' }],
    ['datei_nicht_erlaubt', {}, { bytes: mit([0x50, 0x4b, 0x03, 0x04]), typ: 'application/zip', name: 'x.zip' }],
    ['datei_widerspruch', {}, { bytes: PDF, typ: 'image/png', name: 'foto.png' }],
    ['datei_zu_gross', {}, { bytes: mit(ascii('%PDF-1.7'), 1000), typ: 'application/pdf', name: 'gross.pdf' }],
    ['titel_fehlt', { titel: '' }, undefined],
    ['titel_zu_lang', { titel: 'T'.repeat(201) }, undefined],
    ['kategorie_unbekannt', { kategorie: 'sonstiges' }, undefined],
    ['beschreibung_zu_lang', { beschreibung: 'B'.repeat(2001) }, undefined],
    ['kunde_unbekannt', { kunde: 'nein' }, undefined],
    ['objekt_unbekannt', { objekt: '123' }, undefined],
    ['auftrag_unbekannt', { auftrag: 'AU-2026-00001' }, undefined],
  ] as const)('%s', async (grund, felder, datei) => {
    const ort = await rueckweg(ablage(felder, datei === undefined ? undefined : datei));
    expect(ort).toBe(`${HIER}${FORMULAR}?fehler=${grund}`);
    expect(zustand.gelegt).toEqual([]);
  });

  it.each(['kunde', 'objekt', 'auftrag'] as const)(
    '%s mit gültiger Kennung, den diese Sitzung nicht sieht (BezugUnbekannt): derselbe Grund, keine Kennung',
    async (was) => {
      expect(await rueckweg(ablage({ [was]: KENNUNG })))
        .toBe(`${HIER}${FORMULAR}?fehler=${was}_unbekannt`);
    });

  it('ohne Speicher: `speicher`', async () => {
    zustand.verbunden = false;
    expect(await rueckweg(ablage({}))).toBe(`${HIER}${FORMULAR}?fehler=speicher`);
  });

  it('ein Rückweg mit Auftrag behält ihn — und hängt den Grund mit `&` an', async () => {
    const zurueck = `${FORMULAR}?auftrag=${KENNUNG.replace('5b0d', '7c1e')}`;
    const r = await upload.POST(ablage({ titel: '', zurueck }));
    expect(r.headers.get('location')).toBe(`${HIER}${zurueck}&fehler=titel_fehlt`);
  });

  it('`zurueck` führt nie aus der Anwendung hinaus', async () => {
    const r = await upload.POST(ablage({ titel: '', zurueck: 'https://fremd.example/x' }));
    expect(new URL(r.headers.get('location') ?? '').origin).toBe(HIER);
  });

  it('Erfolg bleibt der Weg aufs neue Dokument, `?abgelegt=1`', async () => {
    const r = await upload.POST(ablage({}));
    expect(r.headers.get('location') ?? '')
      .toMatch(/^http:\/\/localhost:3001\/portal\/reinigung\/dokumente\/[0-9a-f-]{36}\?abgelegt=1$/u);
  });

  it('jede Fehlerklasse der Ablage trägt einen Grund, den die Seite kennt', () => {
    const faelle = [
      ...(['unbekannt', 'nicht_erlaubt', 'widerspruch', 'leer'] as const)
        .map((g) => `datei_${new MimeFehler('x', g).grund}`),
      ...(['titel_fehlt', 'titel_zu_lang', 'kategorie_unbekannt', 'beschreibung_zu_lang',
        'kunde_unbekannt', 'objekt_unbekannt', 'auftrag_unbekannt', 'datei_leer',
        'datei_zu_gross'] as const).map((g) => new AblageFehler('x', g).grund),
      ...(['kunde', 'objekt', 'auftrag'] as const).map((w) => new BezugUnbekannt(w).grund),
    ];
    for (const g of faelle) expect(UPLOAD_FEHLER_GRUENDE, g).toContain(g);
  });
});

describe('Anmeldung und Recht gehen durch — der Rückweg ersetzt sie nicht (D-766, AUT-06)', () => {
  it('ein fehlendes Recht ist die byte-gleiche 404, nicht „Nichts abgelegt. Nicht gefunden"', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht dokument.schreiben fehlt'));
    const r = await upload.POST(ablage({}));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('{"fehler":"nicht_gefunden"}');
  });

  it('ohne Sitzung: zur Anmeldung, mit dem Formular als Rückkehr', async () => {
    zustand.authorize.mockRejectedValue(new NichtAngemeldetFehler());
    const r = await upload.POST(ablage({}));
    expect(r.status).toBe(303);
    expect(r.headers.get('location'))
      .toBe(`${HIER}/auth/login?weiter=${encodeURIComponent(FORMULAR)}`);
  });

  it('ohne zweiten Faktor: zum Faktor-Schritt', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await upload.POST(ablage({}));
    expect(r.status).toBe(303);
    expect(r.headers.get('location'))
      .toBe(`${HIER}/auth/zwei-faktor/einrichten?weiter=${encodeURIComponent(FORMULAR)}`);
  });
});

describe('ein Programm ohne `zurueck` bekommt, was es bisher bekam (D-599)', () => {
  it('ein Dienstfehler ist JSON mit Status: `{ fehler, meldung }`', async () => {
    const r = await upload.POST(ablage({ titel: '', zurueck: '' }));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ fehler: 'ungueltige_eingabe', meldung: expect.any(String) });
  });

  it('eine abgewiesene Datei führt ins Portal — mit dem Grund, ohne Satz', async () => {
    const r = await upload.POST(ablage({ zurueck: '' },
      { bytes: PDF, typ: 'image/png', name: 'foto.png' }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}/portal?fehler=datei_widerspruch`);
  });

  it('ohne Sitzung und ohne Formularmerkmale: JSON 401', async () => {
    zustand.authorize.mockRejectedValue(new NichtAngemeldetFehler());
    const r = await upload.POST(ablage({ zurueck: '' }));
    expect(r.status).toBe(401);
  });

  it('ein unbekannter Fehler bleibt ein Fehler — keine erfundene Abweisung', async () => {
    zustand.authorize.mockRejectedValue(new Error('Verbindung weg'));
    await expect(upload.POST(ablage({}))).rejects.toThrow('Verbindung weg');
  });
});

describe('die Sätze der Seite (fest deutsch, Ausnahmeliste)', () => {
  const t = UPLOAD_RUECKWEG_TEXTE.de;

  it('jeder Grund hat einen Satz — ohne Kennung, ohne Platzhalter', () => {
    expect(t.titel.trim()).not.toBe('');
    expect(t.sonst.trim()).not.toBe('');
    for (const g of UPLOAD_FEHLER_GRUENDE) {
      const satz = eigenerEintrag(t.fehler, g);
      expect(satz, g).toBeTruthy();
      expect(satz, g).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|`/u);
    }
  });

  it('ein fremder Schlüssel aus der Adresse findet nichts — auch keinen Prototyp', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'eingabe', 'Hallo Welt']) {
      expect(eigenerEintrag(t.fehler, k), k).toBeUndefined();
    }
  });

  it('die Seite liest `meldung` nicht mehr und fällt auf den allgemeinen Satz zurück', () => {
    const seite = readFileSync(
      join(WURZEL, 'src/app/portal/[mandant]/dokumente/upload/page.tsx'), 'utf8');
    expect(seite).not.toMatch(/'meldung'/u);
    expect(seite).toContain('eigenerEintrag(t.fehler, fehler) ?? t.sonst');
    expect(seite).toMatch(/<Hinweis art="warnung" rolle="alert" cse="upload-fehler"/u);
  });
});
