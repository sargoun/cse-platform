import { describe, expect, it } from 'vitest';
import { kennwortResetMail } from '../../src/server/auth/kennwort-anmeldung.js';

/**
 * Der Text der Zuruecksetzungsmail (AUT-06).
 *
 * Der Grund fuer diese Datei ist ein Befund an genau dieser Stelle: der Link
 * stand relativ im Text (`/auth/passwort-neu?token=…`). Im Browser ist das ein
 * Pfad, in einem Postfach ein Wort — der Weg war gebaut und trug nichts.
 */
describe('kennwortResetMail', () => {
  it('(1) der Link ist absolut — ein Pfad allein ist in einer E-Mail nichts', () => {
    const { text } = kennwortResetMail('https://cse-gruppe.de', 'abc');
    expect(text).toContain('https://cse-gruppe.de/auth/passwort-neu?token=abc');
    /* Kein Vorkommen des Pfades OHNE Basis davor. */
    expect(text.replace('https://cse-gruppe.de/auth/passwort-neu', ''))
      .not.toContain('/auth/passwort-neu');
  });

  it('(2) ein Schrägstrich am Ende der Basis verdoppelt sich nicht', () => {
    const { text } = kennwortResetMail('https://cse-gruppe.de///', 'abc');
    expect(text).toContain('https://cse-gruppe.de/auth/passwort-neu?token=abc');
  });

  it('(3) der Token wird kodiert — sonst käme ein anderer an als der vergebene', () => {
    const { text } = kennwortResetMail('https://cse-gruppe.de', 'a+b/c=&d');
    expect(text).toContain('?token=a%2Bb%2Fc%3D%26d');
    expect(text).not.toContain('&d');
  });

  it('(4) der Betreff nennt die Gruppe, der Text die Gültigkeit', () => {
    const { betreff, text } = kennwortResetMail('https://cse-gruppe.de', 'abc');
    expect(betreff).toContain('CSE Gruppe');
    expect(text).toContain('zwei Stunden');
    expect(text).toContain('nur einmal');
  });
});
