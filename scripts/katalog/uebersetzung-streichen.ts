/**
 * Streicht aus der Ausnahmeliste, was fertig ist — und NUR das.
 *
 * **Das Werkzeug kann die Liste nicht wachsen lassen.** Es liest die
 * bestehenden Eintraege und behaelt die, die noch eine feste Beschriftung
 * haben; eine Datei, die nicht schon drinsteht, kommt nie dazu. Damit ist die
 * Regel „schrumpfen, nie wachsen" nicht eine Bitte an den, der sie pflegt,
 * sondern eine Eigenschaft des Werkzeugs.
 *
 *   pnpm uebersetzung:streichen
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { festeZeichenketten } from '../guards/seite-ohne-uebersetzung.js';
import { UEBERSETZUNG_AUSNAHMEN } from '../guards/uebersetzung-ausnahmen.js';

const DATEI = 'scripts/guards/uebersetzung-ausnahmen.ts';

function main(): void {
  const bleibt: string[] = [];
  const weg: string[] = [];
  for (const pfad of UEBERSETZUNG_AUSNAHMEN) {
    let funde: readonly unknown[];
    try {
      funde = festeZeichenketten(pfad);
    } catch {
      // Die Datei gibt es nicht mehr — dann gehoert die Zeile erst recht weg.
      weg.push(pfad);
      continue;
    }
    if (funde.length > 0) bleibt.push(pfad); else weg.push(pfad);
  }

  if (weg.length === 0) {
    console.log(`Nichts zu streichen — alle ${bleibt.length} Eintraege tragen noch Text.`);
    return;
  }

  const inhalt = readFileSync(DATEI, 'utf8');
  const kopf = inhalt.slice(0, inhalt.indexOf('export const UEBERSETZUNG_AUSNAHMEN'));
  writeFileSync(DATEI,
    `${kopf}export const UEBERSETZUNG_AUSNAHMEN: readonly string[] = [\n`
    + bleibt.map((p) => `  '${p}',\n`).join('')
    + '];\n');

  console.log(`${weg.length} Eintrag/Eintraege gestrichen, ${bleibt.length} bleiben:`);
  for (const p of weg) console.log(`  − ${p}`);
}

main();
