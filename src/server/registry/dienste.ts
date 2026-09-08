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
  { modul: 'zeit', pfad: 'zeit/dauer', schreibend: false },
  { modul: 'zeit', pfad: 'zeit/spalten', schreibend: false },
  { modul: 'dienstplan', pfad: 'zeit/arbzg', schreibend: false },
] as const;

export const SCHREIBENDE_DIENSTE: readonly DienstEintrag[] =
  DIENSTE.filter((d) => d.schreibend);
