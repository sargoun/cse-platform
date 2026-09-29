/**
 * Was am `<html>` steht (WCAG 3.1.1; D-767, V-257): die Sprache des Pfads auf
 * der Website (`/en/…` englisch), die des Geräts auf Anmeldung und
 * Stempeluhr der Beschäftigten — samt `dir` —, und im Portal der Pfad, weil
 * dort die Hülle die Sitzung ansagt (`tests/kern/seitensprache.test.ts`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GERAETE_FLAECHEN, htmlSprache, sprichtGeraetesprache,
} from '../../src/lib/i18n/html-sprache.js';

const zustand = vi.hoisted(() => ({
  koepfe: new Headers(),
  kekse: new Map<string, string>(),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(zustand.koepfe),
  cookies: () => Promise.resolve({
    get: (name: string) => {
      const wert = zustand.kekse.get(name);
      return wert === undefined ? undefined : { name, value: wert };
    },
  }),
}));

/* Das Layout erwartet `React` im Geltungsbereich (klassische JSX-Umwandlung, V-153). */
(globalThis as { React?: typeof React }).React = React;

const WURZEL = resolve(import.meta.dirname, '../..');

describe('(1) htmlSprache: drei Arten von Seiten, drei Quellen', () => {
  const html = (pfad: string | null, pfadSprache: string | null,
    keks?: string, acceptLanguage: string | null = null) =>
    htmlSprache({ pfad, pfadSprache, keks, acceptLanguage });

  it('die Website: der Pfad — /en/… englisch, sonst deutsch, ohne Kopf deutsch', () => {
    expect(html('/', 'de')).toEqual({ lang: 'de-DE' });
    expect(html('/kontakt', 'en')).toEqual({ lang: 'en' });
    expect(html(null, null)).toEqual({ lang: 'de-DE' });
    expect(html('/kontakt', 'fr')).toEqual({ lang: 'de-DE' });
  });

  it('die Anmeldung der Verwaltung ist deutsch — ein Sprachkeks ändert daran nichts', () => {
    expect(html('/auth/login', 'de', 'ar', 'ar-EG')).toEqual({ lang: 'de-DE' });
  });

  it('Anmeldung der Beschäftigten und Stempeluhr: die Sprache des Geräts, mit dir', () => {
    expect(html('/auth/mitarbeiter', 'de', 'ar')).toEqual({ lang: 'ar', dir: 'rtl' });
    expect(html('/auth/mitarbeiter/code', 'de', undefined, 'tr-TR,tr;q=0.9,en;q=0.8'))
      .toEqual({ lang: 'tr', dir: 'ltr' });
    expect(html('/check-in/5b0d6c1e', 'de', undefined, 'en-GB')).toEqual({ lang: 'en', dir: 'ltr' });
    expect(html('/check-in/5b0d6c1e', 'de')).toEqual({ lang: 'de-DE', dir: 'ltr' });
    /* Der Keks geht vor dem Telefon (D-694). */
    expect(html('/auth/mitarbeiter', 'de', 'en', 'ar-EG')).toEqual({ lang: 'en', dir: 'ltr' });
  });

  it('nur genau diese Seiten — eine Adresse daneben (die deutsche 404) bleibt beim Pfad', () => {
    expect(html('/auth/mitarbeiter/unsinn', 'de', 'ar')).toEqual({ lang: 'de-DE' });
    expect(html('/check-in', 'de', 'ar')).toEqual({ lang: 'de-DE' });
    expect(html('/auth/mitarbeiterin', 'de', 'ar')).toEqual({ lang: 'de-DE' });
  });

  it('das Portal bleibt beim Pfad: seine Sprache sagt die Hülle an, die die Sitzung kennt', () => {
    expect(html('/portal/reinigung/finanzen', 'de', 'en', 'en')).toEqual({ lang: 'de-DE' });
    expect(html('/portal/mein', 'de', 'ar', 'ar')).toEqual({ lang: 'de-DE' });
  });
});

describe('(2) die Liste der Flächen mit Gerätesprache hält gegen den Baum', () => {
  function seiten(verzeichnis: string): string[] {
    const treffer: string[] = [];
    for (const eintrag of readdirSync(verzeichnis)) {
      const voll = join(verzeichnis, eintrag);
      if (statSync(voll).isDirectory()) treffer.push(...seiten(voll));
      else if (eintrag === 'page.tsx') treffer.push(relative(WURZEL, voll));
    }
    return treffer;
  }
  const adresse = (datei: string): string => datei.replace(/^src\/app/u, '')
    .replace(/\/page\.tsx$/u, '').replace(/\/\([^/]+\)/gu, '').replace(/\[[^\]]+\]/gu, 'x');
  const mitGeraetesprache = seiten(join(WURZEL, 'src/app'))
    .filter((d) => readFileSync(join(WURZEL, d), 'utf8').includes('geraeteSprache('));

  it('jede Seite, die geraeteSprache ruft, trägt sie auch am <html>', () => {
    expect(mitGeraetesprache.length).toBeGreaterThanOrEqual(3);
    const ohne = mitGeraetesprache.filter((d) => !sprichtGeraetesprache(adresse(d)));
    expect(ohne).toEqual([]);
  });

  it('und jede Fläche der Liste ist eine solche Seite — die Liste wächst nicht still', () => {
    for (const muster of GERAETE_FLAECHEN) {
      expect(mitGeraetesprache.some((d) => muster.test(adresse(d))), String(muster)).toBe(true);
    }
  });
});

describe('(3) das Wurzel-Layout und die Middleware', () => {
  beforeEach(() => {
    zustand.koepfe = new Headers();
    zustand.kekse = new Map();
  });

  const layout = async (): Promise<{ lang?: string; dir?: string }> => {
    const { default: RootLayout } = await import('../../src/app/layout.js');
    const element = await RootLayout({ children: null });
    return element.props as { lang?: string; dir?: string };
  };

  it('die Middleware legt Sprache und Pfad ohne Präfix in die Köpfe der Anfrage', async () => {
    const { middleware } = await import('../../src/middleware.js');
    const antwort = middleware(new NextRequest('https://cse.example/en/kontakt'));
    expect(antwort.headers.get('x-middleware-request-x-cse-sprache')).toBe('en');
    expect(antwort.headers.get('x-middleware-request-x-cse-pfad')).toBe('/kontakt');
  });

  it('/en/…: lang="en", ohne dir', async () => {
    zustand.koepfe = new Headers({ 'x-cse-sprache': 'en', 'x-cse-pfad': '/kontakt' });
    expect(await layout()).toMatchObject({ lang: 'en' });
    expect((await layout()).dir).toBeUndefined();
  });

  it('die Anmeldung der Beschäftigten auf einem arabischen Gerät: lang="ar" dir="rtl"', async () => {
    zustand.koepfe = new Headers({
      'x-cse-sprache': 'de', 'x-cse-pfad': '/auth/mitarbeiter', 'accept-language': 'de-DE',
    });
    zustand.kekse.set('cse_sprache', 'ar');
    expect(await layout()).toEqual(expect.objectContaining({ lang: 'ar', dir: 'rtl' }));
  });

  it('das Portal: der Pfad, also de-DE — auch mit einem Sprachkeks', async () => {
    zustand.koepfe = new Headers({ 'x-cse-sprache': 'de', 'x-cse-pfad': '/portal/reinigung' });
    zustand.kekse.set('cse_sprache', 'en');
    expect(await layout()).toMatchObject({ lang: 'de-DE' });
  });
});
