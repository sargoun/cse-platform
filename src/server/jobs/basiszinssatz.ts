/**
 * Der Waechter fuer den Basiszinssatz (FIN-15, `05-FINANZEN.md` §11).
 *
 * **Er meldet, bevor der Satz gebraucht wird.** § 247 BGB aendert den
 * Basiszinssatz zum 1. Januar und zum 1. Juli. Fehlt die neue Zeile, rechnet
 * `lauf.ts` keinen Verzugszins — richtig, aber still: die Mahnungen gehen
 * dann ein halbes Jahr lang ohne Zins hinaus, und niemandem faellt es auf,
 * weil nichts kaputt ist. Deshalb faellt dieser Lauf am 15. Juni und am
 * 15. Dezember aus, wenn die kommende Haelfte nicht gedeckt ist — zwei
 * Wochen Vorlauf fuer einen Wert, der aus einer Pressemitteilung abgeschrieben
 * wird.
 *
 * **Er holt den Satz NICHT selbst.** Es gibt keine Bundesbank-Anbindung, und
 * eine erfundene waere hier besonders teuer: ein falsch geparster Satz
 * erzeugte falsche Zinsforderungen an echte Kunden. Der Lauf sagt, dass etwas
 * fehlt; eintragen tut es ein Mensch.
 *
 * **Er scheitert, statt zu benachrichtigen.** Eine Benachrichtigung braucht
 * einen Empfaenger, und wer fuer eine PLATTFORMWEITE Referenzzahl zustaendig
 * ist, ist nicht entschieden. Ein fehlgeschlagener Lauf steht sichtbar im
 * Laufprotokoll und erfindet niemanden.
 *
 * // TODO(client, O-358): Wer pflegt den Basiszinssatz nach § 247 BGB — die
 * Buchhaltung je Gesellschaft oder die Gruppe zentral —, und soll der Waechter
 * zusaetzlich eine Person benachrichtigen statt nur den Lauf scheitern zu
 * lassen?
 */
import { registriere, type JobDefinition } from './registry.js';

export class BasiszinssatzFehlt extends Error {
  constructor(text: string) {
    super(text);
    this.name = 'BasiszinssatzFehlt';
  }
}

export interface Abfrage {
  unsafe(anweisung: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

/** Der erste Tag der Haelfte, die auf `heute` folgt — 1. Januar oder 1. Juli. */
export function naechsteHaelfte(heute: string): string {
  const [jahr, monat] = heute.split('-').map((t) => Number.parseInt(t, 10));
  if (jahr === undefined || monat === undefined || Number.isNaN(jahr) || Number.isNaN(monat)) {
    throw new BasiszinssatzFehlt(`Unlesbares Datum: ${heute}`);
  }
  return monat <= 6 ? `${String(jahr)}-07-01` : `${String(jahr + 1)}-01-01`;
}

export function registriereBasiszinssatzWaechter(db: Abfrage): JobDefinition {
  return registriere({
    schluessel: 'basiszinssatz_pruefen',
    bezeichnung: 'Deckt ein Basiszinssatz die kommende Jahreshälfte? (§ 247 BGB)',
    /* 15. Juni und 15. Dezember — zwei Wochen vor dem Wechsel. */
    zeitplan: '0 6 15 6,12 *',
    bereich: 'plattform',
    versuche: 0,
    ausfuehren: async (): Promise<Record<string, unknown>> => {
      const [heuteZeile] = await db.unsafe(
        `select app.berlin_heute()::text as tag`) as readonly { tag: string }[];
      if (heuteZeile === undefined) {
        throw new BasiszinssatzFehlt('Die Datenbank lieferte kein Berliner Datum.');
      }
      const ab = naechsteHaelfte(heuteZeile.tag);

      const [deckung] = await db.unsafe(
        `select satz_bp from basiszinssatz
          where gueltig_von <= $1::date and (gueltig_bis is null or gueltig_bis >= $1::date)`,
        [ab]) as readonly { satz_bp: number }[];

      if (deckung === undefined) {
        throw new BasiszinssatzFehlt(
          `Ab ${ab} deckt kein Basiszinssatz (§ 247 BGB) den Zeitraum. Bis er eingetragen `
          + 'ist, fordert jede Mahnung ab diesem Tag NULL Verzugszins — und sagt das auch. '
          + 'Der Wert kommt aus der Bekanntmachung der Deutschen Bundesbank.');
      }
      return { ab, satzBp: deckung.satz_bp };
    },
  });
}
