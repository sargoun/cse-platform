/**
 * Ueber den eigenen Einwand entscheidet man nicht — VOR dem `update`
 * (EMP-07, TIM-11).
 *
 * **Der Befund, der diese Datei gebracht hat.** Der Ausloeser
 * `kern.zeit_einwand_status` verbietet die Entscheidung ueber den eigenen
 * Einwand und wirft mit `check_violation`. `entscheideEinwand` prueft das
 * nicht, und die Fangkette der Route kannte nur „nicht gefunden", „bereits
 * entschieden" und die Auth-Fehler — der Klick endete in einem ungefangenen
 * **500**. Auf der Detailseite `/zeiten/einwaende/[id]` ist das der
 * wahrscheinlichste Weg dorthin: dort hat die betroffene Person ihren eigenen
 * Vorgang offen vor sich.
 *
 * **Die Pruefung ist so ENG wie der Ausloeser und nicht enger.** Sie gilt fuer
 * `anerkannt`, `teilweise_anerkannt` und `abgelehnt`. Nicht fuer
 * `in_pruefung` — das ist keine Entscheidung. Und nicht fuer
 * `zurueckgezogen`: das zieht die Person selbst zurueck, und genau das ist der
 * eine Weg, den sie hat. Eine strengere Pruefung waere schlimmer als keine.
 *
 * Geprueft wird hier gegen einen nachgebauten Kontext — die echte Policy- und
 * Ausloeserseite steht in `tests/isolation/`.
 */
import { describe, expect, it } from 'vitest';
import {
  ENTSCHEIDUNG, ENTSCHIEDEN, EinwandBereitsEntschiedenFehler, EinwandEigenerFehler,
  EinwandNichtGefundenFehler, entscheideEinwand,
} from '../../src/server/services/zeit/einwand.js';

/**
 * Ein Kontext, der die drei Abfragen von `entscheideEinwand` beantwortet —
 * und mitschreibt, welche gelaufen sind.
 *
 * Erkannt werden sie am Text, nicht an der Reihenfolge: ein Test, der von der
 * Reihenfolge abhaengt, bricht beim ersten Umbauen und sagt dabei nichts
 * ueber die Zusage.
 */
function kontextMit(lage: {
  readonly status?: string | null;
  readonly eigener: boolean;
  readonly treffer?: number;
}) {
  const gelaufen: string[] = [];
  const antwort = <T>(sql: string): readonly T[] => {
    gelaufen.push(sql);
    if (sql.includes('select status::text as status from zeit_einwand')) {
      return lage.status === null || lage.status === undefined
        ? []
        : ([{ status: lage.status }] as unknown as readonly T[]);
    }
    if (sql.includes('as eigener')) {
      return [{ eigener: lage.eigener }] as unknown as readonly T[];
    }
    if (sql.includes('update zeit_einwand')) {
      return (lage.treffer === 0 ? [] : [{ id: 'ew-1' }]) as unknown as readonly T[];
    }
    throw new Error(`Unerwartete Abfrage: ${sql.slice(0, 60)}`);
  };
  return {
    gelaufen,
    kontext: {
      scope: 'mandant' as const,
      portal: 'intern' as const,
      benutzerId: 'b-planer',
      aktiverMandantId: 'm-1',
      mandantIds: ['m-1'],
      abfrage: <T>(sql: string): Promise<readonly T[]> => Promise.resolve(antwort<T>(sql)),
      schreibe: <T>(sql: string): Promise<readonly T[]> => Promise.resolve(antwort<T>(sql)),
    },
  };
}

describe('die Liste der Entscheidungen ist dieselbe wie im Ausloeser', () => {
  it('drei Zustaende sind eine ENTSCHEIDUNG der Planung', () => {
    expect([...ENTSCHEIDUNG]).toStrictEqual(['anerkannt', 'teilweise_anerkannt', 'abgelehnt']);
  });

  it('`zurueckgezogen` schliesst ab, ist aber keine Entscheidung der Planung', () => {
    expect(ENTSCHIEDEN).toContain('zurueckgezogen');
    expect(ENTSCHEIDUNG).not.toContain('zurueckgezogen');
  });

  it('`in_pruefung` schliesst nichts ab', () => {
    expect(ENTSCHIEDEN).not.toContain('in_pruefung');
    expect(ENTSCHEIDUNG).not.toContain('in_pruefung');
  });
});

describe('die Selbstentscheidung wird VOR dem update abgefangen', () => {
  for (const status of ['anerkannt', 'teilweise_anerkannt', 'abgelehnt'] as const) {
    it(`\`${status}\` über den eigenen Einwand wirft EinwandEigenerFehler`, async () => {
      const { gelaufen, kontext } = kontextMit({ status: 'offen', eigener: true });
      await expect(entscheideEinwand(kontext, {
        einwandId: 'ew-1', status, begruendung: 'Geprueft und zutreffend',
        entschiedenVon: 'b-fatima',
      })).rejects.toBeInstanceOf(EinwandEigenerFehler);
      // Und zwar OHNE das `update` — sonst waere die Pruefung eine Zierde.
      expect(gelaufen.some((s) => s.includes('update zeit_einwand'))).toBe(false);
    });
  }

  it('der Fehler traegt 409 und nennt EMP-07 in Worten', () => {
    const f = new EinwandEigenerFehler();
    expect(f.status).toBe(409);
    expect(f.code).toBe('eigener_einwand');
    expect(f.message).toContain('EMP-07');
  });

  it('`in_pruefung` über den eigenen Einwand ist erlaubt — es ist keine Entscheidung', async () => {
    const { gelaufen, kontext } = kontextMit({ status: 'offen', eigener: true });
    await expect(entscheideEinwand(kontext, {
      einwandId: 'ew-1', status: 'in_pruefung', entschiedenVon: 'b-fatima',
    })).resolves.toBeUndefined();
    expect(gelaufen.some((s) => s.includes('update zeit_einwand'))).toBe(true);
    // Die Selbstpruefung laeuft dabei GAR NICHT — eine Abfrage, die nichts
    // entscheidet, soll auch nicht kosten.
    expect(gelaufen.some((s) => s.includes('as eigener'))).toBe(false);
  });

  it('`zurueckgezogen` darf die betroffene Person selbst — das ist ihr einziger Weg', async () => {
    const { kontext } = kontextMit({ status: 'offen', eigener: true });
    await expect(entscheideEinwand(kontext, {
      einwandId: 'ew-1', status: 'zurueckgezogen', begruendung: 'Hat sich geklaert',
      entschiedenVon: 'b-fatima',
    })).resolves.toBeUndefined();
  });

  it('die Planung entscheidet und kommt durch', async () => {
    const { gelaufen, kontext } = kontextMit({ status: 'offen', eigener: false });
    await expect(entscheideEinwand(kontext, {
      einwandId: 'ew-1', status: 'anerkannt', begruendung: 'Stimmt, Eintrag fehlte',
      entschiedenVon: 'b-planer',
    })).resolves.toBeUndefined();
    expect(gelaufen.some((s) => s.includes('as eigener'))).toBe(true);
    expect(gelaufen.some((s) => s.includes('update zeit_einwand'))).toBe(true);
  });
});

describe('die beiden anderen Absagen bleiben, wie sie waren', () => {
  it('ein nicht vorhandener Einwand ist 404 und nie 403 (AUT-06)', async () => {
    const { kontext } = kontextMit({ status: null, eigener: false });
    await expect(entscheideEinwand(kontext, {
      einwandId: 'ew-x', status: 'anerkannt', begruendung: 'Egal',
      entschiedenVon: 'b-planer',
    })).rejects.toBeInstanceOf(EinwandNichtGefundenFehler);
  });

  it('ein entschiedener Einwand aendert seinen Zustand nicht mehr', async () => {
    const { kontext } = kontextMit({ status: 'abgelehnt', eigener: false });
    await expect(entscheideEinwand(kontext, {
      einwandId: 'ew-1', status: 'anerkannt', begruendung: 'Doch nicht',
      entschiedenVon: 'b-planer',
    })).rejects.toBeInstanceOf(EinwandBereitsEntschiedenFehler);
  });

  /**
   * Null Zeilen im `update` heisst: die RLS hat die Zeile ausgeblendet, weil
   * `zeit.einwand_entscheiden` fehlt. Von aussen dieselbe Antwort wie „gibt
   * es nicht" (AUT-06).
   */
  it('null getroffene Zeilen sind 404, nicht ein stiller Erfolg', async () => {
    const { kontext } = kontextMit({ status: 'offen', eigener: false, treffer: 0 });
    await expect(entscheideEinwand(kontext, {
      einwandId: 'ew-1', status: 'abgelehnt', begruendung: 'Nicht nachvollziehbar',
      entschiedenVon: 'b-planer',
    })).rejects.toBeInstanceOf(EinwandNichtGefundenFehler);
  });
});
