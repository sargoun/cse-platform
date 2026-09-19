/**
 * Was traegt diese Datei noch fest verdrahtet? — die Selbstauskunft der
 * Sperrklinke, Datei fuer Datei.
 *
 * Die Wache im Merge-Lauf sagt nur ja oder nein. Wer eine Seite umstellt,
 * braucht die LISTE: welche Zeile fehlt noch. Dafuer ist das hier.
 *
 *   pnpm uebersetzung:pruefen "src/app/portal/[mandant]/finanzen/rechnungen/page.tsx"
 *   pnpm uebersetzung:pruefen src/app/portal/[mandant]/finanzen   # ganzer Ordner
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { festeZeichenketten } from '../guards/seite-ohne-uebersetzung.js';

function tsxUnter(pfad: string): string[] {
  if (statSync(pfad).isFile()) return pfad.endsWith('.tsx') ? [pfad] : [];
  return readdirSync(pfad).flatMap((e) => (e === 'node_modules' ? [] : tsxUnter(join(pfad, e))));
}

const ziele = process.argv.slice(2);
if (ziele.length === 0) {
  console.error('Pfad(e) angeben.');
  process.exit(2);
}

let gesamt = 0;
for (const ziel of ziele) {
  for (const datei of tsxUnter(ziel)) {
    const funde = festeZeichenketten(datei);
    if (funde.length === 0) continue;
    gesamt += funde.length;
    console.log(`\n${datei}  (${funde.length})`);
    for (const f of funde) console.log(`  ${String(f.zeile).padStart(4)}: ${f.text}`);
  }
}
console.log(gesamt === 0 ? '\nFertig — nichts mehr fest verdrahtet.' : `\n${gesamt} Fundstelle(n).`);
