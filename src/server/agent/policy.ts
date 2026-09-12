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
  | 'bewerbung_antworten' | 'mahnung_senden' | 'rechnung_senden'
  /**
   * BAU-05, § 2 Abs. 6 VOB/B. Eine eigene Aktion, aus demselben Grund wie
   * `behinderung_senden`: die Einreichung eines Nachtrags ist eine
   * Willenserklaerung gegenueber dem Auftraggeber mit Preisfolge, kein
   * Anschreiben. Unter `email_senden` haette eine Richtlinie „Mails duerfen
   * automatisch raus" sie mitgemeint — und damit einen Nachtrag ueber
   * vierzigtausend Euro ohne einen Menschen hinausgelassen.
   */
  | 'nachtrag_einreichen'
  /**
   * BAU-06, § 6 VOB/B. Eine eigene Aktion und nicht `email_senden`: die
   * Behinderungsanzeige geht ueberwiegend NICHT per Mail hinaus, sondern per
   * Einschreiben oder Bote — der Kanal ist Beweisrecht —, und sie ist eine
   * Rechtserklaerung mit anspruchswahrender Wirkung. Unter `email_senden`
   * haette eine Richtlinie „Mails duerfen automatisch raus" sie mitgemeint.
   */
  | 'behinderung_senden';

export const AKTIONEN: readonly Aktion[] = [
  'email_senden', 'angebot_senden', 'social_veroeffentlichen',
  'bewerbung_antworten', 'mahnung_senden', 'rechnung_senden',
  // `nachtrag_einreichen` fehlte hier, obwohl der Typ es fuehrt.
  // `tests/kern/gate.test.ts` laeuft ueber AKTIONEN als den VOLLSTAENDIGEN
  // Konfigurationsraum — die Aktion war damit von der erschoepfenden Pruefung
  // ausgenommen und aus jeder registerbasierten Einstellung. Ein Typ, der
  // mehr kennt als sein Register, macht genau diese Luecke unsichtbar.
  'nachtrag_einreichen', 'behinderung_senden',
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

  /**
   * Eine Behinderungsanzeige geht NIE automatisch raus — wie das Angebot,
   * und aus demselben Grund an derselben Stelle.
   *
   * Sie ist eine empfangsbeduerftige Rechtserklaerung nach § 6 Abs. 1 VOB/B:
   * sie waelzt Verantwortung auf den Auftraggeber ab, wahrt Anspruechte auf
   * Bauzeitverlaengerung und Schadensersatz — und eine zu Unrecht erhobene
   * belastet dieselbe Geschaeftsbeziehung. `02-datenmodell/03-GEWERKE.md`
   * §7.11 ist woertlich: „Dispatch itself runs only through
   * `server/agent/policy.ts` **with human approval**". Die Sperre steht
   * deshalb im Code und nicht als Zeile, die jemand umstellen kann.
   */
  /**
   * Ein Nachtrag geht NIE automatisch raus.
   *
   * **Diese Sperre fehlte, und der Kommentar am Typ oben beschrieb genau den
   * Schaden, den ihr Fehlen ermoeglichte:** unter einer Richtlinie mit
   * `auto_erlaubt = true` antwortete `gate()` mit `erlaubt: true`, und
   * `reicheEin` fuhr durch — ein Nachtrag ueber vierzigtausend Euro ohne
   * einen Menschen, also Invariante 7 gebrochen. Die eigene Aktion zu
   * schaffen war die halbe Arbeit; ohne diesen Zweig war sie nur eine
   * Beschriftung.
   *
   * § 2 Abs. 6 VOB/B: die Einreichung ist eine Willenserklaerung gegenueber
   * dem Auftraggeber mit unmittelbarer Preisfolge. Sie steht deshalb im Code
   * und nicht als Zeile, die jemand in der Oberflaeche umstellen kann — wie
   * das Angebot und die Behinderungsanzeige, aus demselben Grund an
   * derselben Stelle.
   */
  if (nutzlast.aktion === 'nachtrag_einreichen') {
    return {
      erlaubt: false,
      fehler: new FreigabeErforderlich(
        'nachtrag_einreichen',
        'ein Nachtrag ist eine Willenserklaerung nach § 2 Abs. 6 VOB/B mit '
        + 'Preisfolge und geht nie ohne benannten Menschen raus',
      ),
    };
  }

  if (nutzlast.aktion === 'behinderung_senden') {
    return {
      erlaubt: false,
      fehler: new FreigabeErforderlich(
        'behinderung_senden',
        'eine Behinderungsanzeige ist eine Rechtserklaerung nach § 6 Abs. 1 VOB/B '
        + 'und geht nie ohne benannten Menschen raus',
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
