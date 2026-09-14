import type { Risiko, VorgangTyp } from '@/server/services/freigabe/posteingang';
import type { FreigabeStatus } from '@/server/services/freigabe/laden';
import type { PillZustand } from '@/components/ui/StatusPill';

/**
 * Beschriftungen der beiden Freigabe-Bildschirme — Darstellung, keine Regel.
 * Die Ordnung, die Einstufung und die Zahl der unsicheren Felder kommen aus
 * `services/freigabe`; hier steht nur, wie man sie hinschreibt.
 */
export const VORGANG_LABEL: Readonly<Record<VorgangTyp, string>> = {
  ausschreibung_bewerten: 'Ausschreibung bewerten',
  dokument_abrufen: 'Dokument abrufen',
  vergabeunterlage_lesen: 'Vergabeunterlage lesen',
  interner_hinweis: 'Interner Hinweis',
  termin_bestaetigen: 'Termin bestätigen',
  anfrage_antwort_entwurf: 'Antwortentwurf auf Anfrage',
  ersatz_vorschlagen: 'Ersatz vorschlagen',
  monatsrechnung_entwurf: 'Monatsrechnung (Entwurf)',
  angebot_erstellen: 'Angebot erstellen',
  nachlass_gewaehren: 'Nachlass gewähren',
  externer_versand: 'Externer Versand',
  buchung_uebernehmen: 'Buchung übernehmen',
  beitrag_veroeffentlichen: 'Beitrag veröffentlichen',
  mahnung_vorschlagen: 'Mahnung vorschlagen',
  stellenanzeige_entwurf: 'Stellenanzeige (Entwurf)',
  bewerbung_auswerten: 'Bewerbung auswerten',
  kandidat_ranking: 'Kandidaten-Rangfolge',
};

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
