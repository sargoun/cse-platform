/**
 * **Die Kästen der Website sind Hinweise** (DESIGN §5 „Notices", V-217;
 * Nachrunde zu V-272, D-770).
 *
 * **Der Befund.** Sieben Kästen der Website bauten einen Hinweis aus Klassen
 * nach, eine Abweisung in `border-danger bg-danger-soft` — einem Ton, den
 * DESIGN für Hinweise nicht kennt („There is no `danger` notice"):
 * Angebotsformular, Angebotsauswahl, Datenschutzanfrage, Barriere-Meldung
 * (Abweisung und Dank), Karriere (Seite und Formular) und Werbewiderspruch.
 * Der Werbewiderspruch trug dazu auch bei der angenommenen Erklärung
 * `role="alert"`: ein Screenreader kündigte die Bestätigung wie einen Fehler
 * an.
 *
 * Geprüft wird (1) am Quelltext der ganzen Website, dass kein Kasten mehr
 * nachgebaut ist und jeder Anker in einem `Hinweis` mit der richtigen Art und
 * Rolle steht, und (2) gerendert, für die Seiten, die kein anderer Test
 * zeichnet: Werbewiderspruch und Karriere. Die Meldung AM FELD bleibt am Feld
 * (§5 Forms: Rand und Text in `--danger`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as React from 'react';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/* Die Bauteile erwarten `React` im Geltungsbereich (klassische JSX-Umwandlung, V-153). */
(globalThis as { React?: typeof React }).React = React;

vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/oeffentlich', () => ({
  withOeffentlich: <T,>(_tx: unknown, fn: (k: unknown) => Promise<T>) => fn({
    abfrage: () => Promise.resolve([{ slug: 'reinigung', name: 'CSE Dienstleistungen GmbH' }]),
  }),
}));
vi.mock('@/server/inhalt/seiten-daten', () => ({
  basisAusAnfrage: () => Promise.resolve('https://cse.example'),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));
vi.mock('../../src/app/(public)/karriere/daten.js', () => ({
  offeneStellen: () => Promise.resolve([]),
  // Der Bereichsfilter (V-364) liest die Gesellschaften.
  bereiche: () => Promise.resolve([]),
}));

const { WerbewiderspruchSeiteFuer } =
  await import('../../src/app/(public)/werbewiderspruch/Werbewiderspruch.js');
const { Bewerbungsformular } = await import('../../src/app/(public)/karriere/Formular.js');
const { default: KarriereSeite } = await import('../../src/app/(public)/karriere/page.js');
const { BEWERBUNG_MELDUNG } = await import('../../src/app/(public)/karriere/meldung.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const WEBSITE = ['src/app/(public)', 'src/components/oeffentlich'];

function baum(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return baum(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

/** Der Quelltext ohne Kommentare — eine Erwähnung ist kein Kasten. */
function ohneKommentare(q: string): string {
  return q.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/(^|\s)\/\/.*$/gmu, '$1');
}

/** Ein gezeichneter Hinweis: Anker, Art, Rolle und Text. */
interface Kasten { readonly cse: string; readonly art: string; readonly rolle: string; readonly text: string }

function kaesten(html: string): readonly Kasten[] {
  return [...html.matchAll(
    /<section data-cse="([^"]+)" data-art="([a-z]+)" role="([a-z]+)"[^>]*>([\s\S]*?)<\/section>/gu)]
    .map((m) => ({ cse: m[1] ?? '', art: m[2] ?? '', rolle: m[3] ?? '', text: m[4] ?? '' }));
}

describe('(1) am Quelltext: kein Kasten der Website ist mehr nachgebaut', () => {
  const dateien = WEBSITE.flatMap((d) => baum(join(WURZEL, d)));

  it('die Prüfung liest die Website', () => {
    expect(dateien.length).toBeGreaterThan(40);
  });

  it('kein `bg-danger-soft` und kein `bg-success-soft` — die Flächen eines Hinweises', () => {
    const treffer = dateien.flatMap((d) => {
      const q = ohneKommentare(readFileSync(d, 'utf8'));
      return /bg-(?:danger|success)-soft/u.test(q) ? [relative(WURZEL, d)] : [];
    });
    expect(treffer, 'einen `Hinweis` (components/ui/Hinweis.tsx) nehmen').toEqual([]);
  });

  it('kein Element trägt `role="alert"` oder `role="status"` selbst — die Rolle setzt der Hinweis', () => {
    const treffer = dateien.flatMap((d) => {
      const q = ohneKommentare(readFileSync(d, 'utf8'));
      return /<[a-z]+\b[^>]*\srole="(?:alert|status)"/u.test(q) ? [relative(WURZEL, d)] : [];
    });
    expect(treffer).toEqual([]);
  });

  /* Jeder Anker, den eine Browserprüfung sucht, steht an seinem Hinweis. */
  it.each([
    ['src/components/oeffentlich/AnfrageFormular.tsx', 'formular-meldung', 'warnung', 'alert'],
    ['src/app/(public)/angebot/Auswahl.tsx', 'angebot-auswahl-meldung', 'warnung', 'alert'],
    ['src/app/(public)/datenschutz/anfrage/Anfrage.tsx', 'anfrage-meldung', 'warnung', 'alert'],
    ['src/app/(public)/barrierefreiheit/feedback/Feedback.tsx', 'barriere-meldung', 'warnung', 'alert'],
    ['src/app/(public)/barrierefreiheit/feedback/Feedback.tsx', 'barriere-danke', 'erfolg', 'status'],
    ['src/app/(public)/karriere/page.tsx', 'bewerbung-meldung', 'warnung', 'alert'],
    ['src/app/(public)/karriere/Formular.tsx', 'bewerbung-meldung', 'warnung', 'alert'],
  ] as const)('%s: „%s" ist ein Hinweis %s mit role="%s"', (datei, cse, art, rolle) => {
    const q = readFileSync(join(WURZEL, datei), 'utf8');
    const tag = new RegExp(`<Hinweis\\b[^>]*\\bcse="${cse}"[^>]*>`, 'u').exec(q)?.[0] ?? '';
    expect(tag, `kein Hinweis „${cse}"`).not.toBe('');
    expect(tag).toContain(`art="${art}"`);
    expect(tag).toContain(`rolle="${rolle}"`);
  });

  it('die Meldung am Feld bleibt am Feld — Rand und Text in `--danger` (§5 Forms)', () => {
    const q = readFileSync(join(WURZEL, 'src/components/oeffentlich/AnfrageFormular.tsx'), 'utf8');
    expect(q).toContain("'border-danger'");
    expect(q).toMatch(/<p id=\{fehlerId\} className="text-xs text-danger">\{fehler\}<\/p>/u);
  });
});

describe('(2) gerendert: Art und Rolle folgen dem Ausgang', () => {
  it('Werbewiderspruch: die Bestätigung ist ein Erfolg mit role="status" — nicht mehr „alert"', async () => {
    for (const sprache of ['de', 'en'] as const) {
      const html = renderToStaticMarkup(await WerbewiderspruchSeiteFuer(sprache, 'entgegengenommen'));
      const [k, ...weitere] = kaesten(html);
      expect(weitere).toEqual([]);
      expect(k).toMatchObject({ cse: 'werbewiderspruch-meldung', art: 'erfolg', rolle: 'status' });
      expect(html).not.toContain('role="alert"');
    }
  });

  it.each(['email_ungueltig', 'ohne_gesellschaft', 'zu_viele'])(
    'Werbewiderspruch: „%s" ist eine Warnung mit role="alert"', async (stand) => {
      const html = renderToStaticMarkup(await WerbewiderspruchSeiteFuer('de', stand));
      expect(kaesten(html)).toEqual([
        expect.objectContaining({ cse: 'werbewiderspruch-meldung', art: 'warnung', rolle: 'alert' }),
      ]);
    });

  it('Werbewiderspruch: ein fremder Stand zeigt keinen Kasten', async () => {
    const html = renderToStaticMarkup(await WerbewiderspruchSeiteFuer('de', '__proto__'));
    expect(kaesten(html)).toEqual([]);
  });

  it('Karriere: Seite und Formular zeigen eine Abweisung als Warnung mit role="alert"', async () => {
    const seite = renderToStaticMarkup(await KarriereSeite({
      searchParams: Promise.resolve({ fehler: 'stelle_geschlossen' }),
    }));
    expect(kaesten(seite)).toEqual([{
      cse: 'bewerbung-meldung', art: 'warnung', rolle: 'alert',
      text: BEWERBUNG_MELDUNG['stelle_geschlossen'],
    }]);
    const formular = renderToStaticMarkup(createElement(Bewerbungsformular, {
      stelleId: null, aufbewahrungTage: 180, meldung: BEWERBUNG_MELDUNG['unvollstaendig'],
    }));
    expect(kaesten(formular)).toEqual([expect.objectContaining({
      cse: 'bewerbung-meldung', art: 'warnung', rolle: 'alert',
    })]);
    /* Ohne Abweisung kein Kasten. */
    const ohne = renderToStaticMarkup(await KarriereSeite({ searchParams: Promise.resolve({}) }));
    expect(kaesten(ohne)).toEqual([]);
  });
});
