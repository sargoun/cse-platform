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
  const url = process.env[UMGEBUNG[schluessel]] ?? null;
  return {
    schluessel,
    name: NAME[schluessel],
    verbunden: url !== null && url !== '',
    basisUrl: url === '' ? null : url,
    hinweis: url === null || url === ''
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
  const text = String(roh).trim().replace(/\s/gu, '');
  if (text === '') return null;
  if (!/^-?\d+(\.\d+)?$/u.test(text)) {
    throw new QuelleFehler('feld', `"${String(roh)}" ist kein Betrag.`);
  }
  const negativ = text.startsWith('-');
  const ohneZeichen = negativ ? text.slice(1) : text;
  const [vor = '0', nach = ''] = ohneZeichen.split('.');
  const zwei = `${nach}00`.slice(0, 2);
  const cent = BigInt(vor) * 100n + BigInt(zwei);
  return negativ ? -cent : cent;
}

/** Ein Zeitpunkt aus der Quelle — oder `null`. Ein unlesbares Datum ist ein Fehler, kein Heute. */
export function alsZeitpunkt(roh: unknown): Date | null {
  if (roh === null || roh === undefined || roh === '') return null;
  if (typeof roh !== 'string') {
    throw new QuelleFehler('feld', 'Ein Zeitpunkt muss als Zeichenkette kommen.');
  }
  const d = new Date(roh);
  if (Number.isNaN(d.getTime())) {
    throw new QuelleFehler('feld', `"${roh}" ist kein Zeitpunkt.`);
  }
  return d;
}
