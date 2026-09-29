/**
 * Die sechs Personalformulare kommen mit einem GRUND zurück — nie mit dem
 * Satz des Dienstes, nie mit einer Kennung, nie mit Text aus der Adresse; und
 * ein fehlendes Recht bleibt die 404 (V-273, D-771, D-769, D-766, AUT-06).
 *
 * **Der Befund.** `fuehrePersonalAus` (`api/personal/gemeinsam.ts`) schickte
 * die `message` JEDES Fehlers mit `status` und `code` als `?meldung=` zurück,
 * und Einstellen, Vertrag, Entgelt, Beenden, Stammdaten und Zusammenführen
 * zeigten sie roh im Warnkasten: „Beschäftigung 5b0d6c1e-… gibt es in dieser
 * Gesellschaft nicht.", die getippte Personalnummer, einen Namen aus der
 * Datenbank — oder was immer ein präparierter Link hineinschrieb. Und weil
 * diese allgemeine Weiche VOR `autorisierungsAntwort` stand, wurde ein
 * fehlendes Recht (`NichtGefundenFehler`, auch mit `status` und `code`) zu
 * `?meldung=Nicht gefunden` auf dem Formular statt der 404 aller Schreibwege.
 *
 * Geprüft werden die ECHTEN Routen (ersetzt sind nur Sitzung, Datenbank, Tor
 * und Dienst), die Tabellen der Sätze, der Kasten, der sie zeigt, und der
 * Quelltext der sechs Seiten.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  ANSTELLUNG_ERFOLG, ANSTELLUNG_ERFOLG_SCHLUESSEL, BEENDEN_RUECKWEG, EINSTELLUNG_RUECKWEG,
  ENTGELT_RUECKWEG, STAMMDATEN_RUECKWEG, VERTRAG_RUECKWEG, ZUSAMMENFUEHREN_RUECKWEG,
  type PersonalRueckwegTexte,
} from '../../src/lib/i18n/verwaltung/personal-rueckweg.js';
import { PersonalAbweisung } from '../../src/app/portal/[mandant]/personal/abweisung.js';
import { PersonalErfolg } from '../../src/app/portal/[mandant]/personal/bestaetigung.js';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import { rohAusDerAdresse } from './hilfen/adressparameter.js';

/* Der Kasten ist `.tsx` mit der klassischen JSX-Umwandlung dieses Testläufers. */
(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  stelleEin: vi.fn(),
  aendereVertrag: vi.fn(),
  beendeAnstellung: vi.fn(),
  setzeKondition: vi.fn(),
  schreibeStammdaten: vi.fn(),
  fuehreZusammen: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  /* Der Bereich des Ziels kommt aus der Sitzung, gelesen über `app.aktiver_mandant()`. */
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) => fn({
    abfrage: (sql: string) => Promise.resolve(/from mandant m/u.test(sql) ? [{ slug: 'reinigung' }] : []),
  }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/personal/einstellung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  stelleEin: zustand.stelleEin,
}));
vi.mock('@/server/services/personal/anstellung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  aendereVertrag: zustand.aendereVertrag,
  beendeAnstellung: zustand.beendeAnstellung,
  setzeKondition: zustand.setzeKondition,
}));
vi.mock('@/server/services/personal/stammdaten', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  schreibeStammdaten: zustand.schreibeStammdaten,
}));
vi.mock('@/server/services/personal/dublette', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fuehreZusammen: zustand.fuehreZusammen,
}));

const {
  DubletteImHaus, EINSTELLUNG_GRUENDE, EinstellungFehler, PersonNichtSichtbar,
  PersonalnummerVergeben: NummerBeimEinstellen,
} = await import('../../src/server/services/personal/einstellung.js');
const {
  AnstellungNichtGefunden, BEENDEN_EINGABE_GRUENDE, BEENDIGUNG_GRUENDE, BeendigungFehler,
  KONDITION_GRUENDE, PersonalnummerVergeben, VERTRAG_AENDERN_GRUENDE, VertragEingabeFehler,
} = await import('../../src/server/services/personal/anstellung.js');
const {
  PersonNichtGefunden, STAMMDATEN_GRUENDE, StammdatenEingabeFehler,
} = await import('../../src/server/services/personal/stammdaten.js');
const {
  BestaetigungFehlt, ZUSAMMENFUEHREN_GRUENDE, ZusammenfuehrenFehler,
} = await import('../../src/server/services/personal/dublette.js');

const anstellungen = await import('../../src/app/api/personal/anstellungen/route.js');
const vertrag = await import('../../src/app/api/personal/anstellungen/[id]/vertrag/route.js');
const beenden = await import('../../src/app/api/personal/anstellungen/[id]/beenden/route.js');
const entgelt = await import('../../src/app/api/personal/anstellungen/[id]/entgelt/route.js');
const stammdaten = await import('../../src/app/api/personal/personen/[id]/stammdaten/route.js');
const zusammen = await import('../../src/app/api/personal/zusammenfuehren/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const PERSON = '6c1e5b0d-0a41-4c55-9d1c-1c2f3b4a5d6f';
const PERSON_ZWEI = '7d2f6c1e-0a41-4c55-9d1c-1c2f3b4a5d70';
const NEU = '8e3a7d2f-0a41-4c55-9d1c-1c2f3b4a5d71';
/** Die Kennung im Satz eines Dienstes — sie steht in keiner Adresse des Formulars. */
const FREMD = '9f4b8e3a-0a41-4c55-9d1c-1c2f3b4a5d72';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const P = '/portal/reinigung/personal';

function formular(pfad: string, felder: Readonly<Record<string, string>>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER, accept: 'text/html' });
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

function json(pfad: string, rumpf: Readonly<Record<string, string>>): NextRequest {
  const kopf = new Headers({
    host: 'localhost:3001', origin: HIER, 'content-type': 'application/json',
  });
  return new NextRequest(new URL(pfad, HIER), {
    method: 'POST', body: JSON.stringify(rumpf), headers: kopf,
  });
}

const mit = (id: string) => ({ params: Promise.resolve({ id }) });

interface Route {
  readonly name: string;
  readonly aufruf: (a: NextRequest) => Promise<Response>;
  readonly pfad: string;
  readonly dienst: Mock;
  /** Gültige Felder eines Formulars, samt `zurueck`. */
  readonly felder: Readonly<Record<string, string>>;
  /** Wohin ein Erfolg führt — mit einem Schlüssel, den die Zielseite nachschlägt. */
  readonly erfolg: string;
  /** Jeder Grund, den die Route schicken kann, mit einem Fehler, der ihn trägt. */
  readonly gruende: readonly (readonly [string, () => Error])[];
  /** Die Tabelle der Seite, auf die `zurueck` führt. */
  readonly tabelle: PersonalRueckwegTexte<string>;
}

const SATZ = `Ein Satz des Dienstes mit „R-7", „Anna Berg" und der Kennung ${FREMD}.`;

const ROUTEN: readonly Route[] = [
  {
    name: 'POST /api/personal/anstellungen',
    aufruf: (a) => anstellungen.POST(a),
    pfad: '/api/personal/anstellungen',
    dienst: zustand.stelleEin,
    felder: {
      modus: 'neu', vorname: 'Anna', nachname: 'Berg', sprache: 'de', personalnummer: 'R-7',
      eintritt: '2026-10-01', zurueck: `${P}/anstellungen/neu?vorname=Anna&nachname=Berg&modus=neu`,
    },
    erfolg: `${P}/anstellungen/${NEU}?eingestellt=1`,
    gruende: [
      ...EINSTELLUNG_GRUENDE.map((g) => [g, () => new EinstellungFehler(g, SATZ)] as const),
      ['dublette_im_haus', () => new DubletteImHaus('Anna Berg')],
      ['person_nicht_sichtbar', () => new PersonNichtSichtbar()],
      ['personalnummer_vergeben', () => new NummerBeimEinstellen('R-7')],
    ],
    tabelle: EINSTELLUNG_RUECKWEG.de,
  },
  {
    name: 'POST /api/personal/anstellungen/[id]/vertrag',
    aufruf: (a) => vertrag.POST(a, mit(ID)),
    pfad: `/api/personal/anstellungen/${ID}/vertrag`,
    dienst: zustand.aendereVertrag,
    felder: { personalnummer: 'R-2', eintritt: '2025-02-01', zurueck: `${P}/anstellungen/${ID}/vertrag` },
    erfolg: `${P}/anstellungen/${ID}?erfolg=vertrag_gespeichert`,
    gruende: [
      ...VERTRAG_AENDERN_GRUENDE.map((g) => [g, () => new VertragEingabeFehler(g, SATZ)] as const),
      ['nicht_gefunden', () => new AnstellungNichtGefunden(FREMD)],
      ['personalnummer_vergeben', () => new PersonalnummerVergeben('R-2')],
    ],
    tabelle: VERTRAG_RUECKWEG.de,
  },
  {
    name: 'POST /api/personal/anstellungen/[id]/beenden',
    aufruf: (a) => beenden.POST(a, mit(ID)),
    pfad: `/api/personal/anstellungen/${ID}/beenden`,
    dienst: zustand.beendeAnstellung,
    felder: { austritt: '2026-12-31', grund: 'Eigenkündigung', zurueck: `${P}/anstellungen/${ID}/beenden` },
    erfolg: `${P}/anstellungen/${ID}?erfolg=beendigung_eingetragen`,
    gruende: [
      ...BEENDEN_EINGABE_GRUENDE.map((g) => [g, () => new VertragEingabeFehler(g, SATZ)] as const),
      ...BEENDIGUNG_GRUENDE.map((g) => [g, () => new BeendigungFehler(g, SATZ)] as const),
      ['nicht_gefunden', () => new AnstellungNichtGefunden(FREMD)],
    ],
    tabelle: BEENDEN_RUECKWEG.de,
  },
  {
    name: 'POST /api/personal/anstellungen/[id]/entgelt',
    aufruf: (a) => entgelt.POST(a, mit(ID)),
    pfad: `/api/personal/anstellungen/${ID}/entgelt`,
    dienst: zustand.setzeKondition,
    felder: { giltAb: '2026-10-01', stundensatz: '17,50', zurueck: `${P}/anstellungen/${ID}/entgelt` },
    erfolg: `${P}/anstellungen/${ID}/entgelt?gespeichert=1`,
    gruende: [
      ...KONDITION_GRUENDE.map((g) => [g, () => new VertragEingabeFehler(g, SATZ)] as const),
      ['nicht_gefunden', () => new AnstellungNichtGefunden(FREMD)],
    ],
    tabelle: ENTGELT_RUECKWEG.de,
  },
  {
    name: 'POST /api/personal/personen/[id]/stammdaten',
    aufruf: (a) => stammdaten.POST(a, mit(PERSON)),
    pfad: `/api/personal/personen/${PERSON}/stammdaten`,
    dienst: zustand.schreibeStammdaten,
    felder: {
      geburtsdatum: '1990-02-01', geburtsort: 'Berlin', staatsangehoerigkeit: 'DE',
      zurueck: `${P}/personen/${PERSON}/stammdaten`,
    },
    erfolg: `${P}/personen/${PERSON}/stammdaten?gespeichert=1`,
    gruende: [
      ...STAMMDATEN_GRUENDE.map((g) => [g, () => new StammdatenEingabeFehler(g, SATZ)] as const),
      ['nicht_gefunden', () => new PersonNichtGefunden(FREMD)],
    ],
    tabelle: STAMMDATEN_RUECKWEG.de,
  },
  {
    name: 'POST /api/personal/zusammenfuehren',
    aufruf: (a) => zusammen.POST(a),
    pfad: '/api/personal/zusammenfuehren',
    dienst: zustand.fuehreZusammen,
    felder: {
      dublette: PERSON, fuehrend: PERSON_ZWEI, grund: 'doppelt angelegt', bestaetigung: 'Berg',
      zurueck: `${P}/zusammenfuehren?q=Berg`,
    },
    erfolg: `${P}/zusammenfuehren?zusammengefuehrt=1`,
    gruende: [
      ...ZUSAMMENFUEHREN_GRUENDE.map((g) => [g, () => new ZusammenfuehrenFehler(g, SATZ)] as const),
      ['bestaetigung_falsch', () => new BestaetigungFehlt()],
    ],
    tabelle: ZUSAMMENFUEHREN_RUECKWEG.de,
  },
];

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.authorize.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
  for (const f of [zustand.stelleEin, zustand.aendereVertrag, zustand.beendeAnstellung,
    zustand.setzeKondition, zustand.schreibeStammdaten, zustand.fuehreZusammen]) {
    f.mockReset();
    f.mockResolvedValue(undefined);
  }
  zustand.stelleEin.mockResolvedValue({
    anstellungId: NEU, personId: PERSON, personNeu: true, status: 'geplant',
  });
});

/** Was ein Formular zurückbekommt: `zurueck`, und an ihm nur `fehler`. */
function erwartet(route: Route, grund: string): string {
  const zurueck = route.felder['zurueck'] ?? '';
  return `${HIER}${zurueck}${zurueck.includes('?') ? '&' : '?'}fehler=${grund}`;
}

describe.each(ROUTEN.map((r) => [r.name, r] as const))('%s — der Rückweg trägt einen Grund', (_, route) => {
  it.each(route.gruende)('%s: 303 auf `zurueck?fehler=<grund>` — kein Satz, keine Kennung', async (grund, fehler) => {
    route.dienst.mockRejectedValue(fehler());
    const r = await route.aufruf(formular(route.pfad, route.felder));
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(erwartet(route, grund));
    expect(ort).not.toContain('meldung=');
    expect(ort).not.toContain(FREMD);
    // Ausser dem Grund steht nichts in der Abfrage, was das Formular nicht schon trug.
    expect(new URL(ort).search).not.toMatch(UUID);
  });

  it('ein Fehler ohne eigenen Grund reist mit seinem `code` — und ein Satz als Grund nie', async () => {
    route.dienst.mockRejectedValueOnce(Object.assign(new Error(SATZ), {
      code: 'ungueltiger_zustand', status: 409,
    }));
    expect((await route.aufruf(formular(route.pfad, route.felder))).headers.get('location'))
      .toBe(erwartet(route, 'ungueltiger_zustand'));
    route.dienst.mockRejectedValueOnce(Object.assign(new Error(SATZ), {
      code: 'ungueltige_eingabe', status: 400, grund: 'Das ist ein Satz, kein Schlüssel.',
    }));
    expect((await route.aufruf(formular(route.pfad, route.felder))).headers.get('location'))
      .toBe(erwartet(route, 'ungueltige_eingabe'));
  });

  it('Erfolg: 303 auf das Ziel — mit einem Schlüssel, den die Zielseite kennt, nie mit einem Satz', async () => {
    const r = await route.aufruf(formular(route.pfad, route.felder));
    expect(r.status).toBe(303);
    const ort = new URL(r.headers.get('location') ?? '');
    expect(`${ort.pathname}${ort.search}`).toBe(route.erfolg);
    expect([...ort.searchParams].length, 'genau ein Schlüssel').toBe(1);
    for (const [name, wert] of ort.searchParams) {
      expect(name).not.toBe('meldung');
      // `?eingestellt=1`, `?gespeichert=1`, `?zusammengefuehrt=1` — oder `?erfolg=`
      // mit einem Schlüssel, den das Blatt der Beschäftigung nachschlägt.
      if (name === 'erfolg') expect(eigenerEintrag(ANSTELLUNG_ERFOLG.de, wert), wert).toBeDefined();
      else expect(wert, name).toBe('1');
    }
    expect(route.dienst).toHaveBeenCalledOnce();
  });

  it('eine Schnittstelle bekommt weiter `{ fehler, meldung }` mit Status (D-599)', async () => {
    const [, fehler] = route.gruende[0]!;
    const f = fehler() as Error & { code: string; status: number };
    route.dienst.mockRejectedValueOnce(f);
    const r = await route.aufruf(json(route.pfad, route.felder));
    expect(r.status).toBe(f.status);
    expect(await r.json()).toEqual({ fehler: f.code, meldung: f.message });
    const ok = await route.aufruf(json(route.pfad, route.felder));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ergebnis: 'ok' });
  });

  it('ein fehlendes Recht bleibt die byte-gleiche 404 — auch hinter einem Formular (AUT-06)', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht fehlt'));
    const r = await route.aufruf(formular(route.pfad, route.felder));
    expect(r.status).toBe(404);
    expect(r.headers.get('location')).toBeNull();
    expect(await r.text()).toBe(await nichtGefundenAntwort().text());
    expect(route.dienst).not.toHaveBeenCalled();
  });

  it('ohne Sitzung oder Faktor: die Anmeldung, nie der Rückweg des Formulars (D-766)', async () => {
    zustand.authorize.mockRejectedValueOnce(new NichtAngemeldetFehler());
    const ohne = new URL((await route.aufruf(formular(route.pfad, route.felder)))
      .headers.get('location') ?? '');
    expect(ohne.pathname).toBe('/auth/login');
    expect(ohne.searchParams.get('weiter')).toBe(route.felder['zurueck']);
    expect(ohne.searchParams.get('fehler')).toBeNull();
    zustand.authorize.mockRejectedValueOnce(new ZweiterFaktorFehler());
    const faktor = new URL((await route.aufruf(formular(route.pfad, route.felder)))
      .headers.get('location') ?? '');
    expect(faktor.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(faktor.searchParams.get('fehler')).toBeNull();
  });

  it('`zurueck` führt nie aus dem Portal hinaus', async () => {
    route.dienst.mockRejectedValueOnce(route.gruende[0]![1]());
    const r = await route.aufruf(formular(route.pfad,
      { ...route.felder, zurueck: 'https://fremd.example/portal' }));
    expect(new URL(r.headers.get('location') ?? '').origin).toBe(HIER);
  });

  it('die Seite hat für jeden dieser Gründe einen Satz — und keinen, den die Route nie schickt', () => {
    const gruende = route.gruende.map(([g]) => g);
    expect(new Set(gruende).size).toBe(gruende.length);
    for (const g of gruende) expect(eigenerEintrag(route.tabelle.fehler, g), g).toBeTruthy();
    expect(Object.keys(route.tabelle.fehler).sort()).toEqual([...gruende].sort());
  });
});

describe('die Wege, die die Route selbst abweist', () => {
  it('Entgelt: ein Betrag in fremder Schreibweise wird `betrag_ungueltig` — die Eingabe reist nicht mit', async () => {
    const route = ROUTEN[3]!;
    const r = await route.aufruf(formular(route.pfad, { ...route.felder, stundensatz: 'zwölf' }));
    expect(r.headers.get('location')).toBe(erwartet(route, 'betrag_ungueltig'));
    expect(r.headers.get('location')).not.toMatch(/zw/iu);
    expect(zustand.setzeKondition).not.toHaveBeenCalled();
  });

  it.each([
    ['38,5', 38_500n], ['38.5', 38_500n], ['40', 40_000n], ['0', 0n],
  ] as const)('Entgelt: Wochenstunden „%s" kommen gelesen beim Dienst an (%s Tausendstel)', async (eingabe, tausendstel) => {
    const route = ROUTEN[3]!;
    const r = await route.aufruf(formular(route.pfad,
      { ...route.felder, wochenstunden: eingabe, arbeitstageWoche: '4,5' }));
    expect(r.headers.get('location')).toBe(`${HIER}${route.erfolg}`);
    expect(zustand.setzeKondition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      wochenstunden: tausendstel, arbeitstageWoche: 4_500n,
    }));
  });

  it('Entgelt: leere Felder heissen „nicht hinterlegt" — null, keine Null', async () => {
    const route = ROUTEN[3]!;
    await route.aufruf(formular(route.pfad, { ...route.felder, wochenstunden: '', arbeitstageWoche: '  ' }));
    expect(zustand.setzeKondition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      wochenstunden: null, arbeitstageWoche: null,
    }));
  });

  it.each([
    ['wochenstunden', 'abc', 'wochenstunden_ungueltig'],
    ['wochenstunden', '38,5555', 'wochenstunden_ungueltig'],
    ['wochenstunden', '1.234,5', 'wochenstunden_ungueltig'],
    ['arbeitstageWoche', 'fünf', 'arbeitstage_ungueltig'],
  ] as const)('Entgelt: %s „%s" ist keine Zahl → `%s`, vor dem Dienst, ohne die Eingabe', async (feld, eingabe, grund) => {
    const route = ROUTEN[3]!;
    const r = await route.aufruf(formular(route.pfad, { ...route.felder, [feld]: eingabe }));
    expect(r.headers.get('location')).toBe(erwartet(route, grund));
    expect(decodeURIComponent(r.headers.get('location') ?? '')).not.toContain(eingabe);
    expect(zustand.setzeKondition).not.toHaveBeenCalled();
  });

  it('Zusammenführen: ohne zwei gewählte Datensätze `keine_auswahl` — vor dem Dienst', async () => {
    const route = ROUTEN[5]!;
    const r = await route.aufruf(formular(route.pfad, { ...route.felder, dublette: '' }));
    expect(r.headers.get('location')).toBe(erwartet(route, 'keine_auswahl'));
    expect(zustand.fuehreZusammen).not.toHaveBeenCalled();
  });

  it('eine vergebene Personalnummer: auf beiden Wegen derselbe Code für eine Schnittstelle (D-771 Nachtrag)', async () => {
    for (const [route, fehler] of [
      [ROUTEN[0]!, () => new NummerBeimEinstellen('R-7')],
      [ROUTEN[1]!, () => new PersonalnummerVergeben('R-2')],
    ] as const) {
      route.dienst.mockRejectedValueOnce(fehler());
      const r = await route.aufruf(json(route.pfad, route.felder));
      expect(r.status, route.name).toBe(409);
      expect((await r.json() as { fehler: string }).fehler, route.name).toBe('ungueltiger_zustand');
    }
  });

  it('ein Serverfehler ohne `status` bleibt ein Fehler — keine erfundene Abweisung', async () => {
    const route = ROUTEN[1]!;
    route.dienst.mockRejectedValueOnce(Object.assign(new Error('connection reset'),
      { code: 'ECONNRESET' }));
    await expect(route.aufruf(formular(route.pfad, route.felder))).rejects.toThrow('connection reset');
  });
});

describe('die Tabellen der sechs Seiten', () => {
  const TABELLEN = {
    EINSTELLUNG_RUECKWEG, VERTRAG_RUECKWEG, BEENDEN_RUECKWEG, ENTGELT_RUECKWEG,
    STAMMDATEN_RUECKWEG, ZUSAMMENFUEHREN_RUECKWEG,
  } as const;

  it.each(Object.entries(TABELLEN))('%s: deutsch, jeder Satz ohne Kennung, ohne Platzhalter, ohne Wert', (_, t) => {
    /* Die Seiten stehen auf der Ausnahmeliste der Übersetzung — ihre Sprache ist Deutsch. */
    expect(Object.keys(t)).toEqual(['de']);
    const de: PersonalRueckwegTexte<string> = t.de;
    expect(de.titel.trim()).not.toBe('');
    expect(de.sonst.trim()).not.toBe('');
    for (const [g, satz] of Object.entries(de.fehler)) {
      expect(satz.trim(), g).not.toBe('');
      expect(satz, g).not.toMatch(UUID);
      expect(satz, g).not.toMatch(/\{\w+\}|\$\{/u);
      // Kein Datum und keine Nummer aus einer Zeile — die Seite zeigt sie aus ihren Daten.
      expect(satz, g).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4}/u);
      expect(satz, g).not.toContain('`');
    }
  });

  it('ein fremder Grund aus der Adresse wird kein Satz — und kein Prototyp-Treffer', () => {
    for (const t of Object.values(TABELLEN)) {
      for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'Hallo Welt', '',
        'ungueltige_eingabe']) {
        expect(eigenerEintrag(t.de.fehler, k), k).toBeUndefined();
      }
    }
  });
});

describe('der Kasten zeigt nur den nachgeschlagenen Satz', () => {
  const html = (grund: string | readonly string[] | undefined): string => renderToStaticMarkup(
    createElement(PersonalAbweisung, { saetze: VERTRAG_RUECKWEG.de, grund, cse: 'probe' }));

  it('ein bekannter Grund: sein Satz, als Warnung mit role="alert"', () => {
    const h = html('personalnummer_vergeben');
    expect(h).toContain('role="alert"');
    expect(h).toContain('data-art="warnung"');
    expect(h).toContain(VERTRAG_RUECKWEG.de.titel);
    expect(h).toContain('Diese Personalnummer ist in dieser Gesellschaft schon vergeben.');
  });

  it.each(['__proto__', 'constructor', 'toString', 'Beschäftigung 5b0d6c1e gibt es nicht', ''])(
    'unbekannt (%s): der allgemeine Satz, nie der Wert aus der Adresse',
    (grund) => {
      const h = html(grund);
      expect(h).toContain(VERTRAG_RUECKWEG.de.sonst);
      if (grund !== '') expect(h).not.toContain(grund);
    },
  );

  it('ohne Grund, oder mit zwei: kein Kasten', () => {
    expect(html(undefined)).toBe('');
    expect(html(['nicht_gefunden', 'x'])).toBe('');
  });
});

describe('das Blatt der Beschäftigung bestätigt Einstellen, Vertrag und Beenden (D-771 Nachtrag)', () => {
  const BLATT = 'src/app/portal/[mandant]/personal/anstellungen/[id]/page.tsx';
  const html = (schluessel: string | readonly string[] | undefined): string => renderToStaticMarkup(
    createElement(PersonalErfolg, { saetze: ANSTELLUNG_ERFOLG.de, schluessel, cse: 'probe' }));

  it('jeder Schlüssel, den eine Route schickt, hat einen Satz — und die Tabelle keinen darüber hinaus', () => {
    const geschickt = ROUTEN.map((r) => new URL(r.erfolg, HIER))
      .filter((u) => u.pathname === `${P}/anstellungen/${u.pathname.split('/').at(-1) ?? ''}`)
      .map((u) => (u.searchParams.get('eingestellt') === '1' ? 'eingestellt' : u.searchParams.get('erfolg')));
    expect([...geschickt].sort()).toEqual([...ANSTELLUNG_ERFOLG_SCHLUESSEL].sort());
    for (const k of ANSTELLUNG_ERFOLG_SCHLUESSEL) {
      const e = ANSTELLUNG_ERFOLG.de[k];
      expect(e.titel.trim(), k).not.toBe('');
      expect(e.satz.trim(), k).not.toBe('');
      expect(`${e.titel} ${e.satz}`, k).not.toMatch(UUID);
      expect(`${e.titel} ${e.satz}`, k).not.toMatch(/\{\w+\}|\$\{|`/u);
    }
  });

  it('ein bekannter Schlüssel: sein Satz, als Erfolg mit role="status"', () => {
    const h = html('vertrag_gespeichert');
    expect(h).toContain('role="status"');
    expect(h).toContain('data-art="erfolg"');
    expect(h).toContain('Vertragseckdaten gespeichert.');
    expect(html('eingestellt')).toContain('Eingestellt.');
    expect(html('beendigung_eingetragen')).toContain('Beendigung eingetragen.');
  });

  it.each(['__proto__', 'constructor', 'toString', '1', 'gespeichert', 'Alles gelöscht', ''])(
    'unbekannt (%s): gar kein Kasten — eine Bestätigung erfindet kein Link',
    (schluessel) => {
      expect(html(schluessel)).toBe('');
    },
  );

  it('ohne Schlüssel, oder mit zwei: kein Kasten', () => {
    expect(html(undefined)).toBe('');
    expect(html(['vertrag_gespeichert', 'eingestellt'])).toBe('');
  });

  it('das Blatt liest `?eingestellt=1` und `?erfolg=` — und zeigt keinen der beiden roh', () => {
    const s = readFileSync(join(WURZEL, BLATT), 'utf8');
    expect(s).toContain("suche['eingestellt'] === '1' ? 'eingestellt' : suche['erfolg']");
    expect(s).toContain('<PersonalErfolg saetze={ANSTELLUNG_ERFOLG.de} schluessel={erfolg} cse="anstellung-erfolg" />');
    const befunde = rohAusDerAdresse([[join(WURZEL, BLATT), s]],
      (d) => { try { return readFileSync(d, 'utf8'); } catch { return null; } }, WURZEL);
    expect(befunde).toEqual([]);
  });
});

describe('die sechs Seiten lesen `?meldung=` nicht mehr', () => {
  const M = 'src/app/portal/[mandant]/personal';
  const SEITEN = [
    [`${M}/anstellungen/neu/page.tsx`, 'EINSTELLUNG_RUECKWEG', 'einstellung-meldung', null],
    [`${M}/anstellungen/[id]/vertrag/page.tsx`, 'VERTRAG_RUECKWEG', 'vertrag-meldung', null],
    [`${M}/anstellungen/[id]/beenden/page.tsx`, 'BEENDEN_RUECKWEG', 'beenden-meldung', null],
    [`${M}/anstellungen/[id]/entgelt/page.tsx`, 'ENTGELT_RUECKWEG', 'entgelt-meldung',
      'entgelt-gespeichert'],
    [`${M}/personen/[id]/stammdaten/page.tsx`, 'STAMMDATEN_RUECKWEG', 'stammdaten-meldung',
      'stammdaten-gespeichert'],
    [`${M}/zusammenfuehren/page.tsx`, 'ZUSAMMENFUEHREN_RUECKWEG', 'merge-meldung', 'merge-fertig'],
  ] as const;

  it.each(SEITEN)('%s', (seite, tabelle, anker, erfolg) => {
    const s = readFileSync(join(WURZEL, seite), 'utf8');
    // Weder `suche['meldung']` noch `suche.meldung` noch eine Variable, die ihn hält.
    expect(s).not.toMatch(/['"]meldung['"]|\.meldung\b|\b(?:const|let)\s+meldung\b|\{\s*meldung\b/u);
    expect(s).toContain(`<PersonalAbweisung saetze={${tabelle}.de} grund={suche['fehler']}`);
    expect(s).toContain(`cse="${anker}"`);
    if (erfolg !== null) {
      expect(s, 'ein Erfolgskasten sagt sich an').toMatch(
        new RegExp(`<Hinweis art="erfolg" rolle="status" cse="${erfolg}"`, 'u'));
    }
  });

  it('die Wache über die Adresse findet auf keiner der Seiten mehr eine Meldung als solche', () => {
    const dateien = [...SEITEN.map(([s]) => join(WURZEL, s)), join(WURZEL, M, 'abweisung.tsx')];
    const befunde = rohAusDerAdresse(
      dateien.map((d) => [d, readFileSync(d, 'utf8')] as const),
      (d) => { try { return readFileSync(d, 'utf8'); } catch { return null; } }, WURZEL);
    expect(befunde.filter((b) => b.art === 'rueckfall')).toEqual([]);
    expect(befunde.filter((b) => ['meldung', 'erfolg', 'ok', 'hinweis', 'fehler']
      .includes(b.parameter))).toEqual([]);
    // Was bleibt, sind die Suchwörter der Seiten — Vor- und Nachname, der Suchbegriff.
    expect([...new Set(befunde.map((b) => b.parameter))].sort()).toEqual(['nachname', 'q', 'vorname']);
  });
});
