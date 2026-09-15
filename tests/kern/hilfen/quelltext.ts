/**
 * Quelltext ohne Kommentare und ohne Zeichenketten.
 *
 * **Warum es das gibt.** Zwei Prüfungen lesen Quelltext, statt einen
 * Syntaxbaum zu bauen — `routen.test.ts` sucht den Aufruf von `authorize`,
 * `keks-sicherheit.test.ts` sucht ein direktes `process.env.X`. Beide haben
 * dieselbe Schwäche: das Gesuchte steht irgendwann in einem Kommentar, der
 * ERKLÄRT, warum man es nicht schreiben soll — und die Prüfung hält den
 * Erklärtext für den Verstoss. Beim ersten Mal ist das ein Fehlalarm, beim
 * zweiten schreibt jemand die Prüfung weicher, und dann findet sie nichts mehr.
 *
 * Ein Parser wäre ein zweiter Compiler mit eigenen Fehlern. Das hier ist die
 * kleine, ehrliche Fassung: Kommentare und Zeichenketten fallen weg, alles
 * andere bleibt stehen. Was danach übrig ist, ist Code.
 */
export function ohneKommentare(quelle: string): string {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    // `[^:]` davor: sonst frisst die Regel `https://…` mitten in einer Zeile
    // und mit ihr den Rest der Zeile.
    .replace(/(^|[^:])\/\/[^\n]*/gu, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/gu, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/gu, '""')
    .replace(/`(?:[^`\\]|\\.)*`/gu, '``');
}
