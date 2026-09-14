import { randomUUID, createHash } from 'node:crypto';
import { pruefeGroesse, MimeFehler } from '../../storage/mime.js';
import type { Bucket, Speicher } from '../../storage/adapter.js';
import { regelFuer, type Kategorie } from './kategorie.js';

/**
 * Die Ablage für Dateien, die die PLATTFORM erzeugt hat (DOC-01, DOC-05).
 *
 * **Warum nicht `ladeHoch`.** Der Upload-Pfad prüft Magic Bytes und entfernt
 * Metadaten, weil dort Inhalt ankommt, den ein MENSCH mitbringt: eine `.exe`
 * mit der Endung `.pdf`, ein Foto mit GPS-Koordinaten. Beides gibt es hier
 * nicht — die Bytes stammen aus dieser Codebasis, wenige Zeilen weiter oben.
 *
 * Und beides ist nicht nur überflüssig, sondern falsch: eine EXTF-Datei ist
 * Text und hat GAR KEINE Signatur. `pruefeUpload` weist sie deshalb ab, und
 * zwar zu Recht — sie ist kein Upload. Die naheliegende Antwort wäre gewesen,
 * `text/csv` in `ERLAUBTE_MIME` aufzunehmen und die Signaturprüfung für
 * Textdateien zu überspringen. Das hätte den Upload-Riegel für JEDE Datei
 * geöffnet, die sich als Text ausgibt — um eines Problems willen, das der
 * Upload gar nicht hat.
 *
 * **Was hier trotzdem geprüft wird.** Die Grösse (dieselbe Grenze), die
 * Aufbewahrung (dieselbe Regel), und bei Textformaten, dass der Inhalt
 * tatsächlich Text ist: jedes Byte druckbar oder CR, LF, TAB. Das ist keine
 * Formalie — es ist die Prüfung, die anschlägt, wenn hier je etwas anderes
 * durchgereicht wird als das, was der Name behauptet.
 */

/** Was die Plattform selbst herstellt. Geschlossen, und aus gutem Grund kurz. */
export const ERZEUGTE_TYPEN = [
  'text/csv', 'application/xml', 'text/xml', 'application/json', 'text/plain',
] as const;
export type ErzeugterTyp = (typeof ERZEUGTE_TYPEN)[number];

export interface ErzeugtEingabe {
  readonly mandantId: string;
  readonly kategorie: Kategorie;
  readonly titel: string;
  readonly dateiname: string;
  readonly daten: Uint8Array;
  readonly mimeTyp: ErzeugterTyp;
  readonly bucket?: Bucket;
}

export interface ErzeugtErgebnis {
  readonly dokumentId: string;
  readonly objektSchluessel: string;
  readonly bucket: Bucket;
  readonly mimeTyp: string;
  readonly groesseBytes: number;
  readonly sha256: string;
  readonly aufbewahrungBis: string | null;
  readonly loeschsperre: boolean;
}

/** Jahresende + n Jahre, als `YYYY-MM-DD` — dieselbe Regel wie im Upload. */
function fristEnde(jahr: number, jahre: number): string {
  return `${String(jahr + jahre)}-12-31`;
}

/**
 * Ist jedes Byte druckbarer Text?
 *
 * Erlaubt sind 0x09 (TAB), 0x0A (LF), 0x0D (CR) und alles ab 0x20 — also auch
 * der obere CP1252-Bereich, in dem `ü` und `€` liegen. Verboten ist der Rest
 * der Steuerzeichen, und damit insbesondere das Nullbyte: eine ausführbare
 * Datei kommt hier nicht durch, auch wenn jemand sie `text/csv` nennt.
 */
export function istText(daten: Uint8Array): boolean {
  for (const b of daten) {
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x20) return false;
  }
  return true;
}

export async function legeErzeugtAb(
  eingabe: ErzeugtEingabe,
  speicher: Speicher,
  /** Das Jahr der Entstehung — übergeben, nicht aus der Uhr gelesen (Invariante 5). */
  entstehungsJahr: number,
): Promise<ErzeugtErgebnis> {
  pruefeGroesse(eingabe.daten);

  if (!ERZEUGTE_TYPEN.includes(eingabe.mimeTyp)) {
    throw new MimeFehler(
      `${eingabe.mimeTyp} steht nicht in ERZEUGTE_TYPEN.`, 'nicht_erlaubt');
  }
  if (!istText(eingabe.daten)) {
    throw new MimeFehler(
      `Der Inhalt ist als ${eingabe.mimeTyp} deklariert, enthält aber `
      + 'Steuerzeichen. Abgelehnt.',
      'widerspruch');
  }

  const regel = regelFuer(eingabe.kategorie);
  const aufbewahrungBis = regel.jahre === null ? null : fristEnde(entstehungsJahr, regel.jahre);

  const dokumentId = randomUUID();
  const bucket = eingabe.bucket ?? 'dokumente';
  const objektSchluessel = `${eingabe.mandantId}/${eingabe.kategorie}/${dokumentId}`;

  await speicher.lege(bucket, objektSchluessel, eingabe.daten);

  return {
    dokumentId,
    objektSchluessel,
    bucket,
    mimeTyp: eingabe.mimeTyp,
    groesseBytes: eingabe.daten.length,
    sha256: createHash('sha256').update(eingabe.daten).digest('hex'),
    aufbewahrungBis,
    // Eine unbekannte Pflicht gilt als Pflicht, nie als ihre Abwesenheit (O-25).
    loeschsperre: regel.loeschsperre || regel.istPlatzhalter,
  };
}
