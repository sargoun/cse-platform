/**
 * Der Upload-Pfad (DOC-01, DOC-03, DOC-05, SEC-A6, TIM-10).
 *
 * Die Reihenfolge ist die ganze Sicherheit, und sie ist bewusst so:
 *
 *   1. Groesse  — bevor irgendetwas gelesen wird, das zu gross ist.
 *   2. Typ      — aus MAGIC BYTES, nie aus Name oder Content-Type.
 *   3. Metadaten entfernen — auf den Bytes, die gespeichert werden.
 *   4. Aufbewahrung aufloesen — vor dem Schreiben, nie danach.
 *   5. Speichern.
 *
 * Wer 3 nach 5 stellt, hat das Foto mit GPS bereits im Bucket; wer 2 nach 5
 * stellt, hat die `.exe` dort. Deshalb tut diese Funktion beides vorher und
 * gibt erst danach etwas an den Speicher.
 */
import { randomUUID, createHash } from 'node:crypto';
import { entferneMetadaten, brauchtBereinigung } from '../../storage/exif.js';
import { pruefeGroesse, pruefeUpload } from '../../storage/mime.js';
import type { Bucket, Speicher } from '../../storage/adapter.js';
import { regelFuer, type Kategorie } from './kategorie.js';

export interface UploadEingabe {
  readonly mandantId: string;
  readonly kategorie: Kategorie;
  readonly titel: string;
  readonly dateiname: string;
  readonly daten: Uint8Array;
  /** Was der Browser behauptet. Wird geprueft, nie geglaubt. */
  readonly behaupteterTyp?: string;
  readonly bucket?: Bucket;
}

export interface UploadErgebnis {
  readonly dokumentId: string;
  readonly objektSchluessel: string;
  readonly bucket: Bucket;
  readonly mimeTyp: string;
  readonly mimeVerifiziert: true;
  readonly groesseBytes: number;
  readonly exifEntfernt: boolean;
  readonly sha256: string;
  /** `null`, wenn die Frist offen ist — dann ist `loeschsperre` true. */
  readonly aufbewahrungBis: string | null;
  readonly loeschsperre: boolean;
}

/** Jahresende + n Jahre, als `YYYY-MM-DD`. */
function fristEnde(jahr: number, jahre: number): string {
  return `${String(jahr + jahre)}-12-31`;
}

export async function ladeHoch(
  eingabe: UploadEingabe,
  speicher: Speicher,
  /** Das Jahr der Entstehung — uebergeben, nicht aus der Uhr gelesen (Invariante 5). */
  entstehungsJahr: number,
): Promise<UploadErgebnis> {
  pruefeGroesse(eingabe.daten);
  const { mime } = pruefeUpload(eingabe.daten, eingabe.behaupteterTyp);

  const bereinigt = entferneMetadaten(eingabe.daten, mime);
  const bytes = bereinigt.bytes;

  /**
   * `exif_entfernt` ist wahr, wenn der Typ ueberhaupt bereinigt werden musste
   * — nicht nur, wenn tatsaechlich etwas dranhing. Ein JPEG ohne EXIF ist
   * bereinigt; die Spalte sagt "durch die Bereinigung gegangen", nicht "hatte
   * welches".
   */
  const exifEntfernt = brauchtBereinigung(mime);

  const regel = regelFuer(eingabe.kategorie);
  const aufbewahrungBis = regel.jahre === null ? null : fristEnde(entstehungsJahr, regel.jahre);

  const dokumentId = randomUUID();
  const bucket = eingabe.bucket ?? 'dokumente';
  // Der Mandant fuehrt den Schluessel an: ein Objekt liegt sichtbar im
  // Praefix seines Bereichs, und ein Listing ueber den falschen Praefix
  // findet nichts.
  const objektSchluessel = `${eingabe.mandantId}/${eingabe.kategorie}/${dokumentId}`;

  await speicher.lege(bucket, objektSchluessel, bytes);

  return {
    dokumentId,
    objektSchluessel,
    bucket,
    mimeTyp: mime,
    mimeVerifiziert: true,
    groesseBytes: bytes.length,
    exifEntfernt,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    aufbewahrungBis,
    // Eine unbekannte Pflicht wird als Pflicht behandelt, nie als ihre
    // Abwesenheit — der Platzhalterfall aus O-25.
    loeschsperre: regel.loeschsperre || regel.istPlatzhalter,
  };
}
