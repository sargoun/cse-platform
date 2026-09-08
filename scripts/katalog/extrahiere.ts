/**
 * Erzeugt den Rechtekatalog aus `03-AUTH-BERECHTIGUNGEN.md` §12.
 *
 * Der Katalog gehört diesem Dokument und nur ihm (K-19). Ihn abzutippen hiesse
 * eine zweite Quelle zu schaffen, die beim ersten Widerspruch gewinnt, ohne
 * dass jemand den Widerspruch sieht. Also wird er ausgelesen — mechanisch, aus
 * der Matrix, mit denselben Glyphen, die ein Mensch dort liest.
 *
 *   pnpm katalog          schreibt src/server/auth/katalog.generiert.ts
 *   pnpm katalog --check  scheitert, wenn die Datei veraltet ist
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WURZEL = resolve(import.meta.dirname, '../..');
export const QUELLE = join(WURZEL, 'docs/architecture/03-AUTH-BERECHTIGUNGEN.md');
export const ZIEL = join(WURZEL, 'src/server/auth/katalog.generiert.ts');

export const ROLLEN = ['super_admin', 'admin', 'leitung', 'mitarbeiter', 'kunde'] as const;
export type Rolle = (typeof ROLLEN)[number];

/** Die geschlossene Modulliste aus §7.4. 47 Namen, und nur diese. */
export const MODULE: readonly string[] = `
system gruppe oeffentlich datenschutz stammdaten personal dienstplan zeit crm crm_entgelt
objekt objekt_import katalog formular angebot kalkulation auftrag abrechnung reinigung nachweis
security dienstanweisung wachbuch schluessel bau qualitaet finanzen versand nummernkreis zahlung
mahnung eingang buchhaltung buchhaltung_konfiguration dokument radar vergabe agent wissen freigabe
referenz social recruiting kalender aufgabe nachricht bericht
`.trim().split(/\s+/u);

/** Das Aktionsvokabular aus §7.2 — der `berechtigung_aktion`-Enum. */
export const AKTIONEN: readonly string[] = `
lesen erstellen aendern schreiben loeschen exportieren importieren zuweisen
freigeben genehmigen entscheiden verwalten pruefen melden planen veroeffentlichen
versenden festschreiben stornieren korrigieren quittieren uebersteuern verbinden
einreichen anmelden widerrufen ziehen abschliessen archivieren bearbeiten beenden
bewerten erfassen erheben herunterladen pflegen rueckgaengig setzen starten
verwerfen zuruecksetzen zusammenfuehren
`.trim().split(/\s+/u);

export interface KatalogEintrag {
  readonly schluessel: string;
  readonly modul: string;
  readonly objekt: string;
  readonly aktion: string;
  /** Rollen, die das Recht per Plattform-Vorgabe halten (`✔`). */
  readonly gebunden: readonly Rolle[];
  /** Rollen, für die eine Bindung in der UI angelegt werden darf (`○`). */
  readonly bindbar: readonly Rolle[];
  /** Nur an eine globale Rolle bindbar: keine Rolle ausser super_admin hat `✔`/`○`. */
  readonly nurGlobal: boolean;
}

/**
 * Zerlegt einen Schlüssel in `modul` / `objekt` / `aktion` nach §7.2.
 *
 * Das erste Segment IST das Modul, ausnahmslos. Die Aktion ist das letzte
 * unterstrich-getrennte Token des letzten Segments; was davor steht, ist das
 * Objekt — und fehlt es, ist das Objekt gleich dem Modul.
 */
export function zerlege(schluessel: string): { modul: string; objekt: string; aktion: string } {
  const segmente = schluessel.split('.');
  const modul = segmente[0]!;
  // `gruppe.<modul>.[<objekt>_]<aktion>` — der Modulname wandert ins Objekt.
  const rest = segmente.slice(1).join('_');
  const teile = rest.split('_');
  const aktion = teile.at(-1)!;
  const objekt = teile.length === 1 ? modul : teile.slice(0, -1).join('_');
  return { modul, objekt, aktion };
}

// `[a-z_*]` und nicht `[a-z_]`: die Sammelzeile `gruppe.*.lesen` muss durch
// diesen Filter kommen, sonst wird sie stillschweigend übersprungen und mit
// ihr jeder Gruppenlese-Schlüssel — genau der K-19-Ausfall, den §12.1 nennt.
const ZEILE = /^\|\s*`([a-z_*]+(?:\.[a-z_*]+){1,2})`\s*\|(.*)\|\s*$/u;
const GLYPHEN = new Set(['✔', '○', '—', 'S', '']);

export function lies(): readonly KatalogEintrag[] {
  const text = readFileSync(QUELLE, 'utf8').split('\n');
  const von = text.findIndex((l) => l.startsWith('## 12.'));
  const bis = text.findIndex((l) => l.startsWith('## 13.'));
  if (von < 0 || bis < 0) throw new Error('§12 nicht gefunden — der Katalog hat sich verschoben.');

  const eintraege = new Map<string, KatalogEintrag>();

  for (const zeile of text.slice(von, bis)) {
    const m = ZEILE.exec(zeile.trim());
    if (m === null) continue;
    const schluessel = m[1]!;
    const zellen = m[2]!.split('|').map((c) => c.trim().replace(/[*`]/gu, ''));
    if (zellen.length < 5) continue;
    const glyphen = zellen.slice(0, 5);
    if (!glyphen.every((g) => GLYPHEN.has(g))) continue;

    const gebunden: Rolle[] = [];
    const bindbar: Rolle[] = [];
    ROLLEN.forEach((r, i) => {
      if (glyphen[i] === '✔') gebunden.push(r);
      else if (glyphen[i] === '○') bindbar.push(r);
    });

    // `nur_global`: keine Rolle ausser super_admin ist überhaupt erreichbar.
    const nurGlobal = ROLLEN.slice(1).every((r) => !gebunden.includes(r) && !bindbar.includes(r))
      && gebunden.includes('super_admin');

    if (schluessel.includes('*')) {
      // Sammelzeile: unten entfaltet, nicht als Schlüssel gespeichert.
      eintraege.set(schluessel, {
        schluessel, modul: 'gruppe', objekt: '*', aktion: 'lesen',
        gebunden, bindbar, nurGlobal: false,
      });
      continue;
    }
    eintraege.set(schluessel, { schluessel, ...zerlege(schluessel), gebunden, bindbar, nurGlobal });
  }

  /**
   * `gruppe.*.lesen` ist eine Sammelzeile, und §12.1 sagt wörtlich, wie sie
   * zu lesen ist: "mechanisch eine Zeile je Modul aus §7.4". Ohne diese
   * Entfaltung fehlt jeder Gruppenlese-Schlüssel im Katalog, `hat_recht`
   * antwortet false, und die Gruppenansicht bleibt dauerhaft leer (K-19).
   */
  const sammel = eintraege.get('gruppe.*.lesen');
  if (sammel !== undefined) {
    eintraege.delete('gruppe.*.lesen');
    // `gruppe` selbst wird nicht entfaltet: `gruppe.gruppe.lesen` benennt nichts.
    for (const modul of MODULE.filter((m) => m !== 'gruppe')) {
      const schluessel = `gruppe.${modul}.lesen`;
      eintraege.set(schluessel, {
        schluessel, ...zerlege(schluessel),
        gebunden: sammel.gebunden, bindbar: sammel.bindbar, nurGlobal: false,
      });
    }
    // Die zwei mit Objektsilbe, die §12.1 ausdrücklich nennt.
    for (const schluessel of ['gruppe.system.audit_lesen', 'gruppe.dienstplan.arbzg_lesen']) {
      eintraege.set(schluessel, {
        schluessel, ...zerlege(schluessel),
        gebunden: sammel.gebunden, bindbar: sammel.bindbar, nurGlobal: false,
      });
    }
  }

  return [...eintraege.values()].sort((a, b) => a.schluessel.localeCompare(b.schluessel));
}

export function erzeugeDatei(): string {
  const eintraege = lies();
  const zeilen = eintraege.map(
    (e) => `  { schluessel: ${JSON.stringify(e.schluessel)}, modul: ${JSON.stringify(e.modul)},`
      + ` objekt: ${JSON.stringify(e.objekt)}, aktion: ${JSON.stringify(e.aktion)},`
      + ` gebunden: ${JSON.stringify(e.gebunden)}, bindbar: ${JSON.stringify(e.bindbar)},`
      + ` nurGlobal: ${String(e.nurGlobal)} },`,
  );
  return `/**
 * ERZEUGT — nicht von Hand ändern. \`pnpm katalog\` schreibt neu.
 *
 * Quelle: docs/architecture/03-AUTH-BERECHTIGUNGEN.md §12, die Matrix selbst.
 * Der Katalog gehört diesem Dokument und nur ihm (K-19); eine abgetippte
 * zweite Fassung gewinnt beim ersten Widerspruch, ohne dass ihn jemand sieht.
 *
 * ${eintraege.length} Schlüssel.
 */
import type { KatalogEintrag } from '../../../scripts/katalog/extrahiere.js';

export const KATALOG: readonly KatalogEintrag[] = [
${zeilen.join('\n')}
];
`;
}

const direkt = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (direkt) {
  const erwartet = erzeugeDatei();
  if (process.argv.includes('--check')) {
    if (readFileSync(ZIEL, 'utf8') !== erwartet) {
      process.stderr.write('Katalog ist veraltet. `pnpm katalog` ausführen.\n');
      process.exit(1);
    }
    process.stdout.write('Katalog ist aktuell.\n');
  } else {
    writeFileSync(ZIEL, erwartet);
    process.stdout.write(`geschrieben: ${ZIEL} (${lies().length} Schlüssel)\n`);
  }
}
