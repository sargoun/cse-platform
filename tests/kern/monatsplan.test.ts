/**
 * Die Monatsansicht verbirgt keine Schicht (V-186, TIM-04 „none hidden").
 *
 * Der Fall aus TIM-04: zehn Wachen, die zur selben Sekunde an einem Objekt
 * anfangen. Die Karte zeigt höchstens vier; die übrigen sechs müssen über
 * einen Verweis erreichbar sein — der Kopf des Tages und „und 6 weitere"
 * führen in die Tagesansicht, die alle zeigt. Vorher stand „und 6 weitere"
 * als blosser Text da, ohne Weg dorthin.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MONATSKARTE_HOECHSTENS, Monatsplan, type PlanSchicht, type PlanTag,
} from '../../src/components/portal/Wochenplan.js';
import { MONAT_TEXTE } from '../../src/lib/i18n/verwaltung/dienstplan-monat.js';
import { tagKurz } from '../../src/lib/datum/kalendertag.js';

/*
 * Die Bauteile sind `.tsx` mit der klassischen JSX-Umwandlung dieses
 * Testläufers — sie erwarten `React` im Geltungsbereich (wie V-153).
 */
(globalThis as { React?: typeof React }).React = React;

/** 18.03.2026 in Berlin: 17.03. 23:00 UTC bis 18.03. 23:00 UTC (MEZ). */
const TAG: PlanTag = {
  datum: '2026-03-18',
  beschriftung: 'Mi 18.03.',
  beginn: new Date('2026-03-17T23:00:00Z'),
  ende: new Date('2026-03-18T23:00:00Z'),
  feiertag: null,
};
/** Der Folgetag — die Nachtschicht läuft dort bis 06:00 weiter. */
const FOLGE: PlanTag = {
  datum: '2026-03-19',
  beschriftung: 'Do 19.03.',
  beginn: new Date('2026-03-18T23:00:00Z'),
  ende: new Date('2026-03-19T23:00:00Z'),
  feiertag: null,
};
const LEER: PlanTag = {
  datum: '2026-03-20',
  beschriftung: 'Fr 20.03.',
  beginn: new Date('2026-03-19T23:00:00Z'),
  ende: new Date('2026-03-20T23:00:00Z'),
  feiertag: null,
};

function wache(i: number): PlanSchicht {
  return {
    id: `schicht-${String(i)}`,
    // Zehn Schichten, EIN Instant: 18.03. 22:00 Berlin (21:00 UTC) bis 06:00.
    beginn: new Date('2026-03-18T21:00:00Z'),
    ende: new Date('2026-03-19T05:00:00Z'),
    beginnLokal: '22:00',
    endeLokal: '06:00',
    objekt: 'Messe Nord',
    revier: null,
    besetzt: 1,
    soll: 1,
    status: 'geplant',
    befunde: [],
  };
}

/** Der Ausschnitt einer Tageskarte. */
function karte(html: string, datum: string): string {
  const ab = html.split(`data-datum="${datum}"`)[1]!;
  return ab.split('data-cse="monatstag"')[0]!;
}

function zeichne(sprache: 'de' | 'en', schichten: readonly PlanSchicht[]): string {
  return renderToStaticMarkup(createElement(Monatsplan, {
    tage: [TAG, FOLGE, LEER],
    schichten,
    zielFuer: (s: PlanSchicht) => `/portal/security/dienstplan/einsatz/${s.id}`,
    tagZiel: (datum: string) => `/portal/security/dienstplan/tag?tag=${datum}`,
    texte: MONAT_TEXTE[sprache],
  }));
}

describe('Monatsansicht: zehn Wachen zur selben Sekunde (TIM-04)', () => {
  const zehn = Array.from({ length: 10 }, (_, i) => wache(i));

  it('zeigt vier und verweist für die übrigen sechs auf die Tagesansicht', () => {
    const html = zeichne('de', zehn);
    const k = karte(html, '2026-03-18');
    expect(MONATSKARTE_HOECHSTENS).toBe(4);
    expect(k.match(/data-cse="schicht"/gu)).toHaveLength(4);
    expect(k).toContain('data-cse="monatstag-weitere"');
    expect(k).toContain('href="/portal/security/dienstplan/tag?tag=2026-03-18"');
    expect(k).toContain('und 6 weitere — alle 10 in der Tagesansicht');
    expect(k).toContain('10 Schichten');
  });

  it('die Nachtschicht 22:00–06:00 steht auch am Folgetag — mit demselben Verweis', () => {
    const k = karte(zeichne('de', zehn), '2026-03-19');
    expect(k.match(/data-cse="schicht"/gu)).toHaveLength(4);
    expect(k).toContain('href="/portal/security/dienstplan/tag?tag=2026-03-19"');
    expect(k).toContain('und 6 weitere — alle 10 in der Tagesansicht');
  });

  it('der Kopf jedes Tages führt in die Tagesansicht — auch ohne Schicht', () => {
    const html = zeichne('de', zehn);
    expect(html.match(/data-cse="monatstag-ziel"/gu)).toHaveLength(3);
    const leer = karte(html, '2026-03-20');
    expect(leer).toContain('href="/portal/security/dienstplan/tag?tag=2026-03-20"');
    expect(leer).toContain('keine Schicht');
  });

  it('mit vier Schichten gibt es keinen Verweis „weitere"', () => {
    const k = karte(zeichne('de', zehn.slice(0, 4)), '2026-03-18');
    expect(k).not.toContain('monatstag-weitere');
    expect(k.match(/data-cse="schicht"/gu)).toHaveLength(4);
  });

  it('jeder Verweis hat 44 px Zielfläche (DESIGN §8)', () => {
    const html = zeichne('de', zehn);
    const verweise = html.match(/<a [^>]*>/gu) ?? [];
    expect(verweise.length).toBeGreaterThan(0);
    for (const a of verweise) expect(a).toContain('min-h-11');
  });

  it('spricht Englisch, wenn die Sitzung Englisch spricht — mit englischen Zahlen', () => {
    const html = zeichne('en', zehn);
    expect(html).toContain('and 6 more — all 10 in the day view');
    expect(html).toContain('10 shifts');
    expect(html).toContain('no shift');
    expect(MONAT_TEXTE.de.schichten(1234)).toBe('1.234 Schichten');
    expect(MONAT_TEXTE.en.schichten(1234)).toBe('1,234 shifts');
    expect(MONAT_TEXTE.en.schichten(1)).toBe('1 shift');
  });
});

describe('Monatsansicht ohne jede Schicht (V-193)', () => {
  /**
   * Die Zusage „auch an einem Tag ohne Schicht, denn dort wird geplant"
   * (D-680) galt nur in Monaten mit mindestens einer Schicht: war der Monat
   * leer, ersetzte der Satz „nichts geplant" das ganze Raster und damit jeden
   * Weg zu einem Tag.
   */
  it('jeder Tag hat seine Karte mit Verweis auf die Tagesansicht', () => {
    const html = zeichne('de', []);
    expect(html.match(/data-cse="monatstag-ziel"/gu)).toHaveLength(3);
    for (const datum of ['2026-03-18', '2026-03-19', '2026-03-20']) {
      expect(karte(html, datum)).toContain(`href="/portal/security/dienstplan/tag?tag=${datum}"`);
    }
    expect(html).not.toContain('data-cse="schicht"');
  });

  it('die Seite zeigt das Raster immer — der Satz steht darüber, nicht an seiner Stelle', () => {
    const seite = readFileSync(
      resolve(import.meta.dirname, '../../src/app/portal/[mandant]/dienstplan/monat/page.tsx'), 'utf8');
    expect(seite).not.toMatch(/schichten\.length === 0 \?/u);
    expect(seite).toMatch(/schichten\.length === 0 && \(/u);
    expect(seite).toContain('<Monatsplan');
    expect(seite).toContain('tagKurz(tag.datum, zugang.sprache)');
  });
});

describe('die Tagesbeschriftung spricht die Sprache der Seite (V-193)', () => {
  it('deutsch „So 04.01.", englisch „Sun 04 Jan" — ohne Zonenversatz', () => {
    expect(tagKurz('2026-01-04', 'de')).toBe('So 04.01.');
    expect(tagKurz('2026-01-04')).toBe('So 04.01.');
    expect(tagKurz('2026-01-04', 'en')).toBe('Sun 04 Jan');
    // Der Tag der Zeitumstellung ist ein Kalendertag wie jeder andere.
    expect(tagKurz('2026-03-29', 'de')).toBe('So 29.03.');
    expect(tagKurz('2026-03-29', 'en')).toBe('Sun 29 Mar');
  });

  it('was kein Kalendertag ist, kommt unverändert zurück', () => {
    expect(tagKurz('2026-02-31', 'en')).toBe('2026-02-31');
    expect(tagKurz('morgen', 'de')).toBe('morgen');
  });
});
