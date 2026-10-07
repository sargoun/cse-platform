/**
 * Eine eigene Anmeldung, die sich nicht beenden liess, kommt als GRUND zurück
 * auf die Sicherheitsseite — nie als Satz des Dienstes (D-769, D-774).
 *
 * **Der Befund.** `POST /api/konto/sitzung` schickte den deutschen Satz von
 * `SitzungFehler` als `?meldung=`, und `/portal/konto/sicherheit` zeigte ihn
 * roh im Warnkasten: einem Konto mit englischer, arabischer oder türkischer
 * Portalsprache deutsch, und jeden Text, den ein präparierter Link
 * mitbrachte, als Systemmeldung.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank und
 * Dienst), die Tabelle der Sätze in allen vier Sprachen der Seite und am
 * Quelltext, dass die Seite `?meldung=` nicht mehr liest. Ein Recht prüft
 * diese Route nicht — es ist Selbstbedienung, die Policy auf
 * `benutzer_sitzung` ist die Grenze (V-039) —, also gibt es hier kein 404
 * eines fehlenden Rechts. Einen JSON-Weg hat sie auch nicht: sie liest ein
 * Formular.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { SICHERHEIT_TEXTE, SITZUNG_FEHLER_GRUENDE } from '../../src/lib/i18n/konto.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  beende: vi.fn(),
  beendeAndere: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({ unsafe: () => Promise.resolve([]) }) }),
}));
vi.mock('@/server/kontext/index', () => ({ bindePersoenlich: () => Promise.resolve() }));
vi.mock('@/server/services/konto/sitzungen', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  beendeEigeneSitzung: zustand.beende,
  beendeAndereSitzungen: zustand.beendeAndere,
}));

const { SitzungFehler } = await import('../../src/server/services/konto/sitzungen.js');
const route = await import('../../src/app/api/konto/sitzung/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const SEITE = '/portal/konto/sicherheit';
const FREMDE = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';

function formular(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL('/api/konto/sitzung', HIER), {
    method: 'POST', body: daten,
    headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: null, personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.beende.mockReset();
  zustand.beendeAndere.mockReset();
});

describe('POST /api/konto/sitzung — der Rückweg trägt einen Grund', () => {
  it.each([
    ['diese_sitzung', () => new SitzungFehler('Das ist die Anmeldung, in der Sie gerade sind.', 'diese_sitzung', 409)],
    ['nicht_gefunden', () => new SitzungFehler(`Anmeldung ${FREMDE} gibt es nicht mehr.`, 'nicht_gefunden', 404)],
  ] as const)('%s → `?fehler=<grund>`, kein Satz, keine Kennung', async (grund, fehler) => {
    zustand.beende.mockRejectedValue(fehler());
    const r = await route.POST(formular({ sitzung: FREMDE, zurueck: SEITE }));
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${SEITE}?fehler=${grund}`);
    expect(ort).not.toContain('meldung=');
    expect(ort).not.toContain(FREMDE);
  });

  it('ohne `zurueck` geht es auf die Sicherheitsseite, nie ins Leere', async () => {
    zustand.beende.mockRejectedValue(new SitzungFehler('x', 'nicht_gefunden', 404));
    const r = await route.POST(formular({ sitzung: FREMDE, zurueck: '' }));
    expect(r.headers.get('location')).toBe(`${HIER}${SEITE}?fehler=nicht_gefunden`);
  });

  it('`zurueck` führt nie aus der Anwendung hinaus', async () => {
    zustand.beende.mockRejectedValue(new SitzungFehler('x', 'diese_sitzung', 409));
    const r = await route.POST(formular({ sitzung: FREMDE, zurueck: 'https://fremd.example/x' }));
    expect(new URL(r.headers.get('location') ?? '').origin).toBe(HIER);
  });

  it('Erfolg bleibt der Schlüssel `?beendet=1`', async () => {
    zustand.beende.mockResolvedValue(undefined);
    const r = await route.POST(formular({ sitzung: FREMDE, zurueck: SEITE }));
    expect(r.headers.get('location')).toBe(`${HIER}${SEITE}?beendet=1`);
  });

  it('„alle anderen" beendet alle übrigen eigenen Anmeldungen — mit der laufenden als Grenze (V-331)', async () => {
    zustand.beendeAndere.mockResolvedValue(2);
    const r = await route.POST(formular({ sitzung: 'alle_anderen', zurueck: SEITE }));
    expect(r.headers.get('location')).toBe(`${HIER}${SEITE}?beendet=alle`);
    expect(zustand.beendeAndere).toHaveBeenCalledWith(expect.anything(),
      '00000000-0000-4000-8000-000000000003');
    expect(zustand.beende).not.toHaveBeenCalled();
  });

  it('ein anderer Fehler bleibt ein Fehler — keine erfundene Abweisung', async () => {
    zustand.beende.mockRejectedValue(new Error('Verbindung weg'));
    await expect(route.POST(formular({ sitzung: FREMDE, zurueck: SEITE }))).rejects.toThrow('Verbindung weg');
  });

  it('ohne Sitzung: ein Browserformular geht zur Anmeldung, nicht auf den Rückweg (D-766)', async () => {
    zustand.sitzung = null;
    const r = await route.POST(formular({ sitzung: FREMDE, zurueck: SEITE },
      { accept: 'text/html', referer: `${HIER}${SEITE}` }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(
      `${HIER}/auth/login?weiter=${encodeURIComponent(SEITE)}`);
    expect(zustand.beende).not.toHaveBeenCalled();
  });
});

describe('die Sätze — in jeder Sprache der Seite', () => {
  it('jeder Grund des Dienstes steht in der Liste der Gründe', () => {
    for (const f of [new SitzungFehler('x', 'diese_sitzung'), new SitzungFehler('x', 'nicht_gefunden')]) {
      expect(SITZUNG_FEHLER_GRUENDE).toContain(f.grund);
    }
  });

  it('de, en, ar und tr haben für jeden Grund einen Satz — ohne Kennung, ohne Platzhalter', () => {
    for (const sprache of ['de', 'en', 'ar', 'tr'] as const) {
      const t = SICHERHEIT_TEXTE[sprache];
      expect(t.nichtBeendet.trim(), sprache).not.toBe('');
      expect(t.fehlerSonst.trim(), sprache).not.toBe('');
      // V-331: der Knopf und seine Bestätigung — in jeder Sprache eigene Worte.
      expect(t.alleAnderen.trim(), sprache).not.toBe('');
      expect(t.alleBeendet.trim(), sprache).not.toBe('');
      if (sprache !== 'de') expect(t.alleBeendet, sprache).not.toBe(SICHERHEIT_TEXTE.de.alleBeendet);
      for (const g of SITZUNG_FEHLER_GRUENDE) {
        const satz = eigenerEintrag(t.fehler, g);
        expect(satz, `${sprache}.${g}`).toBeTruthy();
        expect(satz, `${sprache}.${g}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}/u);
        if (sprache !== 'de') expect(satz, `${sprache}.${g}`).not.toBe(SICHERHEIT_TEXTE.de.fehler[g]);
      }
    }
  });

  it('ein fremder Grund aus der Adresse findet keinen Satz — und keinen Prototyp', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'Hallo Welt', '']) {
      expect(eigenerEintrag(SICHERHEIT_TEXTE.de.fehler, k), k).toBeUndefined();
    }
  });
});

describe('die Seite zeigt nur den nachgeschlagenen Satz', () => {
  const seite = readFileSync(join(WURZEL, 'src/app/portal/konto/sicherheit/page.tsx'), 'utf8');

  it('liest `meldung` nicht mehr und fällt auf den allgemeinen Satz zurück', () => {
    expect(seite).not.toMatch(/\['meldung'\]/u);
    expect(seite).toContain("suche['fehler']");
    expect(seite).toContain('eigenerEintrag(t.fehler, fehler) ?? t.fehlerSonst');
  });

  it('Abweisung `rolle="alert"`, Bestätigung `rolle="status"`', () => {
    expect(seite).toMatch(/<Hinweis art="warnung" rolle="alert" cse="sitzung-meldung"/u);
    expect(seite).toMatch(/<Hinweis art="erfolg" rolle="status" cse="sitzung-beendet"/u);
  });
});
