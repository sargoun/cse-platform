/**
 * Eine Datei, deren Metadaten sich nicht sicher entfernen lassen, kommt beim
 * ERSTEN Ablegen als Grund zurück aufs Formular — nicht als 500 (D-759
 * Nachsatz).
 *
 * **Der Befund.** `ladeHoch` wirft `ExifFehler` für jedes erlaubte Bild ohne
 * Bereinigungsverfahren (TIFF, GIF, WebP), für jedes verschlüsselte PDF und
 * für ein Video ohne lesbaren Kopf. D-759 hat die Lücke für die zweite
 * Fassung geschlossen und für `POST /api/dokumente/upload` ausdrücklich
 * stehen lassen: der Fehler trägt weder `status` noch `code`, fiel durch
 * `alsAntwort` und endete als Fehlerseite — ausgerechnet beim eingescannten
 * Vertrag.
 *
 * Geprüft wird die ECHTE Route mit dem echten Dienst und der echten
 * Prüfkette; ersetzt sind nur Sitzung, Datenbank, Tor und Speicher. Ein
 * unverschlüsseltes PDF läuft als Gegenprobe ganz durch — sonst bliebe der
 * Test grün, weil der Nachbau irgendwo vorher scheitert.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DOKUMENT_BLATT_TEXTE } from '../../src/lib/i18n/verwaltung/dokument-blatt.js';
import { UPLOAD_RUECKWEG_TEXTE } from '../../src/lib/i18n/verwaltung/dokument-rueckweg.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
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
    abfrage: (sql: string) => Promise.resolve(
      sql.includes('m.slug') ? [{ slug: 'reinigung' }]
        : sql.includes('extract(year') ? [{ jahr: 2026 }] : []),
    schreibe: () => Promise.resolve([]),
  }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/storage/waehle', () => ({
  waehleSpeicher: () => ({
    verbunden: true,
    lege: (_bucket: string, schluessel: string) => {
      zustand.gelegt.push(schluessel);
      return Promise.resolve();
    },
    hole: () => Promise.reject(new Error('nie')),
    entferne: () => Promise.reject(new Error('nie')),
    signierteUrl: () => Promise.reject(new Error('nie')),
  }),
}));

const upload = await import('../../src/app/api/dokumente/upload/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const FORMULAR = '/portal/reinigung/dokumente/upload';

const ascii = (t: string): number[] => [...Buffer.from(t, 'latin1')];
const mit = (kopf: readonly number[], rest = 64): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([...kopf, ...new Array<number>(rest).fill(0x20)]);

function ablage(daten: Uint8Array<ArrayBuffer>, typ: string, name: string): NextRequest {
  const formular = new FormData();
  formular.append('datei', new File([daten], name, { type: typ }));
  formular.append('titel', 'Rahmenvertrag 2026');
  formular.append('kategorie', 'vertrag');
  formular.append('zurueck', FORMULAR);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL('/api/dokumente/upload', HIER), {
    method: 'POST', body: formular, headers: kopf,
  });
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.gelegt = [];
});

describe('POST /api/dokumente/upload — Metadaten, die sich nicht entfernen lassen', () => {
  const faelle: readonly [string, Uint8Array<ArrayBuffer>, string, string][] = [
    ['TIFF', mit([0x49, 0x49, 0x2a, 0x00]), 'image/tiff', 'scan.tif'],
    ['GIF', mit(ascii('GIF89a')), 'image/gif', 'plan.gif'],
    ['WebP', mit([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')]), 'image/webp', 'foto.webp'],
    ['verschlüsseltes PDF', mit(ascii('%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >>')),
      'application/pdf', 'vertrag.pdf'],
  ];

  it.each(faelle)('%s → zurück aufs Formular mit Grund, kein 500, nichts abgelegt',
    async (_, daten, typ, name) => {
      const r = await upload.POST(ablage(daten, typ, name));
      expect(r.status).toBe(303);
      const ort = r.headers.get('location') ?? '';
      expect(ort).toBe(`${HIER}${FORMULAR}?fehler=datei_metadaten`);
      /* Kein Satz in der Adresse: den hat die Seite, und der des Dienstes
         nennt Anforderungsnummern. */
      expect(ort).not.toContain('meldung=');
      expect(zustand.gelegt).toEqual([]);
    });

  it('Gegenprobe: ein unverschlüsseltes PDF läuft ganz durch und wird abgelegt', async () => {
    const r = await upload.POST(ablage(
      mit(ascii('%PDF-1.7\n1 0 obj << /Title (Vertrag) >>')), 'application/pdf', 'vertrag.pdf'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location') ?? '')
      .toMatch(/^http:\/\/localhost:3001\/portal\/reinigung\/dokumente\/[0-9a-f-]{36}\?abgelegt=1$/u);
    expect(zustand.gelegt).toHaveLength(1);
  });
});

describe('die Seite hat den Satz dazu', () => {
  /*
   * D-774: die Tabelle des Formulars stand im Seitenrumpf und steht jetzt
   * unter `lib/i18n/verwaltung/dokument-rueckweg.ts` (D-769: Tabellen unter
   * `lib/i18n`, auch für fest deutsche Seiten). Geprüft wird weiter, dass es
   * derselbe Satz aus derselben Quelle ist — und dazu, dass die Seite ihn
   * nachschlägt.
   */
  it('„datei_metadaten“ steht in der Tabelle des Formulars, aus derselben Quelle wie das Blatt', () => {
    const tabelle = readFileSync(
      join(WURZEL, 'src/lib/i18n/verwaltung/dokument-rueckweg.ts'), 'utf8');
    expect(tabelle).toMatch(/const FASSUNG = DOKUMENT_BLATT_TEXTE\.de\.faFehler;/u);
    expect(tabelle).toMatch(/datei_metadaten:\s*FASSUNG\.datei_metadaten/u);
    expect(UPLOAD_RUECKWEG_TEXTE.de.fehler.datei_metadaten)
      .toBe(DOKUMENT_BLATT_TEXTE.de.faFehler.datei_metadaten);
    expect(DOKUMENT_BLATT_TEXTE.de.faFehler.datei_metadaten).toMatch(/JPEG|PNG/u);
    const seite = readFileSync(
      join(WURZEL, 'src/app/portal/[mandant]/dokumente/upload/page.tsx'), 'utf8');
    expect(seite).toContain('eigenerEintrag(t.fehler, fehler)');
  });
});
