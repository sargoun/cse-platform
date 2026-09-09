/**
 * Welcher Bereich welches Formular hat — an EINER Stelle.
 *
 * Die Zuordnung stand in drei Dateien: in der Seite, in der Annahmeroute und
 * im Seed. Drei Kopien heissen, dass ein vierter Bereich in zweien landet und
 * in der dritten fehlt — und der Fehler zeigt sich als 404 auf einem Formular,
 * das es laut Datenbank gibt.
 */
export const FORMULAR_SCHLUESSEL: Readonly<Record<string, string>> = {
  reinigung: 'angebot_reinigung',
  security: 'angebot_security',
  bau: 'angebot_bau',
  operations: 'angebot_operations',
};

export function formularSchluessel(bereich: string): string | undefined {
  return FORMULAR_SCHLUESSEL[bereich];
}
