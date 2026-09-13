/**
 * PR 62 — ein Posteingang, dessen Reihenfolge man erklaeren kann (APR-01),
 * und die Zusammenfassung, die ein Mensch liest (APR-02).
 *
 * Zwei Zusagen:
 *  - **Die Einstufung ist Code.** Keine Bedingung hier fragt ein Modell.
 *  - **Die Reihenfolge ist total.** Zwei Zeilen tauschen beim Neuladen nie
 *    den Platz — sonst oeffnet ein Mensch zweimal dieselbe und eine nie.
 */
import { describe, expect, it } from 'vitest';
import {
  dringlichkeit, dringlichkeitText, risikoPunkte, sortierePosteingang,
  sortSchluessel, stufeRisikoEin, VORGANG_TYPEN,
  type PosteingangZeile, type RisikoLage,
} from '../../src/server/services/freigabe/posteingang.js';
import {
  euro, euroMitVorzeichen, OHNE_VERGLEICH, zusammenfassung,
} from '../../src/server/services/freigabe/zusammenfassung.js';
import { diffVergleich, type Vergleichsmodell, type VergleichsPosition }
  from '../../src/server/services/freigabe/diff.js';
import { cent, formatiereGeld } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';

const JETZT = new Date('2026-09-13T12:00:00.000Z');

function lage(teil: Partial<RisikoLage> = {}): RisikoLage {
  return {
    vorgangTyp: 'interner_hinweis',
    betragCent: null,
    wirksameGrenzeCent: cent(2_000_000n),
    oeffentlicherAuftraggeber: false,
    neueGegenpartei: false,
    unsichereFelder: 0,
    injektionsverdacht: false,
    personenbezogeneEntscheidung: false,
    arbzgVerdikt: 'keine',
    hatVergleich: true,
    diffLeer: false,
    ...teil,
  };
}

describe('(1) die Risikoeinstufung ist Code, nicht Einschaetzung', () => {
  it('ein interner Hinweis ist niedrig', () => {
    expect(stufeRisikoEin(lage()).risiko).toBe('niedrig');
  });

  it('jede Aussendung ist mindestens mittel', () => {
    expect(stufeRisikoEin(lage({ vorgangTyp: 'externer_versand' })).risiko).toBe('mittel');
    expect(stufeRisikoEin(lage({ vorgangTyp: 'buchung_uebernehmen' })).risiko).toBe('mittel');
    expect(stufeRisikoEin(lage({ vorgangTyp: 'beitrag_veroeffentlichen' })).risiko).toBe('mittel');
  });

  const hoch: readonly [string, Partial<RisikoLage>][] = [
    ['Betrag ueber der Grenze', { betragCent: cent(2_000_001n) }],
    ['oeffentlicher Auftraggeber', { oeffentlicherAuftraggeber: true }],
    ['neue Gegenpartei', { neueGegenpartei: true }],
    ['ein unsicheres Feld', { unsichereFelder: 1 }],
    ['Injektionsverdacht', { injektionsverdacht: true }],
    ['personenbezogene Entscheidung', { personenbezogeneEntscheidung: true }],
    ['ein ArbZG-Verdikt', { arbzgVerdikt: 'ruhezeit' }],
    ['kein Vergleich', { hatVergleich: false }],
  ];

  for (const [name, teil] of hoch) {
    it(`${name} ergibt hoch — auch bei einem internen Vorgang`, () => {
      expect(stufeRisikoEin(lage(teil)).risiko).toBe('hoch');
    });
  }

  it('alle zutreffenden Gruende werden gesammelt, nicht nur der erste', () => {
    const urteil = stufeRisikoEin(lage({
      neueGegenpartei: true, unsichereFelder: 3, injektionsverdacht: true,
    }));
    expect(urteil.gruende).toHaveLength(3);
    expect(urteil.gruende.join(' ')).toMatch(/3 unsichere Felder/u);
  });

  it('ein Betrag genau auf der Grenze ist nicht darueber', () => {
    expect(stufeRisikoEin(lage({ betragCent: cent(2_000_000n) })).risiko).toBe('niedrig');
  });

  it('ohne Grenze gibt es keine Ueberschreitung — und keine erfundene', () => {
    expect(stufeRisikoEin(lage({
      betragCent: cent(9_999_999n), wirksameGrenzeCent: null,
    })).risiko).toBe('niedrig');
  });

  it('eine unveraenderte Monatsrechnung faellt auf niedrig', () => {
    expect(stufeRisikoEin(lage({
      vorgangTyp: 'monatsrechnung_entwurf', diffLeer: true, hatVergleich: true,
    })).risiko).toBe('niedrig');
  });

  /**
   * Der Fall, der aussieht wie „unveraendert" und keiner ist: ohne Vergleich
   * ist ein leerer Diff nicht „nichts geaendert", sondern „nie verglichen".
   */
  it('ein leerer Diff OHNE Vergleich faellt NICHT auf niedrig', () => {
    expect(stufeRisikoEin(lage({
      vorgangTyp: 'monatsrechnung_entwurf', diffLeer: true, hatVergleich: false,
    })).risiko).toBe('hoch');
  });

  it('jede Vorgangsart bekommt eine Einstufung — keine faellt durch', () => {
    for (const typ of VORGANG_TYPEN) {
      const urteil = stufeRisikoEin(lage({ vorgangTyp: typ }));
      expect(['niedrig', 'mittel', 'hoch']).toContain(urteil.risiko);
      expect(urteil.gruende.length).toBeGreaterThan(0);
    }
  });
});

describe('(2) die Dringlichkeit', () => {
  const frist = (stunden: number): Date =>
    new Date(JETZT.getTime() + stunden * 3_600_000);

  it('ohne Frist: 0', () => expect(dringlichkeit(null, JETZT)).toBe(0));
  it('ueberfaellig: 5', () => expect(dringlichkeit(frist(-1), JETZT)).toBe(5));
  it('genau jetzt ist ueberfaellig: 5', () => expect(dringlichkeit(JETZT, JETZT)).toBe(5));
  it('unter 4 Stunden: 4', () => expect(dringlichkeit(frist(3.9), JETZT)).toBe(4));
  it('genau 4 Stunden: 3', () => expect(dringlichkeit(frist(4), JETZT)).toBe(3));
  it('unter 24 Stunden: 3', () => expect(dringlichkeit(frist(23), JETZT)).toBe(3));
  it('genau 24 Stunden: 2', () => expect(dringlichkeit(frist(24), JETZT)).toBe(2));
  it('unter 3 Tagen: 2', () => expect(dringlichkeit(frist(71), JETZT)).toBe(2));
  it('genau 3 Tage: 1', () => expect(dringlichkeit(frist(72), JETZT)).toBe(1));

  it('jede Stufe hat eine Beschriftung', () => {
    for (const s of [0, 1, 2, 3, 4, 5] as const) {
      expect(dringlichkeitText(s).length).toBeGreaterThan(0);
    }
  });
});

describe('(3) die Ordnung ist total — sonst springt die Liste', () => {
  function zeile(teil: Partial<PosteingangZeile> = {}): PosteingangZeile {
    return {
      id: 'a', frist: null, risiko: 'niedrig', betragCent: null,
      erstelltAm: new Date('2026-09-01T00:00:00.000Z'), ...teil,
    };
  }

  it('Dringlichkeit schlaegt Risiko', () => {
    const ueberfaellig = zeile({ id: 'a', frist: new Date('2026-09-12T00:00:00Z'), risiko: 'niedrig' });
    const hoch = zeile({ id: 'b', frist: null, risiko: 'hoch' });
    expect(sortierePosteingang([hoch, ueberfaellig], JETZT).map((z) => z.id))
      .toEqual(['a', 'b']);
  });

  it('bei gleicher Dringlichkeit schlaegt Risiko den Betrag', () => {
    const a = zeile({ id: 'a', risiko: 'mittel', betragCent: cent(100n) });
    const b = zeile({ id: 'b', risiko: 'hoch', betragCent: cent(1n) });
    expect(sortierePosteingang([a, b], JETZT).map((z) => z.id)).toEqual(['b', 'a']);
  });

  it('bei gleichem Risiko schlaegt der groessere Betrag', () => {
    const a = zeile({ id: 'a', betragCent: cent(100n) });
    const b = zeile({ id: 'b', betragCent: cent(5000n) });
    expect(sortierePosteingang([a, b], JETZT).map((z) => z.id)).toEqual(['b', 'a']);
  });

  it('bei gleichem Betrag steht das Aeltere oben', () => {
    const a = zeile({ id: 'a', erstelltAm: new Date('2026-09-05T00:00:00Z') });
    const b = zeile({ id: 'b', erstelltAm: new Date('2026-09-01T00:00:00Z') });
    expect(sortierePosteingang([a, b], JETZT).map((z) => z.id)).toEqual(['b', 'a']);
  });

  it('bei voelligem Gleichstand entscheidet die Kennung — die Liste springt nie', () => {
    const a = zeile({ id: 'zzz' });
    const b = zeile({ id: 'aaa' });
    expect(sortierePosteingang([a, b], JETZT).map((z) => z.id)).toEqual(['aaa', 'zzz']);
    expect(sortierePosteingang([b, a], JETZT).map((z) => z.id)).toEqual(['aaa', 'zzz']);
  });

  it('ein fehlender Betrag ist 0 und nicht „unendlich"', () => {
    const ohne = zeile({ id: 'a', betragCent: null });
    const mit = zeile({ id: 'b', betragCent: cent(1n) });
    expect(sortierePosteingang([ohne, mit], JETZT).map((z) => z.id)).toEqual(['b', 'a']);
  });

  it('der Schluessel wird angezeigt — er ist keine verborgene Regel', () => {
    expect(sortSchluessel(zeile({ risiko: 'hoch', frist: new Date('2026-09-12T00:00:00Z') }), JETZT))
      .toBe('5·3');
  });

  it('die Risikopunkte sind 1, 2, 3', () => {
    expect([risikoPunkte('niedrig'), risikoPunkte('mittel'), risikoPunkte('hoch')])
      .toEqual([1, 2, 3]);
  });

  it('die Sortierung veraendert die Eingabe nicht', () => {
    const zeilen = [zeile({ id: 'b' }), zeile({ id: 'a' })];
    sortierePosteingang(zeilen, JETZT);
    expect(zeilen.map((z) => z.id)).toEqual(['b', 'a']);
  });
});

describe('(4) die Zusammenfassung kommt aus einer Schablone (APR-02)', () => {
  function position(teil: Partial<VergleichsPosition> = {}): VergleichsPosition {
    return {
      objektId: 'obj-kudamm', leistungskatalogId: 'kat-unterhalt',
      bezeichnung: 'Nachtstunden', menge: milliMenge(12_000n), einheit: 'h',
      einzelpreisCent: cent(3800n), betragCent: cent(45_600n),
      herkunft: [{ art: 'zeiteintrag', id: 'z-1' }], meta: {}, ...teil,
    };
  }
  function modell(positionen: readonly VergleichsPosition[]): Vergleichsmodell {
    const netto = positionen.reduce((s, p) => s + p.betragCent, 0n);
    return {
      vorgangTyp: 'monatsrechnung_entwurf', periode: 'September 2026', positionen,
      ustGruppen: [], summeNettoCent: cent(netto), summeBruttoCent: cent(netto),
      leistungszeitraum: null,
    };
  }
  const namen = new Map([['obj-kudamm', 'Kurfuerstendamm']]);

  it('kein Unterschied: „Unveraendert gegenueber …"', () => {
    const d = diffVergleich(modell([position()]), modell([position()]));
    expect(zusammenfassung(d, 'August 2026')).toBe('Unveraendert gegenueber August 2026');
  });

  it('eine Aenderung: der Satz aus §14.5, mit Ort und Vorzeichen', () => {
    const d = diffVergleich(modell([]), modell([position()]));
    expect(zusammenfassung(d, 'August 2026', namen))
      .toBe('Wie zu August 2026, ausser Nachtstunden an Kurfuerstendamm neu → '
        + `+${formatiereGeld(cent(45_600n))}`);
  });

  it('zwei Aenderungen werden mit „und" verbunden', () => {
    const a = position({ leistungskatalogId: 'kat-a', bezeichnung: 'A' });
    const b = position({ leistungskatalogId: 'kat-b', bezeichnung: 'B' });
    const satz = zusammenfassung(diffVergleich(modell([]), modell([a, b])), 'August 2026');
    expect(satz.split(' und ')).toHaveLength(2);
  });

  it('mehr als drei: die Zaehlform mit dem Nettodelta', () => {
    const vier = ['a', 'b', 'c', 'd'].map((k) =>
      position({ leistungskatalogId: `kat-${k}`, bezeichnung: k.toUpperCase() }));
    const satz = zusammenfassung(diffVergleich(modell([]), modell(vier)), 'August 2026');
    expect(satz).toBe(`4 Aenderungen · Netto +${formatiereGeld(cent(182_400n))} · Details unten`);
  });

  it('ohne Objektnamen entfaellt der Ort — kein „an undefined"', () => {
    const d = diffVergleich(modell([]), modell([position()]));
    expect(zusammenfassung(d, 'August 2026')).not.toMatch(/undefined/u);
    expect(zusammenfassung(d, 'August 2026')).toBe(
      `Wie zu August 2026, ausser Nachtstunden neu → +${formatiereGeld(cent(45_600n))}`);
  });

  it('ohne Vergleich sagt der Satz genau das', () => {
    expect(OHNE_VERGLEICH).toBe('Erstmalig — vollstaendige Pruefung');
  });
});

describe('(5) Geld wird mit dem EINEN Formatierer angezeigt', () => {
  /**
   * Der Punkt dieser Gruppe: es gibt keinen zweiten Geldformatierer. Eine
   * eigene Fassung in der Freigabe waere die Stelle, an der das geschuetzte
   * Leerzeichen oder der Tausenderpunkt still auseinanderlaufen.
   */
  it('`euro` IST `formatiereGeld` — nicht eine zweite Fassung davon', () => {
    expect(euro).toBe(formatiereGeld);
  });

  it('Tausenderpunkte und Komma, mit geschuetztem Leerzeichen', () => {
    expect(euro(cent(123_456_789n))).toBe(formatiereGeld(cent(123_456_789n)));
    expect(euro(cent(123_456_789n))).toMatch(/^1\.234\.567,89\u00a0€$/u);
  });

  it('das Vorzeichen ist explizit (DESIGN §9)', () => {
    expect(euroMitVorzeichen(cent(45_600n))).toBe(`+${formatiereGeld(cent(45_600n))}`);
    expect(euroMitVorzeichen(cent(-45_600n)).startsWith('−')).toBe(true);
  });

  it('null bekommt ein Plus, kein Minus', () => {
    expect(euroMitVorzeichen(cent(0n)).startsWith('+')).toBe(true);
  });

  it('das Minus ist das Minuszeichen U+2212, nicht der Bindestrich', () => {
    expect(euroMitVorzeichen(cent(-1n))).not.toMatch(/-/u);
  });
});
