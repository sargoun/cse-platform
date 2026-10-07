import 'server-only';
import type { RegelName, RegelTreffer } from './bewertung.js';

/**
 * Was der Vergaberadar für eine Gesellschaft **gefunden** hat — die erste
 * Stufe von REP-06 — und warum das hier ein **PLATZHALTER** ist (O-941).
 *
 * **Der Befund.** Die Pipeline zählte als „gefunden" jede nicht
 * ausgeschlossene Bewertung (D-720). Der Radar bewertet aber JEDE eingelesene
 * Bekanntmachung gegen JEDES aktive Profil (`lauf.ts`), und ausgeschlossen
 * wird nur, was ein Mensch im Profil ausdrücklich ausschliesst (`bewerte`:
 * „Der Code selbst wirft nichts weg"). „Gefunden" war damit je Gesellschaft
 * das ganze Einlesevolumen — im Seed auch die Streusalzlieferung, die laut
 * Seed „kein Profil trifft", und für die Reinigung der Objektschutz.
 *
 * **Was der Code über „Treffer" sagt, ist nicht eindeutig.** Die
 * Trefferbenachrichtigung (RAD-08) meldet ab einer Punktschwelle, und die ist
 * offen (O-15, im Seed nicht gesetzt). Die Profilseite schreibt, ein Profil
 * ohne CPV-Zeile „trifft nur über Stichwörter und Region"; der Seed nennt die
 * Streusalzlieferung eine, „die kein Profil trifft" — obwohl ihre Region
 * (DE300) jedes Seed-Profil trifft. Welche Lesart gilt, ist eine fachliche
 * Frage der Gesellschaften und wird hier nicht erfunden.
 *
 * **Der Platzhalter:** ein Fund ist eine nicht ausgeschlossene Bewertung, in
 * der eine Regel zur LEISTUNG positiv trifft — ein CPV-Code des Profils mit
 * Wirkung `positiv` („was wird beschafft?", `bewerte` Regel 1) oder ein
 * Positiv-Stichwort („was der CPV-Code nicht trennt", Regel 3). Region, Wert,
 * Frist und Schwellenwert bewerten einen Fund, sie begründen keinen: eine
 * Lieferung in Berlin ist für eine Reinigungsfirma kein Fund, nur weil sie in
 * Berlin liegt. Das ist die Lesart des Seeds; ob die Gesellschaften sie
 * teilen, fragt O-941.
 *
 * TODO(client, O-941): Was zählt in der Vergabepipeline (REP-06) als
 * „gefunden" — eine Bekanntmachung, deren Leistung (CPV oder Stichwort) das
 * Profil trifft, eine ab der Benachrichtigungsschwelle (RAD-08, O-15), jede
 * bewertete, oder erst eine, zu der ein Mensch einen Vorgang eröffnet hat?
 *
 * **Austauschbar an einer Stelle.** Die Antwort ändert `FUND_PLATZHALTER` (oder
 * ersetzt diese Datei), nicht die Zählung: `pipelineZahlen` fragt die
 * Bedingung `fundSql` mit den Regeln dieser Definition, `istFund` sagt
 * dasselbe ohne Datenbank, und `tests/kern/radar-fund.test.ts` hält beide
 * gegen die echte Bewertung des Seeds.
 */

export interface FundDefinition {
  /** Der Name der Lesart — für Fussnoten und Prüfungen. */
  readonly name: string;
  /**
   * Die Regeln der Aufschlüsselung, deren POSITIVER Treffer eine Bewertung
   * zum Fund macht. Eine ausgeschlossene Bewertung ist nie einer.
   */
  readonly regeln: readonly RegelName[];
}

/** Die Lesart, bis O-941 beantwortet ist — beschriftet als Platzhalter. */
export const FUND_PLATZHALTER: FundDefinition = {
  name: 'leistungstreffer (Voreinstellung, O-941)',
  regeln: ['cpv', 'stichwort'],
};

/** Eine Bewertung, soweit die Fundregel sie braucht. */
export interface FundBewertung {
  readonly ausgeschlossen: boolean;
  readonly aufschluesselung: readonly Pick<RegelTreffer, 'regel' | 'treffer'>[];
}

/** Ist diese Bewertung ein Fund? Dieselbe Regel wie `fundSql`, ohne Datenbank. */
export function istFund(b: FundBewertung, definition: FundDefinition = FUND_PLATZHALTER): boolean {
  return !b.ausgeschlossen
    && b.aufschluesselung.some((z) => z.treffer && definition.regeln.includes(z.regel));
}

/**
 * Dieselbe Regel als SQL-Bedingung über einer Zeile von `bewertung`.
 *
 * `alias` ist der Tabellenname in der Abfrage, `regelnParameter` der Platz
 * des Parameters, der `definition.regeln` als `text[]` trägt (`$4`). Die
 * Aufschlüsselung steht so in der Zeile, wie `bewerte` sie liefert
 * (`regel`, `treffer`, …); eine Zeile, deren Aufschlüsselung kein Feld ist,
 * ist kein Fund — `case` hält `jsonb_array_elements` von ihr fern.
 */
export function fundSql(alias: string, regelnParameter: string): string {
  return `(not ${alias}.ausgeschlossen
           and case when jsonb_typeof(${alias}.aufschluesselung) = 'array'
                    then exists (select 1
                                   from jsonb_array_elements(${alias}.aufschluesselung) r
                                  where r ->> 'regel' = any (${regelnParameter}::text[])
                                    and r ->> 'treffer' = 'true')
                    else false end)`;
}
