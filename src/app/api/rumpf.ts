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
    const roh = (await anfrage.json()) as Record<string, unknown>;
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
