/**
 * Das Beweismittelbuendel ueber das Pruefprotokoll — die Form, die ohne
 * Datenbank pruefbar ist (SEC-A9, DOC-08, LEG-01).
 *
 * **Zwei Zusicherungen, und beide sind der Grund, warum ein Buendel etwas
 * wert ist:**
 *
 *  - **Reproduzierbar.** Dasselbe Buendel zweimal gepackt ergibt dieselben
 *    BYTES: das Manifest ist kanonisches JSON ohne Uhr, das Archiv ist STORE
 *    mit Nullzeitstempel. Ohne das koennte ein Pruefer ein Buendel von damals
 *    nicht mit einem von heute vergleichen — und genau dafuer ist es da.
 *  - **Ein redigiertes Buendel SAGT es.** Fehlt
 *    `system.audit_sensitiv_lesen`, fehlt die Nutzlastdatei, und das Manifest
 *    traegt den Grund. Ein Buendel ohne diesen Satz saehe aus, als habe sich
 *    nichts geaendert — die teuerste Art, ein Beweismittel falsch zu lesen.
 *
 * Dazu die CSV-Form: `;` als Trenner, `\r\n` als Zeilenende (RFC 4180), und
 * ein Textfeld, das wie eine Tabellenformel beginnt, bekommt ein Hochkomma.
 * Ein Aktionsname aus der Datenbank ist Text, den jemand von aussen setzen
 * kann; `=HYPERLINK(...)` in einer Protokollzeile wuerde beim Oeffnen der
 * Datei ausgefuehrt, nicht gezeigt.
 */
import { describe, expect, it } from 'vitest';
import {
  MANIFEST_NAME, NUTZLAST_NAME, ZEILEN_NAME, nutzlastCsv, packeAuditBuendel,
  zeilenCsv, type AuditBuendel, type BuendelZeile,
} from '../../src/server/services/audit/buendel.js';
import { leseZipEintrag, leseZipVerzeichnis } from '../../src/server/services/archiv/zip.js';
import { kanonisiere } from '../../src/server/services/finanz/kanonisch.js';
import { alsKanonischerWert } from '../../src/server/services/freigabe/diff-json.js';
import { createHash } from 'node:crypto';

function zeile(o: Partial<BuendelZeile> = {}): BuendelZeile {
  return {
    id: '17',
    ebene: 'mandant',
    akteurTyp: 'mensch',
    akteur: 'Adminfrau',
    aktion: 'rechnung.festgeschrieben',
    objektTyp: 'rechnung',
    objektId: 'RE-2026-000123',
    felder: ['status', 'nummer'],
    ip: '192.0.2.10',
    sitzungId: '00000000-0000-0000-0000-0000000000aa',
    zeitpunktUtc: '2026-09-17T08:30:00.000Z',
    zeitpunktBerlin: '17.09.2026 10:30:00',
    ...o,
  };
}

function buendel(o: Partial<AuditBuendel> = {}): AuditBuendel {
  const zeilen = o.zeilen ?? [zeile()];
  const manifestWert = {
    art: 'cse-audit-buendel', version: 1,
    anzahlZeilen: zeilen.length,
    zeilen: zeilen.map((z) => ({ id: z.id, aktion: z.aktion })),
  };
  const manifest = o.manifest ?? kanonisiere(alsKanonischerWert(manifestWert));
  return {
    mandantId: '00000000-0000-0000-0000-000000000001',
    filter: { von: '2026-09-01', bis: '2026-09-30' },
    vonUtc: '2026-08-31 22:00:00+00',
    bisUtc: '2026-09-30 22:00:00+00',
    zeilen,
    nutzlasten: [{ auditId: '17', vorher: { status: 'entwurf' }, nachher: { status: 'festgeschrieben' } }],
    redigiert: false,
    deckung: { zeilen: zeilen.length, gekettet: zeilen.length, ketten: ['audit_log_2026_09'], neuGekettet: 0 },
    manifest,
    manifestSha256: createHash('sha256').update(manifest).digest('hex'),
    ...o,
  };
}

describe('zeilenCsv', () => {
  it('Kopfzeile, Semikolon, CRLF — und die Ebene steht drin', () => {
    const csv = zeilenCsv(buendel());
    const [kopf, erste] = csv.split('\r\n');
    expect(kopf).toBe(
      'id;ebene;akteur_typ;akteur;aktion;objekt_typ;objekt_id;geaenderte_felder;'
      + 'ip;sitzung_id;zeitpunkt_utc;zeitpunkt_berlin');
    /*
     * Die Ebene MUSS im Export stehen (04-SEITENKARTE Z. 1950-1957): ein
     * Buendel ohne sie laesst Mandanten- und Plattformzeilen spaeter
     * stillschweigend vermischen.
     */
    expect(kopf).toContain('ebene');
    expect(erste).toContain('mandant');
    expect(erste).toContain('rechnung.festgeschrieben');
  });

  it('beide Zeitformen: UTC gespeichert, Berlin angezeigt (Invariante 2)', () => {
    const csv = zeilenCsv(buendel());
    expect(csv).toContain('2026-09-17T08:30:00.000Z');
    expect(csv).toContain('17.09.2026 10:30:00');
  });

  it('ein Feld, das wie eine Formel beginnt, bekommt ein Hochkomma', () => {
    const csv = zeilenCsv(buendel({
      zeilen: [zeile({ aktion: '=HYPERLINK("http://x")', objektId: '@cmd' })],
    }));
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain(`'@cmd`);
  });

  it('leere Felder bleiben leer, nicht „null"', () => {
    const csv = zeilenCsv(buendel({
      zeilen: [zeile({ akteur: null, objektTyp: null, objektId: null, felder: null,
        ip: null, sitzungId: null })],
    }));
    expect(csv).not.toContain('null');
    expect(csv.split('\r\n')[1]).toBe(
      '17;mandant;mensch;;rechnung.festgeschrieben;;;;;;'
      + '2026-09-17T08:30:00.000Z;17.09.2026 10:30:00');
  });
});

describe('nutzlastCsv', () => {
  it('Vorher und Nachher als JSON-Text in je einem Feld', () => {
    const csv = nutzlastCsv(buendel());
    expect(csv.split('\r\n')[0]).toBe('audit_id;vorher;nachher');
    expect(csv).toContain('entwurf');
    expect(csv).toContain('festgeschrieben');
  });

  it('eine Anlage hat kein Vorher — und das Feld bleibt leer', () => {
    const csv = nutzlastCsv(buendel({
      nutzlasten: [{ auditId: '18', vorher: null, nachher: { a: 1 } }],
    }));
    expect(csv.split('\r\n')[1]?.startsWith('18;;')).toBe(true);
  });
});

describe('packeAuditBuendel', () => {
  it('Manifest, Protokoll-CSV und Nutzlast-CSV', () => {
    const bytes = packeAuditBuendel(buendel());
    const pfade = leseZipVerzeichnis(bytes).map((e) => e.pfad).sort();
    expect(pfade).toEqual([MANIFEST_NAME, ZEILEN_NAME, NUTZLAST_NAME].sort());
  });

  it('ein REDIGIERTES Buendel enthaelt die Nutzlastdatei nicht', () => {
    const bytes = packeAuditBuendel(buendel({ redigiert: true, nutzlasten: [] }));
    const pfade = leseZipVerzeichnis(bytes).map((e) => e.pfad);
    expect(pfade).not.toContain(NUTZLAST_NAME);
    expect(pfade).toContain(MANIFEST_NAME);
  });

  it('zweimal gepackt: dieselben Bytes — das Archiv traegt keine Uhr', () => {
    const b = buendel();
    const a1 = packeAuditBuendel(b);
    const a2 = packeAuditBuendel(b);
    expect(Buffer.from(a1).equals(Buffer.from(a2))).toBe(true);
    expect(createHash('sha256').update(a1).digest('hex'))
      .toBe(createHash('sha256').update(a2).digest('hex'));
  });

  it('das Manifest im Archiv ist Byte fuer Byte das des Buendels', () => {
    const b = buendel();
    const bytes = packeAuditBuendel(b);
    const eintrag = leseZipVerzeichnis(bytes).find((e) => e.pfad === MANIFEST_NAME);
    expect(eintrag).toBeDefined();
    const gelesen = leseZipEintrag(bytes, eintrag!);
    expect(Buffer.from(gelesen).equals(Buffer.from(b.manifest))).toBe(true);
    /* Und der SHA-256, den die Kopfzeile der Antwort nennt, passt dazu. */
    expect(createHash('sha256').update(gelesen).digest('hex')).toBe(b.manifestSha256);
  });

  it('eine andere Zeile ergibt ein anderes Manifest', () => {
    const a = buendel();
    const b = buendel({ zeilen: [zeile({ aktion: 'rechnung.storniert' })] });
    expect(a.manifestSha256).not.toBe(b.manifestSha256);
  });
});
