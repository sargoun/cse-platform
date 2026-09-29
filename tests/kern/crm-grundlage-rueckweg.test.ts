/**
 * `POST /api/crm/ansprechpartner/[id]/rechtsgrundlage` und `…/widerspruch`
 * kehren mit Schlüsseln zurück, übersetzen die Autorisierung ZUERST und
 * zeigen keinen Text der Datenbank mehr (D-769 Nr. 7 und 8, D-772, V-274,
 * AUT-06, D-766).
 *
 * **Der Befund.** Beide Routen schickten den Satz des `CrmFehler` und ihren
 * Erfolgssatz durch die Adresse (`?meldung=`, `?erfolg=`), die Seite zeigte
 * beide roh — samt Rechten in Backticks, dem Namen einer Prüfbedingung und
 * einer eingetippten Belegnummer. Die Widerspruchsroute reichte dazu JEDEN
 * anderen einzeiligen Fehlertext durch, und dieser Zweig stand VOR
 * `autorisierungsAntwort`: ein fehlendes Recht wurde „Nicht gefunden" im
 * Warnkasten statt der byte-gleichen 404, die abgelaufene Sitzung ein Satz
 * statt der Anmeldung.
 *
 * Geprüft: die ECHTEN Routen (ersetzt: Sitzung, Datenbank, Tor und für die
 * Grundlage der Dienst; für den Widerspruch läuft der echte Dienst, ersetzt
 * ist nur die Antwort der Datenbank), die Abbildung der Datenbanksätze gegen
 * den Text der Migrationen, und die Seite.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  GRUNDLAGE_ERFOLGE, GRUNDLAGE_GRUENDE, GRUNDLAGE_RUECKWEG,
} from '../../src/lib/i18n/verwaltung/crm-rueckweg.js';
import { Abweisung, Bestaetigung } from '../../src/components/portal/Rueckweg.js';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';
import { gruendeAb } from './hilfen/gruende.js';

(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  setzeGrundlage: vi.fn(),
  schreibe: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
/*
 * Der Kontext trägt `schreibe` — dorthin gehen die Aufrufe der Definer. So
 * läuft der ECHTE Widerspruchsdienst mit seiner Abbildung, und nur die
 * Antwort der Datenbank ist ersetzt.
 */
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]), schreibe: zustand.schreibe }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/crm/kontakt-grundlage', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeGrundlage: zustand.setzeGrundlage,
}));

const { CrmFehler } = await import('../../src/server/services/crm/anlegen.js');
const { WIDERSPRUCH_DATENBANK_GRUENDE, grundAusWiderspruch } =
  await import('../../src/server/services/crm/kontakt-grundlage.js');
const GRUNDLAGE = await import('../../src/app/api/crm/ansprechpartner/[id]/rechtsgrundlage/route.js');
const WIDERSPRUCH = await import('../../src/app/api/crm/ansprechpartner/[id]/widerspruch/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);
const HIER = 'http://localhost:3001';
const KONTAKT = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const BLATT = `/portal/reinigung/crm/kontakte/${KONTAKT}/rechtsgrundlage`;
const SEITE = 'src/app/portal/[mandant]/crm/kontakte/[id]/rechtsgrundlage/page.tsx';

const GRUNDLAGE_FUND = gruendeAb(
  { datei: 'src/app/api/crm/ansprechpartner/[id]/rechtsgrundlage/route.ts', funktion: 'POST' },
  ['CrmFehler'], lies, WURZEL);
const WIDERSPRUCH_FUND = gruendeAb(
  { datei: 'src/app/api/crm/ansprechpartner/[id]/widerspruch/route.ts', funktion: 'POST' },
  ['CrmFehler'], lies, WURZEL);
/** Was die Widerspruchsroute schicken kann: die festen Würfe und die Abbildung. */
const WIDERSPRUCH_MOEGLICH = new Set<string>([
  ...WIDERSPRUCH_FUND.gruende, ...WIDERSPRUCH_DATENBANK_GRUENDE.values(), 'widerspruch_abgewiesen',
]);

/** Ein Wurf, wie ihn postgres.js bei einem `raise … using errcode` liefert. */
function datenbankFehler(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, severity: 'ERROR' });
}

/** Die SQLSTATE zu den Namen, mit denen die Migrationen werfen. */
const SQLSTATE: Readonly<Record<string, string>> = {
  insufficient_privilege: '42501', check_violation: '23514', no_data_found: 'P0002',
};

/**
 * Die Würfe der LETZTEN Fassung eines Definers — aus den Migrationen gelesen
 * (Zeichenketten über Zeilen werden, wie in Postgres, zusammengesetzt).
 */
function wuerfe(funktion: string): readonly [string, string][] {
  let letzte = '';
  for (const datei of readdirSync(resolve(WURZEL, 'drizzle')).filter((d) => d.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(WURZEL, 'drizzle', datei), 'utf8').replace(/--[^\n]*/gu, '');
    const kopf = new RegExp(String.raw`create (?:or replace )?function app\.${funktion}\([\s\S]*?\$\$;`, 'gu');
    for (const m of sql.matchAll(kopf)) letzte = m[0];
  }
  const text = (roh: string): string =>
    [...roh.matchAll(/'((?:[^']|'')*)'/gu)].map((m) => (m[1] ?? '').replace(/''/gu, "'")).join('');
  const kette = String.raw`'(?:[^']|'')*'(?:\s*\n\s*'(?:[^']|'')*')*`;
  return [...letzte.matchAll(new RegExp(String.raw`raise exception (${kette})\s*using errcode = '(\w+)'`, 'gu'))]
    .map((m): [string, string] => [m[2] ?? '', text(m[1] ?? '')]);
}
const WERBUNG = wuerfe('werbewiderspruch_manuell_setzen');
const VERARBEITUNG = wuerfe('widerspruch_verarbeitung_setzen');

function formular(pfad: string, felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries({ zurueck: BLATT, ...felder })) daten.append(k, v);
  return new NextRequest(new URL(pfad, HIER), {
    method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}
const grundlage = (felder: Record<string, string>, kopf?: Record<string, string>, id = KONTAKT) =>
  GRUNDLAGE.POST(formular(`/api/crm/ansprechpartner/${id}/rechtsgrundlage`, felder, kopf),
    { params: Promise.resolve({ id }) });
const widerspruch = (felder: Record<string, string>, kopf?: Record<string, string>, id = KONTAKT) =>
  WIDERSPRUCH.POST(formular(`/api/crm/ansprechpartner/${id}/widerspruch`, felder, kopf),
    { params: Promise.resolve({ id }) });

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  for (const f of [zustand.authorize, zustand.setzeGrundlage, zustand.schreibe]) f.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
});

describe('die Sätze der Widerspruchs-Definer werden Gründe — gegen den Text von 0248 und 0222', () => {
  it('jeder abweisende Wurf beider Definer hat seinen Grund — keiner fällt auf den allgemeinen', () => {
    const abweisungen = [...WERBUNG, ...VERARBEITUNG].filter(([code]) => code in SQLSTATE);
    expect(WERBUNG.length).toBeGreaterThanOrEqual(9);
    expect(VERARBEITUNG.length).toBeGreaterThanOrEqual(7);
    expect(abweisungen).toHaveLength(WERBUNG.length + VERARBEITUNG.length);
    for (const [, satz] of abweisungen) {
      expect(WIDERSPRUCH_DATENBANK_GRUENDE.get(satz), satz).toBeDefined();
    }
  });

  it('die Abbildung nennt keinen Satz, den die Definer nicht liefern', () => {
    const alle = new Set([...WERBUNG, ...VERARBEITUNG].map(([, s]) => s));
    for (const satz of WIDERSPRUCH_DATENBANK_GRUENDE.keys()) expect(alle.has(satz), satz).toBe(true);
  });

  it('ein unbekannter Satz wird `widerspruch_abgewiesen` — nie er selbst, nie ein Prototyp-Treffer', () => {
    for (const s of ['Irgendein neuer Satz.', '__proto__', 'constructor', '']) {
      expect(grundAusWiderspruch(s), s).toBe('widerspruch_abgewiesen');
    }
  });
});

describe('POST …/rechtsgrundlage — Abweisung als `?fehler=<grund>`, Erfolg als Schlüssel', () => {
  const ALLE = [...GRUNDLAGE_FUND.gruende].sort();

  it('die Route kann genau diese Gründe schicken (am Quelltext gelesen)', () => {
    expect(GRUNDLAGE_FUND.offen).toEqual([]);
    expect(ALLE).toEqual([
      'aehnlich_ohne_begruendung', 'beleg_keine_kennung', 'einwilligung_ohne_kanal',
      'grundlage_ohne_quelle', 'kein_schreibrecht', 'kein_setzrecht', 'nachweis_in_zukunft',
      'nicht_gefunden',
    ]);
  });

  it.each(ALLE)('%s → 303 zurück aufs Blatt — ohne Satz, ohne Eingabe, ohne Kennung', async (g) => {
    zustand.setzeGrundlage.mockRejectedValue(new CrmFehler(
      `Zum Speichern fehlt \`crm.schreiben\` … Eingegeben wurde: „RV-2024-08" (${KONTAKT}).`,
      g as never));
    const r = await grundlage({ rechtsgrundlage: 'bestandskunde', nachweisQuelle: 'Vertrag' });
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${BLATT}?fehler=${g}`);
    expect(ort).not.toContain('meldung=');
    expect(decodeURIComponent(ort)).not.toContain('RV-2024-08');
    expect(ort.replace(BLATT, '')).not.toContain(KONTAKT);
  });

  it('der Erfolg ist ein Schlüssel', async () => {
    const r = await grundlage({ rechtsgrundlage: 'bestandskunde', nachweisQuelle: 'Vertrag' });
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?erfolg=gespeichert`);
    expect(GRUNDLAGE_ERFOLGE).toContain('gespeichert');
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — auch aus einem Formular', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht crm.rechtsgrundlage_setzen fehlt'));
    const r = await grundlage({ rechtsgrundlage: 'keine' }, { accept: 'text/html' });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'nicht_gefunden' });
    expect(zustand.setzeGrundlage).not.toHaveBeenCalled();
  });

  it('ein unbekannter Fehler bleibt ein Fehler; JSON wie bisher für eine fremde Kennung', async () => {
    zustand.setzeGrundlage.mockRejectedValue(datenbankFehler('22P02', 'invalid input value for enum'));
    await expect(grundlage({ rechtsgrundlage: 'irgendwas' })).rejects.toThrow('invalid input');
    const r = await grundlage({ rechtsgrundlage: 'keine' }, undefined, 'x');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'unbekannte_kennung' });
  });
});

describe('POST …/widerspruch — die Abweisungen der Definer als `?fehler=<grund>`', () => {
  it('die festen Würfe und die eine Abbildung (am Quelltext gelesen)', () => {
    expect(WIDERSPRUCH_FUND.offen.map((o) => o.replace(/:\d+$/u, '')))
      .toEqual(['src/server/services/crm/kontakt-grundlage.ts#widerspruchsDefiner']);
    expect([...WIDERSPRUCH_FUND.gruende].sort())
      .toEqual(['nicht_erfasst', 'ohne_begruendung', 'ohne_betroffenen']);
  });

  it.each([
    ...WERBUNG.map(([code, satz]) => ['werbung', code, satz] as const),
    ...VERARBEITUNG.map(([code, satz]) => ['verarbeitung', code, satz] as const),
  ])('%s: %s „%s" → sein Grund, nie sein Text', async (umfang, code, satz) => {
    zustand.schreibe.mockRejectedValue(datenbankFehler(SQLSTATE[code] ?? code, satz));
    const r = await widerspruch({ umfang, bemerkung: 'Anruf vom 12.03.', kanal: 'telefon' });
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${BLATT}?fehler=${WIDERSPRUCH_DATENBANK_GRUENDE.get(satz) ?? '—'}`);
    expect(decodeURIComponent(ort)).not.toContain(satz);
    expect(ort).not.toContain('meldung=');
  });

  it('ein Satz, den die Abbildung nicht kennt, wird der allgemeine Grund', async () => {
    zustand.schreibe.mockRejectedValue(datenbankFehler('42501',
      'new row violates row-level security policy for table "werbewiderspruch"'));
    const r = await widerspruch({ umfang: 'werbung' });
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=widerspruch_abgewiesen`);
  });

  it('die Prüfungen des Dienstes vor dem Definer: ohne Begründung, nicht erfasst', async () => {
    const ohne = await widerspruch({ umfang: 'verarbeitung', bemerkung: '   ' });
    expect(ohne.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=ohne_begruendung`);
    expect(zustand.schreibe).not.toHaveBeenCalled();
    zustand.schreibe.mockResolvedValue([{ anzahl: 0 }]);
    const nichts = await widerspruch({ umfang: 'werbung' });
    expect(nichts.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=nicht_erfasst`);
  });

  it('ein anderer Fehler bleibt ein Fehler — keine erfundene Abweisung, kein roher Text', async () => {
    for (const f of [
      datenbankFehler('22007', 'invalid input syntax for type date: "morgen"'),
      datenbankFehler('23001', 'Ein Werbewiderspruch wird nicht zurueckgenommen (ansprechpartner.werbewiderspruch_am)'),
      datenbankFehler('08006', 'Connection terminated unexpectedly'),
      new TypeError('kaputt'),
    ]) {
      zustand.schreibe.mockRejectedValue(f);
      await expect(widerspruch({ umfang: 'werbung', eingegangenAm: 'morgen' }), f.message)
        .rejects.toThrow(f.message);
    }
  });
});

describe('POST …/widerspruch — Erfolg, Anmeldung und Recht zuerst, JSON wie bisher', () => {
  it('der Erfolg ist ein Schlüssel je Umfang', async () => {
    zustand.schreibe.mockResolvedValue([{ anzahl: 1 }]);
    const w = await widerspruch({ umfang: 'werbung', kanal: 'email' });
    expect(w.headers.get('location')).toBe(`${HIER}${BLATT}?erfolg=werbewiderspruch`);
    const v = await widerspruch({ umfang: 'verarbeitung', bemerkung: 'Schreiben vom 12.03.' });
    expect(v.headers.get('location')).toBe(`${HIER}${BLATT}?erfolg=vollwiderspruch`);
    expect(GRUNDLAGE_ERFOLGE).toEqual(expect.arrayContaining(['werbewiderspruch', 'vollwiderspruch']));
  });

  it('ein fehlendes Recht ist die byte-gleiche 404 — nicht „Nicht gefunden" im Warnkasten', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht datenschutz.auskunft_erstellen fehlt'));
    const r = await widerspruch({ umfang: 'verarbeitung', bemerkung: 'x' }, { accept: 'text/html' });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'nicht_gefunden' });
    expect(zustand.schreibe).not.toHaveBeenCalled();
  });

  it('ohne zweiten Faktor der Faktor-Schritt, ohne Sitzung die Anmeldung', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const f = await widerspruch({ umfang: 'werbung' }, { accept: 'text/html' });
    expect(f.status).toBe(303);
    expect(f.headers.get('location')).toContain('/auth/zwei-faktor/einrichten');
    zustand.authorize.mockRejectedValue(new NichtAngemeldetFehler());
    const a = await widerspruch({ umfang: 'werbung' }, { accept: 'text/html' });
    expect(a.headers.get('location')).toContain('/auth/login');
    for (const r of [f, a]) expect(r.headers.get('location')).not.toContain('fehler=');
  });

  it('ein Programm bekommt JSON wie bisher', async () => {
    const umfang = await widerspruch({ umfang: 'alles' });
    expect(umfang.status).toBe(400);
    expect(await umfang.json()).toEqual({ fehler: 'unbekannter_umfang' });
    const kennung = await widerspruch({ umfang: 'werbung' }, undefined, 'x');
    expect(kennung.status).toBe(404);
    expect(await kennung.json()).toEqual({ fehler: 'unbekannte_kennung' });
  });
});

describe('die Seite Rechtsgrundlage (deutsch, wie die Seite)', () => {
  const t = GRUNDLAGE_RUECKWEG.de;

  it('die Tabelle deckt genau die Gründe beider Routen', () => {
    expect([...GRUNDLAGE_GRUENDE].sort())
      .toEqual([...new Set([...GRUNDLAGE_FUND.gruende, ...WIDERSPRUCH_MOEGLICH])].sort());
  });

  it('jeder Grund und jeder Erfolg hat einen Satz — ohne Text der Datenbank, ohne Schlüssel eines Rechts', () => {
    for (const g of GRUNDLAGE_GRUENDE) {
      const satz = eigenerEintrag(t.fehler, g);
      expect(satz, g).toBeTruthy();
      expect(satz, g).not.toMatch(
        /`|\w\.rechtsgrundlage_setzen|\w\.auskunft_erstellen|\w\.schreiben|CHECK|Eingegeben wurde|begruendet|Invariante/u);
    }
    for (const e of GRUNDLAGE_ERFOLGE) expect(eigenerEintrag(t.erfolg, e), e).toBeTruthy();
  });

  it('ein unbekannter Grund wird der allgemeine Satz, ein unbekannter Erfolg kein Kasten', () => {
    for (const k of ['__proto__', 'constructor', 'Nicht gefunden', 'crm.rechtsgrundlage_setzen fehlt']) {
      expect(renderToStaticMarkup(createElement(Abweisung, { saetze: t, grund: k, cse: 'g' })), k)
        .toContain(t.sonst);
      expect(renderToStaticMarkup(createElement(Bestaetigung, { saetze: t.erfolg, erfolg: k, cse: 'e' })), k)
        .toBe('');
    }
  });

  it('der Quelltext liest `meldung` nicht mehr', () => {
    const s = readFileSync(resolve(WURZEL, SEITE), 'utf8');
    expect(s).toContain('<Abweisung saetze={GRUNDLAGE_RUECKWEG.de} grund={einSchluessel(suche.fehler)}');
    expect(s).toContain('erfolg={einSchluessel(suche.erfolg)}');
    expect(s).not.toMatch(/suche\.meldung|meldung\?: string|\{suche\.erfolg\}/u);
  });
});
