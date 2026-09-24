/**
 * **Ein Angebot aus dem Raumbuch** (OPS-02, OPS-03, CLN-01, V-138, V-143,
 * D-637).
 *
 * Bis V-143 stand dieser Weg ganz in `POST /api/angebot` (`aktion=aus_raumbuch`):
 * Grundlage laden, kalkulieren, Angebot anlegen, Zeilen übernehmen. Eine Route
 * lässt sich hier nicht gegen eine echte Datenbank prüfen — also war
 * ungeprüft, ob das Angebot die Anfrage trägt (`?lead=` vom Leadblatt) und ob
 * eine Anfrage eines ANDEREN Kunden kein halbes Angebot hinterlässt. Die
 * Route bleibt dünn: Recht prüfen, diesen Dienst rufen, antworten.
 *
 * **Gerechnet wird in `kalkulation/`** (Invariante 6): dieser Dienst reicht
 * nur weiter. Tarif und Frequenz sind die bestätigungspflichtigen Platzhalter
 * aus `kalkulation/tarif.ts` — `uebernimmKalkulation` hält das fest, und die
 * Freigabe verlangt die Bestätigung (D-97).
 */
import { ladeKalkulationsgrundlage } from '../kalkulation/raumbuch.js';
import { kalkuliere } from '../kalkulation/index.js';
import {
  PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF, PLATZHALTER_TURNUSSE,
} from '../kalkulation/tarif.js';
import { legeAngebotAn, uebernimmKalkulation, type Abfrage } from './index.js';

export interface RaumbuchAngebot {
  readonly objektId?: string | undefined;
  readonly kundeId?: string | undefined;
  readonly titel?: string | undefined;
  readonly turnus?: string | undefined;
  /** Die Anfrage, auf die das Angebot antwortet (V-138) — `legeAngebotAn` prüft sie. */
  readonly leadId?: string | undefined;
}

export type RaumbuchErgebnis =
  /** Objekt, Kunde oder Titel fehlt, oder der Turnus ist unbekannt. */
  | { readonly art: 'ungueltig' }
  /** Das Raumbuch trägt keine kalkulierbare Fläche — kein leeres Angebot. */
  | { readonly art: 'leer' }
  | { readonly art: 'angelegt'; readonly angebotId: string };

/**
 * `stichtag` kommt vom Aufrufer (R-11): der Dienst liest keine Uhr, damit er
 * sich an einem festen Tag prüfen lässt — die Leistungswerte gelten ab einem
 * Datum.
 */
export async function legeAngebotAusRaumbuchAn(
  db: Abfrage, mandantId: string, eingabe: RaumbuchAngebot, stichtag: Date,
): Promise<RaumbuchErgebnis> {
  const { objektId, kundeId, titel } = eingabe;
  if (objektId === undefined || kundeId === undefined || titel === undefined) {
    return { art: 'ungueltig' };
  }
  const turnus = eingabe.turnus ?? '1_pro_monat';
  if (!PLATZHALTER_TURNUSSE.includes(turnus)) return { art: 'ungueltig' };

  const grundlage = await ladeKalkulationsgrundlage(db, objektId, stichtag);
  const frequenz = PLATZHALTER_FREQUENZ.frequenz(turnus);
  const tarif = PLATZHALTER_TARIF.tarif(mandantId, 'reinigung');
  const kalk = kalkuliere({
    posten: grundlage.posten,
    frequenz,
    tarif,
    flaecheOhneBelagsart: grundlage.flaecheOhneBelagsart,
    // Beide Luecken gehen MIT — `uebernimmKalkulation` weist ein Angebot
    // ueber nicht bepreisbare Flaeche ab (D-97).
    ohneGueltigenLeistungswert: grundlage.ohneGueltigenLeistungswert,
  });
  if (kalk.zeilen.length === 0) return { art: 'leer' };

  const angebotId = await legeAngebotAn(db, {
    kundeId, titel, objektId,
    ...(eingabe.leadId === undefined ? {} : { leadId: eingabe.leadId }),
  });
  await uebernimmKalkulation(db, angebotId, kalk,
    { objektId, turnusLabel: turnus, tarif, frequenz });
  return { art: 'angelegt', angebotId };
}
