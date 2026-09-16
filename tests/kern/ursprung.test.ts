/**
 * Das Ursprungstor (CSRF) — und die zwei Befunde, die es geformt haben.
 *
 * **Erstens:** der erste Entwurf verglich `URL.host`. `host` ist Rechnername
 * plus Port und traegt das Schema nicht: eine Seite unter `http://` auf
 * demselben Namen kam damit durch das Tor einer `https`-Anfrage. Der Fall
 * `http_gegen_https` faellt ohne die Korrektur.
 *
 * **Zweitens — und das hat diese Datei selbst verdeckt:** die Hilfsfunktion
 * unten baute `nextUrl` AUS DER ANGEFRAGTEN ADRESSE. Damit war `nextUrl.host`
 * in jedem Fall genau das, was der Browser angesprochen hatte — eine Welt, in
 * der der Fehler nicht existieren kann.
 *
 * In der Wirklichkeit traegt `NextRequest.nextUrl` die Adresse, unter der der
 * SERVER laeuft (`localhost:3000`), unabhaengig vom `Host`-Kopf. Jeder
 * schreibende Weg — 77 Routen — antwortete deshalb 403, sobald jemand die
 * Plattform unter einer anderen Adresse aufrief als der, unter der der Server
 * gestartet wurde: ueber die LAN-Adresse am Telefon, hinter einem Proxy, unter
 * der spaeteren Produktionsdomain.
 *
 * Die Hilfsfunktion nimmt die beiden deshalb jetzt GETRENNT: `wirt` ist, was
 * der Browser geschickt hat, `serverUnter` ist, wo der Server laeuft. Sie
 * duerfen auseinandergehen, und in den meisten Faellen hier tun sie das.
 */
import { describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { erwarteterUrsprung, istGleicherUrsprung } from '@/server/auth/ursprung';

/** Das Wenige, das `istGleicherUrsprung` von einer Anfrage anfasst. */
function anfrage(opts: {
  origin?: string | null;
  /** Die Adresse, die der BROWSER angesprochen hat — der `Host`-Kopf. */
  url: string;
  /** Wo der Server wirklich laeuft. Vorgabe: die Wirklichkeit, nicht `url`. */
  serverUnter?: string;
  weitergeleitetesSchema?: string;
  /** Kein `Host`-Kopf — HTTP/1.0 oder ein Werkzeug ohne Koepfe. */
  ohneWirt?: boolean;
}): NextRequest {
  const koepfe = new Map<string, string>();
  const ziel = new URL(opts.url);
  if (opts.origin !== null && opts.origin !== undefined) koepfe.set('origin', opts.origin);
  if (opts.ohneWirt !== true) koepfe.set('host', ziel.host);
  if (opts.weitergeleitetesSchema !== undefined) {
    koepfe.set('x-forwarded-proto', opts.weitergeleitetesSchema);
  }
  const server = new URL(opts.serverUnter ?? 'http://localhost:3000');
  return {
    headers: { get: (name: string) => koepfe.get(name.toLowerCase()) ?? null },
    nextUrl: { host: server.host, protocol: ziel.protocol },
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

describe('der Server laeuft woanders, als der Browser ihn anspricht', () => {
  /**
   * **Der Befund aus dem Betrieb.** Am Telefon unter `http://192.168.0.193`
   * angemeldet, Sprache umgestellt, gespeichert — und auf dem Bildschirm stand
   * `{"fehler":"fremder_ursprung"}`. Der Server lief unter `localhost:3000`,
   * und `nextUrl.host` sagt genau das, egal welchen `Host` der Browser schickt.
   *
   * Am laufenden Server nachgemessen: mit `Host: 192.168.0.193` und
   * `Origin: http://192.168.0.193` kam 403; mit demselben `Host` und
   * `Origin: http://localhost:3000` ging dieselbe Anfrage durch. Das ist der
   * Beweis, dass verglichen wurde, wo der SERVER liegt — und nicht, was der
   * BROWSER angesprochen hat.
   */
  it('die LAN-Adresse am Telefon kommt durch — der Fall, der 403 gab', () => {
    expect(istGleicherUrsprung(anfrage({
      origin: 'http://192.168.0.193',
      url: 'http://192.168.0.193/api/konto/sprache',
      serverUnter: 'http://localhost:3000',
    }))).toBe(true);
  });

  it('und eine Produktionsdomain hinter einem Proxy ebenso', () => {
    expect(istGleicherUrsprung(anfrage({
      origin: 'https://portal.cse-gruppe.de',
      url: 'https://portal.cse-gruppe.de/api/zeit/korrektur',
      serverUnter: 'http://localhost:3000',
      weitergeleitetesSchema: 'https',
    }))).toBe(true);
  });

  it('eine fremde Seite bleibt draussen, auch unter der LAN-Adresse', () => {
    // Der Kern: der Browser des Opfers setzt `Host` aus der besuchten Adresse
    // und `Origin` aus der Seite, die das Formular schickt. Sie gehen genau
    // dann auseinander, wenn es ein Angriff ist.
    expect(istGleicherUrsprung(anfrage({
      origin: 'http://boese.example',
      url: 'http://192.168.0.193/api/konto/sprache',
      serverUnter: 'http://localhost:3000',
    }))).toBe(false);
  });

  it('ohne `Host`-Kopf faellt es auf die Serveradresse zurueck', () => {
    // Keine Anfrage eines Browsers — und sie scheitert ohnehin am Origin.
    expect(erwarteterUrsprung(anfrage({
      url: 'http://192.168.0.193/x', serverUnter: 'http://localhost:3000', ohneWirt: true,
    }))).toBe('http://localhost:3000');
  });

  it('der Standardport faellt weg — `https://x:443` ist `https://x`', () => {
    /*
     * Der Browser schickt im `Origin` immer die kurze Form. Von Hand
     * zusammengesetzt waeren die beiden verschieden, und ein Aufruf hinter
     * einem Proxy, der den Port im `Host` stehen laesst, faellt durch.
     */
    expect(istGleicherUrsprung(anfrage({
      origin: 'https://cse.example',
      url: 'https://cse.example:443/api/angebot',
      weitergeleitetesSchema: 'https',
    }))).toBe(true);
  });
});

describe('CSE_VERTRAUTE_URSPRUENGE — fuer einen Proxy, der `Host` umschreibt', () => {
  it('ein ausdruecklich genannter Ursprung kommt durch', () => {
    process.env['CSE_VERTRAUTE_URSPRUENGE'] = 'https://portal.cse-gruppe.de, http://10.0.0.5';
    try {
      expect(istGleicherUrsprung(anfrage({
        origin: 'https://portal.cse-gruppe.de',
        url: 'http://localhost:3001/api/konto/sprache',
        serverUnter: 'http://localhost:3001',
      }))).toBe(true);
      expect(istGleicherUrsprung(anfrage({
        origin: 'http://10.0.0.5',
        url: 'http://localhost:3001/api/konto/sprache',
        serverUnter: 'http://localhost:3001',
      }))).toBe(true);
    } finally {
      delete process.env['CSE_VERTRAUTE_URSPRUENGE'];
    }
  });

  it('ein NICHT genannter bleibt draussen — die Liste ist eine Liste', () => {
    process.env['CSE_VERTRAUTE_URSPRUENGE'] = 'https://portal.cse-gruppe.de';
    try {
      expect(istGleicherUrsprung(anfrage({
        origin: 'https://boese.example',
        url: 'http://localhost:3001/api/konto/sprache',
        serverUnter: 'http://localhost:3001',
      }))).toBe(false);
    } finally {
      delete process.env['CSE_VERTRAUTE_URSPRUENGE'];
    }
  });

  it('leer ist die Vorgabe und erlaubt nichts zusaetzlich', () => {
    delete process.env['CSE_VERTRAUTE_URSPRUENGE'];
    expect(istGleicherUrsprung(anfrage({
      origin: 'https://portal.cse-gruppe.de',
      url: 'http://localhost:3001/x',
      serverUnter: 'http://localhost:3001',
    }))).toBe(false);
  });
});
