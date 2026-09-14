/**
 * Ist das eine Kennung? — die Wache vor jeder `where id = $1::uuid`.
 *
 * Ein Wort im Pfad (`/buchungen/not-a-uuid`) erreicht sonst PostgreSQL, der
 * die Umwandlung mit `22P02` abweist, und aus dem 404, das die Seite meint,
 * wird ein 500. Dieselbe Prüfung stand in acht Dateien als eigener Ausdruck;
 * hier steht sie einmal.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function istUuid(wert: unknown): wert is string {
  return typeof wert === 'string' && UUID.test(wert);
}
