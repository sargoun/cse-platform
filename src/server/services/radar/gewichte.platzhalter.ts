import 'server-only';

/**
 * Die Gewichte der Radar-Bewertung — die **Voreinstellung**, vom Betreiber
 * noch nicht bestätigt (RAD-05, O-15, D-786).
 *
 * Eine eigene Datei — derselbe Grund wie bei `agent/limits.platzhalter.ts`:
 * so steht jeder unbestätigte Wert genau einmal, mit seiner Frage daneben,
 * und die Oberfläche kann ihn als **Voreinstellung** ausweisen. Bestätigt
 * oder ändert der Betreiber ihn, ändert sich diese Datei — und sonst nichts.
 *
 * **Warum das hier überhaupt Zahlen sind.** RAD-05 verlangt eine
 * deterministische Rangfolge mit einer lesbaren Begründung. Ohne Gewichte
 * gäbe es keine Rangfolge, also auch keine Liste, die jemand morgens
 * durchsieht. Die Zahlen unten sind deshalb ein *Gerüst*, kein Urteil: sie
 * sagen „CPV-Treffer wiegt mehr als ein Stichwort", weil das die Reihenfolge
 * der Kriterien in RAD-04 ist, und nicht, weil jemand 35 Punkte für richtig
 * hält.
 *
 * TODO(client, O-15): Voreinstellung — Skala 100, die Gewichte unten (CPV 35,
 * Region 25, Stichwort 20, Wert 15, Frist 5), Treffermeldung ab 60 Punkten
 * (`SCHWELLE_VOREINSTELLUNG`); der Betreiber bestätigt oder ändert sie.
 */

/** Die Skala, auf der eine Bewertung entsteht. `radar_profil.skala_max` kopiert sie. */
export const SKALA_MAX_PLATZHALTER = 100;

/**
 * Ab wie vielen Punkten ein Treffer gemeldet wird (RAD-08) — die
 * **Voreinstellung**, die `legeProfilAn` in jedes neue Profil schreibt und der
 * Seed in seine Profile. Ein Empfänger mit eigener Schwelle geht vor
 * (`coalesce(e.ab_punkte, p.benachrichtigung_ab_punkte)` in `warnung.ts`).
 *
 * 60 von 100 heisst: kein Kriterium reicht allein (das schwerste wiegt 35),
 * CPV und Region zusammen reichen — die Reihenfolge der Kriterien in RAD-04,
 * nicht ein Urteil über die Zahl. Ein Profil ohne Schwelle (Bestand vor
 * D-786) meldet weiter nichts, und das Profilblatt sagt es.
 *
 * TODO(client, O-15): Voreinstellung — Treffermeldung ab 60 von 100 Punkten.
 */
export const SCHWELLE_VOREINSTELLUNG = 60;

/**
 * Was ein Kriterium höchstens beitragen kann. Die Summe der positiven
 * Beiträge ergibt genau `SKALA_MAX_PLATZHALTER`, damit „100" auch wirklich
 * „alles trifft zu" heisst und nicht ein zufälliger Zwischenstand ist.
 */
export const GEWICHTE_PLATZHALTER = {
  /** Der CPV-Code ist das schärfste Merkmal: er sagt, WAS beschafft wird. */
  cpv: 35,
  /** Die Region entscheidet, ob der Betrieb überhaupt hinfahren kann. */
  region: 25,
  /** Stichwörter fangen, was der CPV-Code nicht trennt („Unterhaltsreinigung" vs. „Baureinigung"). */
  stichwort: 20,
  /** Der Auftragswert: zu klein lohnt nicht, zu gross ist nicht zu stemmen. */
  wert: 15,
  /** Bleibt genug Zeit, ein vollständiges Angebot zu bauen? */
  frist: 5,
} as const;

/** Was ein Negativtreffer kostet — Voreinstellung O-191: Abzug, kein Ausschluss (D-786). */
export const ABZUG_PLATZHALTER = {
  /** Ein Negativ-Stichwort. */
  stichwort: 20,
  /** Ein CPV-Code, den das Profil als `abzug` führt. */
  cpv: 25,
  /** Die Bekanntmachung liegt auf der falschen Seite des Schwellenwerts. */
  schwellenwert: 10,
} as const;

/**
 * Ab wann eine Restfrist knapp ist. **Nicht** die Grenze, ab der eine
 * Bekanntmachung ausscheidet — die ist O-191 und steht als `frist_min_tage`
 * im Profil, wo ein Mensch sie setzt.
 *
 * Fünf Tage stehen so in RAD-06 („red under five days"), sind also nicht
 * erfunden, sondern die Zahl, die die Anforderung selbst nennt.
 */
export const FRIST_KNAPP_TAGE = 5;
