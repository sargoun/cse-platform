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
