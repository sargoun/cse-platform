/**
 * `{name}` in einer Textvorlage ersetzen — für die wenigen Sätze mit einer
 * Zahl oder einem Namen (V-198, V-200).
 *
 * **Eine eigene Datei ohne Einfuhr.** Auch eine Client-Komponente setzt eine
 * Zahl in ihren Satz ein (die Stempeluhr die wartenden Einträge). Stünde die
 * Funktion neben den Tabellen der Portalsprachen, reiste die ganze
 * Übersetzung des Portals ins Telefon — für eine Zeile.
 *
 * Ein Name, den die Werte nicht kennen, bleibt stehen, wie er ist; nachgesehen
 * wird nur im Objekt selbst, nie in seinem Prototyp (`{constructor}`).
 */
export function setzeEin(vorlage: string, werte: Readonly<Record<string, string>>): string {
  return vorlage.replace(/\{(\w+)\}/gu, (ganz, name: string) =>
    (Object.hasOwn(werte, name) ? (werte[name] ?? ganz) : ganz));
}
