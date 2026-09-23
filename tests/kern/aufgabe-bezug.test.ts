import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { istBezugTyp } from '../../src/server/services/kern/aufgabe.js';

/**
 * **Eine Aufgabe lässt sich an einen Vorgang hängen** (V-096, OPS-11).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `aufgabe` trägt fünf Bezugsfelder — `auftrag_id`, `objekt_id`, `lead_id`
 * und das polymorphe Paar `bezug_typ`/`bezug_id`. Die Route nimmt alle fünf
 * entgegen, `loeseBezugAuf` löst sechs Arten auf, die Detailseite zeigt den
 * Verweis, und die Liste lässt sich danach filtern. **Das Anlegeformular
 * schickte keines davon.** Jede von Hand angelegte Aufgabe stand frei in der
 * Luft: „Rechnung prüfen" — welche?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **EIN Feld, nicht zwei.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das Formular schickt `<typ>:<kennung>`. Zwei Felder wären zwei Zustände,
 * die auseinanderlaufen können (Typ gesetzt, Kennung leer) — und genau das
 * weist `aufgabe_bezug_paarweise` in der Datenbank ab. Ein Formular, das
 * einen Zustand erzeugen kann, den die Datenbank verbietet, schiebt die
 * Fehlermeldung nur nach hinten.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Für drei Arten wird BEIDES gesetzt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `auftrag_id`, `objekt_id` und `lead_id` tragen zusammengesetzte
 * Fremdschlüssel und werden von der LISTE über Joins gezeigt; das polymorphe
 * Paar trägt die Detailseite. Nur eines zu setzen liesse die jeweils andere
 * Ansicht leer — und zwar still.
 */

const ROUTE = readFileSync('src/app/api/aufgaben/route.ts', 'utf8');
const SEITE = readFileSync('src/app/portal/[mandant]/aufgaben/page.tsx', 'utf8');
const DIENST = readFileSync('src/server/services/kern/aufgabe.ts', 'utf8');

describe('§1 das Formular schickt einen Bezug', () => {
  it('trägt ein Auswahlfeld `bezug`', () => {
    expect(SEITE).toContain('name="bezug"');
    expect(SEITE).toContain('aufgabe-bezug');
  });

  it('und bietet genau die sechs Arten an, die eine Detailseite haben', () => {
    /*
     * `bezug_typ` hat sechsundzwanzig Werte; `AUFLOESER` im Dienst kennt die
     * sechs mit einer Adresse. Einen siebten anzubieten hiesse, eine Aufgabe
     * an etwas zu hängen, dem man nicht folgen kann — das ist eine Notiz mit
     * Kennung, kein Bezug.
     */
    for (const typ of ['auftrag', 'objekt', 'kunde', 'lead', 'angebot', 'rechnung']) {
      expect(istBezugTyp(typ), typ).toBe(true);
      expect(SEITE, typ).toContain(`'${typ}'`);
      expect(DIENST, `AUFLOESER kennt ${typ}`).toContain(`${typ}: { tabelle:`);
    }
  });

  it('nur mit `aufgabe.schreiben` — ein Lesekonto bekommt die Abfragen gar nicht', () => {
    expect(SEITE).toContain('darf ? await bezugskandidaten(kontext) : []');
  });
});

describe('§2 die Route löst das eine Feld auf', () => {
  it('kennt `gewaehlterBezug` und ruft es beim Anlegen', () => {
    expect(ROUTE).toContain('function gewaehlterBezug(');
    expect(ROUTE).toContain('...gewaehlterBezug(text(\'bezug\'))');
  });

  it('setzt für die drei Arten mit Fremdschlüssel BEIDES', () => {
    const f = ROUTE.indexOf('function gewaehlterBezug(');
    const rumpf = ROUTE.slice(f, f + 1400);
    expect(rumpf).toContain('bezugTyp: typ, bezugId: kennung');
    expect(rumpf).toContain("typ === 'auftrag' ? { auftragId: kennung }");
    expect(rumpf).toContain("typ === 'objekt' ? { objektId: kennung }");
    expect(rumpf).toContain("typ === 'lead' ? { leadId: kennung }");
  });

  it('und ergibt bei Unsinn KEINEN Bezug statt eines Fehlers', () => {
    /*
     * Das Feld ist freiwillig. Ein verstümmelter Wert darf das Anlegen nicht
     * verhindern — er darf nur keinen Bezug erzeugen. `legeAn` prüft den Typ
     * ohnehin ein zweites Mal.
     */
    const f = ROUTE.indexOf('function gewaehlterBezug(');
    const rumpf = ROUTE.slice(f, f + 1400);
    expect(rumpf).toContain('if (roh === null || roh === \'\') return {};');
    expect(rumpf).toContain('if (trenner < 1) return {};');
    expect(rumpf).toContain('if (!istBezugTyp(typ) || !istKennung(kennung)) return {};');
  });
});

describe('§3 der Dienst liefert nur, was zurückführt', () => {
  it('`bezugskandidaten` deckelt je Art — eine Auswahl ohne Deckel ist keine', () => {
    expect(DIENST).toContain('const je = 50;');
  });

  it('und lässt eine Gruppe aus, die diese Sitzung nicht lesen darf', () => {
    /*
     * Ein fehlendes Recht gibt null Zeilen (RLS), keinen Fehler — die Gruppe
     * fehlt dann in der Auswahl. Eine Tabelle, die eine Sitzung gar nicht
     * SELECTen darf, wirft `42501`; dann soll die halbe Auswahl stehen und
     * nicht die ganze Seite fallen.
     */
    const f = DIENST.indexOf('export async function bezugskandidaten(');
    const rumpf = DIENST.slice(f, f + 3000);
    expect(rumpf).toContain('catch {');
    expect(rumpf).toContain('continue;');
  });
});
