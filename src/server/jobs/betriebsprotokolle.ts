/**
 * Der Löschlauf für Anmeldeversuche und das Nachtlauf-Protokoll (V-330,
 * O-92, D-790, D-822).
 *
 * `kern.anmeldeversuch` trägt seit 0007 einen Index für genau diesen Zweck —
 * gelöscht hat nie etwas; `job_lauf` und `job_lauf_mandant` wuchsen ebenso
 * unbegrenzt. Die Fristen stehen als vorläufige Einstellungen
 * (`datenschutz.anmeldeversuch_tage`, `betrieb.job_lauf_tage`, 0518); was
 * gelöscht wird, entscheidet `kern.betriebsprotokolle_aufraeumen`, und der
 * Lauf schreibt je Tabelle Frist und Zahl ins Protokoll.
 *
 * **Das Prüfprotokoll bleibt** (Invariante 8, GoBD, die Kette 0204/0516). Eine
 * eigene Tabelle für Sicherheitsvorfälle gibt es nicht; Anmeldung, Sperre und
 * zweiter Faktor stehen als Plattformzeilen im Prüfprotokoll.
 *
 * **`uebergreifend`**: die drei Tabellen tragen keinen Mandanten — ein
 * Anmeldeversuch geschieht, bevor eine Gesellschaft bekannt ist, und ein Lauf
 * gilt oft allen (0007, 0010).
 *
 * TODO(client, O-92): Voreinstellung — Anmeldeversuche 30 Tage,
 * Nachtlauf-Protokoll ein Jahr, Prüfprotokoll zehn Jahre (ohne Löschlauf).
 * D-790, D-822.
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobRolle, type JobVerbindung } from './sitzung.js';

export interface AufraeumZeile {
  readonly tabelle: string;
  readonly fristTage: number;
  readonly geloescht: number;
}

/** Ein Lauf, ohne Register — für den Job und für die Prüfung unter der echten Jobrolle. */
export async function raeumeBetriebsprotokolleAuf(
  sql: JobVerbindung,
): Promise<readonly AufraeumZeile[]> {
  /*
   * `nurLesen: false`: der Lauf löscht — Anmeldeversuche nach ihrer Frist und
   * abgeschlossene Läufe samt ihren Ergebnissen je Gesellschaft, sonst nichts.
   */
  const zeilen = await alsJobRolle(sql, (db) => db.abfrage<{
    tabelle: string; frist_tage: number; geloescht: number;
  }>(
    `select tabelle, frist_tage, geloescht::integer as geloescht
       from kern.betriebsprotokolle_aufraeumen()`), { nurLesen: false });
  return zeilen.map((z) => ({
    tabelle: z.tabelle, fristTage: z.frist_tage, geloescht: z.geloescht,
  }));
}

export function registriereBetriebsprotokolle(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'betriebsprotokolle_aufraeumen',
    bezeichnung: 'Anmeldeversuche und Nachtlauf-Protokoll nach ihrer Frist löschen (O-92)',
    /* Nach den Nachtläufen des Tages, damit ihr eigenes Protokoll schon steht. */
    zeitplan: '30 4 * * *',
    bereich: 'uebergreifend',
    versuche: 1,
    ausfuehren: async (): Promise<Record<string, unknown>> => {
      const zeilen = await raeumeBetriebsprotokolleAuf(sql);
      return Object.fromEntries(zeilen.map((z) => [
        z.tabelle, { frist_tage: z.fristTage, geloescht: z.geloescht },
      ]));
    },
  });
}
