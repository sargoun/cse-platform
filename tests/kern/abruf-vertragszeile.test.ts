/**
 * Welche Vertragszeile ein Abruf wählen kann (V-325, D-826; Copilot-Runde
 * PR #44).
 *
 * Nach einer Preisanpassung endet die Vorgängerin am Vortag, die
 * Nachfolgerin beginnt am Stichtag. Ein Abruf gehört zu der Zeile, die an
 * SEINEM Tag galt (`ordneVertragszeileZu` prüft genau das) — die Auswahl darf
 * ihm also weder nur die laufenden Zeilen anbieten (dann fehlte die
 * Vorgängerin) noch alle (dann stünde die Nachfolgerin da, die der Dienst
 * abweist).
 */
import { describe, expect, it } from 'vitest';
import {
  zeilenAmTag, zeilenNichtBeendet,
} from '../../src/server/services/reinigung/sonderleistung.js';

const vorgaengerin = { id: 'alt', gueltigAb: '2026-01-01', gueltigBis: '2026-08-31' };
const nachfolgerin = { id: 'neu', gueltigAb: '2026-09-01', gueltigBis: null };
const befristet = { id: 'frist', gueltigAb: '2026-03-01', gueltigBis: '2026-12-31' };
const kuenftig = { id: 'spaeter', gueltigAb: '2027-01-01', gueltigBis: null };
const ZEILEN = [vorgaengerin, nachfolgerin, befristet, kuenftig];

describe('zeilenAmTag — die Zeilen am Tag des Abrufs', () => {
  it('ein Abruf vor dem Stichtag bekommt die Vorgängerin, nicht die Nachfolgerin', () => {
    expect(zeilenAmTag(ZEILEN, '2026-08-15').map((z) => z.id)).toEqual(['alt', 'frist']);
  });

  it('ein Abruf ab dem Stichtag bekommt die Nachfolgerin — beide Grenzen gehören dazu', () => {
    expect(zeilenAmTag(ZEILEN, '2026-08-31').map((z) => z.id)).toEqual(['alt', 'frist']);
    expect(zeilenAmTag(ZEILEN, '2026-09-01').map((z) => z.id)).toEqual(['neu', 'frist']);
  });

  it('vor dem Beginn einer Zeile gilt sie nicht', () => {
    expect(zeilenAmTag(ZEILEN, '2026-02-15').map((z) => z.id)).toEqual(['alt']);
    expect(zeilenAmTag(ZEILEN, '2025-12-31')).toEqual([]);
  });
});

describe('zeilenNichtBeendet — für einen neuen Abruf', () => {
  it('laufende, befristete und kommende — beendete nicht', () => {
    expect(zeilenNichtBeendet(ZEILEN, '2026-10-07').map((z) => z.id))
      .toEqual(['neu', 'frist', 'spaeter']);
    expect(zeilenNichtBeendet(ZEILEN, '2026-08-31').map((z) => z.id))
      .toEqual(['alt', 'neu', 'frist', 'spaeter']);
  });
});
