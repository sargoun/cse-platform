/**
 * Die XRechnung gegen den ECHTEN KoSIT-Pruefer (FIN-11, SPEC §14 Abnahme).
 *
 * **Warum das der einzige Test ist, der hier etwas beweist.** Alles, was
 * `tests/kern/xrechnung.test.ts` prueft, habe ich selbst formuliert — und
 * eine Zusage, die aus demselben Kopf stammt wie der Erzeuger, teilt seine
 * Irrtuemer. Der KoSIT-Pruefer ist das Werkzeug, gegen das die
 * Rechnungseingangsplattformen des Bundes und der Laender pruefen; er kennt
 * die Regeln, an die ich nicht gedacht habe.
 *
 * **Und er hat sofort zwei gefunden**, beide unsichtbar fuer jede
 * selbstgeschriebene Pruefung:
 *
 * 1. Die `CustomizationID` trug die Schreibweise der Fassung 2.x. Das
 *    Dokument war wohlgeformt und vollstaendig; der Pruefer meldete
 *    `noScenarioMatched` und wies es ab, ohne einen inhaltlichen Fehler zu
 *    nennen.
 * 2. `PartyLegalEntity/RegistrationAddress` mit dem Registergericht — nach
 *    §35a GmbHG auf jedem Geschaeftsbrief zu nennen, in UBL aber durch
 *    UBL-CR-185 ausgeschlossen. Angenommen mit Beanstandung.
 *
 * **Der Lauf faellt, wenn der Pruefer fehlt — er ueberspringt nicht.** Ein
 * uebersprungener Compliance-Test ist ein gruener Lauf ohne Pruefung, und
 * das ist genau die Sorte Freigabe, die §5.14.3 verbietet. Nur wer LOKAL
 * ohne Java und ohne Pruefer arbeitet, bekommt einen Hinweis statt eines
 * Fehlschlags; in CI ist `CI` gesetzt und die Ausnahme gilt nicht.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schreibeMuster, MUSTER } from './muster.js';

const JAR = process.env['KOSIT_JAR'] ?? '';
const SZENARIEN = process.env['KOSIT_SZENARIEN'] ?? '';
const IN_CI = (process.env['CI'] ?? '') !== '';

const bereit = JAR !== '' && SZENARIEN !== '' && existsSync(JAR) && existsSync(SZENARIEN);

describe('KoSIT — der Pruefer, gegen den die Empfaenger pruefen', () => {
  it('ist eingerichtet (in CI ist das keine Frage)', () => {
    if (bereit) {
      expect(bereit).toBe(true);
      return;
    }
    if (IN_CI) {
      throw new Error(
        'KOSIT_JAR und KOSIT_SZENARIEN sind nicht gesetzt. In CI ist das ein '
        + 'Fehlschlag und kein Ueberspringen: ein gruener Lauf ohne Pruefung '
        + 'ist eine Freigabe, die niemand erteilt hat (FIN-11, §5.14.3). '
        + 'Der Schritt, der beides setzt, steht in .github/workflows/compliance.yml.',
      );
    }
    // Lokal ohne Pruefer: der Hinweis steht im Testnamen, nicht in einem Log.
    expect(bereit).toBe(false);
  });

  it.runIf(bereit)('nimmt alle vier Muster an — Schema UND Schematron', () => {
    /*
     * `KOSIT_AUSGABE` setzt der CI-Auftrag auf einen Ordner IM Arbeitsbereich,
     * damit er die Pruefberichte danach als Artefakt hochladen kann. Ohne die
     * Angabe (lokal) ein Wegwerfordner: ein Entwicklungsrechner soll nach
     * einem Testlauf nicht voller Berichte sein.
     */
    const ziel = process.env['KOSIT_AUSGABE'] ?? mkdtempSync(join(tmpdir(), 'cse-xrechnung-'));
    mkdirSync(ziel, { recursive: true });
    const dateien = schreibeMuster(ziel);
    expect(dateien).toHaveLength(Object.keys(MUSTER).length);

    const berichte = join(ziel, 'berichte');
    /*
     * `-h` fehlt mit Absicht: ohne die HTML-Berichte ist der Lauf schneller,
     * und was hier gebraucht wird, steht im XML — `valid="true"` und die
     * Bewertung.
     */
    execFileSync('java', [
      '-jar', JAR, '-s', SZENARIEN, '-r', join(SZENARIEN, '..'),
      '-o', berichte, ...dateien,
    ], { stdio: 'pipe', timeout: 300_000 });

    for (const [name] of Object.entries(MUSTER)) {
      const bericht = readFileSync(join(berichte, `${name}-report.xml`), 'utf8');
      /*
       * Drei Zusagen, und jede einzeln: `valid="false"` ist der Gesamtbefund,
       * `rep:reject` die Bewertung, und `noScenarioMatched` der Fall, in dem
       * der Pruefer gar nicht erst geprueft hat — der sah in einer frueheren
       * Fassung aus wie ein inhaltlicher Fehler und war keiner.
       */
      expect(bericht, `${name}: kein Szenario getroffen — pruefe die CustomizationID`)
        .not.toContain('noScenarioMatched');
      expect(bericht, `${name}: vom Pruefer abgewiesen`).not.toContain('<rep:reject');
      expect(bericht, `${name}: nicht valide`).toContain('valid="true"');
    }
  });
});
