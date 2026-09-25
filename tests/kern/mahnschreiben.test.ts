/**
 * Das Mahnschreiben als Geschäftsbrief (V-213, V-214, FIN-15).
 *
 * Geprüft wird am TEXT, aus dem beim Versand das PDF entsteht
 * (`mahnungstext`), und an der Nutzlast, die die Freigabe bindet
 * (Invariante 7). Gegen die Datenbank — Stufenpflege, Rechnungsanschrift,
 * Versandzeit, Tor — prüft `tests/isolation/mahnung.test.ts` (7) und (8).
 */
import { describe, expect, it } from 'vitest';
import { cent } from '../../src/server/services/finanz/geld.js';
import { prozentTextIn } from '../../src/server/services/finanz/prozent.js';
import {
  briefAusSpalte, briefZumEinfrieren, fehlendeBriefkopfangaben, landZeile,
  mahnungNutzlast, mahnungstext,
  type MahnAbsender, type MahnungPositionZeile, type MahnungZeile,
} from '../../src/server/services/finanz/mahnung/index.js';
import { nutzlastHash } from '../../src/server/agent/policy.js';

const ABSENDER: MahnAbsender = {
  firma: 'CSE Dienstleistungen GmbH', strasse: 'Kurfürstendamm 21', plz: '10719',
  ort: 'Berlin', land: 'DE', telefon: '+49 30 5550100', email: 'rechnung@cse.test',
  web: null, registergericht: 'Amtsgericht Charlottenburg', registernummer: 'HRB 12345 B',
  geschaeftsfuehrung: 'Max Muster, Erika Beispiel', ustId: 'DE123456789',
  steuernummer: '30/123/45678', bank: 'Berliner Bank', iban: 'DE02120300000000202051',
  bic: null,
};

const KOPF: MahnungZeile = {
  id: '11111111-1111-4111-8111-111111111111', nummer: 'MA-00007',
  kundeId: '22222222-2222-4222-8222-222222222222', kundeName: 'Beispiel GmbH',
  stufe: 2, bezeichnung: 'Erste Mahnung', status: 'freigegeben',
  mahndatum: '2026-09-23', zahlbarBis: '2026-10-07',
  forderungCent: cent(119_000n), gebuehrCent: cent(500n), zinsenCent: cent(1_234n),
  gesamtCent: cent(120_734n), versendetAm: null, verworfenGrund: null,
  stufensprungGrund: null, briefFuss: 'Wir danken für Ihr Vertrauen.',
  absender: ABSENDER,
  empfaenger: {
    name: 'Beispiel GmbH', strasse: 'Musterweg 7', plz: '10178', ort: 'Berlin', land: 'DE',
  },
  textbaustein: 'Leider konnten wir bis heute keinen Zahlungseingang feststellen.',
  dokumentId: null,
  briefEingefroren: true,
};

const POSITIONEN: readonly MahnungPositionZeile[] = [{
  rechnungsnummer: 'RE-00012', offenCent: cent(119_000n), faelligAm: '2026-08-01',
  verzugsbeginnAm: '2026-08-20', verzugstage: 34, zinsBp: 1027, zinsCent: cent(1_234n),
}];

describe('mahnungstext — der Brief', () => {
  const text = mahnungstext(KOPF, POSITIONEN);
  const zeilen = text.split('\n');

  it('beginnt mit der Absenderzeile und der Anschrift des Empfängers', () => {
    expect(zeilen[0]).toBe('CSE Dienstleistungen GmbH · Kurfürstendamm 21 · 10719 Berlin');
    expect(zeilen[1]).toBe('');
    expect(zeilen.slice(2, 5)).toEqual(['Beispiel GmbH', 'Musterweg 7', '10178 Berlin']);
  });

  it('schreibt jeden Tag als TT.MM.JJJJ, keinen als JJJJ-MM-TT', () => {
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
    expect(text).toContain('Datum: 23.09.2026');
    expect(text).toContain('fällig am 01.08.2026');
    expect(text).toContain('Ausgleich bis zum 07.10.2026.');
  });

  it('nennt den Zinssatz als Prozent p. a., nicht in Basispunkten', () => {
    expect(text).toContain('(34 Tage, 10,27 % p. a.)');
    expect(text).not.toContain('Basispunkte');
  });

  it('setzt den Mahntext zwischen Datum und Forderungsliste', () => {
    const datum = text.indexOf('Datum:');
    const mahntext = text.indexOf('Leider konnten wir');
    const liste = text.indexOf('Offene Forderungen:');
    expect(datum).toBeLessThan(mahntext);
    expect(mahntext).toBeLessThan(liste);
  });

  it('ohne Mahntext bleibt die Stelle leer — kein erfundener Wortlaut', () => {
    const ohne = mahnungstext({ ...KOPF, textbaustein: null }, POSITIONEN);
    const z = ohne.split('\n');
    const datum = z.findIndex((x) => x.startsWith('Datum:'));
    expect(z[datum + 1]).toBe('');
    expect(z[datum + 2]).toBe('Offene Forderungen:');
  });

  it('trägt die Pflichtangaben nach der Fusszeile (§ 35a GmbHG)', () => {
    const fuss = text.indexOf('Wir danken für Ihr Vertrauen.');
    const register = text.indexOf('Amtsgericht Charlottenburg HRB 12345 B');
    expect(fuss).toBeGreaterThan(-1);
    expect(register).toBeGreaterThan(fuss);
    expect(text).toContain('Geschäftsführung: Max Muster, Erika Beispiel');
    expect(text).toContain('USt-IdNr. DE123456789 · Steuernummer 30/123/45678');
    expect(text).toContain('Berliner Bank · IBAN DE02120300000000202051');
    expect(text).toContain('Telefon +49 30 5550100 · rechnung@cse.test');
  });

  it('nennt ein Land nur, wenn es nicht Deutschland ist', () => {
    expect(zeilen.slice(2, 6)).not.toContain('DE');
    const ausland = mahnungstext({
      ...KOPF, empfaenger: { ...KOPF.empfaenger, land: 'AT' },
    }, POSITIONEN).split('\n');
    /* Der Name des Landes, gross geschrieben — nicht der Code (V-217). */
    expect(ausland.slice(2, 6))
      .toEqual(['Beispiel GmbH', 'Musterweg 7', '10178 Berlin', 'ÖSTERREICH']);
  });

  it('landZeile: Name statt Code, ein unbekannter Code bleibt, wie er ist', () => {
    expect(landZeile('AT')).toBe('ÖSTERREICH');
    expect(landZeile('ch ')).toBe('SCHWEIZ');
    expect(landZeile('NL')).toBe('NIEDERLANDE');
    expect(landZeile('ZZ')).toBe('ZZ');
    expect(landZeile('A1')).toBe('A1');
  });

  it('eine leere Angabe erzeugt keine halbe Zeile', () => {
    const karg = mahnungstext({
      ...KOPF,
      absender: {
        ...ABSENDER, telefon: '', email: null, registergericht: null, registernummer: null,
        geschaeftsfuehrung: null, ustId: null, steuernummer: null, iban: null,
      },
    }, POSITIONEN);
    expect(karg).not.toContain('Telefon');
    expect(karg).not.toContain('Geschäftsführung');
    expect(karg).not.toContain('IBAN');
    expect(karg).not.toMatch(/ · $/mu);
  });
});

describe('fehlendeBriefkopfangaben', () => {
  it('nennt, was leer ist — und nichts, wenn alles da ist', () => {
    expect(fehlendeBriefkopfangaben(ABSENDER)).toEqual([]);
    expect(fehlendeBriefkopfangaben({
      ...ABSENDER, ort: null, registergericht: ' ', registernummer: null,
      geschaeftsfuehrung: null,
    })).toEqual(['anschrift', 'registergericht', 'registernummer', 'geschaeftsfuehrung']);
  });
});

describe('die Freigabe bindet Briefkopf, Anschrift und Mahntext (Invariante 7)', () => {
  const hash = (k: MahnungZeile): string =>
    nutzlastHash(mahnungNutzlast('33333333-3333-4333-8333-333333333333', k, POSITIONEN));

  it('ein anderer Mahntext ist ein anderer Brief', () => {
    expect(hash({ ...KOPF, textbaustein: 'Anderer Text.' })).not.toBe(hash(KOPF));
  });

  it('eine andere Empfängeranschrift ist ein anderer Brief', () => {
    expect(hash({ ...KOPF, empfaenger: { ...KOPF.empfaenger, strasse: 'Andere Strasse 1' } }))
      .not.toBe(hash(KOPF));
  });

  it('ein anderer Registereintrag ist ein anderer Brief', () => {
    expect(hash({ ...KOPF, absender: { ...ABSENDER, registernummer: 'HRB 99999 B' } }))
      .not.toBe(hash(KOPF));
  });
});

/**
 * **Der eingefrorene Brief** (V-217, D-709, 0449).
 *
 * `gibFrei` schreibt `briefZumEinfrieren(kopf)` als jsonb in `mahnung.brief`,
 * der Versand liest ihn mit `briefAusSpalte` zurück und bildet daraus die
 * Nutzlast neu. Beide Abdrücke müssen gleich sein, sonst stünde jede
 * freigegebene Mahnung am Tor — genau der Fehler, den das Einfrieren behebt.
 */
describe('der eingefrorene Brief', () => {
  const hash = (k: MahnungZeile): string =>
    nutzlastHash(mahnungNutzlast('33333333-3333-4333-8333-333333333333', k, POSITIONEN));
  const rundreise = (k: MahnungZeile): MahnungZeile => {
    const b = briefAusSpalte(JSON.parse(JSON.stringify(briefZumEinfrieren(k))) as unknown);
    return {
      ...k, kundeName: b.kunde, bezeichnung: b.bezeichnung, absender: b.absender,
      empfaenger: b.empfaenger, textbaustein: b.textbaustein, briefFuss: b.briefFuss,
    };
  };

  it('Einfrieren und Zurücklesen ergeben denselben Abdruck', () => {
    expect(hash(rundreise(KOPF))).toBe(hash(KOPF));
    const karg: MahnungZeile = {
      ...KOPF, textbaustein: null, briefFuss: null,
      absender: { ...ABSENDER, web: null, bic: null, telefon: null },
      empfaenger: { name: 'X', strasse: null, plz: null, ort: null, land: null },
    };
    expect(hash(rundreise(karg))).toBe(hash(karg));
  });

  it('auch als Text gespeichert (anderer Treiber) liest er sich zurück', () => {
    const b = briefAusSpalte(JSON.stringify(briefZumEinfrieren(KOPF)));
    expect(b.empfaenger).toEqual(KOPF.empfaenger);
    expect(b.absender).toEqual(KOPF.absender);
  });

  it('ein beschädigter Brief wirft, statt still die Stammdaten zu nehmen', () => {
    const gut = briefZumEinfrieren(KOPF);
    expect(() => briefAusSpalte(null)).toThrow(/beschädigt/u);
    expect(() => briefAusSpalte({ ...gut, kunde: 7 })).toThrow(/kunde/u);
    expect(() => briefAusSpalte({ ...gut, absender: { ...gut.absender, iban: 1 } }))
      .toThrow(/absender\.iban/u);
    expect(() => briefAusSpalte({ ...gut, empfaenger: { ...gut.empfaenger, name: undefined } }))
      .toThrow(/empfaenger\.name/u);
  });
});

describe('prozentTextIn', () => {
  it('deutsch mit Komma und Leerzeichen, englisch mit Punkt ohne', () => {
    expect(prozentTextIn(1027, 'de')).toBe('10,27 %');
    expect(prozentTextIn(1027, 'en')).toBe('10.27%');
    expect(prozentTextIn(900, 'en')).toBe('9.0%');
    expect(prozentTextIn(900, 'tr')).toBe('9,0 %');
  });
});
