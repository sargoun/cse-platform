/**
 * `POST /api/crm/kunde/zugang` kehrt mit Schlüsseln zurück, übersetzt die
 * Autorisierung ZUERST und zeigt keinen Text der Datenbank mehr (D-769 Nr. 7
 * und 8, D-772, V-274, AUT-06, D-766).
 *
 * **Der Befund.** Die Route schickte drei Arten Text durch die Adresse: den
 * Satz des `ZugangFehler`, den deutschen `grund`-Satz der Definer aus 0249
 * (`ok = false`) und — für JEDEN anderen einzeiligen Fehler — dessen rohen
 * Text. Dieser letzte Zweig stand VOR `autorisierungsAntwort`: ein fehlendes
 * Recht (`NichtGefundenFehler`, „Nicht gefunden") wurde ein Warnkasten statt
 * der byte-gleichen 404, der fehlende zweite Faktor und die abgelaufene
 * Sitzung ein Satz statt des Faktor-Schritts bzw. der Anmeldung.
 *
 * Geprüft: die ECHTE Route (ersetzt: Sitzung, Datenbank, Tor, Keks und die
 * Aufrufe der Definer), die Abbildung der Datenbanksätze gegen den Text der
 * Migration 0249, und die Seite.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { ZUGANG_RUECKWEG } from '../../src/lib/i18n/verwaltung/crm-rueckweg.js';
import { Abweisung, Bestaetigung } from '../../src/components/portal/Rueckweg.js';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';
import { gruendeAb } from './hilfen/gruende.js';

(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  schreibe: vi.fn(),
  gesetzt: [] as string[],
  geloescht: [] as string[],
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
/*
 * Der Kontext trägt `schreibe` — dorthin gehen die Aufrufe der Definer. So
 * läuft der ECHTE Dienst (`kundenzugang.ts`) mit seiner Abbildung, und nur
 * die Antwort der Datenbank ist ersetzt.
 */
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]), schreibe: zustand.schreibe }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/auth/kennwort-anmeldung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  anbieter: () => 'demo',
}));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    set: (name: string) => { zustand.gesetzt.push(name); },
    delete: (name: string) => { zustand.geloescht.push(name); },
  }),
}));

const {
  ZUGANG_DATENBANK_GRUENDE, ZUGANG_ERFOLGE, ZUGANG_GRUENDE, grundAusDatenbank,
} = await import('../../src/server/services/crm/kundenzugang.js');
const { POST } = await import('../../src/app/api/crm/kunde/zugang/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);
const HIER = 'http://localhost:3001';
const KUNDE = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const ZUGANG = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const SEITE = `/portal/reinigung/crm/kunden/${KUNDE}/zugang`;
const QUELLTEXT_SEITE = 'src/app/portal/[mandant]/crm/kunden/[id]/zugang/page.tsx';

/** Ein Wurf, wie ihn postgres.js bei einem `raise … using errcode` liefert. */
function datenbankFehler(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, severity: 'ERROR' });
}

function formular(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries({ kundeId: KUNDE, zurueck: SEITE, ...felder })) daten.append(k, v);
  return new NextRequest(new URL('/api/crm/kunde/zugang', HIER), {
    method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

/**
 * Die Sätze, mit denen die Definer aus 0249 abweisen — aus der Migration
 * gelesen: die `grund`-Antwort bei `ok = false` und der Text jedes `raise`
 * (Zeichenketten über Zeilen werden, wie in Postgres, zusammengesetzt).
 */
function saetzeAus0249(): { readonly antworten: readonly string[]; readonly wuerfe: readonly [string, string][] } {
  const sql = readFileSync(resolve(WURZEL, 'drizzle/0249_kundenzugang.sql'), 'utf8')
    .replace(/--[^\n]*/gu, '');
  const text = (roh: string): string =>
    [...roh.matchAll(/'((?:[^']|'')*)'/gu)].map((m) => (m[1] ?? '').replace(/''/gu, "'")).join('');
  const kette = String.raw`'(?:[^']|'')*'(?:\s*\n\s*'(?:[^']|'')*')*`;
  const antworten = [...sql.matchAll(new RegExp(String.raw`return query select false,\s*(${kette})::text`, 'gu'))]
    .map((m) => text(m[1] ?? ''));
  const wuerfe = [...sql.matchAll(new RegExp(String.raw`raise exception (${kette})\s*using errcode = '(\w+)'`, 'gu'))]
    .map((m): [string, string] => [m[2] ?? '', text(m[1] ?? '')]);
  return { antworten, wuerfe };
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.authorize.mockReset();
  zustand.schreibe.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
  zustand.gesetzt = [];
  zustand.geloescht = [];
});

describe('die Sätze der Datenbank werden Gründe — gegen den Text von 0249 geprüft', () => {
  const { antworten, wuerfe } = saetzeAus0249();

  it('jede Abweisung (`ok = false`) hat ihren Grund — keine fällt auf `abgewiesen`', () => {
    expect(antworten.length).toBeGreaterThanOrEqual(8);
    for (const satz of antworten) {
      expect(ZUGANG_DATENBANK_GRUENDE.get(satz), satz).toBeDefined();
    }
  });

  it('jeder Wurf mit `insufficient_privilege` oder `no_data_found` hat seinen Grund', () => {
    const abweisungen = wuerfe.filter(([code, satz]) =>
      ['insufficient_privilege', 'no_data_found'].includes(code) && !satz.includes('lesbar'));
    expect(abweisungen.length).toBeGreaterThanOrEqual(12);
    for (const [, satz] of abweisungen) {
      expect(ZUGANG_DATENBANK_GRUENDE.get(satz), satz).toBeDefined();
    }
  });

  it('die Abbildung nennt keinen Satz, den 0249 nicht liefert', () => {
    const alle = new Set([...antworten, ...wuerfe.map(([, s]) => s)]);
    for (const satz of ZUGANG_DATENBANK_GRUENDE.keys()) expect(alle.has(satz), satz).toBe(true);
  });

  it('ein unbekannter Satz wird `abgewiesen` — nie er selbst, nie ein Prototyp-Treffer', () => {
    for (const s of ['Irgendein neuer Satz.', '__proto__', 'constructor', '']) {
      expect(grundAusDatenbank(s), s).toBe('abgewiesen');
    }
  });
});

describe('POST /api/crm/kunde/zugang — Abweisungen als `?fehler=<grund>`', () => {
  it('die Gründe der Route sind die des Dienstes (am Quelltext gelesen)', () => {
    const fund = gruendeAb({ datei: 'src/app/api/crm/kunde/zugang/route.ts', funktion: 'POST' },
      ['ZugangFehler'], lies, WURZEL);
    /* Der eine Wurf mit Grund zur Laufzeit: die Abbildung der Datenbanksätze. */
    expect(fund.offen.map((o) => o.replace(/:\d+$/u, '')))
      .toEqual(['src/server/services/crm/kundenzugang.ts#definer']);
    const moeglich = new Set([...fund.gruende, ...ZUGANG_DATENBANK_GRUENDE.values(), 'abgewiesen']);
    expect([...moeglich].sort()).toEqual([...ZUGANG_GRUENDE].sort());
  });

  it.each([...ZUGANG_DATENBANK_GRUENDE.entries()].filter(([satz]) =>
    saetzeAus0249().antworten.includes(satz)))(
    'ok = false „%s" → `?fehler=%s`, und der Keks des Links fällt', async (satz, grund) => {
      zustand.schreibe.mockResolvedValue([{ ok: false, grund: satz, neues_konto: false, sitzungen: 0 }]);
      const r = await POST(formular({ was: 'ausstellen', email: 'a@b.de', name: 'A' }));
      expect(r.status).toBe(303);
      const ort = r.headers.get('location') ?? '';
      expect(ort).toBe(`${HIER}${SEITE}?fehler=${grund}`);
      expect(ort).not.toContain('meldung=');
      expect(zustand.geloescht).toEqual(['cse_kundeneinladung']);
    });

  it.each([
    ['42501', 'Ein Kundenzugang wird nur mit zweitem Faktor ausgestellt (AUT-02)', 'zweiter_faktor'],
    ['42501', 'In der Gruppenansicht wird nichts entzogen (Invariante 10)', 'gruppenansicht'],
    ['42501', 'system.benutzer_verwalten fehlt', 'kein_recht'],
    ['P0002', 'Die Rolle `kunde` fehlt im Rollenkatalog', 'rolle_fehlt'],
    ['42501', 'new row violates row-level security policy for table "benutzer_mandant"', 'abgewiesen'],
  ])('ein Wurf der Datenbank (%s „%s") → `?fehler=%s` — nie ihr Text', async (code, satz, grund) => {
    zustand.schreibe.mockRejectedValue(datenbankFehler(code, satz));
    const r = await POST(formular({ was: 'entziehen', zugangId: ZUGANG, grund: 'Vertrag beendet' }));
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${SEITE}?fehler=${grund}`);
    expect(decodeURIComponent(ort)).not.toContain(satz);
  });

  it('eine Kennung, die keine ist: `nicht_gefunden`, ohne Datenbank', async () => {
    const r = await POST(formular({ was: 'neu_einladen', zugangId: 'x' }));
    expect(r.headers.get('location')).toBe(`${HIER}${SEITE}?fehler=nicht_gefunden`);
    expect(zustand.schreibe).not.toHaveBeenCalled();
  });

  it('ein anderer Fehler der Datenbank bleibt ein Fehler — keine erfundene Abweisung', async () => {
    for (const f of [
      datenbankFehler('23514', 'Der Einladungstoken wird ausserhalb der Datenbank gebildet'),
      datenbankFehler('08006', 'Connection terminated unexpectedly'),
      new TypeError('kaputt'),
    ]) {
      zustand.schreibe.mockRejectedValue(f);
      await expect(POST(formular({ was: 'entziehen', zugangId: ZUGANG, grund: 'x' })), f.message)
        .rejects.toThrow(f.message);
    }
  });
});

describe('POST /api/crm/kunde/zugang — Erfolg als `?erfolg=<schluessel>`', () => {
  it('ausgestellt und eingeladen setzen den Keks des Links', async () => {
    zustand.schreibe.mockResolvedValue([{ ok: true, grund: 'ausgestellt', neues_konto: true }]);
    const a = await POST(formular({ was: 'ausstellen', email: 'a@b.de', name: 'A' }));
    expect(a.headers.get('location')).toBe(`${HIER}${SEITE}?erfolg=ausgestellt`);
    zustand.schreibe.mockResolvedValue([{ ok: true, grund: 'eingeladen' }]);
    const e = await POST(formular({ was: 'neu_einladen', zugangId: ZUGANG }));
    expect(e.headers.get('location')).toBe(`${HIER}${SEITE}?erfolg=eingeladen`);
    expect(zustand.gesetzt).toEqual(['cse_kundeneinladung', 'cse_kundeneinladung']);
  });

  it('entzogen — mit oder ohne beendete Sitzungen; die Zahl reist nicht mit', async () => {
    zustand.schreibe.mockResolvedValue([{ ok: true, grund: 'entzogen', sitzungen: 0 }]);
    const ohne = await POST(formular({ was: 'entziehen', zugangId: ZUGANG, grund: 'Vertrag beendet' }));
    expect(ohne.headers.get('location')).toBe(`${HIER}${SEITE}?erfolg=entzogen`);
    zustand.schreibe.mockResolvedValue([{ ok: true, grund: 'entzogen', sitzungen: 3 }]);
    const mit = await POST(formular({ was: 'entziehen', zugangId: ZUGANG, grund: 'Vertrag beendet' }));
    expect(mit.headers.get('location')).toBe(`${HIER}${SEITE}?erfolg=entzogen_mit_sitzungen`);
    expect(zustand.geloescht).toEqual(['cse_kundeneinladung', 'cse_kundeneinladung']);
  });
});

describe('POST /api/crm/kunde/zugang — die Anmeldung und das Recht zuerst', () => {
  it('ein fehlendes Recht ist die byte-gleiche 404 — nicht „Nicht gefunden" im Warnkasten', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht system.benutzer_verwalten fehlt'));
    const r = await POST(formular({ was: 'ausstellen', email: 'a@b.de', name: 'A' }, { accept: 'text/html' }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'nicht_gefunden' });
    expect(zustand.schreibe).not.toHaveBeenCalled();
  });

  it('ohne zweiten Faktor der Faktor-Schritt, ohne Sitzung die Anmeldung', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const f = await POST(formular({ was: 'ausstellen' }, { accept: 'text/html' }));
    expect(f.status).toBe(303);
    expect(f.headers.get('location')).toContain('/auth/zwei-faktor/einrichten');
    zustand.authorize.mockRejectedValue(new NichtAngemeldetFehler());
    const a = await POST(formular({ was: 'ausstellen' }, { accept: 'text/html' }));
    expect(a.headers.get('location')).toContain('/auth/login');
    for (const r of [f, a]) expect(r.headers.get('location')).not.toContain('fehler=');
  });

  it('ein Programm bekommt JSON wie bisher', async () => {
    const vorgang = await POST(formular({ was: 'loeschen' }));
    expect(vorgang.status).toBe(400);
    expect(await vorgang.json()).toEqual({ fehler: 'unbekannter_vorgang' });
    const kennung = await POST(formular({ was: 'ausstellen', kundeId: 'x' }));
    expect(kennung.status).toBe(404);
    expect(await kennung.json()).toEqual({ fehler: 'unbekannte_kennung' });
  });
});

describe('die Zugangsseite (deutsch, wie die Seite)', () => {
  const t = ZUGANG_RUECKWEG.de;

  it('jeder Grund und jeder Erfolg hat einen Satz — ohne Text der Datenbank, ohne Schlüssel eines Rechts', () => {
    for (const g of ZUGANG_GRUENDE) {
      const satz = eigenerEintrag(t.fehler, g);
      expect(satz, g).toBeTruthy();
      expect(satz, g).not.toMatch(/`|\w\.benutzer_verwalten|gueltige|gehoert|traegt/u);
    }
    for (const e of ZUGANG_ERFOLGE) expect(eigenerEintrag(t.erfolg, e), e).toBeTruthy();
  });

  it('ein unbekannter Grund wird der allgemeine Satz, ein unbekannter Erfolg kein Kasten', () => {
    for (const k of ['__proto__', 'constructor', 'Nicht gefunden', 'system.benutzer_verwalten fehlt']) {
      expect(renderToStaticMarkup(createElement(Abweisung, { saetze: t, grund: k, cse: 'z' })), k)
        .toContain(t.sonst);
      expect(renderToStaticMarkup(createElement(Bestaetigung, { saetze: t.erfolg, erfolg: k, cse: 'e' })), k)
        .toBe('');
    }
  });

  it('der Quelltext liest `meldung` nicht mehr', () => {
    const s = readFileSync(resolve(WURZEL, QUELLTEXT_SEITE), 'utf8');
    expect(s).toContain('<Abweisung saetze={ZUGANG_RUECKWEG.de} grund={einSchluessel(suche.fehler)}');
    expect(s).toContain('erfolg={einSchluessel(suche.erfolg)}');
    expect(s).not.toMatch(/suche\.meldung|meldung\?: string|\{suche\.erfolg\}/u);
  });
});
