/**
 * Das ZUGFeRD-PDF gegen den ECHTEN PDF/A-Prüfer (FIN-12, SPEC §14 Abnahme).
 *
 * **Warum das der einzige Test ist, der hier etwas beweist.** Alles in
 * `tests/kern/zugferd-pdf.test.ts` habe ich selbst formuliert: dass ein
 * `/Metadata` dasteht, dass `/OutputIntents` gesetzt ist, dass die Schriften
 * eingebettet sind. Ob das Ergebnis PDF/A-3b IST, sagt keine dieser
 * Prüfungen — das sagt veraPDF, die Referenzimplementierung des ISO-Standards.
 *
 * **Der Lauf fällt, wenn der Prüfer fehlt — er überspringt nicht.** Derselbe
 * Grund wie beim KoSIT-Prüfer: ein übersprungener Konformitätstest ist ein
 * grüner Lauf ohne Prüfung, und ein Beleg mit zehn Jahren Aufbewahrung
 * (§14b UStG, GoBD) ist der letzte Ort für eine solche Freigabe.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baueZugferdPdf } from '../../../src/server/services/finanz/zugferd/pdfa3.js';
import { beispielRechnung } from '../../kern/hilfen/rechnung-beispiel.js';

const CLI = process.env['VERAPDF_CLI'] ?? '';
const IN_CI = (process.env['CI'] ?? '') !== '';
const bereit = CLI !== '' && existsSync(CLI);

describe('veraPDF — der Prüfer, gegen den die Archive prüfen', () => {
  it('ist eingerichtet (in CI ist das keine Frage)', () => {
    if (bereit) { expect(bereit).toBe(true); return; }
    if (IN_CI) {
      throw new Error(
        'VERAPDF_CLI ist nicht gesetzt. In CI ist das ein Fehlschlag und kein '
        + 'Überspringen: ein grüner Lauf ohne Prüfung ist eine Freigabe, die '
        + 'niemand erteilt hat (FIN-12). Der Schritt, der ihn holt, steht in '
        + '.github/workflows/compliance.yml.',
      );
    }
    expect(bereit).toBe(false);
  });

  it.runIf(bereit)('nimmt das erzeugte Dokument als PDF/A-3B an', async () => {
    const ziel = process.env['VERAPDF_AUSGABE']
      ?? mkdtempSync(join(tmpdir(), 'cse-zugferd-'));
    mkdirSync(ziel, { recursive: true });
    const datei = join(ziel, 'rechnung.pdf');
    writeFileSync(datei, await baueZugferdPdf(beispielRechnung(), {
      erzeugtAm: new Date(Date.UTC(2026, 8, 11, 9, 0, 0)),
    }));

    /*
     * `--flavour 3b`: die Stufe, die dieses Dokument behauptet. Ohne die
     * Angabe rät der Prüfer sie aus dem XMP — und prüfte dann gegen das,
     * was wir selbst hineingeschrieben haben, statt gegen das, was wir
     * behaupten.
     */
    let bericht: string;
    try {
      bericht = execFileSync(CLI, ['--format', 'xml', '--flavour', '3b', datei], {
        encoding: 'utf8', stdio: 'pipe', timeout: 300_000,
      });
    } catch (fehler) {
      /*
       * veraPDF endet mit 1, sobald ein Dokument nicht konform ist — und
       * genau dann braucht jemand den Bericht. Ohne diesen `catch` würde
       * `execFileSync` werfen, bevor die Datei geschrieben ist: der Lauf wäre
       * rot, das Artefakt leer, und die verletzte Regel stünde nirgends. Der
       * Bericht liegt in `stdout` des Fehlers.
       */
      bericht = (fehler as { stdout?: string }).stdout ?? '';
      if (bericht === '') throw fehler;
    }
    writeFileSync(join(ziel, 'verapdf-bericht.xml'), bericht);

    expect(bericht, 'veraPDF hat das Dokument nicht als konform bewertet')
      .toContain('isCompliant="true"');
  });
});
