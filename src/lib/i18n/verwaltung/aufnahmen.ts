/**
 * Aufnahmen in der Verwaltung — die Liste der Fotos an einer Wachbuchseite
 * und an einer Schicht, in beiden Sprachen (SEC-05, TIM-10, V-181, D-592).
 *
 * Eine Tabelle für BEIDE Stellen (Wachbuchblatt, Schichtblatt), weil beide
 * dieselbe Liste zeigen (`components/portal/Aufnahmeliste.tsx`): signierte
 * Links, Serverzeit, und der Grund, wo kein Link entstehen konnte.
 */
import type { InternSprache } from '../intern.js';

/** Was die Liste selbst spricht. */
export interface AufnahmelisteTexte {
  readonly fotoOeffnen: (nummer: number) => string;
  readonly fotoNummer: (nummer: number) => string;
  readonly fotoOhneAdresse: string;
  readonly fotoEntfernt: string;
  readonly fotoErfasst: (zeit: string) => string;
}

export interface AufnahmenTexte extends AufnahmelisteTexte {
  /** Über der Liste, wenn der Speicher nicht verbunden ist. */
  readonly speicherFehlt: string;
  readonly schichtAufnahmen: string;
  /** Der Satz unter der Überschrift auf dem Schichtblatt. */
  readonly schichtAufnahmenHinweis: string;
}

export const AUFNAHMEN_TEXTE: Readonly<Record<InternSprache, AufnahmenTexte>> = {
  de: {
    fotoOeffnen: (nummer) => `Foto ${String(nummer)} öffnen`,
    fotoNummer: (nummer) => `Foto ${String(nummer)}`,
    fotoOhneAdresse: 'gespeichert, gerade nicht anzeigbar',
    fotoEntfernt: 'Datei nach Ablauf der Aufbewahrung entfernt — der Nachweis, dass es sie '
      + 'gab, bleibt.',
    fotoErfasst: (zeit) => `erfasst ${zeit} (Serverzeit)`,
    speicherFehlt: 'Der Medienspeicher ist nicht verbunden — die Aufnahmen sind gespeichert, '
      + 'lassen sich aber gerade nicht öffnen.',
    schichtAufnahmen: 'Aufnahmen der Schicht',
    schichtAufnahmenHinweis: 'Was die eingeteilten Kräfte während dieser Schicht im '
      + 'Mitarbeiterportal unter „Fotos" aufgenommen haben — ohne Ortsdaten, mit Serverzeit.',
  },
  en: {
    fotoOeffnen: (nummer) => `Open photo ${String(nummer)}`,
    fotoNummer: (nummer) => `Photo ${String(nummer)}`,
    fotoOhneAdresse: 'saved, cannot be shown right now',
    fotoEntfernt: 'File removed after the retention period — the record that it existed '
      + 'remains.',
    fotoErfasst: (zeit) => `recorded ${zeit} (server time)`,
    speicherFehlt: 'The media storage is not connected — the photos are saved but cannot be '
      + 'opened right now.',
    schichtAufnahmen: 'Photos of the shift',
    schichtAufnahmenHinweis: 'What the assigned staff recorded under "Photos" in the employee '
      + 'portal during this shift — without location data, with server time.',
  },
};
