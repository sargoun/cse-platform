/**
 * Der Kanonisierer `cse.rechnung.v1` — `05-FINANZEN.md` §5.3.
 *
 * Jede Prüfung hier ist FALSIFIZIERBAR: nimmt man die geprüfte Eigenschaft aus
 * `kanonisch.ts` heraus, fällt genau dieser Test. Das ist bei einem
 * Kanonisierer die einzige Art von Prüfung, die etwas wert ist — die Ausgabe
 * sieht in jeder falschen Variante immer noch aus wie JSON.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  KanonisierungsFehler, SCHEMA_VERSION,
  baueNutzlast, buildKanonischePayload, kanonisiere, kanonischerText,
  type RechnungVollstaendig,
} from '../../src/server/services/finanz/kanonisch.js';
import { cent, type Cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';

const c = (n: bigint): Cent => cent(n);

/** Eine vollständige Rechnung — jede Nullstelle ausgeschrieben, wie §5.3 es verlangt. */
function beispiel(): RechnungVollstaendig {
  return {
    leistender: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'CSE Dienstleistungen GmbH',
      rechtsform: 'GmbH',
      anschrift: {
        zeile: 'Kurfürstendamm 21, 10719 Berlin, DE',
        strasse: 'Kurfürstendamm 21',
        zusatz: null,
        plz: '10719',
        ort: 'Berlin',
        land: 'DE',
      },
      kontakt: { name: 'Buchhaltung', telefon: '+49 30 555 0100', email: 'rechnung@cse.de' },
      steuernummer: '30/123/45678',
      ustid: 'DE123456789',
      gericht: 'Amtsgericht Charlottenburg',
      hrb: 'HRB 12345 B',
      geschaeftsfuehrer: 'Sara Gouneili',
      eadresse: null,
      eadresseSchema: null,
    },
    empfaenger: {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Bezirksamt Mitte',
      anschrift: {
        zeile: 'Karl-Marx-Allee 31, 10178 Berlin, DE',
        strasse: 'Karl-Marx-Allee 31',
        zusatz: null,
        plz: '10178',
        ort: 'Berlin',
        land: 'DE',
      },
      ustid: null,
      leitwegId: '991-12345-67',
      kaeuferReferenz: null,
      bestellnummer: null,
      eadresse: null,
      eadresseSchema: null,
    },
    nummernkreisId: '33333333-3333-3333-3333-333333333333',
    nummer: 'RE-2026-00001',
    kettePosition: 1,
    rechnungsart: 'standard',
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
    positionen: [
      {
        nr: 1,
        art: 'leistung',
        bezeichnung: 'Unterhaltsreinigung August',
        beschreibung: null,
        menge: milliMenge(30_870n),
        einheit: 'm2',
        einheitCode: 'MTK',
        preisBasismenge: milliMenge(1000n),
        einzelpreisCent: c(250n),
        rabattBp: 0,
        nettoCent: c(7718n),
        steuersatzGruppe: 'ust_19',
        satzBp: 1900,
        kategorie: 'S',
        abrechnungsart: null,
        leistungVon: null,
        leistungBis: null,
        quellen: [],
      },
    ],
    zuschlaege: [],
    steuerzeilen: [
      {
        steuersatzGruppe: 'ust_19',
        kategorie: 'S',
        satzBp: 1900,
        nettoCent: c(7718n),
        steuerCent: c(1466n),
        befreiungsgrundCode: null,
        befreiungsgrundText: null,
      },
    ],
    abzuege: [],
    nettoGesamtCent: c(7718n),
    steuerGesamtCent: c(1466n),
    bruttoCent: c(9184n),
    abzugBruttoCent: c(0n),
    zahlbetragCent: c(9184n),
    bauabzugsteuer: {
      pflichtig: false,
      satzBp: null,
      grundlageCent: null,
      einbehaltCent: c(0n),
      freistellungsbescheinigung: null,
    },
    ueberweisungsbetragCent: c(9184n),
    zahlung: {
      bankkonto: null,
      zahlungsmittelCode: null,
      zahlungsbedingungText: null,
      zahlungszielTage: 30,
      faelligAm: '2026-10-11',
      skontoBp: null,
      skontoTage: null,
    },
    istKleinbetrag: false,
    kleinbetragGrenzeCent: null,
    reverseCharge: false,
    reverseChargeGrundlage: null,
    festgeschriebenAm: '2026-09-11T09:00:00.000Z',
    festgeschriebenVon: '44444444-4444-4444-4444-444444444444',
  };
}

describe('RFC 8785 — die vier Regeln des §5.3', () => {
  it('Schlüssel stehen nach UTF-16-Codeeinheiten sortiert, nicht nach Einfügereihenfolge', () => {
    // `Z` (0x5A) kommt VOR `a` (0x61), und `ä` (0xE4) nach beiden. Eine
    // Sortierung mit `localeCompare` ergäbe hier eine andere Reihenfolge —
    // genau das ist der Fehler, den RFC 8785 ausschliesst.
    expect(kanonischerText({ a: 1, 'Z': 2, 'ä': 3, 'A': 4 }))
      .toBe('{"A":4,"Z":2,"a":1,"ä":3}');
  });

  it('Beträge sind ganzzahlige JSON-Zahlen in Cent — keine Zeichenkette, kein Komma', () => {
    expect(kanonischerText({ netto_cent: 1999n })).toBe('{"netto_cent":1999}');
    // Und das Gegenstück: eine Gleitkommazahl ist gar nicht kanonisierbar.
    expect(() => kanonischerText({ netto_cent: 19.99 })).toThrow(KanonisierungsFehler);
  });

  it('Mengen sind ZEICHENKETTEN mit genau drei Nachkommastellen', () => {
    const bytes = kanonischerText(baueNutzlast(beispiel()));
    expect(bytes).toContain('"menge":"30.870"');
    expect(bytes).toContain('"preis_basismenge":"1.000"');
    // Die Falsifizierung: als JSON-Zahl stünde dort `30.87` und die dritte
    // Stelle wäre verloren.
    expect(bytes).not.toContain('"menge":30.87');
  });

  it('Nullwerte werden AUSGESCHRIEBEN, nie weggelassen', () => {
    const text = kanonischerText(baueNutzlast(beispiel()));
    expect(text).toContain('"kopftext":null');
    expect(text).toContain('"vereinnahmung_geplant_am":null');
    expect(text).toContain('"objekt":null');
    expect(text).toContain('"bankkonto":null');
  });

  it('`undefined` ist ein FEHLER und wird nicht still zu null', () => {
    // Ein vergessenes Feld soll laut sein: still weggelassen änderte es den
    // Hash unsichtbar, und genau davor schützt die Regel.
    expect(() => kanonischerText({ nummer: undefined as never }))
      .toThrow(/undefined/u);
  });

  it('Text wird NFC-normalisiert — zwei Schreibweisen von „Müller" ergeben dieselben Bytes', () => {
    const zusammengesetzt = 'Müller';       // ü als ein Zeichen
    const zerlegt = 'Müller';              // u + Kombinierendes Trema
    expect(zusammengesetzt).not.toBe(zerlegt);
    expect(kanonischerText({ name: zusammengesetzt }))
      .toBe(kanonischerText({ name: zerlegt }));
  });

  it('kein einziges Leerzeichen zwischen den Elementen', () => {
    expect(kanonischerText({ b: 1, a: [1, 2] })).toBe('{"a":[1,2],"b":1}');
  });

  it('die Ausgabe ist UTF-8, und Umlaute stehen als Zeichen, nicht als \\u-Fluchtfolge', () => {
    const bytes = kanonisiere({ ort: 'Köln' });
    expect(Buffer.from(bytes).toString('utf8')).toBe('{"ort":"Köln"}');
  });
});

describe('Arrays sind deterministisch geordnet — JCS sagt darüber nichts', () => {
  it('Positionen stehen nach `nr`, gleich in welcher Reihenfolge sie kommen', () => {
    const eins = beispiel();
    const zwei: RechnungVollstaendig = {
      ...eins,
      positionen: [
        { ...eins.positionen[0]!, nr: 2, bezeichnung: 'Glasreinigung' },
        { ...eins.positionen[0]!, nr: 1 },
      ],
    };
    const drei: RechnungVollstaendig = {
      ...eins,
      positionen: [
        { ...eins.positionen[0]!, nr: 1 },
        { ...eins.positionen[0]!, nr: 2, bezeichnung: 'Glasreinigung' },
      ],
    };
    // Zwei Abfragen ohne `order by` liefern die Zeilen in beliebiger
    // Reihenfolge. Ohne die Sortierung hier wären das zwei Hashes für
    // dieselbe Rechnung.
    expect(kanonischerText(baueNutzlast(zwei)))
      .toBe(kanonischerText(baueNutzlast(drei)));
  });

  it('Steuerzeilen stehen nach dem Gruppenschlüssel', () => {
    const eins = beispiel();
    const s0 = eins.steuerzeilen[0]!;
    const gedreht: RechnungVollstaendig = {
      ...eins,
      steuerzeilen: [
        { ...s0, steuersatzGruppe: 'ust_19' },
        { ...s0, steuersatzGruppe: 'ust_07', satzBp: 700 },
      ],
    };
    // Nur der `steuerzeilen`-Abschnitt: `steuersatz_gruppe` steht auch auf
    // jeder Position, und „irgendwo im Dokument" prüfte die falsche Stelle.
    const text = kanonischerText(baueNutzlast(gedreht));
    const abschnitt = text.slice(text.indexOf('"steuerzeilen":'));
    expect(abschnitt.indexOf('ust_07')).toBeLessThan(abschnitt.indexOf('ust_19'));
  });

  it('Zuschläge stehen nach (art, bezeichnung)', () => {
    const eins = beispiel();
    const z = {
      art: 'zuschlag', bezeichnung: 'Anfahrt', grundCode: null,
      basisCent: null, satzBp: null, betragCent: c(500n),
      steuersatzGruppe: 'ust_19', gruppeSatzBp: 1900, gruppeKategorie: 'S',
    } as const;
    const a: RechnungVollstaendig = {
      ...eins,
      zuschlaege: [{ ...z, bezeichnung: 'Wochenende' }, z, { ...z, art: 'nachlass' }],
    };
    const text = kanonischerText(baueNutzlast(a));
    expect(text.indexOf('nachlass')).toBeLessThan(text.indexOf('"Anfahrt"'));
    expect(text.indexOf('"Anfahrt"')).toBeLessThan(text.indexOf('"Wochenende"'));
  });
});

describe('Die Nutzlast trägt IDENTITÄT, keinen Verweis (K-12)', () => {
  it('Name, Anschrift und Steuernummer des Leistenden stehen ausgeschrieben darin', () => {
    const text = kanonischerText(baueNutzlast(beispiel()));
    expect(text).toContain('CSE Dienstleistungen GmbH');
    expect(text).toContain('Kurfürstendamm 21, 10719 Berlin, DE');
    expect(text).toContain('DE123456789');
    // Ohne diese Kopien änderte eine spätere Pflege des Stammdatensatzes, was
    // die Rechnung SAGT, während die Kettenprüfung weiter „intakt" meldet.
  });

  it('und der Einheitencode der Position (BT-130) ebenfalls — nicht nur das Label', () => {
    expect(kanonischerText(baueNutzlast(beispiel()))).toContain('"einheit_code":"MTK"');
  });

  it('die vier von K-12 zurückgezogenen Namen kommen nicht vor', () => {
    const text = kanonischerText(baueNutzlast(beispiel()));
    for (const name of ['hinweistext', 'bauabzugsteuer_cent', '"kleinbetrag"', 'leistungszeitraum',
                        'steuersatz_id', 'prozent_bp']) {
      expect(text, name).not.toContain(name);
    }
  });
});

describe('Die Nutzlast entsteht NACH dem Zug der Nummer (§5.6)', () => {
  it('ohne Nummer wird sie verweigert', () => {
    expect(() => buildKanonischePayload({ ...beispiel(), nummer: '' }))
      .toThrow(KanonisierungsFehler);
  });

  it('ohne Kettenposition ebenso', () => {
    expect(() => buildKanonischePayload({ ...beispiel(), kettePosition: 0 }))
      .toThrow(KanonisierungsFehler);
  });

  it('und sie trägt Nummer und Kettenposition — deshalb die zwei Definer-Aufrufe', () => {
    const text = Buffer.from(buildKanonischePayload(beispiel())).toString('utf8');
    expect(text).toContain('"nummer":"RE-2026-00001"');
    expect(text).toContain('"kette_position":1');
  });
});

describe('Der Goldene Vektor — die Bytes selbst', () => {
  /**
   * Der Zweck ist nicht, den Hash zu kennen, sondern zu MERKEN, wenn er sich
   * ändert: jede Änderung an Feldnamen, Reihenfolge oder Formatierung bricht
   * diesen Test. Das ist die Erinnerung daran, dass `schema_version` erhöht
   * werden muss, BEVOR damit festgeschrieben wird — und niemals danach.
   */
  it('dieselbe Rechnung ergibt immer dieselben Bytes', () => {
    const a = buildKanonischePayload(beispiel());
    const b = buildKanonischePayload(beispiel());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('der Schemaname steht in der Nutzlast', () => {
    expect(kanonischerText(baueNutzlast(beispiel())))
      .toContain(`"schema":"${SCHEMA_VERSION}"`);
  });

  it('ein geänderter Cent ergibt einen anderen Digest', () => {
    const original = createHash('sha256')
      .update(buildKanonischePayload(beispiel())).digest('hex');
    const manipuliert = createHash('sha256')
      .update(buildKanonischePayload({ ...beispiel(), bruttoCent: c(9185n) })).digest('hex');
    expect(manipuliert).not.toBe(original);
  });

  it('und eine geänderte Anschrift ebenso — das ist der Punkt von K-12', () => {
    const original = createHash('sha256')
      .update(buildKanonischePayload(beispiel())).digest('hex');
    const umgezogen = beispiel();
    const manipuliert = createHash('sha256').update(buildKanonischePayload({
      ...umgezogen,
      leistender: {
        ...umgezogen.leistender,
        anschrift: { ...umgezogen.leistender.anschrift, zeile: 'Anderswo 1, 10000 Berlin, DE' },
      },
    })).digest('hex');
    expect(manipuliert).not.toBe(original);
  });
});
