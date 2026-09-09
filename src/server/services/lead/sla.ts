/**
 * Die SLA-Frist und die Eskalationsstufe (REQ-05, REQ-06).
 *
 * **Reine Funktionen, kein `now()` darin.** Der Zeitpunkt kommt herein, damit
 * die DST-Faelle und die Stundengrenze pruefbar sind, ohne die Systemuhr zu
 * stellen. Invariante 2: gerechnet wird auf UTC-Instanten; die Anzeige in
 * Europe/Berlin ist eine andere Schicht.
 *
 * **Was hier NICHT entschieden wird.** Ob die Frist in Kalender- oder
 * Werktagsstunden laeuft und wann sie an einem Freitagabend beginnt, ist offen
 * (O-14). Diese Datei rechnet deshalb in KALENDERSTUNDEN und sagt das — sie
 * waehlt nicht still eine Werktagsregel, die spaeter niemand als Entscheidung
 * wiederfindet.
 *
 * // TODO(client): O-14 — Reaktionszeit je Bereich: Kalenderstunden oder
 * // Werktagsstunden, und ab wann läuft sie an einem Freitagabend? Gilt sie
 * // auch für manuell erfasste Leads, Empfehlungen und Radar-Treffer?
 */

export class SlaFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'SlaFehler'; }
}

/**
 * `eingegangen_am + sla_stunden`, in Kalenderstunden.
 *
 * `null` heisst: keine Frist. Das ist der richtige Wert fuer ein Formular ohne
 * gepflegtes `sla_stunden` und fuer jeden Lead ohne Formular — eine erfundene
 * Frist waere schlimmer als keine, weil der Eskalationsjob sie ernst nimmt.
 */
export function slaFrist(eingegangen: Date, stunden: number | null): Date | null {
  if (stunden === null) return null;
  if (!Number.isInteger(stunden) || stunden <= 0) {
    throw new SlaFehler(`sla_stunden muss eine positive ganze Zahl sein, war ${String(stunden)}.`);
  }
  return new Date(eingegangen.getTime() + stunden * 3_600_000);
}

export interface EskalationsLage {
  readonly slaFristAm: Date | null;
  readonly ersteReaktionAm: Date | null;
  readonly zuletztEskaliertAm: Date | null;
  readonly eskalationsstufe: number;
}

export interface Eskalationsentscheidung {
  readonly eskalieren: boolean;
  readonly neueStufe: number;
  readonly grund: string;
}

/** Eine Stunde. Der Waechter laeuft stuendlich, und oefter als er laeuft nie. */
const FENSTER_MS = 3_600_000;

/**
 * Entscheidet, ob JETZT eskaliert wird.
 *
 * Drei Sperren, und jede hat einen Ausfall dahinter:
 *
 *  1. Ohne Frist keine Eskalation — sonst eskaliert jeder manuelle Lead.
 *  2. Mit erster Reaktion keine Eskalation — die Uhr steht.
 *  3. **Hoechstens einmal je Stunde.** Ohne diese Sperre schickt ein Job, der
 *     nach einem Fehler wiederholt wird, dieselbe Eskalation mehrfach; und ein
 *     Empfaenger, der stuendlich dieselbe Mail bekommt, filtert sie weg — dann
 *     ist die Eskalation genau in dem Moment wirkungslos, in dem sie zaehlt.
 */
export function entscheideEskalation(
  lage: EskalationsLage, jetzt: Date,
): Eskalationsentscheidung {
  const bleibt = (grund: string): Eskalationsentscheidung =>
    ({ eskalieren: false, neueStufe: lage.eskalationsstufe, grund });

  if (lage.slaFristAm === null) return bleibt('keine Frist gesetzt');
  if (lage.ersteReaktionAm !== null) return bleibt('erste Reaktion erfolgt — die Uhr steht');
  if (jetzt.getTime() < lage.slaFristAm.getTime()) return bleibt('Frist läuft noch');

  if (lage.zuletztEskaliertAm !== null
      && jetzt.getTime() - lage.zuletztEskaliertAm.getTime() < FENSTER_MS) {
    return bleibt('in dieser Stunde bereits eskaliert');
  }

  return {
    eskalieren: true,
    neueStufe: lage.eskalationsstufe + 1,
    grund: `SLA seit ${lage.slaFristAm.toISOString()} überschritten`,
  };
}
