import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * **Ein Demodokument, das sich als solches ausweist** (V-131, D-623).
 *
 * Ohne Dateispeicher legte der Seed nur die Metadaten der Unterlagen an —
 * ehrlich, aber auf dem Vorführrechner führte jeder Klick auf „Öffnen" ins
 * Leere. Mit dem Vorführspeicher liegt jetzt eine Datei hinter der Zeile.
 *
 * Sie tut nicht so, als wäre sie die Unterlage der Gesellschaft: die erste
 * Zeile unter dem Titel sagt „DEMODATEN", und der Inhalt ist die
 * Beschreibung aus der Datenbankzeile — nichts, was jemand für eine echte
 * Betriebsanweisung halten könnte.
 *
 * Nur Schriften aus dem PDF-Grundbestand (Helvetica, WinAnsi): Umlaute und
 * ß sind darin enthalten, und eine eingebettete Schrift wäre für ein
 * Platzhalterblatt Ballast.
 */
export async function demoPdf(titel: string, zeilen: readonly string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(titel);
  doc.setProducer('CSE-Plattform — Demodaten');
  /* Feste Zeiten: ein zweiter Seedlauf erzeugt dieselben Bytes. */
  doc.setCreationDate(new Date(Date.UTC(2026, 0, 1)));
  doc.setModificationDate(new Date(Date.UTC(2026, 0, 1)));
  const seite = doc.addPage([595.28, 841.89]);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  seite.drawText(titel, { x: 56, y: 770, size: 16, font: fett, color: rgb(0.07, 0.07, 0.09) });
  seite.drawText('DEMODATEN — kein Dokument der Gesellschaft, nur für die Vorführung.',
    { x: 56, y: 746, size: 10, font: fett, color: rgb(0.6, 0.35, 0.02) });
  let y = 716;
  for (const zeile of zeilen) {
    seite.drawText(zeile, { x: 56, y, size: 11, font: normal, color: rgb(0.2, 0.2, 0.24) });
    y -= 18;
  }
  return doc.save({ useObjectStreams: false });
}
