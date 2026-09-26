import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { istBot } from '../../src/server/services/lead/annahme.js';

/**
 * **Drei Zustände ohne Erzeuger — und dreimal derselbe Grund** (V-086,
 * REQ-01, LEG-09, O-905).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, und warum er nicht „behoben" wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `formular_eingang_status` führt seit `0016` vier Werte; geschrieben wird
 * genau einer, `verarbeitet`. Der naheliegende Griff wäre, die anderen drei
 * zu setzen — und bei einem davon wäre er eine ECHTE Verschlechterung:
 *
 *  * **`neu`** — Eingang und Lead entstehen in EINER Transaktion mit
 *    aufgeschobenen Fremdschlüsseln (`0017`). Es gibt kein Fenster, in dem
 *    ein Eingang ohne Lead steht; der Wert ist der Spaltenvorgabewert, den
 *    dieselbe Anweisung überschreibt.
 *  * **`spam`** — der Honigtopf prüft VOR jeder Datenbankberührung,
 *    ausdrücklich, damit ein Bot nicht einmal eine Abfrage kostet. Eine
 *    Aufzeichnung machte daraus einen VERSTÄRKER: ein Ansturm, der heute
 *    nichts kostet, schriebe dann je Treffer eine Zeile. Für das Ratenlimit
 *    gilt dasselbe doppelt — sein Zweck IST das Begrenzen von
 *    Schreibvorgängen.
 *  * **`verworfen`** — es gibt keine Liste von Einsendungen; die Arbeitsliste
 *    ist der Lead.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was diese Datei hält.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sie hält die Reihenfolge fest, an der alles hängt: der Honigtopf steht VOR
 * der ersten Datenbankzeile der Route. Wer ihn eines Tages hinter eine
 * Abfrage schiebt — etwa um den Treffer aufzuzeichnen —, bekommt hier ein
 * rotes Zeichen und nicht erst beim nächsten Ansturm eine Rechnung.
 *
 * Der PREIS der heutigen Lage ist damit nicht verschwiegen: ein falsch
 * positiver Treffer verschwindet spurlos, und der Absender bekommt dieselbe
 * Dankseite wie bei Erfolg. Ob das so bleibt, steht als O-905 beim
 * Auftraggeber.
 */

const ROUTE = 'src/app/api/anfrage/route.ts';

function alleDateien(verzeichnis: string): readonly string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) gefunden.push(...alleDateien(pfad));
    else if (pfad.endsWith('.ts') || pfad.endsWith('.tsx')) gefunden.push(pfad);
  }
  return gefunden;
}

describe('§1 der Honigtopf steht vor der Datenbank', () => {
  it('erkennt einen gefüllten Topf und lässt ein leeres Feld durch', () => {
    expect(istBot('http://billig-pillen.example')).toBe(true);
    expect(istBot('   ')).toBe(false);
    expect(istBot('')).toBe(false);
    expect(istBot(undefined)).toBe(false);
  });

  it('und die Route prüft ihn VOR der ersten Datenbankzeile', () => {
    /*
     * **Die Zusage, die den Verstärker verhindert.** Steht der Honigtopf
     * hinter `db()`, kostet jeder Bot eine Verbindung und eine Abfrage — und
     * genau das war die Begründung, ihn davor zu setzen. Gemessen wird an
     * der POSITION im Quelltext, weil es keine andere Stelle gibt, an der
     * sich „vorher" prüfen liesse.
     */
    const inhalt = readFileSync(ROUTE, 'utf8');
    const topf = inhalt.indexOf('istBot(');
    const datenbank = inhalt.indexOf('db()');
    expect(topf, 'die Route prüft den Honigtopf').toBeGreaterThan(-1);
    expect(datenbank, 'die Route öffnet eine Transaktion').toBeGreaterThan(-1);
    expect(topf, 'der Honigtopf steht VOR der ersten Datenbankberührung')
      .toBeLessThan(datenbank);
  });

  it('und antwortet dem Bot dasselbe wie bei Erfolg', () => {
    /*
     * Wer erfährt, dass er erkannt wurde, probiert das nächste Feld. Die
     * Antwort ist deshalb `ok: true` mit derselben Dankseite — und genau das
     * ist der Grund, warum ein Fehlalarm heute spurlos verschwindet (O-905).
     */
    const inhalt = readFileSync(ROUTE, 'utf8');
    const topf = inhalt.indexOf('istBot(');
    const danach = inhalt.slice(topf, topf + 600);
    expect(danach).toContain('ok: true');
  });
});

describe('§2 niemand schreibt die drei Zustände', () => {
  it('`spam`, `verworfen` und `neu` entstehen nirgends', () => {
    const treffer: string[] = [];
    for (const datei of [...alleDateien('src/server'), ...alleDateien('src/app/api')]) {
      const inhalt = readFileSync(datei, 'utf8');
      for (const [i, zeile] of inhalt.split('\n').entries()) {
        const roh = zeile.trimStart();
        if (roh.startsWith('*') || roh.startsWith('//') || roh.startsWith('/*')) continue;
        if (/'(spam|verworfen)'::formular_eingang_status/u.test(zeile)
          || /status\s*=\s*'(spam|verworfen)'[^;]*formular_eingang/u.test(zeile)) {
          treffer.push(`${datei}:${String(i + 1)}`);
        }
      }
    }
    expect(treffer,
      'Zeichnet jetzt jemand abgewiesene Einsendungen auf? Dann ist O-905 beantwortet '
      + '— und die Antwort muss den Verstärker ausschliessen.').toEqual([]);
  });

  it('die Annahme schreibt weiterhin `verarbeitet` in derselben Anweisung', () => {
    /*
     * `neu` ist der Spaltenvorgabewert, und dieselbe Anweisung überschreibt
     * ihn: Eingang und Lead entstehen zusammen (0017, aufgeschobene
     * Fremdschlüssel). Ein Eingang ohne Lead ist damit kein Zustand, sondern
     * ein Zustand, den es nicht gibt.
     */
    const inhalt = readFileSync('src/server/services/lead/annahme.ts', 'utf8');
    expect(inhalt).toContain("'verarbeitet', now())");
    expect(inhalt).toContain('insert into lead');
  });
});
