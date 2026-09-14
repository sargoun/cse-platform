import 'server-only';

/**
 * Die beiden Quellen des Vergaberadars — und was „verbunden" hier heisst
 * (RAD-01, RAD-02).
 *
 * **Beide sind öffentlich, keine braucht einen Schlüssel.**
 * oeffentlichevergabe.de liefert OCDS, die TED Search API v3 liefert JSON;
 * für keine von beiden gibt es ein Konto, das jemand einrichten müsste. Was
 * fehlt, ist etwas anderes: die **Basis-URL** und die Abfrage, die dieser
 * Betrieb wirklich stellen will. Solange sie nicht konfiguriert ist, sagt
 * diese Datei „nicht verbunden" — und der Einlesejob schreibt einen Lauf mit
 * `uebersprungen` statt einen leeren Tag vorzutäuschen.
 *
 * **Warum der Leser vom Abruf getrennt ist.** `liesOcds` und `liesTed`
 * bekommen Text und geben Zeilen zurück; sie sprechen mit niemandem. So sind
 * sie gegen echte Beispielantworten prüfbar, ohne dass ein Test ins Netz
 * greift — und ein Feldfehler in der Zuordnung fällt in der Kernsuite auf,
 * nicht nachts im Job.
 */

export type QuellSchluessel = 'oeffentlichevergabe' | 'ted';

export interface QuellStand {
  readonly schluessel: QuellSchluessel;
  readonly name: string;
  readonly verbunden: boolean;
  /** Was fehlt, im Klartext — die Oberfläche zeigt diesen Satz. */
  readonly hinweis: string;
  readonly basisUrl: string | null;
}

/**
 * Die Umgebungsvariablen, die eine Quelle einschalten. Sie existieren noch
 * nicht — und genau das steht dann in der Oberfläche.
 */
const UMGEBUNG: Readonly<Record<QuellSchluessel, string>> = {
  oeffentlichevergabe: 'RADAR_OEFFENTLICHEVERGABE_URL',
  ted: 'RADAR_TED_URL',
};

const NAME: Readonly<Record<QuellSchluessel, string>> = {
  oeffentlichevergabe: 'oeffentlichevergabe.de (OCDS)',
  ted: 'TED Search API v3',
};

export function quellStand(schluessel: QuellSchluessel): QuellStand {
  /* Getrimmt: ein Leerzeichen ist keine Adresse, und ein Lauf, der `" "` abruft, ist kein Lauf. */
  const roh = process.env[UMGEBUNG[schluessel]];
  const url = roh === undefined || roh.trim() === '' ? null : roh.trim();
  return {
    schluessel,
    name: NAME[schluessel],
    verbunden: url !== null,
    basisUrl: url,
    hinweis: url === null
      ? `Nicht verbunden: ${UMGEBUNG[schluessel]} ist nicht gesetzt. `
        + 'Die Quelle ist öffentlich und braucht keinen Schlüssel — nur die Adresse und die '
        + 'Abfrage, die dieser Betrieb stellen will (TODO(client, O-366)).'
      : `Verbunden mit ${url}.`,
  };
}

export function alleQuellStaende(): readonly QuellStand[] {
  return (['oeffentlichevergabe', 'ted'] as const).map(quellStand);
}

/**
 * Eine Bekanntmachung, wie sie aus einer Quelle kommt — normalisiert, aber
 * noch nicht gespeichert.
 *
 * `wertCent` ist ganzzahlig (Invariante 1): die Quellen liefern Dezimalzahlen,
 * und die Umrechnung passiert **einmal**, im Leser, mit Zeichenkettenarithmetik.
 */
export interface RohBekanntmachung {
  readonly quelle: QuellSchluessel;
  readonly quellId: string;
  /**
   * Die Rohantwort DIESER Bekanntmachung — nicht die der ganzen Seite.
   *
   * **Warum das zaehlt.** Haengte an jeder Zeile der komplette Antworttext,
   * aenderte sich ihr Hash, sobald irgendeine andere Bekanntmachung auf der
   * Seite sich aendert: der Lauf meldete hundert Aenderungen, wo eine war,
   * und `ausschreibung_rohdaten` speicherte hundertmal dieselbe Seite. Die
   * Beweiskette braucht den Satz, der zu dieser Zeile gehoert.
   */
  readonly rohJson: string;
  readonly quellUrl: string | null;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly sprache: string;
  readonly vergabestelleName: string | null;
  readonly vergabestelleOrt: string | null;
  readonly vergabestellePlz: string | null;
  readonly cpvHaupt: string | null;
  readonly cpvWeitere: readonly string[];
  readonly nutsCodes: readonly string[];
  readonly verfahrensartRoh: string | null;
  readonly oberhalbSchwellenwert: boolean | null;
  readonly wertCent: bigint | null;
  readonly waehrung: string | null;
  readonly veroeffentlichtAm: Date | null;
  readonly fristTeilnahme: Date | null;
  readonly fristAngebot: Date | null;
  readonly fristFragen: Date | null;
  readonly loseAnzahl: number | null;
  readonly istBerichtigung: boolean;
  /** Die Quelle sagt selbst, dass das Verfahren aufgehoben ist. */
  readonly aufgehoben: boolean;
}

export class QuelleFehler extends Error {
  readonly code: 'format' | 'feld';
  constructor(code: 'format' | 'feld', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'QuelleFehler';
  }
}

/**
 * Ein Dezimalbetrag als ganze Cent — **ohne `Number`**.
 *
 * `parseFloat('1234567.89') * 100` ist 123456788.99999999. Bei einem
 * Auftragswert von einer Million ist das ein Cent daneben, und genau dieser
 * Cent steht später in einer Kalkulation. Deshalb Zeichenketten: Vorkomma,
 * Nachkomma auf zwei Stellen aufgefüllt, beides zusammengesetzt.
 */
export function alsCent(roh: string | number | null | undefined): bigint | null {
  if (roh === null || roh === undefined) return null;
  /*
   * **Eine Zahl aus JSON ist schon durch `JSON.parse` gegangen.** Bis
   * 2^53 Cent (rund 90 Billionen Euro) gibt `String()` dieselben Ziffern
   * zurueck, die in der Antwort standen — darueber nicht mehr, und dann waere
   * der gespeicherte Betrag ein anderer als der veroeffentlichte. Das ist
   * keine Zahl, die man rundet, sondern eine, die man abweist.
   */
  if (typeof roh === 'number'
      && (!Number.isFinite(roh) || Math.abs(roh) > Number.MAX_SAFE_INTEGER / 100)) {
    throw new QuelleFehler('feld', `"${String(roh)}" ist als Zahl nicht mehr centgenau.`);
  }
  const text = String(roh).trim().replace(/\s/gu, '');
  if (text === '') return null;
  if (!/^-?\d+(\.\d+)?$/u.test(text)) {
    throw new QuelleFehler('feld', `"${String(roh)}" ist kein Betrag.`);
  }
  const negativ = text.startsWith('-');
  const ohneZeichen = negativ ? text.slice(1) : text;
  const [vor = '0', nach = ''] = ohneZeichen.split('.');
  /*
   * **Eine dritte Nachkommastelle wird nicht weggeschnitten.** `0.005` still
   * zu `0` zu machen, hiesse den Auftragswert zu veraendern; derselbe Fall
   * wird im CAMT-Leser (`finanz/bank/camt.ts`) abgewiesen, und zwei
   * Geldparser derselben Plattform duerfen sich hier nicht widersprechen.
   */
  if (nach.length > 2 && /[1-9]/u.test(nach.slice(2))) {
    throw new QuelleFehler('feld',
      `"${String(roh)}" hat mehr als zwei Nachkommastellen — in ganzen Cent nicht darstellbar.`);
  }
  const zwei = `${nach}00`.slice(0, 2);
  const cent = BigInt(vor) * 100n + BigInt(zwei);
  return negativ ? -cent : cent;
}

const NUR_DATUM = /^\d{4}-\d{2}-\d{2}$/u;
const MIT_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/u;

/**
 * Ein Zeitpunkt aus der Quelle — oder `null`. Ein unlesbares Datum ist ein
 * Fehler, kein Heute.
 *
 * **Eine Uhrzeit ohne Zone wird abgewiesen.** `new Date('2026-10-01T12:00:00')`
 * liest JavaScript in der Zeitzone des Prozesses: dieselbe Antwort ergaebe in
 * Frankfurt und in Dublin zwei verschiedene Zeitpunkte, und der Fristzaehler
 * haette je nach Server einen anderen Stand. Erlaubt ist `Z` oder ein
 * ausdruecklicher Versatz.
 *
 * **Ein reines Datum ist kein Zeitpunkt.** Fuer eine Veroeffentlichung ist
 * Mitternacht UTC eine brauchbare Naeherung; fuer eine FRIST ist sie es
 * nicht — sie verkuerzte den Countdown stillschweigend um bis zu einen Tag,
 * und in einem Vergabeverfahren ist ein Tag der Unterschied zwischen Angebot
 * und Ausschluss. `frist: true` weist ein reines Datum deshalb ab.
 */
export function alsZeitpunkt(roh: unknown, optionen: { frist?: boolean } = {}): Date | null {
  if (roh === null || roh === undefined || roh === '') return null;
  if (typeof roh !== 'string') {
    throw new QuelleFehler('feld', 'Ein Zeitpunkt muss als Zeichenkette kommen.');
  }
  const text = roh.trim();
  if (NUR_DATUM.test(text)) {
    if (optionen.frist === true) {
      throw new QuelleFehler('feld',
        `"${text}" ist ein Datum ohne Uhrzeit — als Frist nicht verwendbar.`);
    }
    return new Date(`${text}T00:00:00Z`);
  }
  if (!MIT_ZONE.test(text)) {
    throw new QuelleFehler('feld',
      `"${text}" traegt keine Zeitzone — ohne sie haengt der Zeitpunkt am Server.`);
  }
  const d = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) {
    throw new QuelleFehler('feld', `"${text}" ist kein Zeitpunkt.`);
  }
  return d;
}

/**
 * Was ein Leser zurueckgibt: die Zeilen UND die Zahl der uebersprungenen.
 *
 * **Eine stillschweigend verworfene Zeile ist die schlimmste Sorte.** Ohne
 * Kennung oder Titel laesst sich eine Bekanntmachung nicht speichern (und eine
 * zu erfinden waere schlimmer), aber der Lauf darf dann nicht `erfolg` melden
 * und schon gar nicht anschliessend aufraeumen: was er nicht gelesen hat,
 * sieht sonst aus wie verschwunden.
 */
export interface LeseErgebnis {
  readonly zeilen: readonly RohBekanntmachung[];
  readonly uebersprungen: number;
}
