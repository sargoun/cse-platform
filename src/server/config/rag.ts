/**
 * Der Wissensindex: Modell, Masszahl und was ohne Anbieter passiert (AGT-06).
 *
 * **Die Dimension ist eine Schemaentscheidung, keine Einstellung.** Sie steht
 * in der Spalte `wissens_chunk.embedding vector(1536)` und in einem CHECK
 * daneben. Ein Wechsel des Einbettungsmodells ist deshalb kein Umschalten,
 * sondern eine Migration plus ein vollständiger Neuaufbau des Index — und
 * genau so soll es sich anfühlen: zwei Vektoren aus verschiedenen Modellen
 * im selben Index sind kein Index, sondern Zufall. Die Abstände zwischen
 * ihnen bedeuten nichts, und die Suche liefert trotzdem Ergebnisse.
 */

/** text-embedding-3-small — der Standard der im Stack festgelegten API. */
export const EINBETTUNG_MODELL = 'text-embedding-3-small';
export const EINBETTUNG_DIMENSION = 1536;

/**
 * **Die vier Quellen, die AGT-06 nennt** — mehr nicht. Ein fünfter Typ wäre
 * eine Entscheidung darüber, was ein Agent lesen darf, und die trifft nicht
 * diese Datei.
 */
export const WISSENSQUELLEN = ['vertrag', 'objekt', 'angebot', 'korrespondenz'] as const;
export type Wissensquelle = typeof WISSENSQUELLEN[number];

export interface EinbettungsStand {
  readonly verbunden: boolean;
  readonly modell: string;
  readonly dimension: number;
  /** Was fehlt, im Klartext — der Satz, den die Seite anzeigt. */
  readonly hinweis: string | null;
}

/** Was das Register zu `embedding` sagt — Modell und Anbieter, oder nichts. */
export interface RegisterAntwort {
  readonly modell: string | null;
  readonly anbieter: string | null;
}

/**
 * Ist ein Einbettungsanbieter freigegeben?
 *
 * **Die Antwort kommt aus dem Register, nicht aus der Umgebung.**
 *
 * Diese Funktion las früher `OPENAI_API_KEY` und `OPENAI_REGION` und endete
 * in jedem Fall mit „nicht verbunden — das Modellregister gibt es noch
 * nicht". Seit `0154` gibt es das Register, und der Satz war damit unwahr:
 * die Seite meldete „kein Anbieter", während `app.modell_fuer('embedding')`
 * einen nannte. Ein Bildschirm, der eine Fähigkeit als fehlend meldet, die
 * vorhanden ist, ist derselbe Fehler wie umgekehrt — er kostet nur anders.
 *
 * Zwei Umgebungsvariablen waren nie der Nachweis, den D-04 verlangt: wer
 * Vertragstext dreier deutscher Gesellschaften an einen Auftragsverarbeiter
 * gibt, tut das mit Namen und Datum in einer Tabelle. Genau diese Tabelle
 * antwortet jetzt.
 *
 * **Ohne freigegebenes Modell wird NICHTS indiziert**, und die Seite sagt es.
 * Ein Index aus Nullvektoren oder aus einem lokal gewürfelten Ersatz wäre die
 * gefährlichste Art von Platzhalter: die Suche liefert Treffer, sie sehen
 * plausibel aus, und niemand merkt, dass die Reihenfolge Zufall ist.
 */
export function einbettungsStand(register: RegisterAntwort): EinbettungsStand {
  if (register.modell === null || register.anbieter === null) {
    return {
      verbunden: false,
      modell: EINBETTUNG_MODELL,
      dimension: EINBETTUNG_DIMENSION,
      hinweis: 'Für „embedding" ist im Modellregister nichts freigegeben. Ein Modell wird '
        + 'erst aufrufbar, wenn dort EU-Verarbeitung, Nullspeicherung und Freigabe je Modell '
        + 'nachgewiesen sind — zwei Umgebungsvariablen sind kein Nachweis (D-04, §8).',
    };
  }

  /**
   * **Der Demobetrieb ist verbunden und sagt, dass er es ist.**
   *
   * Er läuft im eigenen Prozess, schickt nichts hinaus und würfelt seinen
   * Vektor deterministisch aus dem Text. Das reicht, um den Index zu bauen
   * und die Oberfläche vollständig zu zeigen; es reicht NICHT, um Ähnlichkeit
   * zu messen. Deshalb steht der Satz auf der Seite und nicht in einer
   * Fussnote: wer hier sucht, sieht Treffer, und er muss wissen, woher ihre
   * Reihenfolge kommt.
   */
  if (register.anbieter === 'demo') {
    return {
      verbunden: true,
      modell: register.modell,
      dimension: EINBETTUNG_DIMENSION,
      hinweis: 'Demobetrieb: der Vektor entsteht im eigenen Prozess, kein Anbieter, kein '
        + 'Netzverkehr. Der Index lässt sich damit aufbauen und die Suche vorführen — die '
        + 'REIHENFOLGE der Treffer ist aber nicht die eines echten Einbettungsmodells. '
        + 'Ein freigegebener Anbieter schlägt diese Zeile, sobald er im Register steht.',
    };
  }

  return {
    verbunden: true,
    modell: register.modell,
    dimension: EINBETTUNG_DIMENSION,
    hinweis: null,
  };
}
