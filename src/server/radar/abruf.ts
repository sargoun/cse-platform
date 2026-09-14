import 'server-only';
import type { QuellSchluessel } from '../services/radar/quelle.js';

/**
 * Die einzige Stelle, an der der Vergaberadar mit der Aussenwelt spricht
 * (RAD-01, RAD-02).
 *
 * **Warum eine eigene Datei.** Die Merge-Wache `ein-ausgang` verbietet
 * `fetch` ausserhalb einer kurzen Liste von Adaptern, und das aus gutem
 * Grund: Invariante 7 will, dass nichts das System verlaesst, ohne dass ein
 * Mensch zugestimmt hat. Dieser Abruf verlaesst nichts — er LIEST eine
 * oeffentliche Bekanntmachung und schickt dabei nichts als eine Adresse.
 * Trotzdem steht er hier und nicht im Job: ein Netzaufruf gehoert an eine
 * Stelle, die man aufzaehlen kann.
 *
 * **Kein Schluessel, kein Kopf mit Geheimnis.** Beide Quellen sind
 * oeffentlich. Kaeme hier je eine Anmeldung dazu, waere das eine Entscheidung
 * mit einem Auftragsverarbeitungsvertrag daneben — und keine Zeile Code.
 */
export type Abrufer = (quelle: QuellSchluessel, url: string) => Promise<string>;

/** Dreissig Sekunden. Eine Quelle, die laenger braucht, ist heute nicht erreichbar. */
const ZEITGRENZE_MS = 30_000;

export const netzAbruf: Abrufer = async (quelle, url) => {
  const antwort = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(ZEITGRENZE_MS),
  });
  /*
   * **Ein Fehlerstatus ist ein Fehler, kein leeres Fenster.** Wer hier den
   * Text auch bei 500 zurueckgibt, bekommt einen Lauf mit null neuen
   * Bekanntmachungen — und der sieht aus wie ein ruhiger Tag.
   */
  if (!antwort.ok) {
    throw new Error(`${quelle}: HTTP ${String(antwort.status)} von ${url}`);
  }
  return antwort.text();
};
