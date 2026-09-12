/**
 * Die Nummernvergabe (FIN-03) — `05-FINANZEN.md` §3.3, §5.6.
 *
 * Zwei Entscheidungen tragen alles andere:
 *
 * **1. Der Kreis wird auf dem OFFENEN Schlüssel gesucht, nie über das heutige
 * Jahr.** `(mandant_id, kreis_typ, kontext_id) WHERE geschlossen_am IS NULL`.
 * Das ist die Falle, die die Vorgabe ausdrücklich benennt: ein Kreis mit
 * `zuruecksetzung = 'nie'` trägt `jahr = 0`, eine Suche nach `jahr = 2026`
 * findet ihn nicht, und die Festschreibung scheitert für genau die
 * Gesellschaften, die über Jahre durchnummerieren. Ein eindeutiger Index
 * garantiert, dass höchstens ein Kreis je Geltungsbereich offen ist.
 *
 * **2. `SELECT … FOR UPDATE`, kein `nextval`.** Eine Sequenz rollt nicht
 * zurück: wer eine Nummer zieht und abbricht, hinterlässt eine Lücke, und
 * §14 UStG duldet keine. Die Zeilensperre serialisiert die Vergabe — das ist
 * der Preis und zugleich der ganze Zweck.
 *
 * Was hier NICHT steht: der Rechnungskreis. Dessen Zug läuft in
 * `fin.rechnung_nummer_ziehen` (SECURITY DEFINER, PR 46), weil `cse_app` unter
 * FORCE RLS gar keine Zeile trifft — ein anwendungsseitiger Zug würde
 * geräuschlos nichts tun und keine Rechnung würde je festgeschrieben.
 */

/**
 * Ein Ausschnitt der `postgres.js`-API — die Schicht bindet keinen Treiber.
 *
 * Bewusst untypisiert im Rückgabewert: `postgres.js` liefert ein `RowList`,
 * und ein generisches `Promise<T>` hier würde sich mit dessen `then`-Signatur
 * beissen. Die Form der Zeilen wird eine Ebene tiefer festgelegt, an genau
 * einer Stelle.
 */
export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

/** Die eine Stelle, an der eine Abfrage ihre Zeilenform bekommt. */
async function zeilen<T>(
  tx: Abfrage,
  anweisung: string,
  werte: readonly unknown[] = [],
): Promise<readonly T[]> {
  return (await tx.unsafe(anweisung, werte)) as readonly T[];
}

export const KREIS_TYPEN = [
  'ausgangsrechnung', 'gutschrift', 'eingangsrechnung_beleg', 'mahnung',
  'angebot', 'auftrag', 'leistungsnachweis', 'wachbuch', 'kassenbuch',
] as const;
export type KreisTyp = (typeof KREIS_TYPEN)[number];

/** Die Kreise, die NICHT über diesen Weg gezogen werden (§5.6). */
export const DEFINER_KREISE: readonly KreisTyp[] = ['ausgangsrechnung', 'gutschrift'];

export class NummernkreisFehler extends Error {
  constructor(
    nachricht: string,
    /** Benannt, damit der Aufrufer unterscheiden kann, statt zu raten. */
    readonly grund:
      | 'kein_kreis'
      | 'platzhalter'
      | 'geschlossen'
      | 'definer_kreis'
      | 'maske_ungueltig',
  ) {
    super(nachricht);
    this.name = 'NummernkreisFehler';
  }
}

export interface KreisSchluessel {
  readonly kreisTyp: KreisTyp;
  /** NULL für einen gesellschaftsweiten Kreis; gesetzt für `wachbuch`. */
  readonly kontextId?: string | null;
}

export interface VergebeneNummer {
  readonly nummernkreisId: string;
  /** Der rohe Zählerstand. */
  readonly nummer: number;
  /** Die formatierte Nummer, aus `format_maske` aufgelöst. */
  readonly formatiert: string;
  /** `kette_position` des Satzes, der diese Nummer trägt — gleich `nummer`. */
  readonly kettePosition: number;
  readonly letzterHash: string | null;
  readonly genesisHash: string | null;
}

interface KreisZeile {
  readonly id: string;
  readonly naechste_nummer: string;
  readonly format_maske: string;
  readonly jahr: number;
  readonly ist_platzhalter: boolean;
  /** Als `YYYY-MM-DD` aus SQL geholt, nicht als Date. Der Treiber liefert
   *  sonst ein JS-`Date`, dessen Textform von der Zeitzone des Servers
   *  abhängt — in einer Fehlermeldung, die ein Mensch liest, wäre das ein
   *  Datum, das je nach Maschine anders aussieht. */
  readonly geschlossen_am: string | null;
  readonly letzter_hash: string | null;
  readonly genesis_hash: string | null;
}

/**
 * Löst `RE-{jahr}-{nr:5}` auf.
 *
 * Hier und nicht an der Aufrufstelle: eine Maske, die per String-Verkettung
 * zusammengesetzt wird, ist an jeder Stelle ein bisschen anders, und die
 * Rechnungsnummer ist der eine Wert, der überall identisch sein muss.
 *
 * `{jahr}` ist das Jahr DES KREISES, nicht das heutige. Bei `jahr = 0`
 * (fortlaufend) gibt es kein Jahr einzusetzen, und eine Maske, die es
 * verlangte, ist ein Fehler statt einer stillen `0`.
 */
export function formatiereNummer(maske: string, nummer: number, jahr: number): string {
  const offen = /\{([a-z]+)(?::(\d+))?\}/gu;
  let fehler: string | null = null;

  const ergebnis = maske.replace(offen, (_treffer, feld: string, breite: string | undefined) => {
    if (feld === 'nr') {
      const b = breite === undefined ? 0 : Number(breite);
      return String(nummer).padStart(b, '0');
    }
    if (feld === 'jahr') {
      if (jahr === 0) {
        fehler = 'Die Maske verlangt {jahr}, der Kreis läuft aber fortlaufend (jahr = 0).';
        return '';
      }
      return String(jahr);
    }
    fehler = `Unbekannter Platzhalter {${feld}} in der Maske.`;
    return '';
  });

  if (fehler !== null) throw new NummernkreisFehler(fehler, 'maske_ungueltig');
  if (!maske.includes('{nr}') && !/\{nr:\d+\}/u.test(maske)) {
    throw new NummernkreisFehler(
      'Die Maske enthält kein {nr} — jede Nummer wäre dieselbe.',
      'maske_ungueltig',
    );
  }
  return ergebnis;
}

/**
 * Zieht die nächste Nummer und bewegt den Zähler um genau eins.
 *
 * Läuft in der Transaktion des Aufrufers — das ist die Zusage: bricht sie ab,
 * bleibt der Zähler stehen. Ein `tx`, das keine Transaktion ist, macht die
 * Lückenlosigkeit zunichte, weshalb der Aufrufer eine übergeben MUSS und diese
 * Funktion keine eigene öffnet.
 */
export async function vergebeNummer(
  tx: Abfrage,
  schluessel: KreisSchluessel,
): Promise<VergebeneNummer> {
  const { kreisTyp, kontextId = null } = schluessel;

  if (DEFINER_KREISE.includes(kreisTyp)) {
    throw new NummernkreisFehler(
      `\`${kreisTyp}\` wird über fin.rechnung_nummer_ziehen gezogen, nicht von der Anwendung: `
      + 'cse_app hält auf diesem Kreis keine UPDATE-Policy, ein Zug hier träfe null Zeilen '
      + 'und keine Rechnung würde je festgeschrieben (§5.6).',
      'definer_kreis',
    );
  }

  // Zwei Schritte, und die Reihenfolge ist der Grund, warum `d_kreis_lesen`
  // innerhalb des Mandanten UNBESCHRÄNKT ist (§1.1): erst DIAGNOSE, dann
  // Sperre. Würde direkt mit `FOR UPDATE` unter der Zugriffs-Policy gesucht,
  // wäre ein Platzhalter oder ein geschlossener Kreis schlicht unsichtbar —
  // und der Aufrufer bekäme "kein Kreis" statt "dieser Kreis ist noch nicht
  // bestätigt". Ein benannter Fehler ist der Unterschied zwischen einer
  // Meldung, auf die jemand handeln kann, und einem leeren Bildschirm.
  const kandidaten = await zeilen<KreisZeile>(
    tx,
    `select id, naechste_nummer, format_maske, jahr, ist_platzhalter,
            to_char(geschlossen_am, 'YYYY-MM-DD') as geschlossen_am,
            letzter_hash, genesis_hash
       from nummernkreis
      where mandant_id = app.aktiver_mandant()
        and kreis_typ = $1::nummernkreis_typ
        and kontext_id is not distinct from $2::uuid
      -- Absteigend, damit die erste Zeile der ZULETZT geschlossene Kreis ist.
      -- Aufsteigend nannte die Fehlermeldung unten „geschlossen seit …" das
      -- Datum des AELTESTEN Kreises — bei einer Gesellschaft, die jaehrlich
      -- zuruecksetzt, ein Jahre altes Datum, nach dem niemand sucht.
      order by geschlossen_am desc nulls first`,
    [kreisTyp, kontextId],
  );

  const wo = `\`${kreisTyp}\`${kontextId === null ? '' : ` (Kontext ${kontextId})`}`;
  const offen = kandidaten.find((k) => k.geschlossen_am === null);

  if (offen === undefined) {
    throw new NummernkreisFehler(
      kandidaten.length === 0
        ? `Kein Nummernkreis ${wo} im aktiven Mandanten.`
        : `Der Nummernkreis ${wo} ist geschlossen (seit ${kandidaten[0]!.geschlossen_am}) `
          + 'und vergibt keine Nummern mehr. Ein Nachfolgekreis muss ihn fortsetzen.',
      kandidaten.length === 0 ? 'kein_kreis' : 'geschlossen',
    );
  }
  if (offen.ist_platzhalter) {
    throw new NummernkreisFehler(
      `Nummernkreis ${wo} ist noch ein Platzhalter: Maske und Rücksetzung sind `
      + 'unbestätigt, und eine Nummer daraus wäre eine erfundene (O-134).',
      'platzhalter',
    );
  }

  // Jetzt die Sperre. Der Zustand wird danach erneut gelesen, weil zwischen
  // Diagnose und Sperre eine andere Transaktion den Zähler bewegt haben kann —
  // die gesperrte Zeile ist die massgebliche, nicht die diagnostizierte.
  const gesperrt = await zeilen<KreisZeile>(
    tx,
    `select id, naechste_nummer, format_maske, jahr, ist_platzhalter,
            to_char(geschlossen_am, 'YYYY-MM-DD') as geschlossen_am,
            letzter_hash, genesis_hash
       from nummernkreis where id = $1 for update`,
    [offen.id],
  );
  const kreis = gesperrt[0];
  if (kreis === undefined) {
    // Unter der UPDATE-Policy unsichtbar: genau die Rechnungskreise, die die
    // Anwendung nicht ziehen darf — und jede künftige Einschränkung dort.
    throw new NummernkreisFehler(
      `Der Nummernkreis ${wo} ist für die Anwendung nicht sperrbar (§5.6).`,
      'definer_kreis',
    );
  }

  const nummer = Number(kreis.naechste_nummer);
  const formatiert = formatiereNummer(kreis.format_maske, nummer, kreis.jahr);

  /**
   * `returning id` und die Pruefung darunter: ein UPDATE, der unter FORCE RLS
   * keine Policy trifft, beruehrt null Zeilen und meldet nichts. Der Zaehler
   * bliebe stehen, waehrend diese Funktion die Nummer zurueckgibt — die
   * naechste Vergabe zoege DIESELBE, und `rechnung_laufend_uk` schluege erst
   * beim zweiten Beleg zu, mit einer Nummer, die der erste schon traegt.
   * §14 Abs. 4 Nr. 4 UStG verlangt Einmaligkeit; das ist der Preis fuer eine
   * Zeile, die im Erfolgsfall nichts kostet.
   */
  const bewegt = await zeilen<{ id: string }>(
    tx,
    `update nummernkreis set naechste_nummer = naechste_nummer + 1
      where id = $1 returning id`,
    [kreis.id],
  );
  if (bewegt.length === 0) {
    throw new NummernkreisFehler(
      `Der Zaehler des Nummernkreises ${wo} liess sich nicht bewegen — die `
      + 'Nummer waere ein zweites Mal vergeben worden (§5.6).',
      'definer_kreis',
    );
  }

  return {
    nummernkreisId: kreis.id,
    nummer,
    formatiert,
    kettePosition: nummer,
    letzterHash: kreis.letzter_hash,
    genesisHash: kreis.genesis_hash,
  };
}
