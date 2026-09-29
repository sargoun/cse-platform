/**
 * Das Druckblatt eines Berichts passt auf A4 — hoch oder quer —, rollt am
 * Bildschirm in seinem eigenen Behälter und bleibt auf dem Telefon lesbar
 * (REP-07, DESIGN §11, D-420, V-269, D-765).
 *
 * **Der Befund.** Das Blatt setzte jede Tabelle hochkant mit 10 pt, und die
 * Klasse `zahl` hielt auch die versal gesetzten Köpfe ohne Umbruch zusammen
 * („IST MINUS SOLL (MINUTEN)"). Vier der sechs Tabellen waren breiter als die
 * 170 mm Satzbreite: am Bildschirm ragten sie über das weisse Blatt auf den
 * dunklen Grund, im Druck verkleinerte der Browser die Seite (aus 10 pt etwa
 * 6,7 pt) oder schnitt ab; auf dem Telefon liessen 20 mm Rand 239 px Inhalt.
 *
 * Geprüft wird die erzeugte CSS und die Formatregel — nicht der Quelltext.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blattFormat, type BerichtTabelle } from '../../src/server/services/bericht/export.js';
import { druckblattStil } from '../../src/app/portal/[mandant]/berichte/druck/[bericht]/stil.js';
import { DRUCK_HOCH_BIS_SPALTEN, FARBEN_MARKE, MASSE_DRUCK } from '../../src/lib/design/theme.js';

function tabelle(spalten: number): BerichtTabelle {
  return {
    zeilen: [], zeitraum: '2026',
    spalten: Array.from({ length: spalten }, (_, i) => ({
      kopf: `S${String(i)}`, wert: () => null,
    })) as unknown as BerichtTabelle['spalten'],
  };
}

describe('hoch oder quer — die Tabelle entscheidet, nicht der Browser', () => {
  it('bis sechs Spalten hochkant, ab sieben quer', () => {
    expect(DRUCK_HOCH_BIS_SPALTEN).toBe(6);
    expect(blattFormat(tabelle(4))).toBe('hoch');
    expect(blattFormat(tabelle(6))).toBe('hoch');
    expect(blattFormat(tabelle(7))).toBe('quer');
    expect(blattFormat(tabelle(10))).toBe('quer');
  });

  it('die Cent-Zwillinge der Datei zählen nicht — sie stehen nicht auf dem Blatt', () => {
    const t = tabelle(6);
    const mitCent = {
      ...t,
      spalten: t.spalten.map((s) => ({ ...s, cent: () => null })),
    } as unknown as BerichtTabelle;
    expect(blattFormat(mitCent)).toBe('hoch');
  });
});

describe('die Druckregeln des Blatts', () => {
  const hoch = druckblattStil('hoch');
  const quer = druckblattStil('quer');

  it('quer druckt A4 quer und ist am Bildschirm 297 mm breit; hoch 210 mm', () => {
    expect(quer).toContain('size: A4 landscape');
    expect(quer).toContain(`max-width: ${MASSE_DRUCK['druck-blatt-quer']}`);
    expect(hoch).toContain('size: A4 portrait');
    expect(hoch).toContain(`max-width: ${MASSE_DRUCK['druck-blatt-hoch']}`);
  });

  it('die Köpfe brechen um, nur die Zahlen im Rumpf nicht', () => {
    expect(hoch).toMatch(/\.cse-blatt td\.zahl \{ white-space: nowrap; \}/u);
    /* Keine Regel, die `.zahl` allgemein — also auch `th.zahl` — zusammenhält. */
    expect(hoch).not.toMatch(/\.cse-blatt \.zahl \{[^}]*nowrap/u);
    expect(hoch).not.toMatch(/th[^{]*\{[^}]*nowrap/u);
  });

  it('am Bildschirm rollt die Tabelle, nie die Seite — im Druck wird nichts abgeschnitten', () => {
    expect(hoch).toContain('.cse-blatt .rollbar { overflow-x: auto; }');
    expect(hoch).toMatch(/@media print \{[\s\S]*\.rollbar \{ overflow: visible; \}/u);
  });

  it('auf dem Telefon der Rand --s4 statt 20 mm (D-420)', () => {
    expect(hoch).toContain('@media (max-width: 767.98px) { .cse-blatt { padding: var(--s4); } }');
  });
});

describe('die Seite benutzt Format, Behälter und einen 44-px-Rückweg', () => {
  const seite = readFileSync('src/app/portal/[mandant]/berichte/druck/[bericht]/page.tsx', 'utf8');

  it('das Format kommt aus blattFormat, die Regeln aus druckblattStil', () => {
    expect(seite).toContain('blattFormat(tabelle)');
    expect(seite).toContain('druckblattStil(format)');
    expect(seite).toContain('data-format={format}');
  });

  it('die Tabelle steht im Rollbehälter, der Rückweg ist ein 44-px-Ziel', () => {
    expect(seite).toMatch(/className="rollbar"[\s\S]*data-cse="bericht-druck-tabelle"/u);
    expect(seite).toMatch(/data-cse="bericht-druck-zurueck"\s+className="[^"]*min-h-11/u);
  });
});

describe('die Masse stehen in DESIGN §11', () => {
  const design = readFileSync('docs/DESIGN.md', 'utf8');

  it('jedes Druckmass aus theme.ts steht mit seinem Wert im Dokument', () => {
    for (const [name, wert] of Object.entries(MASSE_DRUCK)) {
      expect(design, name).toContain(`| \`--${name}\` | \`${wert}\` |`);
    }
    expect(design).toContain(`| \`--druck-hoch-bis-spalten\` | \`${String(DRUCK_HOCH_BIS_SPALTEN)}\` |`);
  });
});

/*
 * Firmenzeile 14 pt, Titel 13 pt, Kopflinie 3 px und Zeilenhöhe 1,5 standen
 * als Literale im Berichtsblatt — übernommen aus Angebot und Monatsnachweis,
 * wo sie seit D-204 stehen; keiner der Werte war ein Token in §11 (V-269).
 */
describe('Firmenzeile, Titel, Kopflinie und Zeilenhöhe sind Token — in allen drei Blättern', () => {
  const KOPF_TOKEN = [
    'druck-firma-groesse', 'druck-titel-groesse', 'druck-kopflinie', 'druck-zeilenhoehe',
  ] as const;
  const BERICHT_STIL = 'src/app/portal/[mandant]/berichte/druck/[bericht]/stil.ts';
  const BERICHT_SEITE = 'src/app/portal/[mandant]/berichte/druck/[bericht]/page.tsx';
  const ANGEBOT = 'src/app/portal/[mandant]/angebote/[id]/pdf/page.tsx';
  const MONATSNACHWEIS = 'src/app/portal/mein/monatsnachweis/page.tsx';

  it('das Berichtsblatt setzt die vier Masse aus MASSE_DRUCK', () => {
    const stil = druckblattStil('hoch');
    expect(stil).toContain(`line-height: ${MASSE_DRUCK['druck-zeilenhoehe']};`);
    expect(stil).toContain(`.cse-blatt .firma { margin: 0; font-size: ${MASSE_DRUCK['druck-firma-groesse']};`);
    expect(stil).toContain(`.cse-blatt h1 { margin: 0; font-size: ${MASSE_DRUCK['druck-titel-groesse']}; }`);
    expect(stil).toContain(`border-top: ${MASSE_DRUCK['druck-kopflinie']} solid ${FARBEN_MARKE.red};`);
    expect(readFileSync(BERICHT_SEITE, 'utf8')).toMatch(/<p className="firma">/u);
  });

  it('kein Blatt schreibt 12, 13 oder 14 pt, 3 px oder die Zeilenhöhe 1,5 selbst', () => {
    for (const datei of [BERICHT_STIL, BERICHT_SEITE, ANGEBOT, MONATSNACHWEIS]) {
      expect(readFileSync(datei, 'utf8'), datei)
        .not.toMatch(/\b1[234]pt\b|\b3px solid|line-height: 1\.5\b/u);
    }
  });

  it('Angebot und Monatsnachweis lesen dieselben vier Token', () => {
    for (const datei of [ANGEBOT, MONATSNACHWEIS]) {
      const quelle = readFileSync(datei, 'utf8');
      for (const name of KOPF_TOKEN) expect(quelle, `${datei}: ${name}`).toContain(`MASSE_DRUCK['${name}']`);
    }
  });

  it('Punkte, nicht Pixel — kein Druckmass ist in px angegeben (§11)', () => {
    for (const [name, wert] of Object.entries(MASSE_DRUCK)) expect(wert, name).not.toMatch(/px$/u);
    expect(MASSE_DRUCK['druck-kopflinie']).toBe('2.25pt'); // die 3 px von vorher, 1 px = 0,75 pt
  });
});
