/**
 * Zwei Befunde vom Monatsersten (D-777):
 *
 *  - **V-279:** das Radar-Blatt einer Bekanntmachung OHNE Bewertung (aufgehoben,
 *    vom Lauf nicht mehr bewertet) antwortete 404, obwohl Vorgang, Aufgabe und
 *    Lead darauf fuehren. Die Seite faellt jetzt auf `leseRadarKopfOhneBewertung`
 *    zurueck, sagt „nicht bewertet" statt einer Zahl und blendet das
 *    Stand-Formular aus, das eine Bewertungskennung traegt.
 *  - **V-280:** der Seed eroeffnete Konten nur fuer Monate mit Zeitanteilen —
 *    am Ersten gab es den laufenden Monat nicht, und das Stundenkonto stand
 *    leer. Er eroeffnet jetzt auch den laufenden Monat, wie `job:konten_rollover`.
 *
 * Geprueft wird der AUFBAU im Quelltext — was nur die Datenbank weiss (dass
 * das Blatt 200 antwortet, dass zwei Konten stehen), halten
 * `tests/e2e/verweise.spec.ts` und `tests/e2e/mitarbeiter.spec.ts` fest.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (p: string): string => readFileSync(join(WURZEL, p), 'utf8');

describe('V-279: das Radar-Blatt ohne Bewertung', () => {
  const daten = lies('src/app/portal/[mandant]/radar/daten.ts');
  const seite = lies('src/app/portal/[mandant]/radar/[id]/page.tsx');

  it('der Kopf ohne Bewertung traegt eine LEERE Bewertungskennung und gilt als ausgeschlossen', () => {
    const start = daten.indexOf('export async function leseRadarKopfOhneBewertung');
    expect(start).toBeGreaterThan(0);
    const fn = daten.slice(start, daten.indexOf('\n}\n', start));
    expect(fn).toContain("'' as bewertung_id");
    expect(fn).toContain('true as ausgeschlossen');
    expect(fn).toContain("'' as profil_id");
    // Kein `join bewertung`, kein `join radar_profil`: genau das fehlte.
    expect(fn).not.toMatch(/join bewertung|join radar_profil|from aktuell/u);
    expect(fn).toContain('from ausschreibung a');
    expect(fn).toContain('where a.id = $1::uuid');
  });

  it('die Seite faellt auf ihn zurueck, statt 404 zu antworten', () => {
    expect(seite).toMatch(/const bewertet = await leseRadarZeile\(kontext, id\);/u);
    expect(seite).toMatch(/bewertet\.length === 0 \? await leseRadarKopfOhneBewertung\(kontext, id\) : null/u);
    expect(seite).toContain("const ohneBewertung = kopf.bewertungId === '';");
  });

  it('und sagt „nicht bewertet" — ohne Zahl, ohne Stand-Formular', () => {
    expect(seite).toContain('data-cse="radar-nicht-bewertet"');
    expect(seite).toMatch(/\{ohneBewertung \? 'Keine Punktzahl' : 'Warum diese Punktzahl'\}/u);
    // Das Formular steht im Nein-Zweig derselben Weiche.
    const weiche = seite.indexOf('data-cse="radar-stand-ohne-bewertung"');
    const formular = seite.indexOf('data-cse="radar-status-formular"');
    expect(weiche).toBeGreaterThan(0);
    expect(formular).toBeGreaterThan(weiche);
    expect(seite.slice(weiche, formular)).toContain(') : (');
  });
});

describe('V-279: auch die Statusseite', () => {
  const status = lies('src/app/portal/[mandant]/radar/[id]/status/page.tsx');

  it('faellt auf denselben Kopf zurueck und zeigt ohne Bewertung kein Stand-Formular', () => {
    // Das Blatt verweist auf sie („Stand auf eigener Seite setzen") — ein
    // Verweis auf 404 waere der naechste tote Verweis fuer den Kriecher.
    expect(status).toMatch(/bewertet\.length === 0 \? await leseRadarKopfOhneBewertung\(kontext, id\) : null/u);
    expect(status).toContain("const ohneBewertung = kopf.bewertungId === '';");
    const weiche = status.indexOf('data-cse="status-ohne-bewertung"');
    const formular = status.indexOf('data-cse="status-formular"');
    expect(weiche).toBeGreaterThan(0);
    expect(formular).toBeGreaterThan(weiche);
  });
});

describe('V-280: der Seed eroeffnet den laufenden Monat', () => {
  const seed = lies('src/server/db/seed/konto.ts');

  it('der laufende Berliner Monat kommt zu den Monaten mit Zeitanteilen hinzu', () => {
    expect(seed).toContain("extract(month from (now() at time zone 'Europe/Berlin'))::int as monat");
    expect(seed).toMatch(/const alleMonate = \[\.\.\.monate\];/u);
    expect(seed).toMatch(/for \(const m of alleMonate\) \{/u);
    // Nur fuer Beschaeftigungen, die im Rueckblick ein Konto haben — keine neue Beschaeftigung erfunden.
    expect(seed).toContain('new Set(monate.map((m) => m.anstellung_id))');
  });
});
