/**
 * Der EINGEFRORENE Bestand der Satztabellen-Wache (V-249, D-744).
 *
 * **`UNGELESENE_SATZFELDER` darf schrumpfen, nie wachsen.** Das sind die
 * Felder, die beim Einfrieren keine Seite, kein Baustein und kein Dienst
 * liest: 98 in 21 Tabellen. Knapp die Hälfte (48) ist der gemeinsame
 * Wortschatz der Verwaltung (`VERWALTUNG_TEXTE`, D-592) — Wörter, die bereit
 * stehen, bevor eine Seite sie nimmt. Der Rest sind Sätze, die eine Seite
 * einmal brauchte oder brauchen sollte (Titel für ein Bearbeiten, das es
 * nicht gibt; eine zweite Fassung neben der gezeigten). Wer ein Feld wieder
 * liest oder entfernt, streicht es hier; ein Feld, das NEU niemand liest,
 * bricht die Prüfung — so wie `ANTRAG_FORM_TEXTE.pflichtBei`, das bis V-249
 * in vier Sprachen stand und nirgends erschien.
 *
 * **`NICHT_VERFOLGTE_SATZTABELLEN`** sind die Tabellen, deren Leser die
 * Prüfung nicht bis zum Feld verfolgen kann — ein Schlüssel, der erst zur
 * Laufzeit feststeht (`arten[e.art]`, `PILLE_TEXTE[s][zustand]`). Für sie
 * gilt jedes Feld als gelesen. Die Liste ist genau: eine Tabelle, die neu
 * unsichtbar wird, muss hier mit Namen stehen, damit die Prüfung nicht
 * stillschweigend erblindet. Eine Beschriftungskarte (`Karte<K>`, D-725)
 * gehört nicht hierher: sie liest der Wert der Datenbank, und die Prüfung
 * verlangt von ihr nur, dass eine Stelle sie liest.
 *
 * Gezählt wird mit `hilfen/satztabellen.ts`.
 */
export const UNGELESENE_SATZFELDER: Readonly<Record<string, readonly string[]>> = {
  'src/lib/i18n/texte.ts#ANFRAGE_TEXTE': ['pflichtHinweis'],
  'src/lib/i18n/texte.ts#MEIN_TEXTE': ['gesperrt', 'offen', 'vorlaeufig', 'sprache', 'summe', 'dienstanweisungLesen', 'zurueck'],
  'src/lib/i18n/texte.ts#SHELL_TEXTE': ['menueSchliessen'],
  'src/lib/i18n/verwaltung/agent-budget.ts#BUDGET_TEXTE': ['prozent'],
  'src/lib/i18n/verwaltung/basis.ts#VERWALTUNG_TEXTE': [
    'speichern', 'abbrechen', 'weiter', 'anlegen', 'neu', 'bearbeiten', 'suchen', 'filtern', 'exportieren',
    'herunterladen', 'hochladen', 'senden', 'drucken', 'bestaetigen', 'uebernehmen', 'ablehnen', 'archivieren',
    'hinzufuegen', 'entfernen', 'name', 'beschreibung', 'zeitraum', 'von', 'bis', 'preis', 'status', 'objekt',
    'person', 'anschrift', 'telefon', 'email', 'bemerkung', 'angelegt', 'geaendert', 'aktionen', 'auswahl',
    'keineEintraege', 'ladeFehler', 'pflichtfeld', 'optional', 'nurLesen', 'listeGekuerzt', 'nichtVerbunden',
    'nichtVerbundenHinweis', 'freigabeNoetig', 'offeneFrage', 'betraegeInEuro', 'zeitzoneBerlin',
  ],
  'src/lib/i18n/verwaltung/bau.ts#PROJEKT_TEXTE': ['bearbeitenTitel', 'neuesProjekt', 'ersteAnlegen', 'aenderungenSpeichern'],
  // `typWerte` und `richtungWerte` prüft `crm-kette.test.ts` auf Vollständigkeit, gezeigt wird
  // keines von beiden — die Richtung auf der Leadseite kommt aus `LEAD_TEXTE.richtungWerte`.
  'src/lib/i18n/verwaltung/crm-kette.ts#KETTE_TEXTE': [
    'start', 'verlaufTitel', 'verlaufErklaerung', 'keinVerlauf', 'typWerte', 'richtungWerte', 'zurAnfrage',
    'beschriftungDokumente',
  ],
  'src/lib/i18n/verwaltung/crm-lead.ts#LEAD_TEXTE': ['kontaktKunde'],
  'src/lib/i18n/verwaltung/crm.ts#CRM_WEGE_TEXTE': ['leadVonHand'],
  'src/lib/i18n/verwaltung/dienstplan-schicht.ts#SCHICHT_TEXTE': ['abgesagt', 'abgesagtAm'],
  'src/lib/i18n/verwaltung/finanzen/bankkonten.ts#BANKKONTEN_TEXTE': ['standard', 'ibanFalsch'],
  'src/lib/i18n/verwaltung/finanzen/eingangsrechnungen.ts#EINGANGSRECHNUNGEN_TEXTE': ['grund'],
  'src/lib/i18n/verwaltung/finanzen/zahlungen.ts#ZAHLUNGEN_TEXTE': ['bauabzugKeine', 'ausgleichNichtsZuTun'],
  'src/lib/i18n/verwaltung/gewerke.ts#GEWERK_TEXTE': ['zumBautagebuch'],
  'src/lib/i18n/verwaltung/nutzlast.ts#NUTZLAST_TEXTE': ['pruefsumme'],
  'src/lib/i18n/verwaltung/objekte.ts#OBJEKTE_TEXTE': ['reiterAlle'],
  'src/lib/i18n/verwaltung/personal-nachweis.ts#NACHWEIS_ERFASSEN_TEXTE': ['unbefristet'],
  'src/lib/i18n/verwaltung/personal-zugang.ts#ZUGANG_TEXTE': ['standTitel'],
  'src/lib/i18n/verwaltung/reinigung.ts#REVIER_TEXTE': [
    'bearbeitenTitel', 'neuesRevier', 'ersteAnlegen', 'archivieren', 'archivierenErklaerung', 'archivierenKnopf',
    'keinSchreibrechtAendern',
  ],
  'src/lib/i18n/verwaltung/security.ts#VERANSTALTUNG_TEXTE': ['bearbeitenTitel', 'neueVeranstaltung', 'ersteAnlegen', 'aenderungenSpeichern'],
  'src/lib/i18n/verwaltung/urlaubskonten.ts#URLAUBSKONTEN_TEXTE': ['jahr', 'verplant', 'abgeschlossen'],
};

export const NICHT_VERFOLGTE_SATZTABELLEN: readonly string[] = [
  'src/lib/i18n/intern.ts#INTERN_BESCHRIFTUNGEN',
  'src/lib/i18n/pille.ts#PILLE_TEXTE',
  'src/lib/i18n/texte.ts#BAUTAG_STATUS_TEXTE',
  'src/lib/i18n/texte.ts#DOKUMENT_KATEGORIE_TEXTE',
  'src/lib/i18n/texte.ts#EINWAND_ART_TEXTE',
  'src/lib/i18n/texte.ts#EINWAND_STATUS_TEXTE',
  'src/lib/i18n/texte.ts#WACHBUCH_ART_TEXTE',
  'src/lib/i18n/texte.ts#WETTER_QUELLE_TEXTE',
  'src/lib/i18n/verwaltung/recruiting-rueckmeldung.ts#RECRUITING_RUECKMELDUNG',
];
