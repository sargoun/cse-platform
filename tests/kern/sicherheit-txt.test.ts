/**
 * `/.well-known/security.txt` (RFC 9116) — und der Satz, den diese Datei
 * einfriert: **ohne benanntes Postfach gibt es die Datei nicht.**
 *
 * `04-SEITENKARTE.md` §2.5 ist hier nicht weich: „a contact address nobody
 * reads is worse than no file at all". Der Grund ist nicht Formalismus. Diese
 * Datei ist eine Einladung, eine gefundene Lücke UNS zu melden statt sie zu
 * verkaufen; steht dort eine Adresse, die niemand liest, wartet der Melder,
 * bekommt keine Antwort und veröffentlicht nach dreissig Tagen. Die Datei hat
 * dann Schaden angerichtet.
 *
 * Deshalb prüft diese Datei zuerst das Nein und dann die Form.
 */
import { describe, expect, it } from 'vitest';
import {
  istKontaktWert, sicherheitTxt,
} from '../../src/server/services/inhalt/sicherheit-txt.js';

const BASIS = 'https://cse.example';
const JETZT = new Date('2026-09-17T12:00:00Z');

describe('ohne Postfach entsteht keine Datei', () => {
  it('`null` als Kontakt gibt `null` — der Handler antwortet damit 404', () => {
    expect(sicherheitTxt(null, BASIS, JETZT)).toBeNull();
  });

  it('eine NACKTE E-Mail-Adresse ist kein gültiger Contact-Wert (§2.5.3)', () => {
    /*
     * RFC 9116 verlangt eine URI. `sicherheit@cse.example` steht in der Datei
     * und wird von Werkzeugen nicht erkannt — die Datei sähe vollständig aus
     * und wäre unbrauchbar. Lieber kein Eintrag als ein unerkannter.
     */
    expect(istKontaktWert('sicherheit@cse.example')).toBe(false);
    expect(sicherheitTxt({ kontakt: 'sicherheit@cse.example' }, BASIS, JETZT)).toBeNull();
  });

  it('und eine Zeichenkette, die nach nichts aussieht, auch nicht', () => {
    expect(istKontaktWert('')).toBe(false);
    expect(istKontaktWert('bitte melden')).toBe(false);
    expect(istKontaktWert('http://cse.example/melden')).toBe(false); // kein TLS
  });
});

describe('mit Postfach entsteht sie nach RFC 9116', () => {
  const text = sicherheitTxt({ kontakt: 'mailto:security@cse.example' }, BASIS, JETZT);

  it('sie entsteht überhaupt', () => {
    expect(text).not.toBeNull();
  });

  it('`Contact` steht drin, mit der URI, die hinterlegt ist', () => {
    expect(text).toContain('Contact: mailto:security@cse.example');
  });

  it('`Expires` ist PFLICHT (§2.5.5) und liegt zwölf Monate in der Zukunft', () => {
    // Eine Datei ohne `Expires` ist nach dem RFC ungültig; eine mit einem
    // abgelaufenen wird von Werkzeugen verworfen. Gesetzt wird sie aus der
    // SERVERUHR, bei jedem Abruf neu (Invariante 5).
    expect(text).toContain('Expires: 2027-09-17T12:00:00Z');
  });

  it('`Canonical` zeigt auf dieselbe Hostquelle wie sitemap und robots (O-08)', () => {
    expect(text).toContain(`Canonical: ${BASIS}/.well-known/security.txt`);
  });

  it('`Preferred-Languages` nennt deutsch zuerst — die Meldung liest ein Mensch', () => {
    expect(text).toContain('Preferred-Languages: de, en');
  });

  it('`Policy` steht nur da, wenn eine Richtlinie hinterlegt ist', () => {
    expect(text).not.toContain('Policy:');
    const mitPolicy = sicherheitTxt(
      { kontakt: 'https://cse.example/melden', richtlinie: 'https://cse.example/sicherheit' },
      BASIS, JETZT,
    );
    expect(mitPolicy).toContain('Policy: https://cse.example/sicherheit');
  });

  it('eine leere Richtlinie erzeugt KEINE leere Zeile', () => {
    // `Policy: ` ohne Wert ist eine Feldzeile ohne Feldwert — ungültig nach
    // §2.2 und genau die Art Befund, die nach Nachlässigkeit aussieht.
    const leer = sicherheitTxt(
      { kontakt: 'mailto:security@cse.example', richtlinie: '   ' }, BASIS, JETZT,
    );
    expect(leer).not.toContain('Policy:');
  });

  it('die Datei endet mit einem Zeilenumbruch — `text/plain` ohne ist unsauber', () => {
    expect(text?.endsWith('\n')).toBe(true);
  });
});
