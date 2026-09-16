/**
 * **Jede API-Route hat einen Aufrufer** — sonst ist sie gebaut und
 * unerreichbar.
 *
 * Das ist die Sorte Lücke, die keine Einzelprüfung findet und die dieses
 * Projekt dreimal getroffen hat:
 *
 *  - **D-563**: sechzehn Wächter mit Zeitplan, Runner, Laufprotokoll — und
 *    niemand, der sie rief.
 *  - **D-574**: `planeGespraech` im Dienst, die Gesprächsliste versprach einen
 *    Knopf, und im API-Baum stand keine Route. `stelle.status` kannte
 *    `freigegeben`, und keine Zeile setzte ihn.
 *  - **D-575**: `POST /api/bau/aufmasse/vorschau` (BAU-02) und
 *    `POST /api/check-in/[token]/medien` (TIM-10) — beide vollständig gebaut,
 *    bewacht und geprüft, beide ohne eine einzige Stelle im Quelltext, die sie
 *    ruft. Das Aufmaßformular versprach in seinem eigenen Absatz die Vorschau,
 *    die Stempelfläche hatte keinen Aufnahmeknopf.
 *
 * Jede Datei für sich grün; zusammen tot. Dieser Test liest deshalb nicht die
 * Route, sondern die **VERDRAHTUNG**: gibt es irgendwo ausserhalb von
 * `src/app/api` eine Stelle, die diese Adresse nennt — als `action`, als
 * `fetch`, als `redirect`?
 *
 * **Er prüft nicht, ob der Aufruf RICHTIG ist.** Dafür sind die Browserläufe
 * da. Er prüft, ob es ihn GIBT — und genau das war dreimal die Lücke.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WURZEL = fileURLToPath(new URL('../../src', import.meta.url));
const API = join(WURZEL, 'app', 'api');

function dateien(dir: string, treffer: (name: string) => boolean): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return dateien(p, treffer);
    return treffer(e) ? [p] : [];
  });
}

/**
 * Routen, die absichtlich keinen Aufrufer IM QUELLTEXT haben.
 *
 * Jede Zeile ist eine Entscheidung mit Grund daneben — keine Liste, die
 * wächst, wenn der Test stört.
 */
const OHNE_AUFRUFER: Readonly<Record<string, string>> = {
  '/api/jobs/[schluessel]':
    'Der Auslöser sitzt in Supabase cron (docs/JOB-AUSLOESER.sql), nicht im Quelltext.',
  /*
   * **Maschinenfläche mit menschlichem Zwilling.**
   *
   * Beide Adressen stehen in `05-API-KARTE.md` als JSON-Fläche — und beide
   * Auskünfte erreichen einen Menschen trotzdem, nur nicht über `fetch`:
   * `/portal/[mandant]/finanzen/rechnungen/[id]/pruefung` ruft `pruefeRechnung`
   * serverseitig, `/portal/[mandant]/bau/nachtraege` ruft `ladeAusserhalbLv`.
   * Genau so ist das Haus gebaut (`CLAUDE.md`: Seiten lesen über `withTenant`,
   * Routenhandler bleiben dünn) — ein `fetch` aus der Seite auf die eigene
   * Route wäre ein Umweg mit einem zweiten Rechteweg daneben.
   *
   * Der Unterschied zu den beiden Befunden, die diesen Test gebracht haben:
   * dort gab es KEINEN Zwilling. Die Vorschau versprach das Formular in seinem
   * eigenen Absatz, ohne sie je zu zeigen; die Aufnahme hatte überhaupt keine
   * Fläche.
   */
  '/api/rechnungen/pruefung':
    'Maschinenfläche (API-KARTE §6). Der Mensch liest denselben Bericht auf '
    + '/finanzen/rechnungen/[id]/pruefung, die `pruefeRechnung` serverseitig ruft.',
  '/api/bau/nachtrag-warnungen':
    'Maschinenfläche (API-KARTE §C.15). Der Mensch sieht dieselben Warnungen auf '
    + '/bau/nachtraege, die `ladeAusserhalbLv` serverseitig ruft.',
};

/**
 * Block- und Zeilenkommentare heraus.
 *
 * Grob und mit Absicht: eine Zeichenkette, die `//` enthält, verliert hier
 * ihren Rest. Das ist die sichere Richtung — es entsteht ein FALSCHER ALARM
 * und kein übersehener Befund, und ein falscher Alarm fällt beim nächsten Lauf
 * auf, ein übersehener Befund erst im Betrieb.
 */
function ohneKommentare(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1');
}

describe('kein API-Endpunkt ohne Aufrufer', () => {
  it('jede Route wird irgendwo ausserhalb von src/app/api genannt', () => {
    const routen = dateien(API, (n) => n === 'route.ts' || n === 'route.tsx')
      .map((d) => '/' + relative(join(WURZEL, 'app'), d)
        .replace(/[/\\]route\.tsx?$/u, '').split(/[/\\]/u).join('/'));
    expect(routen.length).toBeGreaterThan(20);

    /*
     * Alles ausserhalb von `app/api` — Seiten, Komponenten, Bibliothek,
     * **ohne Kommentare**.
     *
     * Der Unterschied ist die ganze Wache: diese Datei hier und die Seite
     * daneben ERKLÄREN die beiden Routen ausführlich, mit ihrer Adresse im
     * Text. Zählte ein Kommentar als Aufrufer, bliebe die Prüfung grün, wenn
     * jemand das Feld entfernt und den Absatz darüber stehen lässt — und
     * genau dieser Zustand („beschrieben, nicht verdrahtet") ist der, den sie
     * finden soll. Nachgesehen mit einer Sabotage: Komponente entfernt,
     * Prüfung blieb grün, weil der Kommentar die Adresse trug.
     */
    const rest = dateien(WURZEL, (n) => n.endsWith('.ts') || n.endsWith('.tsx'))
      .filter((d) => !d.startsWith(API))
      .map((d) => ohneKommentare(readFileSync(d, 'utf8')))
      .join('\n');

    const verwaist = routen.filter((r) => {
      if (r in OHNE_AUFRUFER) return false;
      /*
       * `[id]` wird zu „irgendein Segment ohne Schrägstrich": die Adresse
       * steht im Quelltext als Vorlage (`/api/x/${id}/y`), nie mit der Kennung
       * darin. Gesucht wird die FORM, nicht die konkrete Adresse.
       *
       * **Alles ausser `/` und Zeilenende** — und das war nötig: die erste
       * Fassung verbot auch Klammern und Anführungszeichen und übersah damit
       * `${encodeURIComponent(marke)}` und `${z.kontoId ?? ''}`. Zwei
       * verdrahtete Routen standen daraufhin als verwaist da, und eine Wache,
       * die falsch Alarm schlägt, wird abgeschaltet statt befolgt.
       */
      const muster = r
        .split('/')
        .map((t) => (t.startsWith('[')
          ? '[^/\\n]+'
          : t.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')))
        .join('/');
      return !new RegExp(muster, 'u').test(rest);
    });

    expect(verwaist, 'API-Routen, die niemand ruft — gebaut und unerreichbar')
      .toEqual([]);
  });

  /**
   * **Die Ausnahmeliste bleibt eine Liste von Entscheidungen.**
   *
   * Ein Eintrag für eine Route, die es nicht mehr gibt, ist eine Ausnahme, die
   * niemand mehr prüft — und die nächste Route mit demselben Pfad erbt sie
   * stillschweigend.
   */
  it('jede Ausnahme betrifft eine Route, die es wirklich gibt', () => {
    const routen = new Set(dateien(API, (n) => n === 'route.ts' || n === 'route.tsx')
      .map((d) => '/' + relative(join(WURZEL, 'app'), d)
        .replace(/[/\\]route\.tsx?$/u, '').split(/[/\\]/u).join('/')));
    for (const pfad of Object.keys(OHNE_AUFRUFER)) {
      expect(routen.has(pfad), `Ausnahme fuer eine Route, die es nicht gibt: ${pfad}`)
        .toBe(true);
    }
  });
});
