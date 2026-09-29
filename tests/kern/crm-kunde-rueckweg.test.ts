/**
 * `POST /api/crm/kunde` kehrt mit einem GRUND zurück — nie mit dem Satz des
 * Dienstes —, und die drei Blätter, auf die sie führt, schlagen ihn nach
 * (D-769, D-772, V-274).
 *
 * **Der Befund.** Die Route schickte `?meldung=<Satz>&grund=<grund>`; „Neuer
 * Kunde" zeigte den Satz roh im Warnkasten, das Kontaktblatt ebenso (für den
 * Hauptkontakt und die Wiedervorlage), und das Kundenblatt schlug den Grund
 * mit eckigen Klammern nach: `?grund=__proto__` fand `Object.prototype`,
 * React warf, das Blatt antwortete mit 500.
 *
 * Geprüft wird die ECHTE Route (ersetzt sind nur Sitzung, Datenbank, Tor und
 * Dienste), dazu je Blatt: die Tabelle hat für jeden Grund, den die Route von
 * seinem Formular schicken kann, einen Satz in jeder Sprache des Blatts; der
 * Quelltext liest `meldung` nicht mehr; ein unbekannter Grund — auch
 * `__proto__` — wird der allgemeine Satz.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { KUNDE_RUECKMELDUNG } from '../../src/lib/i18n/verwaltung/crm-kunde.js';
import {
  HAUPTKONTAKT_RUECKWEG, KUNDE_NEU_RUECKWEG,
} from '../../src/lib/i18n/verwaltung/crm-rueckweg.js';
import { Abweisung } from '../../src/components/portal/Rueckweg.js';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';
import { gruendeAb } from './hilfen/gruende.js';

(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  legeKundeAn: vi.fn(),
  legeKontaktAn: vi.fn(),
  setzeHauptkontakt: vi.fn(),
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
  legeKundeAn: zustand.legeKundeAn,
  legeKontaktAn: zustand.legeKontaktAn,
}));
vi.mock('@/server/services/crm/aendern', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeHauptkontakt: zustand.setzeHauptkontakt,
}));

const { CrmFehler } = await import('../../src/server/services/crm/anlegen.js');
const { POST } = await import('../../src/app/api/crm/kunde/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);
const quelle = (d: string): string => readFileSync(resolve(WURZEL, d), 'utf8');
const HIER = 'http://localhost:3001';
const KUNDE = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const KONTAKT = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const NEU = '/portal/reinigung/crm/kunden/neu';
const BLATT = `/portal/reinigung/crm/kunden/${KUNDE}`;
const KONTAKTBLATT = `/portal/reinigung/crm/kontakte/${KONTAKT}`;
const P = 'src/app/portal/[mandant]/crm';

/** Ein Satz, wie ihn ein Dienst werfen könnte — mit Kennung und Eingabe darin. */
const SATZ = `Satz des Dienstes zu ${KUNDE} mit der Eingabe „Müller & Söhne"`;

function formular(felder: Record<string, string>, kopf: Record<string, string> = {}): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  return new NextRequest(new URL('/api/crm/kunde?mandant=reinigung', HIER), {
    method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER, ...kopf }),
  });
}

/** Alle Gründe, die ein Weg der Route schicken kann — aus dem Quelltext, nicht abgetippt. */
function gruende(datei: string, funktion: string): readonly string[] {
  const fund = gruendeAb({ datei, funktion }, ['CrmFehler'], lies, WURZEL);
  /* Ein Wurf ohne festes Wort als Grund liesse die Prüfung blind — er bricht sie. */
  if (fund.offen.length > 0) throw new Error(`${datei}#${funktion}: ${fund.offen.join(', ')}`);
  return [...fund.gruende].sort();
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  for (const f of [zustand.authorize, zustand.legeKundeAn, zustand.legeKontaktAn,
    zustand.setzeHauptkontakt]) f.mockReset();
  zustand.authorize.mockResolvedValue(undefined);
  zustand.legeKundeAn.mockResolvedValue({ id: KUNDE, kundennummer: 'K-1' });
});

describe('POST /api/crm/kunde — der Rückweg trägt einen Grund', () => {
  const ALLE = gruende('src/app/api/crm/kunde/route.ts', 'POST');

  it('die Route kann diese Gründe schicken (gelesen am Quelltext)', () => {
    expect(ALLE).toEqual(expect.arrayContaining([
      'id_fehlt', 'name_fehlt', 'grundlage_ohne_quelle', 'einwilligung_ohne_kanal',
      'kontakt_unbekannt', 'abgewiesen']));
  });

  it.each(ALLE)('%s → 303 auf `zurueck?grund=…` — ohne Satz, ohne Kennung, ohne Eingabe', async (g) => {
    zustand.legeKundeAn.mockRejectedValue(new CrmFehler(SATZ, g as never));
    const r = await POST(formular({ name: 'Müller & Söhne', zurueck: NEU }));
    expect(r.status).toBe(303);
    const ort = r.headers.get('location') ?? '';
    expect(ort).toBe(`${HIER}${NEU}?grund=${g}`);
    expect(ort).not.toContain('meldung=');
    expect(ort).not.toContain(KUNDE);
    expect(decodeURIComponent(ort)).not.toContain('Müller');
  });

  it('der Kontakt am Kundenblatt kommt aufs Kundenblatt zurück', async () => {
    zustand.legeKontaktAn.mockRejectedValue(new CrmFehler(SATZ, 'grundlage_ohne_quelle'));
    const r = await POST(formular({ kundeId: KUNDE, nachname: 'Beispiel', zurueck: BLATT }));
    expect(r.headers.get('location')).toBe(`${HIER}${BLATT}?grund=grundlage_ohne_quelle`);
  });

  it('der Hauptkontakt am Kontaktblatt — auch der Grund der Route selbst (`id_fehlt`)', async () => {
    zustand.setzeHauptkontakt.mockRejectedValue(new CrmFehler(SATZ, 'kontakt_unbekannt', 404));
    const r = await POST(formular({
      aktion: 'hauptkontakt', id: KONTAKT, kundeId: KUNDE, zurueck: `${KONTAKTBLATT}?tab=a`,
    }));
    expect(r.headers.get('location')).toBe(`${HIER}${KONTAKTBLATT}?tab=a&grund=kontakt_unbekannt`);
    const ohne = await POST(formular({ aktion: 'hauptkontakt', kundeId: KUNDE, zurueck: KONTAKTBLATT }));
    expect(ohne.headers.get('location')).toBe(`${HIER}${KONTAKTBLATT}?grund=id_fehlt`);
    expect(zustand.setzeHauptkontakt).toHaveBeenCalledTimes(1);
  });

  it('`zurueck` führt nie aus dem Portal hinaus', async () => {
    zustand.legeKundeAn.mockRejectedValue(new CrmFehler(SATZ, 'name_fehlt'));
    const r = await POST(formular({ zurueck: 'https://fremd.example/portal' }));
    expect(new URL(r.headers.get('location') ?? '').origin).toBe(HIER);
  });

  it('der Erfolg bleibt, wie er war: auf den neuen Kunden, ohne Parameter', async () => {
    const r = await POST(formular({ name: 'Neu GmbH', zurueck: NEU }));
    expect(r.headers.get('location')).toBe(`${HIER}/portal/reinigung/crm/kunden/${KUNDE}`);
  });
});

describe('POST /api/crm/kunde — die Anmeldung und das Recht zuerst', () => {
  it('ein fehlendes Recht ist die byte-gleiche 404 — kein Rückweg, kein Dienst', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht crm.schreiben fehlt'));
    const r = await POST(formular({ name: 'X', zurueck: NEU }, { accept: 'text/html' }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ fehler: 'nicht_gefunden' });
    expect(zustand.legeKundeAn).not.toHaveBeenCalled();
  });

  it('ohne zweiten Faktor der Faktor-Schritt, ohne Sitzung die Anmeldung — nie `?grund=`', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    const faktor = await POST(formular({ name: 'X', zurueck: NEU }, { accept: 'text/html' }));
    expect(faktor.status).toBe(303);
    expect(faktor.headers.get('location')).toContain('/auth/zwei-faktor/einrichten');
    zustand.authorize.mockRejectedValue(new NichtAngemeldetFehler());
    const anmeldung = await POST(formular({ name: 'X', zurueck: NEU }, { accept: 'text/html' }));
    expect(anmeldung.headers.get('location')).toContain('/auth/login');
    expect(anmeldung.headers.get('location')).not.toContain('grund=');
  });

  it('ein unbekannter Fehler bleibt ein Fehler — keine erfundene Abweisung', async () => {
    zustand.legeKundeAn.mockRejectedValue(new TypeError('x is undefined'));
    await expect(POST(formular({ name: 'X', zurueck: NEU }))).rejects.toThrow(TypeError);
  });

  it('ein Programm bekommt JSON wie bisher: fremder Ursprung 403, ohne Sitzung 401', async () => {
    const fremd = await POST(formular({ zurueck: NEU }, { origin: 'https://fremd.example' }));
    expect(fremd.status).toBe(403);
    expect(await fremd.json()).toEqual({ fehler: 'fremder_ursprung' });
    zustand.sitzung = null;
    const programm = new NextRequest(new URL('/api/crm/kunde', HIER), {
      method: 'POST', body: JSON.stringify({ name: 'X' }),
      headers: { host: 'localhost:3001', origin: HIER, 'content-type': 'application/json' },
    });
    const ohne = await POST(programm);
    expect(ohne.status).toBe(401);
    expect(await ohne.json()).toEqual({ fehler: 'keine_sitzung' });
  });
});

describe('die drei Blätter schlagen den Grund nach — und lesen `meldung` nicht mehr', () => {
  const warnung = (saetze: Parameters<typeof Abweisung>[0]['saetze'], grund: string): string =>
    renderToStaticMarkup(createElement(Abweisung, { saetze, grund, cse: 'probe' }));

  it('Neuer Kunde: jeder Grund von legeKundeAn hat einen Satz (deutsch, wie die Seite)', () => {
    const liste = gruende('src/server/services/crm/anlegen.ts', 'legeKundeAn');
    expect(liste).toEqual(expect.arrayContaining(['name_fehlt', 'grundlage_ohne_quelle']));
    const t = KUNDE_NEU_RUECKWEG.de;
    for (const g of liste) expect(eigenerEintrag(t.fehler, g), g).toBeTruthy();
    /* Der Satz, den der Browsertest (crm-anlegen.spec.ts) erwartet. */
    expect(t.fehler.grundlage_ohne_quelle).toContain('Abmahnung');
  });

  it('Kundenblatt: jeder Grund von legeKontaktAn hat einen Satz — de und en', () => {
    const liste = gruende('src/server/services/crm/anlegen.ts', 'legeKontaktAn');
    for (const s of ['de', 'en'] as const) {
      for (const g of liste) expect(eigenerEintrag(KUNDE_RUECKMELDUNG[s].kontaktFehler, g), `${s}.${g}`).toBeTruthy();
    }
  });

  it('Kontaktblatt: jeder Grund des Hauptkontakts hat einen Satz — auch der der Route', () => {
    const liste = [...gruende('src/server/services/crm/aendern.ts', 'setzeHauptkontakt'), 'id_fehlt'];
    for (const g of liste) expect(eigenerEintrag(HAUPTKONTAKT_RUECKWEG.de.fehler, g), g).toBeTruthy();
  });

  it('Kundenblatt: `?grund=__proto__` wird der allgemeine Satz — früher warf React', () => {
    for (const s of ['de', 'en'] as const) {
      const tk = KUNDE_RUECKMELDUNG[s];
      /* Die Gegenprobe: so fand die alte Nachschlagung `Object.prototype`. */
      expect((tk.kontaktFehler as Readonly<Record<string, unknown>>)['__proto__']).toBeDefined();
      const saetze = { titel: tk.nichtGespeichert, sonst: tk.abgewiesen, fehler: tk.kontaktFehler };
      for (const g of ['__proto__', 'constructor', 'toString', 'Hallo Welt']) {
        const html = warnung(saetze, g);
        expect(html, `${s}.${g}`).toContain(tk.abgewiesen);
        expect(html, `${s}.${g}`).toContain('role="alert"');
      }
    }
  });

  it('ein unbekannter Grund wird der allgemeine Satz — auf allen drei Blättern', () => {
    for (const saetze of [KUNDE_NEU_RUECKWEG.de, HAUPTKONTAKT_RUECKWEG.de]) {
      for (const g of ['__proto__', 'constructor', 'kein_grund']) {
        expect(warnung(saetze, g), g).toContain(saetze.sonst);
      }
    }
  });

  it.each([
    [`${P}/kunden/neu/page.tsx`, 'KUNDE_NEU_RUECKWEG.de', "suche['grund']"],
    [`${P}/kunden/[id]/page.tsx`, 'tk.kontaktFehler', "suche['grund']"],
    [`${P}/kontakte/[id]/page.tsx`, 'HAUPTKONTAKT_RUECKWEG.de', 'suche.grund'],
  ])('%s liest `grund` über `einSchluessel` und zeigt ihn nur im Kasten', (seite, tabelle, zugriff) => {
    const s = quelle(seite);
    expect(s).toContain(`einSchluessel(${zugriff})`);
    expect(s).toContain(tabelle);
    expect(s).toMatch(/<Abweisung\b/u);
    expect(s).not.toMatch(/suche\.meldung|suche\['meldung'\]|meldung\?: string/u);
    /* Kein Nachschlagen mit eckigen Klammern (D-728). */
    expect(s).not.toMatch(/kontaktFehler\[|SENDE_FEHLER\[/u);
  });
});

describe('die Sätze der Tabellen', () => {
  it('ohne Kennung, ohne Platzhalter, ohne Rechteschlüssel', () => {
    const saetze = [
      ...Object.values(KUNDE_NEU_RUECKWEG.de.fehler), KUNDE_NEU_RUECKWEG.de.titel, KUNDE_NEU_RUECKWEG.de.sonst,
      ...Object.values(HAUPTKONTAKT_RUECKWEG.de.fehler), HAUPTKONTAKT_RUECKWEG.de.titel,
      HAUPTKONTAKT_RUECKWEG.de.sonst,
    ];
    for (const satz of saetze) {
      expect(satz).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|crm\.schreiben|`/u);
      expect(satz.trim()).not.toBe('');
    }
  });
});
