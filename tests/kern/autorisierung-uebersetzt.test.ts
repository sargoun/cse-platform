/**
 * **Wer `authorize` ruft, übersetzt auch dessen Wurf** (AUT-06, V-162, D-656).
 *
 * `authorize` WIRFT: `NichtGefundenFehler` für ein fehlendes Recht und einen
 * fremden Mandanten, `ZweiterFaktorFehler` für eine `aal1`-Sitzung,
 * `NichtAngemeldetFehler` ohne Sitzung. `server/auth/antwort.ts` macht daraus
 * 404, 403 und 401. 37 schreibende Routen fingen im `catch` nur ihre eigene
 * Fachklasse und warfen alles andere weiter — ein fehlendes Recht endete als
 * **500**, und 500 heisst „hier ist etwas", wo AUT-06 nichts sagen will.
 *
 * `routen.test.ts` prüfte nur, OB `authorize` gerufen wird. Diese Datei prüft
 * die zweite Hälfte: dass sein Wurf irgendwo übersetzt wird — in der Route
 * selbst oder in einem Gerüst, das sie eine Ebene tief importiert (dieselbe
 * Tiefe wie dort). Sie liest das Dateisystem und keine Liste: die 38. Route
 * ist damit automatisch dabei.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autorisierungsAntwort } from '../../src/server/auth/antwort.js';
import {
  KontoGesperrtFehler, NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';
import { ohneKommentare } from './hilfen/quelltext.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const APP = join(WURZEL, 'src/app');

const RUFT_AUTHORIZE = /\bauthorize\s*\(/u;
/**
 * Was als Übersetzung zählt: der gemeinsame Übersetzer, ein ausdrücklicher
 * `instanceof NichtGefundenFehler`, oder die allgemeine `status`/`code`-Weiche
 * (`NichtGefundenFehler` trägt beides, siehe `server/auth/fehler.ts`).
 */
const UEBERSETZT = [
  /\bautorisierungsAntwort\s*\(/u,
  /\binstanceof\s+NichtGefundenFehler\b/u,
  /\bstatus\?\s*:\s*number\b/u,
];

function routen(verzeichnis: string): string[] {
  const treffer: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) treffer.push(...routen(voll));
    else if (eintrag === 'route.ts' || eintrag === 'route.tsx') treffer.push(voll);
  }
  return treffer;
}

/** Relative Importe und `@/app/…` — genau eine Ebene, wie in `routen.test.ts`. */
function nachbarn(datei: string, roh: string): string[] {
  const ergebnis: string[] = [];
  for (const t of roh.matchAll(/from\s+'((?:\.|@\/app\/)[^']*)'/gu)) {
    const spec = t[1] ?? '';
    const ziel = spec.startsWith('.')
      ? resolve(datei, '..', spec)
      : join(APP, spec.slice('@/app/'.length));
    for (const endung of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (existsSync(`${ziel}${endung}`)) { ergebnis.push(`${ziel}${endung}`); break; }
    }
  }
  return ergebnis;
}

/** Der Code einer Datei ohne Kommentare und Zeichenketten. */
const code = (datei: string): string => ohneKommentare(readFileSync(datei, 'utf8'));

/**
 * Die Prüfung als reine Funktion über Quelltexte — damit ihr Nein unten an
 * erfundenen Beispielen gezeigt werden kann, nicht nur ihr Ja am Baum.
 */
function uebersetztDenWurf(
  route: string, gerueste: readonly string[],
): { ruft: boolean; uebersetzt: boolean } {
  const alle = [route, ...gerueste];
  return {
    ruft: alle.some((q) => RUFT_AUTHORIZE.test(q)),
    uebersetzt: alle.some((q) => UEBERSETZT.some((m) => m.test(q))),
  };
}

describe('(AUT-06) jeder Wurf von authorize wird übersetzt — keine 500 für „darf nicht"', () => {
  const dateien = routen(APP);

  it('es gibt überhaupt Routen, die authorize rufen', () => {
    const rufend = dateien.filter((d) => uebersetztDenWurf(
      code(d), nachbarn(d, readFileSync(d, 'utf8')).map(code)).ruft);
    expect(rufend.length).toBeGreaterThan(100);
  });

  it('keine Route ruft authorize, ohne den Wurf zu übersetzen', () => {
    const ohne: string[] = [];
    for (const d of dateien) {
      const { ruft, uebersetzt } = uebersetztDenWurf(
        code(d), nachbarn(d, readFileSync(d, 'utf8')).map(code));
      if (ruft && !uebersetzt) ohne.push(relative(WURZEL, d));
    }
    expect(ohne, 'diese Routen beantworten ein fehlendes Recht mit 500 — '
      + '`autorisierungsAntwort(fehler)` vor das `throw fehler` setzen').toEqual([]);
  });

  it('die 37 Routen des Befunds sind darunter und übersetzen jetzt selbst', () => {
    for (const pfad of [
      'agenten/budget', 'crm/kunde', 'objekt', 'reinigung/reviere', 'konto/verwaltung',
      'system/modelle', 'system/verwaltungskonto', 'website/seite', 'datenschutz/aufnehmen',
      'dienstplan/serien/[id]', 'finanzen/ausgaben', 'personal/zugang',
    ]) {
      const quelle = code(join(APP, 'api', pfad, 'route.ts'));
      expect(quelle, pfad).toMatch(/\bautorisierungsAntwort\s*\(\s*fehler\s*\)/u);
    }
  });
});

describe('die Prüfung sagt auch Nein', () => {
  it('eine Route, die nur ihre Fachklasse fängt, fällt durch', () => {
    const route = `
      try { await authorize(s, { recht: 'x.schreiben' }, p); }
      catch (fehler) { if (fehler instanceof RevierFehler) return x; throw fehler; }`;
    expect(uebersetztDenWurf(route, [])).toEqual({ ruft: true, uebersetzt: false });
  });

  it('ein Kommentar, der den Übersetzer nennt, zählt nicht', () => {
    const route = ohneKommentare(`
      // hier fehlt noch autorisierungsAntwort(fehler)
      try { await authorize(s, r, p); } catch (fehler) { throw fehler; }`);
    expect(uebersetztDenWurf(route, []).uebersetzt).toBe(false);
  });

  it('ein Gerüst, das übersetzt, deckt die Route', () => {
    const route = 'return fuehreUebergangAus(anfrage, u);';
    const geruest = `await authorize(s, r, p);
      const a = autorisierungsAntwort(fehler); if (a !== null) return a;`;
    expect(uebersetztDenWurf(route, [geruest])).toEqual({ ruft: true, uebersetzt: true });
  });
});

describe('der Übersetzer selbst', () => {
  it('fehlendes Recht und fremder Mandant: 404 mit demselben Körper', async () => {
    const recht = autorisierungsAntwort(new NichtGefundenFehler('Recht crm.schreiben fehlt'));
    const fremd = autorisierungsAntwort(new NichtGefundenFehler('Fremder Mandant 8f3a'));
    expect(recht?.status).toBe(404);
    expect(fremd?.status).toBe(404);
    /* Der interne Grund verlässt den Server nie — beide Körper sind byte-gleich. */
    const [a, b] = [await recht?.text(), await fremd?.text()];
    expect(a).toBe(b);
    expect(a).not.toContain('crm.schreiben');
  });

  it('ohne zweiten Faktor 403, ohne Sitzung 401, gesperrt 403', () => {
    expect(autorisierungsAntwort(new ZweiterFaktorFehler())?.status).toBe(403);
    expect(autorisierungsAntwort(new NichtAngemeldetFehler())?.status).toBe(401);
    expect(autorisierungsAntwort(new KontoGesperrtFehler())?.status).toBe(403);
  });

  it('ein Programmfehler bleibt ein Wurf — kein hübsches 404', () => {
    expect(autorisierungsAntwort(new TypeError('x is undefined'))).toBeNull();
    expect(autorisierungsAntwort({ status: 404 })).toBeNull();
  });
});
