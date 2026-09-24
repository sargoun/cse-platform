import 'server-only';
import type { ZaehlerSchluessel } from '../../../lib/i18n/verwaltung/bereichswechsel.js';
import type { Portal, Scope } from '../../kontext/index.js';
import { istInterneLeiste, leisteFuer } from '../../registry/tableiste.js';

/**
 * **Was der Bereichsumschalter über eine Anmeldung weiss** (TEN-06, TEN-10,
 * DESIGN §6, V-165, D-659, V-166, D-660).
 *
 * Drei Fragen, eine Transaktion — die des Tors (`portalZugang`) oder die der
 * Bereichswahl (`/auth/bereich`):
 *
 *  1. In welche Bereiche darf diese Anmeldung wechseln? `app.umschalter_bereiche()`
 *     (0417) — dieselbe Menge wie `switcher_mandanten()`, mit Namen und den
 *     gebuchten Gewerken.
 *  2. Darf sie die Gruppenübersicht betreten? `app.darf_gruppenansicht()`
 *     (0018, 03-AUTH §4.5).
 *  3. Was zeigt jede Zeile als Live-Zähler? `app.mandant_kennzahlen()` (0417,
 *     0418) — nur Anzahlen, nur wo der Betrachter mit einer INTERNEN Rolle
 *     arbeitet und das Leserecht hält.
 *
 * **Bei einem Bereich wird nur die erste gestellt.** Dann rendert niemand
 * einen Umschalter (DESIGN §6 Regel 1, D-43), und die Gruppenübersicht
 * verlangt ohnehin zwei Bereiche. Zwei Abfragen auf jeder Seite für eine
 * Antwort, die niemand zeigt, wären zwei zu viel.
 *
 * **Die Zähler fragt nur, wer es ausdrücklich sagt** (D-660). Bis V-166 war
 * „mit Zählern" die Vorgabe, und die Bereichswahl liess die Angabe weg. Ein
 * Kundenkonto mit zwei Gesellschaften sah dort den Auftragsbestand jeder
 * Gesellschaft über ALLE Kunden, weil die Definer-Zählung die Kundendecke der
 * RLS nicht kennt. Jetzt ist die Frage Pflicht (`StandFragen`), und der
 * Compiler lässt keinen Aufruf ohne sie durch.
 */

export type { ZaehlerSchluessel };

/**
 * Was ein Aufrufer ausser den Bereichen wissen will. Beide Felder sind
 * Pflicht: eine vergessene Angabe darf nicht still „ja" heissen.
 */
export interface StandFragen {
  /** Den Gruppeneintrag (`app.darf_gruppenansicht`) — Umschalter und Bereichswahl. */
  readonly gruppe: boolean;
  /**
   * Die Live-Zähler (`app.mandant_kennzahlen`). `true` nur für eine Sitzung,
   * für die `zaehltFuer` ja sagt. Die Datenbank prüft danach noch einmal je
   * Bereich (0418).
   */
  readonly zaehler: boolean;
}

/**
 * **Für welche Sitzung Zähler gefragt werden** (D-659 Nr. 4, D-660): nur für
 * die internen Leisten, also das interne Portal und die Gruppenansicht.
 *
 * Das Kundenportal und das Mitarbeiterportal tragen keinen Umschalter. Ihr
 * Konto sieht die Vorgänge einer Gesellschaft nur durch eine Decke
 * (`p_kunde_decke`, `p_portal_decke`); eine Zahl über den ganzen Bestand wäre
 * dort eine Auskunft über fremde Kunden (05-API-KARTE: „a count is a real
 * disclosure"). Die Rolle ändert daran nichts: `admin`, `leitung` und die
 * globale Rolle liegen alle auf einer internen Leiste.
 */
export function zaehltFuer(sitzung: { readonly portal: Portal; readonly ansicht: Scope }): boolean {
  return istInterneLeiste(leisteFuer(sitzung.portal, sitzung.ansicht, null));
}

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface Zaehler {
  readonly schluessel: ZaehlerSchluessel;
  readonly wert: number;
}

export interface UmschalterEintrag {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly istStandard: boolean;
  /** Die gebuchten Gewerke — `null`: die Buchung wurde nie gepflegt (O-355). */
  readonly gewerke: readonly string[] | null;
  /** Der eine Zähler dieser Zeile — `null`: kein Leserecht dafür, oder kein Gewerk. */
  readonly zaehler: Zaehler | null;
}

export interface UmschalterStand {
  readonly bereiche: readonly UmschalterEintrag[];
  /** Darf diese Anmeldung die Gruppenübersicht betreten? */
  readonly gruppe: boolean;
}

/**
 * **Welcher Zähler in einer Zeile steht** (D-659) — eine Regel über die
 * gebuchten Gewerke, keine Liste von Gesellschaften (TEN-08: ein fünfter
 * Bereich braucht eine Zeile, keinen Code).
 *
 *  - Bau gebucht: die laufenden Projekte — ein Bauvorhaben ist dort die
 *    Einheit der Arbeit. Fehlt dem Betrachter `bau.lesen`, bleiben die
 *    Aufträge, wenn er die sehen darf.
 *  - Ein anderes Gewerk oder eine nie gepflegte Buchung: die aktiven
 *    Aufträge.
 *  - Gar kein Gewerk (CSE Operations): kein Zähler. Dort ist ein Auftrag
 *    nicht die Arbeit, und eine Null wäre Schmuck, keine Auskunft.
 *
 * Fehlt der gewählte Zähler, weil das Leserecht fehlt, steht KEINER da — nie
 * eine erfundene Null (`mandant_kennzahlen` liefert dann keine Zeile).
 */
export function waehleZaehler(
  gewerke: readonly string[] | null,
  kennzahlen: ReadonlyMap<ZaehlerSchluessel, number>,
): Zaehler | null {
  if (gewerke !== null && gewerke.length === 0) return null;
  if (gewerke !== null && gewerke.includes('bau')) {
    const projekte = kennzahlen.get('projekte_laufend');
    if (projekte !== undefined) return { schluessel: 'projekte_laufend', wert: projekte };
  }
  const auftraege = kennzahlen.get('auftraege_aktiv');
  return auftraege === undefined ? null : { schluessel: 'auftraege_aktiv', wert: auftraege };
}

/**
 * Liest den Stand in der gebundenen Transaktion des Aufrufers.
 *
 *  - Das Tor und die Kontoseiten fragen Gruppe und Zähler nur für eine
 *    interne Leiste. Das Mitarbeiter- und das Kundenportal tragen keinen
 *    Umschalter, nur den Verweis auf die Bereichswahl, und der hängt allein
 *    an der Zahl der Bereiche (TEN-06).
 *  - Die Bereichswahl fragt die Gruppe immer (dort steht der Eintrag für
 *    jede Anmeldung, die ihn betreten darf) und die Zähler nur, wenn
 *    `zaehltFuer` ja sagt.
 */
export async function umschalterStand(
  k: Abfrage, fragen: StandFragen,
): Promise<UmschalterStand> {
  const zeilen = await k.abfrage<{
    id: string; slug: string; name: string; ist_standard: boolean; gewerke: string[] | null;
  }>(`select id, slug, name, ist_standard, gewerke from app.umschalter_bereiche()`);

  const ohneZaehler = (): readonly UmschalterEintrag[] => zeilen.map((z) => ({
    id: z.id, slug: z.slug, name: z.name, istStandard: z.ist_standard,
    gewerke: z.gewerke, zaehler: null,
  }));

  if (zeilen.length <= 1 || (!fragen.gruppe && !fragen.zaehler)) {
    return { bereiche: ohneZaehler(), gruppe: false };
  }

  const gruppe = fragen.gruppe
    ? (await k.abfrage<{ ok: boolean }>(`select app.darf_gruppenansicht() as ok`))[0]?.ok === true
    : false;
  if (!fragen.zaehler) return { bereiche: ohneZaehler(), gruppe };

  const kennzahlen = await k.abfrage<{
    mandant_id: string; schluessel: ZaehlerSchluessel; wert: number;
  }>(`select mandant_id, schluessel, wert from app.mandant_kennzahlen()`);

  const je = new Map<string, Map<ZaehlerSchluessel, number>>();
  for (const z of kennzahlen) {
    const karte = je.get(z.mandant_id) ?? new Map<ZaehlerSchluessel, number>();
    karte.set(z.schluessel, Number(z.wert));
    je.set(z.mandant_id, karte);
  }

  return {
    bereiche: zeilen.map((z) => ({
      id: z.id, slug: z.slug, name: z.name, istStandard: z.ist_standard,
      gewerke: z.gewerke,
      zaehler: waehleZaehler(z.gewerke, je.get(z.id) ?? new Map()),
    })),
    gruppe,
  };
}
