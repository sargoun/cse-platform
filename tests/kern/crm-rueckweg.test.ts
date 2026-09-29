/**
 * Der Rückweg der CRM-Formulare trägt Schlüssel, die Seite schlägt nach —
 * die gemeinsamen Teile (D-769, D-772, V-274).
 *
 *  1. `CrmFehler` trägt einen GETYPTEN Grund (`CrmGrund`), und die Liste ist
 *     genau die Menge, die der Baum wirft — kein Grund ohne Wurf, kein Wurf
 *     ohne Grund in der Liste.
 *  2. `gruendeAb` (tests/kern/hilfen/gruende.ts) liest, welche Gründe eine
 *     Route schicken kann; die Gegenprobe zeigt jede Form an erfundenen
 *     Dateien.
 *  3. Der Kasten einer Abweisung und einer Bestätigung (`Rueckweg.tsx`): ein
 *     bekannter Schlüssel wird sein Satz, ein unbekannter — auch `__proto__`
 *     und `constructor` — der allgemeine Satz bzw. gar kein Erfolgskasten;
 *     `rolle="alert"` und `rolle="status"`.
 *  4. `zurueckMitSchluessel` hängt genau einen Schlüssel an und führt nie aus
 *     der Anwendung hinaus.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { CRM_GRUENDE } from '../../src/server/services/crm/anlegen.js';
import {
  Abweisung, Bestaetigung, abweisungsSatz, einSchluessel,
} from '../../src/components/portal/Rueckweg.js';
import { zurueckMitSchluessel } from '../../src/app/api/crm/rueckweg.js';
import { gruendeAb } from './hilfen/gruende.js';

(globalThis as { React?: typeof React }).React = React;

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));
const lies = (d: string): string | null => (existsSync(d) ? readFileSync(d, 'utf8') : null);

function dateien(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return dateien(p);
    return /\.tsx?$/u.test(e) ? [p] : [];
  });
}

/** Die Namen der Funktionen oben in einer Datei (Deklarationen und `const f = (…) =>`). */
function funktionen(quelle: string): readonly string[] {
  return [
    ...[...quelle.matchAll(/^(?:export )?(?:async )?function (\w+)/gmu)].map((m) => m[1] ?? ''),
    ...[...quelle.matchAll(/^(?:export )?const (\w+) = (?:async )?\(/gmu)].map((m) => m[1] ?? ''),
  ];
}

describe('(1) CrmFehler trägt einen getypten Grund — genau die Gründe, die der Baum wirft', () => {
  it('die Liste und die Würfe sind dieselbe Menge', () => {
    const geworfen = new Set<string>();
    const offen: string[] = [];
    for (const datei of [...dateien(join(WURZEL, 'src/server')), ...dateien(join(WURZEL, 'src/app/api'))]) {
      const quelle = readFileSync(datei, 'utf8');
      if (!quelle.includes('new CrmFehler(')) continue;
      for (const f of funktionen(quelle)) {
        const fund = gruendeAb({ datei: relative(WURZEL, datei), funktion: f }, ['CrmFehler'], lies, WURZEL);
        for (const g of fund.gruende) geworfen.add(g);
        offen.push(...fund.offen);
      }
    }
    expect(offen, 'jeder Wurf nennt seinen Grund als festes Wort').toEqual([]);
    expect([...geworfen].sort()).toEqual([...CRM_GRUENDE].sort());
  });

  it('kein Grund steht zweimal in der Liste', () => {
    expect(new Set(CRM_GRUENDE).size).toBe(CRM_GRUENDE.length);
  });
});

describe('(2) gruendeAb — die Gegenprobe an erfundenen Dateien', () => {
  const W = '/x';
  const DATEIEN = new Map<string, string>([
    ['/x/src/app/api/a/route.ts', `
      import { lege, pruefe } from '@/server/services/b/dienst';
      import { authorize } from '@/server/auth/authorize';
      function hier(n: string) { if (n === '') throw new AFehler('leer', 'hier_leer'); }
      export async function POST() {
        await authorize();
        hier('x');
        try { await db().begin(async () => lege({ a: 1 }, 'x', 'gegeben')); } catch (f) { throw f; }
        await pruefe(zweck === 'w' ? 1 : 2);
        throw new AFehler('route', 'route_selbst', 404);
      }`],
    ['/x/src/app/api/a/kein-dienst.ts', `export function fremd() { throw new AFehler('x', 'nie'); }`],
    ['/x/src/server/services/b/dienst.ts', `
      function mitGrund(wert: string, grund: string) {
        if (wert === '') throw new AFehler('Satz', grund);
      }
      export async function lege(e: unknown, w: string, g: string) {
        mitGrund(w, g);
        mitGrund(w, 'fest');
        throw new AFehler('Satz', zweck === 'werbung' ? 'ast_eins' : 'ast_zwei');
      }
      export async function pruefe(n: number) {
        const grund = TABELLE.get(n);
        throw new AFehler('Satz', grund);
      }
      export function unbenutzt() { throw new AFehler('Satz', 'nie_gerufen'); }`],
    ['/x/src/server/auth/authorize.ts', `export function authorize() { throw new AFehler('x', 'nie_auth'); }`],
  ]);
  const fund = gruendeAb({ datei: 'src/app/api/a/route.ts', funktion: 'POST' }, ['AFehler'],
    (d) => DATEIEN.get(d) ?? null, W);

  it('liest feste Wörter, beide Äste, Parameter über den Aufruf, Rückrufe und lokale Helfer', () => {
    expect([...fund.gruende].sort()).toEqual(
      ['ast_eins', 'ast_zwei', 'fest', 'gegeben', 'hier_leer', 'route_selbst']);
  });

  it('nennt, was sich nicht lesen lässt — und geht nicht in fremde Module', () => {
    expect(fund.offen).toEqual(['src/server/services/b/dienst.ts#pruefe:12']);
    expect(fund.gruende.has('nie_auth')).toBe(false);
    expect(fund.gruende.has('nie_gerufen')).toBe(false);
  });

  it('eine Funktion, die es nicht gibt, fällt auf', () => {
    expect(gruendeAb({ datei: 'src/app/api/a/route.ts', funktion: 'GET' }, ['AFehler'],
      (d) => DATEIEN.get(d) ?? null, W).offen).toEqual(['src/app/api/a/route.ts#GET (nicht gefunden)']);
  });
});

describe('(3) der Kasten zeigt nur, was die Seite selbst sagt', () => {
  const SAETZE = {
    titel: 'Nicht gespeichert.',
    sonst: 'Es wurde nichts geändert.',
    fehler: { name_fehlt: 'Ein Kunde braucht einen Namen.' },
  };
  const ERFOLG = { gespeichert: 'Die Angaben sind gespeichert.' };
  const warnung = (grund: string | null): string =>
    renderToStaticMarkup(createElement(Abweisung, { saetze: SAETZE, grund, cse: 'probe' }));
  const erfolg = (schluessel: string | null): string =>
    renderToStaticMarkup(createElement(Bestaetigung, { saetze: ERFOLG, erfolg: schluessel, cse: 'probe-ok' }));

  it('ein bekannter Grund wird sein Satz — im Warnkasten mit role="alert"', () => {
    const html = warnung('name_fehlt');
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-cse="probe"');
    expect(html).toContain('<strong>Nicht gespeichert.</strong> Ein Kunde braucht einen Namen.');
  });

  it('ein unbekannter Grund wird der allgemeine Satz — nie er selbst, nie ein Prototyp-Treffer', () => {
    const allgemein = warnung('gibt_es_nicht');
    expect(allgemein).toContain('<strong>Nicht gespeichert.</strong> Es wurde nichts geändert.');
    expect(allgemein).not.toContain('gibt_es_nicht');
    /* `__proto__` fand mit `T[grund]` `Object.prototype` — React warf, die Seite antwortete 500. */
    for (const g of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'Hallo Welt',
      '<b>x</b>']) {
      expect(warnung(g), g).toBe(allgemein);
      expect(abweisungsSatz(SAETZE, g), g).toBe(SAETZE.sonst);
    }
  });

  it('ohne Grund kein Kasten', () => {
    expect(warnung(null)).toBe('');
  });

  it('eine Bestätigung nur zu einem bekannten Schlüssel — mit role="status"', () => {
    expect(erfolg('gespeichert')).toContain('role="status"');
    expect(erfolg('gespeichert')).toContain('Die Angaben sind gespeichert.');
    for (const s of [null, '__proto__', 'constructor', 'Alles bestens.', 'toString']) {
      expect(erfolg(s), String(s)).toBe('');
    }
  });

  it('einSchluessel nimmt nur eine einzelne, nicht leere Zeichenkette', () => {
    expect(einSchluessel('name_fehlt')).toBe('name_fehlt');
    for (const w of [undefined, '', ['a', 'b'], 1, null]) expect(einSchluessel(w)).toBeNull();
  });
});

describe('(4) zurueckMitSchluessel', () => {
  const HIER = 'http://localhost:3001';
  const anfrage = new NextRequest(new URL('/api/crm/kunde', HIER), {
    method: 'POST', headers: { host: 'localhost:3001', origin: HIER },
  });

  it('hängt genau einen Schlüssel an — `&`, wo die Seite schon eine Abfrage trägt', () => {
    expect(zurueckMitSchluessel(anfrage, '/portal/r/crm/kunden/neu', 'grund', 'name_fehlt')
      .headers.get('location')).toBe(`${HIER}/portal/r/crm/kunden/neu?grund=name_fehlt`);
    const r = zurueckMitSchluessel(anfrage, '/portal/r/crm/wiedervorlagen?wer=alle', 'erfolg',
      'erledigt');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${HIER}/portal/r/crm/wiedervorlagen?wer=alle&erfolg=erledigt`);
  });

  it('führt nie aus der Anwendung hinaus', () => {
    for (const fremd of ['https://fremd.example/portal', '//fremd.example/x', '/\\fremd.example']) {
      const ort = zurueckMitSchluessel(anfrage, fremd, 'fehler', 'x').headers.get('location') ?? '';
      expect(new URL(ort).origin, fremd).toBe(HIER);
    }
  });
});
