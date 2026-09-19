import 'server-only';

/**
 * Die LAGE eines Fensters — als reine Funktion (APR-05, APR-06, Invariante 2).
 *
 * **Warum das nicht in der Seite steht.** Zwei Bildschirme
 * (`/freigaben/[id]/einspruch`, `/freigaben/[id]/rueckgaengig`) und die
 * Detailseite entscheiden aus denselben vier Werten, ob ein Knopf dastehen
 * darf: Entscheidungsstand, Ausführungsstand, die Fensterspalte und die Uhr.
 * Drei Abschriften derselben Bedingung liefen auseinander — und der Fehler
 * wäre ein Knopf, den die Datenbank abweist, oder, schlimmer, ein fehlender
 * Knopf für ein Fenster, das noch läuft. Die Bedingung steht deshalb einmal
 * hier und wird geprüft (`tests/kern/freigabe-fenster-lage.test.ts`), und die
 * Datenbank prüft sie in `app.freigabe_einspruch` / `app.freigabe_ruecknahme`
 * ein zweites Mal: zwischen dem Anzeigen eines Knopfes und seinem Drücken
 * vergeht Zeit.
 *
 * **Die Restzeit ist eine Differenz von UTC-Zeitpunkten** (Invariante 2). Sie
 * wird NICHT aus Kalenderfeldern gerechnet: in der Nacht der Zeitumstellung
 * ist die Differenz zweier Ortszeitangaben um eine Stunde falsch, und ein
 * Fenster von dreissig Minuten wäre dann entweder abgelaufen oder plötzlich
 * neunzig Minuten lang. Angezeigt wird der Zeitpunkt in `Europe/Berlin`; die
 * Rechnung kennt nur Instanten.
 *
 * **`nicht_armiert` ist nicht `abgelaufen`.** Das ist der ganze Zweck dieser
 * Unterscheidung: eine ausgeführte Handlung ohne Fenster sah vorher aus wie
 * eine, bei der man das Fenster verpasst hat. Sie ist etwas anderes — für sie
 * ist gar keines armiert (O-368), und eine Korrektur ist eine NEUE Freigabe.
 */

export type FensterArt = 'einspruch' | 'ruecknahme';

export type FensterLage =
  /** Das Fenster läuft: der Knopf darf dastehen. */
  | { readonly art: 'laeuft'; readonly bis: Date; readonly restSekunden: number }
  /** Es lief und ist vorbei — der Zeitpunkt steht noch da. */
  | { readonly art: 'abgelaufen'; readonly bis: Date }
  /** Der Stand erlaubt dieses Fenster überhaupt nicht (mit Grund). */
  | { readonly art: 'falscher_stand'; readonly grund: string }
  /** Der Stand wäre richtig, aber für diese Handlung ist keines armiert. */
  | { readonly art: 'nicht_armiert' };

export interface FensterEingabe {
  /** `freigabe.status` — der Stand der ENTSCHEIDUNG. */
  readonly status: string;
  /** `freigabe.ausfuehrung_status` — der Stand der HANDLUNG. */
  readonly ausfuehrungStatus: string;
  /** `verzoegerte_freigabe_bis` beim Einspruch, `undo_bis` bei der Rücknahme. */
  readonly bis: Date | null;
}

/**
 * Der Einspruch (APR-05): er hält eine Ausführung an, die noch nicht gelaufen
 * ist.
 *
 * **Die Reihenfolge ist bewusst eine ANDERE als die der Datenbank.**
 * `app.freigabe_einspruch` prüft der Reihe nach: Grund, gefunden,
 * Zeilenrecht, `freigabe.einspruch_erheben`, dann
 * `verzoegerte_freigabe_bis is null` („kein Einspruchsfenster"), dann
 * `<= now()` („abgelaufen") und ERST DANACH `ausfuehrung_status <> 'offen'`.
 * Hier steht „bereits ausgeführt" vorn, und zwar weil die Ausführung die
 * Fensterspalte leert: nach der Ausführung ist `verzoegerte_freigabe_bis`
 * wieder `null`, und die Datenbankreihenfolge ergäbe für den häufigsten Fall
 * „kein Einspruchsfenster" — wo „dafür ist es zu spät, es hilft nur noch die
 * Rücknahme" die Auskunft ist, die weiterhilft.
 *
 * Das ist kein Auseinanderlaufen: beide weisen dieselben Fälle ab, nur mit
 * verschiedenen Sätzen. Die Datenbank hat das letzte Wort — hier steht der
 * bessere Satz, dort der harte Riegel.
 */
function einspruchsLage(e: FensterEingabe, jetzt: Date): FensterLage {
  if (e.ausfuehrungStatus === 'zurueckgenommen') {
    return {
      art: 'falscher_stand',
      grund: 'Die Ausführung ist bereits zurückgenommen — ein Einspruch würde nichts '
        + 'mehr anhalten.',
    };
  }
  if (e.ausfuehrungStatus !== 'offen') {
    return {
      art: 'falscher_stand',
      grund: 'Die Handlung ist schon gelaufen. Einspruch hält eine Ausführung an, die '
        + 'noch aussteht; danach hilft nur das Rücknahmefenster (APR-06) — falls es '
        + 'läuft.',
    };
  }
  if (e.status === 'offen') {
    return {
      art: 'falscher_stand',
      grund: 'Diese Freigabe ist noch nicht entschieden. Ein Einspruch richtet sich '
        + 'gegen eine gefallene Entscheidung; solange sie wartet, wird sie abgelehnt '
        + 'und nicht bestritten.',
    };
  }
  if (e.status !== 'genehmigt') {
    return {
      art: 'falscher_stand',
      grund: 'Diese Freigabe ist nicht genehmigt — es läuft nichts, was anzuhalten wäre.',
    };
  }
  return fristLage(e.bis, jetzt);
}

/**
 * Die Rücknahme (APR-06): sie dreht die AUSFÜHRUNG zurück, nicht die
 * Entscheidung.
 */
function ruecknahmeLage(e: FensterEingabe, jetzt: Date): FensterLage {
  if (e.ausfuehrungStatus === 'zurueckgenommen') {
    return { art: 'falscher_stand', grund: 'Die Ausführung ist bereits zurückgenommen.' };
  }
  if (e.ausfuehrungStatus !== 'ausgefuehrt') {
    return {
      art: 'falscher_stand',
      grund: 'Zurückzunehmen ist eine Ausführung — und diese Freigabe hat keine gelaufen. '
        + 'Die Entscheidung selbst umzukehren ist eine NEUE Freigabe (§4.5).',
    };
  }
  return fristLage(e.bis, jetzt);
}

/**
 * Die Frist allein: gesetzt oder nicht, vorbei oder nicht.
 *
 * `restSekunden` wird abgerundet (`floor`): eine Anzeige, die auf die nächste
 * Minute aufrundet, verspricht Zeit, die es nicht gibt.
 */
function fristLage(bis: Date | null, jetzt: Date): FensterLage {
  if (bis === null) return { art: 'nicht_armiert' };
  const restMs = bis.getTime() - jetzt.getTime();
  if (restMs <= 0) return { art: 'abgelaufen', bis };
  return { art: 'laeuft', bis, restSekunden: Math.floor(restMs / 1000) };
}

export function fensterLage(
  art: FensterArt, e: FensterEingabe, jetzt: Date,
): FensterLage {
  return art === 'einspruch' ? einspruchsLage(e, jetzt) : ruecknahmeLage(e, jetzt);
}

/**
 * Die Restzeit in Worten — deutsch, und ohne die Sekunden vorzutäuschen.
 *
 * Eine Seite ist kein Ticker: sie ist gerendert, sobald sie beim Leser ist,
 * und „noch 29:58" wäre in derselben Sekunde falsch. Deshalb Minuten, und
 * unter einer Minute der Satz, dass es jeden Augenblick vorbei ist.
 */
export function restInWorten(restSekunden: number): string {
  if (restSekunden <= 0) return 'abgelaufen';
  if (restSekunden < 60) return 'weniger als eine Minute';
  const minuten = Math.floor(restSekunden / 60);
  if (minuten < 60) return `noch ${String(minuten)} Minute${minuten === 1 ? '' : 'n'}`;
  const stunden = Math.floor(minuten / 60);
  const rest = minuten % 60;
  return `noch ${String(stunden)} Stunde${stunden === 1 ? '' : 'n'}`
    + (rest === 0 ? '' : ` und ${String(rest)} Minute${rest === 1 ? '' : 'n'}`);
}
