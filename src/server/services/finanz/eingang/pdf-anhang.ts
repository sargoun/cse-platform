import {
  PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream,
} from 'pdf-lib';

/**
 * Die eingebettete E-Rechnung eines PDF — ZUGFeRD/Factur-X (`factur-x.xml`)
 * oder eine XRechnung als Anhang (ACC-05, PR 63).
 *
 * **Kein OCR.** Ein PDF ohne eingebettete XML hat hier kein Ergebnis; die
 * Belegerkennung fuer gescannte Rechnungen braucht einen Anbieter, der noch
 * nicht bestimmt ist (O-135), und dieses Modul erfindet keinen. Es liest nur,
 * was der Aussteller selbst strukturiert mitgegeben hat — die Dateien, die
 * seit 2025 im B2B-Geschaeft ohnehin die Rechnung SIND (§ 14 UStG).
 *
 * Gelesen wird mit demselben `pdf-lib`, das die eigene ZUGFeRD-Ausgabe baut
 * (`zugferd/pdfa3.ts`): die Dateispezifikationen des Dokuments (`/Filespec`)
 * mit einem der bekannten Namen, der Strom dahinter, entpackt ueber
 * `decodePDFRawStream` — denselben Filtern, die der Schreiber benutzt.
 */

/** Die Namen, unter denen die Normen die Datei fuehren — Gross-/Kleinschreibung egal. */
export const ERECHNUNG_DATEINAMEN: readonly string[] = [
  'factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'invoice.xml',
];

export interface EingebetteteERechnung {
  readonly dateiname: string;
  readonly xml: string;
}

function textAus(wert: unknown): string | null {
  if (wert instanceof PDFString || wert instanceof PDFHexString) return wert.decodeText();
  return null;
}

/**
 * Findet die erste eingebettete E-Rechnung — oder `null`, wenn das PDF keine
 * traegt. Wirft, wenn die Datei kein PDF ist.
 */
export async function eingebetteteERechnung(pdf: Uint8Array): Promise<EingebetteteERechnung | null> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
  for (const [, objekt] of doc.context.enumerateIndirectObjects()) {
    if (!(objekt instanceof PDFDict)) continue;
    const typ = objekt.get(PDFName.of('Type'));
    if (typ !== PDFName.of('Filespec')) continue;
    const name = textAus(objekt.get(PDFName.of('UF'))) ?? textAus(objekt.get(PDFName.of('F')));
    if (name === null) continue;
    if (!ERECHNUNG_DATEINAMEN.includes(name.toLowerCase())) continue;
    const ef = objekt.get(PDFName.of('EF'));
    if (!(ef instanceof PDFDict)) continue;
    const stromRef = ef.get(PDFName.of('UF')) ?? ef.get(PDFName.of('F'));
    const strom = stromRef === undefined ? undefined : doc.context.lookup(stromRef);
    if (!(strom instanceof PDFRawStream)) continue;
    const bytes = decodePDFRawStream(strom).decode();
    return { dateiname: name, xml: new TextDecoder('utf-8').decode(bytes) };
  }
  return null;
}
