/**
 * `POST /api/zeit/nacherfassung` schickt eine abgewiesene Nacherfassung als
 * GRUND zurück — nie als Satz des Dienstes (V-275, D-773, D-769).
 *
 * **Der Befund.** Die Route schrieb `(fehler as Error).message` als
 * `?meldung=` in die Adresse, und `/zeiten/nacherfassung` zeigte den Text roh
 * in einem Warnkasten — jeder präparierte Link schrieb dort seine eigene
 * Warnung, und der Kasten stand in einem zugeklappten Bereich, den niemand
 * aufmachte. Dieselbe Seite liest `?fehler=` schon für die Ansprüche aus
 * `api/offline-ereignis/[id]`; das freie Formular trägt deshalb `?frei=1` in
 * seinem `zurueck`, damit sein Satz in seinem Kasten steht.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienst), die Tabelle der Sätze und am Quelltext, dass die Seite nachschlägt.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NichtGefundenFehler, ZweiterFaktorFehler } from '../../src/server/auth/fehler.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import { NACHERFASSUNG_FEHLER_TEXTE } from '../../src/lib/i18n/verwaltung/zeit.js';
import {
  formular, KENNUNG, pruefeSaetze, pruefeSeite, rueckweg, SITZUNG, WURZEL,
} from './hilfen/rueckweg-betrieb.js';

const zustand = vi.hoisted(() => ({
  authorize: vi.fn(),
  erfasse: vi.fn(),
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
vi.mock('@/server/services/zeit/nacherfassung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  erfasseZeitNach: zustand.erfasse,
}));

const {
  NACHERFASSUNG_GRUENDE, NacherfassungFehler,
} = await import('../../src/server/services/zeit/nacherfassung.js');
const { POST } = await import('../../src/app/api/zeit/nacherfassung/route.js');

const SEITE = '/portal/reinigung/zeiten/nacherfassung';
const NEU = '7d2f6c1e-0a41-4c55-9d1c-1c2f3b4a5d70';
const FELDER = [
  ['zurueck', `${SEITE}?frei=1`], ['anstellung', KENNUNG], ['beginn', '2026-09-28T06:00'],
  ['ende', '2026-09-28T14:00'], ['pause', '30'], ['begruendung', 'Einwand anerkannt, laut Objektleitung'],
] as const;
const ohne = (feld: string): readonly (readonly [string, string])[] =>
  FELDER.filter(([k]) => k !== feld);

beforeEach(() => {
  zustand.authorize.mockReset().mockResolvedValue(undefined);
  zustand.erfasse.mockReset().mockResolvedValue({ id: NEU });
});

describe('POST /api/zeit/nacherfassung — der Rückweg trägt einen Grund', () => {
  it.each(NACHERFASSUNG_GRUENDE)('%s → `?frei=1&fehler=%s`', async (grund) => {
    zustand.erfasse.mockRejectedValue(new NacherfassungFehler(
      `Ein Satz mit der Kennung ${KENNUNG}.`, grund, 409));
    const ziel = rueckweg(await POST(formular('/api/zeit/nacherfassung', FELDER)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${SEITE}?frei=1&fehler=${grund}`);
  });

  it('der Erfolg führt auf den neuen Eintrag — ohne Satz in der Adresse', async () => {
    const ziel = rueckweg(await POST(formular('/api/zeit/nacherfassung', FELDER)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`/portal/reinigung/zeiten/${NEU}`);
  });

  it('ein Programm ohne `zurueck` bekommt JSON `{ fehler, meldung }` mit Status', async () => {
    zustand.erfasse.mockRejectedValue(new NacherfassungFehler(
      'Das ist Ihre eigene Arbeitszeit.', 'nicht_selbst', 409));
    const r = await POST(formular('/api/zeit/nacherfassung', ohne('zurueck')));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      fehler: 'nicht_selbst', meldung: 'Das ist Ihre eigene Arbeitszeit.',
    });
  });

  it('JSON wie bisher: ohne Beschäftigung, ohne Beginn, unbrauchbares Ende', async () => {
    for (const [felder, fehler] of [
      [ohne('anstellung'), 'keine_anstellung'],
      [ohne('beginn'), 'kein_beginn'],
      [FELDER.map(([k, v]) => (k === 'ende' ? [k, 'morgen'] as const : [k, v] as const)),
        'ende_unbrauchbar'],
    ] as const) {
      const r = await POST(formular('/api/zeit/nacherfassung', felder));
      expect(r.status, fehler).toBe(400);
      expect(await r.json(), fehler).toEqual({ fehler });
    }
    expect(zustand.erfasse).not.toHaveBeenCalled();
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — kein Rückweg (AUT-06)', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht fehlt'));
    const r = await POST(formular('/api/zeit/nacherfassung', FELDER));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
  });

  it('ohne zweiten Faktor geht es auf den Faktor-Schritt — nie auf den Rückweg (D-766)', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await POST(formular('/api/zeit/nacherfassung', FELDER));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ziel.searchParams.get('fehler')).toBeNull();
  });
});

describe('die Sätze der Nacherfassung', () => {
  it('jeder Grund des Dienstes hat einen Satz — deutsch, wie die Seite', () => {
    pruefeSaetze(NACHERFASSUNG_FEHLER_TEXTE, NACHERFASSUNG_GRUENDE);
  });

  it('die Seite liest `meldung` nicht mehr, schlägt nach und trennt die zwei Formulare', () => {
    const pfad = 'src/app/portal/[mandant]/zeiten/nacherfassung/page.tsx';
    pruefeSeite(pfad, [
      'eigenerEintrag(tN.fehler, fehler) ?? tN.sonst', 'rolle="alert"',
      "frage['frei'] === '1'", 'value={`${pfad}?frei=1`}',
      'eigenerEintrag(ANSPRUCH_FEHLER, anspruchFehler)',
    ]);
    const quelle = readFileSync(resolve(WURZEL, pfad), 'utf8');
    /* Der Kasten der Ansprüche meldet sich jetzt auch an (DESIGN §9). */
    expect(quelle).toMatch(/data-cse="anspruch-fehler"\s+role="alert"/u);
    expect(quelle).toMatch(/data-cse="anspruch-erledigt"\s+role="status"/u);
  });
});
