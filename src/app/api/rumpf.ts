import type { NextRequest } from 'next/server';

/**
 * Der Rumpf einer schreibenden Route — Formular ODER JSON, eine Form.
 *
 * **Warum das eine eigene Datei bekommt.** Es stand in
 * `api/social/gemeinsam.ts` und ist an Social nichts gebunden: jede
 * schreibende Route dieser Plattform nimmt beide Formen entgegen, weil das
 * Portal Formulare schickt und eine Schnittstelle JSON. Als Recruiting
 * dieselbe Weiche brauchte, gab es zwei Wege — abschreiben oder aus einem
 * Modul mit fremdem Namen importieren. Beides wäre eine Aussage über die
 * Architektur gewesen, die nicht stimmt.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface Rumpf {
  readonly felder: Readonly<Record<string, string>>;
  readonly alle: (name: string) => readonly string[];
  readonly json: boolean;
}

export async function liesRumpf(anfrage: NextRequest): Promise<Rumpf> {
  const typ = anfrage.headers.get('content-type') ?? '';
  if (typ.includes('application/json')) {
    /*
     * **Kaputtes JSON bleibt kaputtes JSON.** Hier stand
     * `.catch(() => ({}))` — daraus wurde ein leeres Formular, und der Aufrufer
     * bekam `unvollstaendig` (409) statt `unlesbarer_rumpf` (400). Wer eine
     * Schnittstelle anspricht, kann dann nicht unterscheiden, ob seine Syntax
     * kaputt war oder ein Feld fehlte — und sucht das Feld. Das Gerüst faengt
     * den Wurf ab und antwortet 400.
     */
    const geparst: unknown = await anfrage.json();
    /*
     * **Gueltiges JSON ist noch kein Rumpf.** `[1, 2]`, `"text"`, `42` und
     * `null` sind alle gueltig und kamen hier ungeprueft durch: aus einer
     * Zeichenkette machte `Object.entries` Felder mit den Namen `0`, `1`, `2`,
     * aus einer Liste Felder mit Indexnamen. Der Aufrufer bekam daraufhin
     * `unvollstaendig` (409) und suchte ein Feld, waehrend seine FORM falsch
     * war — genau der Unterschied, den `unlesbarer_rumpf` (400) benennt.
     *
     * Ein `SyntaxError` und keine eigene Fehlerklasse: kaputte Syntax und
     * falsche Form sind fuer den Aufrufer dasselbe Ereignis, und das Geruest
     * (`gemeinsam.ts`) beantwortet es bereits mit 400. Zwei Wege zu einer
     * Antwort waeren einer zu viel.
     *
     * Gemeldet von der Copilot-Runde auf PR 16.
     */
    if (typeof geparst !== 'object' || geparst === null || Array.isArray(geparst)) {
      throw new SyntaxError('Der JSON-Rumpf ist kein Objekt.');
    }
    const roh = geparst as Record<string, unknown>;
    const felder: Record<string, string> = {};
    for (const [k, v] of Object.entries(roh)) {
      if (typeof v === 'string') felder[k] = v;
    }
    return {
      felder,
      alle: (name) => {
        const w = roh[name];
        return Array.isArray(w) ? w.filter((x): x is string => typeof x === 'string') : [];
      },
      json: true,
    };
  }
  const daten = await anfrage.formData();
  const felder: Record<string, string> = {};
  for (const [k, v] of daten.entries()) {
    if (typeof v === 'string' && !(k in felder)) felder[k] = v;
  }
  return {
    felder,
    alle: (name) => daten.getAll(name).filter((x): x is string => typeof x === 'string'),
    json: false,
  };
}
