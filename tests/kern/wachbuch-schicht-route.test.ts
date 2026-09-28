/**
 * `POST /api/mein/schichten/[zuordnungId]/wachbuch` — was V-180 und V-181 an
 * der Wachbuchroute des Mitarbeiterportals geändert haben, am Verhalten
 * geprüft (D-599, D-674 Nr. 6, TIM-09).
 *
 * **Der Befund der Prüfung.** Zwei Zusagen standen ohne Test da:
 *
 *  - **`nachgetragen`** — V-180 meldet als behoben, dass die Route das
 *    Häkchen der Wache jetzt übernimmt. Die V-078-Wache
 *    (`nachgetragen.test.ts` (1)) führt diese Route in ihrer Liste „nimmt es
 *    entgegen" nicht; ein Rückfall bliebe so unbemerkt wie der ursprüngliche
 *    Fehler: eine offline geschriebene Seite stand als sofort geschrieben im
 *    Buch.
 *  - **Eine Abweisung ist eine Seite, kein JSON** — die Route antwortet seit
 *    V-180/V-181 mit 303 und `?fehler=<grund>` statt mit JSON 400/422. Das
 *    Formular ist ein echtes `<form method="post">` auf einem Diensttelefon;
 *    JSON dort ist eine weiße Seite ohne Rückweg.
 *
 * Geprüft wird die ECHTE Route; ersetzt sind nur die Brücke zur Schicht
 * (`aufDerSchicht`, deren eigener Weg in der Isolationssuite steht), der
 * Wachbuchdienst und die Fotoablage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  BezugPasstNichtZumObjekt, KeinUrheber, WachbuchEingabeFehlt,
} from '../../src/server/services/security/wachbuch.js';
import { MedienFehler, MEDIEN_MAX_BYTES } from '../../src/server/services/zeit/medien.js';
import { NichtVerbundenFehler } from '../../src/server/storage/adapter.js';
import { WACHBUCH_SCHICHT_TEXTE } from '../../src/lib/i18n/wachbuch-schicht.js';
import type * as Bruecke from '../../src/app/api/mein/schichten/bruecke.js';
import type * as WachbuchDienst from '../../src/server/services/security/wachbuch.js';
import type * as MedienDienst from '../../src/server/services/zeit/medien.js';

const ZUORDNUNG = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const BEZUG = {
  mandantId: '00000000-0000-4000-8000-000000000002',
  objektId: '00000000-0000-4000-8000-0000000000a1' as string | null,
  einsatzId: '00000000-0000-4000-8000-0000000000e1',
};

const zustand = vi.hoisted(() => ({
  schreibeEintrag: vi.fn(),
  legeFotos: vi.fn(),
  bezug: null as null | Record<string, unknown>,
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({ aktuelleSitzung: () => Promise.resolve(null) }));
vi.mock('@/server/db/pool', () => ({ db: () => { throw new Error('keine Datenbank im Kerntest'); } }));
vi.mock('../../src/app/api/mein/schichten/bruecke.js', async (original) => ({
  ...(await original<typeof Bruecke>()),
  aufDerSchicht: async <T,>(
    _anfrage: unknown, _zuordnung: string,
    fn: (k: unknown, bezug: unknown, sitzung: unknown) => Promise<T>,
  ) => ({ art: 'ok' as const, wert: await fn({}, zustand.bezug, {}), bezug: zustand.bezug }),
}));
vi.mock('@/server/services/security/wachbuch', async (original) => ({
  ...(await original<typeof WachbuchDienst>()),
  schreibeEintrag: zustand.schreibeEintrag,
}));
vi.mock('@/server/services/zeit/medien', async (original) => ({
  ...(await original<typeof MedienDienst>()),
  legeWachbuchFotosAb: zustand.legeFotos,
}));

const { POST } = await import('../../src/app/api/mein/schichten/[zuordnungId]/wachbuch/route.js');

const HIER = 'http://localhost:3001';
const SEITE = `/portal/mein/schichten/${ZUORDNUNG}/wachbuch`;
const params = { params: Promise.resolve({ zuordnungId: ZUORDNUNG }) };

function anfrage(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL(`/api/mein/schichten/${ZUORDNUNG}/wachbuch`, HIER), {
    method: 'POST', body: daten,
    headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

const EINTRAG = { art: 'vorkommnis', betreff: 'Tor offen', eintragstext: 'Nebentor offen.' };

/** Wohin die Antwort führt — als Pfad mit Abfrage, ohne Ursprung. */
function ziel(antwort: Response): string {
  const ort = new URL(antwort.headers.get('location') ?? '');
  expect(ort.origin).toBe(HIER);
  return `${ort.pathname}${ort.search}`;
}

beforeEach(() => {
  zustand.bezug = { ...BEZUG };
  zustand.schreibeEintrag.mockReset();
  zustand.legeFotos.mockReset();
  zustand.schreibeEintrag.mockResolvedValue('00000000-0000-4000-8000-0000000000f1');
  zustand.legeFotos.mockResolvedValue([]);
});

describe('(1) nachgetragen — das Häkchen der Wache kommt im Dienst an (V-180, TIM-09)', () => {
  it('angekreuzt: nachgetragen true — Objekt und Schicht aus dem Bezug, nie aus dem Formular',
    async () => {
      const antwort = await POST(anfrage({
        ...EINTRAG, nachgetragen: '1', objekt: '00000000-0000-4000-8000-00000000dead',
      }), params);
      expect(antwort.status).toBe(303);
      expect(ziel(antwort)).toBe(SEITE);
      expect(zustand.schreibeEintrag).toHaveBeenCalledTimes(1);
      expect(zustand.schreibeEintrag).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        objektId: BEZUG.objektId, einsatzId: BEZUG.einsatzId, art: 'vorkommnis',
        betreff: 'Tor offen', eintragstext: 'Nebentor offen.', nachgetragen: true,
      }));
    });

  it('nicht angekreuzt: nachgetragen false', async () => {
    await POST(anfrage(EINTRAG), params);
    expect(zustand.schreibeEintrag).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ nachgetragen: false }));
  });
});

describe('(2) eine Abweisung ist eine Seite mit Grund, kein JSON (D-599)', () => {
  it.each([
    ['unbekannte_art', { ...EINTRAG, art: 'erfunden' }],
    ['kein_betreff', { ...EINTRAG, betreff: '   ' }],
    ['kein_text', { ...EINTRAG, eintragstext: '' }],
  ])('%s — vor dem Dienst', async (grund, felder) => {
    const antwort = await POST(anfrage(felder), params);
    expect(antwort.status).toBe(303);
    expect(ziel(antwort)).toBe(`${SEITE}?fehler=${grund}`);
    expect(zustand.schreibeEintrag).not.toHaveBeenCalled();
  });

  it('kein_objekt — eine Schicht ohne Objekt hat kein Wachbuch', async () => {
    zustand.bezug = { ...BEZUG, objektId: null };
    const antwort = await POST(anfrage(EINTRAG), params);
    expect(ziel(antwort)).toBe(`${SEITE}?fehler=kein_objekt`);
    expect(zustand.schreibeEintrag).not.toHaveBeenCalled();
  });

  it.each([
    ['schluessel_fehlt', () => new WachbuchEingabeFehlt('x', 'schluessel_fehlt')],
    ['fremder_schluessel', () => new BezugPasstNichtZumObjekt('schluessel')],
    ['fremder_kontrollpunkt', () => new BezugPasstNichtZumObjekt('kontrollpunkt')],
    ['kein_urheber', () => new KeinUrheber()],
  ])('%s — aus dem Dienst', async (grund, fehler) => {
    zustand.schreibeEintrag.mockRejectedValue(fehler());
    const antwort = await POST(anfrage(EINTRAG), params);
    expect(antwort.status).toBe(303);
    expect(ziel(antwort)).toBe(`${SEITE}?fehler=${grund}`);
  });

  it.each([
    ['foto_zu_gross', () => new MedienFehler('x', 'zu_gross')],
    ['foto_typ_nicht_erlaubt', () => new MedienFehler('x', 'typ_nicht_erlaubt')],
    ['speicher_nicht_verbunden', () => new NichtVerbundenFehler('Der Medienspeicher')],
  ])('%s — aus der Fotoablage', async (grund, fehler) => {
    zustand.legeFotos.mockRejectedValue(fehler());
    const antwort = await POST(anfrage(EINTRAG), params);
    expect(ziel(antwort)).toBe(`${SEITE}?fehler=${grund}`);
  });

  it('zu groß angekündigt: foto_zu_gross, bevor der Rumpf gelesen wird', async () => {
    const antwort = await POST(anfrage(EINTRAG, {
      'content-length': String(MEDIEN_MAX_BYTES + 1),
    }), params);
    expect(ziel(antwort)).toBe(`${SEITE}?fehler=foto_zu_gross`);
    expect(zustand.schreibeEintrag).not.toHaveBeenCalled();
  });

  it('jeder dieser Gründe hat auf der Seite einen Satz — in allen vier Sprachen', () => {
    for (const grund of [
      'unbekannte_art', 'kein_betreff', 'kein_text', 'kein_objekt', 'schluessel_fehlt',
      'fremder_schluessel', 'fremder_kontrollpunkt', 'kein_urheber', 'foto_zu_gross',
      'foto_typ_nicht_erlaubt', 'speicher_nicht_verbunden',
    ]) {
      for (const s of ['de', 'en', 'ar', 'tr'] as const) {
        expect(WACHBUCH_SCHICHT_TEXTE[s].fehler[grund], `${s}: ${grund}`).toMatch(/\S/u);
      }
    }
  });
});
