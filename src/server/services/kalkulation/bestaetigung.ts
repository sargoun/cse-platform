/**
 * Die Bestaetigung einer Kalkulation — der Moment, in dem aus geschaetzten
 * Werten verantwortete werden.
 *
 * Bis hierhin steht ein Preis auf Platzhaltern: dem Stundenverrechnungssatz
 * und den Zuschlaegen (O-16) und dem Reinigungsrichtwert je Belagsart (O-17).
 * `kern.angebot_versand_pruefen` laesst ein solches Angebot nicht hinaus, und
 * das ist richtig — ein eingefrorener Preis auf vier unbeantworteten Fragen
 * sieht pruefbar aus und ist es nicht.
 *
 * Dieser Dienst ist der Ausweg, und er ist mit Absicht KEIN Schalter: er
 * verlangt die Zahlen. Wer bestaetigt, sagt „fuer dieses Angebot rechnen wir
 * so“, und die Kalkulation haelt fest, wer das wann gesagt hat. Was
 * gruppenweit gilt, bleibt offen (O-16) — und wird es so lange, bis der
 * Mandant es beantwortet, statt dass eine Vorgabe im Code es fuer ihn tut.
 */
import { parseGeld, type Cent } from '../finanz/geld.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class KalkulationFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'eingefroren' | 'unvollstaendig' | 'keine_zahl') {
    super(nachricht);
    this.name = 'KalkulationFehler';
  }
}

/** Die erlaubten Basen — dieselben drei, die der Typ `gemeinkosten_basis` kennt. */
export const GEMEINKOSTEN_BASEN = ['lohn', 'selbstkosten', 'je_kostenart'] as const;

export interface Bestaetigung {
  /** Stundenverrechnungssatz als deutsche Eingabe, z. B. `"29,00"`. */
  readonly stundensatzEuro: string | null;
  readonly gemeinkostenBasis: string;
  /** Prozentsatz als deutsche Eingabe, z. B. `"15"` oder `"15,5"`. */
  readonly gemeinkostenProzent: string | null;
  readonly wagnisGewinnProzent: string | null;
  /**
   * Auch die Leistungswerte (O-17) bestaetigen?
   *
   * Getrennt, weil es eine ANDERE Aussage ist: der Stundensatz ist eine Zahl
   * dieses Angebots, der Reinigungsrichtwert eine Eigenschaft des Katalogs.
   * Wer ihn bestaetigt, bestaetigt ihn fuer jedes kuenftige Angebot mit.
   */
  readonly leistungswerteBestaetigen: boolean;
  readonly benutzerId: string;
}

/**
 * Ein Prozentsatz in Basispunkte — ganzzahlig, ohne Gleitkomma.
 *
 * `"15"` → 1500, `"15,5"` → 1550. Zwei Nachkommastellen sind die Grenze:
 * mehr traegt die Spalte nicht, und stillschweigend zu runden hiesse, einen
 * Zuschlag zu aendern, den jemand eingetippt hat.
 */
export function prozentInBasispunkte(eingabe: string): number {
  const text = eingabe.trim().replace(/\s|%/gu, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/u.test(text)) {
    throw new KalkulationFehler(
      `Kein Prozentsatz: ${JSON.stringify(eingabe)}`, 'keine_zahl');
  }
  const [ganz = '0', bruch = ''] = text.split('.');
  const bp = Number(ganz) * 100 + Number(bruch.padEnd(2, '0'));
  if (bp > 100_000) {
    throw new KalkulationFehler(`Zuschlag ausserhalb des Bereichs: ${eingabe}`, 'keine_zahl');
  }
  return bp;
}

/** Der Eurobetrag als ganze Cent — ueber die geprueft Geldfunktion, nie ueber `Number`. */
export function stundensatzInCent(eingabe: string): Cent {
  try {
    return parseGeld(eingabe);
  } catch {
    throw new KalkulationFehler(
      `Kein Betrag: ${JSON.stringify(eingabe)}`, 'keine_zahl');
  }
}

export async function bestaetigeKalkulation(
  db: Abfrage, angebotId: string, eingabe: Bestaetigung,
): Promise<{ readonly bestaetigt: boolean }> {
  if (!(GEMEINKOSTEN_BASEN as readonly string[]).includes(eingabe.gemeinkostenBasis)) {
    throw new KalkulationFehler(
      `Unbekannte Gemeinkostenbasis: ${eingabe.gemeinkostenBasis}`, 'unvollstaendig');
  }
  if (eingabe.stundensatzEuro === null || eingabe.gemeinkostenProzent === null
      || eingabe.wagnisGewinnProzent === null) {
    throw new KalkulationFehler(
      'Stundensatz, Gemeinkosten- und Wagnis-/Gewinnzuschlag muessen alle drei '
      + 'angegeben sein', 'unvollstaendig');
  }

  const satz = stundensatzInCent(eingabe.stundensatzEuro);
  const gk = prozentInBasispunkte(eingabe.gemeinkostenProzent);
  const wg = prozentInBasispunkte(eingabe.wagnisGewinnProzent);

  /**
   * `for update` — und die Pruefung auf `festgeschrieben` DANACH.
   *
   * Eine eingefrorene Kalkulation gehoert zu einem versendeten Angebot. Sie
   * nachtraeglich zu aendern hiesse, den Rechenweg eines abgegebenen Preises
   * umzuschreiben; der Unveraenderlichkeits-Ausloeser weist das ohnehin ab,
   * aber mit einem Fehler, der nichts erklaert.
   */
  const [kopf] = await db.abfrage<{ id: string; status: string }>(
    `select id, status::text as status from kalkulation
      where angebot_id = $1 for update`, [angebotId]);
  if (kopf === undefined) {
    throw new KalkulationFehler('Zu diesem Angebot gibt es keine Kalkulation', 'nicht_gefunden');
  }
  if (kopf.status === 'festgeschrieben') {
    throw new KalkulationFehler(
      'Diese Kalkulation ist festgeschrieben und wird nicht mehr geaendert', 'eingefroren');
  }

  await db.abfrage(
    `update kalkulation
        set stundenverrechnungssatz_cent = $2,
            gemeinkosten_basis = $3::gemeinkosten_basis,
            gemeinkosten_bp = $4,
            wagnis_gewinn_bp = $5,
            ist_platzhalter = false,
            geaendert_von = $6
      where id = $1`,
    [kopf.id, String(satz), eingabe.gemeinkostenBasis, gk, wg, eingabe.benutzerId]);

  if (eingabe.leistungswerteBestaetigen) {
    /**
     * Nur die Belagsarten, die DIESE Kalkulation benutzt — nicht der ganze
     * Katalog. Was in keiner Zeile vorkommt, hat auch niemand geprueft.
     */
    await db.abfrage(
      `update belagsart
          set ist_platzhalter = false,
              quelle = 'Bestaetigt im Angebot ' || $2
        where id in (select p.belagsart_id from kalkulation_position p
                      where p.kalkulation_id = $1 and p.belagsart_id is not null)`,
      [kopf.id, angebotId]);
  }

  return { bestaetigt: true };
}
