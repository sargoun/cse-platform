/**
 * Typerkennung über MAGIC BYTES, nie über den Namen und nie über das, was der
 * Browser behauptet (SEC-A6, DOC-05).
 *
 * `Content-Type` kommt vom Client. Die Dateiendung kommt vom Client. Beides
 * ist eine Behauptung, und eine `.exe`, die `rechnung.pdf` heisst und sich als
 * `application/pdf` ausgibt, ist genau der Fall, für den die Prüfung existiert.
 * Massgeblich ist ausschliesslich, was in den ersten Bytes steht.
 */

export class MimeFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'unbekannt' | 'nicht_erlaubt' | 'widerspruch' | 'leer',
  ) {
    super(nachricht);
    this.name = 'MimeFehler';
  }
}

interface Signatur {
  readonly mime: string;
  readonly bytes: readonly (number | null)[];
  /** Offset, an dem die Signatur beginnt. */
  readonly offset?: number;
  /** Zusätzliche Prüfung, wenn die Signatur allein mehrdeutig ist. */
  readonly zusatz?: (daten: Uint8Array) => boolean;
}

const ASCII = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/**
 * Die erlaubten Typen. Eine geschlossene Liste, und das ist der Punkt: was
 * nicht darauf steht, wird abgelehnt — nicht durchgereicht, weil es harmlos
 * aussieht.
 */
const SIGNATUREN: readonly Signatur[] = [
  { mime: 'application/pdf', bytes: ASCII('%PDF-') },
  /*
   * XML — die E-Rechnung (XRechnung als UBL/CII, ZUGFeRD-Anhang) ist seit
   * 2025 im B2B-Geschaeft die Rechnung selbst (§ 14 UStG, ACC-05). Erkannt am
   * Prolog, mit oder ohne Byte-Order-Mark; ein XML ohne Prolog beginnt mit
   * seiner Wurzel und wird ueber `zusatz` angenommen, wenn die erste Marke
   * eine der bekannten Wurzeln ist.
   */
  { mime: 'application/xml', bytes: ASCII('<?xml') },
  { mime: 'application/xml', bytes: [0xef, 0xbb, 0xbf, ...ASCII('<?xml')] },
  { mime: 'application/xml', bytes: ASCII('<'), zusatz: (d) => istERechnungWurzel(d) },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', bytes: ASCII('GIF8') },
  { mime: 'image/webp', bytes: ASCII('WEBP'), offset: 8 },
  { mime: 'image/tiff', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { mime: 'image/tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  // ZIP-Container. Die OOXML-Formate teilen ihn sich; welcher es ist, sagt
  // erst der Inhalt — deshalb der Zusatz.
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: [0x50, 0x4b, 0x03, 0x04],
    zusatz: (d) => enthaelt(d, 'word/'),
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: [0x50, 0x4b, 0x03, 0x04],
    zusatz: (d) => enthaelt(d, 'xl/'),
  },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  /**
   * **Die Reihenfolge dieser drei ist die Erkennung, nicht ihre Deko.**
   *
   * Alle drei sind ISO-BMFF-Container und beginnen bei Offset 4 mit `ftyp`;
   * unterschieden werden sie erst durch die MARKE dahinter. `find` nimmt den
   * ersten Treffer, also muss die spezifischste Signatur zuerst stehen. Stand
   * `video/mp4` (nur `ftyp`) vorn, wurde jede `.mov` und jedes iPhone-Foto als
   * `video/mp4` erkannt — und `pruefeUpload` wies den Upload dann als
   * „Widerspruch" ab, obwohl Inhalt und Deklaration übereinstimmten. Das ist
   * die unangenehme Sorte Fehler: die Datei ist in Ordnung, die Meldung
   * beschuldigt sie, und niemand sucht in der Reihenfolge einer Liste.
   */
  { mime: 'image/heic', bytes: ASCII('ftyp'), offset: 4, zusatz: (d) => istHeicMarke(d) },
  { mime: 'video/quicktime', bytes: ASCII('ftypqt'), offset: 4 },
  { mime: 'video/mp4', bytes: ASCII('ftyp'), offset: 4 },
];

/**
 * Die HEIF-Marken, die ein Telefon in `ftyp` schreibt. `mif1` und `msf1` sind
 * die generischen HEIF-Marken; die Bildvarianten heissen `heic`/`heix`/`heim`,
 * die Sequenzvarianten `hevc`/`hevx`.
 */
const HEIC_MARKEN = ['heic', 'heix', 'heim', 'hevc', 'hevx', 'mif1', 'msf1'];

const ERECHNUNG_WURZELN = ['Invoice', 'CreditNote', 'CrossIndustryInvoice'];

function istERechnungWurzel(daten: Uint8Array): boolean {
  const kopf = String.fromCharCode(...daten.slice(0, 256));
  const marke = /^\s*<(?:[A-Za-z0-9_]+:)?([A-Za-z]+)[\s>]/u.exec(kopf)?.[1];
  return marke !== undefined && ERECHNUNG_WURZELN.includes(marke);
}

function istHeicMarke(daten: Uint8Array): boolean {
  if (daten.length < 12) return false;
  const marke = String.fromCharCode(daten[8]!, daten[9]!, daten[10]!, daten[11]!);
  return HEIC_MARKEN.includes(marke);
}

function enthaelt(daten: Uint8Array, text: string): boolean {
  const muster = ASCII(text);
  const grenze = Math.min(daten.length, 4096);
  for (let i = 0; i + muster.length <= grenze; i += 1) {
    if (muster.every((b, j) => daten[i + j] === b)) return true;
  }
  return false;
}

function passt(daten: Uint8Array, s: Signatur): boolean {
  const off = s.offset ?? 0;
  if (daten.length < off + s.bytes.length) return false;
  const kopf = s.bytes.every((b, i) => b === null || daten[off + i] === b);
  if (!kopf) return false;
  return s.zusatz === undefined || s.zusatz(daten);
}

/** Der verifizierte Typ, oder `null`, wenn keine Signatur greift. */
export function erkenneMime(daten: Uint8Array): string | null {
  return SIGNATUREN.find((s) => passt(daten, s))?.mime ?? null;
}

/** Was in einer Kategorie überhaupt hochgeladen werden darf. */
export const ERLAUBTE_MIME: readonly string[] = [
  'application/pdf', 'application/xml',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff',
  // image/heic steht bewusst NICHT hier — siehe exif.ts und O-346.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'video/mp4', 'video/quicktime',
];

export interface PruefErgebnis {
  readonly mime: string;
  readonly verifiziert: true;
}

/**
 * Prüft den Upload und gibt den VERIFIZIERTEN Typ zurück.
 *
 * `behauptet` fliesst nicht in das Ergebnis ein — es wird nur verglichen, um
 * einen Widerspruch benennen zu können. Ein Upload, der als PDF deklariert ist
 * und eine ausführbare Datei enthält, wird nicht "als das erkannt, was er
 * wirklich ist" und dann gespeichert: er wird abgelehnt.
 */
export function pruefeUpload(daten: Uint8Array, behauptet?: string): PruefErgebnis {
  if (daten.length === 0) throw new MimeFehler('Leere Datei.', 'leer');

  const erkannt = erkenneMime(daten);
  if (erkannt === null) {
    throw new MimeFehler(
      'Der Dateityp liess sich anhand des Inhalts nicht bestimmen und wird abgelehnt.',
      'unbekannt',
    );
  }
  if (!ERLAUBTE_MIME.includes(erkannt)) {
    throw new MimeFehler(`Dateityp ${erkannt} ist nicht zugelassen.`, 'nicht_erlaubt');
  }
  if (behauptet !== undefined && behauptet !== '' && behauptet !== erkannt) {
    throw new MimeFehler(
      `Der Inhalt ist ${erkannt}, deklariert war ${behauptet}. Abgelehnt.`,
      'widerspruch',
    );
  }
  return { mime: erkannt, verifiziert: true };
}

/** 256 MB — die technische Obergrenze aus dem Datenmodell. */
export const MAX_BYTES = 268_435_456;

export function pruefeGroesse(daten: Uint8Array): void {
  if (daten.length === 0) throw new MimeFehler('Leere Datei.', 'leer');
  if (daten.length > MAX_BYTES) {
    throw new MimeFehler(
      `${daten.length} Bytes überschreiten die Grenze von ${MAX_BYTES}.`, 'nicht_erlaubt',
    );
  }
}
