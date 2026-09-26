/**
 * **Jede deutsche Seite ist entweder uebersetzt oder als deutsch erklaert.**
 *
 * D-82: die oeffentliche Website ist deutsch UND englisch, gleiche Pfade —
 * deutsch unter `/`, englisch unter `/en/…`. Der Sprachumschalter rechnete
 * sein Ziel allein aus der Adresse: auf `/karriere` bot er `/en/karriere` an,
 * und das gibt es nicht. `/en/[seite]` laesst nur `OEFFENTLICHE_ROUTEN`
 * durch, und `/karriere` steht dort nicht.
 *
 * Ein Umschalter, der auf 404 fuehrt, ist derselbe Fehler wie ein Portalknopf
 * auf 404 (AUT-06, D-581) — er trifft hier nur jeden Besucher statt einer
 * Rolle. Deshalb entscheidet `gibtEsIn()` darueber, und `NUR_DEUTSCH` nennt
 * die Ausnahmen beim Namen.
 *
 * **Diese Pruefung haelt die Liste an den Dateibaum.** Sie zaehlt die
 * deutschen Seitenbaeume unter `src/app/(public)` und fragt fuer jeden, ob es
 * ihn auf Englisch gibt — als eigene Datei oder ueber `/en/[seite]`. Wer eine
 * deutsche Seite baut und die Uebersetzung schuldig bleibt, muss sie hier
 * eintragen; wer uebersetzt, muss den Eintrag entfernen. Beides faellt auf,
 * ohne dass jemand daran denkt.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NUR_DEUTSCH, gibtEsIn } from '../../src/lib/sprache.js';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';

const OEFFENTLICH = fileURLToPath(new URL('../../src/app/(public)', import.meta.url));

/** Alle `page.tsx` unter einem Verzeichnis, als Pfade relativ dazu. */
function seitenPfade(wurzel: string): readonly string[] {
  const treffer: string[] = [];
  const gehe = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { gehe(p); continue; }
      if (e !== 'page.tsx') continue;
      const rel = relative(wurzel, p).split(/[/\\]/u).join('/').replace(/\/?page\.tsx$/u, '');
      treffer.push(rel === '' ? '/' : `/${rel}`);
    }
  };
  gehe(wurzel);
  return treffer;
}

/** Der erste Abschnitt eines Pfades — der Baum, in dem er steht. */
function baum(pfad: string): string {
  const erstes = pfad.split('/').filter(Boolean)[0];
  return erstes === undefined ? '/' : `/${erstes}`;
}

const deutsch = seitenPfade(OEFFENTLICH).filter((p) => !p.startsWith('/en'));
const englisch = new Set(
  seitenPfade(OEFFENTLICH).filter((p) => p.startsWith('/en'))
    .map((p) => (p === '/en' ? '/' : p.slice('/en'.length))),
);
/** Was `/en/[seite]` durchlaesst — dieselbe Liste, die die Route fragt. */
const ueberSammelroute = new Set(OEFFENTLICHE_ROUTEN.map((r) => r.pfad));

describe('Sprachpfade (D-82, D-583)', () => {
  it('es gibt deutsche und englische Seiten zu pruefen', () => {
    expect(deutsch.length).toBeGreaterThan(5);
    expect(englisch.size).toBeGreaterThan(3);
  });

  it('jede deutsche SEITE ist englisch gebaut oder steht in NUR_DEUTSCH — Pfad für Pfad', () => {
    /*
     * **Verglichen wird der volle Pfad, nicht mehr der Baum (V-156).**
     *
     * Hier stand `baum()` — das erste Segment. `/datenschutz` war über
     * `/en/[seite]` englisch, also galt der ganze Baum `/datenschutz/*` als
     * übersetzt; `/barrierefreiheit` hatte eine englische Seite, also auch
     * `/barrierefreiheit/feedback`. Beide Formulare trugen vollständige
     * englische Texte, ihre Routen leiteten auf `/en/…` um, die Sprachwahl
     * bot `/en/…` an — und dahinter lag ein 404. Die Prüfung sah es nicht,
     * weil sie eine Ebene zu hoch hinsah.
     *
     * Ein dynamisches Segment deckt sich nur mit einem dynamischen an
     * derselben Stelle: `/unternehmen/[bereich]/projekte/[slug]` verlangt
     * genau diese Datei unter `/en`. `/en/[seite]` deckt nur Pfade mit EINEM
     * Segment, die `OEFFENTLICHE_ROUTEN` führt — dieselbe Liste, die die
     * Route fragt.
     */
    const offen = deutsch.filter((p) => {
      if (!gibtEsIn(p, 'en')) return false;
      if (p === '/') return !englisch.has('/');
      if (englisch.has(p)) return false;
      return !ueberSammelroute.has(p);
    });
    expect(offen,
      'deutsche Seiten ohne englische Entsprechung und ohne Eintrag in NUR_DEUTSCH')
      .toEqual([]);
  });

  it('die drei Pflichtformulare gibt es englisch — die Seiten, an denen es zuerst fehlte', () => {
    for (const p of ['/datenschutz/anfrage', '/datenschutz/anfrage/danke',
      '/barrierefreiheit/feedback']) {
      expect(gibtEsIn(p, 'en'), p).toBe(true);
      expect(englisch.has(p), `/en${p} fehlt als Datei`).toBe(true);
    }
  });

  it('keine englische Seite ohne deutsche — dieselben Pfade (D-82)', () => {
    const deutschePfade = new Set(deutsch);
    const verwaist = [...englisch].filter((e) => !deutschePfade.has(e));
    expect(verwaist, 'englische Seiten, deren deutscher Pfad fehlt').toEqual([]);
  });

  it('jeder Eintrag in NUR_DEUTSCH betrifft einen Baum, den es wirklich gibt', () => {
    const baeume = new Set(deutsch.map(baum));
    expect(NUR_DEUTSCH.filter((n) => !baeume.has(n)),
      'Ausnahme fuer eine Seite, die es nicht gibt').toEqual([]);
  });

  it('gibtEsIn sagt bei einem nur deutschen Baum Nein — auch fuer seine Unterseiten', () => {
    expect(gibtEsIn('/karriere', 'en')).toBe(false);
    expect(gibtEsIn('/karriere/eine-stelle/bewerbung', 'en')).toBe(false);
    expect(gibtEsIn('/karriere', 'de')).toBe(true);
    expect(gibtEsIn('/kontakt', 'en')).toBe(true);
  });
});
