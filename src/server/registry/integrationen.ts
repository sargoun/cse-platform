import { devFlaechenAn } from '../../lib/dev-flaechen.js';
import { smsDienst } from '../auth/sms.js';
import { SupabaseSpeicher } from '../storage/adapter.js';
import { wetterPort } from '../versand/dwd.js';

/**
 * Das Register der Anbindungen — und ihr WAHRER Zustand (CLAUDE.md, „No fake
 * integrations").
 *
 * Jede Zeile sagt, ob etwas verbunden ist, und woher die Antwort kommt: aus
 * dem Adapter, der die Verbindung auch benutzt (`SupabaseSpeicher`,
 * `wetterPort`, `smsDienst`), nicht aus einer zweiten Liste, die den Tag
 * verpasst, an dem ein Schluessel gesetzt wird. Was keinen Adapter hat, ist
 * `nicht_verbunden` mit der offenen Frage, die es klaert — nie „bald".
 *
 * `dateiexport` ist ein eigener Zustand: DATEV braucht keine Verbindung, der
 * Steuerberater bekommt eine Datei (D-06). Das ist kein Mangel, sondern die
 * Entscheidung.
 */
export type Anbindungsstand =
  | 'verbunden'
  | 'nicht_verbunden'
  | 'entwicklung'
  | 'dateiexport'
  | 'nicht_vorgesehen';

export interface Anbindung {
  readonly schluessel: string;
  readonly name: string;
  readonly zweck: string;
  readonly stand: Anbindungsstand;
  /** Was der Adapter selbst ueber sich sagt — oder die Frage, die offen ist. */
  readonly hinweis: string;
  /** Die offene Frage in DECISIONS.md, wo es eine gibt. */
  readonly offen: string | null;
}

export function anbindungen(): readonly Anbindung[] {
  const speicher = new SupabaseSpeicher();
  const wetter = wetterPort();
  const sms = smsDienst(devFlaechenAn());
  return [
    {
      schluessel: 'speicher', name: 'Supabase Storage (EU, Frankfurt)',
      zweck: 'Dokumente, Archiv, Einsatzmedien — private Buckets, signierte Adressen (DOC-03)',
      stand: speicher.verbunden ? 'verbunden' : 'nicht_verbunden',
      hinweis: speicher.verbunden
        ? 'Adresse und Dienstschlüssel sind gesetzt; Dateien gehen in private Buckets.'
        : 'Ohne SUPABASE_URL und Dienstschlüssel lehnt der Speicher jede Ablage ab — es wird nichts lokal vorgetäuscht.',
      offen: null,
    },
    {
      schluessel: 'datev', name: 'DATEV',
      zweck: 'Buchungsstapel und Belege für den Steuerberater (ACC-08)',
      stand: 'dateiexport',
      hinweis: 'Kein API-Zugang, mit Absicht: die Übergabe ist eine Datei, die ein Mensch prüft und weitergibt (D-06).',
      offen: null,
    },
    {
      schluessel: 'wetter', name: wetter.bezeichnung,
      zweck: 'Wetterlage für das Bautagebuch (BAU-06) — öffentliche Daten, keine Personendaten',
      stand: wetter.verbunden ? 'verbunden' : 'nicht_verbunden',
      hinweis: wetter.verbunden
        ? 'Die Beobachtungen der nächsten Station werden gelesen und zitiert.'
        : 'Ohne Basisadresse wird kein Wetter erfunden; das Bautagebuch sagt „nicht verbunden".',
      offen: null,
    },
    {
      schluessel: 'sms', name: 'SMS-Gateway',
      zweck: 'Einmalcodes und Check-in-Verweise für Beschäftigte (EMP-01)',
      stand: sms.verbunden ? 'verbunden' : devFlaechenAn() ? 'entwicklung' : 'nicht_verbunden',
      hinweis: sms.verbunden
        ? 'Codes gehen per SMS.'
        : `Adapter: ${sms.name}. Ein EU-Gateway mit Vertrag zur Auftragsverarbeitung ist nicht gewählt.`,
      offen: 'O-82',
    },
    {
      schluessel: 'email', name: 'Transaktions-E-Mail',
      zweck: 'Einladungen, Kennwortzurücksetzung, Angebote, Mahnungen (NOT-02)',
      stand: 'nicht_verbunden',
      hinweis: 'Benachrichtigungen werden im Portal abgelegt; kein Versender ist gewählt, also geht nichts hinaus.',
      offen: 'O-36',
    },
    {
      schluessel: 'modell', name: 'Sprachmodell (OpenAI, EU-Verarbeitung)',
      zweck: 'Die vier Agenten: lesen, zuordnen, entwerfen — nie rechnen (Invariante 6)',
      stand: 'nicht_verbunden',
      hinweis: 'Kein Modellzugang eingerichtet: EU-Verarbeitung mit Zero-Retention und ein Vertrag zur Auftragsverarbeitung stehen aus. Bis dahin startet kein Lauf.',
      offen: 'O-26',
    },
    {
      schluessel: 'ocr', name: 'Belegerkennung (OCR)',
      zweck: 'Eingangsrechnungen auslesen (ACC-05)',
      stand: 'nicht_verbunden',
      hinweis: 'Welcher Verarbeiter, in welcher Region, unter welchem Vertrag — nicht entschieden.',
      offen: 'O-135',
    },
    {
      schluessel: 'karte', name: 'Karten und Geokodierung',
      zweck: 'Objekte auf einer Karte, Anfahrt (OPS-01)',
      stand: 'nicht_verbunden',
      hinweis: 'Jeder Kartenaufruf gibt Koordinaten und IP an den Anbieter — ohne Vertrag keine Karte.',
      offen: 'O-132',
    },
    {
      schluessel: 'social', name: 'LinkedIn, Instagram',
      zweck: 'Beiträge veröffentlichen — nur nach Freigabe (SOC-*, Invariante 7)',
      stand: 'nicht_verbunden',
      hinweis: 'Keine Zugangsdaten hinterlegt; ein Beitrag bleibt Entwurf.',
      offen: null,
    },
    {
      schluessel: 'jobboerse', name: 'Jobbörsen',
      zweck: 'Stellenanzeigen ausspielen (REC-*)',
      stand: 'nicht_verbunden',
      hinweis: 'Recruiting arbeitet mit eingehenden Bewerbungen; Scraping ist ausgeschlossen (CLAUDE.md).',
      offen: null,
    },
    {
      schluessel: 'radar', name: 'Vergabeplattformen',
      zweck: 'Ausschreibungen finden und einordnen (RAD-*)',
      stand: 'nicht_vorgesehen',
      hinweis: 'Lesen ist Phase 8; eine Einreichung über API gibt es nicht — sie bleibt manuell (D-07).',
      offen: null,
    },
    {
      /*
       * **Der Ausloeser der Nachtlaeufe — die Anbindung, die niemand als eine
       * gesehen hat.**
       *
       * Sechzehn Jobs tragen einen Zeitplan, es gibt einen Runner, ein
       * Laufprotokoll und eine bewachte Route. Was fehlte, war das, was ruft:
       * kein Cron-Eintrag, nirgends. Jede Datei einzeln gebaut und geprueft;
       * zusammen lief kein einziger Waechter — und weil ein nicht gelaufener
       * Job keine Fehlermeldung erzeugt, faellt das erst auf, wenn jemand die
       * Zahlen vermisst.
       *
       * `JOB_TOKEN` ist hier die ehrliche Auskunft: ohne das Geheimnis
       * antwortet `/api/jobs/[schluessel]` mit 503, also kann kein Ausloeser
       * angeschlossen sein. Ist es gesetzt, ist der Weg offen — ob draussen
       * wirklich ein Cron-Eintrag steht, sagt `docs/JOB-AUSLOESER.sql` und die
       * Laufliste darunter, nicht diese Zeile.
       */
      schluessel: 'job_ausloeser', name: 'Nachtlauf-Auslöser (Supabase cron)',
      zweck: 'Die 16 Wächter aus SPEC §14 starten — Fristen, Dienstplan, Mahnlauf, Kette',
      stand: (process.env['JOB_TOKEN'] ?? '') === '' ? 'nicht_verbunden' : 'verbunden',
      hinweis: (process.env['JOB_TOKEN'] ?? '') === ''
        ? 'Ohne JOB_TOKEN antwortet /api/jobs/[schlüssel] mit 503 — kein Auslöser kann '
          + 'angeschlossen sein, und kein Wächter läuft. Der Plan dafür wird aus dem '
          + 'Job-Register erzeugt: `pnpm jobs:plan` → docs/JOB-AUSLOESER.sql.'
        : 'JOB_TOKEN ist gesetzt; die Auslöseroute nimmt Läufe an. Ob draussen wirklich '
          + 'ein Cron-Eintrag steht, zeigt die Laufliste — nicht diese Zeile.',
      offen: null,
    },
    {
      schluessel: 'n8n', name: 'n8n',
      zweck: 'Externe Verknüpfungen, nur als Klebstoff (CLAUDE.md, Stack)',
      stand: 'nicht_verbunden',
      hinweis: 'Ob selbst gehostet oder als EU-Instanz, ist nicht entschieden.',
      offen: 'O-123',
    },
  ];
}

export const STAND_TEXT: Readonly<Record<Anbindungsstand, string>> = {
  verbunden: 'verbunden',
  nicht_verbunden: 'nicht verbunden',
  entwicklung: 'Entwicklungsfläche',
  dateiexport: 'Dateiexport',
  nicht_vorgesehen: 'nicht vorgesehen',
};
