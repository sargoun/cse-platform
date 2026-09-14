import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import type { Bucket, Speicher } from '../../storage/adapter.js';

/**
 * Der EINE Weg, auf dem ein Dokument samt Datei verschwindet (DOC-07,
 * LEG-01, ACC-06, PR 64).
 *
 * Reihenfolge: zuerst die Zeile (weiches Loeschen — `geloescht_am`, mit
 * Grund und Person), dann das Objekt. Die Zeile entscheidet: ein Dokument
 * unter Loeschsperre weist die Datenbank ab (`kern.dokument_loeschsperre`),
 * eines, auf das sich eine Buchungszeile beruft, ebenso
 * (`fin.dokument_haengt_an_buchung`) — und dann wird auch das Objekt nicht
 * angefasst. Umgekehrt (erst Objekt, dann Zeile) laege im Bucket nichts
 * mehr, waehrend die Zeile noch auf die Datei zeigt: genau der Zustand, den
 * eine Betriebspruefung „Beleg nicht vorgelegt" nennt.
 *
 * Scheitert das Entfernen im Speicher NACH dem weichen Loeschen, wirft der
 * Adapter, die Transaktion des Aufrufers rollt die Zeile zurueck, und beides
 * steht wie vorher. Kein halber Zustand in keine Richtung.
 *
 * **Sonst ruft niemand `entferne`.** Die Merge-Wache
 * `speicher-entfernen-nur-ueber-loeschung` laesst den Aufruf nur hier und an
 * den Stellen zu, die ein gerade hochgeladenes Objekt ohne Zeile
 * zuruecknehmen (die Waisen der Upload-Routen).
 */
export class LoeschungFehler extends Error {
  constructor(nachricht: string, readonly grund: 'nicht_gefunden' | 'gesperrt' | 'grund') {
    super(nachricht);
    this.name = 'LoeschungFehler';
  }
}

export interface DokumentLoeschen {
  readonly dokumentId: string;
  /** Warum — steht in `loeschgrund`, mindestens fuenf Zeichen. */
  readonly grund: string;
}

export interface Geloescht {
  readonly bucket: Bucket;
  readonly objektSchluessel: string;
}

interface OrtRoh {
  readonly bucket: string;
  readonly objekt_schluessel: string;
}

function istRestriktion(fehler: unknown): fehler is Error & { code: string } {
  return fehler instanceof Error && (fehler as { code?: unknown }).code === '23001';
}

export async function loescheDokument(
  kontext: SchreibKontext, speicher: Speicher, e: DokumentLoeschen,
): Promise<Geloescht> {
  const grund = e.grund.trim();
  if (grund.length < 5) throw new LoeschungFehler('Ein Löschgrund gehört dazu — mindestens fünf Zeichen.', 'grund');

  let zeilen: readonly OrtRoh[];
  try {
    zeilen = await kontext.schreibe<OrtRoh>(
      `update dokument
          set geloescht_am = now(), geloescht_von = app.aktueller_benutzer(), loeschgrund = $2
        where id = $1::uuid and mandant_id = app.aktiver_mandant() and geloescht_am is null
        returning bucket, objekt_schluessel`,
      [e.dokumentId, grund]);
  } catch (fehler: unknown) {
    if (istRestriktion(fehler)) throw new LoeschungFehler(fehler.message, 'gesperrt');
    throw fehler;
  }
  const ort = zeilen[0];
  if (ort === undefined) {
    throw new LoeschungFehler('Das Dokument ist nicht erreichbar oder schon gelöscht.', 'nicht_gefunden');
  }
  await speicher.entferne(ort.bucket as Bucket, ort.objekt_schluessel);
  return { bucket: ort.bucket as Bucket, objektSchluessel: ort.objekt_schluessel };
}
