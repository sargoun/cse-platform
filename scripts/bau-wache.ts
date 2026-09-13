/**
 * Zwei Next-Server teilen sich EIN `.next` — und der zweite loescht dem
 * ersten den Boden unter den Fuessen.
 *
 * **Der Ausfall, gegen den das geschrieben ist, ist auf einem Telefon
 * aufgeschlagen.** Auf dem Entwicklungsrechner lief noch ein `next dev` von
 * gestern (er meldete sich nur als `EADDRINUSE`, das jeder wegklickt), danach
 * lief `pnpm build`. Der Bau schreibt dasselbe Verzeichnis, das der laufende
 * Entwicklungsserver ausliefert: `.next/static/css/app/layout.css` gab es
 * danach nicht mehr, der Server lieferte 404 darauf, und die Seite kam im
 * Browser an — mit HTML, mit den Bildern aus `public/`, und OHNE eine einzige
 * Zeile CSS. Times New Roman, blaue unterstrichene Verweise, Aufzaehlpunkte.
 * Kein Fehler, keine Meldung, keine rote Zeile irgendwo: nur eine Seite, die
 * aussieht wie 1998.
 *
 * **Und die Gegenrichtung ist genauso still.** Ein `next dev`, das startet,
 * waehrend ein `next start` laeuft, raeumt den Produktionsbau weg; der
 * laufende Server antwortet danach mit „Could not find a production build".
 *
 * **Warum ein Waechter und nicht getrennte Verzeichnisse.** `distDir` je nach
 * `NODE_ENV` waere die strukturelle Loesung — sie faellt an `typedRoutes`:
 * Next schreibt `next-env.d.ts` samt Pfad auf das jeweilige Verzeichnis um,
 * und `tsconfig.json` zieht `<distDir>/types` herein. Zwei Verzeichnisse
 * hiessen entweder zwei konkurrierende `routes.d.ts` (doppelte Deklarationen)
 * oder ein `pnpm typecheck`, dessen Ergebnis davon abhaengt, welcher Befehl
 * zuletzt lief. Der Waechter kostet eine Sekunde und sagt, was zu tun ist.
 *
 * Notausgang: `CSE_BAU_OHNE_WACHE=1` — fuer den Fall, dass auf 3000 ein
 * fremdes Projekt antwortet. Wer ihn setzt, weiss warum.
 */

/** Die Haefen, auf denen dieses Projekt laeuft: `pnpm dev` und die Nachbarn. */
function haefen(): number[] {
  const roh = [process.env['PORT'], '3000', '3001'];
  const zahlen = roh
    .map((h) => Number.parseInt(h ?? '', 10))
    .filter((h) => Number.isInteger(h) && h > 0 && h < 65_536);
  return [...new Set(zahlen)];
}

/**
 * Antwortet auf diesem Hafen ein Server DIESES Projekts?
 *
 * Geprueft wird `/healthz` — die einzige Route, die keine Datenbank, keine
 * Sitzung und keine Berechtigung braucht (`route-ohne-db`), und deren Antwort
 * ein fremder Dienst auf 3000 nicht zufaellig nachbildet.
 */
export async function cseServerAufHafen(hafen: number, frist = 900): Promise<boolean> {
  const steuerung = new AbortController();
  const uhr = setTimeout(() => { steuerung.abort(); }, frist);
  try {
    const antwort = await fetch(`http://127.0.0.1:${hafen}/healthz`, {
      signal: steuerung.signal, cache: 'no-store',
    });
    if (!antwort.ok) return false;
    const inhalt = (await antwort.json()) as { status?: unknown };
    return inhalt.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(uhr);
  }
}

/** Der erste belegte Hafen — oder `null`, wenn keiner antwortet. */
export async function laufenderServer(): Promise<number | null> {
  for (const hafen of haefen()) {
    // Nacheinander und nicht gleichzeitig: drei Verbindungen auf einen
    // schlafenden Hafen kosten nichts, aber die Reihenfolge der Meldung soll
    // die Reihenfolge der Haefen sein.
    if (await cseServerAufHafen(hafen)) return hafen;
  }
  return null;
}

export function meldung(modus: string, hafen: number): string {
  const was = modus === 'dev'
    ? 'Ein Entwicklungsserver raeumt `.next` neu auf'
    : 'Der Bau ueberschreibt `.next`';
  return [
    '',
    `  Auf Hafen ${hafen} laeuft bereits ein Server dieses Projekts.`,
    '',
    `  ${was} — und der laufende Server liefert danach seine eigenen`,
    '  Dateien nicht mehr aus. Das faellt nirgends auf: die Seite kommt,',
    '  aber ohne CSS und ohne JavaScript (Times New Roman, blaue Verweise,',
    '  kein Menue). Genau dieser Zustand ist schon einmal auf einem Telefon',
    '  gelandet.',
    '',
    '  Zuerst den laufenden Server beenden:',
    '',
    '    Windows (PowerShell):',
    `      Get-NetTCPConnection -LocalPort ${hafen} -State Listen |`,
    '        Select-Object -ExpandProperty OwningProcess |',
    '        ForEach-Object { Stop-Process -Id $_ -Force }',
    '',
    '    macOS / Linux:',
    `      kill $(lsof -t -i :${hafen})`,
    '',
    `  Danach denselben Befehl noch einmal. (Notausgang: CSE_BAU_OHNE_WACHE=1)`,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  if ((process.env['CSE_BAU_OHNE_WACHE'] ?? '') !== '') return;
  const modus = process.argv[2] ?? 'bau';
  const hafen = await laufenderServer();
  if (hafen === null) return;
  console.error(meldung(modus, hafen));
  process.exit(1);
}

// Nur ausfuehren, wenn direkt aufgerufen — der Test importiert die Funktionen.
if (process.argv[1] !== undefined && process.argv[1].endsWith('bau-wache.ts')) {
  void main();
}
