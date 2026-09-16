/**
 * Name und Lebensdauer des Übergabe-Kekses für eine frisch ausgegebene
 * Check-in-Marke (TIM-09).
 *
 * **Warum eine eigene Datei ohne einen einzigen Import.** Drei Stellen
 * brauchen diese Angaben: die Route, die den Keks setzt, die Seite, die ihn
 * liest, und die **Middleware**, die ihn wieder wegnimmt. Die Middleware läuft
 * in der Edge-Laufzeit; zöge sie `api/checkin-marken/keks.ts` herein, käme
 * über `keksSicher` → `server/auth/sitzung` der halbe Serverbaum mit, und der
 * Bau bräche. Ein Blatt ohne Imports kann jeder von ihnen holen.
 */

/** Der Keksname. */
export const MARKE_KEKS = 'cse_checkin_marke';

/** So lange darf die Übergabe offen stehen. */
export const MARKE_GUELTIG_MINUTEN = 10;

/**
 * Der Pfad des Kekses — er muss beim Löschen GENAU derselbe sein wie beim
 * Setzen, sonst löscht der Browser einen anderen Keks (nämlich keinen) und
 * behält den, der gemeint war.
 */
export const MARKE_KEKS_PFAD = '/portal';
