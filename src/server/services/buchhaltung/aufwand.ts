import 'server-only';
import { cent, type Cent } from '../finanz/geld.js';

/**
 * Der Aufwand aus Betriebsausgaben — je Gesellschaft und Monat (V-215,
 * FIN-17, ACC-08, D-706).
 *
 * **Der Befund.** Seit V-011 werden Betriebsausgaben (Tankquittung,
 * Material, Parkgebühr) erfasst, freigegeben und gebucht. Jede Auswertung
 * zu Aufwand und Ergebnis las aber nur `eingangsrechnung`: Monatszahlen,
 * Saldo je Gesellschaft und Gruppe, eingefrorene Periodenzahlen und das
 * Jahrespaket wiesen ein Ergebnis aus, das um jede gebuchte Ausgabe zu hoch
 * war.
 *
 * **Eine Quelle für alle Auswertungen: `app.ausgaben_aufwand` (0446).**
 * Dieselbe Lesart wie bei den Eingangsrechnungen (D-484) — freigegeben oder
 * gebucht, nach Belegdatum, netto; eine Ausgabe aus einer Lieferantenrechnung
 * zählt dort und nicht hier. Eine Definer-Funktion und keine Abfrage, weil die
 * Gruppendecke der Tabelle die Erstattungen als ZEILEN ausblendet: eine
 * Gruppensumme darüber wäre kleiner als die Summe der Gesellschaften
 * (D-475). Die Funktion gibt nur Summen heraus, keine Person.
 *
 * Hier wird nur umgeformt — die Summe bildet die Datenbank, als `bigint`
 * (Invariante 1).
 */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface AusgabenAufwand {
  readonly mandantId: string;
  /** `YYYY-MM` */
  readonly monat: string;
  readonly nettoCent: Cent;
  readonly anzahl: number;
}

interface Roh {
  readonly mandant_id: string;
  readonly monat: string;
  readonly netto_cent: string;
  readonly anzahl: number;
}

/**
 * Die Summen im Zeitraum `von` … `bis` (Kalendertage, beide eingeschlossen) —
 * im Bereich für den aktiven Mandanten, in der Gruppe für jede Gesellschaft
 * mit `gruppe.eingang.lesen`.
 */
export async function ausgabenAufwand(
  db: Abfrage, von: string, bis: string,
): Promise<readonly AusgabenAufwand[]> {
  const zeilen = await db.abfrage<Roh>(
    `select mandant_id, monat, netto_cent::text as netto_cent, anzahl
       from app.ausgaben_aufwand($1::date, $2::date)`,
    [von, bis]);
  return zeilen.map((z) => ({
    mandantId: z.mandant_id, monat: z.monat,
    nettoCent: cent(BigInt(z.netto_cent)), anzahl: Number(z.anzahl),
  }));
}

/** Je Gesellschaft über alle Monate — für die Jahressummen der Gruppe. */
export function jeGesellschaft(
  zeilen: readonly AusgabenAufwand[],
): ReadonlyMap<string, { readonly nettoCent: Cent; readonly anzahl: number }> {
  const karte = new Map<string, { nettoCent: Cent; anzahl: number }>();
  for (const z of zeilen) {
    const bisher = karte.get(z.mandantId);
    karte.set(z.mandantId, {
      nettoCent: cent((bisher?.nettoCent ?? 0n) + z.nettoCent),
      anzahl: (bisher?.anzahl ?? 0) + z.anzahl,
    });
  }
  return karte;
}
