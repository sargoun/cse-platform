/**
 * `POST /api/bau/projekte` schickt ein abgewiesenes Bauvorhaben als GRUND
 * zurück aufs Formular — nie als Satz des Dienstes, nie mit der Nummer des
 * Auftrags (V-275, D-773, D-769).
 *
 * **Der Befund.** Die Route schrieb `(fehler as Error).message` als
 * `?meldung=` in die Adresse, und `/bau/projekte/neu` zeigte den Text roh in
 * einem Warnkasten ohne `role` — deutsch auch in einer englischen Sitzung,
 * mit der Auftragsnummer und der Zahl offener Nachträge im Satz, und jeder
 * präparierte Link schrieb seine eigene Warnung.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienst), die Tabelle der Sätze in beiden Sprachen und am Quelltext, dass die
 * Seite nur nachschlägt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NichtGefundenFehler, ZweiterFaktorFehler } from '../../src/server/auth/fehler.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import { PROJEKT_FEHLER_TEXTE } from '../../src/lib/i18n/verwaltung/bau.js';
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
  bereich: 'bau' as string | null,
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
vi.mock('@/server/services/bau/projekt', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legeProjektAn: zustand.anlegen,
  aendereProjekt: zustand.aendern,
  archiviereProjekt: zustand.archivieren,
}));

const { PROJEKT_GRUENDE, ProjektFehler } = await import('../../src/server/services/bau/projekt.js');
const { POST } = await import('../../src/app/api/bau/projekte/route.js');

const NEU = '/portal/bau/bau/projekte/neu';
const FELDER = [
  ['zurueck', NEU], ['aktion', 'anlegen'], ['auftrag', KENNUNG], ['bezeichnung', 'Dachgeschoss'],
  ['art', 'ausbau'], ['vertragsgrundlage', 'vob_b'],
] as const;
const mit = (feld: string, wert: string | null): readonly (readonly [string, string])[] =>
  (wert === null ? FELDER.filter(([k]) => k !== feld)
    : [...FELDER.filter(([k]) => k !== feld), [feld, wert] as const]);

beforeEach(() => {
  zustand.authorize.mockReset().mockResolvedValue(undefined);
  zustand.anlegen.mockReset().mockResolvedValue({ id: KENNUNG });
  zustand.aendern.mockReset().mockResolvedValue(undefined);
  zustand.archivieren.mockReset().mockResolvedValue(undefined);
  zustand.bereich = 'bau';
});

describe('POST /api/bau/projekte — der Rückweg trägt einen Grund', () => {
  it.each(PROJEKT_GRUENDE)('%s → `neu?fehler=%s`, ohne Satz, ohne Nummer, ohne Kennung', async (grund) => {
    zustand.anlegen.mockRejectedValue(new ProjektFehler(
      `Zu A-2026-0042 gibt es bereits ein Bauprojekt (${KENNUNG}).`, grund, 409));
    const ziel = rueckweg(await POST(formular('/api/bau/projekte', FELDER)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${NEU}?fehler=${grund}`);
    expect(ziel.search).not.toContain('A-2026');
  });

  it('die Gründe der Route selbst: Auftrag fehlt, Ändern und Archivieren ohne Kennung', async () => {
    expect(rueckweg(await POST(formular('/api/bau/projekte', mit('auftrag', null)))).search)
      .toBe('?fehler=auftrag_fehlt');
    for (const aktion of ['aendern', 'archivieren']) {
      expect(rueckweg(await POST(formular('/api/bau/projekte', mit('aktion', aktion)))).search,
        aktion).toBe('?fehler=id_fehlt');
    }
    expect(zustand.anlegen).not.toHaveBeenCalled();
  });

  it('der Erfolg führt ins Leistungsverzeichnis des neuen Vorhabens — ohne Satz', async () => {
    const ziel = rueckweg(await POST(formular('/api/bau/projekte', FELDER)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`/portal/bau/bau/projekte/${KENNUNG}/lv`);
  });

  it('ein Programm ohne `zurueck` bekommt JSON `{ fehler, meldung }` mit Status', async () => {
    zustand.anlegen.mockRejectedValue(new ProjektFehler(
      'Diesen Auftrag gibt es in dieser Gesellschaft nicht.', 'auftrag_unbekannt', 404));
    const r = await POST(formular('/api/bau/projekte', mit('zurueck', null)));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({
      fehler: 'auftrag_unbekannt', meldung: 'Diesen Auftrag gibt es in dieser Gesellschaft nicht.',
    });
  });

  it('JSON wie bisher: ein fremder Ursprung', async () => {
    const r = await POST(fremdesFormular('/api/bau/projekte', FELDER));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ fehler: 'fremder_ursprung' });
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — kein Rückweg (AUT-06)', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('bau.schreiben fehlt'));
    const r = await POST(formular('/api/bau/projekte', FELDER));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
  });

  it('ohne zweiten Faktor geht es auf den Faktor-Schritt — nie auf den Rückweg (D-766)', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await POST(formular('/api/bau/projekte', FELDER));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ziel.searchParams.get('fehler')).toBeNull();
  });
});

describe('die Sätze des Bauvorhabens', () => {
  it('jeder Grund hat in beiden Sprachen einen Satz — ohne Kennung, ohne Schlüssel', () => {
    pruefeSaetze(PROJEKT_FEHLER_TEXTE, PROJEKT_GRUENDE);
  });

  it('die Seite liest `meldung` nicht mehr und schlägt nur nach', () => {
    pruefeSeite('src/app/portal/[mandant]/bau/projekte/neu/page.tsx', [
      'eigenerEintrag(tF.fehler, fehler) ?? tF.sonst', 'rolle="alert"',
      'nachSprache(PROJEKT_FEHLER_TEXTE, zugang.sprache)',
    ]);
    pruefeSeite('src/app/portal/[mandant]/bau/ProjektFormular.tsx', [
      '<input type="hidden" name="zurueck" value={zurueck} />',
    ]);
  });
});

/*
 * **Der Bereich des Erfolgs kommt aus der Sitzung** (V-275 Nachtrag, D-773).
 * Vorher las die Route ihn aus `zurueck` — ein Programm ohne `zurueck`
 * landete nach dem Speichern auf `/portal//bau/projekte/…`. Ein Programm
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
      ['anlegen', `/portal/bau/bau/projekte/${KENNUNG}/lv`],
      ['aendern', `/portal/bau/bau/projekte/${KENNUNG}`],
      ['archivieren', '/portal/bau/bau/projekte'],
    ] as const) {
      const r = await POST(formular('/api/bau/projekte', programm(aktion)));
      expect(r.status, aktion).toBe(303);
      const ziel = new URL(r.headers.get('location') ?? '');
      expect(`${ziel.pathname}${ziel.search}`, aktion).toBe(pfad);
      expect(ziel.pathname, aktion).not.toContain('//');
    }
  });

  it('ein `zurueck` aus einem anderen Bereich bestimmt das Ziel nicht — die Sitzung tut es', async () => {
    const ziel = rueckweg(await POST(formular('/api/bau/projekte',
      mit('zurueck', '/portal/reinigung/bau/projekte/neu'))));
    expect(ziel.pathname).toBe(`/portal/bau/bau/projekte/${KENNUNG}/lv`);
  });

  it('ohne Slug der Sitzung wird nichts geschrieben — die byte-gleiche 404', async () => {
    zustand.bereich = null;
    const r = await POST(formular('/api/bau/projekte', mit('zurueck', null)));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
    expect(zustand.anlegen).not.toHaveBeenCalled();
  });
});
