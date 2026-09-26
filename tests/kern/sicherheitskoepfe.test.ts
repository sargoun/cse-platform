import { describe, expect, it } from 'vitest';
import { MARKENBILD_KOEPFE, SICHERHEITSKOEPFE } from '../../src/lib/sicherheitskoepfe.js';
import {
  ALT_SITZUNG_COOKIE, sitzungsKeksName, sitzungsKeksOptionen, SITZUNG_MAX_ALTER_SEK,
} from '../../src/server/auth/sitzung.js';
import konfiguration from '../../next.config.js';

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

  it('HSTS: zwei Jahre, Unterdomaenen, preload — der Wert aus 03-AUTH §4.1 und 05-API-KARTE §B.14', () => {
    expect(kopf('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains; preload');
  });

  /**
   * Die Konstante allein beweist nichts ueber die Auslieferung. Erst die
   * Verdrahtung in `next.config.ts` haengt sie an jede Antwort — und genau
   * die konnte bisher entfernt oder falsch gematcht werden, ohne dass hier
   * etwas rot wurde (Befund der Durchsicht, PR 10). `tests/e2e/headers.spec.ts`
   * prueft dazu die ECHTEN Antworten.
   */
  it('next.config.ts haengt GENAU diese Koepfe an jede Route', async () => {
    const regeln = await konfiguration.headers!();
    expect(regeln).toHaveLength(2);
    expect(regeln[0]!.source).toBe('/(.*)');
    expect(regeln[0]!.headers).toEqual(SICHERHEITSKOEPFE);
  });

  it('die Markenbilder bekommen danach eine strengere Richtlinie — sandbox, kein Skript (V-100)', async () => {
    /*
     * Gefunden in der Live-Prüfung gegen den Produktionsbau: die Route setzte
     * die Richtlinie selbst, und die allgemeine Regel überschrieb sie. Die
     * zweite Regel muss NACH der ersten stehen — Next.js lässt die spätere
     * gewinnen.
     */
    const regeln = await konfiguration.headers!();
    expect(regeln[1]!.source).toBe('/api/marke/:pfad*');
    expect(regeln[1]!.headers).toEqual(MARKENBILD_KOEPFE);
    const csp = MARKENBILD_KOEPFE.find((k) => k.key === 'Content-Security-Policy')!.value;
    expect(csp).toContain('sandbox');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src/u);
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

  it('heisst in der Auslieferung `__Host-cse_sitzung` (03-AUTH §4.1) — und in der Entwicklung nicht', () => {
    expect(sitzungsKeksName({ NODE_ENV: 'production' })).toBe('__Host-cse_sitzung');
    // Ohne `Secure` gibt es keinen `__Host-`-Keks; das Telefon im Heimnetz
    // (D-414) bekaeme sonst keinen.
    expect(sitzungsKeksName({ NODE_ENV: 'development' })).toBe(ALT_SITZUNG_COOKIE);
    expect(ALT_SITZUNG_COOKIE).toBe('cse_sitzung');
  });

  it('ist in der Auslieferung `secure` — und nur dort', () => {
    expect(sitzungsKeksOptionen({ NODE_ENV: 'production' }).secure).toBe(true);
    // `http://localhost` und das Telefon im selben Netz bekaemen sonst keinen Keks.
    expect(sitzungsKeksOptionen({ NODE_ENV: 'development' }).secure).toBe(false);
    expect(sitzungsKeksOptionen({}).secure).toBe(false);
  });
});
