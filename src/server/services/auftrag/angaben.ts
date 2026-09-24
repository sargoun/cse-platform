/**
 * Die Angaben eines Auftrags aus einem Formular — geprüft, BEVOR eine Nummer
 * gezogen oder eine Zeile geschrieben wird (V-172, OPS-10, D-599).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `POST /api/auftrag` las Personalbedarf und Wochenstunden mit
 * `Number(roh.replace(',', '.'))`. Aus „1.234,5" wurde so „1.234.5", also
 * `NaN`, und der Mensch sah eine weisse Seite `{"fehler":"keine_zahl"}`.
 * Ein deutsches Formular muss deutsche Zahlen verstehen — mit Tausenderpunkt
 * und Dezimalkomma —, und was es nicht versteht, gehört als Satz zurück auf
 * die Maske.
 *
 * **Eine Stelle für alle Wege.** Der Assistent und die Auftragspflege
 * (`aendern.ts`) prüfen dieselben Felder mit denselben Grenzen; zwei Fassungen
 * liefen beim ersten neuen Feld auseinander.
 *
 * **Die Grenzen sind die der CHECKs aus 0025**, nicht neue: 0 … 5.000 ganze
 * Personen und 0 … 10.000 Wochenstunden. Die Datenbank hält sie ein zweites
 * Mal; hier stehen sie, damit ein Tippfehler einen Satz bekommt und keine
 * Auftragsnummer verbraucht.
 */
import { alsNumerisch, leseZahl } from '../raumbuch/tabelle.js';

/** Was dieser Dienst von einem Kontext braucht: lesen unter der Sitzung. */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/** `auftrag_personalbedarf_bereich` (0025). */
export const PERSONALBEDARF_HOECHSTENS = 5_000;
/** `auftrag_wochenstunden_bereich` (0025). */
export const WOCHENSTUNDEN_HOECHSTENS = 10_000;

export type AngabenGrund = 'keine_zahl' | 'ausserhalb_bereich';

export interface AngabenRoh {
  readonly personalbedarf?: string | null;
  readonly wochenstunden?: string | null;
}

export interface Angaben {
  /** Ganze Personen, oder `null` — nicht angegeben, nicht geschätzt. */
  readonly personalbedarf: number | null;
  /** Wochenstunden als `numeric(12,3)`-Text, oder `null`. */
  readonly wochenstunden: string | null;
}

export type AngabenErgebnis =
  | { readonly ok: true; readonly werte: Angaben }
  | { readonly ok: false; readonly grund: AngabenGrund; readonly felder: readonly string[] };

function leer(wert: string | null | undefined): boolean {
  return wert === null || wert === undefined || wert.trim() === '';
}

/**
 * Prüft die Zahlen — rein, ohne Datenbank.
 *
 * Erst „ist das eine Zahl", dann „liegt sie im Bereich": wer „40 Std" tippt,
 * soll nicht lesen, 40 Std liege ausserhalb des Bereichs.
 */
export function pruefeAuftragsangaben(roh: AngabenRoh): AngabenErgebnis {
  const unlesbar: string[] = [];
  const ausserhalb: string[] = [];

  let personalbedarf: number | null = null;
  if (!leer(roh.personalbedarf)) {
    const befund = leseZahl(roh.personalbedarf ?? '');
    if (befund.wert === null) {
      unlesbar.push('personalbedarfAnzahl');
    } else if (befund.wert % 1000n !== 0n || befund.wert < 0n
               || befund.wert > BigInt(PERSONALBEDARF_HOECHSTENS) * 1000n) {
      // Ganze Personen: `smallint` schneidet 2,5 nicht ab, es wirft.
      ausserhalb.push('personalbedarfAnzahl');
    } else {
      personalbedarf = Number(befund.wert / 1000n);
    }
  }

  let wochenstunden: string | null = null;
  if (!leer(roh.wochenstunden)) {
    const befund = leseZahl(roh.wochenstunden ?? '');
    if (befund.wert === null) {
      unlesbar.push('wochenstundenSoll');
    } else if (befund.wert < 0n || befund.wert > BigInt(WOCHENSTUNDEN_HOECHSTENS) * 1000n) {
      ausserhalb.push('wochenstundenSoll');
    } else {
      wochenstunden = alsNumerisch(befund.wert);
    }
  }

  if (unlesbar.length > 0) return { ok: false, grund: 'keine_zahl', felder: unlesbar };
  if (ausserhalb.length > 0) return { ok: false, grund: 'ausserhalb_bereich', felder: ausserhalb };
  return { ok: true, werte: { personalbedarf, wochenstunden } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TAG = /^\d{4}-\d{2}-\d{2}$/u;

/** Ein Kalendertag `JJJJ-MM-TT`, der als Datum existiert (kein 30. Februar). */
export function istKalendertag(wert: string): boolean {
  if (!TAG.test(wert)) return false;
  const t = Date.parse(`${wert}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === wert;
}

export type BezugGrund =
  | 'unvollstaendig' | 'datum_ungueltig' | 'laufzeit_vor_start'
  | 'kunde_unbekannt' | 'objekt_unbekannt' | 'verantwortlich_fremd';

export interface AuftragsbezugRoh {
  readonly kundeId?: string | null;
  readonly objektId?: string | null;
  readonly verantwortlichBenutzerId: string;
  readonly startDatum: string;
  readonly laufzeitBis?: string | null;
}

/**
 * Kunde, Ort, Leitung und Laufzeit — die Fragen, die sonst als 22007, 23503
 * oder 23514 aus der Tiefe kämen.
 *
 * Unter RLS gefragt: ein Kunde oder Objekt, das diese Sitzung nicht sieht,
 * gibt es für sie nicht. Die Leitung fragt `app.ist_mitglied`, dieselbe
 * Funktion, die der Auslöser `kern.auftrag_verantwortlich_im_mandant` (0025)
 * danach noch einmal fragt. Der Vergleich der Tage ist Text gegen Text —
 * `JJJJ-MM-TT` sortiert wie das Datum.
 */
export async function pruefeAuftragsbezug(
  kontext: Abfrage, roh: AuftragsbezugRoh,
): Promise<BezugGrund | null> {
  const kunde = roh.kundeId?.trim() ?? '';
  const objekt = roh.objektId?.trim() ?? '';
  const leitung = roh.verantwortlichBenutzerId.trim();
  const bis = roh.laufzeitBis?.trim() ?? '';
  if (roh.kundeId !== undefined && !UUID.test(kunde)) return 'unvollstaendig';
  if (objekt !== '' && !UUID.test(objekt)) return 'objekt_unbekannt';
  if (!UUID.test(leitung)) return 'unvollstaendig';
  if (!istKalendertag(roh.startDatum) || (bis !== '' && !istKalendertag(bis))) {
    return 'datum_ungueltig';
  }
  if (bis !== '' && bis < roh.startDatum) return 'laufzeit_vor_start';

  if (roh.kundeId !== undefined) {
    const [k] = await kontext.abfrage<{ id: string }>(
      `select id from kunde where id = $1::uuid and archiviert_am is null`, [kunde]);
    if (k === undefined) return 'kunde_unbekannt';
  }
  if (objekt !== '') {
    const [o] = await kontext.abfrage<{ id: string }>(
      `select id from objekt where id = $1::uuid and archiviert_am is null`, [objekt]);
    if (o === undefined) return 'objekt_unbekannt';
  }
  const [m] = await kontext.abfrage<{ ja: boolean }>(
    `select app.ist_mitglied($1::uuid, app.aktiver_mandant()) as ja`, [leitung]);
  if (m?.ja !== true) return 'verantwortlich_fremd';
  return null;
}
