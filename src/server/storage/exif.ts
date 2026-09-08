/**
 * EXIF entfernen (TIM-10, LEG-10, SEC-A6).
 *
 * Ein Foto vom Einsatzort trägt GPS-Koordinaten, Gerätenummer und Uhrzeit.
 * Das Erste ist ein Standortdatum eines Menschen bei der Arbeit — LEG-10
 * mitbestimmungspflichtig, und nichts, das nebenbei in einem Anhang
 * mitreisen darf, weil das Telefon es hineingeschrieben hat.
 *
 * Entfernt wird auf den BYTES, die gespeichert werden, nicht als Markierung in
 * der Datenbank: ein Flag beschreibt eine Absicht, ein fehlendes Segment ist
 * eine Tatsache. Der Test prüft entsprechend die gespeicherten Bytes.
 */

/** JPEG-Segmente, die Metadaten tragen und ersatzlos entfallen. */
const ZU_ENTFERNEN = new Set([
  0xe1, // APP1 — EXIF, XMP
  0xe2, // APP2 — Flashpix, ICC-Fragmente von Kameras
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec,
  0xed, // APP13 — Photoshop IRB, enthält IPTC
  0xee, 0xef,
  0xfe, // COM — Kommentar
]);

export interface ExifErgebnis {
  readonly bytes: Uint8Array;
  /** War überhaupt etwas zu entfernen? */
  readonly entfernt: boolean;
}

/**
 * JPEG: Segmente durchlaufen und die metadatentragenden auslassen.
 *
 * Bewusst kein Neucodieren des Bildes. Ein Re-Encode entfernt Metadaten
 * zuverlässig — und verändert die Pixel, womit das Foto als Beweis in einer
 * Reklamation an Wert verliert. Die Bilddaten (`SOS` und alles danach) bleiben
 * Byte für Byte unangetastet.
 */
function jpegOhneMetadaten(daten: Uint8Array): ExifErgebnis {
  if (daten[0] !== 0xff || daten[1] !== 0xd8) return { bytes: daten, entfernt: false };

  const teile: Uint8Array[] = [daten.subarray(0, 2)];
  let i = 2;
  let entfernt = false;

  while (i + 3 < daten.length) {
    if (daten[i] !== 0xff) break;                 // kein Marker mehr — abbrechen
    const marker = daten[i + 1]!;

    // SOS: ab hier kommen die komprimierten Bilddaten bis zum Ende.
    if (marker === 0xda) { teile.push(daten.subarray(i)); i = daten.length; break; }

    const laenge = (daten[i + 2]! << 8) | daten[i + 3]!;
    if (laenge < 2 || i + 2 + laenge > daten.length) break;

    if (ZU_ENTFERNEN.has(marker)) entfernt = true;
    else teile.push(daten.subarray(i, i + 2 + laenge));

    i += 2 + laenge;
  }
  if (i < daten.length) teile.push(daten.subarray(i));

  const gesamt = teile.reduce((n, t) => n + t.length, 0);
  const raus = new Uint8Array(gesamt);
  let pos = 0;
  for (const t of teile) { raus.set(t, pos); pos += t.length; }
  return { bytes: raus, entfernt };
}

/**
 * PNG: `eXIf`, `tEXt`, `iTXt`, `zTXt` und `tIME` entfallen.
 *
 * PNG ist eine Kette aus Chunks mit Länge, Typ, Daten und CRC — die
 * unerwünschten lassen sich herausnehmen, ohne die übrigen zu berühren.
 */
function pngOhneMetadaten(daten: Uint8Array): ExifErgebnis {
  const RAUS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
  const teile: Uint8Array[] = [daten.subarray(0, 8)];
  let i = 8;
  let entfernt = false;

  while (i + 8 <= daten.length) {
    const laenge = (daten[i]! << 24) | (daten[i + 1]! << 16) | (daten[i + 2]! << 8) | daten[i + 3]!;
    const typ = String.fromCharCode(daten[i + 4]!, daten[i + 5]!, daten[i + 6]!, daten[i + 7]!);
    const ende = i + 12 + laenge;
    if (laenge < 0 || ende > daten.length) break;

    if (RAUS.has(typ)) entfernt = true;
    else teile.push(daten.subarray(i, ende));

    i = ende;
    if (typ === 'IEND') break;
  }

  const gesamt = teile.reduce((n, t) => n + t.length, 0);
  const raus = new Uint8Array(gesamt);
  let pos = 0;
  for (const t of teile) { raus.set(t, pos); pos += t.length; }
  return { bytes: raus, entfernt };
}

/** Trägt dieser Typ überhaupt Metadaten, die entfernt werden müssen? */
export function brauchtBereinigung(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('video/') || mime === 'application/pdf';
}

export class ExifFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'ExifFehler'; }
}

/**
 * Entfernt Metadaten, oder wirft.
 *
 * Für Video und PDF gibt es hier **keine** Implementierung, und deshalb wird
 * abgelehnt statt durchgereicht: ein Video, das ungeprüft mit GPS gespeichert
 * wird, weil die Funktion es nicht konnte, ist genau die stille Preisgabe, die
 * TIM-10 verhindern soll. Lieber ein benannter Fehler beim Upload als ein
 * Standortdatum im Anhang.
 *
 * // TODO(client): O-25 — ob Videoanhänge überhaupt gebraucht werden; bis dahin
 * // wird `video/*` abgelehnt statt ungereinigt gespeichert.
 */
/**
 * PDF: Metadatenwerte werden ÜBERSCHRIEBEN, nicht entfernt.
 *
 * Ein PDF ist keine Segmentkette, sondern eine Objekttabelle mit Byte-Offsets
 * in der `xref`. Ein Segment herauszuschneiden verschiebt jeden Offset
 * dahinter und macht die Datei kaputt — beim Rechnungsarchiv wäre das der
 * teuerste denkbare Weg, Metadaten loszuwerden.
 *
 * Deshalb wird gleich LANG überschrieben: der `/Info`-Eintrag und der
 * XMP-Block behalten ihre Bytezahl und verlieren ihren Inhalt. Alle Offsets
 * bleiben gültig, das Dokument öffnet sich unverändert, und Autor, Gerät und
 * Zeitstempel sind weg.
 *
 * // TODO(client): O-25 — verschlüsselte PDFs und solche, deren Metadaten in
 * // komprimierten Objektströmen liegen, werden hiervon nicht erreicht. Sie
 * // werden unten ABGELEHNT statt ungeprüft gespeichert; ob der Mandant sie
 * // überhaupt hochlädt, ist offen.
 */
const PDF_FELDER = [
  'Author', 'Creator', 'Producer', 'Title', 'Subject', 'Keywords',
  'CreationDate', 'ModDate', 'GPSLatitude', 'GPSLongitude',
];

function pdfOhneMetadaten(daten: Uint8Array): ExifErgebnis {
  const kopie = new Uint8Array(daten);
  const text = Buffer.from(daten).toString('latin1');
  let entfernt = false;

  /** Überschreibt [von, bis) mit Leerzeichen — gleiche Länge, kein Offset bewegt sich. */
  const leere = (von: number, bis: number): void => {
    for (let i = von; i < bis && i < kopie.length; i += 1) kopie[i] = 0x20;
    entfernt = true;
  };

  for (const feld of PDF_FELDER) {
    const muster = new RegExp(`/${feld}\\s*\\(([^)]*)\\)`, 'gu');
    for (const t of text.matchAll(muster)) {
      const start = t.index + t[0].indexOf('(') + 1;
      leere(start, start + (t[1] ?? '').length);
    }
  }

  // XMP: der Inhalt zwischen den Klammern, nicht die Klammern selbst.
  for (const t of text.matchAll(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/gu)) {
    leere(t.index, t.index + t[0].length);
  }

  return { bytes: kopie, entfernt };
}

/** Trägt dieses PDF Metadaten, die dieser Weg nicht erreicht? */
function pdfUnerreichbar(daten: Uint8Array): boolean {
  const text = Buffer.from(daten.subarray(0, Math.min(daten.length, 1_000_000)))
    .toString('latin1');
  // Verschlüsselte Dokumente: der /Info-Eintrag liegt dann als Chiffrat vor.
  return /\/Encrypt\b/u.test(text);
}

export function entferneMetadaten(daten: Uint8Array, mime: string): ExifErgebnis {
  if (!brauchtBereinigung(mime)) return { bytes: daten, entfernt: false };
  if (mime === 'image/jpeg') return jpegOhneMetadaten(daten);
  if (mime === 'image/png') return pngOhneMetadaten(daten);
  if (mime === 'application/pdf') {
    if (pdfUnerreichbar(daten)) {
      throw new ExifFehler(
        'Das PDF ist verschlüsselt; seine Metadaten sind für die Bereinigung nicht '
        + 'erreichbar. Abgelehnt, statt Geräte- und Zeitdaten ungeprüft zu speichern.',
      );
    }
    return pdfOhneMetadaten(daten);
  }
  throw new ExifFehler(
    `Für ${mime} gibt es keine Metadaten-Bereinigung. Der Upload wird abgelehnt, `
    + 'statt Standort- und Gerätedaten ungeprüft zu speichern (TIM-10, LEG-10).',
  );
}
