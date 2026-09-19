import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  istUebermittlung, UEBERMITTLUNGSFELDER,
} from '../../src/lib/formular/uebermittlung.js';

/**
 * Jedes versteckte Feld des Anfrageformulars steht in der Übermittlungsliste.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Fall, der diese Datei erzwungen hat.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Annahme validiert jede Einsendung gegen die veröffentlichte
 * `formular_definition` und weist alles ab, was dort nicht steht (SEC-A4). Die
 * versteckten Felder des Formulars stehen dort naturgemäss nicht — sie gehören
 * zur Übermittlung und nicht zum Formular.
 *
 * Mit D-599 kam `antwort` als verstecktes Feld dazu und wurde in der
 * Ausnahmeliste vergessen. Die Folge war kein Randfall: **jede** Absendung des
 * Angebotsformulars wurde abgewiesen, mit „Bitte prüfen Sie die markierten
 * Felder" und einem Feldnamen, den es nicht gibt. Über der Liste stand
 * wörtlich die Warnung, dass genau das passieren würde.
 *
 * Ein Kommentar ist keine Vorrichtung. Dieser Fall liest die
 * Formularkomponente und zählt nach.
 */

const FORMULAR = 'src/components/oeffentlich/AnfrageFormular.tsx';

/** Jedes `<input type="hidden" name="…">` der Komponente. */
function versteckteFelder(): readonly string[] {
  const quelle = readFileSync(FORMULAR, 'utf8');
  const namen: string[] = [];
  /*
   * Gelesen wird die QUELLE und nicht ein gerendertes Ergebnis: ein Test, der
   * die Komponente rendert, braucht einen Datensatz und eine Sprache und
   * prueft dann eine Auswahl. Der Quelltext nennt alle.
   */
  for (const treffer of quelle.matchAll(
    /<input\s+type="hidden"\s+name="(\w+)"/gu,
  )) {
    const name = treffer[1];
    if (name !== undefined) namen.push(name);
  }
  return namen;
}

describe('die Übermittlungsfelder des Anfrageformulars', () => {
  it('findet überhaupt welche — sonst liefe die Prüfung über nichts', () => {
    expect(versteckteFelder().length).toBeGreaterThanOrEqual(3);
  });

  it('JEDES versteckte Feld steht in der Liste', () => {
    const fehlend = versteckteFelder().filter((n) => !istUebermittlung(n));
    expect(
      fehlend,
      'Ein verstecktes Feld, das hier fehlt, laesst die Validierung JEDE '
      + 'Absendung abweisen — mit einer Meldung ueber ein Feld, das es nicht '
      + 'gibt. Eintragen in src/lib/formular/uebermittlung.ts.',
    ).toEqual([]);
  });

  it('nennt die vier, die es heute gibt', () => {
    /*
     * Eine Pruefsumme und keine Doppelung: waechst die Liste, faellt dieser
     * Fall und jemand liest den Kommentar darueber. Waechst sie um ein Feld,
     * das WIRKLICH zur Uebermittlung gehoert, ist die Zeile hier eine
     * Sekunde Arbeit.
     */
    expect([...UEBERMITTLUNGSFELDER].sort()).toEqual([
      'antwort', 'bereich', 'landing_page', 'sprache', 'website',
    ]);
  });

  it('nimmt jede utm-Angabe, ohne sie einzeln zu kennen', () => {
    /*
     * Welche Kampagnenparameter eine Anzeige mitschickt, weiss niemand im
     * Voraus — sie kommen aus der Adresse des Besuchs (REQ-07).
     */
    for (const n of ['utm_quelle', 'utm_medium', 'utm_kampagne', 'utm_irgendwas']) {
      expect(istUebermittlung(n), n).toBe(true);
    }
  });

  it('nimmt NICHT irgendeinen Namen — sonst prüfte die Validierung nichts', () => {
    for (const n of ['email', 'flaeche_qm', 'anzahl_objekte', 'erfundenes_feld']) {
      expect(istUebermittlung(n), n).toBe(false);
    }
  });
});
