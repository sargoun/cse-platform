import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';

/**
 * Erfassen, dass ein Mensch eingereicht hat — und das Ergebnis, das danach
 * kommt (RAD-07, D-07, REP-06).
 *
 * **Die Plattform reicht nichts ein.** Die deutschen Vergabeplattformen bieten
 * dafür keine Schnittstelle an (D-07); eine Automatik zu bauen, hiesse sie zu
 * erfinden. Was diese Datei kann, ist festhalten, was jemand getan hat — mit
 * dem Namen, dem Zeitpunkt der Datenbank und der benutzten Plattform.
 *
 * **Der Schreibweg geht über `app.mappe_einreichung_erfassen`, nicht über ein
 * UPDATE.** Der Anwendungsrolle sind die Einreichungsspalten entzogen: so kann
 * weder ein Tippfehler in einem anderen Dienst noch ein Agent behaupten, es
 * sei abgegeben worden. Und die Person kommt aus der Sitzung, nicht aus dem
 * Formular — ein Formularfeld „wer hat eingereicht" wäre eine Unterschrift,
 * die man für andere leisten kann.
 */

export class EinreichungFehler extends Error {
  readonly code: 'eingabe' | 'stand' | 'nicht_gefunden' | 'recht';
  readonly status: number;
  constructor(code: 'eingabe' | 'stand' | 'nicht_gefunden' | 'recht', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.status = code === 'nicht_gefunden' ? 404 : code === 'recht' ? 403 : 400;
    this.name = 'EinreichungFehler';
  }
}

export interface EinreichungEingabe {
  readonly mappeId: string;
  /** Aus dem Katalog, wenn die Plattform dort steht … */
  readonly plattformId?: string | null;
  /** … sonst ihr Name im Klartext. Der Katalog ist mit Absicht leer (O-07). */
  readonly plattformText?: string | null;
  readonly kennzeichen?: string | null;
  readonly belegDokumentId?: string | null;
}

/** Codes, die die Datenbankfunktion wirft, in Sätze übersetzt, die eine Seite zeigt. */
function alsFehler(fehler: unknown): EinreichungFehler {
  const code = typeof fehler === 'object' && fehler !== null && 'code' in fehler
    ? String((fehler as { code: unknown }).code) : '';
  const text = fehler instanceof Error ? fehler.message : 'Die Einreichung wurde nicht erfasst.';
  if (code === 'no_data_found') {
    return new EinreichungFehler('nicht_gefunden', 'Die Vergabemappe wurde nicht gefunden.');
  }
  if (code === '42501') return new EinreichungFehler('recht', text);
  if (code === '23514') return new EinreichungFehler('stand', text);
  return new EinreichungFehler('eingabe', text);
}

export async function erfasseEinreichung(
  kontext: SchreibKontext, e: EinreichungEingabe,
): Promise<Date> {
  const text = (e.plattformText ?? '').trim();
  if ((e.plattformId ?? null) === null && text === '') {
    throw new EinreichungFehler('eingabe',
      'Zu einer Einreichung gehört die Plattform, über die sie lief — '
      + 'aus dem Katalog oder im Klartext.');
  }
  try {
    const [zeile] = await kontext.schreibe<{ eingereicht_am: Date }>(
      `select app.mappe_einreichung_erfassen($1::uuid, $2::uuid, $3, $4, $5::uuid) as eingereicht_am`,
      [e.mappeId, e.plattformId ?? null, text === '' ? null : text,
        (e.kennzeichen ?? '').trim() === '' ? null : (e.kennzeichen ?? '').trim(),
        e.belegDokumentId ?? null]);
    if (zeile === undefined) {
      throw new EinreichungFehler('nicht_gefunden', 'Die Vergabemappe wurde nicht gefunden.');
    }
    return zeile.eingereicht_am;
  } catch (fehler) {
    if (fehler instanceof EinreichungFehler) throw fehler;
    throw alsFehler(fehler);
  }
}

/**
 * Der Ausgang des Verfahrens (REP-06).
 *
 * **Drei Ausgänge und kein vierter.** `zuschlag`, `nicht_beruecksichtigt`,
 * `verfahren_aufgehoben` — das sind die Enden eines deutschen Vergabe-
 * verfahrens, keine erfundene Sortierung. Ohne sie ist der Bericht „gefunden ·
 * geprüft · geboten · gewonnen" nicht zu rechnen, und der Radar könnte nicht
 * belegen, dass er der stärkste Kanal dieses Betriebs ist (REP-03).
 */
export const AUSGAENGE = ['zuschlag', 'nicht_beruecksichtigt', 'verfahren_aufgehoben'] as const;
export type Ausgang = typeof AUSGAENGE[number];

export interface AusgangEingabe {
  readonly ausschreibungId: string;
  readonly ausgang: Ausgang;
  /** Tagesdatum in `Europe/Berlin` — der Zuschlag hat ein Datum, keine Uhrzeit. */
  readonly entschiedenAm: string;
  /** Nur beim Zuschlag: der Auftragswert in ganzen Cent (Invariante 1). */
  readonly zuschlagswertCent?: bigint | null;
  readonly notiz?: string | null;
}

export async function erfasseAusgang(
  kontext: SchreibKontext, e: AusgangEingabe,
): Promise<void> {
  if (!(AUSGAENGE as readonly string[]).includes(e.ausgang)) {
    throw new EinreichungFehler('eingabe', `„${e.ausgang}" ist kein Ausgang eines Verfahrens.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(e.entschiedenAm)) {
    throw new EinreichungFehler('eingabe', 'Das Entscheidungsdatum fehlt oder ist unlesbar.');
  }
  const wert = e.zuschlagswertCent ?? null;
  if (e.ausgang !== 'zuschlag' && wert !== null) {
    throw new EinreichungFehler('eingabe',
      'Einen Auftragswert gibt es nur beim Zuschlag.');
  }
  if (wert !== null && wert < 0n) {
    throw new EinreichungFehler('eingabe', 'Ein Auftragswert ist nicht negativ.');
  }

  const [vorher] = await kontext.abfrage<{ status: string }>(
    `select status::text as status from ausschreibung_vorgang
      where mandant_id = $1::uuid and ausschreibung_id = $2::uuid and geloescht_am is null`,
    [kontext.aktiverMandantId, e.ausschreibungId]);
  if (vorher === undefined) {
    throw new EinreichungFehler('nicht_gefunden', 'Zu dieser Bekanntmachung gibt es keinen Vorgang.');
  }
  /**
   * Ein Ausgang setzt eine Abgabe voraus. „Wir haben gewonnen, ohne zu
   * bieten" ist keine Zahl, die in einen Bericht gehört — und `verworfen`
   * heisst, dass wir gar nicht angetreten sind.
   */
  if (vorher.status !== 'eingereicht' && !(AUSGAENGE as readonly string[]).includes(vorher.status)) {
    throw new EinreichungFehler('stand',
      'Ein Ausgang wird erst erfasst, wenn die Einreichung erfasst ist.');
  }

  await kontext.schreibe(
    `update ausschreibung_vorgang
        set status = $3::ausschreibung_status,
            entschieden_am = $4::date,
            zuschlagswert_cent = $5::bigint,
            notiz = coalesce($6, notiz),
            status_geaendert_am = now(), status_geaendert_von = $7::uuid,
            geaendert_am = now(), geaendert_von = $7::uuid
      where mandant_id = $1::uuid and ausschreibung_id = $2::uuid and geloescht_am is null`,
    [kontext.aktiverMandantId, e.ausschreibungId, e.ausgang, e.entschiedenAm,
      wert === null ? null : wert.toString(),
      (e.notiz ?? '').trim() === '' ? null : (e.notiz ?? '').trim(), kontext.benutzerId]);

  await kontext.schreibe(
    `select app.protokolliere('vergabe.ausgang_erfasst', 'ausschreibung_vorgang', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [e.ausschreibungId, { status: vorher.status },
      { status: e.ausgang, entschiedenAm: e.entschiedenAm, mitWert: wert !== null }]);
}
