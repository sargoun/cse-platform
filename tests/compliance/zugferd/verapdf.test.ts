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
import { createHash } from 'node:crypto';
import { baueZugferdPdf } from '../../../src/server/services/finanz/zugferd/pdfa3.js';
import type { RechnungVollstaendig } from '../../../src/server/services/finanz/kanonisch.js';
import { beispielRechnung } from '../../kern/hilfen/rechnung-beispiel.js';
import { JPEG_RGB, pngMitAlpha } from '../../kern/hilfen/bild.js';

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

  /*
   * Dreimal: ohne Logo, mit PNG MIT Alphakanal und mit JPEG (V-132). Das PNG
   * ist der Fall, der zählt — Transparenz braucht in PDF/A eine `/SMask`,
   * und PDF/A-1 verbot sie ganz. Ob -3B sie so annimmt, wie `pdf-lib` sie
   * schreibt, sagt nur der Prüfer.
   */
  const png = pngMitAlpha(240, 80);
  const summe = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
  const mit = (bytes: Uint8Array, endung: 'png' | 'jpg'): RechnungVollstaendig => {
    const r = beispielRechnung();
    return { ...r, leistender: { ...r.leistender, logo: {
      schluessel: `${r.leistender.id}/logo_druck/${summe(bytes)}.${endung}`,
      sha256: summe(bytes),
      mime: endung === 'png' ? 'image/png' : 'image/jpeg',
    } } };
  };
  it.runIf(bereit).each([
    ['rechnung.pdf', beispielRechnung(), undefined],
    ['rechnung-logo-png.pdf', mit(png, 'png'), png],
    ['rechnung-logo-jpg.pdf', mit(JPEG_RGB, 'jpg'), JPEG_RGB],
  ] as const)('nimmt %s als PDF/A-3B an', async (name, rechnung, logo) => {
    const ziel = process.env['VERAPDF_AUSGABE']
      ?? mkdtempSync(join(tmpdir(), 'cse-zugferd-'));
    mkdirSync(ziel, { recursive: true });
    const datei = join(ziel, name);
    writeFileSync(datei, await baueZugferdPdf(rechnung, {
      erzeugtAm: new Date(Date.UTC(2026, 8, 11, 9, 0, 0)),
      ...(logo === undefined ? {} : { logo }),
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
    writeFileSync(join(ziel, name.replace(/\.pdf$/u, '-verapdf-bericht.xml')), bericht);

    expect(bericht, 'veraPDF hat das Dokument nicht als konform bewertet')
      .toContain('isCompliant="true"');
  });
});
