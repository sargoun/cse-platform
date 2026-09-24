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
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { vergebeNummer, type Abfrage as Nummernquelle } from '../finanz/nummernkreis.js';
import { pruefeLeadBindung, type LeadBindungGrund } from '../crm/lead-kette.js';

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
  readonly wochenstundenSoll: number | null;
  readonly ausstattungHinweis: string | null;
  /** Die Anfrage, aus der der Auftrag direkt entsteht (V-138) — oder keine. */
  readonly leadId: string | null;
}

export type DirektErgebnis =
  | { readonly art: 'angelegt'; readonly id: string; readonly auftragsnummer: string }
  | { readonly art: 'lead'; readonly grund: LeadBindungGrund }
  /** Die Datenbank hat keine Zeile zurückgegeben — die Maske sagt es, statt JSON. */
  | { readonly art: 'nicht_angelegt' };

/**
 * Anlegen. Die Anfrage wird VOR der Nummer geprüft: eine abgewiesene Anfrage
 * verbraucht keine Auftragsnummer. Der Auslöser `kern.lead_bezug_stimmt`
 * (0400, 0402) stellt dieselbe Frage noch einmal, unter Sperre.
 *
 * `quelle` zieht die Nummer (`vergebeNummer` braucht den Treiberausschnitt,
 * nicht den Kontext); `kontext` schreibt den Auftrag.
 */
export async function legeAuftragDirektAn(
  kontext: SchreibKontext, quelle: Nummernquelle, eingabe: DirekterAuftrag,
): Promise<DirektErgebnis> {
  if (eingabe.leadId !== null) {
    const bindung = await pruefeLeadBindung(kontext, eingabe.leadId, eingabe.kundeId);
    if (!bindung.ok) return { art: 'lead', grund: bindung.grund };
  }

  const nummer = await vergebeNummer(quelle, { kreisTyp: 'auftrag' });

  const [neu] = await kontext.schreibe<{ id: string }>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art,
                          bezeichnung, beschreibung, verantwortlich_benutzer_id,
                          start_datum, laufzeit_bis, personalbedarf_anzahl,
                          wochenstunden_soll, ausstattung_hinweis, lead_id)
     values (app.aktiver_mandant(), $1, $2, $3, $4::auftrag_art, $5, $6, $7,
             $8::date, $9::date, $10, $11::numeric, $12, $13::uuid)
     returning id::text as id`,
    [nummer.formatiert, eingabe.kundeId, eingabe.objektId, eingabe.art, eingabe.bezeichnung,
      eingabe.beschreibung, eingabe.verantwortlichBenutzerId, eingabe.startDatum,
      eingabe.laufzeitBis, eingabe.personalbedarfAnzahl,
      eingabe.wochenstundenSoll === null ? null : eingabe.wochenstundenSoll.toFixed(3),
      eingabe.ausstattungHinweis, eingabe.leadId],
  );
  if (neu === undefined) return { art: 'nicht_angelegt' };
  return { art: 'angelegt', id: neu.id, auftragsnummer: nummer.formatiert };
}
