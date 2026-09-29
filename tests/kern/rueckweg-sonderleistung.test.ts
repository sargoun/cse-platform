/**
 * `POST /api/reinigung/sonderleistungen` schickt Erfolg und Abweisung als
 * SCHLÜSSEL zurück — nie als Satz, nie mit Kennung, und nie an Stelle der
 * Anmeldung oder der 404 (V-275, D-773, D-769, D-766, AUT-06).
 *
 * **Der Befund.** Die Route schrieb den Erfolgssatz in `?ok=` („Der Abruf
 * steht jetzt auf „Erbracht" (vorher „Geplant")") und den Satz jedes Fehlers
 * mit `status`/`code` in `?fehler=` (bei einem unbekannten Abruf mit dessen
 * Kennung); `/reinigung/sonderleistungen` zeigte beide roh, und jeder
 * präparierte Link schrieb seine eigene grüne oder gelbe Meldung. Und die
 * Weiche ersetzte JEDE Antwort von `alsAntwort` mit Meldung durch den
 * Rückweg: ein fehlendes Recht wurde „Nicht gespeichert. Nicht gefunden"
 * über der Liste statt der byte-gleichen 404.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienst), die Tabelle der Sätze und am Quelltext, dass die Seite nachschlägt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NichtGefundenFehler, ZweiterFaktorFehler } from '../../src/server/auth/fehler.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { SONDERLEISTUNG_TEXTE } from '../../src/lib/i18n/verwaltung/reinigung.js';
import {
  formular, fremdesFormular, KENNUNG, pruefeSaetze, pruefeSeite, rueckweg, SITZUNG,
} from './hilfen/rueckweg-betrieb.js';

const zustand = vi.hoisted(() => ({
  authorize: vi.fn(),
  abfrage: vi.fn(),
  erfasse: vi.fn(),
  status: vi.fn(),
  storno: vi.fn(),
  zeitwert: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(SITZUNG),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: zustand.abfrage }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/reinigung/sonderleistung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  erfasseAbruf: zustand.erfasse,
  setzeStatus: zustand.status,
  storniereAbruf: zustand.storno,
  setzeZeitwert: zustand.zeitwert,
}));

const {
  AbrufEingabeFehlt, AbrufNichtGefunden, SONDERLEISTUNG_ERFOLGE, SONDERLEISTUNG_GRUENDE,
  StatusNichtErlaubt, statuswechsel,
} = await import('../../src/server/services/reinigung/sonderleistung.js');
const { POST } = await import('../../src/app/api/reinigung/sonderleistungen/route.js');

const SEITE = '/portal/reinigung/reinigung/sonderleistungen';
const ABRUF = [
  ['mandant', 'reinigung'], ['art', 'abruf'], ['objekt', KENNUNG], ['position', KENNUNG],
  ['bezeichnung', 'Glasreinigung Halle 3'], ['beauftragt_am', '2026-09-28'],
] as const;
const STATUS = [
  ['mandant', 'reinigung'], ['art', 'status'], ['abruf', KENNUNG], ['status', 'erbracht'],
] as const;
const STORNO = [
  ['mandant', 'reinigung'], ['art', 'storno'], ['abruf', KENNUNG], ['grund', 'doppelt erfasst'],
] as const;
const ZEITWERT = [
  ['mandant', 'reinigung'], ['art', 'zeitwert'], ['position', KENNUNG], ['zeitwert', '12,5'],
] as const;
const ohne = (felder: readonly (readonly [string, string])[], feld: string) =>
  felder.filter(([k]) => k !== feld);

beforeEach(() => {
  zustand.authorize.mockReset().mockResolvedValue(undefined);
  zustand.abfrage.mockReset().mockResolvedValue([{ kunde_id: KENNUNG }]);
  zustand.erfasse.mockReset().mockResolvedValue({ id: KENNUNG });
  zustand.status.mockReset().mockResolvedValue({ von: 'geplant', nach: 'erbracht' });
  zustand.storno.mockReset().mockResolvedValue(undefined);
  zustand.zeitwert.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/reinigung/sonderleistungen — Gründe statt Sätze', () => {
  it.each([
    ['bezeichnung_fehlt'], ['beauftragt_am_ungueltig'], ['ausfuehrung_ungueltig'],
    ['ausfuehrung_fenster'], ['menge_ohne_einheit'], ['menge_ungueltig'], ['nicht_angelegt'],
  ] as const)('Abruf erfassen, %s → `?fehler=%s`', async (grund) => {
    zustand.erfasse.mockRejectedValue(new AbrufEingabeFehlt(`Satz mit ${KENNUNG}.`, grund));
    const ziel = rueckweg(await POST(formular('/api/reinigung/sonderleistungen', ABRUF)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${SEITE}?fehler=${grund}`);
  });

  it.each([
    ['status_unveraendert'], ['abgerechnet_unveraenderlich'], ['storniert_endgueltig'],
    ['abgerechnet_nur_rechnung'], ['storno_ueber_status'],
  ] as const)('Zustand setzen, %s → `?fehler=%s` — der Schlüssel aus `statuswechsel`', async (grund) => {
    zustand.status.mockRejectedValue(new StatusNichtErlaubt('Satz „Erbracht".', grund));
    expect(rueckweg(await POST(formular('/api/reinigung/sonderleistungen', STATUS))).search)
      .toBe(`?fehler=${grund}`);
  });

  it('Stornieren: bereits storniert, abgerechnet, Grund fehlt, unbekannter Abruf', async () => {
    for (const [fehler, grund] of [
      [new StatusNichtErlaubt('x', 'bereits_storniert'), 'bereits_storniert'],
      [new StatusNichtErlaubt('x', 'abgerechnet_kein_storno'), 'abgerechnet_kein_storno'],
      [new AbrufEingabeFehlt('x', 'stornogrund_fehlt'), 'stornogrund_fehlt'],
      [new AbrufNichtGefunden(KENNUNG), 'abruf_unbekannt'],
    ] as const) {
      zustand.storno.mockRejectedValueOnce(fehler);
      expect(rueckweg(await POST(formular('/api/reinigung/sonderleistungen', STORNO))).search,
        grund).toBe(`?fehler=${grund}`);
    }
  });

  it('Zeitwert: ungültig, nicht positiv, unbekannte Katalogzeile', async () => {
    for (const [fehler, grund] of [
      [new AbrufEingabeFehlt('x', 'zeitwert_ungueltig'), 'zeitwert_ungueltig'],
      [new AbrufEingabeFehlt('x', 'zeitwert_nicht_positiv'), 'zeitwert_nicht_positiv'],
      [new AbrufNichtGefunden(KENNUNG, 'katalogzeile_unbekannt'), 'katalogzeile_unbekannt'],
    ] as const) {
      zustand.zeitwert.mockRejectedValueOnce(fehler);
      expect(rueckweg(await POST(formular('/api/reinigung/sonderleistungen', ZEITWERT))).search,
        grund).toBe(`?fehler=${grund}`);
    }
  });

  it('die Gründe der Route selbst — ohne den Dienst zu rufen', async () => {
    const faelle: readonly [readonly (readonly [string, string])[], string][] = [
      [ohne(ZEITWERT, 'position'), 'position_fehlt'],
      [ohne(STATUS, 'status'), 'zustand_unvollstaendig'],
      [ohne(STORNO, 'grund'), 'storno_unvollstaendig'],
      [ohne(ABRUF, 'bezeichnung'), 'abruf_unvollstaendig'],
    ];
    for (const [felder, grund] of faelle) {
      expect(rueckweg(await POST(formular('/api/reinigung/sonderleistungen', felder))).search,
        grund).toBe(`?fehler=${grund}`);
    }
    zustand.abfrage.mockResolvedValueOnce([]);
    expect(rueckweg(await POST(formular('/api/reinigung/sonderleistungen', ABRUF))).search)
      .toBe('?fehler=objekt_unbekannt');
    zustand.abfrage.mockResolvedValueOnce([{ kunde_id: null }]);
    expect(rueckweg(await POST(formular('/api/reinigung/sonderleistungen', ABRUF))).search)
      .toBe('?fehler=objekt_ohne_kunde');
    expect(zustand.erfasse).not.toHaveBeenCalled();
  });

  it('der Erfolg reist als `?erfolg=<schluessel>` — nicht mehr als `?ok=<Satz>` mit „vorher/jetzt"', async () => {
    for (const [felder, erfolg] of [
      [ABRUF, 'abruf_erfasst'], [STATUS, 'status_gesetzt'],
      [STORNO, 'abruf_storniert'], [ZEITWERT, 'zeitwert_gesetzt'],
    ] as const) {
      const ziel = rueckweg(await POST(formular('/api/reinigung/sonderleistungen', felder)));
      expect(`${ziel.pathname}${ziel.search}`, erfolg).toBe(`${SEITE}?erfolg=${erfolg}`);
    }
  });

  it('JSON wie bisher: unbekannte Art, fremder Ursprung', async () => {
    const r = await POST(formular('/api/reinigung/sonderleistungen', ohne(ABRUF, 'art')));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ fehler: 'art_unbekannt' });
    const r2 = await POST(fremdesFormular('/api/reinigung/sonderleistungen', ABRUF));
    expect(r2.status).toBe(403);
    expect(await r2.json()).toEqual({ fehler: 'fremder_ursprung' });
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — VORHER „Nicht gefunden" über der Liste (AUT-06)', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('katalog.schreiben fehlt'));
    const r = await POST(formular('/api/reinigung/sonderleistungen', ZEITWERT));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
  });

  it('ohne zweiten Faktor geht es auf den Faktor-Schritt — nie auf den Rückweg (D-766)', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await POST(formular('/api/reinigung/sonderleistungen', ABRUF));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ziel.searchParams.get('fehler')).toBeNull();
  });
});

describe('die Sätze der Sonderleistungen', () => {
  it('jede Abweisung von `statuswechsel` trägt einen Schlüssel, den die Tabelle kennt', () => {
    const alle = ['angefragt', 'beauftragt', 'geplant', 'erbracht', 'abgerechnet', 'storniert'] as const;
    for (const von of alle) {
      for (const nach of alle) {
        const befund = statuswechsel(von, nach);
        if (!befund.erlaubt) expect(SONDERLEISTUNG_GRUENDE, `${von}→${nach}`).toContain(befund.abweisung);
      }
    }
  });

  it('jeder Grund und jeder Erfolg hat einen Satz — deutsch, wie die Seite', () => {
    pruefeSaetze(SONDERLEISTUNG_TEXTE, SONDERLEISTUNG_GRUENDE);
    const t = SONDERLEISTUNG_TEXTE.de;
    for (const e of SONDERLEISTUNG_ERFOLGE) expect(eigenerEintrag(t.erfolg, e), e).toBeTruthy();
    /* Der Zustandswechsel nennt weder „jetzt" noch „vorher" — die Liste zeigt ihn. */
    expect(t.erfolg.status_gesetzt).not.toMatch(/vorher/u);
    for (const fremd of ['__proto__', 'constructor', 'Gespeichert', '']) {
      expect(eigenerEintrag(t.erfolg, fremd), fremd).toBeUndefined();
    }
  });

  it('die Seite liest weder `ok` noch einen Satz — sie schlägt Erfolg und Grund nach', () => {
    pruefeSeite('src/app/portal/[mandant]/reinigung/sonderleistungen/page.tsx', [
      "eigenerEintrag(tS.erfolg, suche['erfolg']) ?? null",
      'eigenerEintrag(tS.fehler, fehler) ?? tS.sonst',
      'rolle="status"', 'rolle="alert"',
    ]);
  });
});
