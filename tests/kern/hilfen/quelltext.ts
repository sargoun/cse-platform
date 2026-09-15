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

/**
 * Dasselbe für PowerShell — `<# … #>` und `# …`.
 *
 * **Warum es das braucht.** Eine Prüfung über `scripts/windows-start.ps1`
 * suchte `pnpm build` und fand es zuerst im Kopfkommentar, das ERKLÄRT, warum
 * `pnpm build` beim zweiten Anlauf abbrach. Genau die Falle, die
 * `ohneKommentare` oben für TypeScript schon abräumt — und beim ersten Mal
 * fällt man in beide getrennt hinein.
 *
 * Zeichenketten bleiben hier stehen: in einem Skript sind die Befehle selbst
 * oft in Anführungszeichen (`Write-Host "pnpm build"`), und sie wegzuwerfen
 * nähme der Prüfung mehr, als sie gewinnt.
 */
export function ohnePsKommentare(quelle: string): string {
  return quelle
    .replace(/<#[\s\S]*?#>/gu, ' ')
    // `#` in `$env:X#…` gibt es nicht, aber ein `#` mitten in einer
    // Zeichenkette schon — deshalb nur am Zeilenanfang oder nach Leerraum.
    .replace(/(^|\s)#[^\n]*/gu, '$1 ');
}
