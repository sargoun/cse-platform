/**
 * Das Angebotsformular kommt mit SCHLÜSSELN zurück — dem Grund und den Namen
 * der Felder, nie mit einem Satz aus der Adresse (D-769, V-272; D-599, D-728,
 * V-157, V-160).
 *
 * **Der Befund.** `POST /api/anfrage` schickte eine Abweisung als
 * `?meldung=<Sammelsatz>&felder=<JSON mit den Feldmeldungen>` auf das
 * Formular zurück, und die Seite zeigte beides so, wie es in der Adresse
 * stand: den Satz im `role="alert"`-Kasten, jede „Meldung" unter ihrem Feld.
 * Jeder präparierte Link schrieb damit seinen eigenen Text in das Formular, an
 * dem Umsatz ankommt — deutsch und englisch. Die Meldung eines Dateifelds kam
 * als deutscher Definitionstext auch unter `/en`, und ein Bereich, den es
 * nicht gibt, führte auf die Auswahl, die den Satz nicht las.
 *
 * Geprüft wird die ECHTE Route: ersetzt sind nur die Datenbank, ihre zwei
 * Kontexte, der Speicher und die Bestätigungsmail. Die Annahme `nimmAn` läuft
 * echt, solange ein Fall sie nicht ausdrücklich werfen lässt — ihre Prüfung
 * gegen die Formularversion steht vor der ersten Datenbankzeile. Dazu die
 * Tabelle der Sätze und die gerenderten Seiten (Formular und Auswahl).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  ANGEBOT_FEHLER_GRUENDE, ANGEBOT_FEHLER_TEXTE, API_TEXTE,
} from '../../src/lib/i18n/texte.js';
import { uebersetzeFelder, uebersetzeFeldmeldungen } from '../../src/lib/i18n/formular-en.js';
import { FORMULARE, type FormularVorlage } from '../../src/server/db/seed/formulare.js';
import { FormularFehler } from '../../src/lib/formular/schema.js';
import { NichtVerbundenFehler } from '../../src/server/storage/adapter.js';
import type * as Annahme from '../../src/server/services/lead/annahme.js';

/* Die Bauteile erwarten `React` im Geltungsbereich (klassische JSX-Umwandlung, V-153). */
(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  /** Die veröffentlichte Formularversion je Schlüssel — fehlt einer, ist keine veröffentlicht. */
  formulare: new Map<string, Record<string, unknown>>(),
  /** Wie oft eine öffentliche Lesung die Datenbank erreichte. */
  lesungen: 0,
  nimmAn: vi.fn(),
  ladeHoch: vi.fn(),
  bestaetige: vi.fn(),
}));

vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/oeffentlich', () => ({
  withOeffentlich: <T,>(_tx: unknown, fn: (k: unknown) => Promise<T>) => fn({
    abfrage: (_sql: string, werte: readonly unknown[] = []) => {
      zustand.lesungen += 1;
      const zeile = zustand.formulare.get(String(werte[0]));
      return Promise.resolve(zeile === undefined ? [] : [zeile]);
    },
  }),
}));
vi.mock('@/server/kontext/eingang', () => ({
  withEingang: <T,>(_tx: unknown, _mandant: string, fn: (k: unknown) => Promise<T>) => fn({
    abfrage: (sql: string) => Promise.resolve(/formular_zustaendigkeit/u.test(sql)
      ? [{ sla_stunden: 24, besitzer: '00000000-0000-4000-8000-0000000000b1' }] : [{ jahr: 2026 }]),
    schreibe: () => Promise.resolve([]),
  }),
}));
vi.mock('@/server/services/lead/annahme', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  nimmAn: (...a: unknown[]) => zustand.nimmAn(...a) as unknown,
}));
vi.mock('@/server/services/lead/bestaetigung', () => ({
  bestaetige: (...a: unknown[]) => zustand.bestaetige(...a) as unknown,
}));
vi.mock('@/server/services/dokument/upload', () => ({
  ladeHoch: (...a: unknown[]) => zustand.ladeHoch(...a) as unknown,
}));
vi.mock('@/server/storage/waehle', () => ({ waehleSpeicher: () => ({}) }));
vi.mock('@/server/inhalt/seiten-daten', () => ({
  basisAusAnfrage: () => Promise.resolve('https://cse.example'),
  herkunftDerAnfrage: () => Promise.resolve({ utm: {} }),
}));
vi.mock('@/server/inhalt/lesen', () => ({
  bereicheLesen: () => Promise.resolve([]),
  oeffentlichLesen: () => Promise.resolve([
    { slug: 'reinigung', name: 'CSE Dienstleistungen GmbH', kurzbeschreibung: null },
    { slug: 'bau', name: 'REALTIME Service GmbH', kurzbeschreibung: null },
  ]),
}));

const echt = await vi.importActual<typeof Annahme>('../../src/server/services/lead/annahme.js');
/* Die Klasse, die die Route kennt — aus dem Modul, das sie importiert. */
const { RatenlimitFehler } = await import('../../src/server/services/lead/annahme.js');
const { POST } = await import('../../src/app/api/anfrage/route.js');
const { AngebotSeiteFuer, abweisungAus } =
  await import('../../src/app/(public)/angebot/[bereich]/Angebot.js');
const { Angebotsauswahl } = await import('../../src/app/(public)/angebot/Auswahl.js');
const { DankeSeiteFuer } = await import('../../src/app/(public)/angebot/[bereich]/danke/Danke.js');
const { FORMULAR_SCHLUESSEL, formularSchluessel } = await import('../../src/lib/formular/bereiche.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'https://cse.example';
const MANDANT = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/u;

const vorlage = (slug: string): FormularVorlage => {
  const v = FORMULARE.find((f) => f.slug === slug);
  if (v === undefined) throw new Error(slug);
  return v;
};
const REINIGUNG = vorlage('reinigung');
const BAU = vorlage('bau');

/** Die Zeile, die beide Abfragen (Route und Seite) aus `formular_definition` lesen. */
function veroeffentlicht(v: FormularVorlage, felder: unknown = v.felder): void {
  zustand.formulare.set(v.schluessel, {
    id: '00000000-0000-4000-8000-0000000000f1', mandant_id: MANDANT, schluessel: v.schluessel,
    titel: v.titel, felder, datenschutz_hinweis_version: '2026-09-01',
  });
}

/** Eine vollständige, gültige Reinigungsanfrage — so, wie das Formular sie schickt. */
const REINIGUNG_GUT: Readonly<Record<string, string>> = {
  bereich: 'reinigung', gebaeudetyp: 'buero', flaeche_qm: '250', anzahl_objekte: '2',
  frequenz: 'woechentlich', wunsch_start: '2026-10-01', firma: 'Muster Hausverwaltung GmbH',
  name: 'Erika Muster', email: 'erika@muster.example', telefon: '+49 30 5550100',
  nachricht: '', datenschutz_hinweis: 'on',
};
const BAU_GUT: Readonly<Record<string, string>> = {
  bereich: 'bau', gewerk: 'hochbau', volumen: '3 Etagen', fertigstellung_bis: '2027-01-01',
  firma: 'Bau Muster GmbH', name: 'Bernd Muster', email: 'bernd@muster.example',
  telefon: '+49 30 5550100', datenschutz_hinweis: 'on',
};
const PDF = new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'));

function post(felder: Readonly<Record<string, string>>, datei?: File): Request {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  if (datei !== undefined) daten.append('lv_datei', datei);
  return new Request(`${HIER}/api/anfrage`, { method: 'POST', body: daten });
}

beforeEach(() => {
  zustand.formulare.clear();
  veroeffentlicht(REINIGUNG);
  veroeffentlicht(BAU);
  zustand.nimmAn.mockReset().mockImplementation(echt.nimmAn);
  zustand.ladeHoch.mockReset();
  zustand.bestaetige.mockReset().mockResolvedValue(undefined);
});

/** Die Gründe, mit denen die Route in diesem Lauf wirklich zurückkam. */
const gesehen = new Set<string>();

/**
 * Eine Umleitung auf eine Seite: nur `?fehler=<grund>` und, wo ein Feld
 * gemeint ist, `&felder=<schlüssel>` — kein Satz, keine Eingabe, keine Kennung.
 */
function zurueck(
  antwort: Response, pfad: string, grund: string, felder: readonly string[],
  eingaben: readonly string[],
): void {
  expect(antwort.status).toBe(303);
  const ort = antwort.headers.get('location') ?? '';
  const ziel = new URL(ort);
  expect(ziel.origin).toBe(HIER);
  expect(ziel.pathname).toBe(pfad);
  expect([...ziel.searchParams.keys()].sort())
    .toEqual(felder.length === 0 ? ['fehler'] : ['fehler', 'felder']);
  expect(ziel.searchParams.get('fehler')).toBe(grund);
  expect((ziel.searchParams.get('felder') ?? '').split(',').filter((f) => f !== '').sort())
    .toEqual([...felder].sort());
  expect(ort).not.toContain('meldung');
  expect(ort).not.toMatch(UUID);
  for (const e of eingaben) expect(decodeURIComponent(ort), e).not.toContain(e);
  gesehen.add(grund);
}

/* ── POST /api/anfrage: der Browser bekommt Schlüssel ──────────────────── */

describe('POST /api/anfrage — der Rückweg trägt einen Grund und Feldschlüssel', () => {
  it('pruefen: die markierten Felder als Schlüssel — nie ihre Werte', async () => {
    const r = await POST(post({
      ...REINIGUNG_GUT, anzahl_objekte: '', email: 'erika-at-muster', antwort: 'seite',
    }));
    zurueck(r, '/angebot/reinigung', 'pruefen', ['anzahl_objekte', 'email'],
      ['erika-at-muster', 'Muster Hausverwaltung', 'Bitte']);
  });

  it('datenschutzBestaetigen: allein das Häkchen fehlt — derselbe Grund wie der Satz', async () => {
    const ohne = Object.fromEntries(
      Object.entries(REINIGUNG_GUT).filter(([k]) => k !== 'datenschutz_hinweis'));
    const r = await POST(post({ ...ohne, antwort: 'seite', sprache: 'en' }));
    zurueck(r, '/en/angebot/reinigung', 'datenschutzBestaetigen', ['datenschutz_hinweis'], []);
  });

  it('dateiZuGross und dateityp: das Dateifeld reist als Schlüssel', async () => {
    veroeffentlicht(BAU, BAU.felder.map((f) => (f.typ === 'datei' ? { ...f, maxBytes: 16 } : f)));
    const gross = await POST(post({ ...BAU_GUT, antwort: 'seite' },
      new File([PDF], 'lv.pdf', { type: 'application/pdf' })));
    zurueck(gross, '/angebot/bau', 'dateiZuGross', ['lv_datei'], ['lv.pdf']);

    veroeffentlicht(BAU);
    const text = await POST(post({ ...BAU_GUT, antwort: 'seite', sprache: 'en' },
      new File(['Das ist kein PDF, sondern Text.'], 'leistungsverzeichnis.pdf',
        { type: 'application/pdf' })));
    zurueck(text, '/en/angebot/bau', 'dateityp', ['lv_datei'], ['leistungsverzeichnis']);
  });

  it('uploadNichtVerbunden: kein simulierter Erfolg, und nur der Grund reist', async () => {
    zustand.ladeHoch.mockRejectedValue(new NichtVerbundenFehler('Supabase Storage'));
    const r = await POST(post({ ...BAU_GUT, antwort: 'seite' },
      new File([PDF], 'lv.pdf', { type: 'application/pdf' })));
    zurueck(r, '/angebot/bau', 'uploadNichtVerbunden', [], ['Supabase']);
    expect(zustand.nimmAn).not.toHaveBeenCalled();
  });

  it('zuVieleAnfragen: das Ratenlimit — nicht sein Satz', async () => {
    zustand.nimmAn.mockRejectedValue(new RatenlimitFehler(900));
    const r = await POST(post({ ...REINIGUNG_GUT, antwort: 'seite' }));
    zurueck(r, '/angebot/reinigung', 'zuVieleAnfragen', [], ['Verbindung']);
  });

  it.each([
    ['automatisiert', 'nichtGespeichert'], ['sonst', 'nichtGespeichert'],
    ['zu_viele', 'zuVieleAnfragen'], ['pruefen', 'pruefen'],
  ] as const)('ein FormularFehler mit Grund „%s" reist als „%s"', async (grund, schluessel) => {
    zustand.nimmAn.mockRejectedValue(new FormularFehler(
      `Satz mit Kennung ${MANDANT}`, { firma: 'x', '': 'unbekanntes Feld' }, grund));
    const r = await POST(post({ ...REINIGUNG_GUT, antwort: 'seite' }));
    /* Nur Schlüssel in der Form eines Feldschlüssels — der leere des Zod-Befunds fällt weg. */
    zurueck(r, '/angebot/reinigung', schluessel, ['firma'], ['Satz mit Kennung']);
  });

  it('nichtGespeichert: ein Fehler der Datenbank wird der allgemeine Grund, nie ihr Text', async () => {
    zustand.nimmAn.mockRejectedValue(new Error('deadlock detected on relation "lead"'));
    const r = await POST(post({ ...REINIGUNG_GUT, antwort: 'seite', sprache: 'en' }));
    zurueck(r, '/en/angebot/reinigung', 'nichtGespeichert', [], ['deadlock', 'relation']);
  });

  it('keinFormular: ein Bereich, den es nicht gibt, führt auf die Auswahl — mit Grund', async () => {
    const de = await POST(post({ bereich: 'gibtsnicht', antwort: 'seite' }));
    zurueck(de, '/angebot', 'keinFormular', [], ['gibtsnicht']);
    const en = await POST(post({ bereich: 'gibtsnicht', antwort: 'seite', sprache: 'en' }));
    zurueck(en, '/en/angebot', 'keinFormular', [], []);
  });

  it('keinFormular und nichtVerfuegbar: ohne zeigbares Formular geht es auf die Auswahl', async () => {
    /* Sein Formular antwortete darauf mit 404 bzw. der Fehlerseite — der Satz ging verloren. */
    zustand.formulare.delete(REINIGUNG.schluessel);
    zurueck(await POST(post({ ...REINIGUNG_GUT, antwort: 'seite' })),
      '/angebot', 'keinFormular', [], []);
    veroeffentlicht(REINIGUNG, [{ kaputt: true }]);
    zurueck(await POST(post({ ...REINIGUNG_GUT, antwort: 'seite', sprache: 'en' })),
      '/en/angebot', 'nichtVerfuegbar', [], []);
  });

  it('Erfolg bleibt, wie er war: die Dankseite mit der Vorgangsnummer', async () => {
    zustand.nimmAn.mockResolvedValue({ leadnummer: 'L-7Q2K', slaFristAm: new Date() });
    const r = await POST(post({ ...REINIGUNG_GUT, antwort: 'seite' }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}/angebot/reinigung/danke?nr=L-7Q2K`);
  });

  it('jeder Grund, mit dem die Route zurückkam, steht in der Liste — und keiner mehr', () => {
    expect([...gesehen].sort()).toEqual([...ANGEBOT_FEHLER_GRUENDE].sort());
  });
});

/* ── POST /api/anfrage: ein Programm bekommt JSON wie bisher (D-599) ────── */

describe('POST /api/anfrage — ein Programm bekommt weiter JSON mit Satz und Feldmeldungen', () => {
  const json = async (r: Response): Promise<unknown> => {
    expect(r.headers.get('location')).toBeNull();
    return r.json();
  };

  it('pruefen: deutsch der Satz des Dienstes und die Meldungen der Definition', async () => {
    const r = await POST(post({ ...REINIGUNG_GUT, anzahl_objekte: '', email: 'kaputt' }));
    expect(r.status).toBe(400);
    const def = (k: string): string => REINIGUNG.felder.find((f) => f.schluessel === k)!.fehlermeldung;
    expect(await json(r)).toEqual({
      ok: false, meldung: 'Bitte prüfen Sie die markierten Felder.',
      felder: { anzahl_objekte: def('anzahl_objekte'), email: def('email') },
    });
  });

  it('pruefen: englisch der Satz zum Grund und die übersetzten Feldmeldungen', async () => {
    const r = await POST(post({ ...REINIGUNG_GUT, anzahl_objekte: '', sprache: 'en' }));
    const def = REINIGUNG.felder.find((f) => f.schluessel === 'anzahl_objekte')!.fehlermeldung;
    expect(await json(r)).toEqual({
      ok: false, meldung: API_TEXTE.en.pruefen,
      felder: uebersetzeFeldmeldungen(REINIGUNG.schluessel, { anzahl_objekte: def }),
    });
  });

  it.each([
    ['keinFormular', 404, { bereich: 'gibtsnicht' }],
    ['zuVieleAnfragen', 429, {}],
    ['nichtGespeichert', 500, {}],
  ] as const)('%s: Status %i und der Satz aus API_TEXTE', async (grund, status, felder) => {
    if (grund === 'zuVieleAnfragen') zustand.nimmAn.mockRejectedValue(new RatenlimitFehler(9));
    if (grund === 'nichtGespeichert') zustand.nimmAn.mockRejectedValue(new Error('boom'));
    for (const sprache of ['de', 'en'] as const) {
      const r = await POST(post({ ...REINIGUNG_GUT, ...felder, sprache }));
      expect(r.status, sprache).toBe(status);
      expect(await json(r), sprache).toEqual({ ok: false, meldung: API_TEXTE[sprache][grund], felder: {} });
    }
  });

  it('dateityp: die Meldung des Dateifelds bleibt der Text der Definition', async () => {
    const r = await POST(post({ ...BAU_GUT, sprache: 'en' },
      new File(['kein PDF'], 'lv.pdf', { type: 'application/pdf' })));
    expect(r.status).toBe(415);
    const def = BAU.felder.find((f) => f.schluessel === 'lv_datei')!.fehlermeldung;
    expect(await json(r)).toEqual({
      ok: false, meldung: API_TEXTE.en.dateityp, felder: { lv_datei: def },
    });
  });
});

/* ── Die Sätze ───────────────────────────────────────────────────────────── */

describe('die Sätze', () => {
  it('jeder Grund hat in beiden Sprachen den Sammelsatz aus API_TEXTE', () => {
    for (const sprache of ['de', 'en'] as const) {
      const t = ANGEBOT_FEHLER_TEXTE[sprache];
      expect(Object.keys(t.fehler).sort()).toEqual([...ANGEBOT_FEHLER_GRUENDE].sort());
      expect(t.sonst).toBe(API_TEXTE[sprache].nichtGespeichert);
      for (const g of ANGEBOT_FEHLER_GRUENDE) {
        const satz = eigenerEintrag(t.fehler, g);
        expect(satz, `${sprache}.${g}`).toBe(API_TEXTE[sprache][g]);
        expect(satz?.trim(), `${sprache}.${g}`).toBeTruthy();
        if (sprache === 'en') expect(satz).not.toBe(ANGEBOT_FEHLER_TEXTE.de.fehler[g]);
      }
    }
  });

  it('`dank` und `unlesbar` sind keine Gründe — und kein Prototyp-Treffer', () => {
    for (const k of ['dank', 'unlesbar', '__proto__', 'constructor', 'toString', 'Hallo Welt', '']) {
      expect(eigenerEintrag(ANGEBOT_FEHLER_TEXTE.de.fehler, k), k).toBeUndefined();
      expect(eigenerEintrag(ANGEBOT_FEHLER_TEXTE.en.fehler, k), k).toBeUndefined();
    }
  });
});

/* ── Die Seiten ──────────────────────────────────────────────────────────── */

/**
 * Der Text im Kasten mit `role="alert"` — `null`, wenn es keinen gibt. Der
 * Kasten ist ein `Hinweis` `warnung` (DESIGN §5 „Notices", Nachrunde zu
 * V-272); hier stand ein nachgebautes `<p role="alert">`.
 */
function warnung(html: string): string | null {
  const m = /<section data-cse="[^"]+" data-art="([a-z]+)" role="alert"[^>]*>([^<]*)<\/section>/u
    .exec(html);
  if (m === null) return null;
  expect(m[1], 'die Abweisung ist ein Hinweis „warnung"').toBe('warnung');
  return m[2] ?? null;
}
/** Die Meldung unter einem Feld — `null`, wenn es keine gibt. */
function amFeld(html: string, schluessel: string): string | null {
  return new RegExp(`<p id="f_${schluessel}_fehler"[^>]*>([^<]*)</p>`, 'u').exec(html)?.[1] ?? null;
}

describe('die Formularseite schlägt nach — und liest nur Schlüssel', () => {
  it('abweisungAus: nur Felder der Definition, jede mit ihrer eigenen Meldung', () => {
    const a = abweisungAus({ fehler: 'pruefen', felder: 'anzahl_objekte,email,gibtsnicht,__proto__' },
      REINIGUNG.felder, 'de');
    const def = (k: string): string => REINIGUNG.felder.find((f) => f.schluessel === k)!.fehlermeldung;
    expect(a).toEqual({
      satz: API_TEXTE.de.pruefen,
      felder: { anzahl_objekte: def('anzahl_objekte'), email: def('email') },
    });
    /* Ohne Grund keine Abweisung — auch nicht mit Feldern. */
    expect(abweisungAus({ felder: 'firma' }, REINIGUNG.felder, 'de')).toBeNull();
    /* Ein fremder Grund bekommt den allgemeinen Satz. */
    expect(abweisungAus({ fehler: 'dank' }, REINIGUNG.felder, 'en')?.satz)
      .toBe(ANGEBOT_FEHLER_TEXTE.en.sonst);
  });

  it('englisch: Sammelsatz und Feldmeldung englisch — auch die des Dateifelds', async () => {
    const html = renderToStaticMarkup(await AngebotSeiteFuer('bau', 'en',
      { fehler: 'dateityp', felder: 'lv_datei' }));
    expect(warnung(html)).toBe(API_TEXTE.en.dateityp);
    const en = uebersetzeFelder(BAU.schluessel, BAU.felder).find((f) => f.schluessel === 'lv_datei')!;
    expect(amFeld(html, 'lv_datei')).toBe(en.fehlermeldung);
    /* Vorher stand hier der deutsche Text der Definition. */
    expect(html).not.toContain('Bitte laden Sie');
    expect(html).toMatch(/id="f_lv_datei"[^>]*aria-invalid="true"/u);
  });

  it('deutsch: die Meldung der Definition am Feld, der Satz der Tabelle darüber', async () => {
    const html = renderToStaticMarkup(await AngebotSeiteFuer('reinigung', 'de',
      { fehler: 'pruefen', felder: 'anzahl_objekte' }));
    expect(warnung(html)).toBe(API_TEXTE.de.pruefen);
    expect(amFeld(html, 'anzahl_objekte'))
      .toBe(REINIGUNG.felder.find((f) => f.schluessel === 'anzahl_objekte')!.fehlermeldung);
    expect(amFeld(html, 'firma')).toBeNull();
  });

  it('ein präparierter Link schreibt nichts: fremder Grund → allgemeiner Satz, alte Parameter → nichts',
    async () => {
      const fremd = renderToStaticMarkup(await AngebotSeiteFuer('reinigung', 'de',
        { fehler: 'Ihr Konto ist gesperrt. Rufen Sie 0900 an.', felder: 'firma,__proto__' }));
      expect(warnung(fremd)).toBe(ANGEBOT_FEHLER_TEXTE.de.sonst);
      expect(fremd).not.toContain('0900');
      expect(amFeld(fremd, 'firma'))
        .toBe(REINIGUNG.felder.find((f) => f.schluessel === 'firma')!.fehlermeldung);

      const alt = renderToStaticMarkup(await AngebotSeiteFuer('reinigung', 'en', {
        meldung: 'Rufen Sie 0900 an.', felder: JSON.stringify({ firma: 'Rufen Sie 0900 an.' }),
      }));
      expect(warnung(alt)).toBeNull();
      expect(alt).not.toContain('0900');
      expect(amFeld(alt, 'firma')).toBeNull();
    });
});

describe('die Auswahl zeigt den Satz, den sie früher verlor', () => {
  it.each(['de', 'en'] as const)('%s: keinFormular → Satz; ein fremder Grund → allgemeiner Satz',
    async (sprache) => {
      const mit = renderToStaticMarkup(await Angebotsauswahl({ sprache, suche: { fehler: 'keinFormular' } }));
      expect(warnung(mit)).toBe(API_TEXTE[sprache].keinFormular);
      const fremd = renderToStaticMarkup(await Angebotsauswahl({ sprache, suche: { fehler: 'toString' } }));
      expect(warnung(fremd)).toBe(ANGEBOT_FEHLER_TEXTE[sprache].sonst);
      const ohne = renderToStaticMarkup(await Angebotsauswahl({ sprache, suche: { meldung: 'x' } }));
      expect(warnung(ohne)).toBeNull();
    });
});

describe('am Quelltext: keine Seite liest `meldung`, keine Route schreibt einen Satz', () => {
  const P = 'src/app/(public)';
  it.each([
    `${P}/angebot/[bereich]/page.tsx`, `${P}/en/angebot/[bereich]/page.tsx`,
    `${P}/angebot/[bereich]/Angebot.tsx`, `${P}/angebot/Auswahl.tsx`,
    'src/components/oeffentlich/AnfrageFormular.tsx',
  ])('%s', (datei) => {
    const s = readFileSync(join(WURZEL, datei), 'utf8');
    expect(s).not.toMatch(/\[\s*'meldung'\s*\]|suche\.meldung|searchParams\.meldung|JSON\.parse/u);
  });

  it('die Route baut die Adresse nur aus Grund und Feldschlüsseln', () => {
    const s = readFileSync(join(WURZEL, 'src/app/api/anfrage/route.ts'), 'utf8');
    expect(s).not.toMatch(/meldung=|encodeURIComponent\(\s*(?:meldung|fehler)|JSON\.stringify\(felder/u);
    expect(s).toContain("adresse.searchParams.set('fehler', abweisung)");
  });

  it('die Seiten schlagen nur als eigenen Eintrag nach', () => {
    expect(readFileSync(join(WURZEL, P, 'angebot/[bereich]/Angebot.tsx'), 'utf8'))
      .toContain('eigenerEintrag(t.fehler, grund) ?? t.sonst');
    expect(readFileSync(join(WURZEL, P, 'angebot/Auswahl.tsx'), 'utf8'))
      .toContain('eigenerEintrag(fehlerTexte.fehler, grund) ?? fehlerTexte.sonst');
  });
});

/* ── Nachrunde: ein Name des Prototyps ist kein Bereich ─────────────────── */

/**
 * **`formularSchluessel` schlägt nur einen EIGENEN Eintrag nach** (D-728,
 * Nachrunde zu V-272).
 *
 * Hier stand `FORMULAR_SCHLUESSEL[bereich]`. `toString`, `constructor` und
 * `__proto__` fanden eine Funktion bzw. `Object.prototype` und galten als
 * bekannter Bereich: Seite und Route fragten die Datenbank nach einem
 * Formular namens „function Object() { [native code] }", und
 * `/angebot/__proto__/danke?nr=…` bestätigte eine Anfrage, die es nie geben
 * konnte. Geprüft an der echten Seite und der echten Route.
 */
describe('Nachrunde: ein Name des Prototyps ist kein Bereich', () => {
  const PROTOTYP = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];

  /** Der Wurf von `notFound()` — Next.js antwortet darauf mit 404. */
  const istNichtGefunden = (e: unknown): boolean =>
    (e as { digest?: unknown } | null)?.digest === 'NEXT_HTTP_ERROR_FALLBACK;404';

  it('formularSchluessel kennt die vier Bereiche — und keinen Namen des Prototyps', () => {
    for (const [bereich, schluessel] of Object.entries(FORMULAR_SCHLUESSEL)) {
      expect(formularSchluessel(bereich), bereich).toBe(schluessel);
    }
    for (const k of [...PROTOTYP, '', 'gibtsnicht']) {
      expect(formularSchluessel(k), k).toBeUndefined();
    }
  });

  it.each(PROTOTYP)('/angebot/%s ist 404 — ohne Frage an die Datenbank, kein 500', async (bereich) => {
    zustand.lesungen = 0;
    for (const sprache of ['de', 'en'] as const) {
      const wurf = await AngebotSeiteFuer(bereich, sprache, {}).then(() => null, (e: unknown) => e);
      expect(istNichtGefunden(wurf), `${sprache}: ${String(wurf)}`).toBe(true);
    }
    /* Und die Dankseite bestätigt keine Anfrage für einen solchen „Bereich". */
    let dank: unknown = null;
    try { DankeSeiteFuer(bereich, 'L-7Q2K'); } catch (e) { dank = e; }
    expect(istNichtGefunden(dank), String(dank)).toBe(true);
    expect(zustand.lesungen).toBe(0);
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'POST /api/anfrage mit bereich=%s weist mit dem vorhandenen Grund ab', async (bereich) => {
      zustand.lesungen = 0;
      const seite = await POST(post({ ...REINIGUNG_GUT, bereich, antwort: 'seite' }));
      expect(seite.status).toBe(303);
      expect(seite.headers.get('location')).toBe(`${HIER}/angebot?fehler=keinFormular`);

      const programm = await POST(post({ ...REINIGUNG_GUT, bereich, sprache: 'en' }));
      expect(programm.status).toBe(404);
      expect(await programm.json())
        .toEqual({ ok: false, meldung: API_TEXTE.en.keinFormular, felder: {} });
      /* Kein Formular wurde gesucht und keine Annahme versucht. */
      expect(zustand.lesungen).toBe(0);
      expect(zustand.nimmAn).not.toHaveBeenCalled();
    });
});
