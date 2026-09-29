/**
 * `POST /api/crm/lead` kehrt nur mit dem GRUND zurück (`?fehler=`) — der Satz
 * des Dienstes reist nicht mehr mit —, und „Neuer Lead", das Leadblatt und
 * die Bekanntmachung im Radar schlagen ihn nach (D-769, D-772, V-274).
 *
 * **Der Befund.** Die Route schickte `?meldung=<Satz>&fehler=<grund>` —
 * „der Satz bleibt der Rückfall für Seiten, die nur `meldung` lesen". Seit
 * V-250 las ihn keine Seite mehr als Text; „Neuer Lead" und das Leadblatt
 * nahmen ihn nur noch als Zeichen, DASS abgewiesen wurde. Er stand also
 * allein in der Adresse, deutsch, mit der Leadnummer darin
 * (`schon_uebernommen`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { KETTE_TEXTE } from '../../src/lib/i18n/verwaltung/crm-kette.js';
import { LEAD_TEXTE } from '../../src/lib/i18n/verwaltung/crm-lead.js';
import { NichtGefundenFehler, ZweiterFaktorFehler } from '../../src/server/auth/fehler.js';
import { gruendeAb } from './hilfen/gruende.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  legeLeadAn: vi.fn(),
  legeLeadKontaktAn: vi.fn(),
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
vi.mock('@/server/services/crm/anlegen', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legeLeadAn: zustand.legeLeadAn,
}));
vi.mock('@/server/services/crm/lead-kontakt', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  legeLeadKontaktAn: zustand.legeLeadKontaktAn,
}));

const { CrmFehler } = await import('../../src/server/services/crm/anlegen.js');
const { POST } = await import('../../src/app/api/crm/lead/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);
const quelle = (d: string): string => readFileSync(resolve(WURZEL, d), 'utf8');
const HIER = 'http://localhost:3001';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const NEU = '/portal/reinigung/crm/leads/neu';
const BLATT = `/portal/reinigung/crm/leads/${ID}`;
const P = 'src/app/portal/[mandant]';
const SATZ = `Diese Bekanntmachung ist schon als Lead L-2026-0042 übernommen (${ID}).`;

function gruende(datei: string, funktion: string): readonly string[] {
  const fund = gruendeAb({ datei, funktion }, ['CrmFehler'], lies, WURZEL);
  if (fund.offen.length > 0) throw new Error(`${datei}#${funktion}: ${fund.offen.join(', ')}`);
  return [...fund.gruende].sort();
}

function formular(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL('/api/crm/lead', HIER), {
    method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  for (const f of [zustand.authorize, zustand.legeLeadAn, zustand.legeLeadKontaktAn]) f.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
  zustand.legeLeadAn.mockResolvedValue({ id: ID, leadnummer: 'L-1' });
});

const ALLE = gruende('src/app/api/crm/lead/route.ts', 'POST');

describe('POST /api/crm/lead — der Rückweg trägt nur den Grund', () => {
  it('die Route kann diese Gründe schicken (am Quelltext gelesen)', () => {
    expect(ALLE).toEqual(expect.arrayContaining(
      ['ohne_namen', 'schon_uebernommen', 'kontakt_fremd', 'verlust_ohne_grund']));
  });

  it.each(ALLE)('%s → 303 auf `zurueck?fehler=…` — ohne Satz, ohne Kennung, ohne Nummer', async (g) => {
    zustand.legeLeadAn.mockRejectedValue(new CrmFehler(SATZ, g as never));
    const r = await POST(formular({ betreff: 'Anruf', zurueck: NEU }));
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${NEU}?fehler=${g}`);
    expect(ort).not.toContain('meldung=');
    expect(ort).not.toContain(ID);
    expect(ort).not.toContain('L-2026');
  });

  it('`&`, wenn das Blatt schon eine Abfrage trägt; nie aus dem Portal hinaus', async () => {
    zustand.legeLeadAn.mockRejectedValue(new CrmFehler(SATZ, 'ohne_namen'));
    const r = await POST(formular({ betreff: 'x', zurueck: `${NEU}?von=radar` }));
    expect(r.headers.get('location')).toBe(`${HIER}${NEU}?von=radar&fehler=ohne_namen`);
    const fremd = await POST(formular({ betreff: 'x', zurueck: 'https://fremd.example/x' }));
    expect(new URL(fremd.headers.get('location') ?? '').origin).toBe(HIER);
  });

  it('der Erfolg bleibt, wie er war — auch die Auskunft `?hinweis=kontakt_vorhanden`', async () => {
    const r = await POST(formular({ betreff: 'Anruf', firmaName: 'X', zurueck: NEU }));
    expect(r.headers.get('location')).toBe(`${HIER}/portal/reinigung/crm/leads/${ID}`);
    zustand.legeLeadKontaktAn.mockResolvedValue({ vorhanden: true });
    const k = await POST(formular({ was: 'kontakt_anlegen', id: ID, nachname: 'B', zurueck: BLATT }));
    expect(k.headers.get('location')).toBe(`${HIER}${BLATT}?hinweis=kontakt_vorhanden`);
  });

  it('ein fehlendes Recht ist die byte-gleiche 404, ohne zweiten Faktor der Faktor-Schritt', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht crm.schreiben fehlt'));
    const r = await POST(formular({ betreff: 'x', zurueck: NEU }, { accept: 'text/html' }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'nicht_gefunden' });
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const f = await POST(formular({ betreff: 'x', zurueck: NEU }, { accept: 'text/html' }));
    expect(f.headers.get('location')).toContain('/auth/zwei-faktor/einrichten');
    expect(zustand.legeLeadAn).not.toHaveBeenCalled();
  });

  it('ein unbekannter Fehler bleibt ein Fehler; ein Programm bekommt JSON wie bisher', async () => {
    zustand.legeLeadAn.mockRejectedValue(new RangeError('kaputt'));
    await expect(POST(formular({ betreff: 'x', zurueck: NEU }))).rejects.toThrow(RangeError);
    const fremd = await POST(formular({ zurueck: NEU }, { origin: 'https://fremd.example' }));
    expect(fremd.status).toBe(403);
    expect(await fremd.json()).toEqual({ fehler: 'fremder_ursprung' });
  });
});

describe('die drei Seiten haben für jeden Grund ihrer Formulare einen Satz — de und en', () => {
  const satz = (s: 'de' | 'en', g: string): string | undefined =>
    eigenerEintrag(LEAD_TEXTE[s].kontaktFehler, g) ?? eigenerEintrag(KETTE_TEXTE[s].fehler, g)
    ?? eigenerEintrag(LEAD_TEXTE[s].fehler, g);

  it('„Neuer Lead": jeder Grund von legeLeadAn steht in der Kette', () => {
    const liste = gruende('src/server/services/crm/anlegen.ts', 'legeLeadAn');
    expect(liste).toContain('ohne_namen');
    for (const s of ['de', 'en'] as const) {
      for (const g of liste) expect(eigenerEintrag(KETTE_TEXTE[s].fehler, g), `${s}.${g}`).toBeTruthy();
    }
    /* Der Satz, den der Browsertest (crm-anlegen.spec.ts) erwartet. */
    expect(KETTE_TEXTE.de.fehler['ohne_namen']).toContain('Namen');
  });

  it('Leadblatt: jeder Grund seiner Formulare steht am Kontakt, in der Kette oder beim Schritt', () => {
    /*
     * `uebernehmeLeadAlsKunde` legt den Kunden mit der Grundlage „keine" an —
     * `grundlage_ohne_quelle` aus `legeKundeAn` ist dort unerreichbar. Die
     * Lesehilfe sieht das nicht; die Bedingung steht deshalb hier.
     */
    expect(quelle('src/server/services/crm/lead-kette.ts')).toContain("rechtsgrundlage: 'keine'");
    const liste = [
      ...gruende('src/server/services/crm/lead-kette.ts', 'uebernehmeLeadAlsKunde'),
      ...gruende('src/server/services/crm/lead-kette.ts', 'ordneLeadKundeZu'),
      ...gruende('src/server/services/crm/lead-kontakt.ts', 'waehleLeadKontakt'),
      ...gruende('src/server/services/crm/lead-kontakt.ts', 'legeLeadKontaktAn'),
      ...gruende('src/server/services/crm/anlegen.ts', 'setzeLeadPflege'),
      ...gruende('src/server/services/crm/anlegen.ts', 'setzeLeadStatus'),
    ].filter((g) => g !== 'grundlage_ohne_quelle');
    expect(liste).toEqual(expect.arrayContaining(['lead_hat_kunde', 'kontakt_ausgeschieden']));
    for (const s of ['de', 'en'] as const) {
      for (const g of liste) expect(satz(s, g), `${s}.${g}`).toBeTruthy();
    }
  });

  it('Radar: jeder Grund der Übernahme steht in der Kette', () => {
    const liste = gruende('src/server/services/crm/lead-radar.ts', 'uebernimmAusschreibungAlsLead');
    expect(liste).toEqual(expect.arrayContaining(['schon_uebernommen', 'ohne_auftraggeber']));
    for (const s of ['de', 'en'] as const) {
      for (const g of liste) expect(eigenerEintrag(KETTE_TEXTE[s].fehler, g), `${s}.${g}`).toBeTruthy();
    }
    /* Kein Satz der Kette trägt eine Nummer oder Kennung — die Leadnummer reiste im Satz der Route. */
    for (const t of Object.values(KETTE_TEXTE.de.fehler)) expect(t).not.toMatch(/L-\d|[0-9a-f]{8}-/u);
  });

  it('ein fremder Schlüssel ist in keiner Tabelle — die Seiten fallen auf ihren allgemeinen Satz', () => {
    for (const s of ['de', 'en'] as const) {
      for (const k of ['__proto__', 'constructor', 'toString', 'Ein Lead braucht einen Namen.']) {
        expect(satz(s, k), `${s}.${k}`).toBeUndefined();
      }
      expect(KETTE_TEXTE[s].nichtAngelegt.trim()).not.toBe('');
      expect(LEAD_TEXTE[s].nichtGespeichert.trim()).not.toBe('');
    }
  });

  it.each([
    [`${P}/crm/leads/neu/page.tsx`, ['lead-meldung']],
    [`${P}/crm/leads/[id]/page.tsx`, ['lead-kontakt-fehler', 'lead-kette-fehler', 'lead-fehler']],
    [`${P}/radar/[id]/page.tsx`, ['radar-lead-fehler']],
  ])('%s liest `meldung` nicht mehr, und seine Warnkästen werden angesagt', (seite, kaesten) => {
    const s = quelle(seite);
    expect(s).not.toMatch(/suche\.meldung|suche\['meldung'\]|meldung\?: string/u);
    for (const cse of kaesten) {
      expect(s, cse).toMatch(new RegExp(`<Hinweis art="warnung" rolle="alert" cse="${cse}"`, 'u'));
    }
  });

  it('das Leadblatt sagt auch die Auskunft `kontakt_vorhanden` an (rolle="status")', () => {
    expect(quelle(`${P}/crm/leads/[id]/page.tsx`))
      .toMatch(/<Hinweis art="hinweis" rolle="status" cse="lead-kontakt-vorhanden"/u);
  });
});
