/**
 * `POST /api/lead` — Anmeldung und Recht vor dem Fachfehler, und das 404 ist
 * das der übrigen Routen (AUT-06, D-656 Nr. 2, D-766, D-769 Nr. 7, D-772
 * Nr. 12, V-274).
 *
 * **Der Befund.** Der Zweig für den `CrmFehler` stand vor der Anmeldung, und
 * ein fehlendes Recht antwortete `{"fehler":"unbekannt"}` — jede andere
 * schreibende Route antwortet `{"fehler":"nicht_gefunden"}`. Ein Lead, den es
 * hier nicht gibt, antwortete ebenfalls `unbekannt`; beide Fälle waren gleich
 * und bleiben es, jetzt mit den Bytes der übrigen Routen.
 *
 * Geprüft: die ECHTE Route (ersetzt: Sitzung, Datenbank, Tor und der Dienst,
 * der die Aktivität festhält).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { LEAD_TEXTE } from '../../src/lib/i18n/verwaltung/crm-lead.js';
import { nichtGefundenAntwort } from '../../src/server/auth/antwort.js';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';
import { gruendeAb } from './hilfen/gruende.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  halte: vi.fn(),
  /** Gibt es den Lead? Die Route fragt am Ende `select id from lead where id = $1`. */
  leadDa: true,
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({
      abfrage: (sql: string) => Promise.resolve(
        /select id from lead/u.test(sql) && zustand.leadDa ? [{ id: 'x' }] : []),
    }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/crm/lead-kontakt', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  halteLeadAktivitaetFest: zustand.halte,
}));

const { CrmFehler } = await import('../../src/server/services/crm/anlegen.js');
const { POST } = await import('../../src/app/api/lead/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const LEAD = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const BLATT = `/portal/reinigung/crm/leads/${LEAD}`;
const ROUTE = 'src/app/api/lead/route.ts';

function anfrage(
  felder: Record<string, string>, kopf: Record<string, string> = {}, origin = HIER,
): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL('/api/lead?mandant=reinigung', HIER), {
    method: 'POST', body: daten,
    headers: new Headers({ host: 'localhost:3001', origin, referer: `${HIER}${BLATT}`, ...kopf }),
  });
}
const FORMULAR = { accept: 'text/html' };
const NOTIZ = { leadId: LEAD, typ: 'anruf', inhalt: 'Rückruf vereinbart', richtung: 'ausgehend' };

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.authorize.mockReset();
  zustand.halte.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
  zustand.leadDa = true;
});

describe('POST /api/lead — ein fehlendes Recht ist die byte-gleiche 404', () => {
  it('für ein Programm und hinter einem Formular dieselben Bytes wie jede andere Route', async () => {
    const erwartet = await nichtGefundenAntwort().text();
    expect(erwartet).toBe('{"fehler":"nicht_gefunden"}');
    for (const kopf of [{}, FORMULAR]) {
      zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht crm.schreiben fehlt'));
      const r = await POST(anfrage(NOTIZ, kopf));
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(erwartet);
    }
    expect(zustand.halte).not.toHaveBeenCalled();
  });

  it('ein Lead, den es hier nicht gibt, antwortet mit denselben Bytes — „gibt es nicht" = „darf nicht"', async () => {
    zustand.leadDa = false;
    const nicht = await POST(anfrage({ leadId: LEAD, naechsteAktion: 'Anrufen' }));
    zustand.leadDa = true;
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht crm.schreiben fehlt'));
    const darfNicht = await POST(anfrage({ leadId: LEAD, naechsteAktion: 'Anrufen' }));
    expect(nicht.status).toBe(404);
    expect(await nicht.text()).toBe(await darfNicht.text());
  });
});

describe('POST /api/lead — ohne Sitzung die Anmeldung, ohne Faktor der Faktor-Schritt', () => {
  it('ohne Sitzung: ein Formular kommt zur Anmeldung, ein Programm bekommt JSON wie bisher', async () => {
    zustand.sitzung = null;
    const f = await POST(anfrage(NOTIZ, FORMULAR));
    expect(f.status).toBe(303);
    expect(f.headers.get('location')).toContain('/auth/login');
    const p = await POST(anfrage(NOTIZ));
    expect(p.status).toBe(401);
    expect(await p.json()).toEqual({ fehler: 'keine_sitzung' });
  });

  it('eine Sitzung, die unterwegs endet, ebenso — nicht der Rückweg aufs Leadblatt', async () => {
    zustand.authorize.mockRejectedValue(new NichtAngemeldetFehler());
    const f = await POST(anfrage(NOTIZ, FORMULAR));
    expect(f.status).toBe(303);
    expect(f.headers.get('location')).toContain('/auth/login');
    expect(f.headers.get('location')).not.toContain('fehler=');
    const p = await POST(anfrage(NOTIZ));
    expect(p.status).toBe(401);
    expect(await p.json()).toEqual({ fehler: 'keine_sitzung' });
  });

  it('ohne zweiten Faktor: der Faktor-Schritt, für ein Programm JSON', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const f = await POST(anfrage(NOTIZ, FORMULAR));
    expect(f.status).toBe(303);
    expect(f.headers.get('location')).toContain('/auth/zwei-faktor/einrichten');
    expect(f.headers.get('location')).not.toContain('fehler=');
    const p = await POST(anfrage(NOTIZ));
    expect(p.status).toBe(403);
    expect(await p.json()).toEqual({ fehler: 'zweiter_faktor' });
    expect(zustand.halte).not.toHaveBeenCalled();
  });

  it('im Quelltext steht die Übersetzung der Anmeldung vor dem Zweig des Fachfehlers', () => {
    const quelle = readFileSync(resolve(WURZEL, ROUTE), 'utf8');
    const fang = quelle.slice(quelle.indexOf('} catch (fehler) {'));
    expect(fang.indexOf('autorisierungsAntwort(fehler, anfrage)')).toBeGreaterThan(0);
    expect(fang.indexOf('autorisierungsAntwort(fehler, anfrage)'))
      .toBeLessThan(fang.indexOf('instanceof CrmFehler'));
    expect(quelle).not.toContain("fehler: 'unbekannt'");
  });
});

describe('POST /api/lead — der Fachfehler als Grund, der Erfolg und JSON wie bisher', () => {
  const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);
  const GRUENDE = [...gruendeAb({ datei: ROUTE, funktion: 'POST' }, ['CrmFehler'], lies, WURZEL).gruende].sort();

  it.each(GRUENDE)('%s → 303 aufs Leadblatt mit dem Schlüssel, ohne Satz', async (g) => {
    zustand.halte.mockRejectedValue(new CrmFehler(`Satz des Dienstes zu ${LEAD}`, g as never));
    const r = await POST(anfrage(NOTIZ, FORMULAR));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?fehler=${g}`);
  });

  it('jeder Grund der Route hat auf dem Leadblatt einen Satz — deutsch und englisch', () => {
    expect(GRUENDE.length).toBeGreaterThanOrEqual(5);
    for (const s of ['de', 'en'] as const) {
      for (const g of GRUENDE) expect(eigenerEintrag(LEAD_TEXTE[s].fehler, g), `${s}.${g}`).toBeTruthy();
    }
  });

  it('der Erfolg führt aufs Leadblatt', async () => {
    const r = await POST(anfrage(NOTIZ, FORMULAR));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}`);
    expect(zustand.halte).toHaveBeenCalledOnce();
  });

  it('JSON wie bisher: fremder Ursprung, fehlender Lead, unbekannte Art', async () => {
    const fremd = await POST(anfrage(NOTIZ, {}, 'https://boese.example'));
    expect(fremd.status).toBe(403);
    expect(await fremd.json()).toEqual({ fehler: 'fremder_ursprung' });
    const ohne = await POST(anfrage({ inhalt: 'x' }));
    expect(ohne.status).toBe(400);
    expect(await ohne.json()).toEqual({ fehler: 'unvollstaendig' });
    const art = await POST(anfrage({ leadId: LEAD, typ: 'brieftaube' }));
    expect(art.status).toBe(400);
    expect(await art.json()).toEqual({ fehler: 'typ' });
  });

  it('ein unbekannter Fehler bleibt ein Fehler', async () => {
    zustand.halte.mockRejectedValue(new Error('Verbindung verloren'));
    await expect(POST(anfrage(NOTIZ, FORMULAR))).rejects.toThrow('Verbindung verloren');
  });
});
