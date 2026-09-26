/**
 * Eine Kachel erscheint nur, wenn sich ihr Ziel öffnet (V-151, D-645,
 * DSH-04, AUT-06, D-377).
 *
 * **Der Befund.** Die Kachel „Bauprojekte in Arbeit" (`bau.lesen`) erschien
 * bei Leitung und Administration in JEDER Gesellschaft — beide halten
 * `bau.lesen` global —, und in der Reinigung führte sie auf
 * `/portal/reinigung/bau/projekte?status=in_arbeit`: ein 404, weil die
 * Reinigung Bau nicht gebucht hat. Das Dashboard filterte nur nach dem Recht
 * der Kachel; `Kachel.modul` las niemand, und kein Test fragte, ob das Ziel
 * einer sichtbaren Kachel sich überhaupt öffnet.
 *
 * **Geprüft wird die Zusage selbst, für jede Kachel:** für jede Buchung und
 * jede Rechtelage gilt — erscheint die Kachel, dann gibt es ihr Ziel im
 * Manifest, die Pforte sperrt es nicht (`routeGesperrt`, dieselbe Funktion
 * wie in `app/portal/zugang.ts`), die Sitzung hält jedes Leserecht der Route,
 * und kein Ziel verlangt einen zweiten Faktor, den die Übersicht nicht kennt.
 * Dass Buchung und Rechte aus der Datenbank kommen, prüft
 * `tests/isolation/kennzahlen-listen.test.ts` (§4).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kacheln, leereKacheln, type Kachel } from '../../src/server/registry/kennzahlen.js';
import { registriereBerichtKacheln } from '../../src/server/services/bericht/kacheln.js';
import {
  dashboard, kachelErreichbar, kachelRechte,
} from '../../src/server/services/bericht/dashboard.js';
import { findeRoute, leserechte, routeGesperrt } from '../../src/server/registry/routen.js';
import type { Modulbuchung } from '../../src/server/registry/modul.js';

const WURZEL = resolve(import.meta.dirname, '../..');

beforeEach(() => { leereKacheln(); registriereBerichtKacheln(); });
afterEach(leereKacheln);

/** Die Buchungen des Seeds (`seed/index.ts`) — und die ungepflegte. */
const BUCHUNGEN: Readonly<Record<string, Modulbuchung>> = {
  reinigung: { module: ['reinigung'], gepflegt: true },
  security: { module: ['security'], gepflegt: true },
  bau: { module: ['bau'], gepflegt: true },
  operations: { module: [], gepflegt: true },
  ungepflegt: { module: [], gepflegt: false },
};

function kontext(slug: string) {
  return { mandantId: `m-${slug}`, mandantSlug: slug, mandantIds: [`m-${slug}`] };
}

function kachel(schluessel: string): Kachel {
  const k = kacheln().find((x) => x.schluessel === schluessel);
  if (k === undefined) throw new Error(`Kachel ${schluessel} fehlt im Register.`);
  return k;
}

/** Die Rechtelagen: alles (Administration), nur das der Kachel, das der Kachel plus Zusatz. */
function lagen(k: Kachel): readonly (readonly [string, (r: string) => boolean])[] {
  const eigene = new Set([k.recht, ...(k.zusatzRechte ?? [])]);
  return [
    ['alle Rechte', () => true],
    ['nur das Recht der Kachel', (r) => r === k.recht],
    ['Recht und Zusatzrechte der Kachel', (r) => eigene.has(r)],
  ];
}

describe('keine sichtbare Kachel führt auf einen 404', () => {
  it.each(Object.keys(BUCHUNGEN))('Buchung %s — jede Kachel, jede Rechtelage', (name) => {
    const buchung = BUCHUNGEN[name]!;
    const kx = kontext(name === 'ungepflegt' ? 'reinigung' : name);
    let gezeigt = 0;
    for (const k of kacheln()) {
      for (const [lage, hatRecht] of lagen(k)) {
        if (!kachelErreichbar(k, kx, hatRecht, buchung)) continue;
        gezeigt += 1;
        const ziel = k.ziel(kx);
        const route = findeRoute(ziel);
        const was = `${name} · ${lage} · ${k.schluessel} → ${ziel}`;
        expect(route, `${was}: keine Route im Manifest`).toBeDefined();
        expect(routeGesperrt(route, buchung), `${was}: die Pforte sperrt das Modul`).toBe(false);
        for (const r of leserechte(route!)) {
          expect(hatRecht(r), `${was}: die Route verlangt ${r}`).toBe(true);
        }
        const b = route!.bewachung;
        expect(b.art === 'recht' && b.aal2, `${was}: verlangt einen zweiten Faktor`).toBe(false);
      }
    }
    // Eine Prüfung, die besteht, weil nichts erschien, prüfte nichts.
    expect(gezeigt).toBeGreaterThan(0);
  });
});

describe('der Befund: „Bauprojekte in Arbeit" nur, wo Bau gebucht ist', () => {
  it.each(['reinigung', 'security', 'operations'])(
    'in %s erscheint sie nicht — auch nicht mit allen Rechten', (name) => {
      expect(kachelErreichbar(kachel('projekte_in_arbeit'), kontext(name), () => true,
        BUCHUNGEN[name]!)).toBe(false);
    });

  it('im Bau erscheint sie, und ohne gepflegte Buchung auch (nichts ist eingetragen)', () => {
    expect(kachelErreichbar(kachel('projekte_in_arbeit'), kontext('bau'), () => true,
      BUCHUNGEN['bau']!)).toBe(true);
    expect(kachelErreichbar(kachel('projekte_in_arbeit'), kontext('reinigung'), () => true,
      BUCHUNGEN['ungepflegt']!)).toBe(true);
  });

  it('die Kacheln der Querschnittsmodule erscheinen in jeder Gesellschaft', () => {
    for (const name of ['reinigung', 'security', 'bau', 'operations']) {
      for (const s of ['auftraege_aktiv', 'angebote_offen', 'aufgaben_offen', 'neue_leads']) {
        expect(kachelErreichbar(kachel(s), kontext(name), () => true, BUCHUNGEN[name]!),
          `${name}: ${s}`).toBe(true);
      }
    }
  });
});

describe('die Rechte des ZIELS zählen mit, nicht nur das der Kachel', () => {
  it('„Offene Konflikte" verlangt auch `dienstplan.lesen` — die Seite fragt beide', () => {
    const k = kachel('konflikte_offen');
    const nurKonflikte = (r: string): boolean => r === 'dienstplan.arbzg_lesen';
    expect(kachelErreichbar(k, kontext('security'), nurKonflikte, BUCHUNGEN['security']!))
      .toBe(false);
    const beide = (r: string): boolean =>
      r === 'dienstplan.arbzg_lesen' || r === 'dienstplan.lesen';
    expect(kachelErreichbar(k, kontext('security'), beide, BUCHUNGEN['security']!)).toBe(true);
  });

  it('„Offene Forderungen" verlangt `zahlung.lesen` — ohne es zählte RLS 0', () => {
    const k = kachel('forderungen_offen');
    expect(k.zusatzRechte).toEqual(['zahlung.lesen']);
    const ohneZahlung = (r: string): boolean => r !== 'zahlung.lesen';
    expect(kachelErreichbar(k, kontext('reinigung'), ohneZahlung, BUCHUNGEN['reinigung']!))
      .toBe(false);
    expect(kachelErreichbar(k, kontext('reinigung'), () => true, BUCHUNGEN['reinigung']!))
      .toBe(true);
  });

  it('kachelRechte fragt jedes Recht, das die Entscheidung braucht — in einer Rundreise', () => {
    const rechte = kachelRechte(kontext('reinigung'));
    for (const k of kacheln()) {
      expect(rechte).toContain(k.recht);
      for (const r of k.zusatzRechte ?? []) expect(rechte).toContain(r);
      for (const r of leserechte(findeRoute(k.ziel(kontext('reinigung')))!)) {
        expect(rechte, `${k.schluessel}: ${r}`).toContain(r);
      }
    }
    expect(rechte).toContain('dienstplan.lesen');
    expect(rechte).toContain('zahlung.lesen');
  });
});

describe('dashboard() zählt nur, was erscheinen darf', () => {
  it('in der Reinigung keine Bauzählung — auch keine Abfrage dafür', async () => {
    const gefragt: string[] = [];
    const db = {
      abfrage: <T,>(s: string): Promise<readonly T[]> => {
        gefragt.push(s);
        return Promise.resolve([{ wert: 1 }] as unknown as readonly T[]);
      },
    };
    const werte = await dashboard(db, kontext('reinigung'), () => true, BUCHUNGEN['reinigung']!);
    const schluessel = werte.map((w) => w.kachel.schluessel);
    expect(schluessel).not.toContain('projekte_in_arbeit');
    expect(schluessel).toContain('auftraege_aktiv');
    expect(schluessel).toHaveLength(kacheln().length - 1);
    expect(gefragt.some((s) => /from projekt\b/u.test(s))).toBe(false);
  });

  it('im Bau steht sie da, mit Ziel auf die gefilterte Projektliste', async () => {
    const db = {
      abfrage: <T,>(): Promise<readonly T[]> =>
        Promise.resolve([{ wert: 2 }] as unknown as readonly T[]),
    };
    const werte = await dashboard(db, kontext('bau'), () => true, BUCHUNGEN['bau']!);
    expect(werte.find((w) => w.kachel.schluessel === 'projekte_in_arbeit')?.ziel)
      .toBe('/portal/bau/bau/projekte?status=in_arbeit');
  });
});

describe('routeGesperrt — die eine Regel der Pforte', () => {
  it('ein Gewerk sperrt, ein Querschnittsmodul nie, ungepflegt nichts', () => {
    const bau = findeRoute('/portal/reinigung/bau/projekte');
    expect(routeGesperrt(bau, BUCHUNGEN['reinigung']!)).toBe(true);
    expect(routeGesperrt(bau, BUCHUNGEN['operations']!)).toBe(true);
    expect(routeGesperrt(bau, BUCHUNGEN['bau']!)).toBe(false);
    expect(routeGesperrt(bau, BUCHUNGEN['ungepflegt']!)).toBe(false);
    expect(routeGesperrt(findeRoute('/portal/operations/auftraege'), BUCHUNGEN['operations']!))
      .toBe(false);
    expect(routeGesperrt(undefined, BUCHUNGEN['reinigung']!)).toBe(false);
  });

  it('die Pforte und die Übersicht fragen dieselbe Funktion', () => {
    const pforte = readFileSync(resolve(WURZEL, 'src/app/portal/zugang.ts'), 'utf8');
    expect(pforte).toMatch(/routeGesperrt\(\s*findeRoute\(pfad\),\s*buchung\s*\)/u);
    const seite = readFileSync(resolve(WURZEL, 'src/app/portal/[mandant]/page.tsx'), 'utf8');
    expect(seite).toMatch(/bereichsDashboard\(/u);
    expect(seite).not.toMatch(/\bdashboard\(\s*kontext/u);
  });
});
