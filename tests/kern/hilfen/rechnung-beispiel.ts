/**
 * Eine vollständige Rechnung als Vorrichtung — EINMAL, für beide ZUGFeRD-Tests.
 *
 * Zwei Kopien derselben Beispielrechnung laufen auseinander, sobald jemand
 * eine davon anpasst, und dann prüfen die beiden Dateien verschiedene Dinge,
 * ohne dass es jemandem auffällt.
 */
import { cent, type Cent } from '../../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../../src/server/services/finanz/menge.js';
import type {
  Anschrift, Position, RechnungVollstaendig,
} from '../../../src/server/services/finanz/kanonisch.js';

const c = (n: bigint): Cent => cent(n);

const BERLIN = (strasse: string, plz: string, ort: string): Anschrift => ({
  zeile: `${strasse}, ${plz} ${ort}, DE`,
  strasse, zusatz: null, plz, ort, land: 'DE',
});

export function position(nr: number, netto: bigint, preis: bigint): Position {
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

export function beispielRechnung(): RechnungVollstaendig {
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

