/**
 * PR 53 — ZUGFeRD 2.x in CII, gegen die XRechnung gehalten (FIN-12).
 *
 * Die Abnahme der ROADMAP für dieses Stück lautet: „totals equal in both
 * directions". Genau das steht hier — und zwar auf den Cent und aus beiden
 * Dokumenten gelesen, nicht aus den Eingabedaten. Zwei Bauer, die dieselbe
 * Rechnung verschieden addieren, fallen sonst erst dem Empfänger auf, der
 * das PDF gegen die XML hält — an einer Rechnung, die nach §14 UStG nicht
 * mehr geändert werden darf.
 */
import { describe, expect, it } from 'vitest';
import { baueUbl } from '../../src/server/services/finanz/xrechnung/index.js';
import {
  CII_GUIDELINE, baueCii, ciiSummen,
} from '../../src/server/services/finanz/zugferd/cii.js';
import { XRechnungUnvollstaendigFehler }
  from '../../src/server/services/finanz/xrechnung/index.js';
import { cent, type Cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import type {
  Anschrift, Position, RechnungVollstaendig,
} from '../../src/server/services/finanz/kanonisch.js';

const c = (n: bigint): Cent => cent(n);

const BERLIN = (strasse: string, plz: string, ort: string): Anschrift => ({
  zeile: `${strasse}, ${plz} ${ort}, DE`,
  strasse, zusatz: null, plz, ort, land: 'DE',
});

function position(nr: number, netto: bigint, preis: bigint): Position {
  return {
    nr, art: 'leistung',
    bezeichnung: `Unterhaltsreinigung Los ${String(nr)}`,
    beschreibung: null,
    menge: milliMenge(30_870n),
    einheit: 'm2', einheitCode: 'MTK',
    preisBasismenge: milliMenge(1000n),
    einzelpreisCent: c(preis),
    rabattBp: 0,
    nettoCent: c(netto),
    steuersatzGruppe: 'ust_19', satzBp: 1900, kategorie: 'S',
    abrechnungsart: null, leistungVon: null, leistungBis: null, quellen: [],
  };
}

function beispiel(): RechnungVollstaendig {
  return {
    leistender: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'CSE Dienstleistungen GmbH',
      rechtsform: 'GmbH',
      anschrift: BERLIN('Kurfürstendamm 21', '10719', 'Berlin'),
      kontakt: { name: 'Buchhaltung', telefon: '+49 30 5550100', email: 'rechnung@cse.test' },
      steuernummer: '30/123/45678',
      ustid: 'DE123456789',
      gericht: 'Amtsgericht Berlin-Charlottenburg',
      hrb: 'HRB 123456 B',
      geschaeftsfuehrer: 'S. Safar',
      eadresse: 'rechnung@cse.test',
      eadresseSchema: 'EM',
    },
    empfaenger: {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Meyer & Sohn GmbH',
      anschrift: BERLIN('Musterweg 7', '10178', 'Berlin'),
      ustid: 'DE987654321',
      leitwegId: null,
      kaeuferReferenz: 'BESTELLUNG-4711',
      bestellnummer: null,
      eadresse: 'rechnung@meyer.test',
      eadresseSchema: 'EM',
    },
    nummernkreisId: '33333333-3333-3333-3333-333333333333',
    nummer: 'RE-2026-00042',
    kettePosition: 42,
    rechnungsart: 'ausgangsrechnung',
    rechnungsartCode: '380',
    rechnungsdatum: '2026-09-11',
    leistungVon: '2026-08-01',
    leistungBis: '2026-08-31',
    vereinnahmungGeplantAm: null,
    objekt: null,
    sprache: 'de',
    waehrung: 'EUR',
    kopftext: null,
    fusstext: null,
    steuerhinweis: null,
    hinweise: [],
    positionen: [position(1, 100_000n, 250n)],
    zuschlaege: [],
    steuerzeilen: [{
      steuersatzGruppe: 'ust_19', kategorie: 'S', satzBp: 1900,
      nettoCent: c(100_000n), steuerCent: c(19_000n),
      befreiungsgrundCode: null, befreiungsgrundText: null,
    }],
    abzuege: [],
    nettoGesamtCent: c(100_000n),
    steuerGesamtCent: c(19_000n),
    bruttoCent: c(119_000n),
    abzugBruttoCent: c(0n),
    zahlbetragCent: c(119_000n),
    bauabzugsteuer: {
      pflichtig: false, satzBp: null, grundlageCent: null,
      einbehaltCent: c(0n), freistellungsbescheinigung: null,
    },
    ueberweisungsbetragCent: c(119_000n),
    zahlung: {
      bankkonto: {
        iban: 'DE02120300000000202051', bic: 'BYLADEM1001',
        kontoinhaber: 'CSE Dienstleistungen GmbH',
      },
      zahlungsmittelCode: '58',
      zahlungsbedingungText: 'Zahlbar innerhalb von 30 Tagen ohne Abzug.',
      zahlungszielTage: 30,
      faelligAm: '2026-10-11',
      skontoBp: null, skontoTage: null,
    },
    istKleinbetrag: false,
    kleinbetragGrenzeCent: null,
    reverseCharge: false,
    reverseChargeGrundlage: null,
    festgeschriebenAm: '2026-09-11T09:00:00.000Z',
    festgeschriebenVon: '44444444-4444-4444-4444-444444444444',
  };
}

/** Der Textinhalt des ersten Elements dieses Namens — ohne XML-Bibliothek. */
function wert(xml: string, name: string): string | null {
  const treffer = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`, 'u').exec(xml);
  return treffer?.[1] ?? null;
}

function alleWerte(xml: string, name: string): readonly string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`, 'gu'))]
    .map((m) => m[1] ?? '');
}

// ---------------------------------------------------------------------------

describe('(1) Das Dokument ist eine CII-Rechnung nach EN 16931', () => {
  it('Wurzel, Namensräume und Profil stehen', () => {
    const xml = baueCii(beispiel());
    expect(xml).toContain('<rsm:CrossIndustryInvoice');
    expect(xml).toContain(
      'xmlns:ram="urn:un:unece:uncefact:data:standard:'
      + 'ReusableAggregateBusinessInformationEntity:100"');
    expect(wert(xml, 'ram:ID')).toBe(CII_GUIDELINE);
  });

  /**
   * Das Profil ist NICHT das der XRechnung — und das ist der Kern des
   * Unterschieds: ZUGFeRD geht an gewerbliche Empfänger, die keine
   * Leitweg-ID haben.
   */
  it('es trägt das EN-16931-Profil, nicht die XRechnung-Kennung', () => {
    expect(baueCii(beispiel())).not.toContain('xeinkauf.de:kosit');
  });

  it('Datumsangaben stehen im Format 102, ohne Bindestriche', () => {
    const xml = baueCii(beispiel());
    expect(xml).toContain('<udt:DateTimeString format="102">20260911</udt:DateTimeString>');
    expect(xml).toContain('<udt:DateTimeString format="102">20261011</udt:DateTimeString>');
  });

  /**
   * In CII trägt genau EIN Betrag die Währung als Attribut. Steht sie an
   * einem der übrigen, weist der Prüfer des Empfängers das Dokument ab — mit
   * einer Meldung über einen Datentyp, nicht über einen falschen Betrag.
   */
  it('nur `ram:TaxTotalAmount` trägt `currencyID`', () => {
    const xml = baueCii(beispiel());
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">190.00</ram:TaxTotalAmount>');
    const mitWaehrung = [...xml.matchAll(/<(ram:\w+) currencyID="/gu)].map((m) => m[1]);
    expect([...new Set(mitWaehrung)]).toEqual(['ram:TaxTotalAmount']);
  });

  it('der Kundenname wird maskiert — auch hier', () => {
    const xml = baueCii(beispiel());
    expect(xml).toContain('Meyer &amp; Sohn GmbH');
    expect(xml).not.toContain('Meyer & Sohn');
  });
});

describe('(2) Die Summen stimmen in BEIDE Richtungen', () => {
  /**
   * Gelesen wird aus den DOKUMENTEN, nicht aus der Eingabe. Ein Test, der
   * beide Bauer gegen dieselbe Zahl in `beispiel()` hält, bestünde auch
   * dann, wenn beide sie falsch übernähmen.
   */
  it('jede der acht Endsummen steht in CII und UBL gleich', () => {
    const r = beispiel();
    const cii = baueCii(r);
    const ubl = baueUbl(r);

    const paare: readonly (readonly [string, string])[] = [
      ['ram:LineTotalAmount', 'cbc:LineExtensionAmount'],
      ['ram:TaxBasisTotalAmount', 'cbc:TaxExclusiveAmount'],
      ['ram:GrandTotalAmount', 'cbc:TaxInclusiveAmount'],
      ['ram:AllowanceTotalAmount', 'cbc:AllowanceTotalAmount'],
      ['ram:ChargeTotalAmount', 'cbc:ChargeTotalAmount'],
      ['ram:TotalPrepaidAmount', 'cbc:PrepaidAmount'],
      ['ram:DuePayableAmount', 'cbc:PayableAmount'],
    ];
    for (const [imCii, imUbl] of paare) {
      const links = alleWerte(cii, imCii).at(-1);
      const rechts = alleWerte(ubl, imUbl).at(-1);
      expect(links, `${imCii} fehlt in der CII`).not.toBeUndefined();
      expect(links, `${imCii} ≠ ${imUbl}`).toBe(rechts);
    }
    /* Die Steuersumme steht in beiden, nur mit verschiedenem Elementnamen. */
    expect(wert(cii, 'ram:TaxTotalAmount')).toBe('190.00');
    expect(ubl).toContain('190.00');
  });

  it('die acht Summen als Zahlen — dieselbe Herleitung wie im Dokument', () => {
    const s = ciiSummen(beispiel());
    expect(s.zeilen).toBe(100_000n);
    expect(s.netto).toBe(100_000n);
    expect(s.steuer).toBe(19_000n);
    expect(s.brutto).toBe(119_000n);
    expect(s.gezahlt).toBe(0n);
    expect(s.zahlbetrag).toBe(119_000n);
  });

  it('mit Abschlagsabzug bleibt die Rechnung in sich stimmig', () => {
    const r: RechnungVollstaendig = {
      ...beispiel(),
      abzuege: [{
        abschlagNummer: 'RE-2026-00001',
        steuersatzGruppe: 'ust_19',
        abzugNettoCent: c(40_000n),
        abzugSteuerCent: c(7600n),
      }],
      abzugBruttoCent: c(47_600n),
      zahlbetragCent: c(71_400n),
      ueberweisungsbetragCent: c(71_400n),
    };
    const cii = baueCii(r);
    const ubl = baueUbl(r);
    /* BT-113 „bereits gezahlt" — und BT-115 als Differenz daraus. */
    expect(alleWerte(cii, 'ram:TotalPrepaidAmount').at(-1)).toBe('476.00');
    expect(alleWerte(cii, 'ram:DuePayableAmount').at(-1)).toBe('714.00');
    expect(alleWerte(ubl, 'cbc:PrepaidAmount').at(-1)).toBe('476.00');
    expect(alleWerte(ubl, 'cbc:PayableAmount').at(-1)).toBe('714.00');
  });

  it('jede Zeile trägt ihre Summe, und die Zeilen ergeben BT-106', () => {
    const r: RechnungVollstaendig = {
      ...beispiel(),
      positionen: [position(1, 60_000n, 250n), position(2, 40_000n, 250n)],
    };
    const cii = baueCii(r);
    const zeilen = alleWerte(cii, 'ram:LineTotalAmount');
    /* Zwei Zeilensummen plus die Kopfsumme am Ende. */
    expect(zeilen).toEqual(['600.00', '400.00', '1000.00']);
  });
});

describe('(3) Was die XRechnung verweigert, verweigert ZUGFeRD auch', () => {
  it('ohne Kontaktstelle entsteht KEIN Dokument — in beiden Formaten', () => {
    const r = beispiel();
    const ohne: RechnungVollstaendig = {
      ...r,
      leistender: { ...r.leistender, kontakt: { name: null, telefon: null, email: null } },
    };
    expect(() => baueCii(ohne)).toThrow(XRechnungUnvollstaendigFehler);
    expect(() => baueUbl(ohne)).toThrow(XRechnungUnvollstaendigFehler);
  });

  it('und die Liste der fehlenden Felder ist dieselbe', () => {
    const r = beispiel();
    const ohne: RechnungVollstaendig = {
      ...r,
      leistender: { ...r.leistender, ustid: null, steuernummer: null },
    };
    const ausCii = (() => {
      try { baueCii(ohne); return []; } catch (f: unknown) {
        return (f as XRechnungUnvollstaendigFehler).fehlend.map((x) => x.bt);
      }
    })();
    const ausUbl = (() => {
      try { baueUbl(ohne); return []; } catch (f: unknown) {
        return (f as XRechnungUnvollstaendigFehler).fehlend.map((x) => x.bt);
      }
    })();
    expect(ausCii.length).toBeGreaterThan(0);
    expect(ausCii).toEqual(ausUbl);
  });
});
