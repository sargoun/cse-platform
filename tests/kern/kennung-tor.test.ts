/**
 * Jede dynamische Portalseite prüft ihre Kennung, bevor sie sie benutzt.
 *
 * **Der Befund.** Ein Rundgang durch jede Portaladresse fand sieben Seiten mit
 * **500**. Fünf hatten dieselbe Ursache: die Seitenkarte führt
 * `…/crm/leads/neu`, `…/crm/kunden/neu`, `…/angebote/neu`, `…/objekte/neu`,
 * `…/reinigung/reviere/neu`, gebaut ist keine — also greift Next.js die
 * Nachbarroute `[id]` und reicht `"neu"` unverändert in ein `$1::uuid`.
 * Postgres antwortet `invalid input syntax for type uuid`, die Anwendung mit
 * 500.
 *
 * Nachgezählt trugen **44 von 65** dynamischen Seiten diese Lücke. Es war nie
 * nur `neu`: jeder Tippfehler in einer Adresse, jeder alte Verweis, jede
 * Kennung aus einer anderen Datenbank ergab dort einen Serverfehler statt
 * eines 404.
 *
 * **Ein 500 ist die schlechteste aller Antworten.** Er sagt „mein Fehler", wo
 * „gibt es nicht" die Wahrheit ist, und er füllt das Fehlerprotokoll mit
 * Zeilen, die keine Fehler sind — bis der eine echte darin untergeht.
 *
 * Geprüft wird über ALLE Seiten, nicht über die, die es erwischt hat.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { istKennung } from '../../src/app/portal/kennung.js';
import { ohneKommentareMitTexten } from './hilfen/quelltext.js';

const WURZEL = 'src/app/portal/[mandant]';

/** Parameter, die eine UUID tragen. `datum`, `agent`, `mandant` NICHT. */
const UUID_PARAM = new Set(['id', 'aufmassId', 'bid', 'nachtragId', 'anstellungId']);

function seiten(verzeichnis: string): readonly string[] {
  const treffer: string[] = [];
  for (const e of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, e);
    if (statSync(voll).isDirectory()) treffer.push(...seiten(voll));
    else if (e === 'page.tsx') treffer.push(voll.slice(WURZEL.length + 1));
  }
  return treffer;
}

const MIT_KENNUNG = seiten(WURZEL).filter((rel) => rel
  .split('/')
  .some((t) => t.startsWith('[') && UUID_PARAM.has(t.slice(1, -1))));

describe('istKennung', () => {
  it('nimmt eine UUID an', () => {
    expect(istKennung('0f3a6c1e-9b2d-4a7f-8c15-2e4d6b8a0c31')).toBe(true);
  });

  it('und sonst nichts — `neu` war der Fall aus dem Betrieb', () => {
    for (const wert of ['neu', 'vorschlaege', '', 'stapel', '123', undefined,
      '0f3a6c1e-9b2d-4a7f-8c15-2e4d6b8a0c3', 'ZZZZZZZZ-9b2d-4a7f-8c15-2e4d6b8a0c31']) {
      expect(istKennung(wert), String(wert)).toBe(false);
    }
  });
});

describe('jede Seite mit einem Kennungsparameter prüft ihn', () => {
  it('es gibt überhaupt solche Seiten', () => {
    // Ohne diese Zusage liefe die Schleife unten über nichts und waere gruen.
    expect(MIT_KENNUNG.length).toBeGreaterThan(40);
  });

  for (const rel of MIT_KENNUNG) {
    it(rel, () => {
      const quelle = ohneKommentareMitTexten(readFileSync(join(WURZEL, rel), 'utf8'));
      expect(
        quelle.includes('kennungOder404('),
        'Diese Seite reicht ihren Adressteil ungeprueft weiter — ein Segment, '
        + 'das keine UUID ist, wird damit zu einem 500 statt zu einem 404.',
      ).toBe(true);
    });
  }
});

describe('die Prüfung steht VOR der ersten Abfrage', () => {
  /*
   * Zu spaet geprueft ist nicht geprueft: was einmal in `portalZugang` oder in
   * einen Dienst gelangt ist, hat die Datenbank schon gesehen.
   */
  for (const rel of MIT_KENNUNG) {
    it(rel, () => {
      const quelle = ohneKommentareMitTexten(readFileSync(join(WURZEL, rel), 'utf8'));
      const iTor = quelle.indexOf('kennungOder404(');
      const iErste = Math.min(
        ...['portalZugang(', 'mandantTor(', 'db()', 'withTenant(']
          .map((n) => quelle.indexOf(n))
          .filter((i) => i >= 0)
          .concat([Number.MAX_SAFE_INTEGER]));
      if (iErste === Number.MAX_SAFE_INTEGER) return;
      expect(iTor, 'die Kennungspruefung steht hinter der ersten Abfrage')
        .toBeLessThan(iErste);
    });
  }
});
