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

/**
 * Ist ein Einbettungsanbieter konfiguriert?
 *
 * **Ohne Schlüssel wird NICHTS indiziert**, und die Seite sagt es. Ein Index
 * aus Nullvektoren oder aus einem lokal gewürfelten Ersatz wäre die
 * gefährlichste Art von Platzhalter: die Suche liefert Treffer, sie sehen
 * plausibel aus, und niemand merkt, dass die Reihenfolge Zufall ist.
 */
export function einbettungsStand(): EinbettungsStand {
  const schluessel = (process.env['OPENAI_API_KEY'] ?? '').trim();
  if (schluessel === '') {
    return {
      verbunden: false,
      modell: EINBETTUNG_MODELL,
      dimension: EINBETTUNG_DIMENSION,
      hinweis: 'OPENAI_API_KEY ist nicht gesetzt. Ohne Einbettungsanbieter wird nichts '
        + 'indiziert — ein Index aus Ersatzvektoren lieferte Treffer, deren Reihenfolge '
        + 'Zufall wäre, und das fiele niemandem auf.',
    };
  }
  /**
   * **Der Schlüssel allein reicht nicht.** D-04 verlangt EU-Verarbeitung und
   * Nullspeicherung, wo sie angeboten wird; das ist eine Einstellung beim
   * Anbieter und eine Zeile im Auftragsverarbeitungsvertrag, nicht eine
   * Umgebungsvariable. Solange sie nicht bestätigt ist, bleibt der Index aus.
   */
  const region = (process.env['OPENAI_REGION'] ?? '').trim().toLowerCase();
  if (region !== 'eu') {
    return {
      verbunden: false,
      modell: EINBETTUNG_MODELL,
      dimension: EINBETTUNG_DIMENSION,
      hinweis: 'Ein Schlüssel liegt vor, aber OPENAI_REGION ist nicht auf „eu" gesetzt. '
        + 'Der Index enthält Verträge, Objekte, Angebote und Korrespondenz dreier deutscher '
        + 'Gesellschaften; er wird erst aufgebaut, wenn die EU-Verarbeitung bestätigt ist (D-04).',
    };
  }
  /**
   * **Und die Region reicht auch nicht.**
   *
   * Hier stand `verbunden: true`, sobald ein Schlüssel und `OPENAI_REGION=eu`
   * gesetzt waren. Zwei Umgebungsvariablen sind aber kein Nachweis: was
   * `07-INTEGRATIONEN.md` §3.6 verlangt, ist ein Eintrag JE MODELL im
   * `modell_register` mit EU-Verarbeitung, Nullspeicherung und Freigabe — und
   * dieses Register gibt es noch nicht. Solange es fehlt, ist die ehrliche
   * Antwort „nicht verbunden", nicht „verbunden, vermutlich".
   *
   * Der Unterschied ist nicht formal: eine Einbettung schickt Vertragstext
   * dreier deutscher Gesellschaften an einen Auftragsverarbeiter. Wer das
   * freigibt, tut es mit Namen und Datum in einer Tabelle, nicht mit einer
   * Zeile in einer `.env`.
   */
  return {
    verbunden: false,
    modell: EINBETTUNG_MODELL,
    dimension: EINBETTUNG_DIMENSION,
    hinweis: 'Schlüssel und Region stehen — aber das Modellregister (07-INTEGRATIONEN §3.6) '
      + 'gibt es noch nicht. Ein Modell wird erst aufrufbar, wenn dort EU-Verarbeitung, '
      + 'Nullspeicherung und Freigabe je Modell nachgewiesen sind; zwei Umgebungsvariablen '
      + 'sind kein Nachweis (D-04, O-121).',
  };
}
