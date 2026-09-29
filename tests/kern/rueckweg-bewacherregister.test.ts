/**
 * `POST /api/security/bewacherregister` schickt Erfolg und Abweisung als
 * SCHLÜSSEL zurück auf die Liste — nie als Satz, nie mit Kennung, und nie an
 * Stelle der Anmeldung (V-275, D-773, D-769, D-766).
 *
 * **Der Befund.** Die Route schrieb den Erfolgssatz in `?ok=` und den Satz
 * jedes Fehlers mit `status`/`code` in `?fehler=`; `/security/bewacherregister`
 * zeigte beide roh — bei einem unbekannten Eintrag mit dessen voller
 * Kennung, und jeder präparierte Link schrieb seine eigene grüne oder gelbe
 * Meldung. Und die Weiche ersetzte JEDE Antwort von `alsAntwort` mit einer
 * Meldung durch den Rückweg: ohne zweiten Faktor stand „Zweiter Faktor
 * erforderlich" über der Liste, statt dass es auf den Faktor-Schritt ging.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienst), die Tabelle der Sätze und am Quelltext, dass die Seite nachschlägt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NichtGefundenFehler, ZweiterFaktorFehler } from '../../src/server/auth/fehler.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { BEWACHERREGISTER_TEXTE } from '../../src/lib/i18n/verwaltung/security.js';
import {
  formular, fremdesFormular, KENNUNG, kontextMitBereich, lies,
  pruefeSaetze, pruefeSeite, rueckweg, SITZUNG,
} from './hilfen/rueckweg-betrieb.js';

const zustand = vi.hoisted(() => ({
  authorize: vi.fn(),
  gebucht: vi.fn(),
  erfasse: vi.fn(),
  aktualisiere: vi.fn(),
  /** Der Slug des aktiven Mandanten, den die Mandantenschicht liefert. */
  bereich: 'security' as string | null,
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
vi.mock('@/server/services/security/bewacherregister', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  securityGebucht: zustand.gebucht,
  erfasseEintrag: zustand.erfasse,
  aktualisiereEintrag: zustand.aktualisiere,
}));

const {
  BEWACHER_ERFOLGE, BEWACHER_GRUENDE, BewacherEingabeFehlt, EintragNichtGefunden,
} = await import('../../src/server/services/security/bewacherregister.js');
const { POST } = await import('../../src/app/api/security/bewacherregister/route.js');

const LISTE = '/portal/security/security/bewacherregister';
const ERFASSEN = [
  ['art', 'erfassen'], ['person', KENNUNG], ['bewacher_id', 'B-123'], ['status', 'registriert'],
] as const;
const AENDERN = [...ERFASSEN.filter(([k]) => k !== 'art'), ['art', 'aendern'],
  ['eintrag', KENNUNG]] as const;

beforeEach(() => {
  zustand.authorize.mockReset().mockResolvedValue(undefined);
  zustand.gebucht.mockReset().mockResolvedValue(true);
  zustand.erfasse.mockReset().mockResolvedValue({ id: KENNUNG });
  zustand.aktualisiere.mockReset().mockResolvedValue(undefined);
  zustand.bereich = 'security';
});

describe('POST /api/security/bewacherregister — Schlüssel statt Sätze', () => {
  it.each([
    ['bewacher_id_ungueltig'], ['status_unbekannt'], ['datum_ungueltig'],
    ['zeitraum_ungueltig'], ['nicht_angelegt'],
  ] as const)('der Dienst weist ab, %s → `?fehler=%s`', async (grund) => {
    zustand.erfasse.mockRejectedValue(new BewacherEingabeFehlt(`Satz mit ${KENNUNG}.`, grund));
    const ziel = rueckweg(await POST(formular('/api/security/bewacherregister', ERFASSEN)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${LISTE}?fehler=${grund}`);
  });

  it('ein unbekannter Eintrag → `?fehler=eintrag_unbekannt` — ohne seine Kennung', async () => {
    zustand.aktualisiere.mockRejectedValue(new EintragNichtGefunden(`den Eintrag ${KENNUNG}`));
    const ziel = rueckweg(await POST(formular('/api/security/bewacherregister', AENDERN)));
    expect(`${ziel.pathname}${ziel.search}`).toBe(`${LISTE}?fehler=eintrag_unbekannt`);
  });

  it('die zwei Gründe der Route: Pflichtangaben fehlen, Eintrag fehlt', async () => {
    const ohneStatus = ERFASSEN.filter(([k]) => k !== 'status');
    expect(rueckweg(await POST(formular('/api/security/bewacherregister', ohneStatus))).search)
      .toBe('?fehler=pflichtangaben_fehlen');
    const ohneEintrag = AENDERN.filter(([k]) => k !== 'eintrag');
    expect(rueckweg(await POST(formular('/api/security/bewacherregister', ohneEintrag))).search)
      .toBe('?fehler=eintrag_fehlt');
    expect(zustand.erfasse).not.toHaveBeenCalled();
    expect(zustand.aktualisiere).not.toHaveBeenCalled();
  });

  it('ein Fehler ohne eigenen Grund reist mit seinem `code`', async () => {
    zustand.erfasse.mockRejectedValue(Object.assign(
      new Error(`irgendein Satz mit Kennung ${KENNUNG}`), { code: 'ungueltiger_zustand', status: 409 }));
    const ziel = rueckweg(await POST(formular('/api/security/bewacherregister', ERFASSEN)));
    expect(ziel.search).toBe('?fehler=ungueltiger_zustand');
  });

  it('der Erfolg reist als `?erfolg=erfasst|fortgeschrieben` — nicht mehr als `?ok=<Satz>`', async () => {
    const erfasst = rueckweg(await POST(formular('/api/security/bewacherregister', ERFASSEN)));
    expect(`${erfasst.pathname}${erfasst.search}`).toBe(`${LISTE}?erfolg=erfasst`);
    const fort = rueckweg(await POST(formular('/api/security/bewacherregister', AENDERN)));
    expect(fort.search).toBe('?erfolg=fortgeschrieben');
    expect(fort.searchParams.get('ok')).toBeNull();
  });

  it('JSON wie bisher: unbekannte Art, fremder Ursprung', async () => {
    const r = await POST(formular('/api/security/bewacherregister',
      ERFASSEN.filter(([k]) => k !== 'art')));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ fehler: 'art_unbekannt' });
    const r2 = await POST(fremdesFormular('/api/security/bewacherregister', ERFASSEN));
    expect(r2.status).toBe(403);
    expect(await r2.json()).toEqual({ fehler: 'fremder_ursprung' });
  });

  it('ein fehlendes Recht und ein nicht gebuchtes Modul sind die byte-gleiche 404 (AUT-06)', async () => {
    const leer = await nichtGefundenAntwort().text();
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht fehlt'));
    const r = await POST(formular('/api/security/bewacherregister', ERFASSEN));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(leer);

    zustand.authorize.mockResolvedValue(undefined);
    zustand.gebucht.mockResolvedValue(false);
    const r2 = await POST(formular('/api/security/bewacherregister', ERFASSEN));
    expect(r2.status).toBe(404);
    expect(await r2.text()).toBe(leer);
  });

  it('ohne zweiten Faktor geht es auf den Faktor-Schritt — VORHER stand der Satz über der Liste (D-766)', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const r = await POST(formular('/api/security/bewacherregister', ERFASSEN));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ziel.searchParams.get('fehler')).toBeNull();
  });
});

describe('die Sätze des Bewacherregisters', () => {
  it('jede Fehlerklasse trägt einen Grund, den die Tabelle kennt', () => {
    for (const f of [new EintragNichtGefunden('x'), new BewacherEingabeFehlt('x', 'datum_ungueltig')]) {
      expect(BEWACHER_GRUENDE, f.name).toContain(f.grund);
    }
  });

  it('jeder Grund und jeder Erfolg hat einen Satz — deutsch, wie die Seite', () => {
    pruefeSaetze(BEWACHERREGISTER_TEXTE, BEWACHER_GRUENDE);
    const t = BEWACHERREGISTER_TEXTE.de;
    expect(t.gespeichert.trim()).not.toBe('');
    for (const e of BEWACHER_ERFOLGE) expect(eigenerEintrag(t.erfolg, e), e).toBeTruthy();
    for (const fremd of ['__proto__', 'constructor', 'Gespeichert', '']) {
      expect(eigenerEintrag(t.erfolg, fremd), fremd).toBeUndefined();
    }
  });

  it('die Seite liest weder `ok` noch einen Satz — sie schlägt Erfolg und Grund nach', () => {
    pruefeSeite('src/app/portal/[mandant]/security/bewacherregister/page.tsx', [
      "eigenerEintrag(tR.erfolg, suche['erfolg']) ?? null",
      'eigenerEintrag(tR.fehler, fehler) ?? tR.sonst',
      'rolle="status"', 'rolle="alert"',
    ]);
  });
});

/*
 * **Der Bereich kommt aus der Sitzung** (V-275 Nachtrag, D-773;
 * Invariante 3). Vorher las die Route das Formularfeld `mandant`: ohne das
 * Feld ging es auf `/portal//security/bewacherregister`, mit einem fremden Slug in dessen
 * Bereich — im Erfolg wie mit einer Abweisung. Die Route unterscheidet kein
 * Programm von einem Formular: beide bekommen die Umleitung.
 */
describe('die Liste liegt im Bereich der Sitzung — nicht in dem aus dem Formular', () => {
  const mitFeld = (slug: string) => [['mandant', slug] as const, ...ERFASSEN];

  it('ohne Feld `mandant`: Erfolg und Abweisung gehen auf die Liste des aktiven Bereichs', async () => {
    const erfolg = rueckweg(await POST(formular('/api/security/bewacherregister', ERFASSEN)));
    expect(`${erfolg.pathname}${erfolg.search}`).toBe(`${LISTE}?erfolg=erfasst`);
    zustand.erfasse.mockRejectedValue(new BewacherEingabeFehlt('x', 'datum_ungueltig'));
    const fehler = rueckweg(await POST(formular('/api/security/bewacherregister', ERFASSEN)));
    expect(`${fehler.pathname}${fehler.search}`).toBe(`${LISTE}?fehler=datum_ungueltig`);
  });

  it('ein fremder Slug im Feld `mandant` ändert das Ziel nicht — weder im Erfolg noch im Fehler', async () => {
    for (const fremd of ['reinigung', 'bau', 'operations', '']) {
      const erfolg = rueckweg(await POST(formular('/api/security/bewacherregister', mitFeld(fremd))));
      expect(`${erfolg.pathname}${erfolg.search}`, fremd).toBe(`${LISTE}?erfolg=erfasst`);
    }
    zustand.erfasse.mockRejectedValue(new BewacherEingabeFehlt('x', 'status_unbekannt'));
    const fehler = rueckweg(await POST(formular('/api/security/bewacherregister', mitFeld('bau'))));
    expect(`${fehler.pathname}${fehler.search}`).toBe(`${LISTE}?fehler=status_unbekannt`);
  });

  it('der Bereich folgt dem aktiven Mandanten', async () => {
    zustand.bereich = 'wache-ost';
    const ziel = rueckweg(await POST(formular('/api/security/bewacherregister', mitFeld('security'))));
    expect(ziel.pathname).toBe('/portal/wache-ost/security/bewacherregister');
  });

  it('ohne Slug der Sitzung wird nichts geschrieben — die byte-gleiche 404', async () => {
    zustand.bereich = null;
    const r = await POST(formular('/api/security/bewacherregister', ERFASSEN));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
    expect(zustand.erfasse).not.toHaveBeenCalled();
  });

  it('das Formular schickt kein Feld `mandant` mehr, die Route liest keines', () => {
    expect(lies('src/app/portal/[mandant]/security/bewacherregister/page.tsx'))
      .not.toContain('name="mandant"');
    expect(lies('src/app/api/security/bewacherregister/route.ts')).not.toContain("'mandant'");
  });
});
