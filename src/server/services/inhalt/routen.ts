/**
 * Die oeffentlichen Routen (PUB-01).
 *
 * **Die Unternehmensprofile liegen unter `/unternehmen/<slug>`**, so wie
 * `04-SEITENKARTE.md` §2.2 sie fuehrt. PR 16 lieferte sie als vier kurze
 * Adressen auf oberster Ebene aus — kuerzer, und in einem Punkt schlechter:
 * jeder neue Bereich haette dort mit einer Seite kollidieren koennen, und die
 * Karte verweist an rund einem Dutzend Stellen auf den langen Pfad. Solange
 * O-08 offen ist und keine Domain lebt, kostet die Angleichung nichts; nach
 * dem ersten Deployment waere sie eine Weiterleitung fuer immer.
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
  { pfad: '/unternehmen/reinigung', titel: 'CSE Dienstleistung — Gebäudereinigung', bereich: 'reinigung' },
  { pfad: '/unternehmen/security', titel: 'SSE Security — Sicherheitsdienste', bereich: 'security' },
  { pfad: '/unternehmen/bau', titel: 'REALTIME Service — Hochbau, Ausbau, Rückbau', bereich: 'bau' },
  { pfad: '/unternehmen/operations', titel: 'CSE Operations — Digitale Abläufe', bereich: 'operations' },
];
