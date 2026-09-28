/**
 * Die Wörter des Agentenzentrums (AGT-01…AGT-04) — Werkzeuge, ihre
 * Nebenwirkung und die Untergrenze der Richtlinie (V-228, D-722), dazu die
 * Vorgangsarten, die Aktionen der Versandrichtlinie und die Gründe eines
 * gestörten Laufs (V-231, D-725).
 *
 * **Eine Karte, alle Seiten.** `VORGANG_TEXT` stand als `VORGANG_LABEL` in
 * `freigaben/darstellung.ts`, `VERSAND_AKTION_TEXT` als `AKTION_TEXT` in
 * `services/agent/richtlinie.ts` — und das Agentenblatt und das Aufgabenblatt
 * zeigten dieselben Werte daneben roh (`interner_hinweis`, `email_senden`).
 * Beide Stellen lesen jetzt von hier; ihre alten Namen bleiben als deutsche
 * Sicht auf diese Karten stehen.
 *
 * Die Schlüssel sind die aus 0128/0150 (`agent_werkzeug_name`) und aus
 * `agent/tools/typen.ts` (`Nebenwirkung`); `tests/kern/beschriftung.test.ts`
 * prüft, dass jede der neun Werkzeugkennungen aus `WERKZEUGE` ein Wort hat.
 */
import type { Karte } from './basis.js';

export type WerkzeugSchluessel =
  | 'lies_dokument' | 'extrahiere_lv' | 'suche_bestand' | 'berechne_preis'
  | 'pruefe_nachweise' | 'pruefe_bilder' | 'entwirf_text' | 'sende_email'
  | 'erstelle_vorgang';

export const WERKZEUG_TEXT: Karte<WerkzeugSchluessel> = {
  de: {
    lies_dokument: 'Dokument lesen',
    extrahiere_lv: 'Leistungsverzeichnis auslesen',
    suche_bestand: 'Bestand abfragen',
    berechne_preis: 'Preis berechnen',
    pruefe_nachweise: 'Nachweise prüfen',
    pruefe_bilder: 'Fotos sichten',
    entwirf_text: 'Text entwerfen',
    sende_email: 'E-Mail senden',
    erstelle_vorgang: 'Vorgang anlegen',
  },
  en: {
    lies_dokument: 'Read a document',
    extrahiere_lv: 'Extract a bill of quantities (Leistungsverzeichnis)',
    suche_bestand: 'Query the records',
    berechne_preis: 'Calculate a price',
    pruefe_nachweise: 'Check certificates',
    pruefe_bilder: 'Review photos',
    entwirf_text: 'Draft a text',
    sende_email: 'Send an email',
    erstelle_vorgang: 'Create a record',
  },
};

export const NEBENWIRKUNG_TEXT: Karte<'lesen' | 'entwurf' | 'schreiben_mit_tor' | 'versand'> = {
  de: {
    lesen: 'liest nur',
    entwurf: 'schreibt nur einen Entwurf',
    schreiben_mit_tor: 'würde eine Fachzeile anlegen oder ändern',
    versand: 'verlässt das Haus',
  },
  en: {
    lesen: 'reads only',
    entwurf: 'writes a draft only',
    schreiben_mit_tor: 'would create or change a business record',
    versand: 'leaves the company',
  },
};

export const UNTERGRENZE_TEXT: Karte<'erlaubt' | 'je_art' | 'freigabe_erforderlich'> = {
  de: {
    erlaubt: 'darf ohne Freigabe laufen',
    je_art: 'je nach Art des Vorgangs',
    freigabe_erforderlich: 'immer mit menschlicher Freigabe',
  },
  en: {
    erlaubt: 'may run without approval',
    je_art: 'depends on the kind of record',
    freigabe_erforderlich: 'always with human approval',
  },
};

/** Die Vorgangsarten aus `agent_vorgang_typ` (0128, 0173) — alle achtzehn. */
export type VorgangSchluessel =
  | 'ausschreibung_bewerten' | 'dokument_abrufen' | 'vergabeunterlage_lesen'
  | 'interner_hinweis' | 'termin_bestaetigen' | 'anfrage_antwort_entwurf'
  | 'ersatz_vorschlagen' | 'monatsrechnung_entwurf' | 'angebot_erstellen'
  | 'nachlass_gewaehren' | 'externer_versand' | 'buchung_uebernehmen'
  | 'beitrag_veroeffentlichen' | 'mahnung_vorschlagen' | 'stellenanzeige_entwurf'
  | 'bewerbung_auswerten' | 'kandidat_ranking' | 'bewerbung_antwort_entwurf';

export const VORGANG_TEXT: Karte<VorgangSchluessel> = {
  de: {
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
    bewerbung_antwort_entwurf: 'Antwortentwurf auf Bewerbung',
  },
  en: {
    ausschreibung_bewerten: 'Assess a tender',
    dokument_abrufen: 'Fetch a document',
    vergabeunterlage_lesen: 'Read tender documents',
    interner_hinweis: 'Internal note',
    termin_bestaetigen: 'Confirm an appointment',
    anfrage_antwort_entwurf: 'Draft reply to an enquiry',
    ersatz_vorschlagen: 'Propose a replacement',
    monatsrechnung_entwurf: 'Monthly invoice (draft)',
    angebot_erstellen: 'Create an offer',
    nachlass_gewaehren: 'Grant a discount',
    externer_versand: 'External dispatch',
    buchung_uebernehmen: 'Adopt a booking',
    beitrag_veroeffentlichen: 'Publish a post',
    mahnung_vorschlagen: 'Propose a dunning letter',
    stellenanzeige_entwurf: 'Job advert (draft)',
    bewerbung_auswerten: 'Assess an application',
    kandidat_ranking: 'Candidate ranking',
    bewerbung_antwort_entwurf: 'Draft reply to an application',
  },
};

/** Die acht Aktionen der Versandrichtlinie (`agent_richtlinie.aktion`). */
export type VersandAktionSchluessel =
  | 'email_senden' | 'angebot_senden' | 'social_veroeffentlichen' | 'bewerbung_antworten'
  | 'mahnung_senden' | 'rechnung_senden' | 'nachtrag_einreichen' | 'behinderung_senden';

export const VERSAND_AKTION_TEXT: Karte<VersandAktionSchluessel> = {
  de: {
    email_senden: 'E-Mail an einen Kontakt',
    angebot_senden: 'Angebot versenden',
    social_veroeffentlichen: 'Beitrag veröffentlichen',
    bewerbung_antworten: 'Antwort an eine Bewerbung',
    mahnung_senden: 'Mahnung versenden',
    rechnung_senden: 'Rechnung versenden',
    nachtrag_einreichen: 'Nachtrag einreichen (§ 2 Abs. 6 VOB/B)',
    behinderung_senden: 'Behinderungsanzeige (§ 6 Abs. 1 VOB/B)',
  },
  en: {
    email_senden: 'Email to a contact',
    angebot_senden: 'Send an offer',
    social_veroeffentlichen: 'Publish a post',
    bewerbung_antworten: 'Reply to an application',
    mahnung_senden: 'Send a dunning letter',
    rechnung_senden: 'Send an invoice',
    nachtrag_einreichen: 'Submit a Nachtrag (change order, § 2(6) VOB/B)',
    behinderung_senden: 'Behinderungsanzeige (notice of obstruction, § 6(1) VOB/B)',
  },
};

/**
 * Warum ein Lauf nicht zustande kam — ein Satz je Code aus dem Orchestrator
 * (`scheitern`), dem Modellport (`ModellFehlerCode`) und der Laufroute.
 * Vorher stand der Code selbst im Satz („endete mit ‚RATE_LIMITED‘").
 */
export type LaufStoerungSchluessel =
  | 'RESIDENCY_BLOCKED' | 'NOT_CONNECTED' | 'RATE_LIMITED' | 'TIMEOUT'
  | 'INVALID_RESPONSE' | 'BUDGET_EXCEEDED' | 'AUTH_FAILED' | 'BUDGET' | 'PREIS_FEHLT'
  | 'ZAHL_ERFUNDEN' | 'KEINE_ANFRAGE';

export const LAUF_STOERUNG_TEXT: Karte<LaufStoerungSchluessel> = {
  de: {
    RESIDENCY_BLOCKED: 'Für das Formulieren ist kein Modell mit EU-Verarbeitung und '
      + 'Nullspeicherung freigegeben (§8, D-04). Die Arbeit läuft von Hand weiter.',
    NOT_CONNECTED: 'Der Modellanbieter ist nicht verbunden. Die Arbeit läuft von Hand weiter.',
    RATE_LIMITED: 'Der Modellanbieter hat die Anfrage gedrosselt. Später erneut versuchen.',
    TIMEOUT: 'Der Modellanbieter hat nicht rechtzeitig geantwortet. Später erneut versuchen.',
    INVALID_RESPONSE: 'Die Antwort des Modells war nicht verwendbar; es ist nichts entstanden.',
    BUDGET_EXCEEDED: 'Das Budget des Modellanbieters ist erschöpft.',
    AUTH_FAILED: 'Der Zugang zum Modellanbieter wurde abgewiesen.',
    BUDGET: 'Das Monatsbudget der Agenten ist erreicht; der Lauf wurde nicht gestartet.',
    PREIS_FEHLT: 'Für das Modell ist kein Preis hinterlegt — ein Lauf, dessen Kosten '
      + 'niemand kennt, startet nicht.',
    ZAHL_ERFUNDEN: 'Der Entwurf enthielt eine Zahl ohne Herkunft und wurde verworfen.',
    KEINE_ANFRAGE: 'Es gibt keine offene Anfrage, auf die ein Entwurf antworten könnte — '
      + 'es ist nichts entstanden.',
  },
  en: {
    RESIDENCY_BLOCKED: 'No model with EU processing and zero retention is approved for '
      + 'drafting (§8, D-04). Work continues by hand.',
    NOT_CONNECTED: 'The model provider is not connected. Work continues by hand.',
    RATE_LIMITED: 'The model provider throttled the request. Try again later.',
    TIMEOUT: 'The model provider did not answer in time. Try again later.',
    INVALID_RESPONSE: 'The model\u2019s answer was unusable; nothing was created.',
    BUDGET_EXCEEDED: 'The model provider\u2019s budget is exhausted.',
    AUTH_FAILED: 'Access to the model provider was refused.',
    BUDGET: 'The agents\u2019 monthly budget is reached; the run was not started.',
    PREIS_FEHLT: 'No price is stored for the model — a run whose cost nobody knows does '
      + 'not start.',
    ZAHL_ERFUNDEN: 'The draft contained a number without a source and was discarded.',
    KEINE_ANFRAGE: 'There is no open enquiry a draft could reply to — nothing was created.',
  },
};
