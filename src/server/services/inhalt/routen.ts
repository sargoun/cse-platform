/**
 * Die oeffentlichen Routen (PUB-01).
 *
 * Eine Liste und keine Dateibaum-Konvention: der Test iteriert sie und
 * verlangt fuer jede eine `seite`-Zeile. Eine Route, die es im Code gibt und
 * in der Datenbank nicht, rendert leer — und leer sieht aus wie "noch nicht
 * fertig", nicht wie "kaputt".
 */

export interface OeffentlicheRoute {
  readonly pfad: string;
  readonly titel: string;
  /** Gehoert die Seite einem Bereich, oder der Gruppe? */
  readonly bereich: string | null;
}

export const OEFFENTLICHE_ROUTEN: readonly OeffentlicheRoute[] = [
  { pfad: '/', titel: 'CSE Gruppe — Reinigung, Sicherheit, Bau in Berlin', bereich: null },
  { pfad: '/unternehmen', titel: 'Unternehmen', bereich: null },
  { pfad: '/leistungen', titel: 'Leistungen', bereich: null },
  { pfad: '/projekte', titel: 'Projekte', bereich: null },
  { pfad: '/ueber-uns', titel: 'Über uns', bereich: null },
  { pfad: '/news', titel: 'Aktuelles', bereich: null },
  { pfad: '/kontakt', titel: 'Kontakt', bereich: null },
  { pfad: '/impressum', titel: 'Impressum', bereich: null },
  { pfad: '/datenschutz', titel: 'Datenschutz', bereich: null },
  { pfad: '/reinigung', titel: 'CSE Dienstleistung — Gebäudereinigung', bereich: 'reinigung' },
  { pfad: '/security', titel: 'SSE Security — Sicherheitsdienste', bereich: 'security' },
  { pfad: '/bau', titel: 'REALTIME Service — Hochbau, Ausbau, Rückbau', bereich: 'bau' },
  { pfad: '/operations', titel: 'CSE Operations — Digitale Abläufe', bereich: 'operations' },
];
