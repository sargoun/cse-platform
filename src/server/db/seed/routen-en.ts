/**
 * Die englischen Seitentitel — je Pfad einer.
 *
 * Sie stehen NICHT in `OEFFENTLICHE_ROUTEN`: diese Liste sagt, welche Routen
 * es gibt, und das ist unabhaengig von der Sprache. Zwei Titelspalten in einer
 * Routenliste waeren der erste Schritt zu zwei Routenlisten.
 *
 * Ein Pfad ohne Eintrag behaelt seinen deutschen Titel — sichtbar unuebersetzt
 * statt stillschweigend falsch. Dass keiner fehlt, prueft `tests/kern/i18n.test.ts`.
 */
export const TITEL_EN: Readonly<Record<string, string>> = {
  '/': 'CSE Group — cleaning, security and construction in Berlin',
  '/unternehmen': 'Companies',
  '/leistungen': 'Services',
  '/projekte': 'Projects',
  '/ueber-uns': 'About us',
  '/news': 'News',
  '/kontakt': 'Contact',
  '/impressum': 'Legal notice',
  '/datenschutz': 'Privacy',
  '/reinigung': 'CSE Dienstleistung — building cleaning',
  '/security': 'SSE Security — security services',
  '/bau': 'REALTIME Service — structural work, fit-out, demolition',
  '/operations': 'CSE Operations — digital processes',
};
