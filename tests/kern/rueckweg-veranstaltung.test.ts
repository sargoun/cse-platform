/**
 * `POST /api/security/veranstaltungen` schickt eine abgewiesene
 * Veranstaltung als GRUND zurück aufs Formular — nie als Satz des Dienstes
 * (V-275, D-773, D-769).
 *
 * **Der Befund.** Die Route schrieb `(fehler as Error).message` als
 * `?meldung=` in die Adresse, und `/security/veranstaltungen/neu` zeigte den
 * Text roh in einem Warnkasten ohne `role` — deutsch auch in einer englischen
 * Sitzung, und jeder präparierte Link schrieb seine eigene Warnung.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienst), die Tabelle der Sätze in beiden Sprachen und am Quelltext, dass die
 * Seite nur nachschlägt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NichtGefundenFehler, ZweiterFaktorFehler } from '../../src/server/auth/fehler.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import { VERANSTALTUNG_FEHLER_TEXTE } from '../../src/lib/i18n/verwaltung/security.js';
import {
  formular, fremdesFormular, KENNUNG, pruefeSaetze, pruefeSeite, rueckweg, SITZUNG,
} from './hilfen/rueckweg-betrieb.js';

const zustand = vi.hoisted(() => ({
  authorize: vi.fn(),
  anlegen: vi.fn(),
  aendern: vi.fn(),
  archivieren: vi.fn(),
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
vi.mock('@/server/services/security/veranstaltung-anlegen', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legeVeranstaltungAn: zustand.anlegen,
  aendereVeranstaltung: zustand.aendern,
  archiviereVeranstaltung: zustand.archivieren,
}));

const {
  VERANSTALTUNG_GRUENDE, VeranstaltungFehler,
} = await import('../../src/server/services/security/veranstaltung-anlegen.js');
const { POST } = await import('../../src/app/api/security/veranstaltungen/route.js');

const NEU = '/portal/security/security/veranstaltungen/neu';
const FELDER = [
  ['zurueck', NEU], ['aktion', 'anlegen'], ['kunde', KENNUNG], ['bezeichnung', 'Sommerfest'],
  ['beginn', '2026-10-03T18:00'], ['ende', '2026-10-04T02:00'], ['ort_text', 'Festplatz'],
  ['soll_besetzung', '4'],
] as const;
const mit = (feld: string, wert: string | null): readonly (readonly [string, string])[] =>
  (wert === null ? FELDER.filter(([k]) => k !== feld)
    : [...FELDER.filter(([k]) => k !== feld), [feld, wert] as const]);

beforeEach(() => {
  zustand.authorize.mockReset().mockResolvedValue(undefined);
  zustand.anlegen.mockReset().mockResolvedValue({ id: KENNUNG });
  zustand.aendern.mockReset().mockResolvedValue(undefined);
  zustand.archivieren.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/security/veranstaltungen — der Rückweg trägt einen Grund', () => {
  it.each(VERANSTALTUNG_GRUENDE)('%s → `neu?fehler=%s`, ohne Satz und ohne Kennung', async (grund) => {
    zustand.anlegen.mockRejectedValue(new VeranstaltungFehler(
      `Für diese Veranstaltung stehen noch 3 Schicht(en) — ${KENNUNG}.`, grund, 409));
    const ziel = rueckweg(await POST(formular('/api/security/veranstaltungen', FELDER)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${NEU}?fehler=${grund}`);
  });

  it('Ändern und Archivieren ohne Kennung: `id_fehlt` aus der Route selbst', async () => {
    for (const aktion of ['aendern', 'archivieren']) {
      const ziel = rueckweg(await POST(formular('/api/security/veranstaltungen',
        mit('aktion', aktion))));
      expect(ziel.search, aktion).toBe('?fehler=id_fehlt');
    }
    expect(zustand.aendern).not.toHaveBeenCalled();
    expect(zustand.archivieren).not.toHaveBeenCalled();
  });

  it('der Erfolg führt auf das Blatt der neuen Veranstaltung — ohne Satz in der Adresse', async () => {
    const ziel = rueckweg(await POST(formular('/api/security/veranstaltungen', FELDER)));
    expect(`${ziel.pathname}${ziel.search}`)
      .toBe(`/portal/security/security/veranstaltungen/${KENNUNG}`);
  });

  it('ein Programm ohne `zurueck` bekommt JSON `{ fehler, meldung }` mit Status', async () => {
    zustand.anlegen.mockRejectedValue(new VeranstaltungFehler(
      'Eine Veranstaltung braucht eine Bezeichnung.', 'bezeichnung_fehlt'));
    const r = await POST(formular('/api/security/veranstaltungen', mit('zurueck', null)));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      fehler: 'bezeichnung_fehlt', meldung: 'Eine Veranstaltung braucht eine Bezeichnung.',
    });
  });

  it('JSON wie bisher: ein fremder Ursprung', async () => {
    const r = await POST(fremdesFormular('/api/security/veranstaltungen', FELDER));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ fehler: 'fremder_ursprung' });
    expect(zustand.anlegen).not.toHaveBeenCalled();
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — kein Rückweg (AUT-06)', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('security.schreiben fehlt'));
    const r = await POST(formular('/api/security/veranstaltungen', FELDER));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
  });

  it('ohne zweiten Faktor geht es auf den Faktor-Schritt — nie auf den Rückweg (D-766)', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await POST(formular('/api/security/veranstaltungen', FELDER));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ziel.searchParams.get('fehler')).toBeNull();
  });
});

describe('die Sätze der Veranstaltung', () => {
  it('jeder Grund hat in beiden Sprachen einen Satz — ohne Kennung, ohne Schlüssel', () => {
    pruefeSaetze(VERANSTALTUNG_FEHLER_TEXTE, VERANSTALTUNG_GRUENDE);
  });

  it('die Seite liest `meldung` nicht mehr und schlägt nur nach', () => {
    pruefeSeite('src/app/portal/[mandant]/security/veranstaltungen/neu/page.tsx', [
      'eigenerEintrag(tF.fehler, fehler) ?? tF.sonst', 'rolle="alert"',
      'nachSprache(VERANSTALTUNG_FEHLER_TEXTE, zugang.sprache)',
    ]);
    /* Das Formular schickt `zurueck` auf genau diese Seite. */
    pruefeSeite('src/app/portal/[mandant]/security/VeranstaltungFormular.tsx', [
      '<input type="hidden" name="zurueck" value={zurueck} />',
    ]);
  });
});
