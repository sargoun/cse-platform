/**
 * Der Weg eines Beitrags (SOC-03) — **als reine Funktion, damit ein Test ihn
 * ganz durchlaufen kann.**
 *
 * Kein `server-only`: hier steht kein Zugriff, nur eine Regel. Der Dienst
 * darunter fragt sie, die Seite fragt sie fuer die Knoepfe, und beide bekommen
 * dieselbe Antwort — das ist der ganze Zweck. Eine Oberflaeche, die einen
 * Knopf zeigt, den der Dienst abweist, ist ein Fehlerbericht mit Verzoegerung.
 */

export type BeitragStatus =
  | 'entwurf' | 'vorgelegt' | 'freigegeben' | 'geplant'
  | 'veroeffentlicht' | 'abgelehnt' | 'zurueckgezogen';

export type Schritt =
  | 'vorlegen' | 'freigeben' | 'ablehnen' | 'ueberarbeiten'
  | 'planen' | 'planung_aufheben' | 'veroeffentlichen' | 'zuruecknehmen'
  | 'erneut_senden';

/**
 * **Was aus welchem Zustand werden darf.**
 *
 * `veroeffentlicht` hat genau einen Ausgang, und der heisst `zuruecknehmen` —
 * nicht `ueberarbeiten`. Ein Beitrag, der draussen war, wird nicht zum Entwurf
 * zurueckgedreht: gelesen wurde er trotzdem, und eine Oberflaeche, die ihn
 * wieder als Entwurf fuehrt, behauptet das Gegenteil.
 *
 * `zurueckgezogen` hat gar keinen — das Ende ist ein Ende. Wer denselben Text
 * noch einmal will, legt einen neuen Beitrag an, und der geht seinen eigenen
 * Weg durch die Freigabe. Genau das ist gewollt: die zweite Veroeffentlichung
 * ist eine zweite Entscheidung.
 */
const UEBERGAENGE: Readonly<Record<BeitragStatus, Readonly<Partial<Record<Schritt, BeitragStatus>>>>> = {
  entwurf: { vorlegen: 'vorgelegt', zuruecknehmen: 'zurueckgezogen' },
  vorgelegt: { freigeben: 'freigegeben', ablehnen: 'abgelehnt', ueberarbeiten: 'entwurf' },
  abgelehnt: { ueberarbeiten: 'entwurf' },
  freigegeben: {
    planen: 'geplant', veroeffentlichen: 'veroeffentlicht', zuruecknehmen: 'zurueckgezogen',
  },
  geplant: {
    planung_aufheben: 'freigegeben', veroeffentlichen: 'veroeffentlicht',
    zuruecknehmen: 'zurueckgezogen',
  },
  /**
   * **`erneut_senden` führt auf DENSELBEN Zustand, und das ist der Punkt.**
   *
   * Ein Kanal, der `fehlgeschlagen` ist, wurde nie wieder versucht: der
   * Planlauf holt nur `geplant`e Beiträge, und dieser hier ist
   * `veroeffentlicht`. Gemeldet hat das die Copilot-Runde auf PR 16, und der
   * Befund stimmte — nur die vorgeschlagene Reparatur nicht: „den Beitrag
   * geplant lassen" hiesse, die eigene Gesellschaftsseite von Instagram
   * abhängig zu machen. Die eigene Seite IST kein Kanal; dort steht der
   * Beitrag, sobald `status = 'veroeffentlicht'`.
   *
   * Der Wiederholungsweg ist deshalb ein eigener Schritt, der den Zustand
   * NICHT ändert und `veroeffentlicht_am` nicht anfasst — er wiederholt genau
   * die fehlgeschlagenen Kanäle. Ein `nicht_verbunden` wird dabei nicht
   * wiederholt: das ist kein Fehlschlag, sondern ein bekannter Zustand (O-10),
   * und ein Knopf, der ihn jede Woche neu versucht, erzeugt nur Rauschen.
   */
  veroeffentlicht: { zuruecknehmen: 'zurueckgezogen', erneut_senden: 'veroeffentlicht' },
  zurueckgezogen: {},
};

export function naechsterStatus(von: BeitragStatus, schritt: Schritt): BeitragStatus | null {
  return UEBERGAENGE[von][schritt] ?? null;
}

export function moeglicheSchritte(von: BeitragStatus): readonly Schritt[] {
  return Object.keys(UEBERGAENGE[von]) as Schritt[];
}

/**
 * **Bearbeitet wird nur der Entwurf.**
 *
 * Die Freigabe bindet an die Nutzlast — `freigabe.payload_hash` haelt den
 * Abdruck des Textes fest, der vorlag (`agent/policy.ts`). Wer nach der
 * Freigabe den Text aendert, hat keine Freigabe mehr fuer das, was
 * hinausgeht; deshalb gibt es hier keinen Weg, der die Aenderung stillschweigend
 * mitnimmt. Wer ueberarbeiten will, geht ueber `ueberarbeiten` zurueck in den
 * Entwurf — und die alte Freigabe faellt dabei weg.
 */
export function darfBearbeiten(status: BeitragStatus): boolean {
  return status === 'entwurf';
}

/** Ein Ende: hier passiert nichts mehr von selbst. */
export function istAbgeschlossen(status: BeitragStatus): boolean {
  return status === 'zurueckgezogen';
}

export type PlanFehler = 'vergangenheit' | 'falscher_status';

/**
 * Darf dieser Beitrag auf diesen Zeitpunkt geplant werden?
 *
 * **`jetzt` wird hereingereicht, nicht gelesen.** Eine Funktion, die selbst
 * `new Date()` aufruft, laesst sich ueber die Zeitgrenze nicht pruefen — und
 * genau an dieser Grenze steht die Frage (Invariante 5: die Serveruhr
 * entscheidet, nicht das Geraet).
 */
export function planFehler(
  status: BeitragStatus, geplantFuer: Date, jetzt: Date,
): PlanFehler | null {
  if (naechsterStatus(status, 'planen') === null) return 'falscher_status';
  return geplantFuer.getTime() <= jetzt.getTime() ? 'vergangenheit' : null;
}

export const PLAN_FEHLER_TEXT: Readonly<Record<PlanFehler, string>> = {
  vergangenheit: 'Der Zeitpunkt liegt nicht in der Zukunft. Ein Beitrag, der '
    + 'rückwirkend geplant wird, geht beim nächsten Lauf sofort hinaus — das ist '
    + 'keine Planung, sondern ein Versehen mit Verzögerung.',
  falscher_status: 'Geplant wird nur, was freigegeben ist. Ohne Freigabe gäbe es '
    + 'einen Zeitpunkt, zu dem etwas Unbestätigtes hinausginge (SOC-08).',
};

/** Die Beschriftung der Knoepfe — deutsch, weil das Portal deutsch ist. */
export const SCHRITT_TEXT: Readonly<Record<Schritt, string>> = {
  vorlegen: 'Zur Freigabe vorlegen',
  freigeben: 'Freigeben',
  ablehnen: 'Ablehnen',
  ueberarbeiten: 'Überarbeiten',
  planen: 'Planen',
  planung_aufheben: 'Planung aufheben',
  veroeffentlichen: 'Jetzt veröffentlichen',
  erneut_senden: 'Fehlgeschlagene Kanäle erneut senden',
  zuruecknehmen: 'Zurücknehmen',
};

export const STATUS_TEXT: Readonly<Record<BeitragStatus, string>> = {
  entwurf: 'Entwurf',
  vorgelegt: 'In Prüfung',
  freigegeben: 'Freigegeben',
  geplant: 'Geplant',
  veroeffentlicht: 'Veröffentlicht',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
};
