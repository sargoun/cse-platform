/**
 * `POST /api/crm/nachrichten` — Anmeldung und Recht vor den Fachfehlern
 * (D-766, D-769 Nr. 7, D-772 Nr. 13, V-274, AUT-06).
 *
 * **Der Befund.** Die Zweige für `NachrichtFehler`, `RechtsgrundlageFehlt`
 * und `FreigabeErforderlich` standen vor `autorisierungsAntwort`. Heute fängt
 * keiner von ihnen einen Wurf der Anmeldung; die Reihenfolge ist trotzdem die
 * aller Routen, und diese Datei hält sie fest.
 *
 * Geprüft: die ECHTE Route (ersetzt: Sitzung, Datenbank, Tor und der Dienst,
 * der die Nachricht schreibt).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';
import { gruendeAb } from './hilfen/gruende.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  schreibe: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/crm/nachricht-an-kontakt', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  schreibeAnKontakt: zustand.schreibe,
}));

const { NachrichtFehler } = await import('../../src/server/services/crm/nachricht-an-kontakt.js');
const { RechtsgrundlageFehlt, FreigabeErforderlich } = await import('../../src/server/agent/policy.js');
const { POST } = await import('../../src/app/api/crm/nachrichten/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);
const ROUTE = 'src/app/api/crm/nachrichten/route.ts';
const SEITE = 'src/app/portal/[mandant]/crm/kontakte/[id]/page.tsx';
const HIER = 'http://localhost:3001';
const KONTAKT = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const BLATT = `/portal/reinigung/crm/kontakte/${KONTAKT}`;
const FORMULAR = { accept: 'text/html' };
const NACHRICHT = {
  ansprechpartner: KONTAKT, kanal: 'email', zweck: 'vertraglich',
  betreff: 'Reinigungsplan', text: 'Guten Tag, anbei der Plan.', zurueck: BLATT,
};

function anfrage(
  felder: Record<string, string>, kopf: Record<string, string> = {}, origin = HIER,
): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL('/api/crm/nachrichten', HIER), {
    method: 'POST', body: daten,
    headers: new Headers({ host: 'localhost:3001', origin, referer: `${HIER}${BLATT}`, ...kopf }),
  });
}

/** Die Schlüssel, die die Route zurückschickt: die Gründe des Dienstes und ihre eigenen Wörter. */
const DIENST = [...gruendeAb({ datei: ROUTE, funktion: 'POST' }, ['NachrichtFehler'], lies, WURZEL).gruende];
const EIGENE = [...(lies(resolve(WURZEL, ROUTE)) ?? '').matchAll(/zurueck\('(\w+)'\)/gu)].map((m) => m[1] ?? '');

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.authorize.mockReset();
  zustand.schreibe.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
  zustand.schreibe.mockResolvedValue('freigabe-1');
});

describe('POST /api/crm/nachrichten — Anmeldung und Recht vor den Fachfehlern', () => {
  it('ein fehlendes Recht ist die byte-gleiche 404 — auch hinter einem Formular', async () => {
    const erwartet = await nichtGefundenAntwort().text();
    for (const kopf of [{}, FORMULAR]) {
      zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht crm.kommunikation_versenden fehlt'));
      const r = await POST(anfrage(NACHRICHT, kopf));
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(erwartet);
    }
    expect(zustand.schreibe).not.toHaveBeenCalled();
  });

  it('ohne Sitzung die Anmeldung — auch wenn sie unterwegs endet; ein Programm bekommt JSON', async () => {
    zustand.sitzung = null;
    const vorher = await POST(anfrage(NACHRICHT, FORMULAR));
    expect(vorher.headers.get('location')).toContain('/auth/login');
    zustand.sitzung = {
      benutzerId: '00000000-0000-4000-8000-000000000001',
      aktiverMandantId: '00000000-0000-4000-8000-000000000002',
      personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
      sitzungId: '00000000-0000-4000-8000-000000000003',
    };
    zustand.authorize.mockRejectedValue(new NichtAngemeldetFehler());
    const unterwegs = await POST(anfrage(NACHRICHT, FORMULAR));
    expect(unterwegs.status).toBe(303);
    expect(unterwegs.headers.get('location')).toContain('/auth/login');
    expect(unterwegs.headers.get('location')).not.toContain('fehler=');
    const programm = await POST(anfrage(NACHRICHT));
    expect(programm.status).toBe(401);
    expect(await programm.json()).toEqual({ fehler: 'keine_sitzung' });
  });

  it('ohne zweiten Faktor der Faktor-Schritt, für ein Programm JSON', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const f = await POST(anfrage(NACHRICHT, FORMULAR));
    expect(f.status).toBe(303);
    expect(f.headers.get('location')).toContain('/auth/zwei-faktor/einrichten');
    expect(f.headers.get('location')).not.toContain('fehler=');
    const p = await POST(anfrage(NACHRICHT));
    expect(p.status).toBe(403);
    expect(await p.json()).toEqual({ fehler: 'zweiter_faktor' });
    expect(zustand.schreibe).not.toHaveBeenCalled();
  });

  it('im Quelltext steht die Übersetzung der Anmeldung vor jedem Zweig eines Fachfehlers', () => {
    const quelle = lies(resolve(WURZEL, ROUTE)) ?? '';
    const fang = quelle.slice(quelle.indexOf('} catch (fehler: unknown) {'));
    const zuerst = fang.indexOf('autorisierungsAntwort(fehler, anfrage)');
    expect(zuerst).toBeGreaterThan(0);
    for (const klasse of ['NachrichtFehler', 'RechtsgrundlageFehlt', 'FreigabeErforderlich']) {
      expect(zuerst, klasse).toBeLessThan(fang.indexOf(`instanceof ${klasse}`));
    }
  });
});

describe('POST /api/crm/nachrichten — die Fachfehler als Schlüssel, wie bisher', () => {
  it('die Gründe des Dienstes (am Quelltext gelesen) und die eigenen Wörter der Route', () => {
    expect(DIENST.sort()).toEqual(['kein_kontakt', 'kein_text', 'keine_grundlage', 'nicht_verbunden', 'ungueltig']);
    expect(EIGENE.sort()).toEqual(['freigabe', 'keine_grundlage', 'ungueltig']);
  });

  it.each(DIENST)('NachrichtFehler %s → 303 aufs Kontaktblatt, `?fehler=` und `#senden`', async (g) => {
    zustand.schreibe.mockRejectedValue(new NachrichtFehler('Satz des Dienstes', g as never));
    const r = await POST(anfrage(NACHRICHT, FORMULAR));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=${g}#senden`);
  });

  it('das harte Tor und die Freigabe — ihre eigenen Schlüssel', async () => {
    zustand.schreibe.mockRejectedValue(new RechtsgrundlageFehlt());
    expect((await POST(anfrage(NACHRICHT, FORMULAR))).headers.get('location'))
      .toBe(`${HIER}${BLATT}?fehler=keine_grundlage#senden`);
    zustand.schreibe.mockRejectedValue(new FreigabeErforderlich('email_senden' as never, 'passt nicht'));
    expect((await POST(anfrage(NACHRICHT, FORMULAR))).headers.get('location'))
      .toBe(`${HIER}${BLATT}?fehler=freigabe#senden`);
  });

  it('eine unbrauchbare Angabe, der Erfolg, ein fremder Ursprung, ein unbekannter Fehler', async () => {
    const ungueltig = await POST(anfrage({ ...NACHRICHT, kanal: 'brieftaube' }, FORMULAR));
    expect(ungueltig.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=ungueltig#senden`);
    const gesendet = await POST(anfrage(NACHRICHT, FORMULAR));
    expect(gesendet.headers.get('location')).toBe(`${HIER}${BLATT}?gesendet=1#senden`);
    const fremd = await POST(anfrage(NACHRICHT, {}, 'https://boese.example'));
    expect(fremd.status).toBe(403);
    expect(await fremd.json()).toEqual({ fehler: 'fremder_ursprung' });
    zustand.schreibe.mockRejectedValue(new Error('Verbindung verloren'));
    await expect(POST(anfrage(NACHRICHT, FORMULAR))).rejects.toThrow('Verbindung verloren');
  });

  it('jeder Schlüssel hat auf dem Kontaktblatt einen Satz', () => {
    const seite = lies(resolve(WURZEL, SEITE)) ?? '';
    const tabelle = seite.slice(seite.indexOf('const SENDE_FEHLER'), seite.indexOf('};', seite.indexOf('const SENDE_FEHLER')));
    for (const g of new Set([...DIENST, ...EIGENE])) expect(tabelle, g).toMatch(new RegExp(`\\n\\s+${g}:`, 'u'));
  });
});
