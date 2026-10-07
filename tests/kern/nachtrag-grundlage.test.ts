/**
 * Die Pflege der Anspruchsgrundlagen — Weg, Recht und Wörter (V-384, O-23,
 * D-842).
 *
 * Was die Datenbank hält — Bestätigen, Archivieren, Wiederaufnehmen unter der
 * RLS von `nachtrag_grundlage` —, steht in
 * `tests/isolation/nachtrag-grundlage.test.ts`. Hier:
 *
 *  1. Die Route steht im Manifest mit dem Recht, das die Policy verlangt,
 *     und kennt genau drei Handlungen.
 *  2. Jeder Grund des Dienstes hat einen Satz in beiden Sprachen; jedes
 *     Ergebnis der Route auch.
 *  3. Die Seiten führen hin: die Bau-Übersicht, die Nachtragsliste und das
 *     Formular eines neuen Nachtrags.
 *  4. Die Voreinstellung steht am Dienst (`TODO(client, O-23)`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTEN } from '../../src/server/auth/route-manifest.js';
import { NACHTRAGSGRUNDLAGEN_TEXTE } from '../../src/lib/i18n/verwaltung/nachtragsgrundlagen.js';
import type { NachtragGrundlageGrund }
  from '../../src/server/services/bau/nachtrag-grundlage.js';

const ROUTE = readFileSync('src/app/api/bau/nachtragsgrundlagen/route.ts', 'utf8');
const DIENST = readFileSync('src/server/services/bau/nachtrag-grundlage.ts', 'utf8');

describe('die Route', () => {
  it('steht im Manifest mit bau.schreiben — dem Recht der WITH-CHECK-Hälfte (0080)', () => {
    const eintrag = ROUTEN.find((r) => r.pfad === 'api/bau/nachtragsgrundlagen');
    expect(eintrag?.recht).toBe('bau.schreiben');
    expect(ROUTE).toContain("recht: 'bau.schreiben'");
  });

  it('kennt genau drei Handlungen, und jedes Ergebnis hat einen Satz', () => {
    const handlungen = [...ROUTE.matchAll(/aktion === '([a-z]+)'/gu)].map((m) => m[1]).sort();
    expect(handlungen).toEqual(['archivieren', 'bestaetigen', 'wiederaufnehmen']);
    const ergebnisse = [...ROUTE.matchAll(/return \{ aktion: '([a-z]+)' \}/gu)].map((m) => m[1]);
    for (const sprache of ['de', 'en'] as const) {
      expect(Object.keys(NACHTRAGSGRUNDLAGEN_TEXTE[sprache].erfolg).sort())
        .toEqual([...ergebnisse].sort());
    }
  });
});

describe('die Wörter', () => {
  const GRUENDE: readonly NachtragGrundlageGrund[] = [
    'nicht_gefunden', 'schon_bestaetigt', 'archiviert', 'schon_archiviert',
    'nicht_archiviert', 'schluessel_vergeben',
  ];

  it('jeder Grund des Dienstes hat einen Satz — deutsch und englisch', () => {
    for (const sprache of ['de', 'en'] as const) {
      expect(Object.keys(NACHTRAGSGRUNDLAGEN_TEXTE[sprache].fehler).sort())
        .toEqual([...GRUENDE].sort());
      for (const g of GRUENDE) {
        expect(NACHTRAGSGRUNDLAGEN_TEXTE[sprache].fehler[g], `${sprache}: ${g}`).toBeTruthy();
        expect(DIENST, `der Dienst wirft ${g}`).toContain(`'${g}'`);
      }
    }
  });

  it('die Zahl der Nachträge steht im Satz, der vor dem Archivieren warnt', () => {
    expect(NACHTRAGSGRUNDLAGEN_TEXTE.de.archivierenHinweis(3)).toContain('3');
    expect(NACHTRAGSGRUNDLAGEN_TEXTE.en.archivierenHinweis(3)).toContain('3');
    expect(NACHTRAGSGRUNDLAGEN_TEXTE.de.nachtraege(1)).toContain('1 Nachtrag');
  });

  it('die Voreinstellung nennt O-23 — und der Dienst trägt sie als TODO', () => {
    for (const sprache of ['de', 'en'] as const) {
      expect(NACHTRAGSGRUNDLAGEN_TEXTE[sprache].voreinstellung).toContain('O-23');
    }
    expect(DIENST).toContain('// TODO(client, O-23): Voreinstellung');
  });
});

describe('die Seiten führen hin', () => {
  it('Bau-Übersicht, Nachtragsliste und neues Nachtragsformular verweisen auf die Pflege', () => {
    for (const datei of [
      'src/app/portal/[mandant]/bau/page.tsx',
      'src/app/portal/[mandant]/bau/nachtraege/page.tsx',
      'src/app/portal/[mandant]/bau/projekte/[id]/nachtraege/neu/page.tsx',
    ]) {
      expect(readFileSync(datei, 'utf8'), datei).toContain('/bau/nachtragsgrundlagen');
    }
  });
});
