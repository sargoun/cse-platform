/**
 * **Eine Regel der Datenbank steht als Satz auf dem Schirm — nicht als ihr
 * Name; und Code steht nur, wo der Mensch Code braucht** (V-251, D-742).
 *
 * Das Kontaktblatt und die Rechtsgrundlagen-Seite erklärten, warum ein
 * Werbewiderspruch nicht zurückgenommen wird, mit „der Auslöser
 * `kern.erzwinge_widerspruch`", und woher die Antwort des Sendetors kommt,
 * mit „aus `app.darf_kontaktiert_werden`". 46 weitere Seiten zeigten 99
 * solche Namen als Code, dazu Dateipfade, Befehle, SQL und Funktionsnamen.
 * Jede Stelle ist ein Satz über die Wirkung geworden („die Datenbank lässt ihn
 * nicht wieder leeren", „aus derselben Prüfung, die jede Nachricht vor dem
 * Versand bestehen muss").
 *
 * **Hart, ohne Bestand.** Kein Datenbankname steht als Code auf dem Schirm,
 * und jeder andere feste Code steht mit seinem Grund in
 * `code-quelltext-ausnahmen.ts` — ein Eingabebeispiel, ein Dateiname im
 * Paket, eine Adresse der Website.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { CODE_AUSNAHMEN, type CodeAusnahme } from './code-quelltext-ausnahmen.js';
import { festerCode, istDatenbankname, tabellenAus, type CodeStelle } from './hilfen/code-quelltext.js';

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));

function baum(dir: string, endung: RegExp): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return baum(p, endung);
    return endung.test(e) ? [p] : [];
  });
}

const lies = (d: string): string | null => {
  try { return readFileSync(d, 'utf8'); } catch { return null; }
};

const SCHLUESSEL: ReadonlySet<string> = new Set(KATALOG.map((e) => e.schluessel));
const TABELLEN = tabellenAus(baum(join(WURZEL, 'drizzle'), /\.sql$/u).map((d) => readFileSync(d, 'utf8')));

function trifft(a: CodeAusnahme, datei: string, inhalt: string): boolean {
  const passt = a.datei.endsWith('/') ? datei.startsWith(a.datei) : datei === a.datei;
  return passt && (a.inhalt === '*' || a.inhalt.includes(inhalt));
}

describe('Code auf dem Schirm', () => {
  const dateien = [
    ...baum(join(WURZEL, 'src/app'), /\.tsx$/u),
    ...baum(join(WURZEL, 'src/components'), /\.tsx$/u),
  ];
  const heute: readonly CodeStelle[] = festerCode(
    dateien.map((d) => [d, readFileSync(d, 'utf8')] as const), lies, WURZEL);
  const zeile = (s: CodeStelle): string => `${relative(WURZEL, s.datei)}:${String(s.zeile)} ${s.inhalt}`;

  it('die Prüfung kennt die Tabellen und liest überhaupt Code', () => {
    expect(dateien.length).toBeGreaterThan(500);
    expect(TABELLEN.size).toBeGreaterThan(200);
    expect(TABELLEN.has('werbewiderspruch')).toBe(true);
    expect(heute.length).toBeGreaterThan(0);
  });

  it('kein Datenbankname steht als Code auf dem Schirm — nirgends', () => {
    const namen = heute.filter((s) => istDatenbankname(s.inhalt, TABELLEN, SCHLUESSEL)).map(zeile);
    expect(namen, 'einen Datenbanknamen als Satz über seine Wirkung schreiben').toEqual([]);
  });

  it('jeder feste Code hat einen Grund — oder er ist ein Satz', () => {
    const ohneGrund = heute
      .filter((s) => !CODE_AUSNAHMEN.some((a) => trifft(a, relative(WURZEL, s.datei), s.inhalt)))
      .map(zeile);
    expect(ohneGrund, 'als Satz schreiben — oder mit Grund in code-quelltext-ausnahmen.ts').toEqual([]);
  });

  it('die Ausnahmen sind genau — keine steht für Code, den es nicht mehr gibt', () => {
    const veraltet = CODE_AUSNAHMEN.flatMap((a) => {
      const inhalte = a.inhalt === '*' ? ['*'] : a.inhalt;
      return inhalte
        .filter((i) => !heute.some((s) => trifft({ ...a, inhalt: i === '*' ? '*' : [i] },
          relative(WURZEL, s.datei), s.inhalt)))
        .map((i) => `${a.datei}: ${i}`);
    });
    expect(veraltet, 'code-quelltext-ausnahmen.ts nachziehen').toEqual([]);
    for (const a of CODE_AUSNAHMEN) expect(a.grund.length, a.datei).toBeGreaterThan(20);
  });

  it('die Gegenprobe: jede Form wird gefunden, ein Wert nicht', () => {
    const tabellen = new Set(['werbewiderspruch', 'seite']);
    const fest = (quelle: string, weitere: (readonly [string, string])[] = []): readonly string[] => {
      const alle = new Map<string, string>([['/x/src/app/a.tsx', quelle], ...weitere]);
      return festerCode([['/x/src/app/a.tsx', quelle]], (d) => alle.get(d) ?? null, '/x').map((s) => s.inhalt);
    };
    const namen = (quelle: string): readonly string[] =>
      fest(quelle).filter((i) => istDatenbankname(i, tabellen, SCHLUESSEL));

    // Ein Datenbankname — mit Unterstrich, mit Schema, als Tabelle, als Konstante.
    expect(namen('const a = <p>der CHECK <code> lead_aktivitaet_hat_bezug</code></p>;'))
      .toEqual(['lead_aktivitaet_hat_bezug']);
    expect(namen('const a = <p>aus <code className="text-text"> app.darf_kontaktiert_werden</code></p>;'))
      .toEqual(['app.darf_kontaktiert_werden']);
    expect(namen("const a = <p>der Auslöser <code>{'kern.erzwinge_widerspruch()'}</code></p>;"))
      .toEqual(['kern.erzwinge_widerspruch()']);
    expect(namen('const a = <span className="font-mono text-xs">app.person_identitaeten</span>;'))
      .toEqual(['app.person_identitaeten']);
    expect(namen('const a = <p>entsteht in <code>werbewiderspruch</code></p>;')).toEqual(['werbewiderspruch']);
    expect(namen("const S = 'geschlossen_am'; const a = <p>(<code>{S}</code>)</p>;")).toEqual(['geschlossen_am']);
    // Jeder andere feste Code wird gelesen — auch über den Import —, damit er einen Grund braucht.
    expect(fest("import { D } from './d';\nconst a = <p>in <code>{D}</code></p>;",
      [['/x/src/app/d.ts', "export const D = 'server/agent/policy.ts';"]])).toEqual(['server/agent/policy.ts']);
    expect(fest('const a = <p>über <code className="font-mono">pnpm content:import</code></p>;'))
      .toEqual(['pnpm content:import']);
    expect(fest('const a = <p>auf das <code>returning</code> eines <code>insert</code></p>;'))
      .toEqual(['returning', 'insert']);

    // Ein Wert aus der Anfrage oder der Datenbank ist Anzeige, kein Quelltext.
    expect(fest('const a = <code className="break-all">{b.dateiSha256}</code>;')).toEqual([]);
    expect(fest('const a = <code className="font-mono">/unternehmen/{mandant}</code>;')).toEqual([]);
    // Ein Dateiname, ein Rechteschlüssel, ein gewöhnliches Wort sind kein Datenbankname.
    expect(namen('const a = <p>Datei <code>index.xml</code></p>;')).toEqual([]);
    expect(namen('const a = <p>fehlt <code>crm.lesen</code></p>;')).toEqual([]);
    expect(istDatenbankname('Anfrage', tabellen, SCHLUESSEL)).toBe(false);
  });
});
