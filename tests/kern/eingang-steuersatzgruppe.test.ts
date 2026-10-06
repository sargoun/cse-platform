/**
 * O-363 (D-787): bei zwei § 13b-Gruppen (0 %, AE) entscheidet das Gewerk des
 * Lieferanten — und nur das. Ohne Gewerk, mit unbekanntem Gewerk oder ohne
 * passende Gruppe im Katalog bleibt es bei „ein Mensch wählt".
 */
import { describe, expect, it } from 'vitest';
import {
  GRUPPE_JE_LEISTUNGSART, waehleGruppeNachLeistungsart,
} from '../../src/server/services/finanz/eingang/vorschlag.js';

const BEIDE = [{ schluessel: 'ust_0_13b_bau' }, { schluessel: 'ust_0_13b_reinigung' }];

describe('die § 13b-Gruppe nach dem Gewerk des Lieferanten (O-363)', () => {
  it('kennt genau die zwei Tatbestände des § 13b Abs. 2 Nr. 4 und Nr. 8', () => {
    expect(GRUPPE_JE_LEISTUNGSART).toEqual({
      bau: 'ust_0_13b_bau', gebaeudereinigung: 'ust_0_13b_reinigung',
    });
  });

  it('Bau → Bauleistung, Gebäudereinigung → Gebäudereinigung', () => {
    expect(waehleGruppeNachLeistungsart(BEIDE, 'bau')).toBe('ust_0_13b_bau');
    expect(waehleGruppeNachLeistungsart(BEIDE, 'gebaeudereinigung')).toBe('ust_0_13b_reinigung');
  });

  it('ohne Gewerk im Stamm entscheidet niemand still', () => {
    expect(waehleGruppeNachLeistungsart(BEIDE, null)).toBeNull();
  });

  it('ein unbekanntes Gewerk wird nicht gedeutet', () => {
    expect(waehleGruppeNachLeistungsart(BEIDE, 'sicherheit')).toBeNull();
  });

  it('und eine Gruppe, die der Katalog nicht anbietet, wird nicht erfunden', () => {
    expect(waehleGruppeNachLeistungsart([{ schluessel: 'ust_0_13b_bau' }], 'gebaeudereinigung')).toBeNull();
    expect(waehleGruppeNachLeistungsart([], 'bau')).toBeNull();
  });
});
