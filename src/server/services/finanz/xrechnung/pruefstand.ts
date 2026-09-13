import 'server-only';

/**
 * Der Prüfstand der XRechnung — **drei Zustände, und kein vierter, der wie
 * ein Bestehen aussieht** (04-SEITENKARTE.md §5.14.3).
 *
 * FIN-11 legt die KoSIT-Prüfung in CI, und der KoSIT-Prüfer ist ein
 * Java-Werkzeug. Eine Anwendung, die daneben eine eigene „Prüfung" anzeigt,
 * zeigt eine erfundene — und eine erfundene XRechnung-Freigabe entdeckt der
 * Empfänger, indem er die Rechnung ablehnt. Deshalb steht hier eine Auskunft
 * über den PRÜFSTAND und nie eine Aussage über das einzelne Dokument:
 *
 *   `in_ci_validiert`   — diese Fassung des Bauers ist in CI gegen das
 *                         genannte Regelwerk gelaufen. Über DIESE Rechnung
 *                         sagt das nichts; es sagt, dass der Bauer geprüft ist.
 *   `pruefung_ausstehend` — es liegt kein Prüfbericht vor.
 *   `pruefer_nicht_verbunden` — kein Prüfer ist eingerichtet. Die XRechnung
 *                         lässt sich trotzdem herunterladen: sie zurückzuhalten,
 *                         weil niemand sie prüfen kann, hülfe keinem Menschen.
 *
 * **Warum das kein Integrationsport ist.** `01-ORDNERSTRUKTUR.md` §11.2 sagt
 * es ausdrücklich: die KoSIT-Prüfung lebt in `tests/compliance/xrechnung/`
 * und nicht in `integrations/`, weil KEIN Produktionspfad davon abhängt, dass
 * ein Prüfer erreichbar ist. Diese Datei liest deshalb eine Umgebungsangabe
 * und ruft nichts auf.
 */

/**
 * **Hier steht bewusst KEINE Konstante mit der Regelwerksfassung.**
 *
 * Ein erster Entwurf trug `KOSIT_REGELWERK = 'XRechnung 3.0.2 …'` — und damit
 * stünde dieselbe Angabe an zwei Stellen: hier und in
 * `.github/workflows/compliance.yml`, wo der Prüfer und seine Konfiguration
 * gepinnt werden. Zwei Stellen driften, und die Seite behauptete dann eine
 * Fassung, gegen die niemand geprüft hat.
 *
 * Die Fassung kommt deshalb VON DEM, DER SIE KENNT: `CSE_XRECHNUNG_CI_GEPRUEFT`
 * trägt sie als Text, gesetzt von dem Bau, der den Prüfer wirklich hat laufen
 * lassen.
 */

export type PruefstandArt =
  | 'in_ci_validiert'
  | 'pruefung_ausstehend'
  | 'pruefer_nicht_verbunden';

export interface Pruefstand {
  readonly art: PruefstandArt;
  /** Der Satz, den die Seite zeigt — je Zustand genau einer. */
  readonly text: string;
  /** Die Fassung des Regelwerks, wenn es eine gibt. */
  readonly regelwerk: string | null;
}

/**
 * Welcher Zustand gilt.
 *
 * `CSE_XRECHNUNG_CI_GEPRUEFT` setzt der CI-Lauf, nachdem der KoSIT-Prüfer
 * die Musterdokumente angenommen hat — es ist eine Aussage über den BAU und
 * wird nirgends aus einer Rechnung abgeleitet. Ist nichts gesetzt, gilt
 * „ausstehend"; ist ausdrücklich kein Prüfer eingerichtet, gilt „nicht
 * verbunden".
 *
 * Der Vorgabewert ist der ZURÜCKHALTENDSTE der drei. Ein Vorgabewert
 * „validiert" wäre genau die Lüge, die §5.14.3 verbietet.
 */
export function pruefstand(umgebung: NodeJS.ProcessEnv = process.env): Pruefstand {
  if (umgebung['CSE_XRECHNUNG_PRUEFER'] === 'nicht_verbunden') {
    return {
      art: 'pruefer_nicht_verbunden',
      text: 'Prüfer nicht verbunden. Die XRechnung lässt sich herunterladen; '
        + 'geprüft wurde sie nicht.',
      regelwerk: null,
    };
  }
  const geprueft = umgebung['CSE_XRECHNUNG_CI_GEPRUEFT'];
  if (geprueft !== undefined && geprueft !== '') {
    return {
      art: 'in_ci_validiert',
      text: `In CI validiert gegen ${geprueft}. Das gilt dem Erzeuger, nicht `
        + 'dieser einzelnen Rechnung.',
      regelwerk: geprueft,
    };
  }
  return {
    art: 'pruefung_ausstehend',
    text: 'Prüfung ausstehend. Für diesen Stand liegt kein KoSIT-Prüfbericht vor.',
    regelwerk: null,
  };
}
