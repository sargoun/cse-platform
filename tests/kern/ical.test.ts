import { describe, expect, it } from 'vitest';
import {
  alsDatum, alsIcal, alsUtc, falte, maskiere,
} from '../../src/server/services/kalender/ical.js';

/**
 * Der iCal-Ausgang (CAL-03), ohne Datenbank.
 *
 * Was hier geprüft wird, ist das, woran eine selbstgeschriebene
 * RFC-5545-Fassung scheitert: Zeilenfaltung mitten in einem Umlaut,
 * Maskierung in der falschen Reihenfolge, das exklusive `DTEND` bei
 * ganztägigen Terminen, und ein abgesagter Termin, der einfach fehlt statt
 * abgesagt zu sein.
 */

const JETZT = new Date('2026-09-15T02:00:00Z');

describe('Zeilenfaltung (RFC 5545 §3.1)', () => {
  it('kurze Zeilen bleiben, wie sie sind', () => {
    expect(falte('SUMMARY:Kurz')).toBe('SUMMARY:Kurz');
  });

  it('lange Zeilen brechen mit CRLF und einem führenden Leerzeichen', () => {
    const lang = `SUMMARY:${'a'.repeat(200)}`;
    const gefaltet = falte(lang);
    const zeilen = gefaltet.split('\r\n');
    expect(zeilen.length).toBeGreaterThan(1);
    expect(Buffer.from(zeilen[0]!, 'utf8').length).toBeLessThanOrEqual(75);
    for (const z of zeilen.slice(1)) {
      expect(z.startsWith(' ')).toBe(true);
      expect(Buffer.from(z, 'utf8').length).toBeLessThanOrEqual(75);
    }
    // Zusammengesetzt ist es wieder der Ursprungstext.
    expect(gefaltet.split('\r\n ').join('')).toBe(lang);
  });

  /**
   * **Der Fall, der die naive Fassung kaputt macht.** „ü" ist ein Zeichen und
   * zwei Oktette. Wer auf 75 ZEICHEN faltet, schreibt Zeilen mit bis zu 150
   * Oktetten; wer stumpf auf 75 Oktette schneidet, trennt mitten im Umlaut,
   * und das Ergebnis ist kein gültiges UTF-8 mehr.
   */
  it('trennt nie mitten in einem Mehrbyte-Zeichen', () => {
    const lang = `SUMMARY:${'Kurfürstendamm über Gebühr '.repeat(8)}`;
    const gefaltet = falte(lang);
    for (const z of gefaltet.split('\r\n')) {
      expect(Buffer.from(z, 'utf8').length).toBeLessThanOrEqual(75);
      // Kein Ersatzzeichen: ein zerschnittenes Oktettpaar ergäbe U+FFFD.
      expect(z).not.toContain('�');
    }
    expect(gefaltet.split('\r\n ').join('')).toBe(lang);
  });
});

describe('Maskierung (§3.3.11)', () => {
  it('Backslash zuerst — sonst maskiert man die eigene Maskierung', () => {
    expect(maskiere('a\\b')).toBe('a\\\\b');
    expect(maskiere('Hof; Haus, Halle')).toBe('Hof\; Haus\\, Halle');
    expect(maskiere('zwei\nZeilen')).toBe('zwei\\nZeilen');
    expect(maskiere('zwei\r\nZeilen')).toBe('zwei\\nZeilen');
  });

  it('ein Doppelpunkt bleibt — er trennt nur den Feldnamen', () => {
    expect(maskiere('Thema: Begehung')).toBe('Thema: Begehung');
  });
});

describe('Zeitangaben', () => {
  it('ein Instant ist UTC mit Z', () => {
    expect(alsUtc(new Date('2026-09-15T08:30:00Z'))).toBe('20260915T083000Z');
    expect(alsUtc(new Date('2026-01-01T00:00:00Z'))).toBe('20260101T000000Z');
  });

  /**
   * **Ein ganztägiger Termin trägt das BERLINER Datum.** Am 15.9. um 23:30
   * Berliner Zeit ist es in UTC bereits der 15.9. um 21:30 — im Winter aber
   * wäre 23:30 Berlin der 15.9. um 22:30 UTC, und am 1.1. um 00:30 Berlin ist
   * es in UTC noch der 31.12. Wer `toISOString()` nimmt, verschiebt diese
   * Termine um einen Tag.
   */
  it('ein Datum ist das Berliner Datum, nicht das UTC-Datum', () => {
    expect(alsDatum(new Date('2026-09-15T21:30:00Z'))).toBe('20260915');
    // 00:30 Berlin am 1.1.2027 ist 23:30 UTC am 31.12.2026.
    expect(alsDatum(new Date('2026-12-31T23:30:00Z'))).toBe('20270101');
  });
});

describe('Der Kalender', () => {
  const grund = {
    uid: 'ke-1@cse', titel: 'Begehung', beginn: new Date('2026-09-15T08:00:00Z'),
    ende: new Date('2026-09-15T09:00:00Z'), ganztaegig: false,
  };

  it('trägt Kopf, Fuss und CRLF', () => {
    const ics = alsIcal({ name: 'Mein Kalender', jetzt: JETZT }, [grund]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:');
    // METHOD:PUBLISH — sonst fragt Outlook nach einer Zusage.
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('DTSTART:20260915T080000Z');
    expect(ics).toContain('DTEND:20260915T090000Z');
    expect(ics).toContain('STATUS:CONFIRMED');
  });

  /**
   * **`DTEND` ist bei ganztägigen Terminen exklusiv** (§3.6.1). Ein
   * eintägiger Termin am 15. hat `DTEND` am 16. — ohne diesen Tag zeigen
   * Kalenderprogramme einen Termin ohne Dauer oder gar keinen.
   */
  it('ein ganztägiger Termin endet am Folgetag', () => {
    const ics = alsIcal({ name: 'K', jetzt: JETZT }, [{
      ...grund,
      ganztaegig: true,
      beginn: new Date('2026-09-15T06:00:00Z'),
      ende: new Date('2026-09-15T16:00:00Z'),
    }]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260915');
    expect(ics).toContain('DTEND;VALUE=DATE:20260916');
    expect(ics).not.toContain('DTSTART:2026');
  });

  it('ein mehrtägiger ganztägiger Termin behält sein Ende', () => {
    const ics = alsIcal({ name: 'K', jetzt: JETZT }, [{
      ...grund,
      ganztaegig: true,
      beginn: new Date('2026-09-15T06:00:00Z'),
      ende: new Date('2026-09-18T06:00:00Z'),
    }]);
    expect(ics).toContain('DTEND;VALUE=DATE:20260918');
  });

  /**
   * **Ein abgesagter Termin wird mitgeschickt.** Wer ihn im Kalender hat,
   * bekommt ihn sonst nie wieder los: ein Feed ohne die Zeile heisst
   * „unverändert", nicht „abgesagt".
   */
  it('eine Absage ist CANCELLED, kein Weglassen', () => {
    const ics = alsIcal({ name: 'K', jetzt: JETZT }, [{ ...grund, abgesagt: true }]);
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('UID:ke-1@cse');
  });

  it('Titel mit Sonderzeichen kommen maskiert heraus', () => {
    const ics = alsIcal({ name: 'K', jetzt: JETZT }, [{
      ...grund, titel: 'Begehung; Haus 3, 2. OG', ort: 'Kurfürstendamm 21, Berlin',
    }]);
    expect(ics).toContain('SUMMARY:Begehung\; Haus 3\\, 2. OG');
    expect(ics).toContain('LOCATION:Kurfürstendamm 21\\, Berlin');
  });

  it('ein leerer Kalender ist gültig, nicht kaputt', () => {
    const ics = alsIcal({ name: 'K', jetzt: JETZT }, []);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  /**
   * Jede Zeile der fertigen Datei hält die Oktettgrenze — die Prüfung über
   * das GANZE Ergebnis, nicht nur über `falte()`. Eine Zeile, die erst beim
   * Zusammensetzen zu lang wird, fiele sonst niemandem auf.
   */
  it('keine Zeile der fertigen Datei ist länger als 75 Oktette', () => {
    const ics = alsIcal({ name: 'Kalender über alles', jetzt: JETZT }, [{
      ...grund,
      titel: 'Baustellenbegehung Kurfürstendamm 21 mit Objektleitung und Bauherr',
      beschreibung: 'Ü'.repeat(120),
    }]);
    for (const z of ics.split('\r\n')) {
      expect(Buffer.from(z, 'utf8').length, z).toBeLessThanOrEqual(75);
    }
  });
});
