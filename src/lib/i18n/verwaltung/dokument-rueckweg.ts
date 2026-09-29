/**
 * Warum ein Formular der Ablage nicht durchlief — als SATZ, nachgeschlagen
 * nach einem GRUND (D-769, D-774, D-728).
 *
 * **Der Befund.** `POST /api/dokumente/upload` schickte zu seinem Schlüssel
 * einen Satz als `?meldung=` mit — einen festen, den des Dienstes oder den
 * JEDES Fehlers, den `alsAntwort` annahm —, und die Seite zeigte ihn vor
 * ihrer eigenen Tabelle. Jeder präparierte Link schrieb damit seine eigene
 * Systemmeldung, und der Satz des Dienstes nannte, was der Mensch getippt
 * hatte.
 *
 * **Deutsch, in der Form der zweisprachigen Tabellen.** Beide Seiten stehen
 * auf der Ausnahmeliste der Übersetzungswache
 * (`scripts/guards/uebersetzung-ausnahmen.ts`); kommen sie herunter, ergänzt
 * die Umstellung hier nur `en`, und die Seite wählt mit `nachSprache`.
 *
 * Nur als eigener Eintrag nachschlagen (`eigenerEintrag`, D-728); ein Grund,
 * den die Tabelle nicht kennt, bekommt `sonst` — nie den Schlüssel und nie
 * Text aus der Adresse.
 */
import { DOKUMENT_BLATT_TEXTE } from './dokument-blatt.js';

/* ── Ablegen (`/dokumente/upload`) ─────────────────────────────────────── */

/**
 * Jeder Grund, den `POST /api/dokumente/upload` zurückschickt: der Speicher,
 * die Prüfkette der Datei (`MimeFehler` als `datei_<grund>`, `ExifFehler` als
 * `datei_metadaten`) und die Felder (`AblageFehler`, `BezugUnbekannt`).
 */
export const UPLOAD_FEHLER_GRUENDE = [
  'speicher',
  'datei_leer', 'datei_unbekannt', 'datei_nicht_erlaubt', 'datei_widerspruch',
  'datei_zu_gross', 'datei_metadaten',
  'titel_fehlt', 'titel_zu_lang', 'kategorie_unbekannt', 'beschreibung_zu_lang',
  'kunde_unbekannt', 'objekt_unbekannt', 'auftrag_unbekannt',
] as const;
export type UploadFehlerGrund = (typeof UPLOAD_FEHLER_GRUENDE)[number];

export interface UploadRueckwegTexte {
  /** Die fett gesetzten ersten Worte des Warnkastens (DESIGN §5 „Notices"). */
  readonly titel: string;
  readonly fehler: Readonly<Record<UploadFehlerGrund, string>>;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly sonst: string;
}

/**
 * Die Sätze der Prüfkette stehen EINMAL — auf dem Blatt der zweiten Fassung
 * (D-759), dieselbe Prüfung, dieselbe Datei. Zwei Formulare sollen nicht
 * Verschiedenes raten lassen.
 */
const FASSUNG = DOKUMENT_BLATT_TEXTE.de.faFehler;

export const UPLOAD_RUECKWEG_TEXTE: Readonly<Record<'de', UploadRueckwegTexte>> = {
  de: {
    titel: 'Nichts abgelegt.',
    fehler: {
      speicher:
        'Der Dateispeicher ist nicht verbunden. Es wurde nichts abgelegt und nichts angelegt — '
        + 'eine Zeile ohne ihre Datei wäre kein Dokument, sondern eine Behauptung.',
      datei_leer: 'Es war keine Datei dabei, oder sie ist leer.',
      datei_unbekannt: FASSUNG.datei_unbekannt,
      datei_nicht_erlaubt: FASSUNG.datei_nicht_erlaubt,
      datei_widerspruch: FASSUNG.datei_widerspruch,
      datei_zu_gross: FASSUNG.datei_zu_gross,
      datei_metadaten: FASSUNG.datei_metadaten,
      titel_fehlt:
        'Der Titel ist Pflicht. Ein Dokument ohne Titel findet in der Ablage niemand wieder — '
        + 'auch nicht mit der Volltextsuche, denn die sucht darin.',
      titel_zu_lang: 'Der Titel fasst 200 Zeichen.',
      kategorie_unbekannt:
        'Bitte eine der Kategorien wählen. DOC-01 nennt genau neun, und an der Kategorie hängt '
        + 'die Aufbewahrungsfrist — eine zehnte hiesse, eine Frist zu erfinden.',
      beschreibung_zu_lang: 'Die Beschreibung fasst 2000 Zeichen.',
      kunde_unbekannt:
        'Diesen Kunden gibt es in dieser Gesellschaft nicht — die Auswahl zeigt die, die diese '
        + 'Sitzung sieht.',
      objekt_unbekannt:
        'Dieses Objekt gibt es in dieser Gesellschaft nicht — die Auswahl zeigt die, die diese '
        + 'Sitzung sieht.',
      auftrag_unbekannt:
        'Diesen Auftrag gibt es in dieser Gesellschaft nicht — oder diese Sitzung sieht ihn '
        + 'nicht.',
    },
    sonst: 'Die Ablage ist nicht erfolgt.',
  },
};
