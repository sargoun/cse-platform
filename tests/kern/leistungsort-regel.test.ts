/**
 * Die Regel zum Leistungsort — die reinen Teile (V-373, O-933, D-836).
 *
 * Den Weg durch die Datenbank (Setzen, Protokoll, Befolgen in beiden
 * Diensten) prüft `tests/isolation/leistungsort-regel.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  LEISTUNGSORT_ARTEN, LEISTUNGSORT_SCHLUESSEL, LeistungsortRegelFehler, OBJEKT_KUNDE_REGEL,
  leseLeistungsortRegel, pruefeLeistungsortArt,
} from '../../src/server/services/finanz/leistungsort-regel.js';
import { OBJEKT_KUNDE_REGEL as AUS_RECHNUNG } from '../../src/server/services/finanz/rechnung.js';

/** Ein Treiber, der auf `app.einstellung(...)` mit einem festen Wert antwortet. */
function mit(art: string | null) {
  const gefragt: unknown[][] = [];
  return {
    gefragt,
    abfrage: async <T,>(_sql: string, werte: readonly unknown[] = []): Promise<readonly T[]> => {
      gefragt.push([...werte]);
      return [{ art }] as unknown as readonly T[];
    },
  };
}

describe('V-373 — die Regel zum Leistungsort', () => {
  it('es gibt genau zwei, und die Voreinstellung ist frei (O-933)', () => {
    expect(LEISTUNGSORT_ARTEN).toEqual(['frei', 'gleich']);
    expect(OBJEKT_KUNDE_REGEL).toEqual({ art: 'frei', frage: 'O-933' });
    // Dieselbe Voreinstellung über den alten Namen aus `rechnung.ts`.
    expect(AUS_RECHNUNG).toBe(OBJEKT_KUNDE_REGEL);
  });

  it('die Eingabe des Formulars: eine der beiden, Leerraum zählt nicht', () => {
    expect(pruefeLeistungsortArt('frei')).toBe('frei');
    expect(pruefeLeistungsortArt(' gleich ')).toBe('gleich');
    for (const falsch of ['', 'Gleich', 'streng', 'frei,gleich']) {
      expect(() => pruefeLeistungsortArt(falsch), falsch).toThrow(LeistungsortRegelFehler);
    }
    try {
      pruefeLeistungsortArt('streng');
    } catch (fehler) {
      expect((fehler as LeistungsortRegelFehler).grund).toBe('unbekannte_regel');
      expect((fehler as LeistungsortRegelFehler).status).toBe(422);
    }
  });

  it('gelesen wird der eine Schlüssel; was dort nicht passt, ist die Voreinstellung', async () => {
    const gleich = mit('gleich');
    expect(await leseLeistungsortRegel(gleich))
      .toEqual({ regel: { art: 'gleich', frage: 'O-933' }, gesetzt: true });
    expect(gleich.gefragt).toEqual([[LEISTUNGSORT_SCHLUESSEL]]);
    expect(LEISTUNGSORT_SCHLUESSEL).toBe('rechnung.leistungsort_regel');
    for (const art of [null, 'streng', '']) {
      expect(await leseLeistungsortRegel(mit(art)), String(art))
        .toEqual({ regel: OBJEKT_KUNDE_REGEL, gesetzt: false });
    }
  });
});
