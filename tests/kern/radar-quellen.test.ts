/**
 * RAD-01, RAD-02 — die beiden Quellen lesen, gegen Antworten, die so
 * aussehen wie die echten.
 *
 * **Warum das hier steht und nicht im Netz.** Ein Test, der wirklich
 * oeffentlichevergabe.de anruft, prüft die Verfügbarkeit eines fremden
 * Dienstes und nicht diesen Code; er ist rot, wenn dort gewartet wird, und
 * grün, wenn hier ein Feld falsch zugeordnet ist und die Quelle es gerade
 * nicht liefert. Geprüft wird deshalb die Zuordnung — an Text, der die
 * Formen enthält, an denen ein Leser still falsch wird.
 */
import { describe, expect, it } from 'vitest';
import { QuelleFehler, alsCent, alsZeitpunkt, quellStand } from '../../src/server/services/radar/quelle.js';
import { liesOcds } from '../../src/server/services/radar/ocds.js';
import { liesTed, tedListe, tedText } from '../../src/server/services/radar/ted.js';

const OCDS = JSON.stringify({
  uri: 'https://oeffentlichevergabe.de/api/ocds/v1',
  releases: [
    {
      ocid: 'ocds-pyfmrp-DE-2026-0001',
      id: 'ocds-pyfmrp-DE-2026-0001-01',
      date: '2026-09-01T08:00:00Z',
      language: 'de',
      tag: ['tender'],
      links: { self: 'https://oeffentlichevergabe.de/bekanntmachung/DE-2026-0001' },
      parties: [{
        roles: ['buyer'],
        name: 'Bezirksamt Mitte von Berlin',
        address: { locality: 'Berlin', postalCode: '10178', region: 'DE300' },
      }],
      tender: {
        title: 'Unterhaltsreinigung Dienstgebäude Mitte',
        description: 'Laufende Unterhaltsreinigung, Lose 1 bis 3.',
        status: 'active',
        procurementMethodDetails: 'Öffentliche Ausschreibung nach UVgO',
        value: { amount: '1234567.89', currency: 'EUR' },
        numberOfLots: 3,
        classification: { scheme: 'CPV', id: '90910000-9' },
        additionalClassifications: [{ scheme: 'CPV', id: '90911200-8' }],
        items: [{
          classification: { scheme: 'CPV', id: '90919200-4' },
          deliveryAddresses: [{ region: 'DE300', postalCode: '10178' }],
        }],
        tenderPeriod: { endDate: '2026-10-15T12:00:00Z' },
        enquiryPeriod: { endDate: '2026-10-01T12:00:00Z' },
      },
    },
    /* Ohne Kennung: nicht speicherbar, also uebersprungen — und keine erfundene Kennung. */
    { tender: { title: 'Ohne ocid' } },
    /* Aufgehoben: die Quelle sagt es selbst. */
    {
      ocid: 'ocds-pyfmrp-DE-2026-0002',
      date: '2026-09-02T08:00:00Z',
      tag: ['tenderCancellation'],
      tender: { title: 'Objektschutz Schulen', status: 'cancelled' },
    },
  ],
});

describe('OCDS lesen (RAD-01)', () => {
  const zeilen = liesOcds(OCDS);

  it('liest die Bekanntmachungen, die eine Kennung haben — und erfindet keine', () => {
    expect(zeilen).toHaveLength(2);
    expect(zeilen.map((z) => z.quellId))
      .toEqual(['ocds-pyfmrp-DE-2026-0001', 'ocds-pyfmrp-DE-2026-0002']);
  });

  it('ordnet die Felder zu, die der Radar braucht', () => {
    const z = zeilen[0]!;
    expect(z.titel).toBe('Unterhaltsreinigung Dienstgebäude Mitte');
    expect(z.vergabestelleName).toBe('Bezirksamt Mitte von Berlin');
    expect(z.vergabestelleOrt).toBe('Berlin');
    expect(z.cpvHaupt).toBe('90910000-9');
    expect(z.cpvWeitere).toEqual(['90911200-8', '90919200-4']);
    expect(z.nutsCodes).toEqual(['DE300']);
    expect(z.loseAnzahl).toBe(3);
    expect(z.fristAngebot?.toISOString()).toBe('2026-10-15T12:00:00.000Z');
    expect(z.fristFragen?.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(z.verfahrensartRoh).toBe('Öffentliche Ausschreibung nach UVgO');
  });

  /**
   * **Der Cent, der sonst verloren geht.** `parseFloat('1234567.89') * 100`
   * ergibt 123456788.99999999 — abgerundet ein Cent zu wenig, und zwar
   * ausgerechnet auf einem Auftragswert, an dem später eine Kalkulation
   * hängt. Deshalb Zeichenkettenarithmetik (Invariante 1).
   */
  it('rechnet den Auftragswert in ganze Cent, ohne Gleitkomma', () => {
    expect(zeilen[0]!.wertCent).toBe(123_456_789n);
    expect(zeilen[0]!.waehrung).toBe('EUR');
    expect(alsCent('1234567.89')).toBe(123_456_789n);
    expect(alsCent('0.1')).toBe(10n);
    expect(alsCent('0.005')).toBe(0n);
    expect(alsCent(null)).toBeNull();
  });

  it('erfindet keinen Schwellenwert — die nationale Quelle sagt ihn nicht', () => {
    expect(zeilen[0]!.oberhalbSchwellenwert).toBeNull();
  });

  it('erkennt eine Aufhebung, statt die Bekanntmachung weiterzaehlen zu lassen', () => {
    expect(zeilen[1]!.aufgehoben).toBe(true);
  });

  it('eine Antwort, die kein OCDS ist, ist ein Fehler und kein leerer Tag', () => {
    expect(() => liesOcds('kein json')).toThrow(QuelleFehler);
    expect(() => liesOcds('{"nichts":1}')).toThrow(/releases/u);
  });

  it('ein unlesbares Datum ist ein Fehler, kein Heute', () => {
    expect(() => alsZeitpunkt('gestern')).toThrow(QuelleFehler);
    expect(alsZeitpunkt(null)).toBeNull();
  });
});

const TED = JSON.stringify({
  notices: [
    {
      'publication-number': '00512345-2026',
      'notice-language': 'deu',
      'notice-title': { deu: 'Gebäudereinigung Bundesbehörde', eng: 'Cleaning services' },
      'description-procurement': { deu: 'Unterhaltsreinigung für drei Liegenschaften.' },
      'buyer-name': ['Bundesanstalt für Immobilienaufgaben'],
      'buyer-city': { deu: 'Bonn' },
      'classification-cpv': ['90910000', '90911200'],
      'main-classification-cpv': '90910000',
      'place-of-performance': ['DEA22', 'DE300'],
      'total-value': '2500000.00',
      'total-value-currency': 'EUR',
      'publication-date': '2026-09-05T00:00:00Z',
      'deadline-receipt-tender': '2026-10-20T10:00:00Z',
      'procedure-type': { deu: 'Offenes Verfahren' },
      'form-type': 'competition',
    },
    {
      'publication-number': '00512346-2026',
      'notice-language': 'fra',
      'notice-title': { fra: 'Services de nettoyage', eng: 'Cleaning' },
      'form-type': 'Corrigendum',
      'classification-cpv': 'nicht-cpv',
      'place-of-performance': 'XX',
    },
  ],
});

describe('TED lesen (RAD-02)', () => {
  const zeilen = liesTed(TED);

  it('entpackt Zeichenkette, Liste und Sprachkarte — und macht nie [object Object] daraus', () => {
    expect(tedText('schlicht')).toBe('schlicht');
    expect(tedText(['', 'zweiter'])).toBe('zweiter');
    expect(tedText({ deu: 'deutsch', eng: 'english' })).toBe('deutsch');
    expect(tedText({ eng: 'english' })).toBe('english');
    expect(tedText({})).toBeNull();
    expect(tedListe({ a: ['x'], b: 'y' })).toEqual(['x', 'y']);
  });

  it('nimmt den Titel in der Sprache der Bekanntmachung', () => {
    expect(zeilen[0]!.titel).toBe('Gebäudereinigung Bundesbehörde');
    expect(zeilen[0]!.sprache).toBe('de');
    expect(zeilen[1]!.sprache, 'ISO-639-3 wird zu zwei Zeichen').toBe('fr');
  });

  it('haelt CPV und NUTS auseinander und wirft weg, was keines ist', () => {
    expect(zeilen[0]!.cpvHaupt).toBe('90910000');
    expect(zeilen[0]!.cpvWeitere).toEqual(['90911200']);
    expect(zeilen[0]!.nutsCodes).toEqual(['DE300', 'DEA22']);
    expect(zeilen[1]!.cpvHaupt, '"nicht-cpv" ist keiner').toBeNull();
    expect(zeilen[1]!.nutsCodes, '"XX" ist kein deutscher NUTS-Code, aber ein gueltiger').toEqual(['XX']);
  });

  it('TED liegt oberhalb des Schwellenwerts — als Eigenschaft der Quelle, nicht als Rechnung', () => {
    expect(zeilen[0]!.oberhalbSchwellenwert).toBe(true);
    expect(zeilen[0]!.wertCent).toBe(250_000_000n);
  });

  it('erkennt eine Berichtigung', () => {
    expect(zeilen[0]!.istBerichtigung).toBe(false);
    expect(zeilen[1]!.istBerichtigung).toBe(true);
  });
});

describe('was „verbunden" heisst (RAD-01, RAD-02)', () => {
  /**
   * Beide Quellen sind öffentlich und brauchen keinen Schlüssel — was fehlt,
   * ist die Adresse und die Abfrage dieses Betriebs. Ohne sie sagt die
   * Plattform „nicht verbunden" und täuscht keinen leeren Tag vor.
   */
  it('ohne Adresse ist die Quelle nicht verbunden — und sagt, was fehlt', () => {
    const vorher = process.env['RADAR_TED_URL'];
    delete process.env['RADAR_TED_URL'];
    const stand = quellStand('ted');
    expect(stand.verbunden).toBe(false);
    expect(stand.hinweis).toContain('RADAR_TED_URL');
    expect(stand.hinweis).toContain('O-366');
    if (vorher !== undefined) process.env['RADAR_TED_URL'] = vorher;
  });

  it('mit Adresse ist sie verbunden', () => {
    const vorher = process.env['RADAR_TED_URL'];
    process.env['RADAR_TED_URL'] = 'https://api.ted.europa.eu/v3/notices/search';
    expect(quellStand('ted').verbunden).toBe(true);
    if (vorher === undefined) delete process.env['RADAR_TED_URL'];
    else process.env['RADAR_TED_URL'] = vorher;
  });
});
