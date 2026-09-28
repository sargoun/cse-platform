/**
 * Das Arbeiterportal zeigt Werte aus der Datenbank als WORT in der Sprache der
 * Person — nie als Schlüssel, nie unter falscher Beschriftung (V-195, EMP-02,
 * EMP-08, EMP-12).
 *
 * **Der Befund.** (1) Das Schichtblatt zeigte unter „Status" den rohen Wert
 * von `dienstplan_zuordnung.status` — `nicht_erschienen` auch auf Arabisch.
 * (2) „Meine Nachweise" stellte die Rechtsgrundlage („§34a Abs. 1a GewO")
 * unter die Beschriftung „Status". (3) Dieselbe Seite zeigte den Status im
 * Bewacherregister roh (`registriert`, `beantragt` …). (4) Die Schichtkarte
 * schrieb in jeder Sprache das deutsche „23-Stunden-Tag"; die
 * Übersetzungswache sah es nicht, weil es in einem Ternär stand.
 *
 * Geprüft wird dreierlei: die Wörter decken die Vokabulare der Datenbank ganz
 * ab (gegen die Migration bzw. den Dienst gehalten, damit ein neuer Wert hier
 * auffällt und nicht auf dem Telefon), jede Sprache trägt sie — und die Seiten
 * reichen die Werte nicht mehr roh durch.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BEWACHER_STATUS_SCHLUESSEL, MEIN_TEXTE, PORTAL_SPRACHEN, ZUORDNUNG_STATUS_SCHLUESSEL,
} from '../../src/lib/i18n/texte.js';
import {
  BEWACHER_STATUS, STATUS_TEXT,
} from '../../src/server/services/security/bewacherregister.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const MEIN = join(WURZEL, 'src/app/portal/mein');

function quelle(pfad: string): string {
  return readFileSync(join(WURZEL, pfad), 'utf8');
}

function dateien(verzeichnis: string): string[] {
  const alle: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) alle.push(...dateien(voll));
    else if (voll.endsWith('.tsx')) alle.push(voll);
  }
  return alle;
}

/** Die Werte eines Enums, so wie die Migration sie anlegt. */
function enumWerte(migration: string, typ: string): readonly string[] {
  const text = quelle(migration);
  const treffer = new RegExp(`create type ${typ} as enum\\s*\\(([^)]*)\\)`, 'u').exec(text);
  expect(treffer, `${typ} in ${migration}`).not.toBeNull();
  return [...(treffer?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((m) => m[1] ?? '');
}

describe('die Wörter decken die Vokabulare der Datenbank ab', () => {
  it('zuordnung_status (0028) — jeder Wert hat ein Wort, keiner ist erfunden', () => {
    expect([...ZUORDNUNG_STATUS_SCHLUESSEL].sort())
      .toEqual([...enumWerte('drizzle/0028_dienstplan.sql', 'zuordnung_status')].sort());
  });

  it('bewacher_status (0031) — dieselben Werte wie Migration und Dienst', () => {
    expect([...BEWACHER_STATUS_SCHLUESSEL].sort())
      .toEqual([...enumWerte('drizzle/0031_bewacher_eintrag.sql', 'bewacher_status')].sort());
    expect([...BEWACHER_STATUS_SCHLUESSEL].sort()).toEqual([...BEWACHER_STATUS].sort());
  });

  it('das Deutsche ist wortgleich mit der Verwaltung — Büro und Kraft lesen dasselbe', () => {
    expect(MEIN_TEXTE.de.bewacherStatus).toEqual(STATUS_TEXT);
  });

  it('jede Sprache trägt jeden Wert, und keiner ist leer', () => {
    for (const s of PORTAL_SPRACHEN) {
      const t = MEIN_TEXTE[s];
      for (const k of ZUORDNUNG_STATUS_SCHLUESSEL) {
        expect(t.zuordnungStatus[k].trim(), `${s}.zuordnungStatus.${k}`).not.toBe('');
      }
      for (const k of BEWACHER_STATUS_SCHLUESSEL) {
        expect(t.bewacherStatus[k].trim(), `${s}.bewacherStatus.${k}`).not.toBe('');
      }
      expect(t.rechtsgrundlage.trim(), `${s}.rechtsgrundlage`).not.toBe('');
      expect(t.zeitanomalie.dst_luecke, s).toMatch(/23/u);
      expect(t.zeitanomalie.dst_doppelt, s).toMatch(/25/u);
    }
  });

  it('und keine andere Sprache übernimmt das deutsche Wort', () => {
    for (const s of PORTAL_SPRACHEN.filter((x) => x !== 'de')) {
      const t = MEIN_TEXTE[s];
      expect(t.zeitanomalie.dst_luecke, s).not.toBe(MEIN_TEXTE.de.zeitanomalie.dst_luecke);
      expect(t.zuordnungStatus.nicht_erschienen, s)
        .not.toBe(MEIN_TEXTE.de.zuordnungStatus.nicht_erschienen);
      expect(t.rechtsgrundlage, s).not.toBe(MEIN_TEXTE.de.rechtsgrundlage);
    }
  });
});

describe('die Seiten reichen die Werte nicht mehr roh durch', () => {
  it('das Schichtblatt zeigt den Zustand der Einteilung als Wort', () => {
    const blatt = quelle('src/app/portal/mein/schichten/[zuordnungId]/page.tsx');
    // Als Inhalt eines Elements — `data-status={daten.status}` ist Technik.
    expect(blatt).not.toMatch(/>\s*\{\s*daten\.status\s*\}\s*</u);
    expect(blatt).toContain('t.zuordnungStatus');
  });

  it('die Rechtsgrundlage steht unter ihrer eigenen Beschriftung, der Registerstatus als Wort', () => {
    const seite = quelle('src/app/portal/mein/nachweise/page.tsx');
    expect(seite).not.toMatch(/label=\{t\.status\}>\{n\.rechtsgrundlage\}/u);
    expect(seite).toContain('label={t.rechtsgrundlage}');
    expect(seite).not.toMatch(/daten\.bewacher\.status\s*\?\?\s*'—'\)/u);
    expect(seite).toContain('t.bewacherStatus');
  });

  it('kein deutsches „Stunden-Tag" mehr im Quelltext des Arbeiterportals', () => {
    const funde = dateien(MEIN)
      .filter((d) => /'2[35]-Stunden-Tag'/u.test(readFileSync(d, 'utf8')))
      .map((d) => relative(WURZEL, d));
    expect(funde).toEqual([]);
  });

  it('ein unbekannter Wert fällt auf einen Strich, nie auf den rohen Schlüssel', () => {
    // `{statusWort[e.status] ?? e.status}` zeigte einen neuen Wert als Schlüssel.
    const ROH = /\?\?\s*[a-z]\w*\.(?:status|art|befund)\s*\}/u;
    const funde = dateien(MEIN)
      .filter((d) => ROH.test(readFileSync(d, 'utf8')))
      .map((d) => relative(WURZEL, d));
    expect(funde).toEqual([]);
  });
});
