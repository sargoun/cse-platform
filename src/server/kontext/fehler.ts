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

/**
 * Ein Login ohne `person` kann das Mitarbeiterportal nicht betreten.
 *
 * Nicht "sieht nichts", sondern kommt nicht hinein: der Personen-Scope liest
 * ueber `app.aktuelle_person()`, und ohne diese Zeile waere die Antwort auf
 * jede Abfrage eine leere Menge — ununterscheidbar von "dieser Mensch hat
 * keine Schichten". Ein Fehler sagt, was los ist; eine leere Liste luegt.
 */
export class KeinePersonFehler extends Error {
  readonly status = 403 as const;
  readonly code = 'KEINE_PERSON' as const;
  constructor() {
    super(
      'Diese Anmeldung ist keiner Person zugeordnet. Das Mitarbeiterportal liest '
      + 'über `person_id`; ohne sie gibt es nichts zu lesen — und das ist kein '
      + 'leerer Dienstplan, sondern ein fehlender Bezug.',
    );
    this.name = 'KeinePersonFehler';
  }
}

/**
 * Der Kundenzugang ist noch nicht gebaut (`kunde_zugang`, Phase 4).
 *
 * `app.sichtbare_mandanten()` gibt im Kunden-Scope heute `'{}'` zurueck — fail
 * closed und ausdruecklich so dokumentiert. Ein Kundenportal, das darauf
 * lauter leere Listen zeigte, saehe aus wie ein Kunde ohne Auftraege. Es
 * verweigert deshalb den Eintritt, bis es die Zeilen wirklich gibt.
 */
export class KeinKundenzugangFehler extends Error {
  readonly status = 403 as const;
  readonly code = 'KEIN_KUNDENZUGANG' as const;
  constructor() {
    super(
      'Kein Kundenzugang. `kunde_zugang` entsteht mit dem CRM-Modul (Phase 4); '
      + 'bis dahin sieht der Kunden-Scope per Konstruktion keine Zeile.',
    );
    this.name = 'KeinKundenzugangFehler';
  }
}
