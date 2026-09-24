import type { BereichSchluessel } from '@/lib/design/theme';

/** Ein Bereich, wie ihn der Umschalter zeigt. */
export interface UmschalterBereich {
  readonly id: string;
  readonly slug: string;
  /** Der Anzeigename — `mandant.name`. */
  readonly name: string;
  /**
   * Die Unterzeile: Gewerk und LIVE-Zähler, „Reinigung · 24 laufende Aufträge"
   * (DESIGN §6 Regel 2, TEN-10). Fertig formuliert — Einzahl, Mehrzahl und
   * deutsche Zahlen macht `unterzeile()` aus `lib/i18n/verwaltung/bereichswechsel`.
   * `null`: nichts zu sagen — kein Gewerk und kein Zähler, den dieser Mensch
   * sehen darf. Dann steht dort nichts, und keine erfundene Null.
   */
  readonly unterzeile: string | null;
  /**
   * Der Identitäts-Hue aus DESIGN §1 — `null` für einen Bereich ohne eigenen
   * Farbton (ein fünfter, TEN-08); er trägt dann das Zeichen der Gruppe.
   */
  readonly bereich: BereichSchluessel | null;
}

/** Die Wörter des Umschalters (V-165) — aus `BEREICHSWECHSEL_TEXTE`. */
export interface UmschalterTexte {
  readonly kopf: string;
  readonly gruppenuebersicht: string;
  readonly bereichWaehlen: string;
  readonly ausloeser: string;
}
