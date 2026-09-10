/**
 * Das Ursprungstor (CSRF) — und der Grund, warum `host` nicht reicht.
 *
 * Der erste Entwurf verglich `URL.host`. `host` ist Rechnername plus Port und
 * traegt das Schema nicht: eine Seite unter `http://` auf demselben Namen kam
 * damit durch das Tor einer `https`-Anfrage. Der Fall `http_gegen_https` faellt
 * ohne die Korrektur.
 */
import { describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { erwarteterUrsprung, istGleicherUrsprung } from '@/server/auth/ursprung';

/** Das Wenige, das `istGleicherUrsprung` von einer Anfrage anfasst. */
function anfrage(opts: {
  origin?: string | null;
  url: string;
  weitergeleitetesSchema?: string;
}): NextRequest {
  const koepfe = new Map<string, string>();
  if (opts.origin !== null && opts.origin !== undefined) koepfe.set('origin', opts.origin);
  if (opts.weitergeleitetesSchema !== undefined) {
    koepfe.set('x-forwarded-proto', opts.weitergeleitetesSchema);
  }
  const ziel = new URL(opts.url);
  return {
    headers: { get: (name: string) => koepfe.get(name.toLowerCase()) ?? null },
    nextUrl: { host: ziel.host, protocol: ziel.protocol },
  } as unknown as NextRequest;
}

describe('istGleicherUrsprung', () => {
  it('laesst den eigenen Ursprung durch', () => {
    expect(istGleicherUrsprung(anfrage({
      origin: 'https://cse.example', url: 'https://cse.example/api/angebot',
    }))).toBe(true);
  });

  it('http_gegen_https: weist ein fremdes Schema auf demselben Rechnernamen ab', () => {
    // Genau der Fall, den der `host`-Vergleich durchliess.
    expect(istGleicherUrsprung(anfrage({
      origin: 'http://cse.example', url: 'https://cse.example/api/angebot',
    }))).toBe(false);
  });

  it('weist einen fremden Rechnernamen ab', () => {
    expect(istGleicherUrsprung(anfrage({
      origin: 'https://boese.example', url: 'https://cse.example/api/angebot',
    }))).toBe(false);
  });

  it('weist einen abweichenden Port ab', () => {
    expect(istGleicherUrsprung(anfrage({
      origin: 'https://cse.example:8443', url: 'https://cse.example/api/angebot',
    }))).toBe(false);
  });

  it('ohne Origin-Kopf: nein — fail closed', () => {
    expect(istGleicherUrsprung(anfrage({
      origin: null, url: 'https://cse.example/api/angebot',
    }))).toBe(false);
  });

  it('weist einen unlesbaren Origin ab, statt zu werfen', () => {
    expect(istGleicherUrsprung(anfrage({
      origin: 'kein-ursprung', url: 'https://cse.example/api/angebot',
    }))).toBe(false);
  });

  it('"null" als Ursprung (sandboxed iframe, data:) kommt nicht durch', () => {
    expect(istGleicherUrsprung(anfrage({
      origin: 'null', url: 'https://cse.example/api/angebot',
    }))).toBe(false);
  });

  describe('hinter einem TLS-beendenden Proxy', () => {
    // Der Browser spricht https, die Anwendung sieht dahinter http. Ohne
    // x-forwarded-proto wuerde ein strenger Vergleich jede echte Anfrage
    // abweisen — das Tor waere zu, aber fuer die Falschen.
    it('nimmt das Schema aus x-forwarded-proto', () => {
      expect(istGleicherUrsprung(anfrage({
        origin: 'https://cse.example',
        url: 'http://cse.example/api/angebot',
        weitergeleitetesSchema: 'https',
      }))).toBe(true);
    });

    it('nimmt bei mehreren Proxys den aeussersten', () => {
      expect(istGleicherUrsprung(anfrage({
        origin: 'https://cse.example',
        url: 'http://cse.example/api/angebot',
        weitergeleitetesSchema: 'https, http',
      }))).toBe(true);
    });

    it('auch mit Proxy bleibt ein fremder Rechnername draussen', () => {
      expect(istGleicherUrsprung(anfrage({
        origin: 'https://boese.example',
        url: 'http://cse.example/api/angebot',
        weitergeleitetesSchema: 'https',
      }))).toBe(false);
    });
  });

  it('erwarteterUrsprung setzt Schema, Namen und Port zusammen', () => {
    expect(erwarteterUrsprung(anfrage({ url: 'https://cse.example:8443/x' })))
      .toBe('https://cse.example:8443');
  });
});
