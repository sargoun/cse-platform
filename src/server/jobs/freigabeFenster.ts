import { registriere, type JobDefinition } from './registry.js';
import type { Abfrage } from '../benachrichtigung/ablage.js';
import { hatAusfuehrer } from '../services/freigabe/ausfuehrung.js';

/**
 * Der Lauf, der abgelaufene Einspruchsfenster auslöst (APR-05).
 *
 * **Was er tut und was nicht.** Er setzt `verzoegerte_freigabe_bis` zurück und
 * gibt die Freigabe zur Ausführung frei — er führt sie **nicht selbst aus**.
 * Das ist die Grenze: die fachliche Ausführung kennt der Dienst, der den
 * Vorschlag erzeugt hat (`services/freigabe/ausfuehrung`), und sie läuft in
 * der Sitzung eines Menschen mit seinen Rechten. Ein Job, der alle Fachwege
 * kennt, wäre eine zweite Fassung jedes dieser Wege — und er liefe mit einer
 * Rolle, die mehr darf als jeder Mensch.
 *
 * **Und deshalb bekommt eine Freigabe MIT Ausführer gar kein Fenster.** Sonst
 * stünde sie nach Ablauf genehmigt und ungetan da, und niemand sähe den
 * Unterschied: „Ausführung offen" sieht bei einer Vorgangsart ohne Handlung
 * genauso aus. Den Riegel setzt `entscheideStapel` über `hatAusfuehrer` —
 * hier zählt der Lauf nach, wie viele er freigegeben hat, und die Zahl gehört
 * zu den Zeilen, die nichts mehr zu tun haben.
 *
 * **Die Gegenprobe steht im Kennzahlensatz.** `mit_ausfuehrer` muss null sein.
 * Ist sie es einmal nicht, hat jemand einen Ausführer ergänzt, ohne den
 * Riegel mitzudenken — und das soll im Laufprotokoll stehen, nicht in einem
 * Vorgang, der ein halbes Jahr wartet.
 *
 * **Alle fünf Minuten.** Ein Einspruchsfenster von dreissig Minuten (O-108)
 * und ein Lauf einmal pro Stunde ergäben zusammen ein Fenster zwischen dreissig
 * und neunzig Minuten — das wäre keine Frist, sondern eine Spanne.
 */
export function registriereFreigabeFenster(db: Abfrage): JobDefinition {
  return registriere({
    schluessel: 'freigabe_fenster',
    bezeichnung: 'Abgelaufene Einspruchsfenster freigeben (APR-05)',
    zeitplan: '*/5 * * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      /**
       * `verzoegerte_freigabe_bis = null` heisst „das Fenster ist durch".
       * Der Stand bleibt `genehmigt`, die Ausführung bleibt `offen` — genau
       * so, wie eine Freigabe ohne Fenster aussieht.
       */
      const frei = (await db.unsafe(
        `update freigabe
            set verzoegerte_freigabe_bis = null, geaendert_am = now()
          where verzoegerte_freigabe_bis is not null
            and verzoegerte_freigabe_bis <= now()
            and status = 'genehmigt'
            and ausfuehrung_status = 'offen'
          returning id, mandant_id, aktion`,
      )) as readonly { id: string; mandant_id: string; aktion: string }[];
      const mitAusfuehrer = frei.filter((f) => hatAusfuehrer(f.aktion)).length;

      /**
       * **Abgelaufene Rücknahmefenster werden geschlossen, nicht vergessen.**
       * Ein `undo_bis` in der Vergangenheit sähe in der Oberfläche aus wie ein
       * offenes Fenster, bis jemand auf die Uhr sieht; die Datenbankfunktion
       * wiese den Klick dann ab — richtig, aber der Knopf hätte gar nicht
       * erst dastehen dürfen.
       */
      const geschlossen = (await db.unsafe(
        `update freigabe set undo_bis = null, geaendert_am = now()
          where undo_bis is not null and undo_bis <= now()
          returning id`)) as readonly { id: string }[];

      return {
        freigegeben: frei.length,
        mit_ausfuehrer: mitAusfuehrer,
        ruecknahmefenster_geschlossen: geschlossen.length,
      };
    },
  });
}
