/**
 * Das Dienstregister — welcher Dienst schreibt, und in welchem Modul.
 *
 * Es existiert für die Zusage von PR 8: **in der Gruppenansicht führt kein
 * Schreibpfad**. Diese Zusage über eine Liste zu prüfen, die jemand pflegt,
 * wäre eine Erinnerung; über ein Register geprüft ist sie eine Eigenschaft.
 * Der Test iteriert dieses Register, also ist ein Modul, das in Phase 5 landet,
 * automatisch mitgeprüft — vorausgesetzt, es trägt sich hier ein, und genau
 * das erzwingt der Gegentest (jeder Dienst unter `services/` steht im
 * Register).
 */

export interface DienstEintrag {
  /** Der Modulname aus §7.4 — Basis des Rechteschlüssels. */
  readonly modul: string;
  /** Der Dateipfad unter `src/server/services/`, ohne Endung. */
  readonly pfad: string;
  /** Schreibt dieser Dienst? Nur-Lese-Dienste dürfen in der Gruppenansicht laufen. */
  readonly schreibend: boolean;
  /** Der Rechteschlüssel, den der Schreibpfad verlangt. */
  readonly schreibRecht?: string;
}

export const DIENSTE: readonly DienstEintrag[] = [
  { modul: 'finanzen', pfad: 'finanz/geld', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/steuer/satz', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/hash-chain', schreibend: false },
  {
    modul: 'nummernkreis', pfad: 'finanz/nummernkreis',
    schreibend: true, schreibRecht: 'nummernkreis.ziehen',
  },
  { modul: 'finanzen', pfad: 'finanz/menge', schreibend: false },
  /**
   * Die Kalkulation LIEST — sie schreibt nichts. Der Preis, den sie
   * ausrechnet, wird erst vom Angebot gespeichert, und das ist der Dienst,
   * der dann sein Schreibrecht nennt. Solange die Rechnung selbst nichts
   * ablegt, gilt sie auch in der Gruppenansicht als unbedenklich.
   */
  { modul: 'objekt', pfad: 'kalkulation/richtzeit', schreibend: false },
  { modul: 'objekt', pfad: 'kalkulation/tarif', schreibend: false },
  { modul: 'objekt', pfad: 'kalkulation/raumbuch', schreibend: false },
  { modul: 'objekt', pfad: 'kalkulation/index', schreibend: false },
  /**
   * Die BESTAETIGUNG schreibt dagegen: sie setzt die Werte, auf denen der
   * Preis ruht, und hebt `ist_platzhalter`. Deshalb nennt sie ihr Recht.
   */
  {
    modul: 'objekt', pfad: 'kalkulation/bestaetigung',
    schreibend: true, schreibRecht: 'kalkulation.schreiben',
  },
  /**
   * Der Angebotsdienst SCHREIBT — und sein Recht ist `angebot.versenden`,
   * nicht `angebot.schreiben`: der Uebergang, der etwas aus dem Haus laesst,
   * ist der, der ein eigenes Recht braucht (Invariante 7).
   */
  {
    modul: 'angebot', pfad: 'angebot/index',
    schreibend: true, schreibRecht: 'angebot.versenden',
  },
  /**
   * Der Tabellenleser liest nur; der Import SCHREIBT — und zwar zweimal
   * verschieden: die Vorschau legt Zwischenzeilen an, die Uebernahme aendert
   * das lebende Raumbuch. Beide tragen dasselbe Recht, weil beide eine Datei
   * in den Mandanten bringen.
   */
  { modul: 'objekt_import', pfad: 'raumbuch/tabelle', schreibend: false },
  {
    modul: 'objekt_import', pfad: 'raumbuch/import',
    schreibend: true, schreibRecht: 'objekt_import.schreiben',
  },
  { modul: 'zeit', pfad: 'zeit/dauer', schreibend: false },
  { modul: 'zeit', pfad: 'zeit/spalten', schreibend: false },
  { modul: 'dienstplan', pfad: 'zeit/arbzg', schreibend: false },
  { modul: 'dokument', pfad: 'dokument/kategorie', schreibend: false },
  {
    modul: 'dokument', pfad: 'dokument/upload',
    schreibend: true, schreibRecht: 'dokument.schreiben',
  },
  { modul: 'referenz', pfad: 'inhalt/seite', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/nap', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/routen', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/referenz', schreibend: false },
  {
    modul: 'referenz', pfad: 'inhalt/import',
    schreibend: true, schreibRecht: 'referenz.schreiben',
  },
  // SEO-Oberflächen. Sie lesen veröffentlichte Zeilen und sonst nichts —
  // in der Gruppenansicht ist daran nichts gefährlich.
  { modul: 'referenz', pfad: 'inhalt/jsonld', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/sitemap', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/llms', schreibend: false },
  // Lead und Formular. Die Annahme SCHREIBT — sie ist der einzige Dienst
  // dieser Domäne, den ein anonymer Aufrufer auslöst.
  { modul: 'crm', pfad: 'lead/sla', schreibend: false },
  {
    modul: 'formular', pfad: 'lead/annahme',
    schreibend: true, schreibRecht: 'formular.schreiben',
  },
  {
    modul: 'crm', pfad: 'lead/eskalation',
    schreibend: true, schreibRecht: 'crm.schreiben',
  },
  {
    modul: 'versand', pfad: 'lead/bestaetigung',
    schreibend: true, schreibRecht: 'crm.kommunikation_versenden',
  },
  { modul: 'crm', pfad: 'lead/benachrichtigung', schreibend: false },
  // Kennzahlen. Sie ZÄHLEN — in der Gruppenansicht ist daran nichts
  // gefährlich, und schreiben können sie nicht.
  { modul: 'bericht', pfad: 'bericht/kacheln', schreibend: false },
  { modul: 'bericht', pfad: 'bericht/dashboard', schreibend: false },
] as const;

/**
 * `src/server/jobs/**` steht bewusst NICHT im Dienstregister.
 *
 * Jobs laufen als `cse_job`, nicht als `cse_app`, und nie in einer
 * Benutzersitzung — die Frage "ist dieser Dienst in der Gruppenansicht
 * erreichbar" hat fuer sie keine Bedeutung. Sie in dieselbe Liste zu legen
 * hiesse, sie gegen eine Zusage zu pruefen, die ueber sie nichts aussagt.
 */

export const SCHREIBENDE_DIENSTE: readonly DienstEintrag[] =
  DIENSTE.filter((d) => d.schreibend);
