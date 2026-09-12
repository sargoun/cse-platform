/**
 * Der Abzug der Abschläge in einer Schlussrechnung — die reinen Teile
 * (FIN-08, PR 50).
 *
 * **Was hier bewiesen wird und was nicht.** Dass die Datenbank den richtigen
 * Abschlag findet, dass ein stornierter anhält und dass eine unvollständige
 * Schlussrechnung nicht festgeschrieben werden kann, steht in
 * `tests/isolation/abschlag.test.ts` — das sind Aussagen über Zeilen und
 * Rechte. Hier steht die eine Aussage, an der ein Fehler NICHT auffällt: dass
 * der Abzug die Beträge der abgezogenen Belege TRÄGT und nicht neu ausrechnet.
 */
import { describe, expect, it } from 'vitest';
import {
  fasseAbzugZusammen, jeSteuergruppe, offeneAbschlaegeSatz, type AbzugZeile,
} from '../../src/server/services/finanz/abschlag/index.js';
import { berechneSteuer } from '../../src/server/services/finanz/steuer/satz.js';
import { basisPunkte, cent } from '../../src/server/services/finanz/geld.js';

const REGELSATZ = {
  schluessel: 'regelsatz',
  satzBp: basisPunkte(1900),
  kategorie: 'S',
  befreiungsgrundCode: null,
  befreiungsgrundText: null,
} as const;

const ERMAESSIGT = {
  schluessel: 'ermaessigt',
  satzBp: basisPunkte(700),
  kategorie: 'S',
  befreiungsgrundCode: null,
  befreiungsgrundText: null,
} as const;

/** Die Steuerzeile EINES Abschlags, so wie sie beim Festschreiben eingefroren wird. */
function abschlag(id: string, nettoCent: bigint): AbzugZeile {
  const ergebnis = berechneSteuer([{ nettoCent: cent(nettoCent), gruppe: REGELSATZ }]);
  const zeile = ergebnis.zeilen[0]!;
  return {
    abschlagRechnungId: id,
    steuersatzGruppeId: 'g-regelsatz',
    nettoCent: zeile.nettoCent,
    steuerCent: zeile.steuerCent,
  };
}

describe('drei Abschläge à 10.000,00 € ergeben 30.000,00 € Abzug', () => {
  const zeilen = [
    abschlag('a1', 1_000_000n),
    abschlag('a2', 1_000_000n),
    abschlag('a3', 1_000_000n),
  ];

  it('netto, Steuer und brutto stimmen auf den Cent', () => {
    const v = fasseAbzugZusammen(zeilen);
    expect(v.abzugNettoCent).toBe(3_000_000n);
    expect(v.abzugSteuerCent).toBe(570_000n);          // 3 × 190.000
    expect(v.abzugBruttoCent).toBe(3_570_000n);
  });
});

/**
 * **Der Drittel-Fall — und er ist der ganze Grund für diese Datei.**
 *
 * 10.000,51 € netto, in drei Abschläge geteilt: 3.333,51 + 3.333,50 +
 * 3.333,50. Jeder dieser drei Belege rundet seine 19 % FÜR SICH und ist danach
 * unveränderlich — und bei 333.350 Cent liegt die Steuer auf 63.336,5 Cent,
 * also GENAU auf der halben Stelle, die kaufmännisch aufgerundet wird. Dreimal
 * aufgerundet ergibt 190.011; 19 % auf die Gesamtsumme ergeben 190.010. Ein
 * Cent Unterschied, und er ist kein Rechenfehler, sondern die Folge davon,
 * dass drei Belege drei Rundungen tragen.
 *
 * Der Abzug muss der SUMME DER BELEGE folgen, nicht der Neuberechnung. Wer
 * hier neu rechnet, bekommt eine Schlussrechnung, die um einen Cent von dem
 * abweicht, was der Kunde bereits bezahlt hat — und der Kunde, der nachrechnet,
 * hat recht.
 */
describe('ein Drittel-Betrag: summiert, nicht neu gerundet', () => {
  const drittel = [
    abschlag('a1', 333_351n),
    abschlag('a2', 333_350n),
    abschlag('a3', 333_350n),
  ];

  it('die drei Einzelsteuern weichen von der Steuer auf die Summe ab', () => {
    const einzelsumme = drittel.reduce((s, z) => s + z.steuerCent, 0n);
    const aufDieSumme = berechneSteuer([
      { nettoCent: cent(1_000_051n), gruppe: REGELSATZ },
    ]).steuerGesamtCent;

    // Ohne diesen Unterschied prüfte der Test darunter nichts: er wäre auf
    // beiden Wegen gleich, und „summiert statt neu gerechnet" unbeweisbar.
    expect(einzelsumme).not.toBe(aufDieSumme);
  });

  it('der Abzug trägt die Summe der Belege', () => {
    const v = fasseAbzugZusammen(drittel);
    expect(v.abzugNettoCent).toBe(1_000_051n);
    expect(v.abzugSteuerCent).toBe(drittel.reduce((s, z) => s + z.steuerCent, 0n));
    expect(v.abzugBruttoCent).toBe(v.abzugNettoCent + v.abzugSteuerCent);
  });
});

describe('zwei Steuersätze auf einem Abschlag bleiben getrennt', () => {
  /**
   * Ein Reinigungsauftrag mit Regelsatz und eine ermäßigt besteuerte Leistung
   * auf demselben Beleg. Der Abzug muss beide Gruppen einzeln tragen: die
   * Schlussrechnung weist die Umsatzsteuer nach §14 Abs. 4 Nr. 8 UStG je Satz
   * aus, und ein Abzug in EINER Zahl liesse sich darauf nicht abbilden.
   */
  const gemischt: readonly AbzugZeile[] = [
    { abschlagRechnungId: 'a1', steuersatzGruppeId: 'g-regel', nettoCent: cent(100_000n), steuerCent: cent(19_000n) },
    { abschlagRechnungId: 'a1', steuersatzGruppeId: 'g-erm', nettoCent: cent(50_000n), steuerCent: cent(3_500n) },
    { abschlagRechnungId: 'a2', steuersatzGruppeId: 'g-regel', nettoCent: cent(200_000n), steuerCent: cent(38_000n) },
  ];

  it('je Gruppe summiert, nicht über Gruppen hinweg', () => {
    const proGruppe = jeSteuergruppe(gemischt);
    expect(proGruppe.get('g-regel')).toEqual({ netto: 300_000n, steuer: 57_000n });
    expect(proGruppe.get('g-erm')).toEqual({ netto: 50_000n, steuer: 3_500n });
  });

  it('und die Kopfsumme ist die Summe beider Gruppen', () => {
    const v = fasseAbzugZusammen(gemischt);
    expect(v.abzugNettoCent).toBe(350_000n);
    expect(v.abzugSteuerCent).toBe(60_500n);
  });

  /**
   * Die Gegenprobe zum ermäßigten Satz: er ist wirklich ein anderer, sonst
   * prüfte die Trennung oben nichts.
   */
  it('der ermäßigte Satz ist nicht der Regelsatz', () => {
    expect(ERMAESSIGT.satzBp).not.toBe(REGELSATZ.satzBp);
  });
});

describe('ohne Abschläge ist der Abzug null', () => {
  it('drei Nullen statt einer Ausnahme', () => {
    const v = fasseAbzugZusammen([]);
    expect(v.abzugNettoCent).toBe(0n);
    expect(v.abzugSteuerCent).toBe(0n);
    expect(v.abzugBruttoCent).toBe(0n);
    expect(v.nummern).toEqual([]);
  });
});

/**
 * Der Satz, der im Pflichtfeldbericht landet, wenn ein Abschlag offen ist.
 *
 * **Er nennt die Nummer.** „Es fehlt etwas" ist keine Auskunft, mit der jemand
 * arbeiten kann — und wer die Rechnung gerade festschreiben wollte, braucht
 * sie jetzt und nicht nach einer Suche durch die Rechnungsliste.
 */
describe('die Meldung an den Menschen nennt die Belege', () => {
  it('ohne offene Abschläge gibt es keinen Satz', () => {
    expect(offeneAbschlaegeSatz([])).toBeNull();
  });

  it('ein nirgends abgezogener Abschlag steht mit Nummer da', () => {
    const satz = offeneAbschlaegeSatz([{ nummer: 'RE-2026-0007', verrechnetVon: null }]);
    expect(satz).toContain('RE-2026-0007');
    expect(satz).toContain('zweimal');
  });

  it('mehrere werden aufgezählt, nicht gezählt', () => {
    const satz = offeneAbschlaegeSatz([
      { nummer: 'RE-2026-0007', verrechnetVon: null },
      { nummer: 'RE-2026-0011', verrechnetVon: null },
    ]);
    expect(satz).toContain('RE-2026-0007');
    expect(satz).toContain('RE-2026-0011');
  });

  /**
   * Und der andere Fall bekommt einen anderen Satz: ein Abschlag, den eine
   * FREMDE Schlussrechnung schon abzieht, ist kein vergessener Abzug, sondern
   * eine zweite Schlussrechnung zu einem Auftrag.
   */
  it('anderswo abgezogen liest sich anders als gar nicht abgezogen', () => {
    const fremd = offeneAbschlaegeSatz([
      { nummer: 'RE-2026-0007', verrechnetVon: 'andere-schlussrechnung' },
    ]);
    const gar = offeneAbschlaegeSatz([{ nummer: 'RE-2026-0007', verrechnetVon: null }]);
    expect(fremd).not.toBe(gar);
    expect(fremd).toContain('anderen Schlussrechnung');
  });
});
