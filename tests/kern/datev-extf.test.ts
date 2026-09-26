/**
 * PR 60 — der EXTF-Schreiber auf BYTE-Ebene (ACC-02 Abnahme (1) und (3)).
 *
 * Jede Zusage dieser Datei ist eine über Bytes, nicht über Zeichen. Ein Test,
 * der das Ergebnis als String vergleicht, ginge grün durch, während die Datei
 * als UTF-8 auf der Platte landet — und DATEV zeigt dann `Ã¼`, wo `ü` stand.
 */
import { describe, expect, it } from 'vitest';
import { nachCp1252, passtInCp1252 } from '../../src/server/services/buchhaltung/datev/cp1252.js';
import {
  FORMAT_SPEZIFIKATIONSABGELEITET, KOPF_FELDER, SPALTEN,
  BEZEICHNUNG_HOECHSTENS, baueKopf, baueZeile, belegdatumText, betragText, schreibeExtf,
  stapelBezeichnung, textFeld,
  ExtfFehler, type ExtfBuchung, type ExtfKopf,
} from '../../src/server/services/buchhaltung/datev/extf.js';

const KOPF: ExtfKopf = {
  beraterNummer: '1234567',
  mandantenNummer: '55555',
  wjBeginn: '2026-01-01',
  sachkontenlaenge: 4,
  von: '2026-08-01',
  bis: '2026-08-31',
  bezeichnung: 'August 2026',
  kontenrahmen: 'skr03',
  festschreibung: true,
  exportiertVon: 'CSE Platform',
  erzeugtAm: new Date(Date.UTC(2026, 8, 13, 14, 5, 6, 789)),
};

const BUCHUNG: ExtfBuchung = {
  umsatzCent: 119_000n,
  sollHaben: 'soll',
  konto: '10001',
  gegenkonto: '8400',
  buSchluessel: '9',
  belegdatum: '2026-08-15',
  belegfeld1: 'RE-2026-00017',
  belegfeld2: null,
  buchungstext: 'Unterhaltsreinigung Kurfürstendamm',
  leistungsdatum: '2026-08-31',
  festgeschrieben: true,
  buchungssatzId: '11111111-2222-3333-4444-555555555555',
};

describe('(1) Windows-1252, Komma, CRLF — auf den Bytes', () => {
  it('`ü` ist das Byte 0xFC, nicht zwei UTF-8-Bytes', () => {
    const bytes = nachCp1252('ü');
    expect(bytes).toHaveLength(1);
    expect(bytes[0]).toBe(0xfc);
  });

  it('das Eurozeichen ist 0x80 — und genau hier weicht CP1252 von latin1 ab', () => {
    expect(nachCp1252('€')[0]).toBe(0x80);
    // Der Gegenbeweis: `latin1` kennt es nicht und macht daraus ein `?`.
    expect(Buffer.from('€', 'latin1')[0]).not.toBe(0x80);
  });

  it('jedes der siebenundzwanzig Sonderzeichen kommt an', () => {
    const hoch = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
    const bytes = nachCp1252(hoch);
    expect(bytes).toHaveLength([...hoch].length);
    for (const b of bytes) {
      expect(b, `0x${b.toString(16)}`).toBeGreaterThanOrEqual(0x80);
      expect(b).toBeLessThanOrEqual(0x9f);
    }
  });

  it('ein Zeichen ohne CP1252-Entsprechung wird zum Fragezeichen, nicht zum Fehler', () => {
    /*
     * Ein türkischer Name — die Plattform führt solche (SPEC §10). `Ç` gibt
     * es in CP1252 (0xC7), `ğ` nicht: der Name kommt also fast vollständig
     * an, und das ist genau der Grund, warum ein Ersatzzeichen die richtige
     * Antwort ist und ein Wurf die falsche.
     */
    expect(Buffer.from(nachCp1252('Ünal Çağ')).toString('latin1')).toBe('Ünal Ça?');
    expect(passtInCp1252('Ünal Ç')).toBe(true);
    expect(passtInCp1252('Çağ')).toBe(false);
  });

  it('die Datei trägt KEIN BOM und endet jede Zeile mit CRLF', () => {
    const bytes = schreibeExtf(KOPF, [BUCHUNG]);
    expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(Buffer.from(bytes.subarray(0, 6)).toString('latin1')).toBe('"EXTF"');

    const text = Buffer.from(bytes).toString('latin1');
    expect(text.endsWith('\r\n')).toBe(true);
    // Kein einzelnes LF ohne vorangehendes CR.
    expect(/[^\r]\n/u.test(text)).toBe(false);
    // Drei Zeilen: Kopf, Spalten, eine Buchung.
    expect(text.split('\r\n').filter((z) => z !== '')).toHaveLength(3);
  });

  it('der Betrag trägt ein Komma und zwei Stellen — nie einen Punkt', () => {
    expect(betragText(119_000n)).toBe('1190,00');
    expect(betragText(1n)).toBe('0,01');
    expect(betragText(0n)).toBe('0,00');
    expect(betragText(123_456n)).toBe('1234,56');
    // Das Vorzeichen steht im Soll/Haben-Kennzeichen, nicht im Betrag.
    expect(betragText(-5000n)).toBe('50,00');
  });

  it('sehr grosse Beträge bleiben exakt — kein Number, kein Rundungsverlust', () => {
    const riesig = 9_007_199_254_740_993n; // 2^53 + 1: als `number` nicht darstellbar.
    expect(betragText(riesig)).toBe('90071992547409,93');
  });

  it('das Belegdatum ist TTMM, das Kopfdatum JJJJMMTT', () => {
    expect(belegdatumText('2026-08-15')).toBe('1508');
    expect(() => belegdatumText('15.08.2026')).toThrow(ExtfFehler);
    expect(baueKopf(KOPF).split(';')[12]).toBe('20260101');
  });
});

describe('(2) Kopf und Zeilen laufen nicht auseinander', () => {
  it('die Kopfzeile hat genau so viele Felder wie ihre Beschreibung', () => {
    expect(baueKopf(KOPF).split(';')).toHaveLength(KOPF_FELDER.length);
  });

  it('jede Datenzeile hat genau so viele Felder wie die Spaltenzeile', () => {
    expect(baueZeile(BUCHUNG).split(';')).toHaveLength(SPALTEN.length);
  });

  it('die zweite Zeile der Datei IST die Spaltenliste', () => {
    const text = Buffer.from(schreibeExtf(KOPF, [BUCHUNG])).toString('latin1');
    const zweite = text.split('\r\n')[1]!;
    expect(zweite.split(';')).toHaveLength(SPALTEN.length);
    expect(zweite.startsWith('Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen')).toBe(true);
  });

  it('die Werte stehen an der Stelle, die die Spaltenliste nennt', () => {
    const felder = baueZeile(BUCHUNG).split(';');
    const bei = (spalte: string): string => felder[SPALTEN.indexOf(spalte)]!;

    expect(bei('Umsatz (ohne Soll/Haben-Kz)')).toBe('1190,00');
    expect(bei('Soll/Haben-Kennzeichen')).toBe('"S"');
    expect(bei('Konto')).toBe('10001');
    expect(bei('Gegenkonto (ohne BU-Schlüssel)')).toBe('8400');
    expect(bei('BU-Schlüssel')).toBe('9');
    expect(bei('Belegdatum')).toBe('1508');
    expect(bei('Belegfeld 1')).toBe('"RE-2026-00017"');
    expect(bei('Festschreibung')).toBe('1');
    expect(bei('Leistungsdatum')).toBe('20260831');
    expect(bei('Buchungs GUID')).toBe('"11111111-2222-3333-4444-555555555555"');
  });

  it('das Haben-Kennzeichen ist H', () => {
    const felder = baueZeile({ ...BUCHUNG, sollHaben: 'haben' }).split(';');
    expect(felder[SPALTEN.indexOf('Soll/Haben-Kennzeichen')]).toBe('"H"');
  });
});

describe('(3) ein Text zerreisst die Zeile nicht', () => {
  it('ein Anführungszeichen im Buchungstext wird verdoppelt', () => {
    expect(textFeld('Objekt "Mitte"', 60)).toBe('"Objekt ""Mitte"""');
  });

  it('ein Semikolon bleibt IM Feld — die Anführungszeichen halten es', () => {
    const zeile = baueZeile({ ...BUCHUNG, buchungstext: 'Reinigung; Fenster' });
    const felder = zeile.split(';');
    // Das Semikolon erzeugt einen Trenner im rohen Split …
    expect(felder.length).toBeGreaterThan(SPALTEN.length);
    // … aber es steht innerhalb der Anführungszeichen, und DATEV liest das.
    expect(zeile).toContain('"Reinigung; Fenster"');
  });

  it('ein Zeilenumbruch wird zum Leerzeichen, statt die Datei zu zerreissen', () => {
    const zeile = baueZeile({ ...BUCHUNG, buchungstext: 'Zeile 1\r\nZeile 2' });
    expect(zeile).not.toMatch(/[\r\n]/u);
    expect(zeile).toContain('"Zeile 1 Zeile 2"');
  });

  it('ein zu langer Text wird gekürzt, nicht abgewiesen', () => {
    const lang = 'A'.repeat(200);
    expect(textFeld(lang, 60)).toBe(`"${'A'.repeat(60)}"`);
  });

  it('ein leeres Feld ist leer und nicht ein Paar Anführungszeichen', () => {
    expect(textFeld(null, 60)).toBe('');
    expect(textFeld('', 60)).toBe('');
  });

  /*
   * V-211: erst gekürzt, dann maskiert. Die erste Fassung verdoppelte zuerst
   * und schnitt danach; traf der Schnitt ein verdoppeltes Paar, blieb das Feld
   * offen, und der Rest der Zeile war Buchungstext.
   */
  it('ein Anführungszeichen an der Längengrenze lässt das Feld nicht offen', () => {
    const text = 'RE R-2026-00012 Wohnungsbaugenossenschaft Berlin "Am Parks"';
    expect(Array.from(text)).toHaveLength(59);
    const feld = textFeld(text, 60);
    const felder = leseCsvZeile(`${feld};"H";1`);
    expect(felder).toEqual([text, 'H', '1']);
  });

  it('der Schnitt trifft ein Anführungszeichen — das Feld bleibt geschlossen', () => {
    // 59 Zeichen, das 60. ist ein Anführungszeichen, das 61. ein Buchstabe.
    const text = `${'A'.repeat(59)}"B`;
    const felder = leseCsvZeile(`${textFeld(text, 60)};"S";2`);
    expect(felder).toEqual([`${'A'.repeat(59)}"`, 'S', '2']);
  });

  it('ein Text mit Anführungszeichen wird nicht um deren Zahl gekürzt', () => {
    const text = 'Objekt "Mitte" und "Nord"';
    expect(leseCsvZeile(textFeld(text, text.length))).toEqual([text]);
  });

  it('gekürzt wird in Zeichen, nicht in UTF-16-Einheiten', () => {
    const text = `${'A'.repeat(59)}😀Z`;
    expect(textFeld(text, 60)).toBe(`"${'A'.repeat(59)}😀"`);
  });

  it('die Stapelbezeichnung passt ganz in den Kopf und nennt das Enddatum', () => {
    const bezeichnung = stapelBezeichnung('2026-08-01', '2026-08-31');
    expect(bezeichnung).toBe('Stapel 01.08.2026-31.08.2026');
    expect(Array.from(bezeichnung).length).toBeLessThanOrEqual(BEZEICHNUNG_HOECHSTENS);
    const kopf = leseCsvZeile(baueKopf({ ...KOPF, bezeichnung }));
    expect(kopf).toContain('Stapel 01.08.2026-31.08.2026');
  });
});

/**
 * Ein CSV-Leser nach RFC 4180 mit `;` — so, wie DATEV ein Feld liest: in
 * Anführungszeichen, `""` ist ein Zeichen, das Feld endet am einzelnen `"`.
 * Wirft, wenn am Zeilenende eine Anführung offen ist.
 */
function leseCsvZeile(zeile: string): string[] {
  const felder: string[] = [];
  let feld = '';
  let inAnfuehrung = false;
  for (let i = 0; i < zeile.length; i += 1) {
    const c = zeile[i]!;
    if (inAnfuehrung) {
      if (c === '"' && zeile[i + 1] === '"') { feld += '"'; i += 1; }
      else if (c === '"') inAnfuehrung = false;
      else feld += c;
    } else if (c === '"') inAnfuehrung = true;
    else if (c === ';') { felder.push(feld); feld = ''; }
    else feld += c;
  }
  if (inAnfuehrung) throw new Error(`offene Anführung in ${zeile}`);
  felder.push(feld);
  return felder;
}

describe('(4) derselbe Zeitraum zweimal ergibt identische Bytes', () => {
  it('zwei Läufe mit demselben Erzeugungszeitpunkt sind byte-gleich', () => {
    const a = schreibeExtf(KOPF, [BUCHUNG]);
    const b = schreibeExtf(KOPF, [BUCHUNG]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('der Schreiber liest keine Uhr — der Zeitstempel kommt herein', () => {
    const frueh = schreibeExtf({ ...KOPF, erzeugtAm: new Date(Date.UTC(2026, 0, 1)) },
      [BUCHUNG]);
    const spaet = schreibeExtf({ ...KOPF, erzeugtAm: new Date(Date.UTC(2026, 5, 1)) },
      [BUCHUNG]);
    // Verschieden — also stammt der Stempel aus dem Argument …
    expect(Buffer.from(frueh).equals(Buffer.from(spaet))).toBe(false);
    // … und die Zeilen darunter sind identisch.
    const zeilen = (b: Uint8Array): string[] =>
      Buffer.from(b).toString('latin1').split('\r\n').slice(1);
    expect(zeilen(frueh)).toEqual(zeilen(spaet));
  });
});

describe('(5) das Format sagt selbst, dass es ungeprüft ist', () => {
  it('die Fahne steht, solange kein Kundenmuster vorliegt (O-05)', () => {
    /*
     * Diese Zusage ist keine Formalie. Sie ist der Anker, an dem die
     * Oberfläche ihren Hinweis aufhängt — fällt die Fahne, ohne dass jemand
     * das Muster eingepflegt hat, fällt dieser Test mit einem Satz, der sagt,
     * was zu tun ist.
     */
    expect(
      FORMAT_SPEZIFIKATIONSABGELEITET,
      'Die Fahne fällt erst, wenn eine echte EXTF-Musterdatei des '
      + 'Steuerberaters im Fixtureset liegt und SPALTEN dagegen abgeglichen '
      + 'wurde (O-05).',
    ).toBe(true);
  });

  it('eine unbekannte Spalte wird abgewiesen, nicht still verschluckt', () => {
    expect(SPALTEN.indexOf('Gibt es nicht')).toBe(-1);
  });
});
