/**
 * Der Raumbuch-Import — was er annimmt, was er abweist, und warum (V-171,
 * OPS-04, D-665, D-592).
 *
 * **Die Grenze steht auf der Seite, nicht erst in der Abweisung.** Der Import
 * liest CSV; Excel-Dateien liest er nicht, weil die Plattform keine geprüfte
 * Bibliothek dafür mitbringt (O-919). Wer das erst nach dem Hochladen
 * erfährt, hat umsonst gesucht — deshalb sagt es der Satz über dem Dateifeld,
 * mit dem Weg, der funktioniert.
 *
 * **Fachbegriffe bleiben deutsch** (`Raumbuch`), erklärt in Klammern.
 */
import type { InternSprache } from '../intern.js';

export interface RaumbuchImportTexte {
  /** Die Grenze, über dem Dateifeld. */
  readonly nurCsv: string;
  /** Wie man aus Excel eine CSV macht, die ankommt. */
  readonly ausExcel: string;
  readonly nichtsGeaendert: string;
  /** Die Abweisungen der Route, je Schlüssel. */
  readonly fehler: Readonly<Record<string, string>>;
  /** Die verschobene Zeile nennt ihre Nummer. */
  readonly feldzahlInZeile: (zeile: string) => string;
}

export const RAUMBUCH_IMPORT_TEXTE: Readonly<Record<InternSprache, RaumbuchImportTexte>> = {
  de: {
    nurCsv:
      'Gelesen werden CSV-Dateien. Excel-Arbeitsmappen (.xlsx, .xls) und .ods liest der '
      + 'Import nicht: dafür bringt die Plattform keine geprüfte Bibliothek mit, und ein '
      + 'halber Leser, der Formeln und zusammengefasste Zellen übersieht, wäre schlimmer '
      + 'als keiner (O-919).',
    ausExcel:
      'Aus Excel: „Datei › Speichern unter › CSV (Trennzeichen-getrennt)" oder „CSV UTF-8". '
      + 'Beide kommen an — auch die Windows-Zeichenkodierung, die ein deutsches Excel für '
      + 'CSV wählt.',
    nichtsGeaendert: 'Es wurde nichts geprüft und nichts geändert.',
    fehler: {
      excel:
        'Das ist eine Excel- oder Tabellenkalkulationsdatei, keine CSV. Bitte in Excel als '
        + 'CSV speichern und diese Datei hochladen.',
      zu_gross: 'Die Datei ist größer als 5 MB.',
      unvollstaendig: 'Es fehlte die Datei oder das Objekt.',
      leer: 'Die Datei ist leer.',
      kopfzeile: 'Die erste Zeile muss die Spaltenköpfe tragen — sie ist leer.',
      anfuehrung:
        'Ein Anführungszeichen wurde nicht geschlossen — die Datei lässt sich nicht sicher '
        + 'lesen.',
      format: 'Die Datei ließ sich nicht als Raumbuch lesen.',
      feldzahl:
        'Eine Zeile hat mehr oder weniger Felder als die Kopfzeile — die Datei ist '
        + 'verschoben.',
      schon_uebernommen: 'Dieser Import ist bereits übernommen.',
    },
    feldzahlInZeile: (zeile) =>
      `Zeile ${zeile} hat mehr oder weniger Felder als die Kopfzeile — die Datei ist `
      + 'verschoben. Gelesen wurde nichts.',
  },
  en: {
    nurCsv:
      'CSV files are read. Excel workbooks (.xlsx, .xls) and .ods are not: the platform '
      + 'does not ship a vetted library for them, and a half reader that overlooks formulas '
      + 'and merged cells would be worse than none (O-919).',
    ausExcel:
      'From Excel: “File › Save As › CSV (Comma delimited)” or “CSV UTF-8”. Both arrive — '
      + 'including the Windows character encoding that a German Excel picks for CSV.',
    nichtsGeaendert: 'Nothing was checked and nothing was changed.',
    fehler: {
      excel:
        'This is an Excel or spreadsheet file, not a CSV. Please save it as CSV in Excel and '
        + 'upload that file.',
      zu_gross: 'The file is larger than 5 MB.',
      unvollstaendig: 'The file or the Objekt (site) was missing.',
      leer: 'The file is empty.',
      kopfzeile: 'The first row must carry the column headings — it is empty.',
      anfuehrung: 'A quotation mark was not closed — the file cannot be read safely.',
      format: 'The file could not be read as a Raumbuch (room book).',
      feldzahl:
        'A row has more or fewer fields than the header row — the file is shifted.',
      schon_uebernommen: 'This import has already been applied.',
    },
    feldzahlInZeile: (zeile) =>
      `Row ${zeile} has more or fewer fields than the header row — the file is shifted. `
      + 'Nothing was read.',
  },
};
