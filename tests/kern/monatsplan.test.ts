/**
 * Die Monatsansicht verbirgt keine Schicht (V-186, TIM-04 „none hidden").
 *
 * Der Fall aus TIM-04: zehn Wachen, die zur selben Sekunde an einem Objekt
 * anfangen. Die Karte zeigt höchstens vier; die übrigen sechs müssen über
 * einen Verweis erreichbar sein — der Kopf des Tages und „und 6 weitere"
 * führen in die Tagesansicht, die alle zeigt. Vorher stand „und 6 weitere"
 * als blosser Text da, ohne Weg dorthin.
 */
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MONATSKARTE_HOECHSTENS, Monatsplan, type PlanSchicht, type PlanTag,
} from '../../src/components/portal/Wochenplan.js';
import { MONAT_TEXTE } from '../../src/lib/i18n/verwaltung/dienstplan-monat.js';

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
