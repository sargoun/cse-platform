/**
 * Die §34a-Hartsperre — SEC-04, LEG-04, im DIENST.
 *
 * SEC-04 verlangt die Sperre in der Dienstschicht und nicht in der
 * Oberflaeche: „assigning a person whose required certificate expires before
 * the shift date fails **in the service**". Deshalb ist das hier die Stelle,
 * die jeder Schreibpfad auf `einsatz_zuordnung` VOR dem Schreiben aufruft, und
 * deshalb wirft sie, statt einen Wahrheitswert zurueckzugeben, den ein
 * Aufrufer vergessen kann.
 *
 * **Drei Schichten, und diese ist die erste.** Die Auswertung selbst steht in
 * `app.einsatz_qualifikation_erfuellt` (Migration `0031`, 03-GEWERKE §9.3) —
 * nicht hier. Das ist Absicht: die Ausloeserpaarung auf `einsatz_zuordnung`
 * ruft dieselbe Funktion, sodass ein Import, ein Migrationsskript oder ein
 * kuenftiger Dienst, der diese Datei vergisst, an derselben Regel scheitert.
 * Zwei Fassungen derselben Pruefung waeren zwei Regeln, sobald eine gepflegt
 * wird.
 *
 * Was dieser Dienst dazugibt, ist das, was eine Datenbank nicht gut kann: eine
 * Meldung auf Deutsch, die sagt, WAS fehlt, und ein typisierter Befund, den die
 * Oberflaeche in PR 33 zu Text (nicht zu Farbe, DESIGN §9) machen kann.
 */

/** Die minimale Abfrageflaeche — dieselbe Form wie in `lead/eskalation.ts`. */
export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

/** Ein einzelner Grund, aus dem die Zuweisung nicht zulaessig ist. */
export interface Fehlgrund {
  /** Gesetzt, wenn eine Qualifikation fehlt oder am Stichtag abgelaufen war. */
  readonly qualifikationId?: string;
  /** Anzeigetext der Anforderung, z. B. „§34a Abs. 1a GewO". */
  readonly rechtsgrundlage?: string | null;
  /** Gesetzt, wenn die Eintragung im Bewacherregister fehlt (SEC-03). */
  readonly bewacherregister?: string;
}

/** Was `app.einsatz_qualifikation_erfuellt` zurueckgibt — der Beweis. */
export interface Torbefund {
  readonly erfuellt: boolean;
  readonly fehlend: readonly Fehlgrund[];
  /**
   * Wie viele Anforderungen ueberhaupt aufgeloest haben.
   *
   * `0` ist **kein Bestehen**, sondern ein meldepflichtiger Zustand (§9.5):
   * die mandantenweite Grundanforderung wird leer ausgeliefert (O-149), also
   * ist „nichts gefunden" heute der Normalfall. Ohne diese Zahl liesse sich in
   * keiner spaeteren Pruefung mehr unterscheiden, ob geprueft und bestanden
   * wurde oder ob es nichts zu pruefen gab.
   */
  readonly anforderungenGefunden: number;
  /** Der Berliner Kalendertag der Schicht, gegen den geprueft wurde (K-11). */
  readonly stichtag: string;
  readonly geprueftAm: string;
}

export class QualifikationFehlt extends Error {
  readonly befund: Torbefund;
  constructor(befund: Torbefund) {
    super(
      `Die Zuweisung ist nach SEC-04/LEG-04 nicht zulässig: ${beschreibe(befund)} `
      + `(geprüft zum Schichtdatum ${befund.stichtag}).`,
    );
    this.name = 'QualifikationFehlt';
    this.befund = befund;
  }
}

/** Deutsch, und benennend — „ungeeignet" sagt niemandem, was zu tun ist. */
function beschreibe(befund: Torbefund): string {
  const teile = befund.fehlend.map((f) =>
    f.bewacherregister !== undefined
      ? 'die Eintragung im Bewacherregister fehlt oder ist erloschen (§34a GewO)'
      : `der erforderliche Nachweis ${f.qualifikationId ?? 'unbekannt'} fehlt oder war am `
        + `Schichtdatum abgelaufen${f.rechtsgrundlage == null ? '' : ` (${f.rechtsgrundlage})`}`,
  );
  return teile.length === 0 ? 'Grund nicht ermittelbar' : teile.join('; ');
}

interface Zeile { befund: unknown }

/**
 * Prueft und MELDET — ohne zu werfen.
 *
 * Fuer die Planungsoberflaeche, die eine Warnung zeigen will, bevor jemand
 * speichert (TIM-05, PR 33), und fuer den naechtlichen Nachlauf, der
 * Zuweisungen erneut bewertet, ohne sie zu entfernen (§11.2).
 */
export async function pruefeZuordnung(
  db: Abfrage, anstellungId: string, einsatzId: string,
): Promise<Torbefund> {
  const zeilen = (await db.unsafe(
    `select app.einsatz_qualifikation_erfuellt($1::uuid, $2::uuid) as befund`,
    [anstellungId, einsatzId],
  )) as readonly Zeile[];

  const roh = zeilen[0]?.befund;
  if (roh === undefined || roh === null) {
    // Kein Befund ist NICHT „erfuellt". Eine Compliancepruefung, die bei
    // fehlender Antwort durchlaesst, ist keine.
    throw new Error(
      'SEC-04: app.einsatz_qualifikation_erfuellt lieferte keinen Befund. '
      + 'Die Zuweisung wird nicht geschrieben.',
    );
  }
  const o = (typeof roh === 'string' ? JSON.parse(roh) : roh) as Record<string, unknown>;
  return {
    erfuellt: o['erfuellt'] === true,
    /**
     * Die Schluessel werden UMBENANNT, nicht durchgereicht.
     *
     * Die Datenbankfassung spricht Schlangenschrift (`qualifikation_id`) —
     * deutsche Domaenenbezeichner, so wie die Spalten heissen. Das Ergebnis
     * eines Dienstes spricht TypeScript. Das jsonb einfach als `Fehlgrund[]`
     * zu behaupten liesse den Typ stimmen und jedes Feld `undefined` sein: ein
     * Fehler, den der Compiler nicht sieht und der sich als leerer Grund in
     * einer Fehlermeldung zeigt.
     */
    fehlend: ((o['fehlend'] ?? []) as readonly Record<string, unknown>[]).map((g) => {
      const grund: { -readonly [K in keyof Fehlgrund]: Fehlgrund[K] } = {};
      if (g['qualifikation_id'] !== undefined) {
        grund.qualifikationId = String(g['qualifikation_id']);
      }
      if (g['rechtsgrundlage'] !== undefined) {
        grund.rechtsgrundlage = g['rechtsgrundlage'] === null
          ? null : String(g['rechtsgrundlage']);
      }
      if (g['bewacherregister'] !== undefined) {
        grund.bewacherregister = String(g['bewacherregister']);
      }
      return grund;
    }),
    anforderungenGefunden: Number(o['anforderungen_gefunden'] ?? 0),
    stichtag: String(o['stichtag'] ?? ''),
    geprueftAm: String(o['geprueft_am'] ?? ''),
  };
}

/**
 * Prueft und SPERRT. Der Aufruf, den jeder Schreibpfad auf
 * `einsatz_zuordnung` vor dem Schreiben macht.
 *
 * Gibt den Befund auch im Erfolgsfall zurueck, damit der Aufrufer ihn in
 * `qualifikation_snapshot` legen kann — der Ausloeser schreibt denselben
 * Beweis noch einmal, und das ist die Absicht: die Zeile traegt ihn dann auch
 * dann, wenn sie an diesem Dienst vorbei entstanden ist.
 */
export async function assertZuordnungZulaessig(
  db: Abfrage, anstellungId: string, einsatzId: string,
): Promise<Torbefund> {
  const befund = await pruefeZuordnung(db, anstellungId, einsatzId);
  if (!befund.erfuellt) throw new QualifikationFehlt(befund);
  return befund;
}
