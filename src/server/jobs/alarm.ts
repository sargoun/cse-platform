/**
 * Der Alarm eines gescheiterten Laufs — und die ehrliche Auskunft, wohin er
 * heute geht.
 *
 * `runner.ts` verspricht: „KEIN stiller Tod." Das Versprechen hielt bisher
 * nur im Test, denn eine `Alarm`-Implementierung gab es im ganzen Zweig
 * nicht. Ein Job, der um drei Uhr nachts scheitert und niemanden erreicht,
 * ist ein Job, der nicht laeuft — und das faellt erst auf, wenn jemand die
 * Zahlen vermisst.
 *
 * **Was hier NICHT passiert: eine Zustellung erfinden.** Es ist kein
 * Bereitschaftskanal verbunden — keine Mailadresse, kein Dienst, keine
 * Nummer (CLAUDE.md „no fake integrations"). Diese Klasse schreibt deshalb
 * zwei Dinge, die beide echt sind:
 *
 *  - eine Zeile auf `stderr`, in einer Form, die sich greppen laesst. Auf
 *    Vercel landet sie in den Funktionsprotokollen; das ist der Ort, an dem
 *    heute jemand nachsehen KANN.
 *  - `job_lauf.ergebnis = 'fehler'` — das schreibt der Runner selbst, und
 *    deshalb steht der Ausfall in der Datenbank und nicht nur in einem
 *    Protokoll, das rotiert.
 *
 * Ein Weg nach draussen kommt hier als zweiter Empfaenger hinzu; der Rest
 * bleibt.
 * // TODO(client, O-354): Voreinstellung — ein Alarm je endgueltig
 * gescheitertem Lauf (nach den Wiederholungen des Runners) und je Lauf mit
 * fehlerhaften Mandanten; geweckt wird niemand, die Gruppe hat keinen
 * Bereitschaftsdienst. Der Alarm steht in der Betriebsansicht
 * (`/einstellungen/betrieb`), im Funktionsprotokoll und in `job_lauf`; eine
 * E-Mail an das Betriebspostfach der Gruppe braucht den Versanddienst (O-116)
 * und die Adresse (Betreiberdaten) und ist nicht gebaut (V-374). D-799.
 */
import type { Alarm } from './runner.js';

export class ProtokollAlarm implements Alarm {
  melde(job: string, laufId: string, fehler: string, versuche: number): Promise<void> {
    /*
     * Eine Zeile, maschinenlesbar, mit dem Praefix `JOB-ALARM` — damit sich
     * ein Filter darauf setzen laesst, ohne dass jemand die Formulierung
     * raten muss. `console.error` und nicht `console.log`: der Unterschied
     * entscheidet auf den meisten Plattformen, ob eine Meldung als Stoerung
     * gilt.
     */
    console.error(JSON.stringify({
      ereignis: 'JOB-ALARM', job, laufId, versuche, fehler,
    }));
    return Promise.resolve();
  }
}
