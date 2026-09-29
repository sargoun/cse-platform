/**
 * Eine Datei, die die Prüfkette abweist, kommt beim Erfassen einer
 * Eingangsrechnung als GRUND zurück auf `/neu` — nicht als 500 (D-774
 * Nachrunde).
 *
 * **Der Befund.** `ladeHoch` wirft `MimeFehler` (leer, Typ unbekannt, Typ
 * nicht erlaubt, Widerspruch zur Angabe des Browsers) und `ExifFehler`
 * (Metadaten, die sich nicht sicher entfernen lassen — ein verschlüsseltes
 * PDF). Keiner trägt einen Status, und die Übersetzung von
 * `POST /api/finanzen/eingangsrechnungen` kannte beide nicht: sie fielen
 * durch und endeten als Fehlerseite, ausgerechnet beim verschlüsselten PDF
 * eines Lieferanten. Die Ablage hatte denselben Befund schon geschlossen
 * (D-759, D-774: `datei_<grund>` bzw. `datei_metadaten`).
 *
 * Geprüft wird die ECHTE Route mit dem echten `ladeHoch` und der echten
 * Prüfkette — auf beiden Wegen der Seite: der Beleg der Erfassung und die
 * E-Rechnung (echtes `legeERechnungAb`). Ersetzt sind Sitzung, Datenbank,
 * Tor, Speicher und die Zeilen der Rechnung. Ein unverschlüsseltes PDF läuft
 * als Gegenprobe ganz durch — sonst bliebe der Test grün, weil der Nachbau
 * irgendwo vorher scheitert.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { DOKUMENT_BLATT_TEXTE } from '../../src/lib/i18n/verwaltung/dokument-blatt.js';
import {
  EINGANGSRECHNUNGEN_TEXTE, ERFASSEN_FEHLER_GRUENDE,
} from '../../src/lib/i18n/verwaltung/finanzen/eingangsrechnungen.js';

const RECHNUNG = '7c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  gelegt: [] as string[],
  entfernt: [] as string[],
  erfasst: 0,
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
    abfrage: () => Promise.resolve([]),
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
    entferne: (_bucket: string, schluessel: string) => {
      zustand.entfernt.push(schluessel);
      return Promise.resolve();
    },
    signierteUrl: () => Promise.reject(new Error('nie')),
  }),
}));
vi.mock('@/server/services/finanz/eingangsrechnung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  pruefeDublette: () => Promise.resolve({ istDublette: false, treffer: [], warnung: null }),
  legeBelegAn: () => Promise.resolve('00000000-0000-4000-8000-0000000000be'),
  erfasseEingangsrechnung: () => {
    zustand.erfasst += 1;
    return Promise.resolve(RECHNUNG);
  },
  setzeSteuerzeile: () => Promise.resolve(),
}));
vi.mock('@/server/services/finanz/eingang/erechnung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  extrahiereERechnung: () => ({ nutzlast: { rechnungsdatum: '2026-08-31', rechnungsnummer: 'R-1' } }),
}));

const route = await import('../../src/app/api/finanzen/eingangsrechnungen/route.js');
const { MimeFehler } = await import('../../src/server/storage/mime.js');

const HIER = 'http://localhost:3001';
const NEU = '/portal/reinigung/finanzen/eingangsrechnungen/neu';

const ascii = (t: string): number[] => [...Buffer.from(t, 'latin1')];
const mit = (kopf: readonly number[], rest = 64): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([...kopf, ...new Array<number>(rest).fill(0x20)]);

/** Das Erfassungsformular von `/neu`, so wie ein Browser es schickt. */
function erfassen(daten: Uint8Array<ArrayBuffer>, typ: string, name: string): NextRequest {
  const formular = new FormData();
  for (const [k, v] of Object.entries({
    lieferantId: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e', rechnungsnummer: 'R-4711',
    rechnungsdatum: '2026-08-31', netto: '1000,00', steuer: '190,00', steuergruppe: 'ust_19',
  })) formular.append(k, v);
  formular.append('datei', new File([daten], name, { type: typ }));
  return anfrage(formular);
}

/** Das E-Rechnungs-Formular von `/neu`. */
function erechnung(daten: Uint8Array<ArrayBuffer>, typ: string, name: string): NextRequest {
  const formular = new FormData();
  formular.append('aktion', 'erechnung');
  formular.append('datei', new File([daten], name, { type: typ }));
  return anfrage(formular);
}

function anfrage(formular: FormData): NextRequest {
  return new NextRequest(new URL('/api/finanzen/eingangsrechnungen?mandant=reinigung', HIER), {
    method: 'POST', body: formular,
    headers: new Headers({ host: 'localhost:3001', origin: HIER, accept: 'text/html' }),
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
  zustand.entfernt = [];
  zustand.erfasst = 0;
});

async function ort(a: NextRequest): Promise<string> {
  const r = await route.POST(a);
  expect(r.status).toBe(303);
  const o = r.headers.get('location') ?? '';
  /* Kein Satz in der Adresse: den hat die Seite, und der der Prüfkette ist deutsch. */
  expect(o).not.toContain('meldung=');
  expect(decodeURIComponent(o)).not.toMatch(/verschl|deklariert|Bytes/u);
  return o;
}

describe('POST /api/finanzen/eingangsrechnungen — die Prüfkette der Datei als Grund', () => {
  it('ein verschlüsseltes PDF als Beleg → `datei_metadaten`, kein 500, nichts gespeichert', async () => {
    expect(await ort(erfassen(mit(ascii('%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >>')),
      'application/pdf', 'rechnung.pdf'))).toBe(`${HIER}${NEU}?fehler=datei_metadaten`);
    expect(zustand.gelegt).toEqual([]);
    expect(zustand.erfasst).toBe(0);
  });

  it.each([
    ['ein Programm statt eines PDF', mit(ascii('MZ\x90\x00')), 'application/pdf', 'datei_unbekannt'],
    ['ein ZIP ohne Office-Inhalt', mit([0x50, 0x4b, 0x03, 0x04]), 'application/zip', 'datei_nicht_erlaubt'],
    ['ein PDF, das sich als PNG ausgibt', mit(ascii('%PDF-1.7\n')), 'image/png', 'datei_widerspruch'],
  ] as const)('%s → `%s`', async (_, daten, typ, grund) => {
    expect(await ort(erfassen(daten, typ, 'rechnung.pdf'))).toBe(`${HIER}${NEU}?fehler=${grund}`);
    expect(zustand.gelegt).toEqual([]);
  });

  it('auch der E-Rechnungs-Weg: ein XML, das sich als PDF ausgibt → `datei_widerspruch`', async () => {
    const xml = Uint8Array.from(ascii('<?xml version="1.0"?><Invoice/>'));
    expect(await ort(erechnung(xml, 'application/pdf', 'rechnung.xml')))
      .toBe(`${HIER}${NEU}?fehler=datei_widerspruch`);
    expect(zustand.gelegt).toEqual([]);
  });

  it('Gegenprobe: ein unverschlüsseltes PDF läuft ganz durch und wird abgelegt', async () => {
    const r = await route.POST(erfassen(mit(ascii('%PDF-1.7\n1 0 obj << /Title (Rechnung) >>')),
      'application/pdf', 'rechnung.pdf'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location'))
      .toBe(`${HIER}/portal/reinigung/finanzen/eingangsrechnungen/${RECHNUNG}`);
    expect(zustand.gelegt).toHaveLength(1);
    expect(zustand.entfernt).toEqual([]);
    expect(zustand.erfasst).toBe(1);
  });

  it('jeder Grund der Prüfkette steht in der Liste der Gründe', () => {
    for (const g of ['leer', 'unbekannt', 'nicht_erlaubt', 'widerspruch'] as const) {
      expect(ERFASSEN_FEHLER_GRUENDE).toContain(`datei_${new MimeFehler('x', g).grund}`);
    }
    expect(ERFASSEN_FEHLER_GRUENDE).toContain('datei_metadaten');
  });
});

describe('`/neu` hat den Satz dazu — de und en', () => {
  it.each(['de', 'en'] as const)('%s: derselbe Satz wie auf dem Fassungsblatt und bei der Ablage', (sprache) => {
    const t = EINGANGSRECHNUNGEN_TEXTE[sprache].erfassenFehler;
    const fassung = DOKUMENT_BLATT_TEXTE[sprache].faFehler;
    for (const g of ['datei_leer', 'datei_unbekannt', 'datei_nicht_erlaubt', 'datei_widerspruch',
      'datei_metadaten'] as const) {
      expect(eigenerEintrag(t, g), `${sprache}.${g}`).toBe(fassung[g]);
    }
  });

  it('der englische Satz ist englisch, der deutsche deutsch', () => {
    expect(EINGANGSRECHNUNGEN_TEXTE.de.erfassenFehler.datei_metadaten).toContain('verschlüsseltes PDF');
    expect(EINGANGSRECHNUNGEN_TEXTE.en.erfassenFehler.datei_metadaten).toContain('encrypted PDF');
  });
});
