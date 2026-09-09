/**
 * Erzeugt `docs/ANNAHMEN.md` aus `src/lib/annahmen.ts`.
 *
 *   pnpm annahmen          schreibt das Dokument
 *   pnpm annahmen --check  scheitert, wenn es veraltet ist
 *
 * **Warum erzeugt und nicht gepflegt.** Das Dokument ist die Liste, die der
 * Mandant durchgeht; das Register ist das, was die Anwendung tatsächlich tut.
 * Zwei von Hand gepflegte Fassungen laufen auseinander, und die gefährlichere
 * Richtung ist die stille: im Dokument steht 24 Stunden, im Code stehen 48,
 * und beim Gespräch bestätigt jemand eine Zahl, die nirgends gilt.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ANNAHMEN, OFFEN_GEBLIEBEN, type Annahme } from '../src/lib/annahmen.js';

const WURZEL = resolve(import.meta.dirname, '..');
export const ZIEL = join(WURZEL, 'docs/ANNAHMEN.md');

const BEREICHE: Readonly<Record<Annahme['bereich'], string>> = {
  inhalt: 'Texte und Inhalte',
  formular: 'Formulare',
  frist: 'Fristen und Abläufe',
  marke: 'Marke und Auftritt',
  technik: 'Technik',
  recht: 'Rechtliches',
};

const FOLGE: Readonly<Record<Annahme['folge'], string>> = {
  korrigierbar: 'Ein Wert wird geändert, sonst nichts.',
  nacharbeit: 'Texte oder Daten müssen nachgezogen werden.',
};

export function erzeuge(): string {
  const z: string[] = [];

  z.push('# Was wir angenommen haben — und was Sie entscheiden müssen');
  z.push('');
  z.push('> **Diese Datei wird erzeugt.** Sie entsteht aus `src/lib/annahmen.ts`,');
  z.push('> also aus dem, was die Anwendung wirklich tut. Bitte hier nicht');
  z.push('> direkt ändern — sonst stimmt das Dokument und die Software nicht.');
  z.push('');
  z.push('Damit Sie das Projekt ansehen können, bevor alle Fragen beantwortet');
  z.push('sind, hat jede offene Stelle einen **vorläufigen Wert**. Keiner davon');
  z.push('ist geraten und dann vergessen worden: jeder steht hier, mit der Frage');
  z.push('daneben, die ihn ersetzt.');
  z.push('');
  z.push('Wenn Sie antworten, ändert sich **eine Datei** — nicht dreissig');
  z.push('Stellen im Code, von denen man siebenundzwanzig findet.');
  z.push('');

  z.push(`## Die ${String(ANNAHMEN.length)} vorläufigen Werte`);
  z.push('');
  for (const [schluessel, titel] of Object.entries(BEREICHE)) {
    const gruppe = ANNAHMEN.filter((a) => a.bereich === schluessel);
    if (gruppe.length === 0) continue;
    z.push(`### ${titel}`);
    z.push('');
    for (const a of gruppe) {
      z.push(`#### ${a.frage}`);
      z.push('');
      z.push(`**Angenommen:** ${a.annahme}`);
      z.push('');
      z.push(`**Ihre Entscheidung:** ${a.zuKlaeren}`);
      z.push('');
      z.push(`**Wirkt sich aus auf:** ${a.wirktIn.join(' · ')}`);
      z.push('');
      z.push(`**Wenn es anders ist:** ${FOLGE[a.folge]}`);
      z.push('');
    }
  }

  z.push('---');
  z.push('');
  z.push('## Was wir bewusst NICHT vorbelegt haben');
  z.push('');
  z.push('Diese Punkte lassen sich nicht zurücknehmen, wenn die Annahme falsch');
  z.push('war. Ein vorläufiger Wert wäre hier kein Platzhalter, sondern ein');
  z.push('Schaden, den man nachträglich nicht wegräumt. Sie bleiben sichtbar');
  z.push('offen, und die betroffene Funktion bleibt gesperrt.');
  z.push('');
  for (const o of OFFEN_GEBLIEBEN) {
    z.push(`- **${o.frage}** — ${o.grund}`);
  }
  z.push('');
  z.push('---');
  z.push('');
  z.push('## So geht es weiter');
  z.push('');
  z.push('1. Sie gehen diese Liste durch und antworten — auch ein „passt so" ist');
  z.push('   eine Antwort, und dann ist der Wert keine Annahme mehr, sondern');
  z.push('   eine Entscheidung.');
  z.push('2. Wir tragen die Antworten in `src/lib/annahmen.ts` ein.');
  z.push('3. Für die gesperrten Punkte oben wird die jeweilige Funktion');
  z.push('   freigeschaltet — Rechnungen zum Beispiel erst, wenn der');
  z.push('   Nummernkreis bestätigt ist.');
  z.push('');

  return `${z.join('\n')}\n`;
}

const pruefen = process.argv.includes('--check');
const erwartet = erzeuge();

if (pruefen) {
  const vorhanden = (() => {
    try { return readFileSync(ZIEL, 'utf8'); } catch { return ''; }
  })();
  if (vorhanden !== erwartet) {
    process.stderr.write('docs/ANNAHMEN.md ist veraltet. `pnpm annahmen` ausführen.\n');
    process.exit(1);
  }
  process.stdout.write('docs/ANNAHMEN.md ist aktuell.\n');
} else {
  writeFileSync(ZIEL, erwartet);
  process.stdout.write(
    `geschrieben: ${ZIEL} (${String(ANNAHMEN.length)} Annahmen, `
    + `${String(OFFEN_GEBLIEBEN.length)} bewusst offen)\n`,
  );
}
