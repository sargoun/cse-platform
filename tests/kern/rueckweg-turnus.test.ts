/**
 * `POST /api/reinigung/turnus` schickt eine abgewiesene Ausnahme oder einen
 * abgewiesenen Turnus als GRUND zurück — nie als Satz, nie mit Kennung, und
 * nie an Stelle der Anmeldung oder der 404 (V-275, D-773, D-769, D-766).
 *
 * **Der Befund.** Bis auf den abgewiesenen Anker (V-192) schrieb die Route den
 * Satz jedes Fehlers mit `status`/`code` in `?fehler=`: das Turnusblatt
 * zeigte ihn roh („Den Turnus 5b0d6c1e-… gibt es in dieser Gesellschaft
 * nicht."), `/turnus/neu` seit V-250 einen allgemeinen Satz. Und die Weiche
 * ersetzte JEDE Antwort von `alsAntwort` mit Meldung durch den Rückweg: ein
 * fehlendes Recht wurde „Nicht gefunden" auf der Seite statt der byte-gleichen
 * 404, die Umleitung auf den Faktor-Schritt ein Satz.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienste), die Tabellen und am Quelltext, dass beide Seiten nachschlagen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NichtGefundenFehler, ZweiterFaktorFehler } from '../../src/server/auth/fehler.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import {
  TURNUS_ANLAGE_TEXTE, TURNUS_AUSNAHME_TEXTE,
} from '../../src/lib/i18n/verwaltung/reinigung.js';
import {
  formular, fremdesFormular, KENNUNG, pruefeSaetze, pruefeSeite, rueckweg, SITZUNG,
} from './hilfen/rueckweg-betrieb.js';

const zustand = vi.hoisted(() => ({
  authorize: vi.fn(),
  planungsrecht: vi.fn(),
  ausnahme: vi.fn(),
  turnus: vi.fn(),
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
vi.mock('@/server/auth/kontext-rechte', () => ({ rechteImKontext: zustand.planungsrecht }));
vi.mock('@/server/services/reinigung/turnus', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legeAusnahmeAn: zustand.ausnahme,
}));
vi.mock('@/server/services/dienstplan/serie', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legeTurnusSerieAn: zustand.turnus,
}));

const {
  AusnahmeEingabeFehlt, TURNUS_ANLAGE_GRUENDE, TURNUS_AUSNAHME_GRUENDE, TurnusNichtGefunden,
} = await import('../../src/server/services/reinigung/turnus.js');
const {
  SERIE_REGEL_GRUENDE, SerieEingabeFehlt,
} = await import('../../src/server/services/dienstplan/serie.js');
const { POST } = await import('../../src/app/api/reinigung/turnus/route.js');

const LISTE = '/portal/reinigung/reinigung/turnus';
const AUSNAHME = [
  ['mandant', 'reinigung'], ['art', 'ausnahme'], ['turnus', KENNUNG], ['datum', '2026-10-05'],
  ['ausnahme_art', 'ausfall'], ['grund', 'Objekt geschlossen'],
] as const;
const TURNUS = [
  ['mandant', 'reinigung'], ['art', 'turnus'], ['revier', KENNUNG], ['leistung', KENNUNG],
  ['bezeichnung', 'Abendreinigung'], ['wochentag', 'MO'], ['beginn', '18:00'], ['dauer', '120'],
  ['gueltig_ab', '2026-10-01'],
] as const;
const ohne = (felder: readonly (readonly [string, string])[], feld: string) =>
  felder.filter(([k]) => k !== feld);

beforeEach(() => {
  zustand.authorize.mockReset().mockResolvedValue(undefined);
  zustand.planungsrecht.mockReset().mockResolvedValue({ 'dienstplan.schreiben': true });
  zustand.ausnahme.mockReset().mockResolvedValue({ id: KENNUNG });
  zustand.turnus.mockReset().mockResolvedValue({
    planungsserieId: KENNUNG, traegerId: KENNUNG, bestandSchon: false, erzeugt: 8,
    aktualisiert: 0, uebersprungen: [], generiertBis: '2026-11-26',
  });
});

describe('POST /api/reinigung/turnus (Ausnahme) — der Grund geht aufs Turnusblatt', () => {
  it.each([
    ['datum_ungueltig'], ['art_ungueltig'], ['grund_fehlt'], ['ersatzbeginn_ungueltig'],
    ['ersatzbeginn_fehlt'], ['dauer_ungueltig'],
  ] as const)('%s → `turnus/<id>?fehler=%s`', async (grund) => {
    zustand.ausnahme.mockRejectedValue(new AusnahmeEingabeFehlt('Ein Satz.', grund));
    const ziel = rueckweg(await POST(formular('/api/reinigung/turnus', AUSNAHME)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${LISTE}/${KENNUNG}?fehler=${grund}`);
  });

  it('ein unbekannter Turnus → `?fehler=turnus_unbekannt` — seine Kennung steht nur im Pfad', async () => {
    zustand.ausnahme.mockRejectedValue(new TurnusNichtGefunden(KENNUNG));
    const ziel = rueckweg(await POST(formular('/api/reinigung/turnus', AUSNAHME)));
    expect(ziel.search).toBe('?fehler=turnus_unbekannt');
  });

  it('die Gründe der Route: Pflichtangaben, unbekannte Art', async () => {
    expect(rueckweg(await POST(formular('/api/reinigung/turnus', ohne(AUSNAHME, 'grund')))).search)
      .toBe('?fehler=ausnahme_unvollstaendig');
    const art = [...ohne(AUSNAHME, 'ausnahme_art'), ['ausnahme_art', 'feiertag']] as const;
    expect(rueckweg(await POST(formular('/api/reinigung/turnus', art))).search)
      .toBe('?fehler=art_ungueltig');
    expect(zustand.ausnahme).not.toHaveBeenCalled();
  });

  it('der Erfolg bleibt der Schlüssel `?ausnahme=1`', async () => {
    const ziel = rueckweg(await POST(formular('/api/reinigung/turnus', AUSNAHME)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${LISTE}/${KENNUNG}?ausnahme=1`);
  });
});

describe('POST /api/reinigung/turnus (Anlage) — der Grund geht auf /turnus/neu', () => {
  it.each(SERIE_REGEL_GRUENDE)('%s → `neu?fehler=%s`, ohne die Eingabe', async (grund) => {
    zustand.turnus.mockRejectedValue(new SerieEingabeFehlt('"Montag" ist kein Wochentag.', grund));
    const ziel = rueckweg(await POST(formular('/api/reinigung/turnus', TURNUS)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${LISTE}/neu?fehler=${grund}`);
    expect(decodeURIComponent(ziel.search)).not.toContain('Montag');
  });

  it('die Gründe der Route: Pflichtangaben, kein Planungsrecht', async () => {
    expect(rueckweg(await POST(formular('/api/reinigung/turnus', ohne(TURNUS, 'beginn')))).search)
      .toBe('?fehler=turnus_unvollstaendig');
    zustand.planungsrecht.mockResolvedValue({ 'dienstplan.schreiben': false });
    expect(rueckweg(await POST(formular('/api/reinigung/turnus', TURNUS))).search)
      .toBe('?fehler=kein_planungsrecht');
    expect(zustand.turnus).not.toHaveBeenCalled();
  });

  it('der Erfolg führt auf die Liste — mit Anzahl und Schlüsseln, ohne Satz und ohne Kennung', async () => {
    const ziel = rueckweg(await POST(formular('/api/reinigung/turnus', TURNUS)));
    /* VORHER `?angelegt=<Kennung der Serie>` — die Liste fragt nur, ob angelegt wurde. */
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${LISTE}?angelegt=1&erzeugt=8`);

    zustand.turnus.mockResolvedValue({
      planungsserieId: KENNUNG, traegerId: KENNUNG, bestandSchon: true, erzeugt: 0,
      aktualisiert: 0, uebersprungen: [{ quellSchluessel: '-', grund: 'objekt_ohne_kunde' }],
      generiertBis: null,
    });
    const leer = rueckweg(await POST(formular('/api/reinigung/turnus', TURNUS)));
    expect(leer.search).toBe('?angelegt=1&erzeugt=0&bestand=1&uebersprungen=objekt_ohne_kunde');
  });
});

describe('POST /api/reinigung/turnus — Anmeldung und Recht zuerst', () => {
  it('JSON wie bisher: unbekannte Art, fremder Ursprung', async () => {
    const r = await POST(formular('/api/reinigung/turnus', ohne(TURNUS, 'art')));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ fehler: 'art_unbekannt' });
    const r2 = await POST(fremdesFormular('/api/reinigung/turnus', TURNUS));
    expect(r2.status).toBe(403);
    expect(await r2.json()).toEqual({ fehler: 'fremder_ursprung' });
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — VORHER „Nicht gefunden" auf der Seite (AUT-06)', async () => {
    const leer = await nichtGefundenAntwort().text();
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('reinigung.schreiben fehlt'));
    for (const felder of [AUSNAHME, TURNUS]) {
      const r = await POST(formular('/api/reinigung/turnus', felder));
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(leer);
    }
  });

  it('ohne zweiten Faktor geht es auf den Faktor-Schritt — nie auf den Rückweg (D-766)', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await POST(formular('/api/reinigung/turnus', AUSNAHME));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ziel.searchParams.get('fehler')).toBeNull();
  });
});

describe('die Sätze der beiden Turnusseiten', () => {
  it('jede Fehlerklasse der Route trägt einen Grund, den ihre Seite kennt', () => {
    expect(TURNUS_AUSNAHME_GRUENDE).toContain(new TurnusNichtGefunden(KENNUNG).grund);
    expect(TURNUS_AUSNAHME_GRUENDE).toContain(new AusnahmeEingabeFehlt('x', 'grund_fehlt').grund);
    for (const g of SERIE_REGEL_GRUENDE) expect(TURNUS_ANLAGE_GRUENDE).toContain(g);
  });

  it('jeder Grund hat einen Satz — deutsch, wie die Seiten', () => {
    pruefeSaetze(TURNUS_AUSNAHME_TEXTE, TURNUS_AUSNAHME_GRUENDE);
    pruefeSaetze(TURNUS_ANLAGE_TEXTE, TURNUS_ANLAGE_GRUENDE);
  });

  it('das Turnusblatt zeigt den Grund nicht mehr roh — es schlägt nach', () => {
    pruefeSeite('src/app/portal/[mandant]/reinigung/turnus/[id]/page.tsx', [
      'eigenerEintrag(tA.fehler, fehler) ?? tA.sonst', 'rolle="alert"', 'rolle="status"',
    ]);
  });

  it('/turnus/neu schlägt Anker UND Anlage nach — sonst den allgemeinen Satz', () => {
    pruefeSeite('src/app/portal/[mandant]/reinigung/turnus/neu/page.tsx', [
      'eigenerEintrag(tL.fehler, fehlerAusApi)', 'eigenerEintrag(tA.fehler, fehlerAusApi) ?? tA.sonst',
      'rolle="alert"',
    ]);
  });
});
