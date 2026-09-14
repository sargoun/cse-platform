/**
 * Das Verzeichnis der Auftragsverarbeiter (Art. 30 DSGVO, LEG-09, D-04).
 *
 * **Nur, was entschieden ist.** Die drei Dienste stehen in CLAUDE.md (Stack,
 * „locked") und D-04; die Region ist dort festgelegt. Ein Vertragsdatum kennt
 * dieses Verzeichnis nicht — es wird von der Geschaeftsfuehrung eingetragen,
 * wenn der Vertrag unterschrieben ist, und bleibt bis dahin `null`. Ein
 * erfundenes Datum saehe aus wie ein Vertrag.
 *
 * DWD Open Data fehlt mit Absicht: oeffentliche Wetterdaten ohne
 * Personenbezug, kein Auftragsverarbeiter. Dienste, die noch nicht gewaehlt
 * sind (O-82, O-36, O-132, O-135, O-118, O-123), stehen im Register der
 * Anbindungen, nicht hier.
 */
export interface Auftragsverarbeiter {
  readonly schluessel: string;
  readonly dienst: string;
  readonly zweck: string;
  readonly daten: string;
  readonly region: string;
  /** `DD.MM.YYYY` — oder `null`, solange kein Vertrag hinterlegt ist. */
  readonly vertragAm: string | null;
  readonly grundlage: string;
}

export const AUFTRAGSVERARBEITER: readonly Auftragsverarbeiter[] = [
  {
    schluessel: 'supabase',
    dienst: 'Supabase (Postgres, Auth, Storage)',
    zweck: 'Datenbank, Anmeldung, Dateiablage der Plattform',
    daten: 'Alle Plattformdaten: Personal- und Zeitdaten, Abwesenheiten, Finanzdaten, Dokumente, Konten',
    region: 'EU — Frankfurt',
    vertragAm: null,
    grundlage: 'CLAUDE.md Stack, D-04',
  },
  {
    schluessel: 'vercel',
    dienst: 'Vercel (Hosting, Serverless Functions)',
    zweck: 'Auslieferung der Anwendung und Ausführung der Serverfunktionen',
    daten: 'Anfragedaten (IP, Sitzungskennung), verarbeitete Plattformdaten im Durchlauf',
    region: 'EU — Funktionen in EU-Region',
    vertragAm: null,
    grundlage: 'CLAUDE.md Stack, D-04',
  },
  {
    schluessel: 'openai',
    dienst: 'OpenAI (Sprachmodell)',
    zweck: 'Lesen, Zuordnen, Entwerfen durch die Agenten — nie Rechnen (Invariante 6)',
    daten: 'Nur die Textausschnitte einer Aufgabe; Zero-Retention, wo angeboten',
    region: 'EU-Verarbeitung',
    vertragAm: null,
    grundlage: 'CLAUDE.md Stack, D-04 — Zugang noch nicht eingerichtet (O-26)',
  },
];
