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
  { mime: 'video/mp4', bytes: ASCII('ftyp'), offset: 4 },
  { mime: 'video/quicktime', bytes: ASCII('ftypqt'), offset: 4 },
];

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
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff',
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
