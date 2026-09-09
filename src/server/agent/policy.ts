/**
 * Das Ausgangs-Gate (Invariante 7, APR-07, AGT-03, LEG-08).
 *
 * **Nichts verlaesst das System ohne menschliche Freigabe.** Das ist keine
 * Konvention, sondern ein einziger Engpass: jeder Versand geht durch `gate`,
 * und ein Repo-Waechter bricht den Build, wenn irgendein Modul ausserhalb von
 * `versand` einen Mailtransport oder einen HTTP-Sender importiert.
 *
 * Drei Eigenschaften, und jede hat einen Ausfall dahinter:
 *
 *  - **Fail-closed.** Ohne konfigurierte Richtlinie verweigert das Gate. Eine
 *    fehlende Regel ist keine Erlaubnis; sonst waere der Tag, an dem jemand
 *    die Konfiguration loescht, der Tag mit den meisten automatischen Mails.
 *  - **LEG-08 ist ein HARTES Tor.** Ein Kontakt ohne Rechtsgrundlage wird
 *    abgewiesen, **ungeachtet jeder Freigabe** — § 7 UWG ist nicht etwas, das
 *    ein Mensch per Klick ausser Kraft setzt.
 *  - **Der Hash bindet die Freigabe an die Nutzlast.** Wer nach der Freigabe
 *    den Text aendert, hat keine Freigabe mehr fuer das, was er sendet.
 */
import { createHash } from 'node:crypto';

export type Aktion =
  | 'email_senden' | 'angebot_senden' | 'social_veroeffentlichen'
  | 'bewerbung_antworten' | 'mahnung_senden' | 'rechnung_senden';

export const AKTIONEN: readonly Aktion[] = [
  'email_senden', 'angebot_senden', 'social_veroeffentlichen',
  'bewerbung_antworten', 'mahnung_senden', 'rechnung_senden',
];

/** § 7 UWG: ohne aufgezeichnete Rechtsgrundlage kein Kontakt. */
export type Rechtsgrundlage =
  | 'einwilligung' | 'vertrag' | 'berechtigtes_interesse' | 'bestandskunde' | 'keine';

export interface Nutzlast {
  readonly aktion: Aktion;
  readonly mandantId: string;
  /** Der Empfaenger, sofern es einen gibt (Social-Posts haben keinen). */
  readonly empfaengerRechtsgrundlage?: Rechtsgrundlage;
  /** Bei Angeboten: der Betrag in Cent. */
  readonly betragCent?: bigint;
  /** Der Inhalt, der gesendet wird — Grundlage des Hashes. */
  readonly inhalt: Record<string, unknown>;
}

/** Eine Zeile aus `agent_richtlinie`. */
export interface Richtlinie {
  readonly mandantId: string;
  readonly aktion: Aktion;
  /** Darf ohne menschliche Freigabe gesendet werden? */
  readonly autoErlaubt: boolean;
  /** Bis zu welchem Betrag (Cent), falls anwendbar. `null` = kein Limit gesetzt. */
  readonly maxBetragCent: bigint | null;
  readonly ist_aktiv: boolean;
}

export interface Freigabe {
  readonly id: string;
  readonly aktion: Aktion;
  readonly mandantId: string;
  readonly status: 'offen' | 'genehmigt' | 'abgelehnt';
  readonly freigegebenVon: string | null;
  /** SHA-256 der kanonischen Nutzlast zum Zeitpunkt der Freigabe. */
  readonly nutzlastHash: string;
}

export class FreigabeErforderlich extends Error {
  readonly code = 'FREIGABE_ERFORDERLICH' as const;
  constructor(aktion: Aktion, grund: string) {
    super(`${aktion} verlangt eine menschliche Freigabe: ${grund}`);
    this.name = 'FreigabeErforderlich';
  }
}

export class RechtsgrundlageFehlt extends Error {
  readonly code = 'RECHTSGRUNDLAGE_FEHLT' as const;
  constructor() {
    super(
      'Der Kontakt hat keine aufgezeichnete Rechtsgrundlage (§ 7 UWG, LEG-08). '
      + 'Das ist ein hartes Tor: auch eine erteilte Freigabe hebt es nicht auf.',
    );
    this.name = 'RechtsgrundlageFehlt';
  }
}

/**
 * Der Hash der Nutzlast — stabil ueber Schluesselreihenfolge.
 *
 * Ohne Sortierung haetten zwei gleiche Nutzlasten verschiedene Hashes, je
 * nachdem in welcher Reihenfolge jemand die Felder gesetzt hat, und jede
 * Freigabe waere zufaellig ungueltig.
 */
export function nutzlastHash(nutzlast: Nutzlast): string {
  const kanonisch = JSON.stringify({
    aktion: nutzlast.aktion,
    mandantId: nutzlast.mandantId,
    betragCent: nutzlast.betragCent === undefined ? null : String(nutzlast.betragCent),
    inhalt: sortiere(nutzlast.inhalt),
  });
  return createHash('sha256').update(kanonisch, 'utf8').digest('hex');
}

function sortiere(wert: unknown): unknown {
  if (Array.isArray(wert)) return wert.map(sortiere);
  if (wert !== null && typeof wert === 'object') {
    const o = wert as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortiere(o[k])]));
  }
  return typeof wert === 'bigint' ? String(wert) : wert;
}

export type GateErgebnis =
  | { readonly erlaubt: true; readonly grund: 'freigabe' | 'richtlinie' }
  | { readonly erlaubt: false; readonly fehler: Error };

/**
 * Die eine Entscheidung.
 *
 * Reihenfolge: LEG-08 zuerst, weil es durch nichts aufgehoben wird. Dann die
 * Freigabe, dann die Richtlinie — eine gueltige menschliche Freigabe schlaegt
 * jede Automatik, und die Automatik entscheidet nur, wo keine Freigabe noetig
 * ist.
 */
export function gate(
  nutzlast: Nutzlast,
  freigabe: Freigabe | null,
  richtlinie: Richtlinie | null,
): GateErgebnis {
  // 1 — LEG-08. Hart, und vor allem anderen.
  if (nutzlast.empfaengerRechtsgrundlage === 'keine') {
    return { erlaubt: false, fehler: new RechtsgrundlageFehlt() };
  }

  // 2 — eine menschliche Freigabe, die zu DIESER Nutzlast gehoert.
  if (freigabe !== null) {
    if (freigabe.status !== 'genehmigt') {
      return {
        erlaubt: false,
        fehler: new FreigabeErforderlich(nutzlast.aktion, `Freigabe ist ${freigabe.status}`),
      };
    }
    if (freigabe.freigegebenVon === null) {
      return {
        erlaubt: false,
        fehler: new FreigabeErforderlich(nutzlast.aktion, 'genehmigt ohne benannten Menschen'),
      };
    }
    if (freigabe.nutzlastHash !== nutzlastHash(nutzlast)) {
      // Wer nach der Freigabe den Text aendert, hat keine Freigabe mehr fuer
      // das, was er sendet.
      return {
        erlaubt: false,
        fehler: new FreigabeErforderlich(
          nutzlast.aktion, 'die Nutzlast wurde nach der Freigabe geaendert (Hash-Abweichung)',
        ),
      };
    }
    if (freigabe.aktion !== nutzlast.aktion || freigabe.mandantId !== nutzlast.mandantId) {
      return {
        erlaubt: false,
        fehler: new FreigabeErforderlich(nutzlast.aktion, 'die Freigabe gehoert zu etwas anderem'),
      };
    }
    return { erlaubt: true, grund: 'freigabe' };
  }

  // 3 — ohne Freigabe entscheidet die Richtlinie. Fehlt sie: nein.
  if (richtlinie === null || !richtlinie.ist_aktiv) {
    return {
      erlaubt: false,
      fehler: new FreigabeErforderlich(
        nutzlast.aktion,
        'keine aktive Richtlinie konfiguriert — eine fehlende Regel ist keine Erlaubnis',
      ),
    };
  }
  if (!richtlinie.autoErlaubt) {
    return {
      erlaubt: false,
      fehler: new FreigabeErforderlich(nutzlast.aktion, 'die Richtlinie verlangt eine Freigabe'),
    };
  }

  /**
   * Ein Angebot wird NIE automatisch gesendet — unabhaengig von jeder
   * Richtlinie und von jedem Betrag.
   *
   * Ein Angebot ist ein bindendes Vertragsangebot (§ 145 BGB). Der Betrag ist
   * dabei nicht das Kriterium: eine Schwelle laedt dazu ein, sie zu erhoehen,
   * bis sie nichts mehr bedeutet. Deshalb steht die Sperre hier im Code und
   * nicht als Zahl in einer Zeile, die jemand aendern kann.
   */
  if (nutzlast.aktion === 'angebot_senden') {
    return {
      erlaubt: false,
      fehler: new FreigabeErforderlich(
        'angebot_senden',
        'ein Angebot ist ein bindendes Vertragsangebot (§ 145 BGB) und geht nie automatisch raus',
      ),
    };
  }

  if (richtlinie.maxBetragCent !== null && nutzlast.betragCent !== undefined
      && nutzlast.betragCent > richtlinie.maxBetragCent) {
    return {
      erlaubt: false,
      fehler: new FreigabeErforderlich(nutzlast.aktion, 'ueber dem Betragslimit der Richtlinie'),
    };
  }

  return { erlaubt: true, grund: 'richtlinie' };
}
