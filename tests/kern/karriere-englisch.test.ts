/**
 * **Der Karrierebereich englisch** (V-393, D-82, D-83, D-807).
 *
 * Bis hierher stand `/karriere` in `NUR_DEUTSCH`: eine Bewerberin, die auf
 * Englisch las, landete auf der deutschen Seite. Jetzt gibt es den Baum unter
 * `/en/karriere` — dieselben Bauteile (`karriere/Seiten.tsx`), die Sätze aus
 * `karriere/texte.ts`, dieselben Formularfelder.
 *
 * Geprüft wird, dass beide Sprachen dieselben Sätze kennen, dass die englische
 * Seite in ihrer Sprache bleibt (Verweise, Formular, Rückweg der Route) — und
 * dass sie den Anzeigentext nicht als übersetzt ausgibt: er trägt `lang="de"`,
 * und ein Satz sagt, warum.
 */
import * as React from 'react';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;

const STELLE = {
  id: '3f2a8c1e-0b7d-4e59-9a61-2d4c8e7f1a0b',
  titel: 'Objektleitung Unterhaltsreinigung',
  beschreibung: 'Sie führen ein Team in Berlin-Mitte.',
  anforderungen: ['Führerschein Klasse B'],
  einsatzort: 'Berlin',
  wochenstunden: '39.5',
  bewerbungsfrist: '2026-11-30',
  mandantSlug: 'reinigung',
  mandantName: 'CSE Dienstleistungen GmbH',
};

vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/inhalt/lesen', () => ({
  oeffentlichLesen: () => Promise.resolve(180),
}));
vi.mock('@/server/inhalt/seiten-daten', () => ({
  basisAusAnfrage: () => Promise.resolve('https://cse.example'),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));
vi.mock('../../src/app/(public)/karriere/daten.js', () => ({
  offeneStellen: () => Promise.resolve([STELLE]),
  offeneStelle: () => Promise.resolve(STELLE),
  bereiche: () => Promise.resolve([{ slug: 'reinigung', name: 'CSE Dienstleistungen GmbH' }]),
  aufbewahrungsfristTage: () => Promise.resolve(180),
}));

const { KARRIERE_TEXTE } = await import('../../src/app/(public)/karriere/texte.js');
const {
  BEWERBUNG_MELDUNG, BEWERBUNG_MELDUNG_EN, bewerbungsMeldung,
} = await import('../../src/app/(public)/karriere/meldung.js');
const { Bewerbungsformular } = await import('../../src/app/(public)/karriere/Formular.js');
const { default: EnglishCareers } = await import('../../src/app/(public)/en/karriere/page.js');
const { default: KarriereSeite } = await import('../../src/app/(public)/karriere/page.js');
const { default: EnglishPosition } =
  await import('../../src/app/(public)/en/karriere/[stelle]/page.js');
const { default: EnglishThankYou } =
  await import('../../src/app/(public)/en/karriere/danke/page.js');
const { POST: bewerbung } = await import('../../src/app/api/karriere/bewerbung/route.js');
const { NUR_DEUTSCH, gibtEsIn } = await import('../../src/lib/sprache.js');

function formularPost(felder: Readonly<Record<string, string>>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.set(k, v);
  return new NextRequest('https://cse.example/api/karriere/bewerbung', {
    method: 'POST', body: daten, headers: { origin: 'https://cse.example' },
  });
}

describe('dieselben Sätze in beiden Sprachen', () => {
  it('jede Zeile der Tabelle steht deutsch und englisch, und keine ist leer', () => {
    const de = KARRIERE_TEXTE.de as unknown as Record<string, unknown>;
    const en = KARRIERE_TEXTE.en as unknown as Record<string, unknown>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    for (const [schluessel, wert] of Object.entries(en)) {
      const probe = typeof wert === 'function' ? (wert as (x: never) => string)(2 as never) : wert;
      expect(probe, schluessel).toBeTruthy();
    }
    // Nur die englische Seite braucht den Satz über die Sprache der Anzeigen.
    expect(KARRIERE_TEXTE.de.stellenSprache).toBeNull();
    expect(KARRIERE_TEXTE.en.stellenSprache).toMatch(/German/u);
  });

  it('die Abweisungen: dieselben Gründe, englische Sätze, ein fremder Grund wird der allgemeine', () => {
    expect(Object.keys(BEWERBUNG_MELDUNG_EN).sort()).toEqual(Object.keys(BEWERBUNG_MELDUNG).sort());
    for (const grund of Object.keys(BEWERBUNG_MELDUNG)) {
      expect(bewerbungsMeldung(grund, 'en'), grund).toBe(BEWERBUNG_MELDUNG_EN[grund]);
      expect(bewerbungsMeldung(grund), grund).toBe(BEWERBUNG_MELDUNG[grund]);
    }
    expect(bewerbungsMeldung('__proto__', 'en')).toBe(bewerbungsMeldung('sonst', 'en'));
    expect(bewerbungsMeldung('sonst', 'en')).toMatch(/has not arrived/u);
    expect(bewerbungsMeldung('', 'en')).toBeUndefined();
  });
});

describe('die englische Seite bleibt englisch', () => {
  it('/karriere steht nicht mehr in NUR_DEUTSCH', () => {
    expect(NUR_DEUTSCH).not.toContain('/karriere');
    expect(gibtEsIn('/karriere/eine-stelle/bewerbung', 'en')).toBe(true);
  });

  it('die Liste: englische Sätze, Verweise unter /en, der Anzeigentitel mit lang="de"', async () => {
    const html = renderToStaticMarkup(await EnglishCareers({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<h1 class="m-0 text-display text-text">Careers</h1>');
    expect(html).toContain('One open position');
    expect(html).toContain(`href="/en/karriere/${STELLE.id}"`);
    expect(html).toContain('href="/en/karriere?bereich=reinigung"');
    expect(html).toContain('href="/en/karriere/initiativbewerbung"');
    expect(html).toContain('data-cse="stellen-sprache"');
    expect(html).toMatch(/<h3 class="[^"]*" lang="de">/u);
    expect(html).toContain('39.5 h/week');
    expect(html).not.toContain('href="/karriere');
  });

  it('die deutsche Liste bleibt, wie sie war — ohne lang-Markierung und ohne /en', async () => {
    const html = renderToStaticMarkup(await KarriereSeite({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Eine offene Stelle');
    expect(html).toContain(`href="/karriere/${STELLE.id}"`);
    expect(html).toContain('39,5 h/Woche');
    expect(html).not.toContain('lang="de"');
    expect(html).not.toContain('/en/');
    expect(html).not.toContain('data-cse="stellen-sprache"');
  });

  it('eine Abweisung steht englisch über der Liste', async () => {
    const html = renderToStaticMarkup(await EnglishCareers({
      searchParams: Promise.resolve({ fehler: 'stelle_geschlossen' }),
    }));
    expect(html).toContain('This position is no longer advertised');
  });

  it('das Stellenblatt: Anzeigentext mit lang="de", der Weg zur Bewerbung unter /en', async () => {
    const html = renderToStaticMarkup(await EnglishPosition({
      params: Promise.resolve({ stelle: STELLE.id }),
    }));
    expect(html).toContain('What we expect');
    expect(html).toContain(`href="/en/karriere/${STELLE.id}/bewerbung"`);
    expect(html).toMatch(/<section class="[^"]*" lang="de">Sie führen/u);
    expect(html).toContain('Apply by 2026-11-30');
  });

  it('die Dankesseite nennt die Frist englisch', async () => {
    const html = renderToStaticMarkup(await EnglishThankYou());
    expect(html).toContain('Your application has arrived.');
    // V-365: die Absage zählt, ohne Entscheidung der Eingang.
    expect(html).toContain('180 days after a rejection');
    expect(html).toContain('180 days after receipt');
    expect(html).toContain('href="/en/datenschutz"');
  });

  it('das Formular: dieselben Felder, englische Beschriftung, `sprache=en` für den Rückweg', () => {
    const html = renderToStaticMarkup(createElement(Bewerbungsformular, {
      stelleId: null, aufbewahrungTage: 180, sprache: 'en',
      bereiche: [{ slug: 'reinigung', name: 'CSE Dienstleistungen GmbH' }],
    }));
    expect(html).toContain('<input type="hidden" name="sprache" value="en"/>');
    expect(html).toContain('Submit application');
    expect(html).toContain('href="/en/datenschutz"');
    for (const feld of ['name="name"', 'name="email"', 'name="telefon"', 'name="nachricht"',
      'name="bereich"', 'name="antwort"']) expect(html, feld).toContain(feld);
    // Deutsch schickt kein Sprachfeld — der Rückweg ist dort die Vorgabe.
    const deutsch = renderToStaticMarkup(createElement(Bewerbungsformular, {
      stelleId: null, aufbewahrungTage: 180,
    }));
    expect(deutsch).not.toContain('name="sprache"');
    expect(deutsch).toContain('href="/datenschutz"');
  });
});

describe('die Route führt in die Sprache des Formulars zurück', () => {
  it('ohne Bereich: zurück auf /en/karriere/initiativbewerbung', async () => {
    const antwort = await bewerbung(formularPost({
      antwort: 'seite', sprache: 'en', bereich: '', name: 'Ada', email: 'ada@firma.de',
    }));
    expect(antwort.status).toBe(303);
    const ziel = new URL(antwort.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/en/karriere/initiativbewerbung');
    expect(ziel.searchParams.get('fehler')).toBe('kein_bereich');
  });

  it('der Honigtopf führt auf die englische Dankseite', async () => {
    const antwort = await bewerbung(formularPost({
      antwort: 'seite', sprache: 'en', webseite: 'https://spam.example',
    }));
    expect(new URL(antwort.headers.get('location') ?? '').pathname).toBe('/en/karriere/danke');
  });

  it('auch die JSON-Antwort spricht die Sprache des Formulars', async () => {
    const antwort = await bewerbung(formularPost({
      sprache: 'en', bereich: '', name: 'Ada', email: 'ada@firma.de',
    }));
    expect(antwort.status).toBe(400);
    const koerper = await antwort.json() as { fehler: string; meldung: string };
    expect(koerper.fehler).toBe('kein_bereich');
    expect(koerper.meldung).toBe(bewerbungsMeldung('kein_bereich', 'en'));
    expect(koerper.meldung).not.toBe(bewerbungsMeldung('kein_bereich'));
  });

  it('eine unbekannte Sprache ist Deutsch', async () => {
    const antwort = await bewerbung(formularPost({
      antwort: 'seite', sprache: 'fr', webseite: 'https://spam.example',
    }));
    expect(new URL(antwort.headers.get('location') ?? '').pathname).toBe('/karriere/danke');
  });
});
