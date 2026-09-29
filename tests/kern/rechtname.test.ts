import { describe, expect, it } from 'vitest';
import { alleRechteschluessel, rechtName } from '../../src/lib/i18n/rechtname';

/**
 * **Ein Rechteschlüssel muss ein Satz werden** (Nutzerbericht).
 *
 * Über vierhundert Stellen im Portal zeigten `kalkulation.lesen` im Klartext.
 * Für den Menschen, der es liest, ist das Quelltext: er erfährt, dass ihm
 * etwas fehlt, aber nicht was — und kann deshalb nicht danach fragen.
 *
 * **Gemessen wird vor allem die Vollständigkeit.** Der Katalog führt 243
 * Schlüssel; zusammengesetzt wird aus 112 Hauptwörtern und 41
 * Tätigkeitswörtern. Fehlt ein Teil, kommt kein leerer String heraus, sondern
 * ein lesbar gemachter Rest — aber auffallen soll es trotzdem, und zwar hier.
 */
describe('rechtName', () => {
  it('macht aus einem Schlüssel einen deutschen Satz', () => {
    expect(rechtName('kalkulation.lesen')).toBe('Kalkulationen lesen');
    expect(rechtName('bau.preis_lesen')).toBe('Preise lesen');
    expect(rechtName('eingang.schreiben')).toBe('den Rechnungseingang bearbeiten');
  });

  /*
   * V-250: seit diese Namen auf mehr Seiten als Satz stehen, müssen sie
   * sagen, was die Seite meint — „die Prüffrist" auf der Seite „Prüfdauer",
   * „das Konto" neben „Benutzerkonten" und „Kunden freigeben" für die
   * Freigabe eines DOKUMENTS an den Kunden taten es nicht.
   */
  it('nennt Prüfdauer, Zeitkonten und die Dokumentfreigabe, wie die Seiten sie meinen', () => {
    expect(rechtName('freigabe.pruefdauer_lesen')).toBe('die Prüfdauer lesen');
    expect(rechtName('zeit.konto_lesen')).toBe('Zeitkonten lesen');
    expect(rechtName('zeit.konto_korrigieren', 'en')).toBe('correct time accounts');
    expect(rechtName('dokument.kunde_freigeben')).toBe('Dokumente für Kunden freigeben');
    expect(rechtName('dokument.kunde_freigeben', 'en')).toBe('approve documents for customers');
  });

  it('dreht die Wortstellung im Englischen um', () => {
    expect(rechtName('kalkulation.lesen', 'en')).toBe('read costings');
    expect(rechtName('bau.preis_lesen', 'en')).toBe('read prices');
  });

  /**
   * **Kein Schlüssel fällt auf seinen Rohwert zurück.** Das ist die eigentliche
   * Zusage: käme ein Schlüssel unübersetzt durch, stünde er wieder als
   * Quelltext auf dem Bildschirm — und genau das war der Befund.
   */
  it('übersetzt JEDEN Schlüssel des Katalogs, in beiden Sprachen', () => {
    const roh: string[] = [];
    for (const s of alleRechteschluessel()) {
      for (const sprache of ['de', 'en'] as const) {
        const name = rechtName(s, sprache);
        if (name === s || name.trim() === '' || name.includes('.')) {
          roh.push(`${s} (${sprache}) → ${name}`);
        }
      }
    }
    expect(roh, 'Schlüssel ohne Satz').toEqual([]);
  });

  it('macht auch einen unbekannten Schlüssel lesbar statt leer', () => {
    const name = rechtName('erfundenes_modul.liefer_datum_lesen');
    expect(name).not.toBe('');
    expect(name).not.toContain('.');
  });

  it('der Katalog ist nicht leer', () => {
    expect(alleRechteschluessel().length).toBeGreaterThan(200);
  });
});
