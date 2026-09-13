import { describe, expect, it } from 'vitest';
import { SICHERHEITSKOEPFE } from '../../src/lib/sicherheitskoepfe.js';
import { sitzungsKeksOptionen, SITZUNG_MAX_ALTER_SEK } from '../../src/server/auth/sitzung.js';

/**
 * SEC-A7 (D-416) und der Sitzungskeks (D-416).
 *
 * Beides ist eine Zusage ueber JEDE Antwort und JEDE Anmeldung — und beides
 * gab es vorher nur zur Haelfte: keine Koepfe, und `secure` an einem von drei
 * Setzern. Ein Test, der die Werte liest, ist die einzige Form, in der eine
 * solche Zusage den naechsten Umbau ueberlebt.
 */
describe('SEC-A7 — die Sicherheitskoepfe', () => {
  const kopf = (name: string): string =>
    SICHERHEITSKOEPFE.find((k) => k.key === name)?.value ?? '';

  it('HSTS: ein Jahr, mit Unterdomaenen', () => {
    expect(kopf('Strict-Transport-Security')).toMatch(/max-age=31536000/u);
    expect(kopf('Strict-Transport-Security')).toContain('includeSubDomains');
  });

  it('kein Einbetten in fremde Seiten — X-Frame-Options UND frame-ancestors', () => {
    expect(kopf('X-Frame-Options')).toBe('DENY');
    expect(kopf('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('nosniff und eine Referrer-Richtlinie, die den Pfad nicht nach aussen traegt', () => {
    expect(kopf('X-Content-Type-Options')).toBe('nosniff');
    expect(kopf('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('Permissions-Policy: Kamera und Standort nur fuer die eigene Herkunft, Mikrofon fuer niemanden', () => {
    const p = kopf('Permissions-Policy');
    expect(p).toContain('camera=(self)');
    expect(p).toContain('geolocation=(self)');
    expect(p).toContain('microphone=()');
  });

  it('keine CSP mit unsafe-inline — sie saehe fertig aus und schuetzte nichts (O-359)', () => {
    expect(kopf('Content-Security-Policy')).not.toContain('unsafe-inline');
  });
});

describe('der Sitzungskeks — ein Satz Attribute fuer alle drei Setzer', () => {
  it('ist httpOnly, lax, auf / und lebt zwoelf Stunden', () => {
    const o = sitzungsKeksOptionen({ NODE_ENV: 'production' });
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe('lax');
    expect(o.path).toBe('/');
    expect(o.maxAge).toBe(SITZUNG_MAX_ALTER_SEK);
    expect(SITZUNG_MAX_ALTER_SEK).toBe(12 * 60 * 60);
  });

  it('ist in der Auslieferung `secure` — und nur dort', () => {
    expect(sitzungsKeksOptionen({ NODE_ENV: 'production' }).secure).toBe(true);
    // `http://localhost` und das Telefon im selben Netz bekaemen sonst keinen Keks.
    expect(sitzungsKeksOptionen({ NODE_ENV: 'development' }).secure).toBe(false);
    expect(sitzungsKeksOptionen({}).secure).toBe(false);
  });
});
