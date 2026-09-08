/** Invariante 10 — kein Schreibpfad ohne genau einen aktiven Mandanten. */
export class KeinAktiverMandantFehler extends Error {
  readonly status = 409 as const;
  readonly code = 'KEIN_AKTIVER_MANDANT' as const;
  constructor(was?: string) {
    super(
      'Kein aktiver Mandant. In der Gruppen-, Mitarbeiter- und Kundenansicht gibt es '
      + `per Konstruktion keinen${was === undefined ? '' : ` (${was})`}.`,
    );
    this.name = 'KeinAktiverMandantFehler';
  }
}
