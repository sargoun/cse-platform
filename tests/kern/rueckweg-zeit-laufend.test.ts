/**
 * `POST /api/zeit/laufend` schickt einen abgewiesenen Feierabend als GRUND
 * zurück aufs Live-Brett — nie als Satz des Dienstes, nie mit der Kennung des
 * Eintrags (V-275, D-773, D-769).
 *
 * **Der Befund.** Die Route schrieb `(fehler as Error).message` als
 * `?meldung=` in die Adresse, und `/zeiten/live` zeigte ihn roh im
 * Warnkasten: nach einem Feierabend, den eine Kollegin schon eingetragen
 * hatte, „Zeiteintrag 5b0d6c1e-… ist nicht vorhanden oder läuft nicht mehr." —
 * eine volle Kennung auf dem Schirm, deutsch auch in einer englischen
 * Sitzung, und jeder präparierte Link schrieb seine eigene Warnung.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienst), die Tabelle der Sätze in beiden Sprachen und am Quelltext, dass die
 * Seite nur nachschlägt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NichtGefundenFehler, ZweiterFaktorFehler } from '../../src/server/auth/fehler.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import { LAUFEND_FEHLER_TEXTE } from '../../src/lib/i18n/verwaltung/zeit.js';
import {
  formular, HIER, KENNUNG, pruefeSaetze, pruefeSeite, rueckweg, SITZUNG,
} from './hilfen/rueckweg-betrieb.js';

const zustand = vi.hoisted(() => ({
  authorize: vi.fn(),
  schliesse: vi.fn(),
  storniere: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(SITZUNG),
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
vi.mock('@/server/services/zeit/laufender-eintrag', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  schliesseLaufendenEintrag: zustand.schliesse,
  storniereLaufendenEintrag: zustand.storniere,
}));

const {
  LAUFEND_GRUENDE, LaufenderEintragFehler, LaufenderEintragNichtGefunden,
} = await import('../../src/server/services/zeit/laufender-eintrag.js');
const { POST } = await import('../../src/app/api/zeit/laufend/route.js');

const LIVE = '/portal/reinigung/zeiten/live';
const SCHLIESSEN = [
  ['zurueck', LIVE], ['eintrag', KENNUNG], ['aktion', 'schliessen'],
  ['ende', '2026-09-28T17:00'], ['pause', '30'], ['begruendung', 'Ausstempeln vergessen'],
] as const;

beforeEach(() => {
  zustand.authorize.mockReset().mockResolvedValue(undefined);
  zustand.schliesse.mockReset().mockResolvedValue({ id: KENNUNG, nettoMinuten: 450 });
  zustand.storniere.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/zeit/laufend — der Rückweg trägt einen Grund', () => {
  it.each([
    ['begruendung_zu_kurz', () => new LaufenderEintragFehler('Satz.', 'begruendung_zu_kurz')],
    ['fenster_ungueltig', () => new LaufenderEintragFehler('Satz.', 'fenster_ungueltig')],
    ['ende_in_zukunft', () => new LaufenderEintragFehler('Satz.', 'ende_in_zukunft')],
    ['pause_ungueltig', () => new LaufenderEintragFehler('Satz.', 'pause_ungueltig')],
    ['nicht_gefunden', () => new LaufenderEintragNichtGefunden(KENNUNG)],
  ] as const)('Schliessen, %s → `?fehler=%s`', async (grund, fehler) => {
    zustand.schliesse.mockRejectedValue(fehler());
    const ziel = rueckweg(await POST(formular('/api/zeit/laufend', SCHLIESSEN)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${LIVE}?fehler=${grund}`);
  });

  it.each([
    ['grund_zu_kurz', () => new LaufenderEintragFehler('Satz.', 'grund_zu_kurz')],
    ['nicht_gefunden', () => new LaufenderEintragNichtGefunden(KENNUNG)],
  ] as const)('Stornieren, %s → `?fehler=%s`', async (grund, fehler) => {
    zustand.storniere.mockRejectedValue(fehler());
    const ziel = rueckweg(await POST(formular('/api/zeit/laufend', [
      ['zurueck', LIVE], ['eintrag', KENNUNG], ['aktion', 'stornieren'], ['begruendung', 'kurz'],
    ])));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${LIVE}?fehler=${grund}`);
  });

  it('die zwei Gründe der Route selbst: Feierabend fehlt, Pause keine ganze Zahl', async () => {
    const ohneEnde = SCHLIESSEN.filter(([k]) => k !== 'ende');
    expect(rueckweg(await POST(formular('/api/zeit/laufend', ohneEnde))).search)
      .toBe('?fehler=ende_fehlt');
    const pause = SCHLIESSEN.map(([k, v]) => (k === 'pause' ? [k, 'eine halbe'] as const : [k, v] as const));
    expect(rueckweg(await POST(formular('/api/zeit/laufend', pause))).search)
      .toBe('?fehler=pause_ungueltig');
    expect(zustand.schliesse).not.toHaveBeenCalled();
  });

  it('der Erfolg führt zurück aufs Brett — ohne Satz, ohne Kennung', async () => {
    const ziel = rueckweg(await POST(formular('/api/zeit/laufend', SCHLIESSEN)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(LIVE);
  });

  it('ein Programm ohne `zurueck` bekommt JSON `{ fehler, meldung }` mit Status — ohne Kennung', async () => {
    zustand.schliesse.mockRejectedValue(new LaufenderEintragNichtGefunden(KENNUNG));
    const r = await POST(formular('/api/zeit/laufend', SCHLIESSEN.filter(([k]) => k !== 'zurueck')));
    expect(r.status).toBe(404);
    const rumpf = await r.json() as { fehler: string; meldung: string };
    expect(rumpf.fehler).toBe('nicht_gefunden');
    expect(rumpf.meldung).toMatch(/läuft nicht mehr/u);
    expect(rumpf.meldung).not.toContain(KENNUNG);

    zustand.schliesse.mockRejectedValue(
      new LaufenderEintragFehler('Die Pause ist …', 'pause_ungueltig'));
    const r2 = await POST(formular('/api/zeit/laufend', SCHLIESSEN.filter(([k]) => k !== 'zurueck')));
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ fehler: 'pause_ungueltig', meldung: 'Die Pause ist …' });
  });

  it('JSON wie bisher: ohne Eintrag, unbekannter Vorgang', async () => {
    const r = await POST(formular('/api/zeit/laufend', [['zurueck', LIVE], ['aktion', 'schliessen']]));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ fehler: 'kein_eintrag' });
    const r2 = await POST(formular('/api/zeit/laufend', [
      ['zurueck', LIVE], ['eintrag', KENNUNG], ['aktion', 'loeschen'],
    ]));
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ fehler: 'unbekannter_vorgang' });
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — kein Rückweg (AUT-06)', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('zeit.korrigieren fehlt'));
    const r = await POST(formular('/api/zeit/laufend', SCHLIESSEN));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
  });

  it('ohne zweiten Faktor geht es auf den Faktor-Schritt — nie auf den Rückweg (D-766)', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await POST(formular('/api/zeit/laufend', SCHLIESSEN));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ziel.searchParams.get('fehler')).toBeNull();
  });

  it('`zurueck` führt nie aus dem Portal hinaus', async () => {
    zustand.schliesse.mockRejectedValue(new LaufenderEintragFehler('Satz.', 'fenster_ungueltig'));
    const r = await POST(formular('/api/zeit/laufend', SCHLIESSEN.map(([k, v]) =>
      (k === 'zurueck' ? [k, 'https://fremd.example/portal'] as const : [k, v] as const))));
    expect(new URL(r.headers.get('location') ?? '').origin).toBe(HIER);
  });
});

describe('die Sätze des Live-Bretts', () => {
  it('jede Fehlerklasse der Route trägt einen Grund, den die Tabelle kennt', () => {
    for (const f of [new LaufenderEintragNichtGefunden(KENNUNG),
      new LaufenderEintragFehler('x', 'grund_zu_kurz')]) {
      expect(LAUFEND_GRUENDE, f.name).toContain(f.grund);
    }
    /* Der Satz des Dienstes trägt keine Kennung mehr (Hausregel „keine UUIDs"). */
    expect(new LaufenderEintragNichtGefunden(KENNUNG).message).not.toContain(KENNUNG);
  });

  it('jeder Grund hat in beiden Sprachen einen Satz — ohne Kennung, ohne Schlüssel', () => {
    pruefeSaetze(LAUFEND_FEHLER_TEXTE, LAUFEND_GRUENDE);
  });

  it('die Seite liest `meldung` nicht mehr und schlägt nur nach', () => {
    pruefeSeite('src/app/portal/[mandant]/zeiten/live/page.tsx', [
      'eigenerEintrag(tF.fehler, fehler) ?? tF.sonst', 'rolle="alert"',
    ]);
  });
});
