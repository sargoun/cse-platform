/**
 * Die Antwort eines Modells als Kandidatendatensatz — ohne Modell geprüft
 * (REC-04, V-223, D-717, Invariante 6).
 *
 * Das Modell liest aus, es rechnet nicht: eine Zahl an Erfahrungsjahren, die
 * nicht wörtlich in der Bewerbung steht, wird nicht übernommen. Eine Antwort,
 * die kein Datensatz ist, wird verworfen — nicht „so gut es geht" gedeutet.
 */
import { describe, expect, it } from 'vitest';
import {
  KANDIDAT_EINTRAEGE_HOECHSTENS, eintraege, leseExtraktion,
} from '../../src/server/services/recruiting/kandidat.js';

const QUELLE = 'Ich arbeite seit 7 Jahren in der Unterhaltsreinigung, spreche Deutsch und '
  + 'Polnisch und habe den Führerschein Klasse B.';

describe('leseExtraktion', () => {
  it('liest ein JSON-Objekt, auch eingebettet in Text', () => {
    const e = leseExtraktion(
      'Hier der Datensatz: {"qualifikationen":["Unterhaltsreinigung","Führerschein Klasse B"],'
      + '"sprachen":["Deutsch","Polnisch"],"erfahrung_jahre":7} — Ende.', QUELLE);
    expect(e).toEqual({
      qualifikationen: ['Unterhaltsreinigung', 'Führerschein Klasse B'],
      sprachen: ['Deutsch', 'Polnisch'], erfahrungJahre: 7, notiz: null,
    });
  });

  it('eine Zahl, die nicht in der Bewerbung steht, wird nicht übernommen (Invariante 6)', () => {
    const e = leseExtraktion(
      '{"qualifikationen":[],"sprachen":["Deutsch"],"erfahrung_jahre":10}', QUELLE);
    expect(e?.erfahrungJahre).toBeNull();
    expect(leseExtraktion(
      '{"qualifikationen":[],"sprachen":[],"erfahrung_jahre":7.5}', QUELLE)?.erfahrungJahre)
      .toBeNull();
  });

  it('was kein Datensatz ist, wird verworfen', () => {
    expect(leseExtraktion('Für diese Vorgangsart gibt es im Demobetrieb noch keine Vorlage.',
      QUELLE)).toBeNull();
    expect(leseExtraktion('{"qualifikationen":"Reinigung","sprachen":[]}', QUELLE)).toBeNull();
    expect(leseExtraktion('{"qualifikationen":[1],"sprachen":[]}', QUELLE)).toBeNull();
    expect(leseExtraktion('[1,2]', QUELLE)).toBeNull();
    expect(leseExtraktion('{kaputt', QUELLE)).toBeNull();
  });
});

describe('eintraege', () => {
  it('leer, doppelt (ohne Rücksicht auf Gross- und Kleinschreibung) und zu viel fallen weg', () => {
    expect(eintraege([' Deutsch ', 'deutsch', '', 'Polnisch'])).toEqual(['Deutsch', 'Polnisch']);
    const viele = Array.from({ length: 50 }, (_, i) => `Eintrag ${String(i)}`);
    expect(eintraege(viele)).toHaveLength(KANDIDAT_EINTRAEGE_HOECHSTENS);
  });
});
