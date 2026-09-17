/**
 * Die Rechercheqellen der Akquise (§12 „Lead scanner / Auftragssuche").
 *
 * **Was hier NICHT steht, ist die eigentliche Aussage.**
 *
 * Die Auftragsbeschreibung wünscht sich einen Agenten, der selbstständig nach
 * möglichen Auftraggebern sucht. Der Wunsch ist legitim; der naheliegende Weg
 * dorthin — Firmenverzeichnisse und Portale abgrasen — ist es nicht:
 *
 *  1. **Art. 14 DSGVO.** Wer personenbezogene Daten nicht bei der betroffenen
 *     Person erhebt, muss sie binnen eines Monats informieren. Eine Datenbank
 *     aus 5.000 abgegriffenen Ansprechpartnern erzeugt 5.000 Informations-
 *     pflichten, bevor irgendjemand angerufen wurde.
 *  2. **Die Nutzungsbedingungen** der meisten Portale untersagen das
 *     automatisierte Auslesen ausdrücklich. CLAUDE.md nennt genau das unter
 *     „Out of scope".
 *
 * Deshalb speichert `akquise_ziel` **keine Personendaten** (0172), und deshalb
 * gibt es hier eine Schnittstelle statt eines Scrapers. Quellen, die legal
 * sind, lassen sich dahinter einhängen: das amtliche Handelsregister, ein
 * beauftragter Datenanbieter mit Vertrag, der Vergaberadar, den die Plattform
 * ohnehin hat — und die Hand eines Menschen, die einen Namen einträgt.
 *
 * **Keine Quelle ist verbunden, und keine tut so als ob.** Ein Lauf ohne
 * verbundene Quelle endet als `uebersprungen` MIT Meldung — nicht als
 * „0 Treffer". Der Unterschied ist der zwischen „heute war nichts dabei" und
 * „hier läuft nichts".
 */

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export type QuellenArt = 'manuell' | 'register' | 'dienstleister' | 'vergabe_radar';

export interface AkquiseQuelle {
  readonly id: string;
  readonly art: QuellenArt;
  readonly bezeichnung: string;
  readonly verbunden: boolean;
  /** Warum sie (noch) nicht verbunden ist — steht so in der Oberfläche. */
  readonly hinweis: string | null;
  readonly basisUrl: string | null;
  readonly aktiv: boolean;
}

/**
 * Ein Fund — Firmendaten, sonst nichts.
 *
 * Es gibt hier absichtlich kein Feld für einen Namen, eine persönliche
 * E-Mail-Adresse oder eine Durchwahl. Wer eine Quelle anschließt, die so
 * etwas liefert, muss es wegwerfen, um durch diese Schnittstelle zu passen —
 * und genau das ist die Absicht. Die Typdefinition ist die billigste Stelle,
 * an der man eine Datenschutzentscheidung durchsetzen kann.
 */
export interface Fund {
  readonly firmenname: string;
  readonly branche?: string | null;
  readonly strasse?: string | null;
  readonly plz?: string | null;
  readonly ort?: string | null;
  readonly website?: string | null;
  /** Nur allgemeine Postfächer (`info@`) — die Spalte prüft es nach. */
  readonly allgemeineEmail?: string | null;
  readonly telefon?: string | null;
}

export interface Rechercheur {
  readonly art: QuellenArt;
  /** Fragt die Quelle ab. Wirft `QuelleNichtVerbundenFehler`, wenn keine da ist. */
  suche(quelle: AkquiseQuelle, stichworte: readonly string[]): Promise<readonly Fund[]>;
}

export class QuelleNichtVerbundenFehler extends Error {
  constructor(readonly quelle: string, readonly hinweis: string | null) {
    super(
      `Die Quelle „${quelle}" ist nicht verbunden — es wurde nichts abgefragt. `
      + (hinweis ?? 'Es ist kein Zugang hinterlegt.'),
    );
    this.name = 'QuelleNichtVerbundenFehler';
  }
}

/**
 * Der Rechercheur, den es heute gibt: keiner.
 *
 * Er wirft, statt eine leere Liste zu geben. Eine leere Liste sähe aus wie ein
 * Ergebnis; der Fehler sagt, dass gar nicht gesucht wurde. Diese Unterscheidung
 * ist der ganze Unterschied zwischen einer ehrlichen und einer vorgetäuschten
 * Integration (CLAUDE.md: „Never simulate a successful external call").
 */
export class KeinRechercheur implements Rechercheur {
  constructor(readonly art: QuellenArt) {}

  suche(quelle: AkquiseQuelle): Promise<readonly Fund[]> {
    return Promise.reject(new QuelleNichtVerbundenFehler(quelle.bezeichnung, quelle.hinweis));
  }
}

/**
 * // TODO(client, O-596): Welche Recherchequelle soll beauftragt werden — das
 * // amtliche Handelsregister (kostenpflichtiger Abruf, nur Firmendaten), ein
 * // Datenanbieter mit AV-Vertrag, oder bleibt es bei manueller Erfassung?
 * // Von der Antwort hängt ab, welcher `Rechercheur` hier eingehängt wird;
 * // die Schnittstelle steht und ändert sich dadurch nicht.
 */

/**
 * Die Quellenliste — LESEND, und mehr kann dieser Dienst auch nicht.
 *
 * **Der Lauf selbst steht in `server/jobs/akquise.ts` und nicht hier.** Das
 * ist keine Gliederungsfrage: `akquise_lauf` gibt `cse_app` kein
 * Schreibrecht, nur `cse_job` (0172). Eine Recherche ist ein Nachtlauf, kein
 * Knopf — und ein Dienst, der ein Protokoll schreiben wollte, das seine Rolle
 * nicht schreiben darf, wäre eine Funktion, die im Betrieb an
 * „permission denied" scheitert und im Entwurf richtig aussieht.
 */
export async function quellen(db: Abfrage, mandantId: string): Promise<readonly AkquiseQuelle[]> {
  const zeilen = (await db.unsafe(
    `select id, art, bezeichnung, verbunden, hinweis, basis_url, aktiv
       from akquise_quelle
      where mandant_id = $1
      order by verbunden desc, bezeichnung`,
    [mandantId],
  )) as {
    id: string; art: QuellenArt; bezeichnung: string; verbunden: boolean;
    hinweis: string | null; basis_url: string | null; aktiv: boolean;
  }[];

  return zeilen.map((z) => ({
    id: z.id, art: z.art, bezeichnung: z.bezeichnung, verbunden: z.verbunden,
    hinweis: z.hinweis, basisUrl: z.basis_url, aktiv: z.aktiv,
  }));
}
