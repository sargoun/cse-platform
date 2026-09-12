/**
 * Der Schnappschuss der Unterschrift — was angezeigt wurde, und sein Digest
 * (CLN-04, §5.8, §10.4).
 *
 * **Ein Schnappschuss ist eine Kopie, kein Join.** Wer die unterschriebenen
 * Zeilen später aus `leistungsnachweis_position` nachlädt, zeigt den heutigen
 * Stand — und der Kunde hat einen anderen gesehen. Genau um diese Differenz
 * dreht sich jeder Streit über einen Leistungsnachweis, also wird kopiert.
 *
 * **Der Digest läuft über eine KANONISCHE Form, und das ist keine Zierde.**
 * `jsonb` sortiert seine Schlüssel beim Speichern selbst um und wirft
 * Whitespace weg. Ein SHA-256 über die Bytes, in denen jemand das Objekt
 * gebaut hat, ließe sich nach dem Zurücklesen nicht mehr nachrechnen — und ein
 * Hash, den man nicht nachrechnen kann, beweist nichts. Kanonisch heißt hier:
 *
 *   - Objektschlüssel nach Unicode-Codepunkten sortiert,
 *   - kein Leerzeichen zwischen den Zeichen,
 *   - **jede Zahl als Zeichenkette**.
 *
 * Der dritte Punkt ist der wichtigste und der Grund, warum das hier NICHT
 * RFC 8785 ist: JCS schreibt für Zahlen die Double-Ausgabe nach ECMAScript
 * vor, und damit liefe jeder Geldbetrag durch eine Gleitkommazahl — genau das,
 * was Invariante 1 verbietet. Beträge kommen als Cent-Zeichenkette aus der
 * Datenbank und bleiben eine, Mengen kommen als `numeric`-Text und bleiben
 * einer. Dieselbe Entscheidung, dieselbe Begründung wie in
 * `zeit/milog.ts#kanonischeZeilen`; der Digest selbst ist derselbe
 * (`nutzlastHash`), damit es nicht zwei SHA-256-Umsetzungen gibt.
 */
import { nutzlastHash } from '../finanz/hash-chain.js';

/** Was in einem Schnappschuss stehen darf — kein `number`, mit Absicht. */
export type SchnappschussWert =
  | string
  | boolean
  | null
  | readonly SchnappschussWert[]
  | { readonly [schluessel: string]: SchnappschussWert };

export class SchnappschussFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'SchnappschussFehler';
  }
}

/**
 * Kanonisches JSON: sortierte Schlüssel, kein Whitespace, keine Zahlen.
 *
 * Eine `number` wirft, statt still gerundet zu werden. Das ist die Stelle, an
 * der ein Betrag als Gleitkommazahl in den Beweis geriete, und ein Wurf hier
 * ist billiger als ein Cent Differenz in einem Digest, den niemand mehr
 * reproduzieren kann.
 */
export function kanonischesJson(wert: SchnappschussWert): string {
  if (wert === null) return 'null';
  if (typeof wert === 'boolean') return wert ? 'true' : 'false';
  if (typeof wert === 'string') return JSON.stringify(wert);
  if (Array.isArray(wert)) {
    return `[${wert.map((w) => kanonischesJson(w as SchnappschussWert)).join(',')}]`;
  }
  if (typeof wert === 'object') {
    const eintraege = Object.entries(wert as Record<string, SchnappschussWert>)
      // Nach CODEPUNKTEN, nicht nach Gebietsschema: `localeCompare` sortiert
      // „ä" je nach Sprache vor oder nach „z", und der Digest hinge dann an
      // der Umgebungsvariable des Prozesses.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${eintraege
      .map(([k, v]) => `${JSON.stringify(k)}:${kanonischesJson(v)}`)
      .join(',')}}`;
  }
  throw new SchnappschussFehler(
    `Ein Schnappschuss enthält ${typeof wert}. Erlaubt sind nur Zeichenketten, `
    + 'Wahrheitswerte, null, Listen und Objekte — Zahlen kommen als Text, '
    + 'damit kein Betrag durch eine Gleitkommazahl läuft (Invariante 1).',
  );
}

/** `sha256(kanonisches_json(schnappschuss))`, hex — was in `snapshot_hash` steht. */
export function schnappschussHash(wert: SchnappschussWert): string {
  return nutzlastHash(new TextEncoder().encode(kanonischesJson(wert)));
}

/** Eine Zeile des Nachweises, so wie sie auf dem Bildschirm stand. */
export interface SchnappschussPosition {
  readonly reihenfolge: string;
  readonly bezeichnung: string;
  /** `numeric`-Text, wie die Datenbank ihn liefert. */
  readonly menge: string;
  readonly einheit: string;
  /** Ganze Cent als Text, oder `null`, wo kein Preis angezeigt wurde. */
  readonly einzelpreisCent: string | null;
  readonly quelle: string;
  /** Berliner Ortszeit, in der Datenbank gerechnet — nie im Node-Prozess. */
  readonly leistungVonLokal: string | null;
  readonly leistungBisLokal: string | null;
  readonly bemerkung: string | null;
}

/** Der Kopf, wie er über den Zeilen stand. */
export interface SchnappschussKopf {
  readonly nummer: string | null;
  readonly kunde: string;
  readonly objekt: string | null;
  readonly revier: string | null;
  readonly leistungszeitraumVon: string;
  readonly leistungszeitraumBis: string;
}

export interface SchnappschussEingabe {
  readonly kopf: SchnappschussKopf;
  readonly positionen: readonly SchnappschussPosition[];
  /**
   * Die Zone, in der die Zeiten ANGEZEIGT wurden.
   *
   * Sie gehört in den Abzug, weil `leistung_von`/`leistung_bis` Zeitpunkte
   * sind: ohne die Zone lässt sich später nicht mehr sagen, welche Uhrzeit auf
   * dem Bildschirm stand — und im Streit um eine Nachtschicht ist das die
   * ganze Frage (Invariante 2).
   */
  readonly anzeigeZeitzone: string;
  /** Der Text, unter den unterschrieben wurde. Deutsch, immer (SEITENKARTE §5.7). */
  readonly bestaetigungstext: string;
}

/**
 * Die Fassung des Abzugs.
 *
 * Sie steht IM Schnappschuss und damit im Digest. Wer das Format später
 * erweitert, bekommt für dieselben Daten einen anderen Hash — und das ist
 * richtig so: ein Abzug in einer anderen Form ist ein anderer Abzug, und die
 * Prüfung soll das sagen statt es zu verschweigen.
 */
export const SCHNAPPSCHUSS_FASSUNG = 'ln-schnappschuss-v1' as const;

/** Aus den angezeigten Daten den Abzug bauen, der gespeichert und gehasht wird. */
export function baueSchnappschuss(eingabe: SchnappschussEingabe): SchnappschussWert {
  return {
    fassung: SCHNAPPSCHUSS_FASSUNG,
    anzeige_zeitzone: eingabe.anzeigeZeitzone,
    bestaetigungstext: eingabe.bestaetigungstext,
    kopf: {
      nummer: eingabe.kopf.nummer,
      kunde: eingabe.kopf.kunde,
      objekt: eingabe.kopf.objekt,
      revier: eingabe.kopf.revier,
      leistungszeitraum_von: eingabe.kopf.leistungszeitraumVon,
      leistungszeitraum_bis: eingabe.kopf.leistungszeitraumBis,
    },
    /**
     * Die Zeilen bleiben in ANZEIGEREIHENFOLGE und werden nicht sortiert.
     *
     * Das ist der Unterschied zu `milog.ts`, wo eine Menge gehasht wird: hier
     * ist die Reihenfolge Teil dessen, was jemand gesehen hat. Zwei Nachweise
     * mit denselben Zeilen in anderer Ordnung sind zwei verschiedene
     * Dokumente.
     */
    positionen: eingabe.positionen.map((p) => ({
      reihenfolge: p.reihenfolge,
      bezeichnung: p.bezeichnung,
      menge: p.menge,
      einheit: p.einheit,
      einzelpreis_cent: p.einzelpreisCent,
      quelle: p.quelle,
      leistung_von_lokal: p.leistungVonLokal,
      leistung_bis_lokal: p.leistungBisLokal,
      bemerkung: p.bemerkung,
    })),
  };
}

/**
 * Was aus der `jsonb`-Spalte kommt, in die Form bringen, die gehasht wird.
 *
 * **Der Treiber liefert `jsonb` je nach Abfrageweg als geparstes Objekt ODER
 * als rohen Text** — mit Parametern in der Anweisung das eine, ohne sie das
 * andere. Wer das nicht abfängt, hasht einmal ein Objekt und einmal die
 * Zeichenkette, die es beschreibt, und bekommt zwei verschiedene Digests für
 * dieselben Daten. Das fällt genau dann auf, wenn jemand im Streitfall einen
 * Abzug nachrechnen will — also zu spät.
 */
export function alsSchnappschuss(wert: unknown): SchnappschussWert {
  if (typeof wert === 'string') return JSON.parse(wert) as SchnappschussWert;
  return wert as SchnappschussWert;
}

/**
 * Den zurückgelesenen Abzug gegen seinen gespeicherten Digest prüfen.
 *
 * Das ist die Abnahmeprobe: derselbe Kanonisierer über das, was `jsonb`
 * zurückgibt, muss denselben Hash ergeben wie beim Unterschreiben — auch
 * nachdem sich am `revier` oder an den Positionen etwas geändert hat.
 */
export function pruefeSchnappschuss(gespeichert: unknown, hash: string): boolean {
  return schnappschussHash(alsSchnappschuss(gespeichert)) === hash;
}
