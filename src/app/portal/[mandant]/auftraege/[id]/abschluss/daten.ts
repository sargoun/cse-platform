import 'server-only';

/** Die Form des Auftragskopfes und die Fehlertexte — NEBEN `page.tsx`. */

export interface AbschlussKopf {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly status: string;
  readonly art: string;
  readonly kunde: string;
  readonly objekt: string | null;
  readonly auftragswert: string | null;
  readonly start_datum: string;
  readonly laufzeit_bis: string | null;
  /** ISO fuer das `type="date"`-Feld, deutsch fuer die Anzeige — zwei Formen. */
  readonly abnahme_am_iso: string | null;
  readonly abnahme_am: string | null;
  readonly gewaehrleistung_bis: string | null;
  readonly sicherheitseinbehalt_bp: number | null;
  readonly sicherheitseinbehalt_cent: string | null;
  readonly abgeschlossen_am: string | null;
  readonly verantwortlich: string | null;
}

export const FELD = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
  + 'p-s3 text-sm text-text';

export const FEHLERTEXT: Readonly<Record<string, string>> = {
  schon_abgeschlossen:
    'Dieser Auftrag war bereits abgeschlossen. Der Abschluss ist einwegig (O-734).',
  storniert: 'Ein stornierter Auftrag wird nicht abgeschlossen.',
  gewaehrleistung_ohne_abnahme:
    'Eine Gewährleistungsfrist braucht ein Abnahmedatum — von ihm läuft sie.',
  einbehalt_doppelt:
    'Der Sicherheitseinbehalt ist ein Satz ODER ein Betrag, nicht beides (O-20).',
  zahl_unlesbar:
    'Ein Zahlenfeld war nicht lesbar. Deutsch schreiben: 2.500,00 — der Punkt ist der '
    + 'Tausendertrenner.',
  nicht_gefunden: 'Diesen Auftrag gibt es nicht.',
  kein_recht: 'Ihnen fehlt auftrag.abschliessen.',
};
