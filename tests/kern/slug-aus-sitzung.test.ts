/**
 * **Der Slug einer Umleitung kommt aus der Sitzung** (V-278, Invariante 3).
 *
 * Vierundzwanzig Routen nahmen den Slug ihres Rückwegs aus `?mandant=` der
 * Formularadresse — gehandelt wurde im aktiven Mandanten der Sitzung, das
 * Ziel aber konnte eine andere Gesellschaft nennen. Jetzt liest jede den
 * Slug über `slugDesAktivenMandanten` aus der Sitzung. Diese Wache hält fest,
 * dass keine Route unter `src/app/api` die Adresse dafür wieder fragt; dass
 * die Route das Ziel der Sitzung nimmt, prüft `lead-route.test.ts` an der
 * echten Route.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portalPfad } from '../../src/server/auth/aktiver-slug.js';

const WURZEL = resolve(import.meta.dirname, '../..');

function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((n) => {
    const p = join(ordner, n);
    return statSync(p).isDirectory() ? dateien(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('V-278 — der Slug der Umleitung kommt aus der Sitzung', () => {
  it('keine Route fragt dafür `?mandant=`', () => {
    const treffer = dateien(join(WURZEL, 'src/app/api'))
      .filter((p) => /searchParams\.get\(\s*['"]mandant['"]\s*\)/u.test(readFileSync(p, 'utf8')))
      .map((p) => relative(WURZEL, p));
    expect(treffer).toEqual([]);
  });

  it('die vierundzwanzig Rückwege lesen den Slug der Sitzung', () => {
    const mit = dateien(join(WURZEL, 'src/app/api'))
      .filter((p) => readFileSync(p, 'utf8').includes('slugDesAktivenMandanten(sitzung)'));
    expect(mit.length).toBeGreaterThanOrEqual(24);
  });

  it('ohne Slug geht es aufs Portal, nicht auf `/portal//…`', () => {
    expect(portalPfad('', '/finanzen/rechnungen')).toBe('/portal');
    expect(portalPfad('bau', '/finanzen/rechnungen')).toBe('/portal/bau/finanzen/rechnungen');
  });
});
