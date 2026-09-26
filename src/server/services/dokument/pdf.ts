/**
 * Ein Textschreiben als PDF — klein, echt, und ausdruecklich KEIN Satzsystem.
 *
 * **Warum es das gibt.** BAU-06 verlangt, dass eine Behinderungsanzeige „als
 * Dokument archiviert" wird, und ein `dokument` dieser Plattform IST eine
 * Datei im privaten Bucket: Spalte `objekt_schluessel`, geprueftes MIME,
 * Groesse, SHA-256 (DOC-01, DOC-03). Ein Archiv ohne Datei waere ein
 * Datenbankeintrag, der behauptet, es gebe eines. Also entsteht hier eine
 * ECHTE PDF-Datei — keine Attrappe, kein „nicht verbunden"-Ersatz, keine
 * fremde Bibliothek.
 *
 * **Was es ausdruecklich NICHT ist.** Die Rechnungs-PDF (FIN-11, DESIGN §11)
 * und ZUGFeRD/PDF-A-3 (FIN-12) sind ein eigener Weg mit Logo, Registergericht
 * und einer veraPDF-Pruefung in der CI. Dieser Schreiber kann eine Schrift,
 * eine Spalte und keinen Umbruch nach Zeichenbreite. Wer ihn fuer eine
 * Rechnung benutzt, hat die falsche Datei erzeugt.
 *
 * **Die zwei Stellen, an denen eine Eigenbau-PDF ueblicherweise kaputtgeht:**
 *
 *  1. **Die `xref`-Tabelle haelt BYTE-Offsets.** Wer den Dateikopf spaeter
 *     noch anfasst, verschiebt jeden Offset dahinter, und kein Leser oeffnet
 *     die Datei mehr. Deshalb wird hier zeichenweise aufgebaut und die
 *     Offsets werden waehrend des Aufbaus gemessen, nie danach geschaetzt.
 *  2. **Die Zeichenkodierung.** `WinAnsiEncoding` ist cp1252, nicht Latin-1:
 *     „ " — § sind genau die Zeichen, die ein deutsches Schreiben braucht,
 *     und genau die, die in Latin-1 fehlen. Sie werden unten abgebildet; was
 *     sich nicht abbilden laesst, wird GEZAEHLT und nicht stillschweigend
 *     ersetzt — ein Schreiben an den Auftraggeber mit stummen Fragezeichen
 *     darin ist ein Mangel, den der Absender kennen muss.
 */

/** Die cp1252-Sonderzeichen zwischen 0x80 und 0x9F, die Latin-1 nicht hat. */
const CP1252_SONDER: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

/**
 * **Zeichen, die in cp1252 fehlen, aber dort ein GLEICHBEDEUTENDES haben**
 * (V-131, gefunden vom Seed mit Vorführspeicher).
 *
 * Word, Pages und jede Tastatur mit Typografie setzen „−5 °C" mit einem
 * echten Minuszeichen (U+2212) und oft einem schmalen Leerzeichen davor. Der
 * Schreiber zählte das als „nicht darstellbar", und `dokumentiereVersand`
 * brach eine Behinderungsanzeige deshalb zu Recht ab — nur war der Grund
 * keiner: ein Minuszeichen IST ein Bindestrich-Minus, ein schmales
 * Leerzeichen IST ein Leerzeichen. Ein Mensch, der das Schreiben liest, sieht
 * keinen Unterschied, und der Wortlaut ändert sich nicht.
 *
 * Die Liste ist geschlossen und klein, und sie enthält NUR Zeichen gleicher
 * Bedeutung. Was eine andere Bedeutung hätte — ein arabischer Name, ein
 * kyrillischer Buchstabe, ein Pfeil — bleibt „nicht darstellbar" und wird
 * weiter gezählt: dort wäre jede Ersetzung eine Änderung des Schreibens.
 */
const GLEICHWERTIG: Readonly<Record<string, string>> = {
  '\u2212': '-',       // MINUS SIGN → HYPHEN-MINUS
  '\u2010': '-',       // HYPHEN
  '\u2011': '-',       // NON-BREAKING HYPHEN
  '\u2012': '\u2013',  // FIGURE DASH → EN DASH
  '\u2009': ' ',       // THIN SPACE
  '\u200A': ' ',       // HAIR SPACE
  '\u2007': '\u00A0',  // FIGURE SPACE → NO-BREAK SPACE
  '\u202F': '\u00A0',  // NARROW NO-BREAK SPACE → NO-BREAK SPACE
  '\u2002': ' ',       // EN SPACE
  '\u2003': ' ',       // EM SPACE
};

export interface WinAnsiErgebnis {
  readonly bytes: readonly number[];
  /** Wie viele Zeichen nicht darstellbar waren. `0` ist die Zusage. */
  readonly ersetzt: number;
}

/** Ein Text in WinAnsi-Bytes — mit der Zahl der Zeichen, die nicht gingen. */
export function nachWinAnsi(text: string): WinAnsiErgebnis {
  const bytes: number[] = [];
  let ersetzt = 0;
  for (const roh of text) {
    const zeichen = GLEICHWERTIG[roh] ?? roh;
    const punkt = zeichen.codePointAt(0) ?? 0x3f;
    const sonder = CP1252_SONDER[zeichen];
    if (sonder !== undefined) bytes.push(sonder);
    else if (punkt <= 0xff && !(punkt >= 0x80 && punkt <= 0x9f)) bytes.push(punkt);
    else { bytes.push(0x3f); ersetzt += 1; }
  }
  return { bytes, ersetzt };
}

/** `(`, `)` und `\` sind in einem PDF-String Steuerzeichen. */
function maskiere(bytes: readonly number[]): number[] {
  const heraus: number[] = [];
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) heraus.push(0x5c);
    heraus.push(b);
  }
  return heraus;
}

/**
 * Bricht auf eine feste ZEICHENZAHL um, nicht auf eine Breite.
 *
 * Helvetica ist proportional, eine echte Umbruchrechnung braeuchte die
 * Breitentabelle der Schrift. Fuer ein Schreiben ist der Zeichenumbruch
 * ausreichend und — wichtiger — er ist vorhersagbar: derselbe Text ergibt
 * dieselbe Datei, und der SHA-256 im `dokument` bleibt reproduzierbar.
 */
export function umbrich(text: string, spalten = 88): readonly string[] {
  const zeilen: string[] = [];
  for (const absatz of text.split('\n')) {
    if (absatz === '') { zeilen.push(''); continue; }
    let rest = absatz;
    while (rest.length > spalten) {
      let schnitt = rest.lastIndexOf(' ', spalten);
      if (schnitt <= 0) schnitt = spalten;
      zeilen.push(rest.slice(0, schnitt));
      rest = rest.slice(schnitt).replace(/^ +/u, '');
    }
    zeilen.push(rest);
  }
  return zeilen;
}

export interface PdfEingabe {
  readonly titel: string;
  /** Der Fliesstext. Zeilenumbrueche werden uebernommen. */
  readonly text: string;
}

export interface PdfErgebnis {
  readonly bytes: Uint8Array;
  /** `0`, wenn jedes Zeichen darstellbar war. */
  readonly ersetzteZeichen: number;
  readonly seiten: number;
}

/** A4 in PostScript-Punkten, Rand 56 pt (≈ 2 cm). */
const SEITE_BREITE = 595;
const SEITE_HOEHE = 842;
const RAND = 56;
const SCHRIFTGROESSE = 10;
const ZEILENHOEHE = 14;
const ZEILEN_JE_SEITE = Math.floor((SEITE_HOEHE - 2 * RAND - 24) / ZEILENHOEHE);

/**
 * Erzeugt das PDF.
 *
 * Der Aufbau ist bewusst geradeaus: Katalog, Seitenbaum, eine Schrift, je
 * Seite ein Seitenobjekt und ein Inhaltsstrom. Danach die `xref` aus den
 * gemessenen Offsets und der Trailer.
 */
export function schreibeTextPdf(eingabe: PdfEingabe): PdfErgebnis {
  const kopfzeile = nachWinAnsi(eingabe.titel);
  const rumpf = nachWinAnsi(eingabe.text);
  const ersetzteZeichen = kopfzeile.ersetzt + rumpf.ersetzt;

  const alleZeilen = umbrich(eingabe.text);
  const seiten: (readonly string[])[] = [];
  for (let i = 0; i < Math.max(alleZeilen.length, 1); i += ZEILEN_JE_SEITE) {
    seiten.push(alleZeilen.slice(i, i + ZEILEN_JE_SEITE));
  }

  /** Objekt 1 Katalog, 2 Seitenbaum, 3 Schrift, danach je Seite zwei. */
  const ersteSeite = 4;
  const seitenIds = seiten.map((_, i) => ersteSeite + i * 2);
  const objekte: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${seitenIds.map((n) => `${String(n)} 0 R`).join(' ')}] `
      + `/Count ${String(seiten.length)} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
  ];

  const stroeme: number[][] = [];
  seiten.forEach((zeilen, i) => {
    const inhalt: number[] = [];
    const schreibe = (s: string): void => {
      for (const b of nachWinAnsi(s).bytes) inhalt.push(b);
    };
    schreibe('BT\n/F1 12 Tf\n');
    schreibe(`${String(RAND)} ${String(SEITE_HOEHE - RAND)} Td\n`);
    if (i === 0) {
      inhalt.push(0x28);
      for (const b of maskiere(kopfzeile.bytes)) inhalt.push(b);
      inhalt.push(0x29);
      schreibe(' Tj\n');
    }
    schreibe(`/F1 ${String(SCHRIFTGROESSE)} Tf\n${String(ZEILENHOEHE)} TL\n`);
    schreibe(`0 ${String(-ZEILENHOEHE * (i === 0 ? 2 : 1))} Td\n`);
    for (const zeile of zeilen) {
      inhalt.push(0x28);
      for (const b of maskiere(nachWinAnsi(zeile).bytes)) inhalt.push(b);
      inhalt.push(0x29);
      schreibe(' Tj T*\n');
    }
    schreibe('ET\n');
    stroeme.push(inhalt);

    objekte.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(SEITE_BREITE)} `
      + `${String(SEITE_HOEHE)}] /Resources << /Font << /F1 3 0 R >> >> `
      + `/Contents ${String(ersteSeite + i * 2 + 1)} 0 R >>`,
    );
    objekte.push(`STROM:${String(i)}`);
  });

  const teile: number[] = [];
  const anhaengen = (s: string): void => {
    for (const b of nachWinAnsi(s).bytes) teile.push(b);
  };

  anhaengen('%PDF-1.4\n');
  // Ein Binaerkommentar direkt nach dem Kopf: so behandelt jedes Werkzeug die
  // Datei als binaer und nicht als Text, das sonst Zeilenenden umschreibt.
  teile.push(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a);

  const offsets: number[] = [];
  objekte.forEach((objekt, index) => {
    offsets.push(teile.length);
    const nummer = index + 1;
    anhaengen(`${String(nummer)} 0 obj\n`);
    if (objekt.startsWith('STROM:')) {
      const strom = stroeme[Number(objekt.slice(6))] ?? [];
      anhaengen(`<< /Length ${String(strom.length)} >>\nstream\n`);
      for (const b of strom) teile.push(b);
      anhaengen('\nendstream\n');
    } else {
      anhaengen(`${objekt}\n`);
    }
    anhaengen('endobj\n');
  });

  const xrefStart = teile.length;
  anhaengen(`xref\n0 ${String(objekte.length + 1)}\n`);
  anhaengen('0000000000 65535 f \n');
  for (const offset of offsets) {
    anhaengen(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  anhaengen(
    `trailer\n<< /Size ${String(objekte.length + 1)} /Root 1 0 R >>\n`
    + `startxref\n${String(xrefStart)}\n%%EOF\n`,
  );

  return { bytes: Uint8Array.from(teile), ersetzteZeichen, seiten: seiten.length };
}
