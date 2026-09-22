/**
 * **Jede schreibende Dienstfunktion hat einen Aufrufer** — sonst ist sie
 * gebaut und nicht auslösbar.
 *
 * `api-verdrahtung.test.ts` daneben prüft die Ebene darüber: dass jede
 * API-Route irgendwo gerufen wird. Das reicht nicht, und die
 * Vollständigkeitsvermessung hat gezeigt, warum — diese sechs Befunde stehen
 * alle EINE Ebene tiefer:
 *
 *  - **V-007**: `legeBankkontoAn` (0121) mit Prüfzifferprüfung und eigener
 *    Policy, von keiner Seite gerufen. „Eingegangen auf" kannte nur, was der
 *    Seed angelegt hatte.
 *  - **V-090**: `bucheBauabzug` (0130) mit Sperre gegen die Doppelbuchung —
 *    weder Route noch Knopf. Auf jeder Rechnung eines bauabzugspflichtigen
 *    Kunden blieben 15 % dauerhaft offen.
 *  - **V-091**: `gleicheAus` (§7.4), nicht auslösbar.
 *  - **V-025**: `meldeAbwesenheit` trug „die Krankmeldung am Telefon um
 *    05:40" im Kopf und hing an der Route der Arbeiterin.
 *  - **V-076**: das Recht `system.sitzung_widerrufen` war vergeben, und kein
 *    Code prüfte es.
 *  - **V-006**: `lieferant` trug Policy, Grant, Index und Auslöser — und
 *    hatte keinen Erzeuger.
 *
 * In jedem Fall war die Route da und gerufen; was fehlte, war die Verbindung
 * von ihr zur FUNKTION. Der Test liest deshalb die Dienstfunktionen mit
 * schreibendem Verb im Namen und fragt, ob ihr Name irgendwo ausserhalb ihrer
 * eigenen Definition vorkommt.
 *
 * **Er prüft nicht, ob der Aufruf RICHTIG ist.** Dafür sind die Isolations-
 * und Browserläufe da. Er prüft, ob es ihn GIBT — und genau das war sechsmal
 * die Lücke.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WURZEL = fileURLToPath(new URL('../../src', import.meta.url));
const PROJEKT = fileURLToPath(new URL('../..', import.meta.url));
const DIENSTE = join(WURZEL, 'server', 'services');

function dateien(dir: string, treffer: (name: string) => boolean): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return dateien(p, treffer);
    return treffer(e) ? [p] : [];
  });
}

/**
 * Die Verben, die eine Veränderung ankündigen.
 *
 * Eine Leseabfrage ohne Aufrufer ist totes Gewicht; eine SCHREIBENDE ohne
 * Aufrufer ist eine Fachlichkeit, die es zu geben scheint und die niemand
 * auslösen kann — und genau die kostet, weil ein Mensch sie im Betrieb
 * sucht.
 */
const VERB =
  /^(lege|erfasse|buche|setze|aendere|archiviere|gleiche|melde|nimm|storniere|entsperre|deaktiviere|reaktiviere|widerrufe|erstelle|schliesse|eroeffne|uebertrage|verbuche|ordne|loesche|verwerfe|genehmige|lehne|verlaengere|entscheide|plane|veroeffentliche|uebernimm|vergebe|starte|beende|sperre|trage|fuehre|sende|versende|importiere|exportiere|gib)/u;

/**
 * Funktionen, die absichtlich keinen Aufrufer im Anwendungsbaum haben.
 *
 * **Die Liste darf schrumpfen, nie wachsen.** Jede Zeile ist eine
 * Entscheidung oder ein offener Befund mit Nummer — kein Ventil. Ein Eintrag
 * ohne Nummer und ohne Grund gehört nicht hierher.
 */
const OHNE_AUFRUFER: Readonly<Record<string, string>> = {
  importiere:
    'Ein Werkzeug der Kommandozeile: `scripts/content-import.ts` ruft es. Der '
    + 'Inhaltsimport laeuft beim Aufsetzen und nicht aus dem Portal — eine '
    + 'Route dafuer waere ein Weg, ueber den sich die halbe Website von aussen '
    + 'ueberschreiben liesse.',

  /* ── Offene Befunde: gebaut, kein Ausloeser ───────────────────────────── */
  gibTokenAus:
    'V-115 — der Token des Werbewiderspruchs (§ 7 UWG, Art. 21 DSGVO) wird '
    + 'von nichts ausgegeben. Der Widerspruchsweg existiert, der Schluessel '
    + 'dazu entsteht nirgends.',
};

interface Fund { readonly name: string; readonly datei: string }

function schreibendeDienste(): readonly Fund[] {
  const funde: Fund[] = [];
  for (const f of dateien(DIENSTE, (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
    const quelle = readFileSync(f, 'utf8');
    for (const m of quelle.matchAll(/^export async function ([a-zA-Z0-9_]+)/gmu)) {
      const name = m[1] ?? '';
      if (VERB.test(name)) funde.push({ name, datei: relative(WURZEL, f) });
    }
  }
  return funde;
}

/** Wo ein Aufrufer stehen DARF — Oberflaeche, Jobs, Agent, Seed, Zustellung. */
const RUFER = [
  join(WURZEL, 'app'), join(WURZEL, 'server', 'jobs'), join(WURZEL, 'server', 'agent'),
  join(WURZEL, 'server', 'db', 'seed'), join(WURZEL, 'server', 'benachrichtigung'),
  join(PROJEKT, 'scripts'),
];

function quelltextDerRufer(): string {
  let text = '';
  for (const w of RUFER) {
    try {
      for (const f of dateien(w, (n) => n.endsWith('.ts') || n.endsWith('.tsx'))) {
        text += readFileSync(f, 'utf8');
      }
    } catch {
      /* Ein Verzeichnis, das es (noch) nicht gibt, ist kein Aufrufer. */
    }
  }
  return text;
}

function quelltextDerDienste(): string {
  let text = '';
  for (const f of dateien(DIENSTE, (n) => n.endsWith('.ts'))) text += readFileSync(f, 'utf8');
  return text;
}

describe('jede schreibende Dienstfunktion ist auslösbar', () => {
  const dienste = schreibendeDienste();

  it('es gibt Dienste zu prüfen', () => {
    expect(dienste.length).toBeGreaterThan(100);
  });

  it('keine schreibende Dienstfunktion steht ohne Aufrufer da', () => {
    const rufer = quelltextDerRufer();
    const intern = quelltextDerDienste();
    const ohne = dienste.filter((d) => {
      if (d.name in OHNE_AUFRUFER) return false;
      if (new RegExp(`\\b${d.name}\\b`, 'u').test(rufer)) return false;
      /*
       * Im Dienstbaum selbst zaehlt nur ein ZWEITES Vorkommen: das erste ist
       * die Definitionszeile. Ein Dienst, den ein anderer Dienst ruft, ist
       * erreichbar — die Kette endet dann irgendwo oben bei einer Route.
       */
      const treffer = intern.match(new RegExp(`\\b${d.name}\\b`, 'gu'))?.length ?? 0;
      return treffer <= 1;
    });
    expect(
      ohne.map((d) => `${d.name} — ${d.datei}`),
      'Dienstfunktionen, die niemand aufruft (gebaut und nicht auslösbar)',
    ).toEqual([]);
  });

  /**
   * Die Gegenrichtung — ohne sie bleibt die Liste stehen, nachdem die Arbeit
   * getan ist, und die Wache verliert ihre Schärfe. Dieselbe Regel wie bei
   * `UEBERSETZUNG_AUSNAHMEN` und `OHNE_EIGENES_TOR`.
   */
  it('kein Eintrag in der Ausnahmeliste ist erledigt oder erfunden', () => {
    const namen = new Set(dienste.map((d) => d.name));
    const rufer = quelltextDerRufer();
    const intern = quelltextDerDienste();
    const ueberfluessig: string[] = [];
    for (const name of Object.keys(OHNE_AUFRUFER)) {
      if (!namen.has(name)) {
        ueberfluessig.push(`${name}: gibt es nicht mehr`);
        continue;
      }
      /*
       * `scripts/` zaehlt als Aufrufer — ein Eintrag, der NUR deshalb
       * dasteht, bleibt also zu Recht stehen. Gemeldet wird, wer einen
       * Aufrufer im ANWENDUNGSBAUM bekommen hat.
       */
      const imBaum = [join(WURZEL, 'app'), join(WURZEL, 'server', 'jobs'),
        join(WURZEL, 'server', 'agent')].some((w) => {
        try {
          return dateien(w, (n) => n.endsWith('.ts') || n.endsWith('.tsx'))
            .some((f) => new RegExp(`\\b${name}\\b`, 'u').test(readFileSync(f, 'utf8')));
        } catch { return false; }
      });
      const internTreffer = intern.match(new RegExp(`\\b${name}\\b`, 'gu'))?.length ?? 0;
      if (imBaum || internTreffer > 1) {
        ueberfluessig.push(`${name}: hat jetzt einen Aufrufer`);
      }
      void rufer;
    }
    expect(ueberfluessig, 'Ausnahmen, die nicht mehr nötig sind').toEqual([]);
  });
});
