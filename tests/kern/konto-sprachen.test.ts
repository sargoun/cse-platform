/**
 * Die Kontoseiten der Arbeiterhülle sprechen die vier Sprachen (V-200, EMP-12,
 * SEITENKARTE §12).
 *
 * Die Kontowurzel war laut eigenem Kommentar deutsch, „bis das Profil gebaut
 * ist" — das Profil gibt es seit D-557. Die Benachrichtigungseinstellungen
 * waren fest deutsch und trugen den Schlüssel jeder Art als Überschrift.
 * Der Kalender-Feed, auf den die übersetzte Wurzel verweist, blieb danach als
 * einzige verlinkte Kontoseite deutsch — mit genau der Warnung, dass die
 * Adresse ein Zugang ohne Anmeldung ist (D-750).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KALENDER_FEED_TEXTE, KONTO_BENACHRICHTIGUNG_TEXTE, KONTO_WURZEL_TEXTE,
} from '../../src/lib/i18n/konto.js';
import { UEBERSETZUNG_AUSNAHMEN } from '../../scripts/guards/uebersetzung-ausnahmen.js';
import { PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';
import { alleArten, modulVon } from '../../src/server/benachrichtigung/bootstrap.js';
import type { BenachrichtigungsKontext } from '../../src/server/benachrichtigung/registry.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const quelle = (pfad: string): string => readFileSync(join(WURZEL, pfad), 'utf8');

function flach(wert: object): Readonly<Record<string, string>> {
  const raus: Record<string, string> = {};
  for (const [k, v] of Object.entries(wert)) if (typeof v === 'string') raus[k] = v;
  return raus;
}

const BEISPIEL: BenachrichtigungsKontext = {
  mandantId: '', mandantSlug: null, sprache: 'de', objektTyp: 'beispiel', objektId: '', daten: {},
};
const hinten = (schluessel: string): string => schluessel.split('.')[1] ?? '';
/** Dieselbe Regel wie die Seite und V-102: ein Ziel unter `/portal/mein`. */
const arbeiterArten = () =>
  alleArten().filter((a) => (a.ziel(BEISPIEL) ?? '').startsWith('/portal/mein'));

describe('die Kontowurzel', () => {
  it('jede Sprache trägt jedes Wort, und nur Deutsch ist deutsch', () => {
    const de = flach(KONTO_WURZEL_TEXTE.de);
    expect(Object.keys(de).length).toBeGreaterThan(15);
    for (const s of PORTAL_SPRACHEN) {
      const t = flach(KONTO_WURZEL_TEXTE[s]);
      expect(Object.keys(t).sort(), s).toEqual(Object.keys(de).sort());
      for (const [k, v] of Object.entries(t)) expect(v.trim(), `${s}.${k}`).not.toBe('');
      if (s === 'de') continue;
      /* Eigennamen und Formate dürfen gleich sein — „Name" heisst englisch so. */
      const gleich = Object.keys(de).filter((k) => t[k] === de[k] && !['name', 'profil'].includes(k));
      expect(gleich, s).toEqual([]);
    }
  });

  it('die Seite folgt der Sprache der Beschäftigten und zeigt die Rolle beim Namen', () => {
    const s = quelle('src/app/portal/konto/[[...rest]]/page.tsx');
    expect(s).toContain('KONTO_WURZEL_TEXTE[sprache]');
    expect(s).toContain('dir={PORTAL_RICHTUNG[sprache]}');
    expect(s).not.toMatch(/bis das Profil[\s\S]{0,40}gebaut ist \(D-419\)/u);
    expect(s).toContain('k.rolleName');
    expect(s).not.toMatch(/wert=\{k\.rolle \?\?/u);
  });
});

describe('die Benachrichtigungseinstellungen', () => {
  it('es gibt Arten, die das Arbeiterportal erreichen', () => {
    expect(arbeiterArten().length).toBeGreaterThanOrEqual(3);
  });

  it('jede Art hat einen deutschen Namen — nie den Schlüssel', () => {
    for (const a of alleArten()) {
      expect(KONTO_BENACHRICHTIGUNG_TEXTE.de.art[hinten(a.schluessel)], a.schluessel)
        .toBeTruthy();
      expect(KONTO_BENACHRICHTIGUNG_TEXTE.de.modul[modulVon(a.schluessel)], a.schluessel)
        .toBeTruthy();
    }
  });

  it('jede Art, die eine Beschäftigte erreicht, heisst in jeder Sprache — samt Modul', () => {
    for (const s of PORTAL_SPRACHEN) {
      const t = KONTO_BENACHRICHTIGUNG_TEXTE[s];
      for (const a of arbeiterArten()) {
        expect(t.art[hinten(a.schluessel)], `${s}: ${a.schluessel}`).toBeTruthy();
        expect(t.modul[modulVon(a.schluessel)], `${s}: ${a.schluessel}`).toBeTruthy();
        if (s !== 'de') {
          expect(t.art[hinten(a.schluessel)], `${s}: ${a.schluessel}`)
            .not.toBe(KONTO_BENACHRICHTIGUNG_TEXTE.de.art[hinten(a.schluessel)]);
        }
      }
      const de = flach(KONTO_BENACHRICHTIGUNG_TEXTE.de);
      const eigene = flach(t);
      expect(Object.keys(eigene).sort(), s).toEqual(Object.keys(de).sort());
      expect(eigene['kanaeleFuer'], s).toContain('{art}');
    }
  });

  it('die Seite zeigt Namen statt Schlüssel und der Arbeiterhülle nur ihre Arten', () => {
    const s = quelle('src/app/portal/konto/benachrichtigungen/page.tsx');
    expect(s).not.toContain("{a.schluessel.split('.')[1]}");
    expect(s).toContain('artName(a)');
    expect(s).toContain("startsWith('/portal/mein')");
    /* Was die Hülle nicht zeigt, behält seine Wahl. */
    expect(s).toMatch(/verborgen\.map/u);
  });
});

describe('der Kalender-Feed (D-750)', () => {
  /* Formate, die in jeder Sprache gleich lauten dürfen. */
  const FORMAT = ['abrufe'];

  it('jede Sprache trägt jedes Wort, und nur Deutsch ist deutsch', () => {
    const de = flach(KALENDER_FEED_TEXTE.de);
    expect(Object.keys(de).length).toBeGreaterThan(15);
    for (const s of PORTAL_SPRACHEN) {
      const t = flach(KALENDER_FEED_TEXTE[s]);
      expect(Object.keys(t).sort(), s).toEqual(Object.keys(de).sort());
      for (const [k, v] of Object.entries(t)) expect(v.trim(), `${s}.${k}`).not.toBe('');
      expect(t['abrufe'], s).toContain('{anzahl}');
      if (s === 'de') continue;
      const gleich = Object.keys(de).filter((k) => t[k] === de[k] && !FORMAT.includes(k));
      expect(gleich, s).toEqual([]);
    }
  });

  it('die Warnung sagt in jeder Sprache, dass die Adresse ohne Anmeldung gilt', () => {
    /* Der Satz, um dessentwillen die Seite übersetzt ist — nie leer, nie kurz. */
    for (const s of PORTAL_SPRACHEN) {
      expect(KALENDER_FEED_TEXTE[s].warnungText.length, s).toBeGreaterThan(80);
    }
    expect(KALENDER_FEED_TEXTE.de.warnungText).toContain('ohne Anmeldung');
    expect(KALENDER_FEED_TEXTE.en.warnungText).toContain('without signing in');
  });

  it('die Seite folgt in der Arbeiterhülle der Sprache der Person, die Verwaltung liest Deutsch', () => {
    const s = quelle('src/app/portal/konto/kalender-feed/page.tsx');
    expect(s).toMatch(/const sprache: PortalSprache = arbeiter \? \(k\.sprache \?\? 'de'\) : 'de';/u);
    expect(s).toContain('KALENDER_FEED_TEXTE[sprache]');
    expect(s).toContain('lang={PORTAL_BCP47[sprache]}');
    expect(s).toContain('dir={PORTAL_RICHTUNG[sprache]}');
    expect(s).toContain('beschriftungen: meinBeschriftungen(meine)');
    /* Zeitpunkte in der gesetzlichen Form, nicht fest `de-DE` und nicht in der Portalsprache. */
    expect(s).toContain('zeitpunktInSprache(');
    expect(s).not.toMatch(/Intl\.DateTimeFormat/u);
    /* Fliesstext der Beschäftigten in 16 px (DESIGN §8). */
    expect(s).toMatch(/const klein = arbeiter \? 'text-base' : 'text-sm';/u);
    expect(s).toMatch(/const kleiner = arbeiter \? 'text-base' : 'text-xs';/u);
    expect(s).toMatch(/groesse=\{groesse\}/u);
    /* Die Adresse bleibt von links nach rechts, auch in einem rtl-Satz. */
    expect(s).toMatch(/data-cse="feed-adresse" dir="ltr"/u);
  });

  it('keine Kontoseite, auf die die Wurzel verweist, steht noch auf der Ausnahmeliste der Wache', () => {
    const wurzel = quelle('src/app/portal/konto/[[...rest]]/page.tsx');
    const ziele = [...wurzel.matchAll(/ziel: '(\/portal\/konto\/[a-z-]+)'/gu)].map((m) => m[1]);
    expect(ziele).toContain('/portal/konto/kalender-feed');
    for (const ziel of ziele) {
      const datei = `src/app${String(ziel)}/page.tsx`;
      /* Das Profil trägt seine vier Sprachen als Tabelle im Rumpf — die Wache
         sieht sie als feste Zeichenketten; übersetzt ist es trotzdem (D-557). */
      if (datei.endsWith('/profil/page.tsx')) continue;
      expect(UEBERSETZUNG_AUSNAHMEN, datei).not.toContain(datei);
    }
  });
});
