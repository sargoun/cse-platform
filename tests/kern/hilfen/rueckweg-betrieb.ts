/**
 * Die gemeinsamen Handgriffe der Rückweg-Prüfungen des Teils „betrieb"
 * (V-275, D-773, D-769): Veranstaltung, Bewacherregister, Revier,
 * Sonderleistung, Turnus, Bauprojekt, Nacherfassung, laufender Eintrag.
 *
 * **Was jede dieser Prüfungen festhält** (D-769): eine Umleitung zurück auf
 * eine Seite trägt nur Schlüssel — kein `meldung=`, kein Satz, keine Kennung
 * in der Adresse; die Seite schlägt den Schlüssel nur als eigenen Eintrag
 * nach und fällt für ein unbekanntes Wort auf ihren allgemeinen Satz zurück;
 * und kein Suchparameter, der eine Rückmeldung trägt, steht roh auf dem
 * Schirm (`rohAusDerAdresse`, D-741).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { expect } from 'vitest';
import { eigenerEintrag } from '../../../src/lib/nachschlagen.js';
import { rohAusDerAdresse } from './adressparameter.js';

export const HIER = 'http://localhost:3001';
export const WURZEL = resolve(import.meta.dirname, '../../..');
/** Eine Kennung, die nie in einer Rückweg-Adresse stehen darf. */
export const KENNUNG = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';

/** Die Sitzung, mit der die echten Routen hier laufen — aktiver Mandant, zweiter Faktor. */
export const SITZUNG = Object.freeze({
  benutzerId: '00000000-0000-4000-8000-000000000001',
  aktiverMandantId: '00000000-0000-4000-8000-000000000002',
  personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
  sitzungId: '00000000-0000-4000-8000-000000000003',
});

/**
 * Ein Browserformular: die Felder als `multipart/form-data`, eigener
 * Ursprung, und `Accept: text/html` wie bei jeder Navigation.
 */
export function formular(
  pfad: string, felder: readonly (readonly [string, string])[],
): NextRequest {
  const daten = new FormData();
  for (const [k, v] of felder) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER, accept: 'text/html' });
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

/**
 * Die Mandantenschicht, so weit diese Routen sie hier brauchen: `abfrage`
 * beantwortet nur die Frage nach dem Slug des AKTIVEN Mandanten (D-773
 * Nachtrag Nr. 3) — mit `bereich()`, oder ohne Zeile, wenn der `null` ist.
 * Jede andere Abfrage bekommt wie bisher keine Zeile.
 */
export function kontextMitBereich(bereich: () => string | null): {
  readonly abfrage: (sql: string) => Promise<readonly { readonly slug: string }[]>;
} {
  return {
    abfrage: (sql: string) => {
      const slug = bereich();
      return Promise.resolve(
        slug !== null && sql.includes('app.aktiver_mandant()') ? [{ slug }] : []);
    },
  };
}

/** Dasselbe Formular von einem fremden Ursprung — der Riegel davor antwortet mit JSON (403). */
export function fremdesFormular(
  pfad: string, felder: readonly (readonly [string, string])[],
): NextRequest {
  const daten = new FormData();
  for (const [k, v] of felder) daten.append(k, v);
  const kopf = new Headers({
    host: 'localhost:3001', origin: 'https://fremd.example', accept: 'text/html',
  });
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

/**
 * Die Adresse eines Rückwegs — und dass sie nur Schlüssel trägt: 303, eigener
 * Ursprung, kein `meldung=`, keine Kennung und kein Leerzeichen in der Suche
 * (ein Satz hätte eines).
 */
export function rueckweg(antwort: Response): URL {
  expect(antwort.status).toBe(303);
  const ziel = new URL(antwort.headers.get('location') ?? '');
  expect(ziel.origin).toBe(HIER);
  expect(ziel.search).not.toContain('meldung=');
  const suche = decodeURIComponent(ziel.search);
  expect(suche).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/u);
  expect(suche).not.toMatch(/\s/u);
  return ziel;
}

/** Die Form jeder Satztabelle dieses Teils (wie `ENTSCHEIDUNG_FEHLER_TEXTE`, D-753). */
export interface FehlerTabelle {
  readonly titel: string;
  readonly sonst: string;
  readonly fehler: Readonly<Record<string, string>>;
}

/**
 * Jeder Grund hat in jeder Sprache der Tabelle einen Satz — ohne Kennung,
 * ohne Platzhalter, ohne Schlüssel; Englisch ist nicht Deutsch; ein fremdes
 * Wort aus der Adresse findet nichts (auch kein Prototyp).
 */
export function pruefeSaetze(
  texte: Readonly<Record<string, FehlerTabelle>>, gruende: readonly string[],
): void {
  const sprachen = Object.keys(texte);
  expect(sprachen.length).toBeGreaterThan(0);
  for (const sprache of sprachen) {
    const t = texte[sprache]!;
    expect(t.titel.trim(), `${sprache}.titel`).not.toBe('');
    expect(t.sonst.trim(), `${sprache}.sonst`).not.toBe('');
    for (const g of gruende) {
      const satz = eigenerEintrag(t.fehler, g);
      expect(satz, `${sprache}.${g}`).toBeTruthy();
      expect(satz, `${sprache}.${g}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|\$\{/u);
      /* Kein Schlüssel und kein Name aus dem Quelltext im Satz (D-741). */
      expect(satz, `${sprache}.${g}`)
        .not.toMatch(/\b[a-z]{2,}(?:_[a-z]+)+\b|\b[a-z]{3,}\.[a-z_]{3,}\b/u);
      if (sprache !== 'de' && texte['de'] !== undefined) {
        expect(satz, `${sprache}.${g}`).not.toBe(eigenerEintrag(texte['de'].fehler, g));
      }
    }
    for (const fremd of ['__proto__', 'constructor', 'toString', 'hasOwnProperty',
      'Hallo Welt', '', 'nicht_da']) {
      expect(eigenerEintrag(t.fehler, fremd), `${sprache}: ${fremd}`).toBeUndefined();
    }
  }
}

/** Die Rückmeldeparameter, die eine Seite nie als solche zeigt (D-769 Nr. 2, D-741). */
const RUECKMELDUNG = new Set(['meldung', 'erfolg', 'ok', 'hinweis', 'fehler', 'grund']);

/**
 * Der Quelltext einer Seite oder eines Bausteins: liest `meldung` nicht,
 * schlägt nach, wie angegeben, und zeigt keinen Rückmeldeparameter roh
 * (`rohAusDerAdresse` meldet dafür weder `direkt` noch `rueckfall`).
 */
export function pruefeSeite(pfad: string, nachschlagen: readonly string[]): void {
  const datei = resolve(WURZEL, pfad);
  const quelle = readFileSync(datei, 'utf8');
  /* Weder `?meldung=` noch `?ok=` wird gelesen (D-769 Nr. 1–2). */
  expect(quelle, pfad).not.toMatch(/\[\s*['"](?:meldung|ok)['"]\s*\]/u);
  expect(quelle, pfad).not.toMatch(/\{\s*[^}]*\bmeldung\b[^}]*\}\s*=\s*(?:await\s+)?searchParams/u);
  for (const n of nachschlagen) expect(quelle, pfad).toContain(n);
  const lies = (d: string): string | null => {
    try { return readFileSync(d, 'utf8'); } catch { return null; }
  };
  const roh = rohAusDerAdresse([[datei, quelle]], lies, WURZEL)
    .filter((b) => RUECKMELDUNG.has(b.parameter))
    .map((b) => `${String(b.zeile)} ?${b.parameter} ${b.art} ${b.ausdruck}`);
  expect(roh, pfad).toEqual([]);
}
