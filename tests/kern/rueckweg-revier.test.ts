/**
 * `POST /api/reinigung/reviere` schickt ein abgewiesenes Revier als GRUND
 * zurück aufs Formular — nie als Satz des Dienstes (V-275, D-773, D-769).
 *
 * **Der Befund.** Die Route schrieb `(fehler as Error).message` als
 * `?meldung=` in die Adresse, und `/reinigung/reviere/neu` zeigte den Text
 * roh in einem Warnkasten ohne `role` — deutsch auch in einer englischen
 * Sitzung, und jeder präparierte Link schrieb seine eigene Warnung.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienst), die Tabelle der Sätze in beiden Sprachen und am Quelltext, dass die
 * Seite nur nachschlägt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NichtGefundenFehler, ZweiterFaktorFehler } from '../../src/server/auth/fehler.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import { REVIER_FEHLER_TEXTE } from '../../src/lib/i18n/verwaltung/reinigung.js';
import {
  formular, fremdesFormular, KENNUNG, kontextMitBereich,
  pruefeSaetze, pruefeSeite, rueckweg, SITZUNG,
} from './hilfen/rueckweg-betrieb.js';

const zustand = vi.hoisted(() => ({
  authorize: vi.fn(),
  anlegen: vi.fn(),
  aendern: vi.fn(),
  archivieren: vi.fn(),
  /** Der Slug des aktiven Mandanten, den die Mandantenschicht liefert. */
  bereich: 'reinigung' as string | null,
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(SITZUNG),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn(kontextMitBereich(() => zustand.bereich)),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/reinigung/revier', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legeRevierAn: zustand.anlegen,
  aendereRevier: zustand.aendern,
  archiviereRevier: zustand.archivieren,
}));

const { REVIER_GRUENDE, RevierFehler } = await import('../../src/server/services/reinigung/revier.js');
const { POST } = await import('../../src/app/api/reinigung/reviere/route.js');

const NEU = '/portal/reinigung/reinigung/reviere/neu';
const FELDER = [
  ['zurueck', NEU], ['aktion', 'anlegen'], ['objekt', KENNUNG], ['bezeichnung', 'EG Nord'],
  ['sollzeit', '90'],
] as const;
const mit = (feld: string, wert: string | null): readonly (readonly [string, string])[] =>
  (wert === null ? FELDER.filter(([k]) => k !== feld)
    : [...FELDER.filter(([k]) => k !== feld), [feld, wert] as const]);

beforeEach(() => {
  zustand.authorize.mockReset().mockResolvedValue(undefined);
  zustand.anlegen.mockReset().mockResolvedValue({ id: KENNUNG });
  zustand.aendern.mockReset().mockResolvedValue(undefined);
  zustand.archivieren.mockReset().mockResolvedValue(undefined);
  zustand.bereich = 'reinigung';
});

describe('POST /api/reinigung/reviere — der Rückweg trägt einen Grund', () => {
  it.each(REVIER_GRUENDE)('%s → `neu?fehler=%s`, ohne Satz und ohne Kennung', async (grund) => {
    zustand.anlegen.mockRejectedValue(new RevierFehler(`Ein Satz mit ${KENNUNG}.`, grund, 404));
    const ziel = rueckweg(await POST(formular('/api/reinigung/reviere', FELDER)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${NEU}?fehler=${grund}`);
  });

  it('die Gründe der Route selbst: Objekt fehlt, Ändern und Archivieren ohne Kennung', async () => {
    expect(rueckweg(await POST(formular('/api/reinigung/reviere', mit('objekt', null)))).search)
      .toBe('?fehler=objekt_fehlt');
    for (const aktion of ['aendern', 'archivieren']) {
      expect(rueckweg(await POST(formular('/api/reinigung/reviere', mit('aktion', aktion)))).search,
        aktion).toBe('?fehler=id_fehlt');
    }
    expect(zustand.anlegen).not.toHaveBeenCalled();
  });

  it('der Erfolg führt ins Raumbuch des neuen Reviers — ohne Satz in der Adresse', async () => {
    const ziel = rueckweg(await POST(formular('/api/reinigung/reviere', FELDER)));
    expect(`${ziel.pathname}${ziel.search}`)
      .toBe(`/portal/reinigung/reinigung/reviere/${KENNUNG}/raeume`);
  });

  it('ein Programm ohne `zurueck` bekommt JSON `{ fehler, meldung }` mit Status', async () => {
    zustand.anlegen.mockRejectedValue(new RevierFehler(
      'Ein Revier braucht eine Bezeichnung.', 'bezeichnung_fehlt'));
    const r = await POST(formular('/api/reinigung/reviere', mit('zurueck', null)));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      fehler: 'bezeichnung_fehlt', meldung: 'Ein Revier braucht eine Bezeichnung.',
    });
  });

  it('JSON wie bisher: ein fremder Ursprung', async () => {
    const r = await POST(fremdesFormular('/api/reinigung/reviere', FELDER));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ fehler: 'fremder_ursprung' });
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — kein Rückweg (AUT-06)', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('reinigung.schreiben fehlt'));
    const r = await POST(formular('/api/reinigung/reviere', FELDER));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
  });

  it('ohne zweiten Faktor geht es auf den Faktor-Schritt — nie auf den Rückweg (D-766)', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await POST(formular('/api/reinigung/reviere', FELDER));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ziel.searchParams.get('fehler')).toBeNull();
  });
});

describe('die Sätze des Reviers', () => {
  it('jeder Grund hat in beiden Sprachen einen Satz — ohne Kennung, ohne Schlüssel', () => {
    pruefeSaetze(REVIER_FEHLER_TEXTE, REVIER_GRUENDE);
  });

  it('die Seite liest `meldung` nicht mehr und schlägt nur nach', () => {
    pruefeSeite('src/app/portal/[mandant]/reinigung/reviere/neu/page.tsx', [
      'eigenerEintrag(tF.fehler, fehler) ?? tF.sonst', 'rolle="alert"',
      'nachSprache(REVIER_FEHLER_TEXTE, zugang.sprache)',
    ]);
    pruefeSeite('src/app/portal/[mandant]/reinigung/RevierFormular.tsx', [
      '<input type="hidden" name="zurueck" value={zurueck} />',
    ]);
  });
});

/*
 * **Der Bereich des Erfolgs kommt aus der Sitzung** (V-275 Nachtrag, D-773).
 * Vorher las die Route ihn aus `zurueck` — ein Programm ohne `zurueck`
 * landete nach dem Speichern auf `/portal//reinigung/reviere/…`. Ein Programm
 * bekommt weiter, was es bekam: im Erfolg die Umleitung (303), bei einer
 * Abweisung JSON (oben).
 */
describe('der Bereich des Erfolgs kommt aus der Sitzung, nicht aus `zurueck`', () => {
  const programm = (aktion: string): readonly (readonly [string, string])[] => [
    ...FELDER.filter(([k]) => k !== 'zurueck' && k !== 'aktion'),
    ['aktion', aktion], ['id', KENNUNG],
  ];

  it('ein Programm ohne `zurueck`: 303 in den aktiven Bereich — nie `/portal//…`', async () => {
    for (const [aktion, pfad] of [
      ['anlegen', `/portal/reinigung/reinigung/reviere/${KENNUNG}/raeume`],
      ['aendern', `/portal/reinigung/reinigung/reviere/${KENNUNG}`],
      ['archivieren', '/portal/reinigung/reinigung/reviere'],
    ] as const) {
      const r = await POST(formular('/api/reinigung/reviere', programm(aktion)));
      expect(r.status, aktion).toBe(303);
      const ziel = new URL(r.headers.get('location') ?? '');
      expect(`${ziel.pathname}${ziel.search}`, aktion).toBe(pfad);
      expect(ziel.pathname, aktion).not.toContain('//');
    }
  });

  it('ein `zurueck` aus einem anderen Bereich bestimmt das Ziel nicht — die Sitzung tut es', async () => {
    const ziel = rueckweg(await POST(formular('/api/reinigung/reviere',
      mit('zurueck', '/portal/security/reinigung/reviere/neu'))));
    expect(ziel.pathname).toBe(`/portal/reinigung/reinigung/reviere/${KENNUNG}/raeume`);
  });

  it('ohne Slug der Sitzung wird nichts geschrieben — die byte-gleiche 404', async () => {
    zustand.bereich = null;
    const r = await POST(formular('/api/reinigung/reviere', mit('zurueck', null)));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
    expect(zustand.anlegen).not.toHaveBeenCalled();
  });
});
