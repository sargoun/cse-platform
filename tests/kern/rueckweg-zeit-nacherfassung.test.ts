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
  formular, HIER, KENNUNG, kontextMitBereich,
  pruefeSaetze, pruefeSeite, rueckweg, SITZUNG, WURZEL,
} from './hilfen/rueckweg-betrieb.js';
import {
  freieVorgaben, freiesZurueck, vorbelegteAnstellung,
} from '../../src/app/portal/[mandant]/zeiten/nacherfassung/vorgaben.js';

const zustand = vi.hoisted(() => ({
  authorize: vi.fn(),
  erfasse: vi.fn(),
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
  zustand.bereich = 'reinigung';
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
      "frage['frei'] === '1'", 'value={freiesZurueck(pfad, vorgaben)}',
      'eigenerEintrag(ANSPRUCH_FEHLER, anspruchFehler)',
    ]);
    const quelle = readFileSync(resolve(WURZEL, pfad), 'utf8');
    /* Der Kasten der Ansprüche meldet sich jetzt auch an (DESIGN §9). */
    expect(quelle).toMatch(/data-cse="anspruch-fehler"\s+role="alert"/u);
    expect(quelle).toMatch(/data-cse="anspruch-erledigt"\s+role="status"/u);
  });
});

/*
 * **Aus einem Einwand** (V-275 Nachtrag, D-773): `?anstellung=&einwand=`
 * belegt die Person vor und hängt den Einwand an. Nach einer Abweisung
 * waren beide weg — der Rückweg war nur `?frei=1&fehler=<grund>`. Jetzt
 * trägt das `zurueck` des freien Formulars die GEPRÜFTEN Kennungen mit,
 * und nur sie: kein Text aus der Adresse, keine Zeit, keine Begründung.
 */
describe('aus dem Einwand: der Rückweg trägt die geprüften Kennungen weiter', () => {
  const EINWAND = '9c4e2a1b-3d5f-4a6b-8c7d-0e1f2a3b4c5d';
  /** Eine präparierte Adresse, wie Next.js sie der Seite als `searchParams` gibt. */
  const adresse = (suche: string): Record<string, string> =>
    Object.fromEntries(new URLSearchParams(suche));

  it('zwei Kennungen: Vorbelegung, Einwand und `zurueck` tragen sie', () => {
    const v = freieVorgaben(adresse(`anstellung=${KENNUNG}&einwand=${EINWAND}`));
    expect(v).toEqual({ anstellung: KENNUNG, einwand: EINWAND });
    expect(freiesZurueck(SEITE, v))
      .toBe(`${SEITE}?frei=1&anstellung=${KENNUNG}&einwand=${EINWAND}`);
  });

  it('ohne Einwand bleibt das `zurueck` wie bisher: `?frei=1`', () => {
    expect(freiesZurueck(SEITE, freieVorgaben(adresse('')))).toBe(`${SEITE}?frei=1`);
    expect(freiesZurueck(SEITE, freieVorgaben(adresse(`anstellung=${KENNUNG}`))))
      .toBe(`${SEITE}?frei=1&anstellung=${KENNUNG}`);
  });

  it.each([
    'Ihr Vertrag ist gekündigt', '<script>alert(1)</script>', '__proto__',
    `${KENNUNG} oder 1=1`, `${KENNUNG}&fehler=nicht_selbst`, `x${KENNUNG}`, '',
  ])('präpariert: %s → fällt weg, bevor es vorbelegt oder weitergetragen wird', (fremd) => {
    const suche = `anstellung=${encodeURIComponent(fremd)}&einwand=${encodeURIComponent(fremd)}`;
    const v = freieVorgaben(adresse(suche));
    expect(v).toEqual({ anstellung: null, einwand: null });
    expect(freiesZurueck(SEITE, v)).toBe(`${SEITE}?frei=1`);
  });

  it('eine Kennung und ein Text: nur die Kennung reist mit', () => {
    const v = freieVorgaben(adresse(
      `anstellung=${KENNUNG}&einwand=${encodeURIComponent('Bitte sofort buchen')}`));
    expect(freiesZurueck(SEITE, v)).toBe(`${SEITE}?frei=1&anstellung=${KENNUNG}`);
  });

  it('die Route hängt an diesen Rückweg nur den Grund — die Kennungen bleiben', async () => {
    zustand.erfasse.mockRejectedValue(new NacherfassungFehler(
      'Die Begründung ist zu kurz.', 'begruendung_zu_kurz', 422));
    const zurueck = freiesZurueck(SEITE, freieVorgaben(adresse(
      `anstellung=${KENNUNG}&einwand=${EINWAND}`)));
    const r = await POST(formular('/api/zeit/nacherfassung',
      [['zurueck', zurueck], ['einwand', EINWAND], ...ohne('zurueck')]));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(ziel.origin).toBe(HIER);
    expect(`${ziel.pathname}${ziel.search}`).toBe(
      `${SEITE}?frei=1&anstellung=${KENNUNG}&einwand=${EINWAND}&fehler=begruendung_zu_kurz`);
    /* Kein Satz reist mit: nur Kennungen und der Grund. */
    expect(decodeURIComponent(ziel.search)).not.toMatch(/\s|meldung=/u);
    /*
     * Die Seite liest diese Adresse wieder: Person und Einwand stehen da, und
     * ein zweiter Versuch geht mit demselben `zurueck` — auch nach der
     * zweiten Abweisung wächst die Adresse nicht.
     */
    const wieder = freieVorgaben(Object.fromEntries(ziel.searchParams));
    expect(wieder).toEqual({ anstellung: KENNUNG, einwand: EINWAND });
    expect(freiesZurueck(SEITE, wieder)).toBe(zurueck);
    expect(zustand.erfasse).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ zeitEinwandId: EINWAND }));
  });

  it('vorbelegt wird nur, was die Liste anbietet — sonst „Person wählen"', () => {
    const v = freieVorgaben(adresse(`anstellung=${KENNUNG}&einwand=${EINWAND}`));
    expect(vorbelegteAnstellung(v, [{ id: EINWAND }, { id: KENNUNG }])).toBe(KENNUNG);
    /* Nicht mehr aktiv: die Auswahl zeigte sonst die erste Person im Alphabet. */
    expect(vorbelegteAnstellung(v, [{ id: EINWAND }])).toBe('');
    expect(vorbelegteAnstellung(freieVorgaben(adresse('')), [{ id: KENNUNG }])).toBe('');
  });

  it('die Seite nimmt Vorbelegung, Einwand und `zurueck` nur aus diesen Funktionen', () => {
    const pfad = 'src/app/portal/[mandant]/zeiten/nacherfassung/page.tsx';
    const quelle = readFileSync(resolve(WURZEL, pfad), 'utf8');
    expect(quelle).toContain('freieVorgaben(frage)');
    expect(quelle).toContain('value={freiesZurueck(pfad, vorgaben)}');
    expect(quelle).toContain('value={vorgaben.einwand}');
    expect(quelle).toContain('defaultValue={vorbelegteAnstellung(vorgaben, anstellungen)}');
    expect(quelle).not.toMatch(/frage\['(?:anstellung|einwand)'\]/u);
  });
});

/*
 * **Der Bereich des Erfolgs kommt aus der Sitzung** (V-275 Nachtrag, D-773).
 * Vorher las die Route ihn aus `zurueck` — ein Programm ohne `zurueck`
 * landete auf `/portal//zeiten/<neuer Eintrag>`. Ein Programm bekommt weiter,
 * was es bekam: im Erfolg die Umleitung (303), bei einer Abweisung JSON.
 */
describe('der neue Eintrag liegt im Bereich der Sitzung, nicht in dem aus `zurueck`', () => {
  it('ein Programm ohne `zurueck`: 303 auf den neuen Eintrag — nie `/portal//…`', async () => {
    const r = await POST(formular('/api/zeit/nacherfassung', ohne('zurueck')));
    expect(r.status).toBe(303);
    const ziel = new URL(r.headers.get('location') ?? '');
    expect(`${ziel.pathname}${ziel.search}`).toBe(`/portal/reinigung/zeiten/${NEU}`);
    expect(ziel.pathname).not.toContain('//');
  });

  it('ein `zurueck` aus einem anderen Bereich bestimmt das Ziel nicht — die Sitzung tut es', async () => {
    const r = await POST(formular('/api/zeit/nacherfassung',
      [['zurueck', '/portal/bau/zeiten/nacherfassung?frei=1'], ...ohne('zurueck')]));
    expect(rueckweg(r).pathname).toBe(`/portal/reinigung/zeiten/${NEU}`);
  });

  it('ohne Slug der Sitzung wird nichts geschrieben — die byte-gleiche 404', async () => {
    zustand.bereich = null;
    const r = await POST(formular('/api/zeit/nacherfassung', ohne('zurueck')));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
    expect(zustand.erfasse).not.toHaveBeenCalled();
  });
});
