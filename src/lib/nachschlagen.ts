/**
 * Ein Eintrag einer Nachschlagetabelle — nur, wenn der Schlüssel der Tabelle
 * SELBST gehört (V-159, D-653).
 *
 * **Der Befund.** Die Seiten schlagen den Grund einer Abweisung, der als
 * `?fehler=<grund>` in der Adresse zurückkommt, in einem gewöhnlichen
 * Objektliteral nach: `TEXTE[grund] ?? SONST`. Ein Objektliteral erbt aber von
 * `Object.prototype`. `?fehler=__proto__` fand deshalb `Object.prototype`
 * selbst, `?fehler=toString` die Funktion dahinter — beides ist nicht
 * `undefined`, also griff der Rückfall nicht, und der Typ behauptete weiter
 * `string`. React weigert sich, ein Objekt als Kind zu zeigen: die öffentlichen
 * Karriereseiten antworteten auf eine Adresse, die jeder tippen kann, mit einer
 * Fehlerseite (500), und `?fehler=toString` zeigte einen leeren Alarmkasten.
 *
 * **`Object.hasOwn` und nicht `in`**: `in` läuft die Prototypenkette hoch,
 * genau wie der Zugriff selbst (dieselbe Begründung wie `lib/design/icons.ts`).
 *
 * Ein Schlüssel, der keine Zeichenkette ist (`string[]` aus einem doppelten
 * Parameter, `undefined`), findet nichts — der Aufrufer entscheidet dann über
 * seinen allgemeinen Satz, und nie wird der rohe Schlüssel angezeigt.
 */
export function eigenerEintrag<T>(
  tabelle: Readonly<Record<string, T>>, schluessel: unknown,
): T | undefined {
  if (typeof schluessel !== 'string') return undefined;
  return Object.hasOwn(tabelle, schluessel) ? tabelle[schluessel] : undefined;
}
