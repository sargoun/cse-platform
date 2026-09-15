/**
 * PR 6 Akzeptanz (5) — eine Route ohne `authorize()` bricht den Build.
 *
 * Die Prüfung liest das Dateisystem, nicht eine Liste, die jemand pflegt: eine
 * neue Route ist damit automatisch abgedeckt, und das ist der Unterschied
 * zwischen einer Prüfung und einer Erinnerung.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTEN } from '../../src/server/auth/route-manifest.js';
import { ANDERS_BEWACHT } from './serveraction-ausnahmen.js';

const WURZEL = resolve(import.meta.dirname, '../..');

/**
 * Gescannt wird `src/app/**`, nicht `src/app/api/**`.
 *
 * Der Plan nennt `app/api/**`, aber `healthz` liegt als `src/app/healthz` schon
 * heute daneben: eine Prüfung auf `api/` allein hätte diese Route — und jede
 * künftige ausserhalb von `api/` — stillschweigend nicht abgedeckt, während
 * sie meldet, alles sei abgedeckt.
 */
const APP = join(WURZEL, 'src/app');

/** Jede `route.ts` unter `src/app/api/**`. */
function routenDateien(verzeichnis: string): readonly string[] {
  const treffer: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) treffer.push(...routenDateien(voll));
    else if (eintrag === 'route.ts' || eintrag === 'route.tsx') treffer.push(voll);
  }
  return treffer;
}

/** Jede `.ts`/`.tsx` unter einem Verzeichnis. */
function alleQuellen(verzeichnis: string): readonly string[] {
  const treffer: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) treffer.push(...alleQuellen(voll));
    else if (/\.tsx?$/u.test(eintrag)) treffer.push(voll);
  }
  return treffer;
}

/** `src/app/healthz/route.ts` → `healthz`. */
function pfadVon(datei: string): string {
  return relative(join(WURZEL, 'src/app'), datei).replace(/\/route\.tsx?$/u, '');
}

const AUFRUF = /\bauthorize\s*\(/u;

/**
 * Ruft diese Datei `authorize` — selbst oder in einem Modul, das sie
 * relativ importiert?
 *
 * Genau EINE Ebene tief. Zwei wären eine Suche, und eine Suche findet
 * irgendwann irgendwo ein `authorize` und nennt die Route bewacht.
 */
function rueftAuthorize(datei: string): boolean {
  const quelle = readFileSync(datei, 'utf8');
  if (AUFRUF.test(quelle)) return true;
  const ordner = resolve(datei, '..');
  for (const treffer of quelle.matchAll(/from\s+'(\.[^']*)'/gu)) {
    const ziel = resolve(ordner, treffer[1] ?? '');
    for (const endung of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const kandidat = `${ziel}${endung}`;
      try {
        if (AUFRUF.test(readFileSync(kandidat, 'utf8'))) return true;
      } catch { /* kein solcher Nachbar — der naechste Kandidat. */ }
    }
  }
  return false;
}

describe('(5) jede Route ist im Manifest, und jede im Manifest existiert', () => {
  const dateien = routenDateien(APP);

  it('es gibt überhaupt Routen zu prüfen', () => {
    // Ohne diese Zusage bestünde die Prüfung auf einem leeren Verzeichnis.
    expect(dateien.length).toBeGreaterThan(0);
  });

  it('keine Route fehlt im Manifest', () => {
    const bekannt = new Set(ROUTEN.map((r) => r.pfad));
    const fehlend = dateien.map(pfadVon).filter((p) => !bekannt.has(p));
    expect(fehlend, 'Neue Routen gehören ins Route-Manifest, mit Recht oder mit Grund').toEqual([]);
  });

  it('und keine Manifest-Zeile zeigt auf eine Route, die es nicht gibt', () => {
    // Die Gegenrichtung: sonst bleibt eine gelöschte Route als Eintrag stehen
    // und die Liste behauptet eine Abdeckung, die nichts mehr abdeckt.
    const vorhanden = new Set(dateien.map(pfadVon));
    expect(ROUTEN.map((r) => r.pfad).filter((p) => !vorhanden.has(p))).toEqual([]);
  });

  it('eine offene Route trägt einen Grund, keinen leeren Platz', () => {
    for (const r of ROUTEN) {
      if (r.recht === null) {
        expect(r.grund, r.pfad).toBeDefined();
        expect((r.grund ?? '').length, r.pfad).toBeGreaterThan(40);
      }
    }
  });

  it('eine geschützte Route ruft `authorize` auch wirklich auf', () => {
    // Das Manifest sagt, welches Recht gilt; diese Prüfung sagt, dass der
    // Handler es benutzt. Ein Eintrag ohne Aufruf wäre eine Behauptung.
    //
    // **Ein Gerüst zählt mit — aber nur, wenn es wirklich prüft.** Vier
    // Routen desselben Moduls teilen sich Ursprungsprüfung, Sitzung,
    // `authorize` und Transaktion; vier Kopien davon wären vier Stellen, an
    // denen beim nächsten Umbau eine fehlt. Deshalb folgt die Prüfung den
    // RELATIVEN Importen der Route eine Ebene tief und akzeptiert den Aufruf
    // dort. Das ist strenger als eine Ausnahmeliste: eine Liste glaubt der
    // Begründung, das hier liest den Code.
    for (const r of ROUTEN) {
      if (r.recht === null) continue;
      const datei = dateien.find((d) => pfadVon(d) === r.pfad);
      expect(datei, r.pfad).toBeDefined();
      expect(rueftAuthorize(datei!), `${r.pfad}: weder die Route noch ein von ihr `
        + 'importiertes Gerüst ruft authorize()').toBe(true);
    }
  });

  /**
   * **Die Gegenprobe zur Lockerung darueber.**
   *
   * Eine Pruefung, die Importen folgt, ist nur so viel wert wie ihr Nein.
   * Ohne diesen Fall koennte `rueftAuthorize` schlicht `true` zurueckgeben
   * und beide Tests waeren gruen — und keine Route mehr bewacht.
   *
   * Genommen werden die OFFENEN Routen: sie tragen `recht: null`, rufen
   * `authorize` bewusst nicht, und keine von ihnen darf durch einen
   * Nachbarn hineinrutschen.
   */
  it('und sie sagt auch Nein — eine offene Route gilt nicht als bewacht', () => {
    const offene = ROUTEN.filter((r) => r.recht === null)
      .map((r) => dateien.find((d) => pfadVon(d) === r.pfad))
      .filter((d): d is string => d !== undefined);
    expect(offene.length, 'ohne offene Route prueft dieser Fall nichts')
      .toBeGreaterThan(0);
    for (const datei of offene) {
      expect(rueftAuthorize(datei), `${pfadVon(datei)} traegt recht: null und `
        + 'darf nicht als bewacht gelten').toBe(false);
    }
  });

  it('ein Rechteschlüssel hat die Form <modul>.<aktion> (K-19)', () => {
    for (const r of ROUTEN) {
      if (r.recht === null) continue;
      expect(r.recht, r.pfad).toMatch(/^[a-z_]+(\.[a-z_]+){1,2}$/u);
    }
  });

  it('und jede Server Action ruft ebenfalls authorize auf (AUT-04)', () => {
    // Server Actions sind der zweite Eingang. Eine Prüfung, die nur Route
    // Handler kennt, deckt genau die Hälfte ab — und die andere Hälfte ist
    // die, in der ein `'use server'` in einer Komponentendatei landet.
    const aktionen = alleQuellen(join(WURZEL, 'src'))
      .filter((d) => /^\s*['"]use server['"]/mu.test(readFileSync(d, 'utf8')));
    expect(aktionen.length, 'es gibt überhaupt Server Actions zu prüfen')
      .toBeGreaterThan(0);

    const ausnahmen = new Map(ANDERS_BEWACHT.map((a) => [a.datei, a]));
    for (const datei of aktionen) {
      const rel = relative(WURZEL, datei);
      const inhalt = readFileSync(datei, 'utf8');
      const ausnahme = ausnahmen.get(rel);
      if (ausnahme === undefined) {
        expect(inhalt, rel).toMatch(/\bauthorize\s*\(/u);
        continue;
      }
      /**
       * Eine Ausnahme ist keine Abschaltung. Sie muss ihre Wache NENNEN, und
       * die Wache muss in der Datei wirklich aufgerufen werden — sonst steht
       * hier eine Begründung für eine Prüfung, die es nicht gibt.
       */
      expect(inhalt, `${rel}: Ausnahme ohne die genannte Wache ${ausnahme.wache}`)
        .toMatch(new RegExp(`\\b${ausnahme.wache}\\s*\\(`, 'u'));
      expect(ausnahme.grund.length, `${rel}: Ausnahme ohne Begründung`)
        .toBeGreaterThan(80);
    }
  });
});
