import 'server-only';
import { NichtVerbundenFehler } from '../storage/adapter.js';

/**
 * `MigrationImportPort` — die Uebernahme aus den Altsystemen als
 * SCHNITTSTELLE (07-INTEGRATIONEN §25.3, ROADMAP Phase 10, O-128).
 *
 * **Warum hier ein Port steht und kein Parser.** O-128 ist unbeantwortet: in
 * welchem Format Aplano (Dienstplan und Zeit), Lexware (Buchhaltung) und die
 * bestehenden Excel-Dateien exportieren, welcher Zeitraum uebernommen wird,
 * und ob die historischen Daten revisionssicher ins GoBD-Archiv muessen oder
 * die Aufbewahrung im Altsystem genuegt. Ohne Format gibt es keinen Parser —
 * und ein geratener Parser ist bei Zeitnachweisen nach § 17 MiLoG und bei
 * GoBD-Rechnungen kein Komfortfehler, sondern ein Compliance-Fehler: die
 * Zahlen sehen plausibel aus, und niemand weiss, welche Spalte in welche
 * gelaufen ist.
 *
 * **Die ausgelieferte Umsetzung wirft.** `NichtVerbundenPort` nimmt keine
 * Datei an und gibt keinen Erfolg zurueck. Sie taeuscht damit nichts vor
 * (CLAUDE.md „No fake integrations"), und alles andere laeuft weiter: die
 * Seite zeigt den Zustand, die Tabellen `migration_lauf`/`migration_zeile`
 * (0202) stehen bereit, und der Weg Vorschau → Pruefsumme → Uebernahme ist
 * derselbe wie beim Raumbuch (`services/raumbuch/import.ts`: `pruefe()`,
 * dann `uebernimm()`).
 *
 * **Zwei Regeln stehen schon fest, bevor der Parser existiert**, und sie
 * gehoeren in diese Datei, weil sie den VERTRAG des Ports betreffen:
 *
 *  - **Zeiten kommen als historische Zeilen mit `quelle = 'migration'` und
 *    ohne Serveruhr-Anspruch** (Invariante 5). Die Serveruhr war 2024 nicht
 *    dabei; `zeitabweichung_sek` ist fuer eine uebernommene Zeile nicht
 *    „0", sondern unbekannt. Zu behaupten, die Zeit sei serverseitig
 *    erfasst, waere eine Faelschung des Nachweises.
 *  - **Rechnungen kommen als BELEG und nie in einen `nummernkreis` und nie
 *    in die Hashkette** (`extern_abgeschlossen`). Eine Lexware-Nummer in den
 *    eigenen Kreis zu ziehen erzeugte Luecken oder Doppelnummern, und beides
 *    ist ein GoBD-Befund; die Hashkette einer fremden Rechnung zu bilden
 *    behauptete eine Unveraenderlichkeit, die nie bestand.
 */

/** Die drei Altsysteme aus der ROADMAP. */
export type Altsystem = 'aplano' | 'lexware' | 'excel';

export const ALTSYSTEME: readonly Altsystem[] = ['aplano', 'lexware', 'excel'];

export interface AltsystemBeschreibung {
  readonly schluessel: Altsystem;
  readonly name: string;
  readonly umfang: string;
  /** Was beim Import GELTEN WIRD — nicht, was er heute tut. */
  readonly regel: string;
  readonly offen: string;
}

export const ALTSYSTEM_TEXT: readonly AltsystemBeschreibung[] = [
  {
    schluessel: 'aplano',
    name: 'Aplano',
    umfang: 'Dienstplan und Zeiterfassung',
    regel: 'Übernommene Zeiten sind historische Zeilen mit quelle = „migration" und '
      + 'ohne Anspruch auf die Serveruhr (Invariante 5): die Abweichung zur '
      + 'Gerätezeit ist für sie nicht 0, sondern unbekannt. Sie zählen im '
      + 'Stundenkonto und tragen keine Korrekturhistorie aus dem Altsystem.',
    offen: 'O-128',
  },
  {
    schluessel: 'lexware',
    name: 'Lexware',
    umfang: 'Buchhaltung, Ausgangs- und Eingangsrechnungen',
    regel: 'Übernommene Rechnungen kommen als BELEG. Sie erhalten keine Nummer aus '
      + 'einem eigenen Nummernkreis und hängen nicht in der Hashkette — sie sind '
      + 'extern abgeschlossen. Eine fremde Nummer im eigenen Kreis erzeugte Lücken '
      + 'oder Doppelnummern, und beides ist ein GoBD-Befund.',
    offen: 'O-128',
  },
  {
    schluessel: 'excel',
    name: 'Excel-Dateien',
    umfang: 'Objekt-, Kunden- und Personallisten',
    regel: 'Vorschau vor Übernahme wie beim Raumbuch: Spaltenzuordnung, Fehlerbericht, '
      + 'und erst danach die Übernahme. Eine Datei, deren Spalten niemand zugeordnet '
      + 'hat, wird nicht geraten.',
    offen: 'O-128',
  },
];

export interface UebernahmeVorschau {
  readonly zeilenGesamt: number;
  readonly zeilenGueltig: number;
  readonly zeilenFehlerhaft: number;
  readonly fehlerbericht: readonly { readonly zeile: number; readonly meldung: string }[];
}

export interface MigrationImportPort {
  readonly quelle: Altsystem;
  readonly bezeichnung: string;
  /** `false`, solange kein Format bekannt ist (O-128). */
  readonly verbunden: boolean;
  /**
   * Liest die Datei und meldet, was uebernommen WUERDE — ohne zu uebernehmen.
   * Wirft `NichtVerbundenFehler`, solange es keinen Parser gibt.
   */
  vorschau(datei: Uint8Array, dateiname: string): Promise<UebernahmeVorschau>;
}

/**
 * Die ausgelieferte Umsetzung: sie nimmt nichts an.
 *
 * **Kein `return { zeilenGesamt: 0, … }`.** Eine leere Vorschau saehe wie
 * eine leere Datei aus, und der naechste Schritt waere eine Uebernahme von
 * nichts — mit einer Erfolgsmeldung. Der Wurf ist die ehrliche Antwort, und
 * `NichtVerbundenFehler` traegt sie schon: 409 und der Satz „keine
 * Zugangsdaten konfiguriert", hier: kein Format.
 */
export class NichtVerbundenPort implements MigrationImportPort {
  readonly verbunden = false as const;

  constructor(readonly quelle: Altsystem, readonly bezeichnung: string) {}

  vorschau(): Promise<UebernahmeVorschau> {
    return Promise.reject(new NichtVerbundenFehler(
      `Die Übernahme aus ${this.bezeichnung}`));
  }
}

/**
 * Der Port je Altsystem.
 *
 * Eine Funktion und keine Konstante, damit der Tag, an dem O-128 beantwortet
 * ist, genau EINE Stelle betrifft: hier wird der echte Port zurueckgegeben,
 * und Seite, Dienst und Tabellen bleiben, wie sie sind.
 */
export function migrationPort(quelle: Altsystem): MigrationImportPort {
  const text = ALTSYSTEM_TEXT.find((a) => a.schluessel === quelle);
  return new NichtVerbundenPort(quelle, text?.name ?? quelle);
}
