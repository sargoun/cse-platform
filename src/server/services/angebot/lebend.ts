import 'server-only';

/**
 * **Was auf einem Angebot steht — nur die lebenden Positionen** (V-203).
 *
 * Seit 0392 (V-130, D-626) wird eine Position aus einem Entwurf nicht
 * gelöscht, sondern mit `entfernt_am` markiert (Invariante 8). Die beiden
 * Summen der Datenbank — `angebot.netto_cent` und die beim Versand
 * eingefrorenen `angebot_steuer` — zählen seitdem nur lebende Zeilen. Drei
 * Leser hatten den Filter nicht bekommen: das Angebotsdokument druckte die
 * entfernte Zeile mit Preis, das Kundenportal zeigte sie dem Kunden und
 * zählte sie mit, und die Preisfreigabe summierte sie in das Netto je
 * Steuersatz — direkt neben einem Kopfbetrag ohne sie. Freigegeben wurde
 * also eine Zahl, die so nie hinausging.
 *
 * Der Filter steht deshalb HIER, einmal, und die Seiten fragen diese
 * Funktionen, statt ihn je selbst zu schreiben. Eine vierte Stelle, die ihn
 * vergisst, fällt in `tests/kern/angebot-lebend.test.ts` auf.
 */

/** Nur der Teil eines Kontexts, den ein Leser braucht. */
export interface AngebotLeser {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * Die Anzahl lebender LEISTUNGSpositionen eines Angebots — als Unterabfrage.
 *
 * Ein SQL-Stück und keine Funktion, weil es in Kopfabfragen mit `for update`
 * und in der Spaltenliste des Kundenportals steht; eine zweite Abfrage wäre
 * dort ein zweiter Lesezeitpunkt.
 *
 * @param angebot Alias der Tabelle `angebot` in der äusseren Abfrage.
 */
export function lebendeLeistungenZahl(angebot: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(angebot)) {
    throw new Error(`Kein Tabellenalias: ${angebot}`);
  }
  return `(select count(*) from angebotsposition lp
             where lp.angebot_id = ${angebot}.id and lp.typ = 'leistung'
               and lp.entfernt_am is null)`;
}

/** Eine Zeile des Angebotsdokuments (`/angebote/[id]/pdf`). */
export interface DokumentPosition {
  readonly id: string;
  readonly position_nr: number;
  readonly typ: string;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelpreis_cent: string | null;
  readonly gesamtpreis_cent: string;
}

/** Die Positionen, die auf das Blatt gehören — in ihrer Reihenfolge. */
export async function positionenFuerDokument(
  leser: AngebotLeser, angebotId: string,
): Promise<readonly DokumentPosition[]> {
  return leser.abfrage<DokumentPosition>(
    `select id, position_nr, typ::text as typ, kurztext, langtext, menge::text,
            einheit, einzelpreis_cent::text, gesamtpreis_cent::text
       from angebotsposition
      where angebot_id = $1 and entfernt_am is null
      order by position_nr`, [angebotId]);
}

/** Eine Steuersatzgruppe vor dem Versand — gruppiert, nicht summiert. */
export interface SteuerVorschau {
  readonly steuersatz_bp: number;
  readonly steuer_kennzeichen: string;
  readonly netto_cent: string;
  readonly zeilen: string;
}

/**
 * Das Netto je Steuersatz, wie es beim Versand eingefroren WIRD.
 *
 * Dieselbe Gruppierung und derselbe Filter wie
 * `kern.angebot_versand_festschreiben` (0392) — die Preisfreigabe zeigt, was
 * danach in `angebot_steuer` steht, und nicht eine Zahl daneben.
 */
export async function steuerJeSatzVorVersand(
  leser: AngebotLeser, angebotId: string,
): Promise<readonly SteuerVorschau[]> {
  return leser.abfrage<SteuerVorschau>(
    `select steuersatz_bp, steuer_kennzeichen::text as steuer_kennzeichen,
            sum(gesamtpreis_cent)::text as netto_cent,
            count(*)::text as zeilen
       from angebotsposition
      where angebot_id = $1 and typ = 'leistung' and entfernt_am is null
      group by steuersatz_bp, steuer_kennzeichen
      order by steuersatz_bp`, [angebotId]);
}
