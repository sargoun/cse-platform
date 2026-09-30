/**
 * `POST /api/crm/wiedervorlage` kehrt mit SCHLÜSSELN zurück — die Abweisung
 * als `?wiedervorlage=<grund>`, der Erfolg als `?erfolg=<schluessel>` —, und
 * Liste, Kontaktblatt und Leadblatt schlagen sie nach (D-769, D-772, V-274).
 *
 * **Der Befund.** Die Route schickte den Satz des Dienstes als `?meldung=` und
 * ihren Erfolgssatz als `?erfolg=` — beim Anlegen samt dem, was vom Spiegel
 * fehlte, mit Rechteschlüsseln in Backticks. Liste und Kontaktblatt zeigten
 * beides roh; das Leadblatt zeigte für jede Abweisung nur „Das ließ sich nicht
 * speichern." und die Bestätigung gar nicht.
 *
 * **Warum ein eigener Name.** Leadblatt und Kontaktblatt lesen `?fehler=`
 * schon für andere Formulare, und derselbe Schlüssel meint dort anderes
 * (`betreff_fehlt`: „Ein Lead braucht einen Betreff"; `kein_kontakt`: „braucht
 * einen Ansprechpartner").
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  WIEDERVORLAGE_GRUENDE, WIEDERVORLAGE_RUECKWEG,
} from '../../src/lib/i18n/verwaltung/crm-rueckweg.js';
import { Abweisung, Bestaetigung } from '../../src/components/portal/Rueckweg.js';
import { NichtGefundenFehler } from '../../src/server/auth/fehler.js';
import { gruendeAb } from './hilfen/gruende.js';

(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  legeWiedervorlageAn: vi.fn(),
  erledige: vi.fn(),
  verschiebe: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
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
vi.mock('@/server/services/crm/wiedervorlage', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legeWiedervorlageAn: zustand.legeWiedervorlageAn,
  erledige: zustand.erledige,
  verschiebe: zustand.verschiebe,
}));

const { CrmFehler } = await import('../../src/server/services/crm/anlegen.js');
const { WIEDERVORLAGE_ERFOLGE, anlageSchluessel } =
  await import('../../src/server/services/crm/wiedervorlage.js');
const { POST } = await import('../../src/app/api/crm/wiedervorlage/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);
const quelle = (d: string): string => readFileSync(resolve(WURZEL, d), 'utf8');
const HIER = 'http://localhost:3001';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const LISTE = '/portal/reinigung/crm/wiedervorlagen';
const LEAD = `/portal/reinigung/crm/leads/${ID}`;
const P = 'src/app/portal/[mandant]/crm';
const SATZ = `Satz des Dienstes zu ${ID} — \`aufgabe.schreiben\``;

const ROUTE = gruendeAb({ datei: 'src/app/api/crm/wiedervorlage/route.ts', funktion: 'POST' },
  ['CrmFehler'], lies, WURZEL);
const ALLE = [...ROUTE.gruende].sort();

function formular(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL('/api/crm/wiedervorlage', HIER), {
    method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

const ANLEGEN = { was: 'anlegen', betreff: 'Nachfassen', faelligAm: '2026-10-01T09:00', leadId: ID };

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  for (const f of [zustand.authorize, zustand.legeWiedervorlageAn, zustand.erledige,
    zustand.verschiebe]) f.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
});

describe('POST /api/crm/wiedervorlage — Abweisung als `?wiedervorlage=<grund>`', () => {
  it('jeder Wurf auf dem Weg der Route nennt seinen Grund als festes Wort', () => {
    expect(ROUTE.offen).toEqual([]);
    expect(ALLE).toEqual(expect.arrayContaining(['betreff_fehlt', 'nicht_gefunden', 'ohne_grund']));
  });

  it.each(ALLE)('%s → 303 zurück, ohne Satz, ohne Kennung', async (g) => {
    zustand.legeWiedervorlageAn.mockRejectedValue(new CrmFehler(SATZ, g as never));
    const r = await POST(formular({ ...ANLEGEN, zurueck: LEAD }));
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${LEAD}?wiedervorlage=${g}`);
    expect(ort).not.toContain('meldung=');
    expect(ort).not.toContain('fehler=');
    expect(ort.replace(LEAD, '')).not.toContain(ID);
  });

  it('eine Kennung, die keine ist: `nicht_gefunden` — an die Liste mit `?wer=` angehängt', async () => {
    const r = await POST(formular({ was: 'erledigt', id: 'x', zurueck: `${LISTE}?wer=alle` }));
    expect(r.headers.get('location')).toBe(`${HIER}${LISTE}?wer=alle&wiedervorlage=nicht_gefunden`);
    expect(zustand.erledige).not.toHaveBeenCalled();
  });
});

describe('POST /api/crm/wiedervorlage — Erfolg als `?erfolg=<schluessel>`', () => {
  it('erledigt und verschoben', async () => {
    const e = await POST(formular({ was: 'erledigt', id: ID, zurueck: `${LISTE}?wer=meine` }));
    expect(e.headers.get('location')).toBe(`${HIER}${LISTE}?wer=meine&erfolg=erledigt`);
    const v = await POST(formular({
      was: 'verschieben', id: ID, faelligAm: '2026-10-02T09:00', grund: 'Urlaub', zurueck: LISTE,
    }));
    expect(v.headers.get('location')).toBe(`${HIER}${LISTE}?erfolg=verschoben`);
  });

  it.each([
    [{ aufgabeId: 'a', kalenderId: 'k' }, 'angelegt'],
    [{ aufgabeId: null, kalenderId: 'k' }, 'angelegt_ohne_aufgabe'],
    [{ aufgabeId: 'a', kalenderId: null }, 'angelegt_ohne_kalender'],
    [{ aufgabeId: null, kalenderId: null }, 'angelegt_ohne_spiegel'],
  ] as const)('angelegt mit %j → %s — was vom Spiegel fehlt, als Schlüssel', async (spiegel, schluessel) => {
    expect(anlageSchluessel(spiegel)).toBe(schluessel);
    zustand.legeWiedervorlageAn.mockResolvedValue({
      aktivitaetId: ID, ...spiegel, nichtGespiegelt: ['ein deutscher Satz mit `aufgabe.schreiben`'],
    });
    const r = await POST(formular({ ...ANLEGEN, zurueck: LEAD }));
    expect(r.headers.get('location')).toBe(`${HIER}${LEAD}?erfolg=${schluessel}`);
  });
});

describe('POST /api/crm/wiedervorlage — Anmeldung und Recht zuerst, Programme wie bisher', () => {
  it('ein fehlendes Recht ist die byte-gleiche 404', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht crm.schreiben fehlt'));
    const r = await POST(formular({ ...ANLEGEN, zurueck: LEAD }, { accept: 'text/html' }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'nicht_gefunden' });
    expect(zustand.legeWiedervorlageAn).not.toHaveBeenCalled();
  });

  it('ein unbekannter Fehler bleibt ein Fehler', async () => {
    zustand.erledige.mockRejectedValue(new Error('Verbindung verloren'));
    await expect(POST(formular({ was: 'erledigt', id: ID, zurueck: LISTE }))).rejects.toThrow();
  });

  it('JSON wie bisher: ein unbekannter Vorgang ist 400, ein fremder Ursprung 403', async () => {
    const r = await POST(formular({ was: 'loeschen', zurueck: LISTE }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ fehler: 'unbekannter_vorgang' });
    const fremd = await POST(formular({ was: 'erledigt' }, { origin: 'https://fremd.example' }));
    expect(fremd.status).toBe(403);
  });
});

describe('die Seiten: jeder Grund und jeder Erfolg hat einen Satz — nie Text aus der Adresse', () => {
  it('die Liste der Gründe ist genau das, was die Route schicken kann', () => {
    expect([...WIEDERVORLAGE_GRUENDE].sort()).toEqual(ALLE);
  });

  it('in beiden Sprachen (das Leadblatt folgt der Sitzung) — ohne Kennung, ohne Schlüssel eines Rechts', () => {
    for (const s of ['de', 'en'] as const) {
      const t = WIEDERVORLAGE_RUECKWEG[s];
      for (const g of ALLE) {
        const satz = eigenerEintrag(t.fehler, g);
        expect(satz, `${s}.${g}`).toBeTruthy();
        expect(satz, `${s}.${g}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|`|\w\.schreiben/u);
      }
      for (const e of WIEDERVORLAGE_ERFOLGE) {
        expect(eigenerEintrag(t.erfolg, e), `${s}.${e}`).toBeTruthy();
        expect(eigenerEintrag(t.erfolg, e), `${s}.${e}`).not.toMatch(/`|\w\.schreiben/u);
      }
      if (s === 'en') {
        expect(t.fehler.betreff_fehlt).not.toBe(WIEDERVORLAGE_RUECKWEG.de.fehler.betreff_fehlt);
      }
    }
  });

  it('ein unbekannter Grund wird der allgemeine Satz, ein unbekannter Erfolg kein Kasten', () => {
    const t = WIEDERVORLAGE_RUECKWEG.de;
    for (const k of ['__proto__', 'constructor', 'Die Wiedervorlage steht.']) {
      expect(renderToStaticMarkup(createElement(Abweisung, { saetze: t, grund: k, cse: 'x' })), k)
        .toContain(t.sonst);
      expect(renderToStaticMarkup(createElement(Bestaetigung, { saetze: t.erfolg, erfolg: k, cse: 'y' })), k)
        .toBe('');
    }
    expect(renderToStaticMarkup(createElement(Bestaetigung, { saetze: t.erfolg, erfolg: 'erledigt', cse: 'y' })))
      .toContain('role="status"');
  });

  it.each([
    [`${P}/wiedervorlagen/page.tsx`, 'einSchluessel(suche.wiedervorlage)', 'einSchluessel(suche.erfolg)',
      'WIEDERVORLAGE_RUECKWEG.de'],
    [`${P}/kontakte/[id]/page.tsx`, 'einSchluessel(suche.wiedervorlage)', 'einSchluessel(suche.erfolg)',
      'WIEDERVORLAGE_RUECKWEG.de'],
    [`${P}/leads/[id]/page.tsx`, "einSchluessel(suche['wiedervorlage'])", "einSchluessel(suche['erfolg'])",
      'nachSprache(WIEDERVORLAGE_RUECKWEG, zugang.sprache)'],
  ])('%s liest Grund und Erfolg als Schlüssel, `meldung` nicht mehr', (seite, grund, erfolg, tabelle) => {
    const s = quelle(seite);
    expect(s).toContain(grund);
    expect(s).toContain(erfolg);
    expect(s).toContain(tabelle);
    expect(s).toMatch(/<Abweisung\b/u);
    expect(s).toMatch(/<Bestaetigung\b/u);
    expect(s).not.toMatch(/suche\.meldung|suche\['meldung'\]|meldung\?: string/u);
    /* Kein Erfolgssatz roh aus der Adresse mehr. */
    expect(s).not.toMatch(/\{suche\.erfolg\}|\{suche\['erfolg'\]\}/u);
  });
});
