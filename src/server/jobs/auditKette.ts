/**
 * Der Nachtlauf der Prüfprotokoll-Hashkette (V-336, O-623, D-791, D-820,
 * SEC-A9, LEG-01).
 *
 * **Warum es ihn braucht.** Die Kette über das Prüfprotokoll (0204) wurde nur
 * fortgeschrieben, wenn jemand ein Beweismittelbündel bildete; zwischen zwei
 * Bündeln blieben Zeilen ungekettet, und nachgerechnet hat sie niemand
 * regelmässig. Beide Einstiege verlangen `system.audit_exportieren` — ein
 * Lauf ohne Benutzer bekam 0 Glieder und keinen Befund, und das sah aus wie
 * „alles in Ordnung".
 *
 * **Was er tut** (`kern.audit_kette_nachtlauf`, 0516): er kettet, was seit dem
 * letzten Mal dazukam, und rechnet nach — die heute berührten Ketten, die
 * beiden jüngsten, jede schon einmal gebrochene und die am längsten nicht
 * geprüfte. Jede Kette kommt so reihum wieder dran, ohne dass jede Nacht zehn
 * Jahre Protokoll gerechnet werden.
 *
 * **`uebergreifend`, nicht `je_mandant`.** Die Kette ist EINE über alle
 * Gesellschaften und die Plattformzeilen (je Monat ein Kopf, 0204); sie je
 * Gesellschaft zu laufen, hiesse dieselbe Kette viermal.
 *
 * **`versuche: 0`, wie beim Rechnungs-Kettenprüfer.** Ein gebrochener Hash
 * wird beim zweiten Hinsehen nicht heil. Ein Bruch lässt den Lauf werfen: der
 * Runner trägt `ergebnis = 'fehler'` mit Kette und Stelle ein und ruft den
 * Alarm (O-354; nach draussen erst mit dem Versanddienst, V-374).
 *
 * TODO(client, O-623): Voreinstellung — nächtlich fortschreiben und
 * nachrechnen, Befund im Nachtlauf-Protokoll, ein Bruch ist ein Alarm.
 * D-791, D-820.
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobRolle, type JobVerbindung } from './sitzung.js';

export class AuditKetteGebrochen extends Error {
  constructor(text: string) {
    super(text);
    this.name = 'AuditKetteGebrochen';
  }
}

export interface AuditKettenPruefung {
  /** Der Name der Monatskette, `audit_log_JJJJ_MM` (UTC, 0204). */
  readonly kette: string;
  readonly glieder: number;
  /** Die erste Stelle, an der die Kette nicht mehr stimmt — `null`: geschlossen. */
  readonly bruchBei: number | null;
}

export interface AuditKettenBefund {
  /** Glieder, die dieser Lauf neu angehängt hat. */
  readonly gekettet: number;
  readonly geprueft: readonly AuditKettenPruefung[];
}

/** Der Satz für das Nachtlauf-Protokoll — er nennt jede gebrochene Kette mit Stelle. */
export function auditKettenMeldung(b: AuditKettenBefund): string {
  const brueche = b.geprueft.filter((p) => p.bruchBei !== null);
  const kopf = `${String(b.gekettet)} Protokollzeilen neu gekettet, `
    + `${String(b.geprueft.length)} Ketten nachgerechnet`;
  if (brueche.length === 0) return `${kopf} — alle geschlossen.`;
  return `${kopf} — gebrochen: `
    + brueche.map((p) => `${p.kette} ab Glied ${String(p.bruchBei)}`).join(', ')
    + '. Die Protokollzeile an dieser Stelle stimmt nicht mehr mit ihrem Hash überein.';
}

/** Ein Lauf, ohne Register — für den Job und für die Prüfung unter der echten Jobrolle. */
export async function fuehreAuditKetteAus(sql: JobVerbindung): Promise<AuditKettenBefund> {
  /*
   * `nurLesen: false`, und das ist der ganze Zweck: der Lauf schreibt
   * Kettenglieder und den Prüfbefund am Kettenkopf (`kern.audit_kette`,
   * `kern.audit_kettenglied`) — sonst nichts. Der Definer weist eine nur
   * lesende Sitzung ab.
   */
  const zeilen = await alsJobRolle(sql, (db) => db.abfrage<{
    kette: string; glieder: number; bruch_bei: number | null; neu: number;
  }>(
    `select kette, glieder::integer as glieder, bruch_bei::integer as bruch_bei, neu
       from kern.audit_kette_nachtlauf()`), { nurLesen: false });
  return {
    gekettet: zeilen[0]?.neu ?? 0,
    geprueft: zeilen.map((z) => ({ kette: z.kette, glieder: z.glieder, bruchBei: z.bruch_bei })),
  };
}

export function registriereAuditKette(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'audit_kette_nachtlauf',
    bezeichnung: 'Prüfprotokoll-Hashkette nächtlich fortschreiben und nachrechnen (SEC-A9)',
    /*
     * Nach dem Rechnungs-Kettenprüfer (03:20) und vor den Abgleichen um 03:40:
     * gekettet wird, was die schreibenden Nachtläufe davor protokolliert haben.
     */
    zeitplan: '25 3 * * *',
    bereich: 'uebergreifend',
    versuche: 0,
    ausfuehren: async (): Promise<Record<string, unknown>> => {
      const befund = await fuehreAuditKetteAus(sql);
      const meldung = auditKettenMeldung(befund);
      if (befund.geprueft.some((p) => p.bruchBei !== null)) {
        throw new AuditKetteGebrochen(meldung);
      }
      return { gekettet: befund.gekettet, geprueft: befund.geprueft.length, meldung };
    },
  });
}
