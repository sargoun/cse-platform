import type { SchreibKontext } from '../../kontext/index.js';
import { formatiereNummer } from './nummernkreis.js';

/**
 * Der Jahreswechsel eines Nummernkreises — den Nachfolgekreis eröffnen
 * (FIN-03, LEG-01, TEN-02, V-284, O-352, D-779, D-848).
 *
 * **Warum es ihn braucht.** Ein jährlich zurückgesetzter Kreis (Maske mit
 * `{jahr}`) trägt sein Jahr. Am 1. Januar weist die Festschreibung jede
 * Rechnung ab — „es fehlt der Nachfolgekreis" (0077) —, und bis V-284 konnte
 * ihn nur eine Migration eröffnen.
 *
 * // TODO(client, O-352): Voreinstellung — den Jahreswechsel führt die Administration aus (`nummernkreis.verwalten`), mit bestätigter Maske, sobald das Jahr des Kreises vergangen ist; die Geschäftsführung kann sich das Recht zuweisen lassen. D-779, D-848.
 *
 * **Der Vorgang selbst steht in der Datenbank** (0532,
 * `fin.nummernkreis_nachfolger_eroeffnen`): Vorgänger schliessen, Nachfolger
 * mit `genesis_hash` = `letzter_hash` des Vorgängers eröffnen, in EINER
 * Transaktion — damit die Kette über die Jahresgrenze eine Linie bleibt
 * (§5.4). Dieser Dienst prüft vorher, was er mit einem Grund beantworten
 * kann, und schreibt das Protokoll; die Funktion prüft dasselbe noch einmal.
 */

const AUDIT_JAHRESWECHSEL = 'nummernkreis.nachfolger_eroeffnet';

export type WechselGrund =
  | 'nicht_gefunden' | 'geschlossen' | 'platzhalter' | 'fortlaufend' | 'laeuft_noch'
  | 'maske_unbestaetigt' | 'schon_vorhanden' | 'kein_recht';

export class WechselFehler extends Error {
  constructor(readonly grund: WechselGrund, nachricht: string) {
    super(nachricht);
    this.name = 'WechselFehler';
  }
}

/** Wo ein Kreis im Jahreswechsel steht. */
export type WechselLage = 'faellig' | 'laeuft' | 'fortlaufend' | 'geschlossen' | 'platzhalter';

/**
 * Rein: `faellig`, sobald ein offener, freigegebener, jährlich
 * zurückgesetzter Kreis ein vergangenes Jahr trägt; `laeuft` in seinem Jahr;
 * `fortlaufend` ohne Rücksetzung; `geschlossen`, wenn er schon einen
 * Nachfolger hat oder hatte; `platzhalter`, solange seine Maske nicht
 * freigegeben ist — er hat nichts vergeben, und die Freigabe setzt ihn ins
 * laufende Jahr (`nummernkreis-freigabe.ts`).
 */
export function wechselLage(
  k: { readonly zuruecksetzung: string | null; readonly jahr: number;
       readonly geschlossen: boolean; readonly platzhalter: boolean },
  heuteJahr: number,
): WechselLage {
  if (k.geschlossen) return 'geschlossen';
  if (k.platzhalter) return 'platzhalter';
  if (k.zuruecksetzung !== 'jaehrlich') return 'fortlaufend';
  return k.jahr < heuteJahr ? 'faellig' : 'laeuft';
}

/** Die erste Nummer des neuen Jahres — wie sie auf der Maske stünde. */
export function ersteNummer(maske: string, jahr: number): string {
  return formatiereNummer(maske, 1, jahr);
}

const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface Kopf {
  id: string; jahr: number; zuruecksetzung: string | null; geschlossen: boolean;
  platzhalter: boolean; bezeichnung: string; kreis_typ: string; kontext_id: string | null;
  genesis: string | null; heute_jahr: number; darf: boolean;
}

/** Eröffnet den Nachfolgekreis — gibt seine Kennung und sein Jahr zurück. */
export async function eroeffneNachfolgekreis(
  kontext: SchreibKontext, vorgaengerId: string, maskeBestaetigt: boolean,
): Promise<{ readonly id: string; readonly jahr: number }> {
  if (!KENNUNG.test(vorgaengerId)) {
    throw new WechselFehler('nicht_gefunden', 'Diesen Nummernkreis gibt es hier nicht.');
  }
  const [k] = await kontext.abfrage<Kopf>(
    `select n.id::text as id, n.jahr, n.zuruecksetzung::text as zuruecksetzung,
            (n.geschlossen_am is not null) as geschlossen,
            n.ist_platzhalter as platzhalter, n.bezeichnung,
            n.kreis_typ::text as kreis_typ, n.kontext_id::text as kontext_id,
            coalesce(n.letzter_hash, n.genesis_hash) as genesis,
            extract(year from app.berlin_heute())::int as heute_jahr,
            app.hat_recht('nummernkreis.verwalten', app.aktiver_mandant()) as darf
       from nummernkreis n
      where n.id = $1::uuid and n.mandant_id = app.aktiver_mandant()`, [vorgaengerId]);
  if (k === undefined) {
    throw new WechselFehler('nicht_gefunden', 'Diesen Nummernkreis gibt es hier nicht.');
  }
  if (!k.darf) {
    throw new WechselFehler('kein_recht',
      'Den Nachfolgekreis eröffnet, wer nummernkreis.verwalten hält.');
  }
  const lage = wechselLage(k, k.heute_jahr);
  if (lage === 'geschlossen') {
    throw new WechselFehler('geschlossen', 'Dieser Kreis ist schon geschlossen.');
  }
  if (lage === 'platzhalter') {
    throw new WechselFehler('platzhalter',
      'Ein Platzhalterkreis wird freigegeben, nicht fortgesetzt.');
  }
  if (lage === 'fortlaufend') {
    throw new WechselFehler('fortlaufend', 'Ein fortlaufender Kreis hat keinen Jahreswechsel.');
  }
  if (lage === 'laeuft') {
    throw new WechselFehler('laeuft_noch', `Das Jahr ${String(k.jahr)} läuft noch.`);
  }
  if (!maskeBestaetigt) {
    throw new WechselFehler('maske_unbestaetigt',
      'Bitte bestätigen Sie die Maske — sie gilt danach für jede Nummer des Jahres.');
  }
  const [schon] = await kontext.abfrage<{ id: string }>(
    `select id::text as id from nummernkreis
      where mandant_id = app.aktiver_mandant() and kreis_typ = $1::nummernkreis_typ
        and kontext_id is not distinct from $2::uuid and jahr = $3`,
    [k.kreis_typ, k.kontext_id, k.heute_jahr]);
  if (schon !== undefined) {
    throw new WechselFehler('schon_vorhanden',
      `Für ${String(k.heute_jahr)} gibt es schon einen Kreis dieses Geltungsbereichs.`);
  }

  const [neu] = await kontext.schreibe<{ id: string }>(
    `select fin.nummernkreis_nachfolger_eroeffnen($1::uuid, $2)::text as id`,
    [vorgaengerId, maskeBestaetigt]);
  if (neu === undefined) {
    throw new WechselFehler('nicht_gefunden', 'Der Nachfolgekreis wurde nicht eröffnet.');
  }
  await kontext.schreibe(
    `select app.protokolliere($1, 'nummernkreis', $2, null, $3::jsonb, app.aktiver_mandant())`,
    // Das OBJEKT, nicht sein JSON-Text (D-467).
    [AUDIT_JAHRESWECHSEL, neu.id, {
      vorgaenger: vorgaengerId, vorgaenger_jahr: k.jahr, jahr: k.heute_jahr,
      genesis_hash: k.genesis,
    }]);
  return { id: neu.id, jahr: k.heute_jahr };
}

/** Das Jahr des heutigen Berliner Tages — aus der Datenbank (Invariante 5). */
export async function heutigesJahr(
  kontext: { abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]> },
): Promise<number> {
  const [z] = await kontext.abfrage<{ jahr: number }>(
    `select extract(year from app.berlin_heute())::int as jahr`);
  return z?.jahr ?? 0;
}
