/**
 * **Jeder Schritt auf dem Social-Weg zeigt sich nur dem, der ihn gehen darf.**
 *
 * Die Route `/api/social/beitraege/[id]/schritt` ordnet jedem Schritt ein
 * Recht zu (`RECHT`): `vorlegen` und `ueberarbeiten` gehoeren zu
 * `social.schreiben`, alles, was nach DRAUSSEN geht — `veroeffentlichen`,
 * `zuruecknehmen`, `planung_aufheben`, `erneut_senden` — zu `social.planen`.
 * Die Detailseite oeffnet dagegen mit `social.lesen` allein.
 *
 * Sie hatte die Bedingung nur fuer `erneut_senden`: ein reiner Leser bekam
 * die uebrigen Knoepfe zu sehen und ihre Abweisung erst NACH dem Druecken
 * (AUT-06, D-581 — Copilot-Runde auf PR 16).
 *
 * Zwei Listen fuer dieselbe Tatsache laufen auseinander, sobald eine gepflegt
 * wird. Diese Pruefung haelt sie aneinander: jeder Schritt, den die Route
 * kennt, steht auch in der Tabelle der Seite — und jeder Schritt der Seite
 * haengt an genau dem Recht, das die Route verlangt.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROUTE = readFileSync(fileURLToPath(new URL(
  '../../src/app/api/social/beitraege/[id]/schritt/route.ts', import.meta.url)), 'utf8');
const SEITE = readFileSync(fileURLToPath(new URL(
  '../../src/app/portal/[mandant]/social/posts/[id]/page.tsx', import.meta.url)), 'utf8');

/** `name: 'recht',` aus einem benannten Objektliteral. */
function tabelle(quelle: string, name: string): Readonly<Record<string, string>> {
  const block = new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`, 'u').exec(quelle);
  if (block === null) return {};
  const eintraege: Record<string, string> = {};
  for (const m of (block[1] ?? '').matchAll(/^\s{2}(\w+):\s*'([\w.]+)'/gmu)) {
    eintraege[m[1] as string] = m[2] as string;
  }
  return eintraege;
}

/** `schritt: <Ausdruck>,` aus der Tabelle der Seite. */
function sichtbarkeit(): Readonly<Record<string, string>> {
  const block = /rechtJeSchritt: Readonly<Record<string, boolean>> = \{([\s\S]*?)\n  \};/u
    .exec(SEITE);
  const eintraege: Record<string, string> = {};
  for (const m of (block?.[1] ?? '').matchAll(/^\s{4}(\w+):\s*([^,\n]+),/gmu)) {
    eintraege[m[1] as string] = (m[2] as string).trim();
  }
  return eintraege;
}

const derRoute = tabelle(ROUTE, 'RECHT');
const derSeite = sichtbarkeit();

/** Woran die Seite ein Recht erkennt — beide Wege fragen dieselbe Sitzung. */
const AUSDRUCK: Readonly<Record<string, string>> = {
  'social.schreiben': "darf['social.schreiben'] === true",
  'social.planen': 'daten.darfPlanen',
};

describe('Social-Schritte: Sichtbarkeit und Route fragen dasselbe Recht', () => {
  it('beide Tabellen sind gefunden worden', () => {
    expect(Object.keys(derRoute).length).toBeGreaterThan(3);
    expect(Object.keys(derSeite).length).toBeGreaterThan(3);
  });

  it('jeder Schritt der Route steht in der Sichtbarkeitstabelle der Seite', () => {
    expect(Object.keys(derRoute).filter((s) => derSeite[s] === undefined)).toEqual([]);
  });

  it('und haengt dort an genau dem Recht, das die Route verlangt', () => {
    const abweichend = Object.entries(derRoute).filter(([schritt, recht]) => {
      const erwartet = AUSDRUCK[recht];
      return erwartet === undefined || !(derSeite[schritt] ?? '').includes(erwartet);
    });
    expect(abweichend.map(([s, r]) => `${s} verlangt ${r}, Seite: ${derSeite[s] ?? '—'}`))
      .toEqual([]);
  });
});
