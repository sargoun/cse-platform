/**
 * Die Fehler der Autorisierung — und warum es so wenige sind.
 *
 * `03-AUTH-BERECHTIGUNGEN.md` und AUT-06: eine Anfrage auf eine fremde oder
 * unerlaubte Ressource antwortet **404**, mit einem Körper, der Byte für Byte
 * dem eines wirklich fehlenden Datensatzes gleicht. Ein 403 sagt "das gibt es,
 * du darfst nur nicht" — und das ist genau die Auskunft, die eine
 * Aufzählungsattacke braucht: fremde Kundennummern durchprobieren, bis der
 * Statuscode von 404 auf 403 springt.
 *
 * Deshalb gibt es hier keinen `ForbiddenError` für Ressourcen. 403 bleibt den
 * Fällen vorbehalten, in denen die Existenz ohnehin bekannt ist: das eigene
 * gesperrte Konto (AUT-07) und die fehlende zweite Stufe (AUT-02).
 */

/** Die eine Antwort auf "nicht da" UND auf "nicht erlaubt" (AUT-06). */
export class NichtGefundenFehler extends Error {
  readonly status = 404 as const;
  readonly code = 'NICHT_GEFUNDEN' as const;
  constructor(
    /** Nur fürs Protokoll — er verlässt den Server nie. */
    readonly intern?: string,
  ) {
    super('Nicht gefunden');
    this.name = 'NichtGefundenFehler';
  }
}

/** Keine gültige Sitzung. 401, weil hier nichts über eine Ressource verraten wird. */
export class NichtAngemeldetFehler extends Error {
  readonly status = 401 as const;
  readonly code = 'NICHT_ANGEMELDET' as const;
  constructor() {
    super('Nicht angemeldet');
    this.name = 'NichtAngemeldetFehler';
  }
}

/** AUT-02 — die Sitzung ist `aal1`, verlangt ist `aal2`. */
export class ZweiterFaktorFehler extends Error {
  readonly status = 403 as const;
  readonly code = 'ZWEITER_FAKTOR_ERFORDERLICH' as const;
  constructor() {
    super('Zweiter Faktor erforderlich');
    this.name = 'ZweiterFaktorFehler';
  }
}

/** AUT-07 — das eigene Konto ist gesperrt. Einheitlicher Text. */
export class KontoGesperrtFehler extends Error {
  readonly status = 403 as const;
  readonly code = 'KONTO_GESPERRT' as const;
  constructor() {
    super('Konto gesperrt');
    this.name = 'KontoGesperrtFehler';
  }
}

export class ZuVieleVersucheFehler extends Error {
  readonly status = 429 as const;
  readonly code = 'ZU_VIELE_VERSUCHE' as const;
  constructor() {
    super('Zu viele Versuche');
    this.name = 'ZuVieleVersucheFehler';
  }
}

/**
 * Der Körper, den 404 zurückgibt — **eine** Konstante.
 *
 * Byte-identisch für "gibt es nicht" und "gehört jemand anderem". Zwei
 * Stellen, die ihn je selbst zusammensetzen, weichen irgendwann in einem
 * Leerzeichen voneinander ab, und ein Leerzeichen ist ein Orakel.
 */
export const NICHT_GEFUNDEN_KOERPER = Object.freeze({
  fehler: 'NICHT_GEFUNDEN',
  nachricht: 'Nicht gefunden.',
});
