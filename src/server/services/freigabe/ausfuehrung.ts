import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import {
  AKTION_UEBERNEHMEN, VorschlagFehler, uebernehmeEingangsVorschlag,
} from '../finanz/eingang/vorschlag.js';

/**
 * Was nach einer Genehmigung GESCHIEHT — je Aktion ein Ausfuehrer (§4.8).
 *
 * Die Entscheidung ist der Schnappschuss in der Kette; die Ausfuehrung ist
 * die Handlung, die er erlaubt. Beides laeuft in EINER Transaktion: eine
 * Handlung, die scheitert, nimmt die Entscheidung mit zurueck, und der
 * Vorschlag steht wieder offen — kein `fehlgeschlagen`, das jemand nachts
 * findet. Fuer Aussendungen (E-Mail, Angebot) wird das anders sein muessen
 * (§4.8 nennt dafuer `laeuft`/`ausgefuehrt` mit Undo-Fenster); hier steht
 * die eine Aktion, die es heute gibt.
 *
 * **Eine Aktion ohne Ausfuehrer ist kein Fehler.** Die Vorschlaege des Seeds
 * (Monatsrechnung, Hinweis) sind Vorlagen ohne Handlung; sie werden
 * entschieden und bleiben, was sie sind.
 */
export interface Ausgefuehrt {
  readonly art: 'keine' | 'eingangsrechnung';
  readonly bezugId: string | null;
}

/** Ein Ausfuehrer, der abweist — mit einem Satz fuer den Menschen (409, nie 500). */
export class AusfuehrungAbgewiesen extends Error {
  constructor(nachricht: string, readonly grund: string) {
    super(nachricht);
    this.name = 'AusfuehrungAbgewiesen';
  }
}

/**
 * **Hat diese Aktion überhaupt einen Ausführer?**
 *
 * Die Frage entscheidet, ob ein Einspruchsfenster (APR-05) armiert werden
 * darf: ein Fenster VERSCHIEBT die Ausführung, und verschieben lässt sich nur,
 * was jemand danach tut. Bei einer Aktion ohne Ausführer ist die Genehmigung
 * selbst der Vorgang — dort ist das Fenster die ganze Wirkung, und der Lauf,
 * der es schliesst, hat nichts nachzuholen.
 *
 * **Andersherum wäre es eine stille Lücke:** ein Fenster über einer Aktion MIT
 * Ausführer liesse die Freigabe genehmigt und ungetan stehen, sobald die Frist
 * abläuft — der Lauf führt bewusst nicht aus (er hätte weder Sitzung noch
 * Rechte eines Menschen, §4.8). Diese Funktion macht daraus einen Riegel
 * statt einer Verabredung.
 */
export function hatAusfuehrer(aktion: string): boolean {
  return aktion === AKTION_UEBERNEHMEN;
}

export async function fuehreAus(
  kontext: SchreibKontext, freigabeId: string, aktion: string,
): Promise<Ausgefuehrt> {
  if (aktion !== AKTION_UEBERNEHMEN) return { art: 'keine', bezugId: null };
  try {
    const u = await uebernehmeEingangsVorschlag(kontext, freigabeId);
    return { art: 'eingangsrechnung', bezugId: u.eingangsrechnungId };
  } catch (fehler: unknown) {
    if (fehler instanceof VorschlagFehler) {
      throw new AusfuehrungAbgewiesen(fehler.message, fehler.grund);
    }
    throw fehler;
  }
}
