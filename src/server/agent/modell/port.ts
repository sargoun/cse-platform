import 'server-only';

/**
 * Der Modell-Port — **eine Fähigkeit rein, ein Ergebnis raus** (§8).
 *
 * **Der Aufrufer nennt nie ein Modell.** Wer `gpt-4o` schreibt, hat die
 * Residenzfrage umgangen, bevor sie gestellt wurde; wer `entwurf_text`
 * verlangt, bekommt entweder ein freigegebenes Modell oder ein ehrliches
 * Nein. Welches Modell das ist, entscheidet `modell_register` (0154) — die
 * einzige Stelle, an der ein Modell aufrufbar wird.
 *
 * **Und der Port gibt Text zurück, nie Zahlen.** Invariante 6: die Zahlen
 * kommen aus geprüften Funktionen in `server/services/`, der Port setzt Sätze
 * darum. Ein Modell, das rechnet, ist ein Modell, das irgendwann falsch
 * rechnet — und niemand merkt es, weil die Antwort plausibel aussieht.
 */

export type Faehigkeit =
  | 'chat_intern' | 'entwurf_text' | 'extraktion_dokument' | 'extraktion_beleg'
  | 'klassifikation' | 'embedding' | 'vision';

/** Warum ein Aufruf nicht stattfand — die Gründe aus §8, ohne stille Vierte. */
export type ModellFehlerCode =
  | 'RESIDENCY_BLOCKED' | 'NOT_CONNECTED' | 'RATE_LIMITED' | 'TIMEOUT'
  | 'INVALID_RESPONSE' | 'BUDGET_EXCEEDED' | 'AUTH_FAILED';

export class ModellFehler extends Error {
  constructor(readonly code: ModellFehlerCode, nachricht: string) {
    super(nachricht);
    this.name = 'ModellFehler';
  }
}

/** Was ein Aufruf an Belegen mitbringt — je Schritt protokolliert (AGT-05). */
export interface ModellVerbrauch {
  readonly modell: string;
  readonly tokensEingabe: number;
  readonly tokensAusgabe: number;
  readonly dauerMs: number;
}

export interface TextAuftrag {
  /** Die Rolle, in der das Modell schreibt — nie frei vom Aufrufer gewählt. */
  readonly vorlage: string;
  /**
   * Die Tatsachen, aus denen formuliert wird: schon gerechnet, schon geprüft.
   * Der Port erfindet nichts dazu und rechnet nichts nach.
   */
  readonly tatsachen: Readonly<Record<string, string>>;
  /** Sprache der Ausgabe — die Plattform schreibt Deutsch, solange nichts anderes steht. */
  readonly sprache?: 'de' | 'en';
}

export interface TextErgebnis {
  readonly text: string;
  readonly verbrauch: ModellVerbrauch;
}

export interface EinbettungErgebnis {
  readonly vektor: readonly number[];
  readonly verbrauch: ModellVerbrauch;
}

/**
 * Der Port selbst. Zwei Methoden, weil die Plattform heute zwei Dinge braucht:
 * einen Entwurf formulieren und eine Passage einbetten. Ein dritter Aufruf
 * („und jetzt rechne mir das aus") gehört nicht hierher, sondern in einen
 * Dienst mit einem Test.
 */
export interface ModellPort {
  readonly anbieter: string;
  readonly modell: string;
  entwerfe(auftrag: TextAuftrag): Promise<TextErgebnis>;
  bette(text: string): Promise<EinbettungErgebnis>;
}
