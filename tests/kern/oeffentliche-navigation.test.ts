/**
 * **Jede gebaute öffentliche Seite ist von einer anderen aus erreichbar — in
 * der Sprache, in die der Verweis führt** (V-155, V-156, D-649, D-650).
 *
 * Die Befunde, die diese Datei festhält:
 *
 *  1. `/ueber-uns`, `/news` und `/karriere` waren gebaut, befüllt und in der
 *     Sitemap — und keine Seite verlinkte sie. Die Kopfzeile hat vier Punkte
 *     (DESIGN §5, D-417), das Telefonmenü dieselben vier, der Fuss nur
 *     Gesellschaften und Rechtliches.
 *  2. Das BFSG-Meldeformular (`/barrierefreiheit/feedback`, D-600) war von
 *     keiner Seite aus verlinkt; die Erklärung nannte unter „Barriere melden"
 *     nur eine E-Mail-Adresse.
 *  3. Die Betroffenenanfrage (`/datenschutz/anfrage`) erreichte man nur über
 *     den Werbewiderspruch — nicht von der Datenschutzerklärung aus.
 *
 * Geprüft wird ohne Browser: die Verweisliste gegen den Dateibaum und die
 * Routenliste, und der Quelltext der Hülle darauf, dass er die Liste an BEIDEN
 * Orten zeigt. Dass sie dort richtig aussieht, prüfen die Browserläufe.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GRUPPEN_SEITEN, gruppenVerweise } from '../../src/lib/oeffentliche-navigation.js';
import { SHELL_TEXTE, BARRIERE_TEXTE, BETROFFENENWEGE_TEXTE } from '../../src/lib/i18n/texte.js';
import {
  NUR_DEUTSCH, SPRACHEN, gibtEsIn, verweisIn, zerlegePfad,
} from '../../src/lib/sprache.js';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';

const OEFFENTLICH = fileURLToPath(new URL('../../src/app/(public)', import.meta.url));
const WURZEL = fileURLToPath(new URL('../..', import.meta.url));
const SAMMELROUTE = new Set(OEFFENTLICHE_ROUTEN.map((r) => r.pfad));

/**
 * Wird diese ADRESSE ausgeliefert? Entweder über die Sammelroute
 * (`[seite]` bzw. `en/[seite]`, ein Segment aus `OEFFENTLICHE_ROUTEN`) oder
 * als eigene `page.tsx` im Baum.
 */
function wirdAusgeliefert(adresse: string): boolean {
  const { sprache, pfad } = zerlegePfad(adresse);
  if (pfad !== '/' && pfad.split('/').filter(Boolean).length === 1 && SAMMELROUTE.has(pfad)) {
    return true;
  }
  const teile = pfad.split('/').filter(Boolean);
  const ordner = sprache === 'de' ? [OEFFENTLICH, ...teile] : [OEFFENTLICH, sprache, ...teile];
  return existsSync(join(...ordner, 'page.tsx'));
}

describe('die Gruppenseiten sind verlinkt (V-155)', () => {
  it('Über uns, Aktuelles und Karriere — genau diese drei', () => {
    expect(GRUPPEN_SEITEN.map((s) => s.pfad)).toEqual(['/ueber-uns', '/news', '/karriere']);
  });

  it('jeder Verweis führt in jeder Sprache auf eine Seite, die es gibt', () => {
    for (const s of SPRACHEN) {
      for (const v of gruppenVerweise(s)) {
        expect(wirdAusgeliefert(v.href), `${s}: ${v.href}`).toBe(true);
      }
    }
  });

  it('deutsch bleibt deutsch', () => {
    expect(gruppenVerweise('de').map((v) => [v.href, v.sprache])).toEqual([
      ['/ueber-uns', 'de'], ['/news', 'de'], ['/karriere', 'de'],
    ]);
  });

  it('englisch bleibt englisch — ausser /karriere, das es nur deutsch gibt', () => {
    /*
     * `/en/karriere` wäre ein 404 (NUR_DEUTSCH). Der Verweis führt deshalb auf
     * die deutsche Seite und TRÄGT die Sprache: die Hülle setzt daraus
     * `hrefLang="de"` und „(in German)". Weglassen wäre die schlechtere Wahl —
     * eine Bewerberin, die auf Englisch liest, erführe nie, dass es Stellen
     * gibt.
     */
    expect(NUR_DEUTSCH).toContain('/karriere');
    expect(gruppenVerweise('en').map((v) => [v.href, v.sprache])).toEqual([
      ['/en/ueber-uns', 'en'], ['/en/news', 'en'], ['/karriere', 'de'],
    ]);
  });

  it('jede Beschriftung steht in beiden Sprachen, und sie sind verschieden', () => {
    for (const s of SPRACHEN) {
      expect(SHELL_TEXTE[s].gruppeNav, s).not.toBe('');
      for (const g of GRUPPEN_SEITEN) expect(SHELL_TEXTE[s].gruppe[g.schluessel]).not.toBe('');
    }
    expect(SHELL_TEXTE.en.gruppe.ueberUns).not.toBe(SHELL_TEXTE.de.gruppe.ueberUns);
    // Der Sprachhinweis wird nur englisch gebraucht — und muss dort etwas sagen.
    expect(SHELL_TEXTE.en.aufDeutsch.toLowerCase()).toContain('german');
    expect(SHELL_TEXTE.de.aufDeutsch).toBe('');
  });

  it('die Hülle zeigt die Liste im Telefonmenü UND im Fuss', () => {
    const quelle = readFileSync(
      join(WURZEL, 'src/components/oeffentlich/OeffentlicheShell.tsx'), 'utf8');
    expect(quelle).toContain('gruppenVerweise(sprache)');
    expect(quelle.match(/gruppe\.map\(/gu)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(quelle).toContain('data-cse="menue-gruppe"');
    expect(quelle).toContain('data-cse="fuss-gruppe"');
    // Die Sprache des Ziels steht am Verweis, wo sie eine andere ist.
    expect(quelle).toMatch(/hrefLang=\{v\.sprache === sprache \? undefined : v\.sprache\}/u);
  });

  it('die Kopfzeile bleibt bei vier Punkten (DESIGN §5, D-417)', () => {
    const quelle = readFileSync(
      join(WURZEL, 'src/components/oeffentlich/OeffentlicheShell.tsx'), 'utf8');
    const haupt = /const HAUPT = \[([\s\S]*?)\] as const;/u.exec(quelle)?.[1] ?? '';
    expect(haupt.match(/\['\//gu)?.length).toBe(4);
  });
});

describe('verweisIn — der Verweis kennt die Sprache seines Ziels', () => {
  it('bleibt in der Sprache, wo es die Seite gibt', () => {
    expect(verweisIn('/datenschutz/anfrage', 'en'))
      .toEqual({ href: '/en/datenschutz/anfrage', sprache: 'en' });
    expect(verweisIn('/kontakt', 'de')).toEqual({ href: '/kontakt', sprache: 'de' });
  });

  it('führt sonst auf Deutsch — nie auf ein /en/-404', () => {
    for (const nurDeutsch of NUR_DEUTSCH) {
      const v = verweisIn(nurDeutsch, 'en');
      expect(v.sprache).toBe('de');
      expect(v.href.startsWith('/en/')).toBe(false);
      expect(gibtEsIn(nurDeutsch, 'en')).toBe(false);
    }
  });
});

describe('die Pflichtformulare sind verlinkt (V-156)', () => {
  it('die Barrierefreiheitserklärung führt auf das Meldeformular — in ihrer Sprache', () => {
    const quelle = readFileSync(
      join(WURZEL, 'src/app/(public)/barrierefreiheit/Erklaerung.tsx'), 'utf8');
    expect(quelle).toContain("mitSprache('/barrierefreiheit/feedback', sprache)");
    for (const s of SPRACHEN) {
      expect(BARRIERE_TEXTE[s].meldenFormular, s).not.toBe('');
      expect(wirdAusgeliefert(verweisIn('/barrierefreiheit/feedback', s).href), s).toBe(true);
    }
    /*
     * „Kein Meldeweg hinterlegt" war falsch, sobald es das Formular gab: der
     * Satz sagt jetzt, dass nur die ADRESSE fehlt.
     */
    expect(BARRIERE_TEXTE.de.keinMeldeweg).toContain('Formular');
    expect(BARRIERE_TEXTE.en.keinMeldeweg).toContain('form');
  });

  it('die Datenschutzerklärung führt auf Betroffenenanfrage und Werbewiderspruch', () => {
    const seite = readFileSync(join(WURZEL, 'src/app/(public)/OeffentlicheSeite.tsx'), 'utf8');
    expect(seite).toMatch(/pfad === '\/datenschutz' && <Betroffenenwege/u);
    const wege = readFileSync(
      join(WURZEL, 'src/components/oeffentlich/Betroffenenwege.tsx'), 'utf8');
    expect(wege).toContain("verweisIn('/datenschutz/anfrage', sprache)");
    expect(wege).toContain("verweisIn('/werbewiderspruch', sprache)");
    for (const s of SPRACHEN) {
      expect(BETROFFENENWEGE_TEXTE[s].anfrage, s).not.toBe('');
      expect(wirdAusgeliefert(verweisIn('/datenschutz/anfrage', s).href), s).toBe(true);
      expect(wirdAusgeliefert(verweisIn('/werbewiderspruch', s).href), s).toBe(true);
    }
  });

  it('der englische Werbewiderspruch verweist auf eine englische Anfrage, die es gibt', () => {
    // Werbewiderspruch.tsx: `mitSprache('/datenschutz/anfrage', sprache)` — war ein 404.
    expect(wirdAusgeliefert('/en/datenschutz/anfrage')).toBe(true);
    expect(wirdAusgeliefert('/en/datenschutz/anfrage/danke')).toBe(true);
    expect(wirdAusgeliefert('/en/barrierefreiheit/feedback')).toBe(true);
  });
});
