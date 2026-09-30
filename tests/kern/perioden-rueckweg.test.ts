/**
 * Das Periodenschloss meldet mit SCHLÜSSELN zurück — der Erfolg und die
 * Abweisung, dazu ein geprüfter Monat; nie ein fertiger Satz (D-769, D-774).
 *
 * **Der Befund.** `POST /api/buchhaltung/perioden` schickte den Erfolg als
 * Satz (`?meldung=Monat 03/2026 vorläufig geschlossen.`), eine Abweisung mit
 * dem Satz des Dienstes und die Meldung der Datenbank (23001, samt Monat und
 * Anzahl) — die Seite zeigte jeden davon roh, auch den eines präparierten
 * Links.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienst), die Tabelle der Sätze und am Quelltext, dass die Seite `meldung`
 * nicht mehr liest und den Monat nur aus ihren eigenen Monaten nennt.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  PERIODE_ERFOLGE, PERIODE_FEHLER_GRUENDE, PERIODEN_RUECKWEG_TEXTE,
} from '../../src/lib/i18n/verwaltung/buchhaltung-perioden.js';
import { monateDesWirtschaftsjahrs } from '../../src/server/services/buchhaltung/monatszahlen.js';
import type { Wirtschaftsjahr } from '../../src/server/services/buchhaltung/wirtschaftsjahr.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  schliesse: vi.fn(),
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
vi.mock('@/server/services/buchhaltung/periodenschluss', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  schliessePeriode: zustand.schliesse,
}));

const { PeriodenschlussFehler } = await import('../../src/server/services/buchhaltung/periodenschluss.js');
const { NichtGefundenFehler, ZweiterFaktorFehler } = await import('../../src/server/auth/fehler.js');
const route = await import('../../src/app/api/buchhaltung/perioden/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const SEITE = '/portal/reinigung/buchhaltung/perioden';

function formular(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries({
    mandant: 'reinigung', jahr: '2026', monat: '3', art: 'vorlaeufig', ...felder,
  })) daten.append(k, v);
  return new NextRequest(new URL('/api/buchhaltung/perioden', HIER), {
    method: 'POST', body: daten,
    headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

const geschlossen = (status: string) => ({
  periode: { id: 'p', jahr: 2026, monat: 3, beginnAm: '2026-03-01', endeAm: '2026-03-31', status },
  vorher: 'offen',
});

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.authorize.mockReset().mockResolvedValue(zustand.sitzung);
  zustand.schliesse.mockReset();
});

async function ort(anfrage: NextRequest): Promise<string> {
  const r = await route.POST(anfrage);
  expect(r.status).toBe(303);
  const o = r.headers.get('location') ?? '';
  expect(o).not.toContain('meldung=');
  expect(decodeURIComponent(o)).not.toMatch(/03\/2026|Monat /u);
  return o;
}

describe('POST /api/buchhaltung/perioden — Erfolg als Schlüssel, mit geprüftem Monat', () => {
  it.each([
    ['vorlaeufig_geschlossen', 'vorlaeufig_geschlossen', 'vorlaeufig'],
    ['geschlossen', 'geschlossen', 'endgueltig'],
    ['offen', 'geoeffnet', 'oeffnen'],
  ] as const)('Zustand %s → `?erfolg=%s`', async (status, erfolg, art) => {
    zustand.schliesse.mockResolvedValue(geschlossen(status));
    expect(await ort(formular({ art })))
      .toBe(`${HIER}${SEITE}?jahr=2026&monat=2026-03&erfolg=${erfolg}`);
  });
});

describe('POST /api/buchhaltung/perioden — jede Abweisung als Grund', () => {
  it.each([
    ['laufend', 'Der Monat 03/2026 läuft noch (bis 2026-03-31) — …'],
    ['endgueltig', 'Der Monat 03/2026 ist geschlossen und öffnet nicht wieder — …'],
    ['zustand', 'Der Monat ist schon vorläufig geschlossen.'],
    ['recht', 'Das Periodenschloss verlangt buchhaltung.festschreiben.'],
    ['unklar', 'Das Wirtschaftsjahr beginnt am 15. eines Monats. …'],
    ['monat', 'Kein Buchungsmonat.'],
  ] as const)('%s', async (grund, satz) => {
    zustand.schliesse.mockRejectedValue(new PeriodenschlussFehler(satz, grund));
    expect(await ort(formular({})))
      .toBe(`${HIER}${SEITE}?jahr=2026&monat=2026-03&fehler=${grund}`);
  });

  it('die Abweisung der Datenbank (23001): `datenbank` — ihre Meldung reist nicht mit', async () => {
    zustand.schliesse.mockRejectedValue(Object.assign(
      new Error('Der Monat 3/2026 traegt 4 Buchungszeile(n) ohne Konto — erst kontieren, dann schliessen.'),
      { code: '23001' }));
    const o = await ort(formular({}));
    expect(o).toBe(`${HIER}${SEITE}?jahr=2026&monat=2026-03&fehler=datenbank`);
    expect(decodeURIComponent(o)).not.toContain('Buchungszeile');
  });

  it('ein Monat, der keiner ist, reist nicht mit', async () => {
    zustand.schliesse.mockRejectedValue(new PeriodenschlussFehler('Kein Buchungsmonat.', 'monat'));
    expect(await ort(formular({ monat: '13' }))).toBe(`${HIER}${SEITE}?jahr=2026&fehler=monat`);
  });

  it('jeder Grund des Dienstes steht in der Liste der Gründe', () => {
    for (const g of ['laufend', 'endgueltig', 'zustand', 'recht', 'unklar', 'monat'] as const) {
      expect(PERIODE_FEHLER_GRUENDE).toContain(new PeriodenschlussFehler('x', g).grund);
    }
  });
});

/**
 * **Zurück auf das Wirtschaftsjahr der Seite** (D-774 Nachrunde). Das
 * Formular schickte nur das Kalenderjahr des Monats, und die Route kehrte
 * darauf zurück. Beginnt das Wirtschaftsjahr nicht im Januar, ist das ein
 * anderes: März 2026 liegt im Wirtschaftsjahr 2025/2026, und `?jahr=2026`
 * zeigte 2026/2027 — ohne den Monat, den die Seite hätte nennen sollen.
 *
 * Die Tabelle lässt jeden Beginn zu (`datev_konfiguration.wj_beginn_monat`,
 * 1 bis 12, 0126); der Seed setzt keinen abweichenden, also prüft der Test
 * mit einem Beginn im Juli und dem echten Monatsraster der Seite.
 */
describe('zurück auf das Wirtschaftsjahr der Seite — auch wenn es nicht im Januar beginnt', () => {
  const JULI: Wirtschaftsjahr = { beginnMonat: 7, beginnTag: 1, istPlatzhalter: false };
  const monate = (jahr: number): string[] => monateDesWirtschaftsjahrs(jahr, JULI).map((m) => m.monat);

  it('März 2026 im Wirtschaftsjahr 2025/2026 → `?jahr=2025` — und dort steht der Monat', async () => {
    zustand.schliesse.mockResolvedValue(geschlossen('vorlaeufig_geschlossen'));
    expect(await ort(formular({ wirtschaftsjahr: '2025' })))
      .toBe(`${HIER}${SEITE}?jahr=2025&monat=2026-03&erfolg=vorlaeufig_geschlossen`);
    /* Der Dienst bekommt weiter den Kalendermonat. */
    expect(zustand.schliesse).toHaveBeenCalledWith(
      expect.anything(), { jahr: 2026, monat: 3, art: 'vorlaeufig' });
    /* Unter `?jahr=2025` zeigt die Seite genau die Monate, aus denen sie `?monat=` nennt … */
    expect(monate(2025)).toContain('2026-03');
    /* … unter dem alten Ziel `?jahr=2026` nicht: dort fehlte der Monat. */
    expect(monate(2026)).not.toContain('2026-03');
  });

  it('auch eine Abweisung kehrt dorthin zurück', async () => {
    zustand.schliesse.mockRejectedValue(new PeriodenschlussFehler('Der Monat läuft noch.', 'laufend'));
    expect(await ort(formular({ wirtschaftsjahr: '2025' })))
      .toBe(`${HIER}${SEITE}?jahr=2025&monat=2026-03&fehler=laufend`);
  });

  it('ein Kalenderjahr-Wirtschaftsjahr kehrt auf sich selbst zurück', async () => {
    zustand.schliesse.mockResolvedValue(geschlossen('geschlossen'));
    expect(await ort(formular({ wirtschaftsjahr: '2026', art: 'endgueltig' })))
      .toBe(`${HIER}${SEITE}?jahr=2026&monat=2026-03&erfolg=geschlossen`);
  });

  it('geprüft wie der Monat: eine falsche Form ist 400, und nichts wird geschlossen', async () => {
    for (const roh of ['25', '2025/2026', '2025&x=1', 'zwanzig']) {
      const r = await route.POST(formular({ wirtschaftsjahr: roh }));
      expect(r.status, roh).toBe(400);
      expect(await r.json()).toEqual({ fehler: 'unvollstaendig' });
    }
    expect(zustand.schliesse).not.toHaveBeenCalled();
  });

  it('ein Wirtschaftsjahr, das den Monat nicht enthalten kann, reist nicht mit', async () => {
    zustand.schliesse.mockResolvedValue(geschlossen('vorlaeufig_geschlossen'));
    for (const fremd of ['2019', '2027', '2024']) {
      expect(await ort(formular({ wirtschaftsjahr: fremd })), fremd)
        .toBe(`${HIER}${SEITE}?jahr=2026&monat=2026-03&erfolg=vorlaeufig_geschlossen`);
    }
  });

  it('ohne das Feld wie bisher: zurück auf das Kalenderjahr', async () => {
    zustand.schliesse.mockResolvedValue(geschlossen('vorlaeufig_geschlossen'));
    expect(await ort(formular({})))
      .toBe(`${HIER}${SEITE}?jahr=2026&monat=2026-03&erfolg=vorlaeufig_geschlossen`);
  });

  it('das Formular der Seite schickt ihr Wirtschaftsjahr mit', () => {
    const seite = readFileSync(
      join(WURZEL, 'src/app/portal/[mandant]/buchhaltung/perioden/page.tsx'), 'utf8');
    expect(seite).toContain('<input type="hidden" name="wirtschaftsjahr" value={String(z.jahr)} />');
  });
});

describe('Anmeldung und Recht zuerst (AUT-06, D-766)', () => {
  it('ein fehlendes Recht bleibt die byte-gleiche 404', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht fehlt'));
    const r = await route.POST(formular({}));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('{"fehler":"nicht_gefunden"}');
    expect(zustand.schliesse).not.toHaveBeenCalled();
  });

  it('ohne zweiten Faktor: zum Faktor-Schritt, zurück auf die Seite', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await route.POST(formular({}, { accept: 'text/html', referer: `${HIER}${SEITE}?jahr=2026` }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(
      `${HIER}/auth/zwei-faktor/einrichten?weiter=${encodeURIComponent(`${SEITE}?jahr=2026`)}`);
  });

  it('ein unbekannter Fehler bleibt ein Fehler — keine erfundene Abweisung', async () => {
    zustand.schliesse.mockRejectedValue(new Error('Verbindung weg'));
    await expect(route.POST(formular({}))).rejects.toThrow('Verbindung weg');
  });

  it('eine unvollständige Anfrage bleibt JSON wie bisher', async () => {
    const r = await route.POST(formular({ art: 'irgendwas' }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ fehler: 'unvollstaendig' });
  });
});

describe('die Sätze der Seite (fest deutsch, Ausnahmeliste)', () => {
  const t = PERIODEN_RUECKWEG_TEXTE.de;

  it('jeder Grund und jeder Erfolg hat einen Satz — ohne Kennung, ohne Monat, ohne Rechteschlüssel', () => {
    for (const [tabelle, liste] of [[t.fehler, PERIODE_FEHLER_GRUENDE], [t.erfolg, PERIODE_ERFOLGE]] as const) {
      for (const g of liste) {
        const satz = eigenerEintrag(tabelle as Readonly<Record<string, string>>, g);
        expect(satz, g).toBeTruthy();
        expect(satz, g).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|`|\d{2}\/\d{4}|buchhaltung\./u);
      }
    }
    /* Die Browserprüfung sucht diese Wörter im Kasten (tests/e2e/buchhaltung.spec.ts). */
    expect(t.fehler.datenbank).toContain('ohne Konto');
    expect(t.erfolg.vorlaeufig_geschlossen).toContain('vorläufig geschlossen');
    expect(t.erfolg.geoeffnet).toContain('wieder geöffnet');
    expect(t.erfolg.geschlossen).toContain('geschlossen');
  });

  it('ein fremder Schlüssel aus der Adresse findet nichts — auch keinen Prototyp', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'Monat 03/2026 geschlossen.']) {
      expect(eigenerEintrag(t.fehler, k), k).toBeUndefined();
      expect(eigenerEintrag(t.erfolg, k), k).toBeUndefined();
    }
  });

  it('die Seite liest `meldung` nicht mehr und nennt den Monat nur aus ihren Monaten', () => {
    const seite = readFileSync(
      join(WURZEL, 'src/app/portal/[mandant]/buchhaltung/perioden/page.tsx'), 'utf8');
    expect(seite).not.toMatch(/'meldung'/u);
    expect(seite).toContain('eigenerEintrag(t.fehler, fehler) ?? t.sonst');
    expect(seite).toContain('eigenerEintrag(t.erfolg, erfolg)');
    expect(seite).toContain('z.monate.find((m) => m.monat === monatRoh)');
    expect(seite).toMatch(/<Hinweis art="warnung" rolle="alert" cse="periode-abgewiesen"/u);
    expect(seite).toMatch(/<Hinweis art="erfolg" rolle="status" cse="periode-vermerkt"/u);
  });
});
