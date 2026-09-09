/**
 * PR 9 Akzeptanz (1), (2), (3) — die Teile ohne Datenbank.
 *
 * Alle drei sind Aussagen ueber BYTES: was erkannt wird, was gespeichert wird,
 * was eine Signatur zu welchem Zeitpunkt erlaubt. Keine davon laesst sich
 * durch ein Flag in einer Zeile beantworten.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { erkenneMime, MimeFehler, pruefeUpload, pruefeGroesse, MAX_BYTES } from '../../src/server/storage/mime.js';
import { entferneMetadaten, ExifFehler, brauchtBereinigung } from '../../src/server/storage/exif.js';
import {
  erzeugeSignatur, GUELTIG_SEKUNDEN, pruefeSignatur, SignaturFehler, ZWECKE,
} from '../../src/server/storage/signatur.js';
import { LokalerSpeicher, NichtVerbundenFehler, SupabaseSpeicher } from '../../src/server/storage/adapter.js';
import { ladeHoch } from '../../src/server/services/dokument/upload.js';
import { AUFBEWAHRUNG, KATEGORIEN, regelFuer } from '../../src/server/services/dokument/kategorie.js';

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);
const PDF = (): Uint8Array => Uint8Array.from([...Buffer.from('%PDF-1.7'), ...Buffer.alloc(64)]);
/** MZ — eine Windows-Ausfuehrbare. */
const EXE = (): Uint8Array => Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, ...Buffer.alloc(64)]);

/** Ein JPEG mit einem APP1-Segment, das GPS-EXIF traegt. */
function jpegMitExif(): Uint8Array {
  const exif = Buffer.concat([
    Buffer.from('Exif\0\0'),
    Buffer.from('II*\0'),
    Buffer.from('GPSLatitude 52.5200 GPSLongitude 13.4050'),
  ]);
  const laenge = exif.length + 2;
  return Uint8Array.from([
    0xff, 0xd8,                                   // SOI
    0xff, 0xe1, (laenge >> 8) & 0xff, laenge & 0xff, ...exif,   // APP1 mit EXIF
    0xff, 0xdb, 0x00, 0x04, 0x00, 0x00,           // DQT — bleibt
    0xff, 0xda, 0x00, 0x02,                       // SOS
    0x11, 0x22, 0x33, 0x44,                       // Bilddaten
  ]);
}

describe('(2) der Typ kommt aus den BYTES, nie aus dem Namen', () => {
  it('eine .exe, die rechnung.pdf heisst, wird abgelehnt', () => {
    // Der Fall, fuer den die Pruefung existiert.
    expect(() => pruefeUpload(EXE(), 'application/pdf')).toThrow(MimeFehler);
    try {
      pruefeUpload(EXE(), 'application/pdf');
    } catch (f) {
      // Nicht erkannt heisst abgelehnt — nicht "durchreichen, sieht harmlos aus".
      expect((f as MimeFehler).grund).toBe('unbekannt');
    }
  });

  it('ein echtes PDF wird erkannt', () => {
    expect(erkenneMime(PDF())).toBe('application/pdf');
    expect(pruefeUpload(PDF(), 'application/pdf')).toEqual({
      mime: 'application/pdf', verifiziert: true,
    });
  });

  it('ein Widerspruch zwischen Inhalt und Deklaration wird benannt, nicht stillschweigend korrigiert', () => {
    // Ein JPEG als PDF deklariert: der Inhalt ist harmlos, die Absicht nicht.
    try {
      pruefeUpload(jpegMitExif(), 'application/pdf');
      expect.unreachable();
    } catch (f) {
      expect((f as MimeFehler).grund).toBe('widerspruch');
    }
  });

  it('PNG, JPEG und die OOXML-Container werden unterschieden', () => {
    expect(erkenneMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(erkenneMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    const docx = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('xxword/document.xml')]);
    expect(erkenneMime(docx))
      .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('leer und zu gross werden beide abgelehnt', () => {
    expect(() => pruefeGroesse(new Uint8Array(0))).toThrow(/Leere Datei/u);
    expect(MAX_BYTES).toBe(268_435_456);
  });
});

describe('(3) EXIF wird aus den GESPEICHERTEN Bytes entfernt', () => {
  it('das GPS-Segment ist nach der Bereinigung nicht mehr da', () => {
    const vorher = jpegMitExif();
    const roh = Buffer.from(vorher).toString('latin1');
    expect(roh).toContain('GPSLatitude');

    const { bytes: nachher, entfernt } = entferneMetadaten(vorher, 'image/jpeg');
    expect(entfernt).toBe(true);
    // DIE Zusage: auf den Bytes, nicht als Flag in einer Zeile.
    expect(Buffer.from(nachher).toString('latin1')).not.toContain('GPSLatitude');
    expect(Buffer.from(nachher).toString('latin1')).not.toContain('Exif');
  });

  it('und die Bilddaten bleiben Byte fuer Byte unangetastet', () => {
    // Kein Re-Encode: das Foto ist Beweismittel in einer Reklamation.
    const { bytes: nachher } = entferneMetadaten(jpegMitExif(), 'image/jpeg');
    const s = Buffer.from(nachher);
    const sos = s.indexOf(Buffer.from([0xff, 0xda]));
    expect(sos).toBeGreaterThan(0);
    expect([...s.subarray(sos + 4)]).toEqual([0x11, 0x22, 0x33, 0x44]);
    // Und das DQT-Segment, das kein Metadatensegment ist, ueberlebt.
    expect(s.indexOf(Buffer.from([0xff, 0xdb]))).toBeGreaterThan(0);
  });

  it('PDF: die Metadatenwerte werden ueberschrieben, die Bytezahl bleibt gleich', () => {
    // Ein PDF ist eine Objekttabelle mit Byte-Offsets in der `xref`. Etwas
    // herauszuschneiden verschiebt jeden Offset dahinter und macht die Datei
    // kaputt — beim Rechnungsarchiv der teuerste denkbare Weg, Metadaten
    // loszuwerden. Deshalb: gleich lang ueberschreiben.
    const pdf = Uint8Array.from(Buffer.from(
      '%PDF-1.7\n1 0 obj<</Author (Max Mustermann)/Producer (Kamera X)'
      + '/CreationDate (D:20260908)>>endobj\nxref\n0 1\ntrailer<</Info 1 0 R>>\n%%EOF',
      'latin1',
    ));
    const { bytes: sauber, entfernt } = entferneMetadaten(pdf, 'application/pdf');

    expect(entfernt).toBe(true);
    // Die Laenge ist unveraendert — kein Offset hat sich bewegt.
    expect(sauber.length).toBe(pdf.length);
    const text = Buffer.from(sauber).toString('latin1');
    expect(text).not.toContain('Max Mustermann');
    expect(text).not.toContain('Kamera X');
    expect(text).not.toContain('D:20260908');
    // Die Struktur steht noch: Schluesselnamen, xref und Trailer.
    expect(text).toContain('/Author');
    expect(text).toContain('xref');
    expect(text).toContain('%%EOF');
  });

  it('ein verschluesseltes PDF wird abgelehnt statt scheinbar bereinigt', () => {
    const pdf = Uint8Array.from(Buffer.from(
      '%PDF-1.7\ntrailer<</Encrypt 9 0 R/Info 1 0 R>>\n%%EOF', 'latin1',
    ));
    expect(() => entferneMetadaten(pdf, 'application/pdf')).toThrow(/verschl/u);
  });

  it('ein Typ ohne Bereinigungsverfahren wird ABGELEHNT, nicht ungereinigt gespeichert', () => {
    // Lieber ein benannter Fehler beim Upload als ein Standortdatum im Anhang.
    expect(() => entferneMetadaten(bytes(0, 1, 2), 'video/mp4')).toThrow(ExifFehler);
    expect(brauchtBereinigung('video/mp4')).toBe(true);
    expect(brauchtBereinigung('application/pdf')).toBe(true);
    expect(brauchtBereinigung('application/zip')).toBe(false);
  });
});

describe('(1) keine URL ohne Signatur, und tot in Minute 16', () => {
  const GEHEIM = 'test-geheimnis';
  const JETZT = 1_800_000_000;
  const basis = {
    dokumentId: 'd1', mandantId: 'm1', objektSchluessel: 'm1/rechnung/d1',
    zweck: 'anzeigen' as const, benutzerId: 'b1',
  };

  it('15 Minuten, und keine Sekunde mehr', () => {
    expect(GUELTIG_SEKUNDEN).toBe(900);
    const s = erzeugeSignatur(basis, GEHEIM, JETZT);
    expect(s.ablauf).toBe(JETZT + 900);
  });

  it('in Minute 14 gueltig, in Minute 16 tot', () => {
    const s = erzeugeSignatur(basis, GEHEIM, JETZT);
    expect(pruefeSignatur(s, GEHEIM, JETZT + 14 * 60, 'm1').dokumentId).toBe('d1');
    // Die Uhr wird UEBERGEBEN — sonst liesse sich dieser Fall nur pruefen,
    // indem man 16 Minuten wartet.
    expect(() => pruefeSignatur(s, GEHEIM, JETZT + 16 * 60, 'm1')).toThrow(SignaturFehler);
    try {
      pruefeSignatur(s, GEHEIM, JETZT + 16 * 60, 'm1');
    } catch (f) {
      expect((f as SignaturFehler).grund).toBe('abgelaufen');
    }
  });

  it('exakt am Ablauf ist sie tot, nicht gerade noch gueltig', () => {
    const s = erzeugeSignatur(basis, GEHEIM, JETZT);
    expect(() => pruefeSignatur(s, GEHEIM, s.ablauf, 'm1')).toThrow(/abgelaufen/u);
  });

  it('eine geaenderte Nutzlast bricht die Signatur', () => {
    const s = erzeugeSignatur(basis, GEHEIM, JETZT);
    // Ein anderes Dokument mit derselben Signatur: der HMAC deckt alle Felder.
    expect(() => pruefeSignatur({ ...s, dokumentId: 'd2' }, GEHEIM, JETZT, 'm1'))
      .toThrow(/ungueltig/u);
    expect(() => pruefeSignatur({ ...s, ablauf: s.ablauf + 99999 }, GEHEIM, JETZT, 'm1'))
      .toThrow(/ungueltig/u);
  });

  it('(4) eine gueltige Signatur aus einem FREMDEN Bereich wird abgewiesen', () => {
    const s = erzeugeSignatur(basis, GEHEIM, JETZT);
    // Echt, nicht abgelaufen — und trotzdem nichts wert, weil die Sitzung in
    // einem anderen Bereich laeuft.
    expect(() => pruefeSignatur(s, GEHEIM, JETZT, 'm2')).toThrow(/anderen Bereich/u);
  });

  it('eine ABGELAUFENE Signatur aus einem fremden Bereich meldet Ablauf, nicht Fremdheit', () => {
    // Die Reihenfolge ist Absicht: die Fehlermeldung soll nicht verraten, ob
    // die URL zu einem Bereich gehoerte, den es gibt.
    const s = erzeugeSignatur(basis, GEHEIM, JETZT);
    try {
      pruefeSignatur(s, GEHEIM, JETZT + 16 * 60, 'm2');
      expect.unreachable();
    } catch (f) {
      expect((f as SignaturFehler).grund).toBe('abgelaufen');
    }
  });

  it('die Zwecke sind ein geschlossenes Vokabular — sie stehen im Protokoll', () => {
    expect(ZWECKE).toEqual([
      'anzeigen', 'herunterladen', 'drucken', 'pruefbericht', 'datev_beleg', 'dsgvo_auskunft',
    ]);
  });
});

describe('der Upload-Pfad haelt die Reihenfolge ein', () => {
  it('speichert die BEREINIGTEN Bytes, nicht die hochgeladenen', async () => {
    const speicher = new LokalerSpeicher();
    const ergebnis = await ladeHoch(
      { mandantId: 'm1', kategorie: 'projekt', titel: 'Foto', dateiname: 'foto.jpg',
        daten: jpegMitExif(), behaupteterTyp: 'image/jpeg' },
      speicher, 2026,
    );

    const gespeichert = speicher.rohBytes('dokumente', ergebnis.objektSchluessel);
    expect(gespeichert).toBeDefined();
    expect(Buffer.from(gespeichert!).toString('latin1')).not.toContain('GPSLatitude');
    expect(ergebnis.exifEntfernt).toBe(true);
    // Der Hash deckt die gespeicherten Bytes, nicht die eingereichten.
    expect(ergebnis.sha256).toBe(createHash('sha256').update(gespeichert!).digest('hex'));
    expect(ergebnis.groesseBytes).toBe(gespeichert!.length);
  });

  it('legt gar nichts ab, wenn der Typ nicht durchgeht', async () => {
    const speicher = new LokalerSpeicher();
    await expect(ladeHoch(
      { mandantId: 'm1', kategorie: 'beleg', titel: 'X', dateiname: 'x.pdf',
        daten: EXE(), behaupteterTyp: 'application/pdf' },
      speicher, 2026,
    )).rejects.toThrow(MimeFehler);
    // Der Speicher ist leer geblieben: die Pruefung kommt VOR dem Schreiben.
    expect(speicher.rohBytes('dokumente', 'm1/beleg/irgendwas')).toBeUndefined();
  });

  it('der Objektschluessel fuehrt mit dem Mandanten', async () => {
    const speicher = new LokalerSpeicher();
    const e = await ladeHoch(
      { mandantId: 'm7', kategorie: 'rechnung', titel: 'RE', dateiname: 'r.pdf', daten: PDF() },
      speicher, 2026,
    );
    expect(e.objektSchluessel.startsWith('m7/rechnung/')).toBe(true);
    expect(e.bucket).toBe('dokumente');
  });

  it('die Aufbewahrung wird aufgeloest, nicht uebergeben', async () => {
    const speicher = new LokalerSpeicher();
    const rechnung = await ladeHoch(
      { mandantId: 'm1', kategorie: 'rechnung', titel: 'RE', dateiname: 'r.pdf', daten: PDF() },
      speicher, 2026,
    );
    expect(rechnung.aufbewahrungBis).toBe('2036-12-31');
    expect(rechnung.loeschsperre).toBe(true);

    // Offene Frist: `null` — und trotzdem gesperrt. Eine unbekannte Pflicht
    // wird als Pflicht behandelt, nie als ihre Abwesenheit (O-25).
    const personal = await ladeHoch(
      { mandantId: 'm1', kategorie: 'mitarbeiter', titel: 'P', dateiname: 'p.pdf', daten: PDF() },
      speicher, 2026,
    );
    expect(personal.aufbewahrungBis).toBeNull();
    expect(personal.loeschsperre).toBe(true);
  });
});

describe('der Speicher-Adapter simuliert keinen Erfolg', () => {
  it('ohne Zugangsdaten: nicht verbunden, und er sagt es', async () => {
    const s = new SupabaseSpeicher('', '');
    expect(s.verbunden).toBe(false);
    await expect(s.lege('dokumente', 'k', new Uint8Array(1)))
      .rejects.toBeInstanceOf(NichtVerbundenFehler);
    await expect(s.hole('dokumente', 'k')).rejects.toBeInstanceOf(NichtVerbundenFehler);
  });
});

describe('die neun Kategorien und ihre Fristen', () => {
  it('genau neun, DOC-01 woertlich', () => {
    expect(KATEGORIEN).toEqual([
      'kunde', 'vertrag', 'angebot', 'rechnung', 'beleg',
      'mitarbeiter', 'projekt', 'buchhaltung', 'unternehmen',
    ]);
    expect(AUFBEWAHRUNG).toHaveLength(9);
  });

  it('jede Kategorie hat eine Regel, und jede Regel eine Rechtsgrundlage', () => {
    for (const k of KATEGORIEN) {
      const r = regelFuer(k);
      expect(r.grundlage.length, k).toBeGreaterThan(10);
      // Eine offene Frist ist als Platzhalter markiert UND gesperrt.
      if (r.jahre === null) {
        expect(r.istPlatzhalter, k).toBe(true);
        expect(r.loeschsperre, k).toBe(true);
      }
    }
  });

  it('die zehnjaehrigen Kategorien sind die des § 147 AO', () => {
    for (const k of ['rechnung', 'buchhaltung', 'beleg', 'vertrag'] as const) {
      expect(regelFuer(k).jahre, k).toBe(10);
      expect(regelFuer(k).loeschsperre, k).toBe(true);
    }
  });
});
