/**
 * Die Regeln der Fassungskette, die sich ohne Datenbank prüfen lassen
 * (DOC-05, V-219, D-713).
 *
 *  - Welche Kategorien eine zweite Fassung bekommen — und dass der Dienst
 *    dieselbe Liste sperrt wie der Auslöser in 0470. Zwei Listen, die
 *    auseinanderlaufen, wären zwei Wahrheiten über dieselbe GoBD-Regel.
 *  - Der Schlüssel einer Fassung ist ein GESCHWISTER der ersten, kein
 *    Unterordner: im Vorführordner ist der erste Schlüssel eine Datei.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FASSUNG_ERLAUBT_PLATZHALTER, FASSUNG_GESPERRT, KATEGORIEN, fassungMoeglich,
} from '../../src/server/services/dokument/kategorie.js';
import { fassungSchluessel } from '../../src/server/services/dokument/ablage.js';
import { OrdnerSpeicher } from '../../src/server/storage/ordner.js';

describe('welche Kategorien eine zweite Fassung bekommen', () => {
  it('Rechnung, Beleg und Buchhaltung nie — die übrigen sechs bis zur Antwort auf O-937', () => {
    for (const k of ['rechnung', 'beleg', 'buchhaltung']) expect(fassungMoeglich(k), k).toBe(false);
    for (const k of ['kunde', 'vertrag', 'angebot', 'mitarbeiter', 'projekt', 'unternehmen']) {
      expect(fassungMoeglich(k), k).toBe(true);
    }
    expect(fassungMoeglich('unbekannt')).toBe(false);
    expect([...FASSUNG_GESPERRT, ...FASSUNG_ERLAUBT_PLATZHALTER].sort())
      .toEqual([...KATEGORIEN].sort());
  });

  it('der Auslöser in 0470 sperrt genau dieselben Kategorien', () => {
    const sql = readFileSync(fileURLToPath(
      new URL('../../drizzle/0470_dokument_fassungskette.sql', import.meta.url)), 'utf8');
    const treffer = /v_kategorie in \(([^)]*)\)/u.exec(sql);
    expect(treffer).not.toBeNull();
    const liste = (treffer![1] ?? '').split(',').map((t) => t.trim().replace(/'/gu, ''));
    expect(liste.sort()).toEqual([...FASSUNG_GESPERRT].sort());
  });
});

describe('der Schlüssel einer Fassung', () => {
  const mandant = '00000000-0000-4000-8000-000000000001';
  const dokument = '00000000-0000-4000-8000-0000000000aa';

  it('ist ein Geschwister der ersten Fassung, nicht ihr Unterordner', () => {
    const erste = `${mandant}/vertrag/${dokument}`;
    const zweite = fassungSchluessel(mandant, 'vertrag', dokument, 2);
    expect(zweite).toBe(`${erste}.v2`);
    expect(zweite.startsWith(`${erste}/`)).toBe(false);
    expect(fassungSchluessel(mandant, 'vertrag', dokument, 3)).not.toBe(zweite);
  });

  it('passt in den Vorführordner neben die erste Fassung', () => {
    const ordner = new OrdnerSpeicher('/tmp/cse-fassung-probe');
    const erste = ordner.ort('dokumente', `${mandant}/vertrag/${dokument}`);
    const zweite = ordner.ort('dokumente', fassungSchluessel(mandant, 'vertrag', dokument, 2));
    expect(zweite).not.toBe(erste);
    expect(zweite.startsWith(`${erste}/`)).toBe(false);
  });
});
