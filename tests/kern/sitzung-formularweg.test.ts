/**
 * Ohne Sitzung und ohne zweiten Faktor bekommt ein Browserformular eine SEITE
 * (D-766, V-256; D-599, D-692 Nr. 7 abgelöst).
 *
 * **Der Befund.** Die Schreibwege antworteten einem nativen `<form>` bei
 * abgelaufener Sitzung mit `{"fehler":"keine_sitzung"}` (401) und bei
 * fehlendem zweiten Faktor mit `{"fehler":"zweiter_faktor"}` (403) — der
 * Mensch sah eine weisse JSON-Seite und verlor, was er gerade abgeschickt
 * hatte. D-692 Nr. 7 hatte die Wächter ausdrücklich bei JSON gelassen.
 *
 * Geprüft werden (1) die Weiche selbst — Formular oder Programm, 401 oder
 * 403, und die Rückkehr NUR auf eigene Pfade —, (2) echte Routen jeder Bauart
 * (eigener Wächter, Gerüst, Arbeiterportal, Schichtbrücke) mit ersetzter
 * Sitzung, und (3) der ganze Baum: keine Schreibroute unter `src/app/api`
 * antwortet ohne Sitzung selbst (`hilfen/sitzungswache.ts`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';
import { pruefeQuelle } from './hilfen/sitzungswache.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
/* Ohne Sitzung kommt keine Route bis zur Datenbank — kommt sie doch, ist das der Fehler. */
vi.mock('@/server/db/pool', () => ({
  db: () => { throw new Error('ohne Sitzung darf keine Route die Datenbank fragen'); },
}));

const {
  anmeldungsAntwort, autorisierungsAntwort, istBrowserFormular, ohneFaktorAntwort,
  ohneSitzungAntwort, rueckkehrAdresse,
} = await import('../../src/server/auth/antwort.js');
const { internerPfad } = await import('../../src/server/auth/ursprung.js');

const HIER = 'https://cse.example';
const BLATT = '/portal/reinigung/crm/kunden/5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const SCHICHT = '/portal/mein/schichten/5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e/wachbuch';
/** Was ein Browser beim Absenden eines Formulars in `Accept` schickt (Chromium). */
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

interface Aufruf {
  readonly rumpf?: 'urlencoded' | 'multipart' | 'json';
  readonly accept?: string;
  readonly referer?: string;
  readonly felder?: Readonly<Record<string, string>>;
  /** Die Anwendung steht hinter einem Proxy, der TLS beendet. */
  readonly hinterProxy?: boolean;
}

/** Eine Anfrage, wie Browser oder Programm sie an `pfad` schicken. */
function anfrage(pfad: string, a: Aufruf = {}): NextRequest {
  const kopf = new Headers({ host: 'cse.example', origin: HIER });
  if (a.accept !== undefined) kopf.set('accept', a.accept);
  if (a.referer !== undefined) kopf.set('referer', a.referer);
  if (a.hinterProxy === true) kopf.set('x-forwarded-proto', 'https');
  const felder = a.felder ?? {};
  let body: BodyInit;
  if (a.rumpf === 'json') {
    kopf.set('content-type', 'application/json');
    body = JSON.stringify(felder);
  } else if (a.rumpf === 'multipart') {
    const d = new FormData();
    for (const [k, v] of Object.entries(felder)) d.append(k, v);
    body = d;
  } else {
    body = new URLSearchParams(felder);
  }
  const basis = a.hinterProxy === true ? 'http://cse.example' : HIER;
  return new NextRequest(new URL(pfad, basis), { method: 'POST', body, headers: kopf });
}

/** Ein Formular, wie ein Browser es schickt: Formularrumpf, `text/html`, die Seite im `Referer`. */
const browser = (seite: string, a: Aufruf = {}): Aufruf => ({
  rumpf: 'urlencoded', accept: BROWSER_ACCEPT, referer: `${HIER}${seite}`, ...a,
});

function formular(felder: Record<string, string>): FormData {
  const d = new FormData();
  for (const [k, v] of Object.entries(felder)) d.append(k, v);
  return d;
}

/** Wohin eine 303 führt — als geprüfte URL im eigenen Ursprung. */
function ziel(antwort: Response): URL {
  expect(antwort.status).toBe(303);
  const ort = new URL(antwort.headers.get('location') ?? '');
  expect(ort.origin).toBe(HIER);
  return ort;
}

beforeEach(() => { zustand.sitzung = null; });

describe('(1) wer fragt: Formular oder Programm — das Kriterium der Plattform', () => {
  it('Formularrumpf mit text/html ist ein Browserformular — urlencoded wie multipart', () => {
    expect(istBrowserFormular(anfrage('/api/x', browser(BLATT)))).toBe(true);
    expect(istBrowserFormular(anfrage('/api/x', browser(BLATT, { rumpf: 'multipart' })))).toBe(true);
  });

  it('JSON ist ein Programm, auch wenn es text/html annimmt', () => {
    expect(istBrowserFormular(anfrage('/api/x', browser(BLATT, { rumpf: 'json' })))).toBe(false);
  });

  it('ein Skript, das FormData postet, ist ein Programm: ohne text/html, mit */* oder mit q=0', () => {
    expect(istBrowserFormular(anfrage('/api/x', { rumpf: 'multipart' }))).toBe(false);
    expect(istBrowserFormular(anfrage('/api/x', { rumpf: 'urlencoded', accept: '*/*' }))).toBe(false);
    expect(istBrowserFormular(anfrage('/api/x',
      { rumpf: 'urlencoded', accept: 'text/html;q=0, */*' }))).toBe(false);
  });

  it('sind die Felder gelesen, entscheiden zurueck/fehlerweg (D-692 Nr. 1) — auch ohne Kopf', () => {
    const ohneKopf = anfrage('/api/x', { rumpf: 'multipart' });
    expect(istBrowserFormular(ohneKopf, formular({ zurueck: BLATT }))).toBe(true);
    expect(istBrowserFormular(ohneKopf, formular({ fehlerweg: BLATT }))).toBe(true);
    expect(istBrowserFormular(ohneKopf, formular({ zurueck: '' }))).toBe(false);
    expect(istBrowserFormular(ohneKopf, formular({ inhalt: 'x' }))).toBe(false);
  });

  it('ein JSON-Rumpf mit einem Feld zurueck bleibt ein Programm (liesRumpf → json)', () => {
    const programm = anfrage('/api/x', { rumpf: 'json' });
    expect(istBrowserFormular(programm, { felder: { zurueck: BLATT }, json: true })).toBe(false);
    expect(istBrowserFormular(programm, { felder: { zurueck: BLATT }, json: false })).toBe(true);
  });
});

describe('(2) ohne Sitzung: 401 für ein Programm, die Anmeldung für ein Formular', () => {
  it('ein Programm bekommt byte-gleich das JSON von vorher', async () => {
    const r = ohneSitzungAntwort(anfrage('/api/crm/notiz', { rumpf: 'json' }), null);
    expect(r.status).toBe(401);
    expect(await r.text()).toBe('{"fehler":"keine_sitzung"}');
  });

  it('ein Formular geht mit 303 auf die Anmeldung der Verwaltung und kehrt auf seine Seite zurück', () => {
    const ort = ziel(ohneSitzungAntwort(anfrage('/api/crm/notiz', browser(BLATT)), null));
    expect(ort.pathname).toBe('/auth/login');
    expect(ort.searchParams.get('weiter')).toBe(BLATT);
  });

  it('die Routen der Beschäftigten führen auf deren Anmeldung (Mobilnummer und Code)', () => {
    const ort = ziel(ohneSitzungAntwort(anfrage('/api/mein/abwesenheit', browser(SCHICHT)), null,
      { anmeldung: 'beschaeftigte' }));
    expect(ort.pathname).toBe('/auth/mitarbeiter');
    expect(ort.searchParams.get('weiter')).toBe(SCHICHT);
  });

  it('ohne Angabe entscheidet die Seite: /portal/mein gehört den Beschäftigten — /portal/meinung nicht', () => {
    expect(ziel(ohneSitzungAntwort(anfrage('/api/konto/sprache', browser(SCHICHT)), null))
      .pathname).toBe('/auth/mitarbeiter');
    expect(ziel(ohneSitzungAntwort(anfrage('/api/konto/sprache',
      browser('/portal/meinung/x')), null)).pathname).toBe('/auth/login');
    expect(ziel(ohneSitzungAntwort(anfrage('/api/konto/sprache',
      browser('/portal/konto/profil')), null)).pathname).toBe('/auth/login');
  });

  it('eine Sitzung OHNE aktiven Bereich ist angemeldet: /portal statt der Anmeldung', () => {
    const ort = ziel(ohneSitzungAntwort(anfrage('/api/crm/notiz', browser(BLATT)),
      { aktiverMandantId: null }));
    expect(ort.pathname).toBe('/portal');
    expect(ort.search).toBe('');
  });

  it('die Weiterleitung spricht das Schema des Browsers, nicht das hinter dem Proxy', () => {
    const r = ohneSitzungAntwort(anfrage('/api/crm/notiz', browser(BLATT, { hinterProxy: true })), null);
    expect(new URL(r.headers.get('location') ?? '').protocol).toBe('https:');
  });
});

describe('(3) die Rückkehr führt NUR auf eigene Pfade — kein offener Redirect', () => {
  const rueck = (a: Aufruf, felder?: FormData): string | null =>
    rueckkehrAdresse(anfrage('/api/x', a), felder);

  it.each([
    ['ein fremder Ursprung im Referer', 'https://evil.example/portal/x'],
    ['derselbe Name über http (Schemawechsel)', 'http://cse.example/portal/x'],
    ['ein fremder Port', 'https://cse.example:8443/portal/x'],
  ])('%s reist nicht mit', (_name, referer) => {
    expect(rueck({ ...browser(BLATT), referer })).toBeNull();
    const r = ohneSitzungAntwort(anfrage('/api/x', { ...browser(BLATT), referer }), null);
    expect(ziel(r).search).toBe('');
  });

  it.each([
    ['//evil.example/portal', '//evil.example/portal'],
    ['https://evil.example/portal', 'https://evil.example/portal'],
    ['/\\evil.example', '/\\evil.example'],
    ['/.//evil.example', '/.//evil.example'],
    ['/portal/..//evil.example', '/portal/..//evil.example'],
    ['javascript:alert(1)', 'javascript:alert(1)'],
  ])('zurueck = %s reist nicht mit', (_name, wert) => {
    const ohneReferer = { rumpf: 'urlencoded', accept: BROWSER_ACCEPT } as const;
    expect(rueck(ohneReferer, formular({ zurueck: wert }))).toBeNull();
    expect(rueck(ohneReferer, formular({ fehlerweg: wert }))).toBeNull();
    const ort = ziel(ohneSitzungAntwort(anfrage('/api/x', ohneReferer), null,
      { felder: formular({ zurueck: wert }) }));
    expect(ort.pathname).toBe('/auth/login');
    expect(ort.searchParams.get('weiter')).toBeNull();
  });

  it('eine Schnittstelle oder die Anmeldung selbst ist keine Rückkehr', () => {
    expect(rueck(browser('/api/crm/notiz'))).toBeNull();
    expect(rueck(browser('/auth/login?weiter=/portal'))).toBeNull();
    expect(rueck(browser('/authentifizierung'))).toBe('/authentifizierung');
  });

  it('die Seite des Formulars: fehlerweg vor Referer vor zurueck', () => {
    const felder = formular({ zurueck: '/portal/reinigung/crm', fehlerweg: `${BLATT}?tab=notiz` });
    expect(rueck(browser(BLATT), felder)).toBe(`${BLATT}?tab=notiz`);
    expect(rueck(browser(BLATT), formular({ zurueck: '/portal/reinigung/crm' }))).toBe(BLATT);
    expect(rueck({ rumpf: 'urlencoded', accept: BROWSER_ACCEPT },
      formular({ zurueck: '/portal/reinigung/crm' }))).toBe('/portal/reinigung/crm');
  });

  it('internerPfad: eigener Pfad samt Abfrage und Anker, sonst null', () => {
    const a = anfrage('/api/x');
    expect(internerPfad(`${BLATT}?a=1#b`, a)).toBe(`${BLATT}?a=1#b`);
    expect(internerPfad(`${HIER}${BLATT}`, a)).toBe(BLATT);
    expect(internerPfad('//evil.example', a)).toBeNull();
    expect(internerPfad('', a)).toBeNull();
    expect(internerPfad(null, a)).toBeNull();
  });
});

describe('(4) ohne zweiten Faktor: 403 für ein Programm, der Faktor-Schritt für ein Formular', () => {
  it('ein Programm bekommt byte-gleich das JSON von vorher', async () => {
    const r = ohneFaktorAntwort(anfrage('/api/einstellungen/rollenrecht', { rumpf: 'json' }));
    expect(r.status).toBe(403);
    expect(await r.text()).toBe('{"fehler":"zweiter_faktor"}');
  });

  it('ein Formular geht auf den Faktor-Schritt und danach zurück (wie die Pforte, V-136)', () => {
    const seite = '/portal/reinigung/einstellungen/rollen';
    const ort = ziel(ohneFaktorAntwort(anfrage('/api/einstellungen/rollenrecht', browser(seite))));
    expect(ort.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ort.searchParams.get('weiter')).toBe(seite);
  });

  it('anmeldungsAntwort: nur die beiden Würfe der Anmeldung, alles andere null', () => {
    const a = anfrage('/api/x', browser(BLATT));
    expect(ziel(anmeldungsAntwort(new NichtAngemeldetFehler(), a)!).pathname).toBe('/auth/login');
    expect(ziel(anmeldungsAntwort(new ZweiterFaktorFehler(), a)!).pathname)
      .toBe('/auth/zwei-faktor/einrichten');
    expect(anmeldungsAntwort(new NichtGefundenFehler('Recht x fehlt'), a)).toBeNull();
    expect(anmeldungsAntwort(new TypeError('x'), a)).toBeNull();
  });

  it('ein fehlendes Recht bleibt auch hinter einem Formular byte-gleich JSON 404 (D-656 Nr. 2)', async () => {
    const r = autorisierungsAntwort(new NichtGefundenFehler('Recht crm.schreiben fehlt'),
      anfrage('/api/crm/notiz', browser(BLATT)));
    expect(r?.status).toBe(404);
    expect(await r?.text()).toBe('{"fehler":"nicht_gefunden"}');
  });
});

describe('(5) echte Routen jeder Bauart, ohne Sitzung', () => {
  it('eigener Wächter (POST /api/crm/notiz): Formular → Anmeldung, Programm → 401', async () => {
    const { POST } = await import('../../src/app/api/crm/notiz/route.js');
    const ort = ziel(await POST(anfrage('/api/crm/notiz',
      browser(BLATT, { felder: { inhalt: 'x', zurueck: BLATT } }))));
    expect(`${ort.pathname}${ort.search}`).toBe(`/auth/login?weiter=${encodeURIComponent(BLATT)}`);
    expect((await POST(anfrage('/api/crm/notiz', { rumpf: 'json', felder: { inhalt: 'x' } })))
      .status).toBe(401);
    /* Angemeldet, aber in der Gruppenansicht (Invariante 10): der Wegweiser. */
    zustand.sitzung = { aktiverMandantId: null };
    expect(ziel(await POST(anfrage('/api/crm/notiz', browser(BLATT)))).pathname).toBe('/portal');
  });

  it('Gerüst (fuehreUebergangAus, POST /api/raum): dieselbe Weiche', async () => {
    const { POST } = await import('../../src/app/api/raum/route.js');
    const seite = '/portal/reinigung/objekte/5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e/raeume';
    expect(ziel(await POST(anfrage('/api/raum', browser(seite)))).searchParams.get('weiter'))
      .toBe(seite);
    expect((await POST(anfrage('/api/raum', { rumpf: 'json' }))).status).toBe(401);
  });

  it('Arbeiterportal (POST /api/mein/abwesenheit/[id]/zurueckziehen): die Anmeldung der Beschäftigten', async () => {
    const { POST } = await import(
      '../../src/app/api/mein/abwesenheit/[id]/zurueckziehen/route.js');
    const blatt = '/portal/mein/abwesenheit/5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
    const ort = ziel(await POST(anfrage('/api/mein/abwesenheit/x/zurueckziehen', browser(blatt)),
      { params: Promise.resolve({ id: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e' }) }));
    expect(ort.pathname).toBe('/auth/mitarbeiter');
    expect(ort.searchParams.get('weiter')).toBe(blatt);
  });

  it('Schichtbrücke (aufDerSchicht): das schon gelesene Formular entscheidet, auch ohne Kopf', async () => {
    const { aufDerSchicht } = await import('../../src/app/api/mein/schichten/bruecke.js');
    const fn = vi.fn();
    const e = await aufDerSchicht(anfrage('/api/mein/schichten/x/wachbuch', { rumpf: 'multipart' }),
      '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e', fn, formular({ zurueck: SCHICHT }));
    expect(e.art).toBe('antwort');
    if (e.art !== 'antwort') return;
    const ort = ziel(e.antwort);
    expect(ort.pathname).toBe('/auth/mitarbeiter');
    expect(ort.searchParams.get('weiter')).toBe(SCHICHT);
    expect(fn).not.toHaveBeenCalled();
    /* Ohne Formularfelder und ohne Kopf: ein Programm, JSON wie bisher. */
    const p = await aufDerSchicht(anfrage('/api/mein/schichten/x/wachbuch', { rumpf: 'json' }),
      '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e', fn);
    expect(p.art === 'antwort' ? p.antwort.status : 0).toBe(401);
  });
});

describe('(5a) die Anmeldungen führen zurück — auch die der Beschäftigten', () => {
  const quelle = (datei: string): string =>
    readFileSync(resolve(import.meta.dirname, '../..', datei), 'utf8');

  it('mitWeiter: weiter= nur für einen eigenen Pfad, mit ? oder &', async () => {
    const { mitWeiter } = await import('../../src/server/auth/kennwort-anmeldung.js');
    expect(mitWeiter('/auth/mitarbeiter/code', SCHICHT))
      .toBe(`/auth/mitarbeiter/code?weiter=${encodeURIComponent(SCHICHT)}`);
    expect(mitWeiter('/portal/mein?angemeldet=1', SCHICHT))
      .toBe(`/portal/mein?angemeldet=1&weiter=${encodeURIComponent(SCHICHT)}`);
    for (const fremd of ['//evil.example', 'https://evil.example/portal', '/\\evil.example',
      'portal/mein', '', undefined, null, ['/portal/mein']]) {
      expect(mitWeiter('/auth/mitarbeiter', fremd), String(fremd)).toBe('/auth/mitarbeiter');
    }
  });

  it('beide Schritte der Anmeldung tragen weiter — Formular, Weiterleitung, Sprachwahl', () => {
    for (const datei of ['src/app/auth/mitarbeiter/page.tsx', 'src/app/auth/mitarbeiter/code/page.tsx']) {
      const s = quelle(datei);
      expect(s, datei).toContain("sichererRueckweg(suche['weiter'])");
      expect(s, datei).toContain('<input type="hidden" name="weiter" value={weiter} />');
      expect(s, datei).toMatch(/GeraeteSprachwahl aktiv=\{sprache\} zurueck=\{mitWeiter\(/u);
    }
    expect(quelle('src/app/auth/mitarbeiter/page.tsx'))
      .toContain("redirect(mitWeiter('/auth/mitarbeiter/code', daten.get('weiter')))");
    /* Über „Heute", damit D-488 (Keks abgelehnt) seinen Satz behält. */
    expect(quelle('src/app/auth/mitarbeiter/code/page.tsx'))
      .toContain("redirect(mitWeiter('/portal/mein?angemeldet=1', zurueck))");
    const heute = quelle('src/app/portal/mein/page.tsx');
    expect(heute).toContain(
      "const weiter = kam['angemeldet'] === '1' ? sichererRueckweg(kam['weiter']) : null;");
    expect(heute).toContain('redirect(alsRoute(weiter))');
  });

  it('der Faktor-Schritt reicht die Rückkehr an pruefen weiter, wenn schon ein Faktor steht', () => {
    expect(quelle('src/app/auth/zwei-faktor/einrichten/page.tsx'))
      .toContain("mitWeiter('/auth/zwei-faktor/pruefen', ziel)");
  });
});

describe('(6) die Wache über den ganzen Baum: keine Schreibroute antwortet ohne Sitzung selbst', () => {
  const WURZEL = resolve(import.meta.dirname, '../..');
  const API = join(WURZEL, 'src/app/api');

  function dateien(verzeichnis: string): string[] {
    const treffer: string[] = [];
    for (const eintrag of readdirSync(verzeichnis)) {
      const voll = join(verzeichnis, eintrag);
      if (statSync(voll).isDirectory()) treffer.push(...dateien(voll));
      else if (/\.tsx?$/u.test(eintrag)) treffer.push(voll);
    }
    return treffer;
  }

  /**
   * Die begründeten Ausnahmen — Datei → Grund. Heute keine: jeder Schreibweg
   * und jedes Gerüst geht über die Weiche. Wer hier eine Zeile einträgt,
   * schreibt den Grund dazu, und der Grund ist nie „es war schon so".
   */
  const AUSNAHMEN: Readonly<Record<string, string>> = {};

  const alle = dateien(API).map((d) => ({
    rel: relative(WURZEL, d), quelle: readFileSync(d, 'utf8'),
  }));

  it('die Wache sieht den Baum — Schreibwege, Gerüste und die Sitzungsfragen darin', () => {
    const schreibend = alle.filter((d) =>
      /\/route\.ts$/u.test(d.rel) && /export\s+(?:async\s+)?function\s+POST\b/u.test(d.quelle));
    expect(schreibend.length).toBeGreaterThan(180);
    const mitWeiche = alle.filter((d) => /\bohneSitzung(?:Antwort|Beschaeftigte)\(/u.test(d.quelle));
    expect(mitWeiche.length).toBeGreaterThan(140);
  });

  it('kein Befund ausserhalb der begründeten Ausnahmen', () => {
    const befunde = alle.flatMap((d) => pruefeQuelle(d.rel, d.quelle))
      .filter((b) => AUSNAHMEN[b.datei] === undefined)
      .map((b) => `${b.art} ${b.datei}:${String(b.zeile)} ${b.text}`);
    expect(befunde, 'diese Stellen antworten ohne Sitzung oder Faktor selbst — '
      + '`ohneSitzungAntwort`/`anmeldungsAntwort` (server/auth/antwort.ts) nehmen').toEqual([]);
  });

  it('jede Ausnahme hat einen Grund und trifft eine Datei, die es gibt', () => {
    for (const [datei, grund] of Object.entries(AUSNAHMEN)) {
      expect(grund.length, datei).toBeGreaterThan(20);
      expect(alle.some((d) => d.rel === datei), datei).toBe(true);
    }
  });
});

describe('die Wache sagt auch Nein', () => {
  const route = (rumpf: string): string =>
    `import { NextResponse } from 'next/server';\nexport async function POST(anfrage) {\n${rumpf}\n}`;

  it('der alte Wächter fällt doppelt auf: die Zahl und der Code', () => {
    const b = pruefeQuelle('src/app/api/x/route.ts', route(`
      const sitzung = await aktuelleSitzung();
      if (sitzung === null) return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });`));
    expect(b.map((x) => x.art).sort()).toEqual(['anmeldecode', 'ohne_weiche', 'status_401']);
  });

  it('ein eigener Übersetzer mit 401 oder dem Code des zweiten Faktors fällt auf', () => {
    expect(pruefeQuelle('src/app/api/x/route.ts',
      route("return fehlerAntwort('x', 'Keine Sitzung.', 401);")).map((x) => x.art))
      .toEqual(['status_401']);
    expect(pruefeQuelle('src/app/api/x/route.ts',
      route("return { wort: 'zweiter_faktor', status: 403 };")).map((x) => x.art))
      .toEqual(['anmeldecode']);
  });

  it('ein Gerüst, das die Sitzung fragt und keine Weiche ruft, fällt auf — auch ohne 401', () => {
    expect(pruefeQuelle('src/app/api/x/gemeinsam.ts', `
      export async function fuehreAus(anfrage) {
        const sitzung = await aktuelleSitzung();
        if (sitzung === null) return NextResponse.redirect(new URL('/', anfrage.url), 303);
      }`).map((x) => x.art)).toEqual(['ohne_weiche']);
  });

  it('die Weiche, Kommentare und Lesewege sind kein Befund', () => {
    expect(pruefeQuelle('src/app/api/x/route.ts', route(`
      // früher: { status: 401 } mit 'keine_sitzung'
      const sitzung = await aktuelleSitzung();
      if (sitzung === null) return ohneSitzungAntwort(anfrage, sitzung);`))).toEqual([]);
    expect(pruefeQuelle('src/app/api/x/route.ts', `
      export async function GET() {
        return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
      }`)).toEqual([]);
  });
});
