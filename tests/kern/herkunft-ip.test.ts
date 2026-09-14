/**
 * Woher eine Anmeldung kommt — und wann die Antwort „unbekannt" ist.
 *
 * `x-forwarded-for` setzt der Aufrufer. Was hier durchkommt, landet in einem
 * `inet`-Parameter; was dort nicht hineinpasst, laesst die ANMELDUNG
 * scheitern. Eine Herkunftspruefung, die manipulierbaren Text durchlaesst,
 * verwandelt einen falschen Kopf also in einen Ausfall der Anmeldung — und
 * genau das soll sie verhindern.
 *
 * Der Befund aus der Durchsicht von PR #9: der IPv6-Zweig pruefte
 * `/^[0-9a-fA-F:]{2,45}$/`. Das trifft `:::`, `::::`, `abcd` und ein Dutzend
 * weiterer Zeichenketten, die keine Adresse sind.
 */
import { describe, expect, it } from 'vitest';
import { herkunft } from '../../src/app/auth/mitarbeiter/anmeldung.js';

function kopf(wert: string | null): Headers {
  const h = new Headers();
  if (wert !== null) h.set('x-forwarded-for', wert);
  return h;
}

describe('herkunft', () => {
  it('nimmt eine IPv4-Adresse', async () => {
    expect((await herkunft(kopf('203.0.113.7'))).ip).toBe('203.0.113.7');
  });

  it('nimmt eine IPv6-Adresse', async () => {
    expect((await herkunft(kopf('2001:db8::1'))).ip).toBe('2001:db8::1');
  });

  it('nimmt den ERSTEN Eintrag einer Kette', async () => {
    expect((await herkunft(kopf('203.0.113.7, 198.51.100.2'))).ip).toBe('203.0.113.7');
  });

  it('weist zurück, was nur AUSSIEHT wie IPv6', async () => {
    for (const roh of [':::', '::::::', 'abcd', 'ff:ff', ':', '::1::2']) {
      expect((await herkunft(kopf(roh))).ip, roh).toBeNull();
    }
  });

  it('weist eine IPv4 mit Oktett über 255 zurück', async () => {
    expect((await herkunft(kopf('999.1.1.1'))).ip).toBeNull();
  });

  it('ohne Kopf: unbekannt statt erfunden', async () => {
    expect((await herkunft(kopf(null))).ip).toBeNull();
    expect((await herkunft(kopf(''))).ip).toBeNull();
  });
});
