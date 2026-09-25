import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * **Drei Felder, die eine Route entgegennimmt und kein Formular schickt**
 * (V-084, V-097, V-098).
 *
 * Alle drei haben dieselbe Form: die Datenbank kennt den Wert, ein Dienst
 * oder eine Route nimmt ihn entgegen, eine Seite ZEIGT ihn sogar an — und
 * gesetzt hat ihn nie jemand. Was auf dem Bildschirm stand, war deshalb nicht
 * die Entscheidung eines Menschen, sondern der Vorgabewert der Spalte.
 *
 * **Warum eine Sperrklinke.** Keiner der drei wirft eine Ausnahme. Die Seite
 * lädt, die Liste füllt sich, und die Spalte sagt immer dasselbe.
 */

describe('(1) eine versendete Mahnung lässt sich abschliessen (V-084)', () => {
  it('der Dienst kennt den Übergang, und die Route ruft ihn', () => {
    /*
     * `mahn_status` kennt `erledigt` seit `0125`, und beide Zustandsauslöser
     * lassen `versendet → erledigt` ausdrücklich zu. Jede jemals versendete
     * Mahnung stand für immer als offen da.
     */
    const dienst = readFileSync('src/server/services/finanz/mahnung/index.ts', 'utf8');
    expect(dienst).toContain('export async function erledige(');
    expect(dienst).toContain("status = 'erledigt'");
    // Nur aus `versendet` — ein Entwurf wird verworfen, nicht erledigt.
    expect(dienst).toMatch(/status = 'erledigt'[\s\S]{0,400}status = 'versendet'/u);

    const route = readFileSync('src/app/api/finanzen/mahnungen/route.ts', 'utf8');
    expect(route).toContain("aktion === 'erledigen'");
  });

  it('der Knopf steht unter dem SCHWÄCHEREN Recht', () => {
    /*
     * Es lässt nichts aus dem Haus — im Gegenteil, es schliesst einen
     * Vorgang, der längst heraus ist. Wer Mahnläufe führt, soll abhaken
     * können; ihn dafür auf `mahnung.freigeben` zu verweisen, hiesse, dass
     * die Mahnliste wächst, weil das Recht zum Abhaken beim
     * Vieraugenprinzip liegt.
     */
    const route = readFileSync('src/app/api/finanzen/mahnungen/route.ts', 'utf8');
    const erledigen = route.indexOf("aktion === 'erledigen'");
    const zweitesRecht = route.indexOf("recht: 'mahnung.freigeben'");
    expect(erledigen).toBeGreaterThan(0);
    expect(erledigen).toBeLessThan(zweitesRecht);
  });

  it('und die offene Frage steht dabei, statt beantwortet zu werden', () => {
    // Ob ein bezahlter offener Posten seine Mahnung von selbst schliesst,
    // hängt an Teilzahlung, Storno und Gebühren — O-902.
    const dienst = readFileSync('src/server/services/finanz/mahnung/index.ts', 'utf8');
    expect(dienst).toContain('O-902');
    expect(readFileSync('docs/DECISIONS.md', 'utf8')).toContain('| O-902 |');
  });
});

describe('(2) der Hauptkontakt lässt sich wechseln (V-097)', () => {
  it('der Dienst löscht ZUERST und setzt DANN', () => {
    /*
     * `ansprechpartner_hauptkontakt_uk` ist nicht aufgeschoben: setzte man
     * erst den neuen, fiele die Eindeutigkeit, solange der alte noch steht.
     */
    const quelle = readFileSync('src/server/services/crm/aendern.ts', 'utf8');
    const funktion = quelle.slice(quelle.indexOf('export async function setzeHauptkontakt'));
    const aus = funktion.indexOf('ist_hauptkontakt = false');
    const an = funktion.indexOf('ist_hauptkontakt = true');
    expect(aus).toBeGreaterThan(0);
    expect(an).toBeGreaterThan(aus);
  });

  it('und das Blatt bietet ihn nur an, wo er etwas tut', () => {
    // Kein Knopf bei einem ausgeschiedenen Kontakt und keiner bei dem, der es
    // schon IST: eine Handlung ohne Wirkung ist eine, die jemand für kaputt
    // hält.
    const seite = readFileSync(
      'src/app/portal/[mandant]/crm/kontakte/[id]/page.tsx', 'utf8');
    expect(seite).toContain('zum-hauptkontakt');
    expect(seite).toContain('!kopf.ist_hauptkontakt');
    expect(seite).toContain('kopf.ausgeschieden_am === null');
  });
});

describe('(3) die Folgeaktion einer Mahnstufe (V-098)', () => {
  const SEITE = 'src/app/portal/[mandant]/einstellungen/mahnwesen/page.tsx';

  it('das Formular schickt sie — alle vier Werte des Aufzählungstyps', () => {
    const seite = readFileSync(SEITE, 'utf8');
    expect(seite).toContain('name="folgeaktion"');
    for (const wert of ['keine', 'lieferstopp', 'inkasso', 'mahnbescheid']) {
      expect(seite).toContain(`value="${wert}"`);
    }
  });

  it('die Vorgabe ist „keine" — alles andere wäre eine erfundene Regel', () => {
    /*
     * Welche Aktion zu welcher Stufe gehört, entscheidet ein Mensch. Die drei
     * anderen sind ernst: ein Lieferstopp trifft den laufenden Auftrag, ein
     * Mahnbescheid ist ein gerichtliches Verfahren.
     */
    const seite = readFileSync(SEITE, 'utf8');
    /*
     * Seit V-214 bringt eine Abweisung die Eingaben zurück: vorbelegt ist
     * dann, was der Mensch gewählt hatte — und sonst weiterhin „keine".
     */
    expect(seite).toMatch(
      /name="folgeaktion"[\s\S]{0,200}defaultValue=(?:"keine"|\{zurueck\('folgeaktion'\) \?\? 'keine'\})/u);
  });

  it('und die Seite sagt, dass die Plattform sie NICHT auslöst', () => {
    expect(readFileSync(SEITE, 'utf8')).toMatch(/LÖST sie nicht aus/u);
  });
});
