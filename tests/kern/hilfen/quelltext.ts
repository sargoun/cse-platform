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
/**
 * **Ein Durchgang von links nach rechts — keine Kette von Ersetzungen.**
 *
 * Vorher fielen erst die Kommentare, dann die Zeichenketten. Das ist die
 * falsche Reihenfolge, und zwar auf eine Weise, die eine SICHERHEITSPRUEFUNG
 * blind macht: in
 *
 *     const marke = 'x//y'; await authorize(...);
 *
 * schlaegt die `//`-Regel INNERHALB der Zeichenkette zu und frisst den Rest
 * der Zeile — samt `authorize`. `routen.test.ts` haelt die Route danach fuer
 * unbewacht oder, schlimmer, findet den Aufruf nicht und meldet nichts, weil
 * die Zeile gar nicht mehr da ist.
 *
 * Die umgekehrte Reihenfolge hat denselben Fehler spiegelbildlich: ein
 * Anfuehrungszeichen in einem Kommentar (`// der Kunde's Name`) liesse die
 * Zeichenkettenregel ueber den halben Rest der Datei laufen.
 *
 * Beides verschwindet mit einem einzigen Zustandsautomaten: an jeder Stelle
 * weiss er, ob er in Code, in einem Kommentar oder in einer Zeichenkette
 * steht. Das ist kein Parser — er kennt weder Ausdruecke noch Bloecke —, aber
 * er kennt genau die vier Zustaende, um die es hier geht.
 */
export function ohneKommentare(quelle: string): string {
  let aus = '';
  let i = 0;
  const n = quelle.length;
  while (i < n) {
    const c = quelle[i]!;
    const d = quelle[i + 1];
    if (c === '/' && d === '*') {
      const ende = quelle.indexOf('*/', i + 2);
      aus += ' ';
      i = ende === -1 ? n : ende + 2;
      continue;
    }
    if (c === '/' && d === '/') {
      const ende = quelle.indexOf('\n', i);
      aus += ' ';
      i = ende === -1 ? n : ende;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      /*
       * Die leere Huelle bleibt stehen (`''`), damit aus `a = 'x'` nicht
       * `a =` wird: eine Pruefung, die auf eine Zuweisung sieht, braucht die
       * rechte Seite als Zeichen, nur nicht als Inhalt.
       */
      aus += c + c;
      i += 1;
      while (i < n) {
        const z = quelle[i]!;
        if (z === '\\') { i += 2; continue; }
        if (z === c) { i += 1; break; }
        // Eine einfache oder doppelte Quote endet spaetestens am Zeilenende;
        // ein Backtick darf ueber Zeilen gehen.
        if (z === '\n' && c !== '`') break;
        i += 1;
      }
      continue;
    }
    aus += c;
    i += 1;
  }
  return aus;
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
