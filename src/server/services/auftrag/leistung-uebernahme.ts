import 'server-only';

/**
 * Die Übernahme der Leistungspositionen eines Angebots als Zeilen des
 * Auftrags (V-360, D-825) — aus `wandleInAuftrag`.
 *
 * Eine eigene Datei, weil `angebot/index.ts` sie ruft und
 * `auftrag/leistung.ts` die Eingabeprüfung aus `angebot/von-hand.ts` nimmt,
 * die ihrerseits `angebot/index.ts` lädt: in einer Datei wäre das ein Kreis.
 *
 * Jede Position des Typs `leistung` wird eine Zeile, in der Reihenfolge des
 * Angebots, ab dem Start des Auftrags, mit Menge, Einheit, Preis und Steuer
 * des Angebots und dem Verweis auf die Angebotsposition (OPS-09). Alternativ-
 * und Bedarfspositionen sind nicht beauftragt, Text und Zwischensumme keine
 * Leistung.
 */

/** Was eine Abfrage braucht — `wandleInAuftrag` hat keinen Kontext, nur `abfrage`. */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * Übernimmt die Leistungspositionen eines Angebots als Zeilen des Auftrags —
 * in der Reihenfolge des Angebots, ab `gueltigAb` (dem Start des Auftrags).
 * Gibt die Zahl der Zeilen zurück.
 */
export async function uebernehmeAngebotspositionen(
  db: Abfrage, angebotId: string, auftragId: string, gueltigAb: string,
): Promise<number> {
  const zeilen = await db.abfrage<{ id: string }>(
    `insert into auftrag_leistung
       (mandant_id, auftrag_id, position_nr, angebotsposition_id,
        leistungskatalog_position_id, objekt_id, bezeichnung, beschreibung,
        menge, einheit, einzelpreis_cent, steuersatz_bp, steuer_kennzeichen,
        steuerbefreiung_grund, erloeskonto_schluessel, gueltig_ab, erstellt_von)
     select ap.mandant_id, $2::uuid,
            row_number() over (order by ap.sortierung, ap.position_nr)::int,
            ap.id, ap.leistungskatalog_position_id, ap.objekt_id, ap.kurztext, ap.langtext,
            ap.menge, ap.einheit, ap.einzelpreis_cent, ap.steuersatz_bp, ap.steuer_kennzeichen,
            ap.steuerbefreiung_grund, ap.erloeskonto_schluessel, $3::date,
            app.aktueller_benutzer()
       from angebotsposition ap
      where ap.angebot_id = $1::uuid and ap.mandant_id = app.aktiver_mandant()
        and ap.typ = 'leistung'
     returning id`,
    [angebotId, auftragId, gueltigAb]);
  return zeilen.length;
}
