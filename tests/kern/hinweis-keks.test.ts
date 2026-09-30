/**
 * Die Rückmeldung der elf Pflegeseiten reist als kurzlebiger Keks, nicht in
 * der Adresse (V-277, D-775).
 *
 * **Der Befund.** Die Routen der Stammdaten- und Einstellungspflege und der
 * Mahnungen schickten ihren Satz als `?hinweis=<Satz>`, und die Seiten zeigten
 * ihn unverändert — ein präparierter Link schrieb dort eigenen Text (D-769).
 * Geprüft wird der Keks selbst (Pfad, Dauer, Merkmale, Hin- und Rückweg durch
 * Nexts eigene Verschlüsselung) und dass keine der elf Routen und Seiten den
 * alten Weg noch geht.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies/index.js';
import {
  HINWEIS_HOECHSTENS_BYTES, HINWEIS_KEKS, HINWEIS_KEKS_SEKUNDEN, gekuerzterHinweis,
  hinweisAusKeks, mitHinweis,
} from '../../src/server/rueckmeldung/hinweis-keks.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const ZIEL = new URL('http://localhost:3001/portal/reinigung/stammdaten/belagsarten');

/** Was der Browser beim nächsten Aufruf der Zielseite zurückschickt. */
function zurueckVomBrowser(antwort: NextResponse): string | undefined {
  const gesetzt = antwort.headers.get('set-cookie') ?? '';
  const paar = gesetzt.split(';')[0] ?? '';
  return new RequestCookies(new Headers({ cookie: paar })).get(HINWEIS_KEKS)?.value;
}

describe('der Keks', () => {
  it('gilt nur für die Zielseite, fünfzehn Sekunden lang, und kein Skript liest ihn', () => {
    const r = mitHinweis(NextResponse.redirect(ZIEL, 303), ZIEL, 'Belagsart „Linoleum“ angelegt.');
    const gesetzt = r.headers.get('set-cookie') ?? '';
    expect(gesetzt).toContain(`${HINWEIS_KEKS}=`);
    expect(gesetzt).toContain('Path=/portal/reinigung/stammdaten/belagsarten');
    expect(gesetzt).toContain(`Max-Age=${String(HINWEIS_KEKS_SEKUNDEN)}`);
    expect(gesetzt).toContain('HttpOnly');
    expect(gesetzt.toLowerCase()).toContain('samesite=lax');
    // Die Adresse trägt keinen Satz mehr.
    expect(r.headers.get('location')).toBe(ZIEL.href);
  });

  it('der Satz kommt unverändert an — Umlaute, Anführungszeichen, Semikolon, Emoji', () => {
    const satz = 'Stufe 2 bestätigt; Frist: 14 Tage — „Zahlung“ erbeten ✓ 🧹';
    const wert = zurueckVomBrowser(mitHinweis(NextResponse.redirect(ZIEL, 303), ZIEL, satz));
    expect(hinweisAusKeks(wert, ZIEL.pathname)).toBe(satz);
  });

  it('er gilt genau seiner Seite — die Mahnungsliste gibt ihren Satz nicht an ein Mahnungsblatt weiter', () => {
    // `Path` schliesst Unterseiten ein; deshalb nennt der Wert die Zielseite noch einmal.
    const liste = new URL('http://localhost:3001/portal/reinigung/finanzen/mahnungen');
    const wert = zurueckVomBrowser(mitHinweis(NextResponse.redirect(liste, 303), liste, '3 Mahnungen erstellt.'));
    expect(hinweisAusKeks(wert, liste.pathname)).toBe('3 Mahnungen erstellt.');
    expect(hinweisAusKeks(wert, `${liste.pathname}/0b6f3c52-2f6d-4c55-9f0e-6c1b1d9a1e01`)).toBeNull();
    expect(hinweisAusKeks(wert, '/portal/security/finanzen/mahnungen')).toBeNull();
    // Ein Wert ohne Zielseite zeigt nichts.
    expect(hinweisAusKeks('3 Mahnungen erstellt.', liste.pathname)).toBeNull();
  });

  it('ohne Satz kein Keks', () => {
    for (const leer of [undefined, '', '   ']) {
      const r = mitHinweis(NextResponse.redirect(ZIEL, 303), ZIEL, leer);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
    expect(hinweisAusKeks(undefined, ZIEL.pathname)).toBeNull();
    expect(hinweisAusKeks(`${ZIEL.pathname}\n  `, ZIEL.pathname)).toBeNull();
  });

  it('ein langer Satz wird gekürzt, bis er in einen Keks passt — ohne halbes Zeichen', () => {
    // 🧹 ist ein Ersatzpaar; ein Schnitt mittendrin liesse encodeURIComponent werfen.
    const lang = 'ä🧹'.repeat(2000);
    const kurz = gekuerzterHinweis(lang);
    expect(kurz.endsWith('…')).toBe(true);
    expect(encodeURIComponent(kurz.slice(0, -1)).length).toBeLessThanOrEqual(HINWEIS_HOECHSTENS_BYTES);
    const gesetzt = mitHinweis(NextResponse.redirect(ZIEL, 303), ZIEL, lang)
      .headers.get('set-cookie') ?? '';
    // Browser verwerfen einen Keks über 4096 Byte still.
    expect(gesetzt.length).toBeLessThan(4096);
    expect(hinweisAusKeks(zurueckVomBrowser(
      mitHinweis(NextResponse.redirect(ZIEL, 303), ZIEL, lang)), ZIEL.pathname)).toBe(kurz);
  });
});

describe('die elf Pflegeseiten gehen den alten Weg nicht mehr', () => {
  const PFLEGE = [
    'einstellungen/arbeitszeit', 'einstellungen/identitaet', 'einstellungen/mahnwesen',
    'einstellungen/vorlagen', 'stammdaten/abwesenheitsarten', 'stammdaten/antragsarten',
    'stammdaten/belagsarten', 'stammdaten/qualifikationen', 'stammdaten/reinigungsklassen',
  ] as const;
  const ROUTEN = [...PFLEGE, 'einstellungen/identitaet/bild', 'finanzen/mahnungen']
    .map((p) => `src/app/api/${p}/route.ts`);
  const SEITEN = [...PFLEGE, 'finanzen/mahnungen', 'finanzen/mahnungen/[id]']
    .map((p) => `src/app/portal/[mandant]/${p}/page.tsx`);
  const lies = (datei: string): string => readFileSync(join(WURZEL, datei), 'utf8');

  it.each(ROUTEN)('%s legt den Satz in den Keks, nicht in die Adresse', (datei) => {
    const quelle = lies(datei);
    expect(quelle).not.toMatch(/searchParams\.set\(\s*'hinweis'/u);
    expect(quelle).not.toMatch(/\{\s*hinweis\s*\}/u);
    expect(quelle).toContain('mitHinweis(NextResponse.redirect(');
  });

  it.each(SEITEN)('%s liest ihn aus dem Keks, nicht aus der Adresse', (datei) => {
    const quelle = lies(datei);
    expect(quelle).toMatch(/const hinweis = await gelesenerHinweis\(`\/portal\/\$\{mandant\}\/[^`]+`\);/u);
    expect(quelle).not.toMatch(/\{\s*hinweis\s*\}\s*=\s*(?:await searchParams|suche)/u);
  });
});
