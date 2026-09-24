/**
 * Material und Gerät in der Kalkulation — erfasst von einem Menschen, nie
 * vorbelegt (V-174, OPS-07).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OPS-07 verlangt die Kostenblöcke „labour + material + equipment + overhead
 * + risk/profit". Das Schema trug sie seit 0023 (`kostenart` 'material'/
 * 'geraet', `kalkulation.summe_material_cent`/`summe_geraet_cent`), aber kein
 * Weg legte eine solche Zeile an, und `kalkuliere` kannte nur Lohn. Ein
 * Reinigungsangebot enthielt damit nie Reinigungsmittel, Maschinen oder
 * Verbrauchsmaterial und war systematisch zu niedrig, ohne dass es auffiel.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier gilt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - **Die Höhe wird nie vorbelegt.** Material und Gerät sind die Summe der
 *    Positionen, die ein Mensch erfasst: Menge × Einzelpreis, über
 *    `multipliziereMitMenge` (halb aufwärts, eine Rundungsstelle, getestet).
 *  - **Nichts wird gelöscht** (Invariante 8, `trg_kalkulation_position_kein_
 *    hard_delete`). Korrigiert wird die Zeile selbst; wer eine Position nicht
 *    mehr will, setzt die Menge auf null — sie bleibt als Beleg stehen, wie
 *    der Preis entstand, und jede Änderung steht im Protokoll.
 *  - **Nach jeder Änderung wird der Preis neu gerechnet** — mit denselben
 *    Tarifzahlen, die der Kopf trägt, und über dieselbe Funktion wie beim
 *    ersten Mal (`rechneKalkulationNeu` → `kalkuliere`). Ein Preis, der die
 *    Kostenzeilen nicht enthält, wäre die Lücke, die hier geschlossen wird.
 *  - **Gesperrt ist, was nicht mehr geändert werden darf:** eine
 *    festgeschriebene Kalkulation (Versand) und ein freigegebener Preis —
 *    „ein anderer Preis braucht eine neue Angebotsversion" (O-732).
 */
import { multipliziereMitMenge, parseGeld, formatiereGeld, type Cent } from '../finanz/geld.js';
import {
  formatiereMenge, mengeAusEingabe, mengeNachPostgres, type MilliMenge,
} from '../finanz/menge.js';
import type { GemeinkostenBasis } from './index.js';
import {
  KalkulationFehler, rechneKalkulationNeu, type Abfrage,
} from './bestaetigung.js';

export type Kostenart = 'material' | 'geraet';
export const KOSTENARTEN: readonly Kostenart[] = ['material', 'geraet'];

/** Eine Anzeigegrenze, keine Fachregel: eine Einheit ist ein Kürzel. */
export const EINHEIT_LAENGE = 20;
export const BEZEICHNUNG_LAENGE = 200;

export interface KostenpositionEingabe {
  readonly kostenart: string;
  readonly bezeichnung: string;
  /** Deutsch geschrieben, bis drei Nachkommastellen, z. B. „12,5". */
  readonly menge: string;
  readonly einheit: string;
  /** Deutscher Eurobetrag je Einheit, z. B. „3,20". */
  readonly einzelpreisEuro: string;
}

export interface GepruefteKostenposition {
  readonly kostenart: Kostenart;
  readonly bezeichnung: string;
  readonly menge: MilliMenge;
  readonly einheit: string;
  readonly einzelpreis: Cent;
  readonly betrag: Cent;
}

/**
 * Prüft die Felder und rechnet den Betrag — rein, ohne Datenbank.
 *
 * Menge und Preis dürfen null sein (eine neutralisierte Zeile), nie negativ:
 * eine negative Materialzeile wäre eine Gutschrift im Angebotspreis.
 */
export function pruefeKostenposition(eingabe: KostenpositionEingabe): GepruefteKostenposition {
  const art = eingabe.kostenart.trim();
  if (!(KOSTENARTEN as readonly string[]).includes(art)) {
    throw new KalkulationFehler(`Unbekannte Kostenart: ${art}`, 'unvollstaendig', 'kostenart');
  }
  const bezeichnung = eingabe.bezeichnung.trim();
  if (bezeichnung === '' || bezeichnung.length > BEZEICHNUNG_LAENGE) {
    throw new KalkulationFehler('Die Bezeichnung fehlt oder ist zu lang', 'unvollstaendig',
      'bezeichnung');
  }
  const einheit = eingabe.einheit.trim();
  if (einheit === '' || einheit.length > EINHEIT_LAENGE) {
    throw new KalkulationFehler('Die Einheit fehlt oder ist zu lang', 'unvollstaendig',
      'einheit');
  }
  let menge: MilliMenge;
  try {
    menge = mengeAusEingabe(eingabe.menge);
  } catch {
    throw new KalkulationFehler(`Keine Menge: ${JSON.stringify(eingabe.menge)}`, 'keine_zahl',
      'menge');
  }
  if ((menge as bigint) < 0n) {
    throw new KalkulationFehler('Eine Menge ist nicht negativ', 'keine_zahl', 'menge');
  }
  let einzelpreis: Cent;
  try {
    einzelpreis = parseGeld(eingabe.einzelpreisEuro);
  } catch {
    throw new KalkulationFehler(
      `Kein Betrag: ${JSON.stringify(eingabe.einzelpreisEuro)}`, 'keine_zahl', 'einzelpreis');
  }
  if ((einzelpreis as bigint) < 0n) {
    throw new KalkulationFehler('Ein Einzelpreis ist nicht negativ', 'keine_zahl',
      'einzelpreis');
  }
  return {
    kostenart: art as Kostenart, bezeichnung, menge, einheit, einzelpreis,
    betrag: multipliziereMitMenge(einzelpreis, menge as bigint),
  };
}

/** Der Rechenweg in Worten — deutsch, mit Einheiten, ohne selbst zu rechnen. */
export function berechnungswegText(p: GepruefteKostenposition): string {
  return `${formatiereMenge(p.menge)} ${p.einheit} × ${formatiereGeld(p.einzelpreis)} `
    + `= ${formatiereGeld(p.betrag)}`;
}

interface Kopf {
  readonly id: string;
  readonly status: string;
  readonly versendet: boolean;
  readonly freigegeben: boolean;
  readonly satz: string | null;
  readonly basis: string | null;
  readonly gk: number | null;
  readonly wg: number | null;
}

interface Alt {
  readonly id: string;
  readonly kostenart: string;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelbetrag_cent: string | null;
  readonly betrag_cent: string;
}

/**
 * Legt eine Material- oder Gerätezeile an — oder ändert eine vorhandene
 * (`positionId`) — und rechnet den Preis neu.
 *
 * Gesperrt wird der KOPF der Kalkulation (`for update`): zwei gleichzeitige
 * Zeilen bekommen sonst dieselbe Positionsnummer, und zwei gleichzeitige
 * Neuberechnungen schrieben Preise aus zwei verschiedenen Ständen.
 */
export async function setzeKostenposition(
  db: Abfrage, angebotId: string,
  eingabe: KostenpositionEingabe & { readonly positionId?: string | null },
): Promise<{ readonly positionId: string }> {
  const p = pruefeKostenposition(eingabe);

  const [kopf] = await db.abfrage<Kopf>(
    `select k.id, k.status::text as status,
            (a.versendet_am is not null) as versendet,
            (a.freigegeben_am is not null) as freigegeben,
            k.stundenverrechnungssatz_cent::text as satz,
            k.gemeinkosten_basis::text as basis, k.gemeinkosten_bp as gk,
            k.wagnis_gewinn_bp as wg
       from kalkulation k
       join angebot a on a.id = k.angebot_id
      where k.angebot_id = $1::uuid
      for update of k`, [angebotId]);
  if (kopf === undefined) {
    throw new KalkulationFehler('Zu diesem Angebot gibt es keine Kalkulation', 'nicht_gefunden');
  }
  if (kopf.status === 'festgeschrieben' || kopf.versendet) {
    throw new KalkulationFehler(
      'Diese Kalkulation ist festgeschrieben und wird nicht mehr geaendert', 'eingefroren');
  }
  if (kopf.freigegeben) {
    throw new KalkulationFehler(
      'Der Preis dieses Angebots ist freigegeben — eine Kostenzeile aenderte ihn. Ein '
      + 'anderer Preis braucht eine neue Angebotsversion (O-732)', 'preis_freigegeben');
  }
  if (kopf.basis === 'je_kostenart') {
    throw new KalkulationFehler(
      'Gemeinkosten je Kostenart brauchen Saetze je Kostenart — sie sind offen (O-16)',
      'basis_offen', 'gemeinkostenBasis');
  }
  if (kopf.satz === null || kopf.basis === null || kopf.gk === null || kopf.wg === null) {
    throw new KalkulationFehler(
      'Die Kalkulation traegt keinen Tarif, mit dem sich rechnen liesse', 'unvollstaendig');
  }

  const operanden = {
    menge_milli: String(p.menge), einzelbetrag_cent: String(p.einzelpreis),
    betrag_cent: String(p.betrag),
  };
  let positionId: string;
  let vorher: Record<string, unknown> | null = null;

  if (eingabe.positionId !== undefined && eingabe.positionId !== null
      && eingabe.positionId !== '') {
    const [alt] = await db.abfrage<Alt>(
      `select id, kostenart::text as kostenart, bezeichnung, menge::text as menge, einheit,
              einzelbetrag_cent::text as einzelbetrag_cent, betrag_cent::text as betrag_cent
         from kalkulation_position
        where id = $1::uuid and kalkulation_id = $2
          and kostenart in ('material', 'geraet')`, [eingabe.positionId, kopf.id]);
    if (alt === undefined) {
      throw new KalkulationFehler('Diese Kostenzeile gibt es nicht', 'nicht_gefunden');
    }
    vorher = {
      kostenart: alt.kostenart, bezeichnung: alt.bezeichnung, menge: alt.menge,
      einheit: alt.einheit, einzelbetrag_cent: alt.einzelbetrag_cent,
      betrag_cent: alt.betrag_cent,
    };
    await db.abfrage(
      `update kalkulation_position
          set kostenart = $2::kostenart, bezeichnung = $3, menge = $4::numeric,
              einheit = $5, einzelbetrag_cent = $6, betrag_cent = $7,
              operanden = $8::jsonb, berechnungsweg = $9
        where id = $1::uuid`,
      [alt.id, p.kostenart, p.bezeichnung, mengeNachPostgres(p.menge), p.einheit,
       String(p.einzelpreis), String(p.betrag), operanden, berechnungswegText(p)]);
    positionId = alt.id;
  } else {
    const [neu] = await db.abfrage<{ id: string }>(
      `insert into kalkulation_position
         (mandant_id, kalkulation_id, position_nr, kostenart, bezeichnung,
          menge, einheit, einzelbetrag_cent, betrag_cent,
          rechenansatz, operanden, berechnungsweg, sortierung, erstellt_von)
       select app.aktiver_mandant(), $1, n.nr, $2::kostenart, $3,
              $4::numeric, $5, $6, $7, 'Menge × Einzelpreis', $8::jsonb, $9, n.nr,
              app.aktueller_benutzer()
         from (select coalesce(max(position_nr), 0) + 1 as nr
                 from kalkulation_position where kalkulation_id = $1) n
       returning id`,
      [kopf.id, p.kostenart, p.bezeichnung, mengeNachPostgres(p.menge), p.einheit,
       String(p.einzelpreis), String(p.betrag), operanden, berechnungswegText(p)]);
    if (neu === undefined) {
      throw new KalkulationFehler('Die Kostenzeile wurde nicht angelegt', 'unvollstaendig');
    }
    positionId = neu.id;
  }

  await rechneKalkulationNeu(db, kopf.id, angebotId,
    { stundensatz: BigInt(kopf.satz) as Cent, gemeinkostenBp: kopf.gk, wagnisGewinnBp: kopf.wg },
    null, { basis: kopf.basis as GemeinkostenBasis, bestaetigt: false });

  await db.abfrage(
    `select app.protokolliere('kalkulation.kostenposition', 'kalkulation', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [kopf.id, vorher,
     { position: positionId, kostenart: p.kostenart, bezeichnung: p.bezeichnung,
       menge: mengeNachPostgres(p.menge), einheit: p.einheit,
       einzelbetrag_cent: String(p.einzelpreis), betrag_cent: String(p.betrag) }]);

  return { positionId };
}
