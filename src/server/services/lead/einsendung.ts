import type { FormularFeld } from '../../../lib/formular/schema.js';
import { tagDeutsch } from '../../../lib/datum/kalendertag.js';

/**
 * **Eine Einsendung, so wie ein Mensch sie liest** (V-137, REQ-02 … REQ-04,
 * CRM-01, CRM-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Annahme speichert alles, was das Formular erhebt — Name, E-Mail,
 * Telefon, Objektart, Fläche, Turnus, Anlass, Gewerk, Termine — in
 * `formular_eingang.daten`. Der Lead übernahm davon nur die Firma und das
 * freie Nachrichtenfeld, und KEIN Bildschirm las `daten`. Wer einen Web-Lead
 * bearbeitete, sah weder den Kontaktweg noch die Angebotsgrundlage: er konnte
 * weder zurückrufen noch kalkulieren.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Regel dieser Datei: die Feldliste der Version ist das Wörterbuch.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gelesen wird gegen die Felder der Formularversion, mit der eingesendet
 * wurde (`formular_definition.felder`) — nicht gegen die heutige. Ein
 * umbenanntes Label oder eine gestrichene Option ändert nicht, was damals
 * gefragt und beantwortet wurde. Auswahlwerte werden zu ihren Labels, Daten
 * zu deutschen Daten; Dateien stehen nicht hier, sondern als Dokument mit
 * Bezug (`dokument.formular_eingang_id`).
 *
 * **Nichts verschwindet.** Ein Wert, zu dem die Version kein Feld kennt,
 * steht am Ende mit seinem Schlüssel — lieber roh als unsichtbar.
 */

export interface EinsendungsZeile {
  readonly schluessel: string;
  readonly label: string;
  readonly wert: string;
  /** Wie die Seite ihn setzt: als Verweis, mehrzeilig oder schlicht. */
  readonly art: 'text' | 'mehrzeilig' | 'email' | 'telefon';
}

const DE_ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });

/** `2026-10-01T08:30` → `01.10.2026, 08:30` — die Wanduhr, wie eingegeben. */
function datumZeit(w: string): string {
  const t = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/u.exec(w);
  return t === null ? w : `${tagDeutsch(t[1])}, ${t[2] ?? ''}`;
}

function alsText(w: unknown): string {
  if (typeof w === 'string') return w.trim();
  if (typeof w === 'number' && Number.isFinite(w)) return DE_ZAHL.format(w);
  if (typeof w === 'boolean') return w ? 'ja' : 'nein';
  if (w === null || w === undefined) return '';
  return JSON.stringify(w);
}

function wertFuer(feld: FormularFeld, roh: unknown): string {
  switch (feld.typ) {
    case 'checkbox':
      return roh === true || roh === 'true' || roh === 'on' ? 'ja' : 'nein';
    case 'auswahl':
      return feld.optionen.find((o) => o.wert === roh)?.label ?? alsText(roh);
    case 'mehrfachauswahl': {
      const liste = Array.isArray(roh) ? roh : [roh];
      return liste
        .map((w) => feld.optionen.find((o) => o.wert === w)?.label ?? alsText(w))
        .filter((t) => t !== '')
        .join(', ');
    }
    case 'datum':
      return typeof roh === 'string' ? tagDeutsch(roh) : alsText(roh);
    case 'datum_zeit':
      return typeof roh === 'string' ? datumZeit(roh) : alsText(roh);
    default:
      return alsText(roh);
  }
}

function artFuer(feld: FormularFeld): EinsendungsZeile['art'] {
  if (feld.typ === 'email') return 'email';
  if (feld.typ === 'telefon') return 'telefon';
  if (feld.typ === 'textarea') return 'mehrzeilig';
  return 'text';
}

export function einsendungLesbar(
  felder: readonly FormularFeld[], daten: Readonly<Record<string, unknown>>,
): readonly EinsendungsZeile[] {
  const zeilen: EinsendungsZeile[] = [];
  const bekannt = new Set<string>();
  for (const feld of [...felder].sort((a, b) => a.sortierung - b.sortierung)) {
    bekannt.add(feld.schluessel);
    if (feld.typ === 'datei') continue;
    if (!(feld.schluessel in daten)) continue;
    const wert = wertFuer(feld, daten[feld.schluessel]);
    if (wert === '') continue;
    zeilen.push({ schluessel: feld.schluessel, label: feld.label, wert, art: artFuer(feld) });
  }
  for (const [schluessel, roh] of Object.entries(daten)) {
    if (bekannt.has(schluessel)) continue;
    const wert = alsText(roh);
    if (wert === '') continue;
    zeilen.push({ schluessel, label: schluessel, wert, art: 'text' });
  }
  return zeilen;
}
