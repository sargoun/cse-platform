/**
 * Ein Download-Link ohne Sitzung oder ohne zweiten Faktor bekommt eine SEITE
 * (D-768, V-258 — die Lesewege zu D-766).
 *
 * **Der Befund.** 22 `GET`-Routen (Belege, DATEV-, Z3- und Lohnexport,
 * Jahrespaket, Verfahrensdokumentation, Datenschutzberichte, Dokumente und
 * Bündel, Medien, XRechnung/ZUGFeRD in beiden Portalen, Freigaben,
 * Berichts-CSV, Nachtragswarnungen) schrieben ihr 401 selbst: wer nach
 * abgelaufener Sitzung auf „Herunterladen" tippte, sah `{"fehler":…}` auf
 * weissem Grund. Die Wache nahm Lesewege ausdrücklich aus.
 *
 * Geprüft werden (1) das Merkmal einer Navigation — `GET`/`HEAD` mit
 * ausdrücklichem `text/html`, sonst ein Programm —, (2) die Rückkehr: die
 * angefragte Seite, bei einem Download unter `/api/…` die Seite, von der er
 * kam, sonst keine (dann führt die Anmeldung ins Portal) — und NUR eigene
 * Pfade, (3) die Antworten der Weiche, und (4) echte Lesewege jeder Bauart
 * mit ersetzter Sitzung, (5) dass kein Link auf einen Leseweg `download`
 * trägt — damit würde die Anmeldung zur Datei —, und (6) dass eine
 * öffentliche Datei mit Vorschau (`vorschauSitzung`) ohne Sitzung 404 sagt
 * und nie auf die Anmeldung führt. Dass keine Route mehr an der Weiche vorbei
 * antwortet, prüft die Wache in `sitzung-formularweg.test.ts` (6).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import type * as TS from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  /** Was die Transaktion wirft — `null`: die Route darf die Datenbank gar nicht fragen. */
  wurf: null as null | Error,
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  SCHNAPPSCHUSS: 'isolation level repeatable read',
  db: () => {
    if (zustand.wurf === null) throw new Error('ohne Sitzung darf keine Route die Datenbank fragen');
    const wurf = zustand.wurf;
    return { begin: () => Promise.reject(wurf) };
  },
}));

const {
  anmeldungsAntwort, autorisierungsAntwort, istBrowserFormular, istBrowserNavigation,
  ohneFaktorAntwort, ohneSitzungAntwort, rueckkehrAdresse,
} = await import('../../src/server/auth/antwort.js');

const HIER = 'https://cse.example';
const ID = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
/** Die Seite mit dem Download-Link. */
const SEITE = '/portal/reinigung/buchhaltung/lohnexport?monat=2026-08';

/** `Accept` einer Navigation (Chromium; Firefox und Safari schicken dasselbe ohne Bildtypen). */
const NAVIGATION = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,'
  + 'image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
/** `Accept` eines `<img>` (Chromium). */
const BILD = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

interface Aufruf {
  readonly accept?: string;
  readonly referer?: string;
  readonly methode?: 'GET' | 'HEAD' | 'POST';
  readonly kopf?: Readonly<Record<string, string>>;
}

/** Ein Aufruf per `GET` an `pfad` — ohne `accept` so, wie `fetch()` ihn schickt. */
function lies(pfad: string, a: Aufruf = {}): NextRequest {
  const kopf = new Headers({ host: 'cse.example', accept: a.accept ?? '*/*', ...a.kopf });
  if (a.referer !== undefined) kopf.set('referer', a.referer);
  return new NextRequest(new URL(pfad, HIER), { method: a.methode ?? 'GET', headers: kopf });
}

/** Ein Tippen auf einen Link auf `seite`. */
const klick = (seite: string, a: Aufruf = {}): Aufruf => ({
  accept: NAVIGATION, referer: `${HIER}${seite}`, ...a,
});

/** Wohin eine 303 führt — als geprüfte URL im eigenen Ursprung. */
function ziel(antwort: Response): URL {
  expect(antwort.status).toBe(303);
  const ort = new URL(antwort.headers.get('location') ?? '');
  expect(ort.origin).toBe(HIER);
  return ort;
}

beforeEach(() => {
  zustand.sitzung = null;
  zustand.wurf = null;
});

describe('(1) Navigation oder Programm — das Merkmal der Plattform, ohne ein neues', () => {
  it('ein Tippen auf einen Link ist eine Navigation — GET und HEAD', () => {
    expect(istBrowserNavigation(lies('/api/x', { accept: NAVIGATION }))).toBe(true);
    expect(istBrowserNavigation(lies('/api/x', { accept: NAVIGATION, methode: 'HEAD' }))).toBe(true);
    expect(istBrowserNavigation(lies('/api/x', { accept: 'TEXT/HTML' }))).toBe(true);
  });

  it('fetch(), ein <img> und ein Programm sind keine: ohne text/html, mit */* oder mit q=0', () => {
    expect(istBrowserNavigation(lies('/api/x'))).toBe(false);
    expect(istBrowserNavigation(lies('/api/x', { accept: '' }))).toBe(false);
    expect(istBrowserNavigation(lies('/api/x', { accept: BILD }))).toBe(false);
    expect(istBrowserNavigation(lies('/api/x', { accept: 'application/json' }))).toBe(false);
    expect(istBrowserNavigation(lies('/api/x', { accept: 'text/html;q=0, */*' }))).toBe(false);
  });

  it('Sec-Fetch-Mode allein macht keine Navigation — die Plattform wertet ihn nirgends aus', () => {
    expect(istBrowserNavigation(lies('/api/x', {
      kopf: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    }))).toBe(false);
  });

  it('ein POST ist nie eine Navigation — dort entscheidet das Formular (D-766)', () => {
    const post = lies('/api/x', { accept: NAVIGATION, methode: 'POST' });
    expect(istBrowserNavigation(post)).toBe(false);
    expect(istBrowserFormular(post)).toBe(false);
  });
});

describe('(2) die Rückkehr: die Seite des Links, nur ein eigener Pfad', () => {
  it('ein Download unter /api kehrt auf die Seite zurück, von der er kam', () => {
    expect(rueckkehrAdresse(lies('/api/buchhaltung/lohnexport?monat=2026-08', klick(SEITE))))
      .toBe(SEITE);
  });

  it('eine angefragte SEITE ist selbst die Rückkehr — vor dem Referer', () => {
    expect(rueckkehrAdresse(lies('/portal/reinigung/berichte?jahr=2026',
      klick('/portal/reinigung')))).toBe('/portal/reinigung/berichte?jahr=2026');
  });

  it('ohne brauchbaren Referer reist nichts mit — die Anmeldung führt dann ins Portal', () => {
    expect(rueckkehrAdresse(lies('/api/x', { accept: NAVIGATION }))).toBeNull();
    for (const fremd of [
      'https://evil.example/portal/x', '//evil.example/portal', 'http://cse.example/portal/x',
      'https://cse.example:8443/portal/x', 'https://cse.example.evil.example/portal',
      `${HIER}/api/buchhaltung/lohnexport`, `${HIER}/auth/login?weiter=%2Fportal`,
    ]) {
      expect(rueckkehrAdresse(lies('/api/x', { accept: NAVIGATION, referer: fremd })), fremd)
        .toBeNull();
    }
  });

  it('ein Programm nimmt die angefragte Adresse nicht als Rückkehr', () => {
    expect(rueckkehrAdresse(lies('/portal/reinigung/berichte'))).toBeNull();
  });
});

describe('(3) die Weiche: Anmeldung, Faktor-Schritt, Portal — und JSON für Programme', () => {
  it('ohne Sitzung: 303 auf die Anmeldung der Verwaltung, weiter= die Seite des Links', () => {
    const ort = ziel(ohneSitzungAntwort(lies('/api/x', klick(SEITE)), null));
    expect(ort.pathname).toBe('/auth/login');
    expect(ort.searchParams.get('weiter')).toBe(SEITE);
  });

  it('ohne Rückkehr kein weiter= — auch kein fremdes', () => {
    const ort = ziel(ohneSitzungAntwort(
      lies('/api/x', { accept: NAVIGATION, referer: 'https://evil.example/portal' }), null));
    expect(ort.pathname).toBe('/auth/login');
    expect(ort.search).toBe('');
  });

  it('die Beschäftigten landen auf IHRER Anmeldung — ausdrücklich oder an der Seite erkannt', () => {
    const seite = `/portal/mein/dokumente/${ID}`;
    const ausdruecklich = ziel(ohneSitzungAntwort(lies('/api/x', klick(seite)), null,
      { anmeldung: 'beschaeftigte' }));
    expect(ausdruecklich.pathname).toBe('/auth/mitarbeiter');
    expect(ausdruecklich.searchParams.get('weiter')).toBe(seite);
    expect(ziel(ohneSitzungAntwort(lies('/api/x', klick(seite)), null)).pathname)
      .toBe('/auth/mitarbeiter');
  });

  it('eine Sitzung ohne aktiven Bereich geht ins Portal, nicht auf die Anmeldung', () => {
    const ort = ziel(ohneSitzungAntwort(lies('/api/x', klick(SEITE)), { aktiverMandantId: null }));
    expect(ort.pathname).toBe('/portal');
    expect(ort.search).toBe('');
  });

  it('ohne zweiten Faktor: der Faktor-Schritt mit Rückkehr', () => {
    const ort = ziel(ohneFaktorAntwort(lies('/api/x', klick(SEITE))));
    expect(ort.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ort.searchParams.get('weiter')).toBe(SEITE);
    expect(ziel(anmeldungsAntwort(new ZweiterFaktorFehler(), lies('/api/x', klick(SEITE)))
      ?? new Response()).pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ziel(anmeldungsAntwort(new NichtAngemeldetFehler(), lies('/api/x', klick(SEITE)))
      ?? new Response()).pathname).toBe('/auth/login');
  });

  it('ein Programm bekommt byte-gleich das JSON von vorher — 401 und 403', async () => {
    const ohne = ohneSitzungAntwort(lies('/api/x', { referer: `${HIER}${SEITE}` }), null);
    expect(ohne.status).toBe(401);
    expect(await ohne.text()).toBe('{"fehler":"keine_sitzung"}');
    const faktor = ohneFaktorAntwort(lies('/api/x', { accept: BILD }));
    expect(faktor.status).toBe(403);
    expect(await faktor.text()).toBe('{"fehler":"zweiter_faktor"}');
  });

  it('ein fehlendes Recht bleibt auch für eine Navigation byte-gleich JSON 404 (AUT-06)', async () => {
    const a = autorisierungsAntwort(new NichtGefundenFehler(), lies('/api/x', klick(SEITE)));
    expect(a?.status).toBe(404);
    expect(await a?.text()).toBe('{"fehler":"nicht_gefunden"}');
  });
});

describe('(4) echte Lesewege jeder Bauart', () => {
  const lohnexport = async (a: Aufruf): Promise<Response> => {
    const { GET } = await import('../../src/app/api/buchhaltung/lohnexport/route.js');
    return GET(lies('/api/buchhaltung/lohnexport?mandant=reinigung&monat=2026-08', a));
  };

  it('Export (GET /api/buchhaltung/lohnexport): Navigation → Anmeldung, Programm → 401', async () => {
    const ort = ziel(await lohnexport(klick(SEITE)));
    expect(ort.pathname).toBe('/auth/login');
    expect(ort.searchParams.get('weiter')).toBe(SEITE);

    const programm = await lohnexport({});
    expect(programm.status).toBe(401);
    expect(await programm.text()).toBe('{"fehler":"keine_sitzung"}');
  });

  it('derselbe Export mit Sitzung ohne Bereich → /portal', async () => {
    zustand.sitzung = { benutzerId: 'b', aktiverMandantId: null, ansicht: 'gruppe', aal: 'aal2' };
    expect(ziel(await lohnexport(klick(SEITE))).pathname).toBe('/portal');
  });

  it('der Fangzweig: ZweiterFaktorFehler → Faktor-Schritt bzw. 403, ein fehlendes Recht → 404', async () => {
    zustand.sitzung = {
      benutzerId: 'b', aktiverMandantId: 'm', ansicht: 'mandant', aal: 'aal1', portal: 'intern',
    };
    zustand.wurf = new ZweiterFaktorFehler();
    const ort = ziel(await lohnexport(klick(SEITE)));
    expect(ort.pathname).toBe('/auth/zwei-faktor/einrichten');
    expect(ort.searchParams.get('weiter')).toBe(SEITE);
    const programm = await lohnexport({});
    expect(programm.status).toBe(403);
    expect(await programm.text()).toBe('{"fehler":"zweiter_faktor"}');

    zustand.wurf = new NichtGefundenFehler();
    const recht = await lohnexport(klick(SEITE));
    expect(recht.status).toBe(404);
    expect(await recht.text()).toBe('{"fehler":"nicht_gefunden"}');
  });

  it('Datei mit Kennung (GET /api/dokumente/[id]/datei): Navigation → Anmeldung', async () => {
    const { GET } = await import('../../src/app/api/dokumente/[id]/datei/route.js');
    const seite = `/portal/reinigung/dokumente/${ID}`;
    const ort = ziel(await GET(lies(`/api/dokumente/${ID}/datei`, klick(seite)),
      { params: Promise.resolve({ id: ID }) }));
    expect(ort.pathname).toBe('/auth/login');
    expect(ort.searchParams.get('weiter')).toBe(seite);
  });

  it('Kundenportal (GET /api/kunde/rechnungen/[id]/xrechnung.xml): zurück auf die Rechnung', async () => {
    const { GET } = await import('../../src/app/api/kunde/rechnungen/[id]/xrechnung.xml/route.js');
    const seite = `/portal/kunde/rechnungen/${ID}`;
    const ort = ziel(await GET(lies(`/api/kunde/rechnungen/${ID}/xrechnung.xml`, klick(seite)),
      { params: Promise.resolve({ id: ID }) }));
    expect(ort.pathname).toBe('/auth/login');
    expect(ort.searchParams.get('weiter')).toBe(seite);
  });

  it('Arbeiterportal (GET /api/mein/dokumente/[id]/datei): Mobilnummer und Code, dann zurück', async () => {
    const { GET } = await import('../../src/app/api/mein/dokumente/[id]/datei/route.js');
    const seite = `/portal/mein/dokumente/${ID}`;
    const params = { params: Promise.resolve({ id: ID }) };
    const ort = ziel(await GET(lies(`/api/mein/dokumente/${ID}/datei`, klick(seite)), params));
    expect(ort.pathname).toBe('/auth/mitarbeiter');
    expect(ort.searchParams.get('weiter')).toBe(seite);

    /* Der Riegel gegen fremde Einbettung bleibt JSON — auch vor einer Navigation. */
    const fremd = await GET(lies(`/api/mein/dokumente/${ID}/datei`,
      { ...klick(seite), kopf: { 'sec-fetch-site': 'cross-site' } }), params);
    expect(fremd.status).toBe(403);
    expect(await fremd.text()).toBe('{"fehler":"fremder_ursprung"}');
  });

  it('Berichts-CSV: ein Code für alle (keine_sitzung statt nicht_angemeldet), Navigation → Anmeldung', async () => {
    const { GET } = await import('../../src/app/api/berichte/[bericht]/csv/route.js');
    const params = { params: Promise.resolve({ bericht: 'umsatz' }) };
    const programm = await GET(lies('/api/berichte/umsatz/csv?jahr=2026'), params);
    expect(programm.status).toBe(401);
    expect(await programm.text()).toBe('{"fehler":"keine_sitzung"}');
    const seite = '/portal/reinigung/berichte/umsatz?jahr=2026';
    expect(ziel(await GET(lies('/api/berichte/umsatz/csv?jahr=2026', klick(seite)), {
      params: Promise.resolve({ bericht: 'umsatz' }),
    })).searchParams.get('weiter')).toBe(seite);
  });

  it('eine JSON-Schnittstelle (GET /api/freigaben): fetch bleibt JSON, eine Navigation nicht', async () => {
    const { GET } = await import('../../src/app/api/freigaben/route.js');
    const programm = await GET(lies('/api/freigaben'));
    expect(programm.status).toBe(401);
    expect(await programm.text()).toBe('{"fehler":"keine_sitzung"}');
    expect(ziel(await GET(lies('/api/freigaben', klick('/portal/reinigung/freigaben'))))
      .pathname).toBe('/auth/login');
  });
});

/* ── (5) kein `download` an einem Link auf einen Leseweg ─────────────────── */

const ts = createRequire(import.meta.url)('typescript') as typeof TS;
const WURZEL = resolve(import.meta.dirname, '../..');

/**
 * Die Zeilen, in denen ein JSX-Element `download` trägt UND auf `/api/…`
 * zeigt. Mit `download` behandelt der Browser jede Antwort als Datei — auch
 * die Weiterleitung einer abgelaufenen Sitzung: statt der Anmeldung gäbe es
 * einen fehlgeschlagenen Download oder die Anmeldeseite als Datei (D-768
 * Nr. 7). Ein `download` an einer selbst erzeugten Datei (`blob:`) trifft
 * das nicht und bleibt erlaubt.
 */
function downloadAufLeseweg(datei: string, quelle: string): number[] {
  const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const zeilen: number[] = [];
  const besuche = (n: TS.Node): void => {
    if (ts.isJsxAttributes(n)) {
      const namen = new Map(n.properties.filter(ts.isJsxAttribute)
        .map((a) => [a.name.getText(sf), a.initializer?.getText(sf) ?? ''] as const));
      if (namen.has('download') && /["'`]\/api\//u.test(namen.get('href') ?? '')) {
        zeilen.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
      }
    }
    ts.forEachChild(n, besuche);
  };
  besuche(sf);
  return zeilen;
}

function tsxUnter(verzeichnis: string): string[] {
  const treffer: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) treffer.push(...tsxUnter(voll));
    else if (eintrag.endsWith('.tsx')) treffer.push(voll);
  }
  return treffer;
}

describe('(5) kein Link auf einen Leseweg trägt `download` — die Anmeldung würde zur Datei', () => {
  it('im ganzen Baum unter src keiner', () => {
    const funde = tsxUnter(join(WURZEL, 'src')).flatMap((voll) => {
      const quelle = readFileSync(voll, 'utf8');
      if (!quelle.includes('download')) return [];
      const rel = relative(WURZEL, voll);
      return downloadAufLeseweg(rel, quelle).map((z) => `${rel}:${String(z)}`);
    });
    expect(funde, 'einen gewöhnlichen Link nehmen — die Route liefert '
      + '`Content-Disposition: attachment`').toEqual([]);
  });

  it('der CSV-Knopf der Berichte ist ein gewöhnlicher Link auf seinen Leseweg', () => {
    const quelle = readFileSync(join(WURZEL, 'src/app/portal/[mandant]/berichte/rahmen.tsx'), 'utf8');
    expect(quelle).toContain('data-cse="csv-export"');
    expect(quelle).toContain('href={`/api/berichte/${bericht}/csv');
  });

  it('die Prüfung sagt auch Nein — und lässt eine selbst erzeugte Datei durch', () => {
    expect(downloadAufLeseweg('x.tsx',
      'const a = <a href={`/api/berichte/${b}/csv`} download className="k">CSV</a>;')).toEqual([1]);
    expect(downloadAufLeseweg('x.tsx',
      'const a = <a download="x.csv" href="/api/x/datei">X</a>;')).toEqual([1]);
    expect(downloadAufLeseweg('x.tsx',
      'const a = <a href={`/api/berichte/${b}/csv`} className="k">CSV</a>;')).toEqual([]);
    expect(downloadAufLeseweg('x.tsx',
      'const a = <a href={blobAdresse} download="bericht.csv">CSV</a>;')).toEqual([]);
  });
});

/* ── (6) öffentliche Dateien mit Vorschau: 404, nie die Anmeldung ─────────── */

describe('(6) eine öffentliche Datei mit Vorschau sagt ohne Sitzung 404 — auch einer Navigation', () => {
  it('vorschauSitzung: nur eine Sitzung MIT aktivem Bereich öffnet die Vorschau', async () => {
    const { vorschauSitzung } = await import('../../src/server/auth/vorschau-sitzung.js');
    expect(await vorschauSitzung()).toBeNull();
    zustand.sitzung = { benutzerId: 'b', aktiverMandantId: null, ansicht: 'gruppe' };
    expect(await vorschauSitzung()).toBeNull();
    zustand.sitzung = { benutzerId: 'b', aktiverMandantId: 'm', ansicht: 'mandant' };
    expect(await vorschauSitzung()).toBe(zustand.sitzung);
  });

  it('Beitragsbild (GET /api/beitragsbild/[id]): 404 statt Anmeldung, byte-gleich', async () => {
    const { GET } = await import('../../src/app/api/beitragsbild/[id]/route.js');
    const antwort = await GET(lies(`/api/beitragsbild/${ID}`, klick('/portal/reinigung/social')),
      { params: Promise.resolve({ id: ID }) });
    expect(antwort.status).toBe(404);
    expect(await antwort.text()).toBe('{"fehler":"nicht_gefunden"}');
  });

  it('Logo (GET /api/marke/[mandant]/[art]/[version]): 404 statt Anmeldung, auch in der Gruppenansicht', async () => {
    const { GET } = await import('../../src/app/api/marke/[mandant]/[art]/[version]/route.js');
    const aufruf = () => GET(lies(`/api/marke/${ID}/cover/${'a'.repeat(16)}`, klick('/portal/reinigung')),
      { params: Promise.resolve({ mandant: ID, art: 'cover', version: 'a'.repeat(16) }) });
    const ohne = await aufruf();
    expect(ohne.status).toBe(404);
    expect(await ohne.text()).toBe('{"fehler":"nicht_gefunden"}');
    zustand.sitzung = { benutzerId: 'b', aktiverMandantId: null, ansicht: 'gruppe' };
    expect((await aufruf()).status).toBe(404);
  });
});
