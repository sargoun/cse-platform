/**
 * Der Stand der Seitenkarte: welche Route der Karte hat eine Seite, welche
 * faellt auf „Dieses Modul wird noch gebaut", welche hat gar nichts.
 *
 *   pnpm seitenkarte:stand
 *
 * **Warum das ein Skript ist und keine Tabelle in einem Dokument.** Eine
 * Tabelle waere am Tag ihrer Niederschrift richtig und danach eine
 * Behauptung. Dieses Skript liest die Karte (`routen.generiert.ts`) und den
 * Dateibaum (`src/app`) und sagt, was JETZT gilt — je Phase: gebaut,
 * Platzhalter (der `[...rest]`-Fang), ohne Seite (ein 404, den niemand
 * beabsichtigt hat). Die Haken der ROADMAP meinen die Abnahmekriterien der
 * PRs; diese Zahl meint die Karte. Beides ist wahr, und nur die zweite sagt,
 * was eine Auftraggeberin anklicken kann.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { ROUTEN } from '../../src/server/registry/routen.generiert.js';

const APP = resolve(import.meta.dirname, '../../src/app');
type Muster = { readonly teile: readonly string[]; readonly art: 'seite' | 'fang' | 'fang_optional' };
const muster: Muster[] = [];
function lauf(dir: string, teile: string[]): void {
  for (const e of readdirSync(dir)) {
    const voll = join(dir, e);
    if (statSync(voll).isDirectory()) {
      if (e.startsWith('(')) { lauf(voll, teile); continue; }
      if (e.startsWith('[[...')) { lauf(voll, [...teile, '[[...]]']); continue; }
      if (e.startsWith('[...')) { lauf(voll, [...teile, '[...]']); continue; }
      if (e.startsWith('[')) { lauf(voll, [...teile, '[*]']); continue; }
      lauf(voll, [...teile, e]);
    } else if (e === 'page.tsx' || e === 'route.ts') {
      /**
       * **`route.ts` zaehlt genauso.** Die Karte fuehrt Adressen, nicht
       * Dateinamen — und einige davon SIND Route Handler und keine Seiten:
       * `/auth/abmelden` ist ausdruecklich „route handler, POST only",
       * `/auth/callback` ebenso, dazu `/sitemap.xml` und `/robots.txt`. Sie
       * standen als „ohne Seite" in der Bilanz, obwohl sie gebaut waren, und
       * eine Bilanz, die gebaute Adressen als fehlend fuehrt, taugt nicht als
       * Bilanz.
       */
      const letzte = teile.at(-1);
      const art = letzte === '[...]' ? 'fang' : letzte === '[[...]]' ? 'fang_optional' : 'seite';
      muster.push({ teile: art === 'seite' ? teile : teile.slice(0, -1), art });
    }
  }
}
lauf(APP, []);

function passt(m: Muster, pfad: readonly string[]): boolean {
  if (m.art === 'seite') {
    if (m.teile.length !== pfad.length) return false;
    return m.teile.every((t, i) => t === '[*]' || t === pfad[i]);
  }
  // Fänge: Präfix muss passen; optionaler Fang deckt auch die Wurzel selbst
  if (pfad.length < m.teile.length) return false;
  if (m.art === 'fang' && pfad.length === m.teile.length) return false;
  return m.teile.every((t, i) => t === '[*]' || t === pfad[i]);
}

/**
 * `dynamisch`: ein LITERAL der Karte (`/freigaben/stapel`) landet in einer
 * dynamischen Seite (`/freigaben/[id]`). Das ist keine gebaute Seite — die
 * dynamische antwortet bestenfalls 404 —, ausser bei den Inhaltsseiten der
 * Website (`/[seite]`), wo der Inhalt entscheidet.
 */
type Stand = 'gebaut' | 'dynamisch' | 'platzhalter' | 'nichts';
function passtGenau(m: Muster, pfad: readonly string[]): boolean {
  return passt(m, pfad) && m.teile.every((t, i) => t !== '[*]' || pfad[i] === '[*]');
}
function stand(pfad: string): Stand {
  const teile = pfad.split('/').filter(Boolean).map((t) => (t.startsWith('[') ? '[*]' : t));
  const genau = muster.filter((m) => passtGenau(m, teile));
  if (genau.some((m) => m.art === 'seite' || m.art === 'fang_optional')) return 'gebaut';
  const treffer = muster.filter((m) => passt(m, teile));
  if (treffer.some((m) => m.art === 'seite' || m.art === 'fang_optional')) return 'dynamisch';
  if (treffer.some((m) => m.art === 'fang')) return 'platzhalter';
  return 'nichts';
}

const jePhase = new Map<number, { gesamt: number; gebaut: number; dynamisch: number; platzhalter: number; nichts: number; offen: string[] }>();
for (const r of ROUTEN) {
  const s = stand(r.pfad);
  const p = jePhase.get(r.phase) ?? { gesamt: 0, gebaut: 0, dynamisch: 0, platzhalter: 0, nichts: 0, offen: [] };
  p.gesamt += 1; p[s] += 1;
  if (s !== 'gebaut') p.offen.push(`${r.pfad}${s === 'nichts' ? '  (KEIN Fang!)' : s === 'dynamisch' ? '  (dynamisch gefangen)' : ''} — ${r.beschreibung || r.abschnitt.slice(0, 40)}`);
  jePhase.set(r.phase, p);
}
console.log('Phase | Routen | gebaut | dynamisch | Platzhalter | ohne Seite');
for (const [ph, p] of [...jePhase.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`${String(ph).padStart(5)} | ${String(p.gesamt).padStart(6)} | ${String(p.gebaut).padStart(6)} | ${String(p.dynamisch).padStart(9)} | ${String(p.platzhalter).padStart(11)} | ${String(p.nichts).padStart(10)}`);
}
for (const [ph, p] of [...jePhase.entries()].sort((a, b) => a[0] - b[0])) {
  if (p.offen.length === 0) continue;
  console.log(`\n=== Phase ${String(ph)}: ${String(p.offen.length)} offen ===`);
  for (const o of p.offen) console.log('  ' + o);
}
