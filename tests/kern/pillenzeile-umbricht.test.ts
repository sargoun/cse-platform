import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';

/**
 * Die Pillenzeile einer Tabellenzelle muss UMBRECHEN duerfen.
 *
 * **Der Befund.** Der Massenlauf am Telefon (`tests/e2e/abmessungen.spec.ts`)
 * fand zwei Seiten, die bei 390px seitlich hinausliefen:
 * `finanzen/ausgangsbuch` um 23px und `finanzen/eingangsrechnungen` um 4px.
 * Beide Male dieselbe Zelle — `<span class="inline-flex items-center gap-s2">`
 * mit einer `StatusPill` und einem Wort daneben.
 *
 * **Warum `min-w-0 break-words` am `<dd>` nicht reicht.** Der Kartenstapel
 * unter `md` traegt beides schon, genau aus diesem Grund (D-420). Durch einen
 * Flex-Container wirkt es nicht: ein Flex-Element hat von sich aus
 * `min-width: auto`, und ein `inline-flex` ohne `flex-wrap` kann deshalb nicht
 * unter die Summe seiner Kinder schrumpfen. Es schiebt die Seite hinaus —
 * WCAG 1.4.10, und DESIGN §8 sagt „nie ein seitlicher Rollbalken am Telefon".
 *
 * **Warum eine Wache und nicht zwei Korrekturen.** Das Muster stand
 * neunundzwanzigmal im Baum. Zwei liefen ueber, weil ihr Text gerade lang
 * genug war; die anderen siebenundzwanzig warteten auf einen laengeren Status,
 * einen Ablehnungsgrund oder die englische Fassung desselben Wortes (D-592).
 * Von Hand zu suchen findet drei von fuenf.
 *
 * **Warum so eng formuliert.** Ein breiter Ausdruck ueber alle `inline-flex`
 * traefe auch die Knoepfe und Filterpillen — `min-h-11 rounded-md border px-s3`
 * —, und ein umbrechender Knopf ist kaputt, nicht gerettet. Geprueft wird
 * deshalb GENAU die Zeichenkette, die dieses Haus fuer die Zelle benutzt. Der
 * vollstaendige Beweis bleibt `abmessungen.spec.ts`: die misst jede Route
 * wirklich, statt Klassennamen zu lesen.
 */
const OHNE_UMBRUCH = 'inline-flex items-center gap-s2';
const MIT_UMBRUCH = 'inline-flex flex-wrap items-center gap-s2';

function zaehle(muster: string): readonly string[] {
  const roh = execSync(
    `grep -rF ${JSON.stringify(muster)} src/app/portal --include=*.tsx -l || true`,
    { encoding: 'utf8' },
  );
  return roh.split('\n').filter((z) => z !== '');
}

describe('die Pillenzeile in Tabellenzellen', () => {
  it('steht nirgends mehr ohne flex-wrap', () => {
    expect(zaehle(OHNE_UMBRUCH)).toEqual([]);
  });

  it('…und es gibt sie wirklich — sonst prueft der Fall oben nichts', () => {
    /*
     * Der Gegen-Check. Ohne ihn waere der Fall oben in einem leeren Baum
     * gruen, und beim naechsten Umbenennen der Klassen faellt niemandem auf,
     * dass er seit Wochen nichts mehr liest.
     */
    expect(zaehle(MIT_UMBRUCH).length).toBeGreaterThanOrEqual(25);
  });
});
