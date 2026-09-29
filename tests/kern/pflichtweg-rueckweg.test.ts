/**
 * Die zwei Pflichtformulare der Website kommen mit einem GRUND zurück — nie
 * mit einem Satz aus der Adresse (D-769, V-272; D-599, D-728, V-156).
 *
 * **Der Befund.** `POST /api/datenschutz/anfrage` und
 * `POST /api/barrierefreiheit/meldung` schickten eine Abweisung als
 * `?meldung=<Satz>` auf das Formular zurück, und die Seiten zeigten, was dort
 * stand, in ihrem `role="alert"`-Kasten. Jeder präparierte Link schrieb damit
 * seine eigene Systemmeldung — auf dem Weg, den Art. 12 Abs. 2 DSGVO
 * „erleichtert" sehen will, und auf dem Meldeweg des BFSG, beide deutsch und
 * englisch, beide von Kunden und Behörden gelesen. Die zwei Fälle „diese
 * Gesellschaft gibt es nicht" standen als Satz in der Route, ohne Schlüssel.
 *
 * Geprüft wird die ECHTE Route: ersetzt sind nur die Datenbank und ihre zwei
 * Kontexte. Die Dienste `nimmAn` und `melde` laufen echt — gegen einen
 * Schreibkontext, der die Zeile liefert oder nicht. Dazu die Tabelle der
 * Sätze und die gerenderten Seiten.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  PFLICHTWEG_FEHLER_GRUENDE, PFLICHTWEG_FEHLER_TEXTE, type Pflichtweg,
} from '../../src/lib/i18n/texte.js';

/* Die Bauteile erwarten `React` im Geltungsbereich (klassische JSX-Umwandlung, V-153). */
(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  /** Die Gesellschaft zum Slug des Formulars — leer heisst: gibt es nicht. */
  gesellschaften: [] as { id: string }[],
  /** Was `insert … returning` liefert — leer heisst: nicht gespeichert. */
  geschrieben: [] as Record<string, unknown>[],
  /** Ein Wurf der Datenbank, der kein Fehler des Dienstes ist. */
  wurf: null as Error | null,
  /** Die Auswahl der Gesellschaften auf den Seiten. */
  bereiche: [] as { slug: string; name: string }[],
}));

vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/oeffentlich', () => ({
  withOeffentlich: <T,>(_tx: unknown, fn: (k: unknown) => Promise<T>) => fn({
    abfrage: (sql: string) => Promise.resolve(
      /where slug = \$1/u.test(sql) ? zustand.gesellschaften : zustand.bereiche),
  }),
}));
vi.mock('@/server/kontext/eingang', () => ({
  withEingang: <T,>(_tx: unknown, _mandant: string, fn: (k: unknown) => Promise<T>) => fn({
    schreibe: () => (zustand.wurf === null
      ? Promise.resolve(zustand.geschrieben) : Promise.reject(zustand.wurf)),
    abfrage: () => Promise.resolve([]),
  }),
}));
/* Nur die Metadaten lesen den Host; die Seiten selbst nicht. */
vi.mock('@/server/inhalt/seiten-daten', () => ({
  basisAusAnfrage: () => Promise.resolve('https://cse.example'),
}));

const datenschutz = await import('../../src/app/api/datenschutz/anfrage/route.js');
const barriere = await import('../../src/app/api/barrierefreiheit/meldung/route.js');
const { AnfrageSeiteFuer } = await import('../../src/app/(public)/datenschutz/anfrage/Anfrage.js');
const { FeedbackSeiteFuer } =
  await import('../../src/app/(public)/barrierefreiheit/feedback/Feedback.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const MANDANT = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/u;

function post(pfad: string, felder: Readonly<Record<string, string>>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL(pfad, HIER), {
    method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER }),
  });
}

/** Die Gründe, mit denen die Routen in diesem Lauf wirklich zurückkamen — je Weg. */
const gesehen: Record<Pflichtweg, Set<string>> = { anfrage: new Set(), barriere: new Set() };

/** Prüft eine Umleitung auf die Seite: nur `?fehler=<grund>`, sonst nichts aus der Adresse. */
function zurueckMitGrund(
  weg: Pflichtweg, antwort: Response, pfad: string, grund: string,
  eingaben: readonly string[],
): void {
  expect(antwort.status).toBe(303);
  const ort = antwort.headers.get('location') ?? '';
  const ziel = new URL(ort);
  expect(ziel.origin).toBe(HIER);
  expect(ziel.pathname).toBe(pfad);
  expect([...ziel.searchParams.keys()]).toEqual(['fehler']);
  expect(ziel.searchParams.get('fehler')).toBe(grund);
  expect(ort).not.toContain('meldung');
  expect(ort).not.toMatch(UUID);
  for (const e of eingaben) expect(decodeURIComponent(ort), e).not.toContain(e);
  gesehen[weg].add(grund);
}

beforeEach(() => {
  zustand.gesellschaften = [{ id: MANDANT }];
  zustand.geschrieben = [{ id: '00000000-0000-4000-8000-00000000000a', frist_am: new Date() }];
  zustand.wurf = null;
  zustand.bereiche = [{ slug: 'reinigung', name: 'CSE Dienstleistungen GmbH' }];
});

/* ── POST /api/datenschutz/anfrage ──────────────────────────────────────── */

const ANFRAGE_GUT = {
  bereich: 'reinigung', art: 'auskunft', name: 'Erika Muster', email: 'erika@muster.example',
} as const;

/** Je Grund: was ihn auslöst — am echten Dienst oder an der Route. */
const ANFRAGE_FAELLE = [
  ['gesellschaft_fehlt', 404, { bereich: 'gibtsnicht' }, () => { zustand.gesellschaften = []; }],
  ['name_fehlt', 400, { name: '   ' }, () => undefined],
  ['email_ungueltig', 400, { email: 'erika-at-muster' }, () => undefined],
  ['art_fehlt', 400, { art: 'alles_loeschen' }, () => undefined],
  ['nicht_gespeichert', 500, {}, () => { zustand.geschrieben = []; }],
] as const;

describe('POST /api/datenschutz/anfrage — der Rückweg trägt einen Grund', () => {
  it.each(ANFRAGE_FAELLE)('%s → 303 auf das Formular, ?fehler=%s', async (grund, _s, felder, vorher) => {
    vorher();
    const eingabe = { ...ANFRAGE_GUT, ...felder };
    const r = await datenschutz.POST(post('/api/datenschutz/anfrage',
      { ...eingabe, antwort: 'seite', sprache: 'de' }));
    zurueckMitGrund('anfrage', r, '/datenschutz/anfrage', grund,
      [eingabe.name.trim() === '' ? 'Erika' : eingabe.name, eingabe.email]);
  });

  it('die englische Seite bekommt denselben Grund — auf ihrem eigenen Pfad', async () => {
    const r = await datenschutz.POST(post('/api/datenschutz/anfrage',
      { ...ANFRAGE_GUT, email: 'kaputt', antwort: 'seite', sprache: 'en' }));
    zurueckMitGrund('anfrage', r, '/en/datenschutz/anfrage', 'email_ungueltig', ['kaputt']);
  });

  it.each(ANFRAGE_FAELLE)('%s — ein Programm bekommt weiter JSON mit Satz und Status (D-599)',
    async (grund, status, felder, vorher) => {
      for (const sprache of ['de', 'en'] as const) {
        vorher();
        const r = await datenschutz.POST(post('/api/datenschutz/anfrage',
          { ...ANFRAGE_GUT, ...felder, sprache }));
        expect(r.status, sprache).toBe(status);
        expect(r.headers.get('location')).toBeNull();
        /* Deutsch der Satz des Dienstes, englisch der zum Grund — wie vor D-769. */
        expect(await r.json(), sprache).toEqual({
          ok: false, meldung: eigenerEintrag(PFLICHTWEG_FEHLER_TEXTE[sprache].anfrage.fehler, grund),
        });
        zustand.gesellschaften = [{ id: MANDANT }];
        zustand.geschrieben = [{ id: MANDANT, frist_am: new Date() }];
      }
    });

  it('Erfolg: die Dankseite — und ein Programm bekommt `ok`', async () => {
    const seite = await datenschutz.POST(post('/api/datenschutz/anfrage',
      { ...ANFRAGE_GUT, antwort: 'seite', sprache: 'en' }));
    expect(seite.status).toBe(303);
    expect(seite.headers.get('location')).toBe(`${HIER}/en/datenschutz/anfrage/danke`);
    const programm = await datenschutz.POST(post('/api/datenschutz/anfrage', ANFRAGE_GUT));
    expect(await programm.json()).toEqual({ ok: true });
  });

  it('ein Fehler, der keine Abweisung ist, bleibt ein Fehler — keine erfundene Abweisung', async () => {
    zustand.wurf = new Error('connection terminated unexpectedly');
    await expect(datenschutz.POST(post('/api/datenschutz/anfrage',
      { ...ANFRAGE_GUT, antwort: 'seite' }))).rejects.toThrow('connection terminated');
  });
});

/* ── POST /api/barrierefreiheit/meldung ─────────────────────────────────── */

const MELDUNG_GUT = {
  bereich: 'reinigung', beschreibung: 'Das Kontaktformular liest der Screenreader nicht vor.',
  email: 'melder@muster.example',
} as const;

const BARRIERE_FAELLE = [
  ['bereich_fehlt', 404, { bereich: 'gibtsnicht' }, () => { zustand.gesellschaften = []; }],
  ['ohne_beschreibung', 400, { beschreibung: '  ' }, () => undefined],
  ['email_ungueltig', 400, { email: 'melder-at-muster' }, () => undefined],
  ['nicht_gespeichert', 500, {}, () => { zustand.geschrieben = []; }],
] as const;

describe('POST /api/barrierefreiheit/meldung — der Rückweg trägt einen Grund', () => {
  it.each(BARRIERE_FAELLE)('%s → 303 auf das Formular, ?fehler=%s', async (grund, _s, felder, vorher) => {
    vorher();
    const eingabe = { ...MELDUNG_GUT, ...felder };
    const r = await barriere.POST(post('/api/barrierefreiheit/meldung',
      { ...eingabe, antwort: 'seite', sprache: 'de' }));
    zurueckMitGrund('barriere', r, '/barrierefreiheit/feedback', grund,
      [eingabe.email, 'Screenreader']);
  });

  it('die englische Seite bekommt denselben Grund — auf ihrem eigenen Pfad', async () => {
    zustand.gesellschaften = [];
    const r = await barriere.POST(post('/api/barrierefreiheit/meldung',
      { ...MELDUNG_GUT, bereich: 'x', antwort: 'seite', sprache: 'en' }));
    zurueckMitGrund('barriere', r, '/en/barrierefreiheit/feedback', 'bereich_fehlt', []);
  });

  it.each(BARRIERE_FAELLE)('%s — ein Programm bekommt weiter JSON mit Satz und Status (D-599)',
    async (grund, status, felder, vorher) => {
      for (const sprache of ['de', 'en'] as const) {
        vorher();
        const r = await barriere.POST(post('/api/barrierefreiheit/meldung',
          { ...MELDUNG_GUT, ...felder, sprache }));
        expect(r.status, sprache).toBe(status);
        expect(await r.json(), sprache).toEqual({
          ok: false,
          meldung: eigenerEintrag(PFLICHTWEG_FEHLER_TEXTE[sprache].barriere.fehler, grund),
        });
        zustand.gesellschaften = [{ id: MANDANT }];
        zustand.geschrieben = [{ id: MANDANT }];
      }
    });

  it('Erfolg: dieselbe Seite mit dem Schlüssel `ok=1` — und ein Programm bekommt `ok`', async () => {
    const seite = await barriere.POST(post('/api/barrierefreiheit/meldung',
      { ...MELDUNG_GUT, antwort: 'seite', sprache: 'de' }));
    expect(seite.status).toBe(303);
    expect(seite.headers.get('location')).toBe(`${HIER}/barrierefreiheit/feedback?ok=1`);
    const programm = await barriere.POST(post('/api/barrierefreiheit/meldung', MELDUNG_GUT));
    expect(await programm.json()).toEqual({ ok: true });
  });

  it('ein Fehler, der keine Abweisung ist, bleibt ein Fehler', async () => {
    zustand.wurf = new Error('relation "barrierebericht" does not exist');
    await expect(barriere.POST(post('/api/barrierefreiheit/meldung',
      { ...MELDUNG_GUT, antwort: 'seite' }))).rejects.toThrow('does not exist');
  });
});

/* ── Die Sätze ───────────────────────────────────────────────────────────── */

describe('die Sätze', () => {
  it('jeder Grund, mit dem die Routen zurückkamen, steht in der Liste — und keiner mehr', () => {
    /* Die Fälle oben laufen durch den echten Dienst: was er wirft, ist genau das hier. */
    expect([...gesehen.anfrage].sort()).toEqual([...PFLICHTWEG_FEHLER_GRUENDE.anfrage].sort());
    expect([...gesehen.barriere].sort()).toEqual([...PFLICHTWEG_FEHLER_GRUENDE.barriere].sort());
  });

  it('jeder Grund hat in beiden Sprachen einen Satz — ohne Kennung, ohne Platzhalter', () => {
    for (const weg of ['anfrage', 'barriere'] as const) {
      for (const sprache of ['de', 'en'] as const) {
        const t = PFLICHTWEG_FEHLER_TEXTE[sprache][weg];
        expect(t.sonst.trim(), `${sprache}.${weg}.sonst`).not.toBe('');
        expect(Object.keys(t.fehler).sort()).toEqual([...PFLICHTWEG_FEHLER_GRUENDE[weg]].sort());
        for (const g of PFLICHTWEG_FEHLER_GRUENDE[weg]) {
          const satz = eigenerEintrag(t.fehler, g);
          expect(satz?.trim(), `${sprache}.${weg}.${g}`).toBeTruthy();
          expect(satz, `${sprache}.${weg}.${g}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|_/u);
          if (sprache === 'en') {
            expect(satz).not.toBe(eigenerEintrag(PFLICHTWEG_FEHLER_TEXTE.de[weg].fehler, g));
          }
        }
      }
    }
  });

  it('ein fremder Grund aus der Adresse wird kein Satz — und kein Prototyp-Treffer', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'sonst', 'Hallo Welt', '']) {
      for (const sprache of ['de', 'en'] as const) {
        expect(eigenerEintrag(PFLICHTWEG_FEHLER_TEXTE[sprache].anfrage.fehler, k), k).toBeUndefined();
        expect(eigenerEintrag(PFLICHTWEG_FEHLER_TEXTE[sprache].barriere.fehler, k), k).toBeUndefined();
      }
    }
  });
});

/* ── Die Seiten ──────────────────────────────────────────────────────────── */

/**
 * Der Text im Kasten mit `role="…"` — `null`, wenn es keinen gibt.
 *
 * Der Kasten ist ein `Hinweis` (DESIGN §5 „Notices", Nachrunde zu V-272): eine
 * Abweisung `warnung` mit `role="alert"`, der Dank `erfolg` mit
 * `role="status"`. Hier stand ein nachgebautes `<p role="…">`; geprüft wird
 * jetzt beides zusammen, Rolle und Art.
 */
function kasten(html: string, rolle: 'alert' | 'status'): string | null {
  const m = new RegExp(
    `<section data-cse="[^"]+" data-art="([a-z]+)" role="${rolle}"[^>]*>([^<]*)</section>`, 'u')
    .exec(html);
  if (m === null) return null;
  expect(m[1], `der Kasten mit role="${rolle}"`).toBe(rolle === 'alert' ? 'warnung' : 'erfolg');
  return m[2] ?? null;
}
const entities = (s: string | null): string | null =>
  s?.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&amp;/gu, '&') ?? null;

describe('die Seiten zeigen nur den nachgeschlagenen Satz', () => {
  it.each(['de', 'en'] as const)('/datenschutz/anfrage (%s): Grund → Satz der Seite', async (sprache) => {
    const t = PFLICHTWEG_FEHLER_TEXTE[sprache].anfrage;
    for (const g of PFLICHTWEG_FEHLER_GRUENDE.anfrage) {
      const html = renderToStaticMarkup(await AnfrageSeiteFuer(sprache, { fehler: g }));
      expect(entities(kasten(html, 'alert')), g).toBe(t.fehler[g]);
    }
  });

  it.each(['de', 'en'] as const)('/barrierefreiheit/feedback (%s): Grund → Satz, ok=1 → Dank',
    async (sprache) => {
      const t = PFLICHTWEG_FEHLER_TEXTE[sprache].barriere;
      for (const g of PFLICHTWEG_FEHLER_GRUENDE.barriere) {
        const html = renderToStaticMarkup(await FeedbackSeiteFuer(sprache, { fehler: g }));
        expect(entities(kasten(html, 'alert')), g).toBe(t.fehler[g]);
        expect(kasten(html, 'status')).toBeNull();
      }
      const dank = renderToStaticMarkup(await FeedbackSeiteFuer(sprache, { ok: '1' }));
      expect(kasten(dank, 'status')).toBe(sprache === 'en'
        ? 'Thank you. Your report has arrived.' : 'Vielen Dank. Ihre Meldung ist angekommen.');
      expect(kasten(dank, 'alert')).toBeNull();
    });

  it('ein unbekannter Grund ergibt den allgemeinen Satz — nie sich selbst, nie Text aus der Adresse',
    async () => {
      for (const sprache of ['de', 'en'] as const) {
        for (const fremd of ['__proto__', 'constructor', 'Ihr Konto ist gesperrt', '']) {
          const a = renderToStaticMarkup(await AnfrageSeiteFuer(sprache, { fehler: fremd }));
          expect(entities(kasten(a, 'alert')), fremd)
            .toBe(PFLICHTWEG_FEHLER_TEXTE[sprache].anfrage.sonst);
          expect(a).not.toContain('gesperrt');
          const b = renderToStaticMarkup(await FeedbackSeiteFuer(sprache, { fehler: fremd }));
          expect(entities(kasten(b, 'alert')), fremd)
            .toBe(PFLICHTWEG_FEHLER_TEXTE[sprache].barriere.sonst);
          expect(b).not.toContain('gesperrt');
        }
      }
    });

  it('`?meldung=` wird nicht mehr gelesen — kein Kasten, kein Text', async () => {
    const falsch = 'Ihre Daten wurden gelöscht. Rufen Sie 0900 123 an.';
    for (const sprache of ['de', 'en'] as const) {
      const a = renderToStaticMarkup(await AnfrageSeiteFuer(sprache, { meldung: falsch }));
      const b = renderToStaticMarkup(await FeedbackSeiteFuer(sprache, { meldung: falsch, ok: 'ja' }));
      for (const html of [a, b]) {
        expect(html).not.toContain('0900');
        expect(kasten(html, 'alert')).toBeNull();
        expect(kasten(html, 'status')).toBeNull();
        expect(html).not.toMatch(/role="(?:alert|status)"/u);
      }
    }
  });

  const P = 'src/app/(public)';
  it.each([
    `${P}/datenschutz/anfrage/page.tsx`, `${P}/en/datenschutz/anfrage/page.tsx`,
    `${P}/datenschutz/anfrage/Anfrage.tsx`,
    `${P}/barrierefreiheit/feedback/page.tsx`, `${P}/en/barrierefreiheit/feedback/page.tsx`,
    `${P}/barrierefreiheit/feedback/Feedback.tsx`,
  ])('%s liest `meldung` nicht', (datei) => {
    const s = readFileSync(join(WURZEL, datei), 'utf8');
    expect(s).not.toMatch(/\[\s*'meldung'\s*\]|suche\.meldung|searchParams\.meldung/u);
  });

  it('die Bauteile schlagen nur als eigenen Eintrag nach', () => {
    expect(readFileSync(join(WURZEL, P, 'datenschutz/anfrage/Anfrage.tsx'), 'utf8'))
      .toContain('eigenerEintrag(fehlerTexte.fehler, fehler) ?? fehlerTexte.sonst');
    expect(readFileSync(join(WURZEL, P, 'barrierefreiheit/feedback/Feedback.tsx'), 'utf8'))
      .toContain('eigenerEintrag(fehlerTexte.fehler, fehler) ?? fehlerTexte.sonst');
  });

  it.each([
    'src/app/api/datenschutz/anfrage/route.ts', 'src/app/api/barrierefreiheit/meldung/route.ts',
  ])('%s baut keine Adresse mit einem Satz', (datei) => {
    const s = readFileSync(join(WURZEL, datei), 'utf8');
    expect(s).not.toMatch(/meldung=/u);
    expect(s).not.toMatch(/encodeURIComponent\(/u);
  });
});
