import { describe, expect, it } from 'vitest';
import { nachWinAnsi, schreibeTextPdf } from '@/server/services/dokument/pdf';

/**
 * Der Textschreiber zählt, was er nicht darstellen kann — und seit V-131
 * zählt er nicht mehr, was er GLEICHBEDEUTEND darstellen kann.
 *
 * Gefunden vom Seed mit Vorführspeicher: „Dauerfrost unter −5 °C" (echtes
 * Minuszeichen, U+2212) brach die Behinderungsanzeige ab, obwohl nichts am
 * Wortlaut verloren gegangen wäre.
 */
describe('nachWinAnsi', () => {
  it('die deutschen Sonderzeichen aus cp1252 gehen ohne Ersatz', () => {
    const e = nachWinAnsi('„Grüße" — § 6 Abs. 1 VOB/B, 12 € … ‚ß‘');
    expect(e.ersetzt).toBe(0);
  });

  it('ein echtes Minuszeichen wird ein Bindestrich-Minus, ohne gezählt zu werden', () => {
    const e = nachWinAnsi('−5 °C');
    expect(e.ersetzt).toBe(0);
    expect(e.bytes[0]).toBe(0x2d);
  });

  it('schmale und feste Leerzeichen werden Leerzeichen gleicher Art', () => {
    const e = nachWinAnsi('5 °C 3 m 7 kg');
    expect(e.ersetzt).toBe(0);
    expect(e.bytes[1]).toBe(0xa0);
    expect(e.bytes[6]).toBe(0x20);
  });

  it('Bindestriche aller Art bleiben Bindestriche', () => {
    const e = nachWinAnsi('Nord‐Süd, Achse‑C, 1‒2');
    expect(e.ersetzt).toBe(0);
    expect(e.bytes).toContain(0x96);
  });

  it('was eine ANDERE Bedeutung hätte, wird weiter gezählt — nie still ersetzt', () => {
    expect(nachWinAnsi('Ahmad أحمد').ersetzt).toBe(4);
    expect(nachWinAnsi('Иван').ersetzt).toBe(4);
    expect(nachWinAnsi('→').ersetzt).toBe(1);
    expect(nachWinAnsi('ğ ş').ersetzt).toBe(2);
  });

  it('und schreibeTextPdf gibt die Zahl weiter', () => {
    expect(schreibeTextPdf({ titel: 'T', text: 'unter −5 °C' }).ersetzteZeichen).toBe(0);
    expect(schreibeTextPdf({ titel: 'T', text: 'Herr Ağa' }).ersetzteZeichen).toBe(1);
  });
});
