/**
 * Eine abgewiesene AUSFÜHRUNG kommt als Grund zurück auf die Freigabe — der
 * vorhandene `grund` von `AusfuehrungAbgewiesen`, nie der Satz des Dienstes
 * (D-769, D-774).
 *
 * **Der Befund.** `POST /api/freigaben/[id]/entscheidung` schickte bei einer
 * abgewiesenen Übernahme `?fehler=ausfuehrung&meldung=<Satz>`, und das Blatt
 * zeigte den Satz roh unter „Nicht entschieden." — auch den eines
 * präparierten Links. Einem Programm schickte die Route den Grund schon immer.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * die Dienste der Freigabe), die Tabelle der Sätze und am Quelltext, dass das
 * Blatt `meldung` nicht mehr liest.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  AUSFUEHRUNG_FEHLER_GRUENDE, AUSFUEHRUNG_RUECKWEG_TEXTE,
} from '../../src/lib/i18n/verwaltung/freigabe-ausfuehrung.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  entscheide: vi.fn(),
  fuehreAus: vi.fn(),
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
    abfrage: () => Promise.resolve([{ slug: 'reinigung', aktion: 'eingangsrechnung_uebernehmen' }]),
  }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/freigabe/entscheiden', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  entscheideFreigabe: zustand.entscheide,
}));
vi.mock('@/server/services/freigabe/ausfuehrung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fuehreAus: zustand.fuehreAus,
}));
vi.mock('@/server/services/freigabe/stapel', () => ({ armiereRuecknahme: () => Promise.resolve() }));

const { AusfuehrungAbgewiesen } = await import('../../src/server/services/freigabe/ausfuehrung.js');
const { FreigabeAbgewiesen } = await import('../../src/server/services/freigabe/entscheiden.js');
const { NichtGefundenFehler } = await import('../../src/server/auth/fehler.js');
const route = await import('../../src/app/api/freigaben/[id]/entscheidung/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const BLATT = `/portal/reinigung/freigaben/${ID}`;
const params = { params: Promise.resolve({ id: ID }) };
const GRUENDE = [
  'keine_erechnung', 'nicht_gefunden', 'nicht_genehmigt', 'unvollstaendig', 'schon_uebernommen',
  'kein_recht',
] as const;

function formular(felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL(`/api/freigaben/${ID}/entscheidung`, HIER), {
    method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER }),
  });
}

function json(rumpf: Record<string, string>): NextRequest {
  return new NextRequest(new URL(`/api/freigaben/${ID}/entscheidung`, HIER), {
    method: 'POST', body: JSON.stringify(rumpf),
    headers: new Headers({ host: 'localhost:3001', origin: HIER, 'content-type': 'application/json' }),
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
  zustand.entscheide.mockReset().mockResolvedValue({ snapshotId: 's', ketteNr: 7n, hash: 'h' });
  zustand.fuehreAus.mockReset();
});

describe('POST /api/freigaben/[id]/entscheidung — die Ausführung reist mit ihrem Grund', () => {
  it.each(GRUENDE)('%s → `?fehler=ausfuehrung_%s` — kein Satz', async (grund) => {
    zustand.fuehreAus.mockRejectedValue(new AusfuehrungAbgewiesen(
      `Übernommen wird nur eine genehmigte Freigabe (Stand: abgelehnt).`, grund));
    const r = await route.POST(formular({ entscheidung: 'genehmigt' }), params);
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${BLATT}?fehler=ausfuehrung_${grund}`);
    expect(ort).not.toContain('meldung=');
    expect(decodeURIComponent(ort)).not.toContain('Stand');
  });

  it('ein Programm bekommt weiter JSON mit Status, Grund und Satz (D-599)', async () => {
    zustand.fuehreAus.mockRejectedValue(new AusfuehrungAbgewiesen('Satz des Dienstes.', 'kein_recht'));
    const r = await route.POST(json({ entscheidung: 'genehmigt' }), params);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ fehler: 'ausfuehrung', grund: 'kein_recht', meldung: 'Satz des Dienstes.' });
  });

  it('eine abgewiesene Entscheidung bleibt `?fehler=<grund>`', async () => {
    zustand.entscheide.mockRejectedValue(new FreigabeAbgewiesen('ohne_begruendung', 'Eine Ablehnung braucht …'));
    const r = await route.POST(formular({ entscheidung: 'abgelehnt' }), params);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=ohne_begruendung`);
  });

  it('ein fehlendes Recht bleibt die byte-gleiche 404 (AUT-06)', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht freigabe.entscheiden fehlt'));
    const r = await route.POST(formular({ entscheidung: 'genehmigt' }), params);
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('{"fehler":"nicht_gefunden"}');
  });

  it('ein unbekannter Fehler bleibt ein Fehler — keine erfundene Abweisung', async () => {
    zustand.fuehreAus.mockRejectedValue(new Error('Verbindung weg'));
    await expect(route.POST(formular({ entscheidung: 'genehmigt' }), params)).rejects.toThrow('Verbindung weg');
  });

  it('jeder Grund des Ausführers steht in der Liste der Gründe', () => {
    for (const g of GRUENDE) {
      expect(AUSFUEHRUNG_FEHLER_GRUENDE).toContain(`ausfuehrung_${new AusfuehrungAbgewiesen('x', g).grund}`);
    }
  });
});

describe('die Sätze des Blatts (fest deutsch, Ausnahmeliste)', () => {
  const t = AUSFUEHRUNG_RUECKWEG_TEXTE.de;

  it('jeder Grund hat einen Satz — ohne Kennung, ohne Rechteschlüssel, ohne Stand aus dem Dienst', () => {
    for (const g of AUSFUEHRUNG_FEHLER_GRUENDE) {
      const satz = eigenerEintrag(t.fehler, g);
      expect(satz, g).toBeTruthy();
      expect(satz, g).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|`|eingang\.schreiben|Stand:/u);
    }
  });

  it('ein fremder Schlüssel aus der Adresse findet nichts — auch keinen Prototyp', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'ausfuehrung', 'Hallo Welt']) {
      expect(eigenerEintrag(t.fehler, k), k).toBeUndefined();
    }
  });

  it('das Blatt liest `meldung` nicht mehr und fällt auf den allgemeinen Satz zurück', () => {
    const seite = readFileSync(join(WURZEL, 'src/app/portal/[mandant]/freigaben/[id]/page.tsx'), 'utf8');
    expect(seite).not.toMatch(/'meldung'/u);
    expect(seite).toContain('eigenerEintrag(AUSFUEHRUNG_RUECKWEG_TEXTE.de.fehler, fehler)');
    expect(seite).toContain("?? 'Die Entscheidung wurde abgewiesen.'");
    expect(seite).toMatch(/<Kasten art="warnung" rolle="alert" cse="entscheidung-abgewiesen"/u);
  });
});
