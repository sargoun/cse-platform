/**
 * **Eine Regel der Datenbank steht als Satz auf dem Schirm — nicht als ihr
 * Name** (V-251, D-742).
 *
 * Das Kontaktblatt und die Rechtsgrundlagen-Seite erklärten, warum ein
 * Werbewiderspruch nicht zurückgenommen wird, mit „der Auslöser
 * `kern.erzwinge_widerspruch`", und woher die Antwort des Sendetors kommt,
 * mit „aus `app.darf_kontaktiert_werden`". Die Vertriebskraft liest
 * Quelltext, wo sie einen Satz braucht („die Datenbank lässt ihn nicht wieder
 * leeren", „aus derselben Prüfung, die jede Nachricht vor dem Versand bestehen
 * muss").
 *
 * **Über den ganzen Baum, als Sperrklinke.** Auf den beiden Seiten steht kein
 * Datenbankname mehr. Auf 46 anderen Seiten stehen beim Einfrieren noch 99
 * (`code-datenbankname-bestand.ts`); ihre Zahl darf nur sinken, und keine
 * neue Seite bekommt einen.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { CODE_DATENBANKNAMEN_BESTAND } from './code-datenbankname-bestand.js';
import { datenbanknamenInCode, istDatenbankname, tabellenAus } from './hilfen/code-datenbankname.js';

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));

function baum(dir: string, endung: RegExp): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return baum(p, endung);
    return endung.test(e) ? [p] : [];
  });
}

const SCHLUESSEL: ReadonlySet<string> = new Set(KATALOG.map((e) => e.schluessel));
const TABELLEN = tabellenAus(baum(join(WURZEL, 'drizzle'), /\.sql$/u).map((d) => readFileSync(d, 'utf8')));

/** Je Seite: wie viele Datenbanknamen sie als Code zeigt. */
function jeSeite(): ReadonlyMap<string, number> {
  const dateien = [
    ...baum(join(WURZEL, 'src/app'), /\.tsx$/u),
    ...baum(join(WURZEL, 'src/components'), /\.tsx$/u),
  ];
  const zahl = new Map<string, number>();
  for (const f of datenbanknamenInCode(
    dateien.map((d) => [d, readFileSync(d, 'utf8')] as const), TABELLEN, SCHLUESSEL)) {
    const r = relative(WURZEL, f.datei);
    zahl.set(r, (zahl.get(r) ?? 0) + 1);
  }
  return zahl;
}

describe('Datenbanknamen als Code auf dem Schirm', () => {
  const heute = jeSeite();

  it('die Prüfung kennt die Tabellen und sieht überhaupt Namen', () => {
    expect(TABELLEN.size).toBeGreaterThan(200);
    expect(TABELLEN.has('werbewiderspruch')).toBe(true);
    expect([...heute.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('das Kontaktblatt und die Rechtsgrundlagen-Seite zeigen keinen', () => {
    for (const seite of [
      'src/app/portal/[mandant]/crm/kontakte/[id]/page.tsx',
      'src/app/portal/[mandant]/crm/kontakte/[id]/rechtsgrundlage/page.tsx',
    ]) {
      expect(heute.get(seite) ?? 0, seite).toBe(0);
      expect(CODE_DATENBANKNAMEN_BESTAND[seite], seite).toBeUndefined();
    }
  });

  it('keine Seite zeigt mehr als ihr eingefrorener Bestand — und keine neue überhaupt einen', () => {
    const mehr = [...heute.entries()]
      .filter(([seite, n]) => n > (CODE_DATENBANKNAMEN_BESTAND[seite] ?? 0))
      .map(([seite, n]) => `${seite}: ${String(n)} statt ${String(CODE_DATENBANKNAMEN_BESTAND[seite] ?? 0)}`);
    expect(mehr, 'einen Datenbanknamen als Satz an den Leser schreiben').toEqual([]);
  });

  it('der Bestand ist genau — eine Seite, die weniger zeigt, setzt ihre Zahl herunter', () => {
    const veraltet = Object.entries(CODE_DATENBANKNAMEN_BESTAND)
      .filter(([seite, n]) => (heute.get(seite) ?? 0) !== n)
      .map(([seite, n]) => `${seite}: Bestand ${String(n)}, Baum ${String(heute.get(seite) ?? 0)}`);
    expect(veraltet, 'code-datenbankname-bestand.ts nachziehen').toEqual([]);
  });

  it('die Gegenprobe: jede Form eines Namens wird gefunden, ein Wert nicht', () => {
    const tabellen = new Set(['werbewiderspruch', 'seite']);
    const namen = (quelle: string) =>
      datenbanknamenInCode([['/x/a.tsx', quelle]], tabellen, SCHLUESSEL).map((n) => n.name);

    expect(namen('const a = <p>der CHECK <code> lead_aktivitaet_hat_bezug</code></p>;'))
      .toEqual(['lead_aktivitaet_hat_bezug']);
    expect(namen('const a = <p>aus <code className="text-text"> app.darf_kontaktiert_werden</code></p>;'))
      .toEqual(['app.darf_kontaktiert_werden']);
    expect(namen("const a = <p>der Auslöser <code>{'kern.erzwinge_widerspruch()'}</code></p>;"))
      .toEqual(['kern.erzwinge_widerspruch()']);
    expect(namen('const a = <span className="font-mono text-xs">app.person_identitaeten</span>;'))
      .toEqual(['app.person_identitaeten']);
    expect(namen('const a = <p>entsteht in <code>werbewiderspruch</code></p>;'))
      .toEqual(['werbewiderspruch']);
    expect(namen("const S = 'geschlossen_am'; const a = <p>(<code>{S}</code>)</p>;"))
      .toEqual(['geschlossen_am']);

    // Ein Wert aus der Anfrage, ein Dateiname, ein Rechteschlüssel, ein gewöhnliches Wort.
    expect(namen('const a = <code className="break-all">{b.dateiSha256}</code>;')).toEqual([]);
    expect(namen('const a = <p>Datei <code>index.xml</code></p>;')).toEqual([]);
    expect(namen('const a = <p>fehlt <code>crm.lesen</code></p>;')).toEqual([]);
    expect(namen('const a = <p>Kennung <code>DE12 3456</code></p>;')).toEqual([]);
    expect(istDatenbankname('Anfrage', tabellen, SCHLUESSEL)).toBe(false);
  });
});
