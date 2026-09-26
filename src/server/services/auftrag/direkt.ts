/**
 * **Ein Auftrag ohne Angebot — der Weg des Auftragsassistenten** (OPS-10,
 * V-138, V-143, CRM-05, REP-03, D-637).
 *
 * Bis V-143 stand dieser Weg ganz in `POST /api/auftrag`: Anfrage prüfen,
 * Nummer ziehen, einfügen. Eine Route lässt sich in dieser Anwendung nicht
 * gegen eine echte Datenbank prüfen — also war ungeprüft, worauf es ankommt:
 * dass eine abgewiesene Anfrage KEINE Auftragsnummer verbraucht, und dass
 * der Auftrag die Anfrage trägt. Die Route bleibt dünn (CLAUDE.md): sie liest
 * das Formular, prüft Pflichtfelder und Bereiche, ruft diesen Dienst und
 * leitet um.
 *
 * **Nichts wird geraten.** Personalbedarf und Wochenstunden kommen, wie sie
 * eingegeben wurden, oder bleiben leer (OPS-10).
 *
 * **Vor der Nummer wird auch der Bezug geprüft** (V-172, D-666): Datum,
 * Laufzeit, Kunde, Objekt und Leitung über `pruefeAuftragsbezug` — sonst kämen
 * sie als 22007/23503/23514 aus der Tiefe, nachdem die Nummer schon gezogen
 * ist. **Der Wert** (V-173, D-667) kommt als ganze Cent aus `parseGeld`
 * (`pruefeAuftragsangaben`), nie als Gleitkommazahl (Invariante 1).
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { vergebeNummer, type Abfrage as Nummernquelle } from '../finanz/nummernkreis.js';
import { pruefeLeadBindung, type LeadBindungGrund } from '../crm/lead-kette.js';
import { pruefeAuftragsbezug, type BezugGrund } from './angaben.js';
import type { Cent } from '../finanz/geld.js';

export type DirektAuftragsart = 'einzelauftrag' | 'rahmenvertrag' | 'dauerauftrag' | 'projekt';

export interface DirekterAuftrag {
  readonly kundeId: string;
  readonly objektId: string | null;
  readonly art: DirektAuftragsart;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly verantwortlichBenutzerId: string;
  readonly startDatum: string;
  readonly laufzeitBis: string | null;
  readonly personalbedarfAnzahl: number | null;
  /**
   * Wochenstunden — als `numeric(12,3)`-Text, wie `pruefeAuftragsangaben` ihn
   * aus einer deutschen Eingabe bildet (V-172), oder als Zahl.
   */
  readonly wochenstundenSoll: number | string | null;
  readonly ausstattungHinweis: string | null;
  /** Die Anfrage, aus der der Auftrag direkt entsteht (V-138) — oder keine. */
  readonly leadId: string | null;
  /** Auftragswert netto in ganzen Cent (V-173, Invariante 1) — oder keiner. */
  readonly auftragswertNettoCent?: Cent | null;
}

export type DirektErgebnis =
  | { readonly art: 'angelegt'; readonly id: string; readonly auftragsnummer: string }
  | { readonly art: 'lead'; readonly grund: LeadBindungGrund }
  /** Datum, Laufzeit, Kunde, Objekt oder Leitung passen nicht (V-172). */
  | { readonly art: 'bezug'; readonly grund: BezugGrund }
  /** Die Datenbank hat keine Zeile zurückgegeben — die Maske sagt es, statt JSON. */
  | { readonly art: 'nicht_angelegt' };

/**
 * Anlegen. Bezug und Anfrage werden VOR der Nummer geprüft: eine Abweisung
 * verbraucht keine Auftragsnummer. Der Auslöser `kern.lead_bezug_stimmt`
 * (0400, 0402) stellt die Frage nach der Anfrage noch einmal, unter Sperre.
 *
 * `quelle` zieht die Nummer (`vergebeNummer` braucht den Treiberausschnitt,
 * nicht den Kontext); `kontext` schreibt den Auftrag.
 */
export async function legeAuftragDirektAn(
  kontext: SchreibKontext, quelle: Nummernquelle, eingabe: DirekterAuftrag,
): Promise<DirektErgebnis> {
  const bezug = await pruefeAuftragsbezug(kontext, {
    kundeId: eingabe.kundeId, objektId: eingabe.objektId,
    verantwortlichBenutzerId: eingabe.verantwortlichBenutzerId,
    startDatum: eingabe.startDatum, laufzeitBis: eingabe.laufzeitBis,
  });
  if (bezug !== null) return { art: 'bezug', grund: bezug };

  if (eingabe.leadId !== null) {
    const bindung = await pruefeLeadBindung(kontext, eingabe.leadId, eingabe.kundeId);
    if (!bindung.ok) return { art: 'lead', grund: bindung.grund };
  }

  const nummer = await vergebeNummer(quelle, { kreisTyp: 'auftrag' });

  const [neu] = await kontext.schreibe<{ id: string }>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art,
                          bezeichnung, beschreibung, verantwortlich_benutzer_id,
                          start_datum, laufzeit_bis, personalbedarf_anzahl,
                          wochenstunden_soll, ausstattung_hinweis, lead_id,
                          auftragswert_netto_cent)
     values (app.aktiver_mandant(), $1, $2, $3, $4::auftrag_art, $5, $6, $7,
             $8::date, $9::date, $10, $11::numeric, $12, $13::uuid, $14::bigint)
     returning id::text as id`,
    [nummer.formatiert, eingabe.kundeId, eingabe.objektId, eingabe.art, eingabe.bezeichnung,
      eingabe.beschreibung, eingabe.verantwortlichBenutzerId, eingabe.startDatum,
      eingabe.laufzeitBis, eingabe.personalbedarfAnzahl,
      stundenText(eingabe.wochenstundenSoll),
      eingabe.ausstattungHinweis, eingabe.leadId,
      eingabe.auftragswertNettoCent === undefined || eingabe.auftragswertNettoCent === null
        ? null : String(eingabe.auftragswertNettoCent)],
  );
  if (neu === undefined) return { art: 'nicht_angelegt' };
  return { art: 'angelegt', id: neu.id, auftragsnummer: nummer.formatiert };
}

/** Wochenstunden als `numeric`-Text — ein geprüfter Text bleibt, wie er ist. */
function stundenText(wert: number | string | null): string | null {
  if (wert === null) return null;
  return typeof wert === 'string' ? wert : wert.toFixed(3);
}
