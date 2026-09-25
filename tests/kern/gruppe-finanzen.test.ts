/**
 * `gruppenFinanzen` (D-475) — die Verdichtung, ohne Datenbank.
 *
 * Die Datenbank liefert Zeilen; was der Dienst daraus macht, ist das, was
 * hier geprueft wird: eine fehlende Berechtigung wird `null` und NICHT 0,
 * ein Saldo aus Zahl und Strich ist keine Zahl, Geld bleibt bigint, und die
 * Monatsmatrix hat zwoelf Zeilen — auch fuer Monate ohne eine Rechnung.
 */
import { describe, expect, it } from 'vitest';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import { gruppenFinanzen } from '../../src/server/services/gruppe/finanzen.js';

const R = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

/** Ein Kontext, der auf die Form der Abfrage antwortet — nicht auf SQL. */
function kontext(rechte: Readonly<Record<string, readonly string[]>>): LeseKontext {
  const abfrage = async <T,>(sql: string): Promise<readonly T[]> => {
    if (sql.includes('app.hat_recht')) {
      const zeilen: { mandant_id: string; recht: string; ok: boolean }[] = [];
      for (const [mandantId, gehalten] of Object.entries(rechte)) {
        for (const recht of ['gruppe.finanzen.lesen', 'gruppe.eingang.lesen', 'gruppe.zahlung.lesen']) {
          zeilen.push({ mandant_id: mandantId, recht, ok: gehalten.includes(recht) });
        }
      }
      return zeilen as T[];
    }
    if (sql.includes('fakturiert_cent')) {
      return [
        { mandant_id: R, slug: 'reinigung', name: 'CSE', fakturiert_cent: '1250000', rechnungen: 3,
          eingang_cent: '400050', eingangsrechnungen: 2, forderungen_cent: '99', verbindlichkeiten_cent: '1' },
        { mandant_id: B, slug: 'bau', name: 'REALTIME', fakturiert_cent: '9007199254740993', rechnungen: 1,
          eingang_cent: '0', eingangsrechnungen: 0, forderungen_cent: '0', verbindlichkeiten_cent: '0' },
      ] as T[];
    }
    if (sql.includes('from rechnung r')) {
      return [
        { mandant_id: R, monat: 3, summe_cent: '1000000' },
        { mandant_id: R, monat: 11, summe_cent: '250000' },
        { mandant_id: B, monat: 3, summe_cent: '9007199254740993' },
      ] as T[];
    }
    if (sql.includes('from eingangsrechnung e')) {
      return [{ mandant_id: R, monat: 3, summe_cent: '400050' }] as T[];
    }
    /* V-215: die Betriebsausgaben aus `app.ausgaben_aufwand` (0446). */
    if (sql.includes('app.ausgaben_aufwand')) {
      return [
        { mandant_id: R, monat: '2026-03', netto_cent: '12345', anzahl: 2 },
        { mandant_id: R, monat: '2026-07', netto_cent: '655', anzahl: 1 },
        { mandant_id: B, monat: '2026-03', netto_cent: '1000', anzahl: 1 },
      ] as T[];
    }
    throw new Error(`Unerwartete Abfrage: ${sql.slice(0, 60)}`);
  };
  return {
    scope: 'gruppe', portal: 'intern', benutzerId: 'b', aktiverMandantId: null,
    mandantIds: [R, B], abfrage,
  };
}

describe('gruppenFinanzen', () => {
  it('hält alle drei Rechte: Zahlen, Saldo, Summen — als bigint', async () => {
    const alle = ['gruppe.finanzen.lesen', 'gruppe.eingang.lesen', 'gruppe.zahlung.lesen'];
    const f = await gruppenFinanzen(kontext({ [R]: alle, [B]: alle }), 2026);
    expect(f.jahr).toBe(2026);
    expect(f.bereiche.map((b) => b.slug)).toEqual(['reinigung', 'bau']);
    expect(f.bereiche[0]?.fakturiertCent).toBe(1_250_000n);
    // Der Saldo zieht Eingang UND Betriebsausgaben ab (V-215).
    expect(f.bereiche[0]?.ausgabenCent).toBe(13_000n);
    expect(f.bereiche[0]?.ausgaben).toBe(3);
    expect(f.bereiche[0]?.aufwandCent).toBe(400_050n + 13_000n);
    expect(f.bereiche[0]?.saldoCent).toBe(1_250_000n - 400_050n - 13_000n);
    // Ueber 2^53: als Number waere die letzte Stelle weg (Invariante 1).
    expect(f.bereiche[1]?.fakturiertCent).toBe(9_007_199_254_740_993n);
    expect(f.summe.fakturiertCent).toBe(9_007_199_254_740_993n + 1_250_000n);
    expect(f.summe.ausgabenCent).toBe(14_000n);
    expect(f.summe.aufwandCent).toBe(400_050n + 14_000n);
    expect(f.summe.saldoCent).toBe(9_007_199_254_740_993n + 1_250_000n - 400_050n - 14_000n);
    // Die Gruppe ist die Summe der Gesellschaften — auch beim Aufwand.
    expect(f.summe.aufwandCent)
      .toBe((f.bereiche[0]?.aufwandCent ?? 0n) + (f.bereiche[1]?.aufwandCent ?? 0n));
    expect(f.summe.forderungenOffenCent).toBe(99n);
  });

  it('ohne Eingangsrecht in einem Bereich: Eingang UND Saldo dort null, Gruppensaldo null', async () => {
    const f = await gruppenFinanzen(kontext({
      [R]: ['gruppe.finanzen.lesen', 'gruppe.eingang.lesen', 'gruppe.zahlung.lesen'],
      [B]: ['gruppe.finanzen.lesen'],
    }), 2026);
    const bau = f.bereiche[1];
    expect(bau?.fakturiertCent).toBe(9_007_199_254_740_993n);
    expect(bau?.eingangCent).toBeNull();
    expect(bau?.eingangsrechnungen).toBeNull();
    // Ohne Eingangsrecht auch keine Ausgaben — dasselbe Recht (0446).
    expect(bau?.ausgabenCent).toBeNull();
    expect(bau?.aufwandCent).toBeNull();
    expect(bau?.saldoCent).toBeNull();
    expect(bau?.forderungenOffenCent).toBeNull();
    // Ein Gruppensaldo aus einer Zahl und einem Strich waere eine falsche Zahl.
    expect(f.summe.saldoCent).toBeNull();
    // Die Summen der vollstaendigen Spalten bleiben Zahlen.
    expect(f.summe.fakturiertCent).toBe(9_007_199_254_740_993n + 1_250_000n);
    expect(f.summe.eingangCent).toBe(400_050n);
  });

  it('die Monatsmatrix hat zwölf Zeilen, Nullen wo nichts war, null wo das Recht fehlt', async () => {
    const f = await gruppenFinanzen(kontext({
      [R]: ['gruppe.finanzen.lesen', 'gruppe.eingang.lesen'],
      [B]: ['gruppe.finanzen.lesen'],
    }), 2026);
    expect(f.fakturiertJeMonat).toHaveLength(12);
    expect(f.fakturiertJeMonat[0]?.label).toBe('Januar');
    expect(f.fakturiertJeMonat[2]?.werte).toEqual([1_000_000n, 9_007_199_254_740_993n]);
    expect(f.fakturiertJeMonat[2]?.summe).toBe(1_000_000n + 9_007_199_254_740_993n);
    expect(f.fakturiertJeMonat[10]?.werte).toEqual([250_000n, 0n]);
    expect(f.fakturiertJeMonat[0]?.werte).toEqual([0n, 0n]);
    // Eingang: Bau ohne Recht ist null, nicht 0 — auch in Monaten ohne Beleg.
    expect(f.eingangJeMonat[2]?.werte).toEqual([400_050n, null]);
    expect(f.eingangJeMonat[0]?.werte).toEqual([0n, null]);
    expect(f.eingangJeMonat[2]?.summe).toBe(400_050n);
    // Ausgaben je Monat und der Aufwand als Summe beider Matrizen (V-215).
    expect(f.ausgabenJeMonat[2]?.werte).toEqual([12_345n, null]);
    expect(f.ausgabenJeMonat[6]?.werte).toEqual([655n, null]);
    expect(f.aufwandJeMonat[2]?.werte).toEqual([400_050n + 12_345n, null]);
    expect(f.aufwandJeMonat[6]?.summe).toBe(655n);
    expect(f.aufwandJeMonat[0]?.werte).toEqual([0n, null]);
  });

  it('weist ein Jahr ab, das keines ist', async () => {
    const alle = ['gruppe.finanzen.lesen'];
    await expect(gruppenFinanzen(kontext({ [R]: alle }), 20260)).rejects.toThrow(RangeError);
    await expect(gruppenFinanzen(kontext({ [R]: alle }), Number.NaN)).rejects.toThrow(RangeError);
  });
});
