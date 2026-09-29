/**
 * `?hinweis=__proto__` bringt die Richtlinienseiten nicht mehr zum Absturz —
 * und `ziel=__proto__` die Route nicht mehr zum 500 (D-728, D-774 Nachrunde).
 *
 * **Der Befund.** Drei Bildschirme des Ausgangs-Gates (Agentenzentrum: Liste
 * und Blatt; Einstellungen) schlugen den Hinweis aus der Adresse mit
 * `HINWEIS_TEXT[suche['hinweis']]` nach. `HINWEIS_TEXT` erbt von
 * `Object.prototype`: `?hinweis=__proto__` fand ein Objekt,
 * `?hinweis=constructor` eine Funktion — nicht `undefined`, also griff der
 * Rückfall nicht, und React warf beim Zeigen. Die Route
 * `POST /api/einstellungen/agent-richtlinien` schlug das Formularfeld `ziel`
 * genauso in `ZIELE` nach: `ziel=__proto__` wurde „bauer is not a function".
 *
 * Geprüft wird die Nachschlagefunktion der Seiten (auch gerendert, gegen die
 * alte Form), am Quelltext, dass alle drei Seiten sie benutzen, und die ECHTE
 * Route (ersetzt sind nur Sitzung, Datenbank, Tor und Dienst).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Hinweis } from '../../src/components/ui/Hinweis.js';

(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  setze: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', () => ({
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) =>
    fn({ abfrage: () => Promise.resolve([]), schreibe: () => Promise.resolve([]) }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: () => Promise.resolve() }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/services/agent/richtlinie', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setzeRichtlinie: zustand.setze,
}));

const { HINWEIS_TEXT } = await import('../../src/server/services/agent/richtlinie.js');
const { richtlinienHinweis } = await import('../../src/app/portal/[mandant]/agenten/richtlinien/hinweis.js');
const route = await import('../../src/app/api/einstellungen/agent-richtlinien/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const FREMDE = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'Hallo Welt', ''];

/** Genau der Ausdruck der Seiten: `{hinweis === null ? null : <Hinweis …>{hinweis}</Hinweis>}`. */
const kasten = (hinweis: unknown): string => renderToStaticMarkup(createElement('div', null,
  hinweis === null ? null : createElement(Hinweis, {
    art: 'hinweis', cse: 'richtlinien-hinweis', children: hinweis as React.ReactNode,
  })));

describe('die Seiten schlagen `?hinweis=` nur als eigenen Eintrag nach', () => {
  it.each(FREMDE)('`?hinweis=%s` ergibt nichts — und der Kasten bleibt leer', (roh) => {
    expect(richtlinienHinweis({ hinweis: roh })).toBeNull();
    expect(kasten(richtlinienHinweis({ hinweis: roh }))).toBe('<div></div>');
  });

  it('die alte Form fand für `__proto__` ein Objekt — gerendert wirft React', () => {
    const alt = (HINWEIS_TEXT as Readonly<Record<string, unknown>>)['__proto__'] ?? null;
    expect(typeof alt).toBe('object');
    expect(() => kasten(alt)).toThrow(/Objects are not valid as a React child/u);
    expect(typeof (HINWEIS_TEXT as Readonly<Record<string, unknown>>)['constructor']).toBe('function');
  });

  it('ein bekannter Name zeigt seinen Satz, ein doppelter Parameter nichts', () => {
    expect(richtlinienHinweis({ hinweis: 'gesetzt' })).toBe(HINWEIS_TEXT['gesetzt']);
    expect(kasten(richtlinienHinweis({ hinweis: 'gesetzt' }))).toContain('data-cse="richtlinien-hinweis"');
    expect(richtlinienHinweis({ hinweis: ['gesetzt', 'gesetzt'] })).toBeNull();
    expect(richtlinienHinweis({})).toBeNull();
  });

  it.each([
    'src/app/portal/[mandant]/agenten/richtlinien/page.tsx',
    'src/app/portal/[mandant]/agenten/richtlinien/[id]/page.tsx',
    'src/app/portal/[mandant]/einstellungen/agent-richtlinien/page.tsx',
  ])('%s benutzt sie — und schlägt nirgends mehr roh nach', (datei) => {
    const quelle = readFileSync(join(WURZEL, datei), 'utf8');
    expect(quelle).toContain('richtlinienHinweis(');
    expect(quelle).not.toMatch(/HINWEIS_TEXT\[/u);
  });
});

describe('POST /api/einstellungen/agent-richtlinien — `ziel` nur als eigener Eintrag', () => {
  function formular(ziel: string): NextRequest {
    const daten = new FormData();
    daten.append('aktion', 'email_senden');
    daten.append('ziel', ziel);
    return new NextRequest(new URL('/api/einstellungen/agent-richtlinien?mandant=reinigung', HIER), {
      method: 'POST', body: daten, headers: new Headers({ host: 'localhost:3001', origin: HIER }),
    });
  }

  beforeEach(() => {
    zustand.sitzung = {
      benutzerId: '00000000-0000-4000-8000-000000000001',
      aktiverMandantId: '00000000-0000-4000-8000-000000000002',
      personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
      sitzungId: '00000000-0000-4000-8000-000000000003',
    };
    zustand.setze.mockReset().mockResolvedValue(undefined);
  });

  it.each(['__proto__', 'constructor', 'toString', 'irgendwo'])(
    '`ziel=%s` führt auf die Einstellungen — kein 500', async (ziel) => {
      const r = await route.POST(formular(ziel));
      expect(r.status).toBe(303);
      expect(r.headers.get('location'))
        .toBe(`${HIER}/portal/reinigung/einstellungen/agent-richtlinien?hinweis=gesetzt`);
    });

  it('ein bekanntes Ziel bleibt, wie es war', async () => {
    const r = await route.POST(formular('agenten'));
    expect(r.headers.get('location')).toBe(`${HIER}/portal/reinigung/agenten/richtlinien?hinweis=gesetzt`);
  });
});
