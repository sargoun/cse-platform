import 'server-only';
import { arten, type ArtDefinition } from './registry.js';
import { registriereWaechterArten } from '../services/waechter/benachrichtigung.js';
import { registriereDienstplanArten } from '../services/dienstplan/benachrichtigung.js';
import { registriereLeadArten } from '../services/lead/benachrichtigung.js';
import { registriereNachweisArten } from '../services/nachweis/benachrichtigung.js';
import { registriereRadarArten } from '../services/radar/benachrichtigung.js';
import { registriereAgentArten } from '../agent/benachrichtigung.js';

/**
 * Alle Benachrichtigungsarten an EINER Stelle anmelden.
 *
 * **Warum es das braucht.** Bis hierher meldete jedes Modul seine Arten dort
 * an, wo es sie braucht — der Nachtlauf ruft `registriereWaechterArten()`, der
 * Radarlauf seine, und fertig. Fuer die Zustellung genuegt das: wer eine Art
 * erzeugt, hat sie vorher angemeldet.
 *
 * Fuer NOT-02 genuegt es nicht. Die Einstellungsseite muss **alle** Arten
 * aufzaehlen koennen, auch die, deren Modul in dieser Anfrage nie laeuft.
 * Sonst listet sie genau die, die zufaellig schon importiert wurden — und ein
 * Kanal, den man nicht abschalten kann, weil seine Art im Formular fehlt, ist
 * dasselbe wie keine Einstellung.
 *
 * **Jede Registrierung ist idempotent** (D-493): `registriereArt` wirft beim
 * zweiten Mal, und das ist richtig — zwei Definitionen derselben Art waeren
 * zwei Texte, von denen einer gewinnt. Die Modulfunktionen fangen den Fall
 * selbst ab und geben die bestehende Definition zurueck.
 */
export function alleArten(): readonly ArtDefinition[] {
  registriereWaechterArten();
  registriereDienstplanArten();
  registriereLeadArten();
  registriereNachweisArten();
  registriereRadarArten();
  registriereAgentArten();
  return arten();
}

/**
 * Die Module in der Reihenfolge, in der sie auf der Einstellungsseite stehen —
 * und ihre Ueberschrift.
 *
 * Der Schluessel einer Art ist `<modul>.<ereignis>`; das Modul ist damit
 * schon da und wird nicht zweitverwaltet. Was hier steht, ist nur die
 * deutsche Beschriftung, und ein unbekanntes Modul faellt auf seinen
 * Schluessel zurueck statt zu verschwinden.
 */
export const MODUL_TITEL: Readonly<Record<string, string>> = {
  agent: 'KI-Agenten',
  bau: 'Bau',
  crm: 'Vertrieb',
  dienstplan: 'Dienstplan',
  personal: 'Personal',
  radar: 'Vergaberadar',
};

export function modulVon(schluessel: string): string {
  return schluessel.split('.')[0] ?? schluessel;
}

export function modulTitel(modul: string): string {
  return MODUL_TITEL[modul] ?? modul;
}
