import type { Risiko, VorgangTyp } from '@/server/services/freigabe/posteingang';
import type { FreigabeStatus } from '@/server/services/freigabe/laden';
import type { PillZustand } from '@/components/ui/StatusPill';
import { VORGANG_TEXT } from '@/lib/i18n/beschriftung/agent';

/**
 * Beschriftungen der beiden Freigabe-Bildschirme — Darstellung, keine Regel.
 * Die Ordnung, die Einstufung und die Zahl der unsicheren Felder kommen aus
 * `services/freigabe`; hier steht nur, wie man sie hinschreibt.
 */
/**
 * Die Vorgangsart als Wort — die deutsche Sicht auf die gemeinsame Karte
 * `VORGANG_TEXT` (`i18n/beschriftung/agent.ts`, V-231). Sie stand hier als
 * eigene Liste, und die Agentenseiten zeigten dieselben Werte roh.
 */
export const VORGANG_LABEL: Readonly<Record<VorgangTyp, string>> = VORGANG_TEXT.de;

export const RISIKO_LABEL: Readonly<Record<Risiko, string>> = {
  niedrig: 'niedrig', mittel: 'mittel', hoch: 'hoch',
};

/**
 * Der Zustand einer Freigabe im festen Vokabular von DESIGN §5. `genehmigt`
 * ist `Abgeschlossen` — fertig, unveränderlich, gedämpft —, nicht ein neues
 * grünes Wort für denselben Zustand.
 */
export const STATUS_PILL: Readonly<Record<FreigabeStatus, PillZustand>> = {
  offen: 'Offen',
  genehmigt: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
  widerrufen: 'Archiviert',
  korrigiert: 'Archiviert',
  automatisch_freigegeben: 'Abgeschlossen',
};

export const STATUS_LABEL: Readonly<Record<FreigabeStatus, string>> = {
  offen: 'Wartet auf Entscheidung',
  genehmigt: 'Genehmigt',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
  widerrufen: 'Widerrufen',
  korrigiert: 'Durch Korrektur ersetzt',
  automatisch_freigegeben: 'Automatisch freigegeben (Fristablauf)',
};

/** Europe/Berlin, immer — Invariante 2. */
const UHR = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

export function zeitpunkt(wert: Date | null): string {
  return wert === null ? '—' : UHR.format(wert);
}

export const FEHLER_TEXT: Readonly<Record<string, string>> = {
  nicht_geoeffnet: 'Für diese Sitzung war die Freigabe nicht als geöffnet vermerkt. Die Seite wurde neu geladen — bitte die Entscheidung wiederholen.',
  nutzlast_veraendert: 'Die vorgelegte Nutzlast hat sich seit dem Öffnen geändert. Wer nach der Vorlage ändert, hat für das Geänderte keine Freigabe.',
  bereits_entschieden: 'Diese Freigabe ist bereits entschieden.',
  unsichere_felder: 'Solange ein Feld unsicher ist, wird nicht freigegeben. Eine Korrektur ist eine neue Freigabe; diese lässt sich nur ablehnen.',
  ohne_begruendung: 'Eine Ablehnung braucht eine Begründung — sie steht später allein in der Kette.',
  recht_fehlt: 'Das für diese Handlung erforderliche Recht fehlt.',
  nicht_gefunden: 'Diese Freigabe existiert nicht oder ist nicht sichtbar.',
  abgewiesen: 'Die Datenbank hat die Entscheidung abgewiesen.',
  /* Die beiden Wege aus `/api/freigaben/fenster` (APR-05, APR-06). */
  grund: 'Ein Einspruch und eine Rücknahme brauchen einen Grund — mindestens fünf Zeichen. '
    + 'In einem halben Jahr ist „warum wurde das gestoppt" eine echte Frage.',
  fenster: 'Das Fenster ist inzwischen abgelaufen — zwischen dem Anzeigen des Knopfes und '
    + 'seinem Drücken vergeht Zeit. Eine Korrektur ist jetzt eine NEUE Freigabe (§4.5).',
  /*
   * **Ein fehlendes Recht ist kein abgelaufenes Fenster.** Beide Wege kamen
   * vorher als `?fehler=fenster` zurueck, weil `erhebeEinspruch` jede Absage
   * der Definer-Funktion in denselben Fehler packte. Der Satz „das Fenster ist
   * abgelaufen" liess den Menschen dann auf das naechste warten, das ihm nie
   * geholfen haette: `app.freigabe_einspruch` prueft ZUSAETZLICH das
   * `erforderliches_recht` der Zeile (Vorgabe `freigabe.entscheiden`), und wer
   * nur das Einspruchsrecht haelt, kommt daran nicht vorbei.
   */
  recht: 'Dafür fehlt ein Recht an dieser Freigabe. Einspruch und Rücknahme verlangen '
    + 'zusätzlich das Recht, das der Vorgang selbst fordert (Vorgabe: '
    + 'freigabe.entscheiden) — die eigene Befugnis allein genügt nicht.',
};

/**
 * **Der Stand der AUSFÜHRUNG, nicht der der Entscheidung** (§4.8).
 *
 * `offen` heisst zweierlei, und der Unterschied ist für den Menschen der
 * ganze Punkt: bei einer Vorgangsart MIT Handlung (heute genau eine, die
 * Übernahme eines Eingangsrechnungs-Vorschlags) steht sie noch aus; bei allen
 * anderen gibt es nichts auszuführen — die Genehmigung IST der Vorgang. Ein
 * „steht aus", das nie weggeht, wäre eine Warnung, die niemand auflösen kann.
 */
export const AUSFUEHRUNG_LABEL: Readonly<Record<string, string>> = {
  laeuft: 'Ausführung läuft',
  ausgefuehrt: 'ausgeführt',
  fehlgeschlagen: 'Ausführung fehlgeschlagen',
  zurueckgenommen: 'Ausführung zurückgenommen',
};

/** Die eine Aktion, die heute einen Ausführer hat (`services/freigabe/ausfuehrung.ts`). */
const MIT_HANDLUNG: readonly string[] = ['eingangsrechnung_uebernehmen'];

export function ausfuehrungText(stand: string, aktion: string): string {
  const fest = AUSFUEHRUNG_LABEL[stand];
  if (fest !== undefined) return fest;
  return MIT_HANDLUNG.includes(aktion)
    ? 'Ausführung steht aus'
    : 'ohne Handlung — der Vermerk ist die Freigabe';
}
