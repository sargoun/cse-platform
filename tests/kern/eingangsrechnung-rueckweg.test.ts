/**
 * Die Erfassung einer Eingangsrechnung kommt mit einem GRUND zurück auf
 * `/neu` — nie mit einem Satz, nie mit der getippten Rechnungsnummer (D-769,
 * D-774).
 *
 * **Der Befund.** `POST /api/finanzen/eingangsrechnungen` schickte an neun
 * Stellen einen Satz als `?meldung=` mit: feste Sätze, den Satz von
 * `ERechnungFehler` (mit der Wurzel der hochgeladenen Datei), den von
 * `VorschlagFehler` und die Warnung der Dublettenprüfung („Rechnung <getippte
 * Nummer> dieses Lieferanten liegt … als Beleg ER-… vor"). `/neu` zeigte
 * `meldung ?? fehler` — den deutschen Satz auch einer englischen Sitzung, und
 * ohne ihn den rohen Schlüssel.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor,
 * Speicher und die Dienste), die Tabelle der Sätze in beiden Sprachen und am
 * Quelltext, dass `/neu` `meldung` nicht mehr liest.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  EINGANGSRECHNUNGEN_TEXTE, ERFASSEN_FEHLER_GRUENDE,
} from '../../src/lib/i18n/verwaltung/finanzen/eingangsrechnungen.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  dublette: vi.fn(),
  ladeHoch: vi.fn(),
  anhang: vi.fn(),
  extrahiere: vi.fn(),
  legeERechnungAb: vi.fn(),
  inPruefung: vi.fn(),
  abfrage: vi.fn(),
  entfernt: [] as string[],
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
    abfrage: (sql: string) => zustand.abfrage(sql) as Promise<unknown[]>,
    schreibe: () => Promise.resolve([]),
  }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/storage/waehle', () => ({
  waehleSpeicher: () => ({
    verbunden: true,
    entferne: (_bucket: string, pfad: string) => {
      zustand.entfernt.push(pfad);
      return Promise.resolve();
    },
  }),
}));
vi.mock('@/server/services/dokument/upload', () => ({ ladeHoch: zustand.ladeHoch }));
vi.mock('@/server/services/finanz/eingangsrechnung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  pruefeDublette: zustand.dublette,
  inPruefung: zustand.inPruefung,
}));
vi.mock('@/server/services/finanz/eingang/pdf-anhang', () => ({
  eingebetteteERechnung: zustand.anhang,
}));
vi.mock('@/server/services/finanz/eingang/erechnung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  extrahiereERechnung: zustand.extrahiere,
}));
vi.mock('@/server/services/finanz/eingang/ablage', () => ({
  legeERechnungAb: zustand.legeERechnungAb,
}));

const { NichtVerbundenFehler } = await import('../../src/server/storage/adapter.js');
const { ERechnungFehler } = await import('../../src/server/services/finanz/eingang/erechnung.js');
const { VorschlagFehler } = await import('../../src/server/services/finanz/eingang/vorschlag.js');
const { EingangsrechnungFehler } = await import('../../src/server/services/finanz/eingangsrechnung.js');
const { NichtGefundenFehler } = await import('../../src/server/auth/fehler.js');
const route = await import('../../src/app/api/finanzen/eingangsrechnungen/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const NEU = '/portal/reinigung/finanzen/eingangsrechnungen/neu';
const LIEFERANT = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const PDF = new Uint8Array([...Buffer.from('%PDF-1.7\n1 0 obj <<>>\n', 'latin1')]);

function formular(
  felder: Record<string, string>,
  datei: { bytes: Uint8Array<ArrayBuffer>; typ: string; name: string } | null = null,
  kopf: Record<string, string> = {},
): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  if (datei !== null) daten.append('datei', new File([datei.bytes], datei.name, { type: datei.typ }));
  return new NextRequest(new URL('/api/finanzen/eingangsrechnungen?mandant=reinigung', HIER), {
    method: 'POST', body: daten,
    headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

/** Was ein Browser beim Absenden eines Formulars mitschickt (D-599, D-766). */
const BROWSER = { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' } as const;

/** Ein vollständiges Erfassungsformular — mit Datei oder mit gewähltem Beleg. */
const ERFASSEN = {
  lieferantId: LIEFERANT, rechnungsnummer: 'R-4711-GETIPPT', rechnungsdatum: '2026-08-31',
  netto: '1000,00', steuer: '190,00', steuergruppe: 'ust_19',
} as const;
const PDF_DATEI = { bytes: PDF as Uint8Array<ArrayBuffer>, typ: 'application/pdf', name: 'r.pdf' };

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  for (const f of [zustand.authorize, zustand.dublette, zustand.ladeHoch, zustand.anhang,
    zustand.extrahiere, zustand.legeERechnungAb, zustand.inPruefung, zustand.abfrage]) f.mockReset();
  zustand.abfrage.mockResolvedValue([]);
  zustand.entfernt = [];
  zustand.authorize.mockResolvedValue(zustand.sitzung);
  zustand.dublette.mockResolvedValue({ istDublette: false, treffer: [], warnung: null });
});

async function ort(anfrage: NextRequest): Promise<string> {
  const r = await route.POST(anfrage);
  expect(r.status).toBe(303);
  const o = r.headers.get('location') ?? '';
  expect(o).not.toContain('meldung=');
  expect(o).not.toContain('R-4711');
  return o;
}

describe('POST /api/finanzen/eingangsrechnungen — `/neu` bekommt einen Grund', () => {
  it('unvollstaendig', async () => {
    expect(await ort(formular({ ...ERFASSEN, rechnungsnummer: '' })))
      .toBe(`${HIER}${NEU}?fehler=unvollstaendig`);
  });

  it('ohne_beleg', async () => {
    expect(await ort(formular(ERFASSEN))).toBe(`${HIER}${NEU}?fehler=ohne_beleg`);
  });

  it('dublette — ohne die Warnung des Dienstes und ohne die getippte Nummer', async () => {
    zustand.dublette.mockResolvedValue({
      istDublette: true, treffer: [],
      warnung: 'Rechnung R-4711-GETIPPT dieses Lieferanten liegt für 2026 bereits vor als Beleg ER-2026-0001.',
    });
    const o = await ort(formular(ERFASSEN, PDF_DATEI));
    expect(o).toBe(`${HIER}${NEU}?fehler=dublette`);
    expect(o).not.toContain('ER-2026');
  });

  it('betrag', async () => {
    expect(await ort(formular({ ...ERFASSEN, netto: 'tausend' }, PDF_DATEI)))
      .toBe(`${HIER}${NEU}?fehler=betrag`);
  });

  it('speicher_nicht_verbunden', async () => {
    zustand.ladeHoch.mockRejectedValue(new NichtVerbundenFehler('Supabase Storage'));
    expect(await ort(formular(ERFASSEN, PDF_DATEI)))
      .toBe(`${HIER}${NEU}?fehler=speicher_nicht_verbunden`);
  });

  it('E-Rechnung ohne Datei: erechnung_fehlt', async () => {
    expect(await ort(formular({ aktion: 'erechnung' })))
      .toBe(`${HIER}${NEU}?fehler=erechnung_fehlt`);
  });

  it('ein PDF ohne eingebettete E-Rechnung: keine_erechnung', async () => {
    zustand.anhang.mockResolvedValue(null);
    expect(await ort(formular({ aktion: 'erechnung' }, PDF_DATEI)))
      .toBe(`${HIER}${NEU}?fehler=keine_erechnung`);
  });

  it.each(['kein_xml', 'kein_format', 'unvollstaendig'] as const)(
    'ERechnungFehler %s → `erechnung_%s` — nicht die Wurzel der Datei', async (grund) => {
      zustand.extrahiere.mockImplementation(() => {
        throw new ERechnungFehler('Die Datei ist kein XRechnung-Datensatz (Wurzel <Boese>).', grund);
      });
      const xml = new Uint8Array([...Buffer.from('<?xml version="1.0"?><Boese/>', 'utf8')]);
      const o = await ort(formular({ aktion: 'erechnung' },
        { bytes: xml as Uint8Array<ArrayBuffer>, typ: 'application/xml', name: 'r.xml' }));
      expect(o).toBe(`${HIER}${NEU}?fehler=erechnung_${grund}`);
      expect(o).not.toContain('Boese');
    });

  it.each([
    'keine_erechnung', 'nicht_gefunden', 'nicht_genehmigt', 'unvollstaendig', 'schon_uebernommen',
    'kein_recht',
  ] as const)('VorschlagFehler %s → `vorschlag_%s`', async (grund) => {
    zustand.extrahiere.mockReturnValue({ nutzlast: { rechnungsdatum: '2026-08-31' } });
    zustand.legeERechnungAb.mockRejectedValue(new VorschlagFehler('Der Vorschlag wurde nicht angelegt.', grund));
    const xml = new Uint8Array([...Buffer.from('<?xml version="1.0"?><Invoice/>', 'utf8')]);
    expect(await ort(formular({ aktion: 'erechnung' },
      { bytes: xml as Uint8Array<ArrayBuffer>, typ: 'application/xml', name: 'r.xml' })))
      .toBe(`${HIER}${NEU}?fehler=vorschlag_${grund}`);
  });

  it('jeder Grund, den die Route bilden kann, steht in der Liste der Gründe', () => {
    /* Der Typ von `zurueck()` hält das schon beim Übersetzen fest; hier dasselbe zur Laufzeit. */
    const quelle = readFileSync(join(WURZEL, 'src/app/api/finanzen/eingangsrechnungen/route.ts'), 'utf8');
    const fest = [...quelle.matchAll(/zurueck\(anfrage, '\/neu', \{ fehler: '([a-z_]+)' \}\)/gu)]
      .map((m) => m[1] ?? '');
    expect(fest.length, 'liest der Test die Route noch?').toBeGreaterThanOrEqual(7);
    const alle = [
      ...fest,
      ...(['kein_xml', 'kein_format', 'unvollstaendig'] as const)
        .map((g) => `erechnung_${new ERechnungFehler('x', g).grund}`),
      ...(['keine_erechnung', 'nicht_gefunden', 'nicht_genehmigt', 'unvollstaendig',
        'schon_uebernommen', 'kein_recht'] as const)
        .map((g) => `vorschlag_${new VorschlagFehler('x', g).grund}`),
    ];
    for (const g of alle) expect(ERFASSEN_FEHLER_GRUENDE, g).toContain(g);
  });
});

/**
 * **Die Abweisung des Dienstes beim Erfassen** (D-774 Nachrunde).
 * `EingangsrechnungFehler` endete auch für die zwei Formulare auf `/neu` als
 * JSON mit Status 409 — eine weisse Seite, die Eingabe weg. Ein Browser
 * bekommt jetzt den Grund, ein Programm weiter JSON (D-599). Die Dienste
 * laufen echt: `legeBelegAn`, `erfasseEingangsrechnung`, `setzeSteuerzeile`.
 */
describe('EingangsrechnungFehler beim Erfassen — das Formular bekommt einen Grund, ein Programm JSON', () => {
  /** Was `ladeHoch` liefert, wenn die Datei durchgeht. */
  const HOCH = {
    dokumentId: '00000000-0000-4000-8000-0000000000d0', objektSchluessel: 'm/buchhaltung/d0',
    bucket: 'dokumente', mimeTyp: 'application/pdf', groesseBytes: 32, exifEntfernt: true,
    sha256: 'ab'.repeat(32), aufbewahrungBis: '2036-12-31', loeschsperre: true,
  } as const;

  it('der Beleg wird abgewiesen (`legeBelegAn`) → `rechnung_abgewiesen`, die Datei geht wieder', async () => {
    zustand.ladeHoch.mockResolvedValue(HOCH);
    const o = await ort(formular(ERFASSEN, PDF_DATEI, BROWSER));
    expect(o).toBe(`${HIER}${NEU}?fehler=rechnung_abgewiesen`);
    expect(decodeURIComponent(o)).not.toMatch(/Prüfwert|SHA-256/u);
    expect(zustand.entfernt).toEqual([HOCH.objektSchluessel]);
  });

  it('die Steuersatzgruppe gibt es nicht (`setzeSteuerzeile`) → `rechnung_unvollstaendig`', async () => {
    zustand.abfrage.mockImplementation((sql: string) => Promise.resolve(
      /insert into eingangsrechnung\b/u.test(sql) ? [{ id: LIEFERANT }] : []));
    const o = await ort(formular(
      { ...ERFASSEN, belegId: LIEFERANT, steuergruppe: 'ust_77' }, null, BROWSER));
    expect(o).toBe(`${HIER}${NEU}?fehler=rechnung_unvollstaendig`);
    expect(o).not.toContain('ust_77');
  });

  it('auch der E-Rechnungs-Weg: der Beleg des Vorschlags wird abgewiesen → `rechnung_abgewiesen`', async () => {
    zustand.extrahiere.mockReturnValue({ nutzlast: { rechnungsdatum: '2026-08-31' } });
    zustand.legeERechnungAb.mockRejectedValue(new EingangsrechnungFehler(
      'Dokument, Version und Prüfwert gehören nicht zusammen — es entsteht kein Beleg.', 'abgewiesen'));
    const xml = new Uint8Array([...Buffer.from('<?xml version="1.0"?><Invoice/>', 'utf8')]);
    expect(await ort(formular({ aktion: 'erechnung' },
      { bytes: xml as Uint8Array<ArrayBuffer>, typ: 'application/xml', name: 'r.xml' }, BROWSER)))
      .toBe(`${HIER}${NEU}?fehler=rechnung_abgewiesen`);
  });

  it('ein Programm (ohne `Accept: text/html`) bekommt weiter JSON `{ fehler, meldung }` mit 409', async () => {
    zustand.ladeHoch.mockResolvedValue(HOCH);
    const r = await route.POST(formular(ERFASSEN, PDF_DATEI));
    expect(r.status).toBe(409);
    const rumpf = await r.json() as { fehler: string; meldung: string };
    expect(rumpf.fehler).toBe('abgewiesen');
    expect(rumpf.meldung).toContain('Prüfwert');
    expect(zustand.entfernt).toEqual([HOCH.objektSchluessel]);
  });

  it('beide Rückwege stehen in der Liste der Gründe', () => {
    for (const g of ['rechnung_abgewiesen', 'rechnung_unvollstaendig']) {
      expect(ERFASSEN_FEHLER_GRUENDE).toContain(g);
    }
  });
});

describe('Recht, Programme und fremde Fehler — wie bisher', () => {
  it('ein fehlendes Recht bleibt die byte-gleiche 404', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht eingang.schreiben fehlt'));
    const r = await route.POST(formular(ERFASSEN, PDF_DATEI));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('{"fehler":"nicht_gefunden"}');
  });

  it('eine abgewiesene Zustandsänderung bleibt JSON `{ fehler, meldung }` mit Status (D-599)', async () => {
    zustand.inPruefung.mockRejectedValue(
      new EingangsrechnungFehler('Diese Eingangsrechnung ist schon in Prüfung.', 'abgewiesen'));
    const r = await route.POST(formular({ aktion: 'pruefen', id: LIEFERANT }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      fehler: 'abgewiesen', meldung: 'Diese Eingangsrechnung ist schon in Prüfung.',
    });
  });

  it('ein unbekannter Fehler bleibt ein Fehler — keine erfundene Abweisung', async () => {
    zustand.dublette.mockRejectedValue(new Error('Verbindung weg'));
    await expect(route.POST(formular(ERFASSEN, PDF_DATEI))).rejects.toThrow('Verbindung weg');
  });
});

describe('die Sätze von `/neu` — de und en', () => {
  it('jeder Grund hat in beiden Sprachen einen Satz — ohne Kennung, ohne Platzhalter', () => {
    for (const sprache of ['de', 'en'] as const) {
      const t = EINGANGSRECHNUNGEN_TEXTE[sprache];
      expect(t.erfassenNicht.trim()).not.toBe('');
      expect(t.erfassenFehlerSonst.trim()).not.toBe('');
      for (const g of ERFASSEN_FEHLER_GRUENDE) {
        const satz = eigenerEintrag(t.erfassenFehler, g);
        expect(satz, `${sprache}.${g}`).toBeTruthy();
        expect(satz, `${sprache}.${g}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|`/u);
        if (sprache === 'en') expect(satz).not.toBe(EINGANGSRECHNUNGEN_TEXTE.de.erfassenFehler[g]);
      }
    }
    /* Die Browserprüfungen suchen diese Wörter im Kasten (eingangsrechnung.spec.ts, erechnung.spec.ts). */
    const de = EINGANGSRECHNUNGEN_TEXTE.de.erfassenFehler;
    expect(de.ohne_beleg).toContain('Ohne Dokument');
    expect(de.speicher_nicht_verbunden).toContain('nicht verbunden');
    expect(de.speicher_nicht_verbunden).toContain('NICHTS gespeichert');
  });

  it('ein fremder Schlüssel aus der Adresse findet nichts — auch keinen Prototyp', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'vorschlag', 'Hallo Welt']) {
      expect(eigenerEintrag(EINGANGSRECHNUNGEN_TEXTE.de.erfassenFehler, k), k).toBeUndefined();
    }
  });

  it('`/neu` liest `meldung` nicht mehr und zeigt nie den rohen Schlüssel', () => {
    const seite = readFileSync(
      join(WURZEL, 'src/app/portal/[mandant]/finanzen/eingangsrechnungen/neu/page.tsx'), 'utf8');
    expect(seite).not.toMatch(/'meldung'/u);
    expect(seite).not.toMatch(/\?\?\s*(?:hinweis|fehler)\b/u);
    expect(seite).toContain('eigenerEintrag(t.erfassenFehler, fehler) ?? t.erfassenFehlerSonst');
    expect(seite).toMatch(/<Hinweis art="warnung" rolle="alert" cse="eingang-hinweis"/u);
  });

  /*
   * D-774 Nachrunde: „kein Lieferant" und die Vorbelegung waren aus den
   * Klassen des Bausteins nachgebaut (DESIGN §5 „Notices"). Beide melden
   * einen Stand, keinen Ausgang eines Formulars — ohne `rolle`.
   */
  it('`/neu` baut keinen Hinweis mehr aus Klassen nach', () => {
    const seite = readFileSync(
      join(WURZEL, 'src/app/portal/[mandant]/finanzen/eingangsrechnungen/neu/page.tsx'), 'utf8');
    expect(seite).not.toMatch(/border-warning bg-warning-soft|rounded-lg border border-line bg-surface p-s4/u);
    expect(seite).toMatch(/<Hinweis art="warnung" cse="kein-lieferant" className="[^"]*">/u);
    expect(seite).toContain('<strong>{t.keinLieferantAngelegt}</strong> {t.keinLieferantFolge}');
    expect(seite).toMatch(/<Hinweis art="hinweis" cse="vorbelegung-hinweis" className="[^"]*">/u);
    for (const sprache of ['de', 'en'] as const) {
      const t = EINGANGSRECHNUNGEN_TEXTE[sprache];
      expect(`${t.keinLieferantAngelegt} ${t.keinLieferantFolge}`, sprache).toMatch(/\.$/u);
    }
  });
});
