/**
 * PR 61 — der CAMT.053-Leser (ACC-04 Abnahme (1) und (3)).
 *
 * Die Datei ist rein: XML herein, Zeilen hinaus. Jeder Grenzfall steht
 * deshalb hier und nicht in einer Fixtur — und was hier geprüft wird, sind
 * genau die vier Stellen, an denen ein Kontoauszug still falsch gelesen wird:
 * der Betrag, die Richtung, die Sammelbuchung und die Vormerkung.
 */
import { describe, expect, it } from 'vitest';
import {
  CamtFehler, centAus, datumAus, leseCamt053, leseXml,
} from '../../src/server/services/finanz/bank/camt.js';

/** Ein Auszug, wie eine deutsche Bank ihn liefert — gekürzt auf das Nötige. */
function auszug(eintraege: string, saldo = `
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1000.00</Amt><CdDbtInd/><CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-08-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">2190.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-08-31</Dt></Dt></Bal>`): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>AUSZUG-2026-08</Id>
      <Acct><Id><IBAN>DE02120300000000202051</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <FrToDt><FrDtTm>2026-08-01T00:00:00+02:00</FrDtTm>
              <ToDtTm>2026-08-31T23:59:59+02:00</ToDtTm></FrToDt>
      ${saldo}
      ${eintraege}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
}

const EINGANG = `
      <Ntry>
        <Amt Ccy="EUR">1190.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-08-15</Dt></BookgDt>
        <ValDt><Dt>2026-08-16</Dt></ValDt>
        <NtryRef>NTRY-1</NtryRef>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>RE-2026-00017</EndToEndId></Refs>
          <RltdPties>
            <Dbtr><Nm>Hausverwaltung Mitte GmbH</Nm></Dbtr>
            <DbtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></DbtrAcct>
          </RltdPties>
          <RmtInf><Ustrd>Rechnung RE-2026-00017</Ustrd>
                  <Ustrd>Objekt Kurfuerstendamm</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>`;

describe('(1) der Betrag wird in Cent gelesen — ohne Fliesskommaschritt', () => {
  it('1234.56 sind 123456 Cent', () => {
    expect(centAus('1234.56')).toBe(123_456n);
  });

  it('eine Stelle wird aufgefüllt, keine Stelle ergibt volle Euro', () => {
    expect(centAus('10.5')).toBe(1050n);
    expect(centAus('10')).toBe(1000n);
    expect(centAus('0.01')).toBe(1n);
  });

  it('der Fall, an dem ein Float scheitert', () => {
    /*
     * Vier Beträge, bei denen `parseFloat(x) * 100` NICHT ganzzahlig ist.
     * Mit `Math.round` fiele es nicht auf; ohne Rundung — und eine Rundung
     * schreibt hier niemand hin, weil der Wert ja „schon in Cent" aussieht —
     * landet ein abgeschnittener Cent im Kontoauszug, und die Differenz
     * erklärt hinterher niemand.
     */
    for (const [roh, cent] of [
      ['1.10', 110n], ['2.30', 230n], ['70.07', 7007n], ['1.15', 115n],
    ] as const) {
      expect(centAus(roh), roh).toBe(cent);
      // Bei keinem der vier ist das Produkt ganzzahlig.
      expect(Number.isInteger(parseFloat(roh) * 100), roh).toBe(false);
    }
    /*
     * Und bei DREIEN davon liegt es darunter — `1.10` ergibt
     * 110.00000000000001 und schneidet zufällig richtig ab, die anderen
     * enden auf `.999…` und verlieren beim Abschneiden einen Cent. Genau
     * dieses „zufällig richtig" ist der Grund, warum der Fehler erst beim
     * vierten Auszug auffällt.
     */
    for (const [roh, cent] of [
      ['2.30', 230n], ['70.07', 7007n], ['1.15', 115n],
    ] as const) {
      expect(BigInt(Math.trunc(parseFloat(roh) * 100)), roh).toBe(cent - 1n);
    }
  });

  it('sehr grosse Beträge bleiben exakt', () => {
    expect(centAus('90071992547409.93')).toBe(9_007_199_254_740_993n);
  });

  it('drei Nachkommastellen werden ABGEWIESEN, nicht gerundet', () => {
    // Eine stille Rundung wäre eine erfundene Zahl.
    expect(() => centAus('10.005')).toThrow(CamtFehler);
  });

  it('ein Vorzeichen wird abgewiesen — die Richtung steht in CdtDbtInd', () => {
    expect(() => centAus('-10.00')).toThrow(/Richtung steht in CdtDbtInd/u);
  });

  it('Kommas und Leerzeichen sind kein CAMT-Betrag', () => {
    expect(() => centAus('1.234,56')).toThrow(CamtFehler);
    expect(() => centAus('1 234.56')).toThrow(CamtFehler);
    expect(() => centAus('')).toThrow(CamtFehler);
  });
});

describe('(2) das Datum kommt in zwei Formen', () => {
  it('reines Datum und Zeitstempel ergeben beide den Kalendertag', () => {
    expect(datumAus('2026-08-15')).toBe('2026-08-15');
    expect(datumAus('2026-08-15T10:03:00+02:00')).toBe('2026-08-15');
    expect(datumAus(null)).toBeNull();
    expect(datumAus('15.08.2026')).toBeNull();
  });
});

describe('(3) der Auszug wird gelesen, wie er dasteht', () => {
  it('Kopf, Konto, Zeitraum und Salden', () => {
    const a = leseCamt053(auszug(EINGANG));
    expect(a.auszugId).toBe('AUSZUG-2026-08');
    expect(a.iban).toBe('DE02120300000000202051');
    expect(a.von).toBe('2026-08-01');
    expect(a.bis).toBe('2026-08-31');
    expect(a.anfangssaldoCent).toBe(100_000n);
    expect(a.endsaldoCent).toBe(219_000n);
  });

  it('ein Eingang mit allen Feldern', () => {
    const [u] = leseCamt053(auszug(EINGANG)).umsaetze;
    expect(u).toBeDefined();
    expect(u!.betragCent).toBe(119_000n);
    expect(u!.richtung).toBe('eingang');
    expect(u!.referenz).toBe('RE-2026-00017');
    expect(u!.buchungsdatum).toBe('2026-08-15');
    expect(u!.valuta).toBe('2026-08-16');
    expect(u!.gegenpartei).toBe('Hausverwaltung Mitte GmbH');
    expect(u!.gegenIban).toBe('DE89370400440532013000');
    expect(u!.gebucht).toBe(true);
    // Beide Zweckzeilen, verbunden — so steht es auf dem Beleg.
    expect(u!.verwendungszweck)
      .toBe('Rechnung RE-2026-00017 Objekt Kurfuerstendamm');
  });

  it('ein Ausgang ist ein Ausgang, und die Gegenpartei wechselt die Seite', () => {
    const a = leseCamt053(auszug(`
      <Ntry>
        <Amt Ccy="EUR">500.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
        <BookgDt><Dt>2026-08-20</Dt></BookgDt>
        <NtryDtls><TxDtls>
          <RltdPties><Cdtr><Nm>Reinigungsmittel Nord AG</Nm></Cdtr>
            <CdtrAcct><Id><IBAN>DE11520513735120710131</IBAN></Id></CdtrAcct>
          </RltdPties>
          <RmtInf><Ustrd>ER-4711</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>`));
    const u = a.umsaetze[0]!;
    expect(u.richtung).toBe('ausgang');
    expect(u.betragCent).toBe(50_000n);
    expect(u.gegenpartei).toBe('Reinigungsmittel Nord AG');
    expect(u.gegenIban).toBe('DE11520513735120710131');
  });

  it('eine Sammelbuchung ergibt MEHRERE Umsätze, nicht einen', () => {
    /*
     * Der Normalfall beim Lastschrifteinzug. Den Sammelbetrag als einen
     * Umsatz zu führen hiesse, dass keine einzelne Rechnung je einen Treffer
     * bekäme — der Abgleich fände nie etwas und niemand wüsste, warum.
     */
    const a = leseCamt053(auszug(`
      <Ntry>
        <Amt Ccy="EUR">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
        <BookgDt><Dt>2026-08-21</Dt></BookgDt>
        <NtryRef>SAMMEL-9</NtryRef>
        <NtryDtls>
          <TxDtls><Amt Ccy="EUR">100.00</Amt>
            <Refs><EndToEndId>RE-1</EndToEndId></Refs></TxDtls>
          <TxDtls><Amt Ccy="EUR">200.00</Amt>
            <Refs><EndToEndId>RE-2</EndToEndId></Refs></TxDtls>
        </NtryDtls>
      </Ntry>`));
    expect(a.umsaetze).toHaveLength(2);
    expect(a.umsaetze.map((u) => u.betragCent)).toEqual([10_000n, 20_000n]);
    expect(a.umsaetze.map((u) => u.referenz)).toEqual(['RE-1', 'RE-2']);
    // Die Summe der Einzelnen ist der Sammelbetrag.
    expect(a.umsaetze.reduce((s, u) => s + u.betragCent, 0n)).toBe(30_000n);
  });

  it('ein Eintrag ohne TxDtls ist selbst der Umsatz', () => {
    const a = leseCamt053(auszug(`
      <Ntry>
        <Amt Ccy="EUR">42.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
        <BookgDt><Dt>2026-08-22</Dt></BookgDt>
        <NtryRef>EINZEL-1</NtryRef>
        <AddtlNtryInf>Zinsgutschrift</AddtlNtryInf>
      </Ntry>`));
    expect(a.umsaetze).toHaveLength(1);
    expect(a.umsaetze[0]!.referenz).toBe('EINZEL-1');
    expect(a.umsaetze[0]!.verwendungszweck).toBe('Zinsgutschrift');
  });

  it('eine Vormerkung ist als solche gekennzeichnet', () => {
    const a = leseCamt053(auszug(`
      <Ntry>
        <Amt Ccy="EUR">99.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts>
        <BookgDt><Dt>2026-08-23</Dt></BookgDt>
      </Ntry>`));
    expect(a.umsaetze[0]!.gebucht).toBe(false);
  });

  it('ein Sollsaldo ist negativ — dort steht die Richtung im Vorzeichen', () => {
    const a = leseCamt053(auszug(EINGANG, `
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">500.00</Amt><CdtDbtInd>DBIT</CdtDbtInd></Bal>`));
    expect(a.endsaldoCent).toBe(-50_000n);
  });
});

describe('(4) was kein Kontoauszug ist, wird abgewiesen', () => {
  it('eine DTD-Deklaration wird abgewiesen, nicht ignoriert (XXE)', () => {
    const boese = `<?xml version="1.0"?>
      <!DOCTYPE Document [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
      <Document><BkToCstmrStmt><Stmt><Id>&xxe;</Id></Stmt></BkToCstmrStmt></Document>`;
    expect(() => leseCamt053(boese)).toThrow(/DTD oder eine Entität/u);
  });

  it('CAMT.052 und CAMT.054 werden benannt abgewiesen', () => {
    const c052 = `<Document><BkToCstmrAcctRpt><Rpt><Id>X</Id></Rpt>
      </BkToCstmrAcctRpt></Document>`;
    expect(() => leseCamt053(c052)).toThrow(/kein CAMT\.053/u);
  });

  it('eine nicht geschlossene Marke wird benannt', () => {
    expect(() => leseXml('<a><b></a>')).toThrow(CamtFehler);
    expect(() => leseXml('<a><b></b>')).toThrow(/nicht geschlossen/u);
  });

  it('ein Umsatz ohne Betrag oder ohne Buchungstag wird abgewiesen', () => {
    expect(() => leseCamt053(auszug(`
      <Ntry><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-08-15</Dt></BookgDt></Ntry>`)))
      .toThrow(/fehlt sein Betrag/u);
    expect(() => leseCamt053(auszug(`
      <Ntry><Amt Ccy="EUR">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Ntry>`)))
      .toThrow(/fehlt sein Buchungstag/u);
  });

  it('ein Auszug ohne Id wird abgewiesen', () => {
    expect(() => leseCamt053(
      '<Document><BkToCstmrStmt><Stmt><Acct/></Stmt></BkToCstmrStmt></Document>'))
      .toThrow(/fehlt seine Kennung/u);
  });
});

describe('(5) Entitäten und CDATA im Verwendungszweck', () => {
  it('`&amp;` wird zu `&`, und zwar zuletzt', () => {
    const a = leseCamt053(auszug(`
      <Ntry><Amt Ccy="EUR">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-08-15</Dt></BookgDt>
        <RmtInf><Ustrd>Meier &amp; Sohn &lt;GmbH&gt;</Ustrd></RmtInf>
      </Ntry>`));
    expect(a.umsaetze[0]!.verwendungszweck).toBe('Meier & Sohn <GmbH>');
  });

  it('`&amp;lt;` bleibt der TEXT `&lt;` — die Reihenfolge entscheidet', () => {
    /*
     * Würde `&amp;` zuerst aufgelöst, stünde danach `&lt;` da und würde im
     * zweiten Durchgang zu `<`. Aus dem Text `&lt;` wäre ein Zeichen
     * geworden, das nie dastand.
     */
    const a = leseCamt053(auszug(`
      <Ntry><Amt Ccy="EUR">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-08-15</Dt></BookgDt>
        <RmtInf><Ustrd>&amp;lt;</Ustrd></RmtInf>
      </Ntry>`));
    expect(a.umsaetze[0]!.verwendungszweck).toBe('&lt;');
  });

  it('CDATA kommt als Text an', () => {
    const a = leseCamt053(auszug(`
      <Ntry><Amt Ccy="EUR">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-08-15</Dt></BookgDt>
        <RmtInf><Ustrd><![CDATA[RE & 17 < 20]]></Ustrd></RmtInf>
      </Ntry>`));
    expect(a.umsaetze[0]!.verwendungszweck).toBe('RE & 17 < 20');
  });
});
