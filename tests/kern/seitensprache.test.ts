/**
 * Das Portal sagt die Sprache seiner Teile an — die Hülle die der Sitzung,
 * der Inhalt seine eigene (WCAG 3.1.1, 3.1.2; D-767, V-257).
 *
 * **Der Befund.** Jede Seite der Verwaltung, der Kunden und der Gruppe trug
 * nur `<html lang="de-DE">`, auch in einer englischen Sitzung — ein
 * Screenreader las englische Kopfzeile, Leiste und übersetzten Inhalt mit
 * deutscher Aussprache. `lang="en"` über ALLEM wäre der umgekehrte Fehler
 * für die Seiten, deren Inhalt noch fest deutsch ist (die Ausnahmeliste der
 * Sperrklinke `seite-ohne-uebersetzung`).
 *
 * Geprüft werden (1) der Weg von der Adresse zur Seitendatei über das
 * Manifest — über den ganzen Baum, denn an ihm hängt die Antwort —, (2) die
 * Entscheidung des Rahmens als reine Funktion, (3) `PortalRahmen` selbst,
 * gerendert, und (4) die Hüllen, die ihre Sprache selbst ansagen.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as React from 'react';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UEBERSETZUNG_AUSNAHMEN } from '../../scripts/guards/uebersetzung-ausnahmen.js';
import { ROUTEN } from '../../src/server/registry/routen.js';

/* Die Bauteile erwarten `React` im Geltungsbereich (klassische JSX-Umwandlung, V-153). */
(globalThis as { React?: typeof React }).React = React;

const zustand = vi.hoisted(() => ({
  stand: {
    sprache: null as null | 'de' | 'en' | 'ar' | 'tr',
    pfad: null as null | string,
    rueckweg: null as null | { ziel: string; segment: string },
    umschalter: null,
  },
}));

vi.mock('@/app/portal/huellen-speicher', () => ({
  gemerkteHuelle: () => zustand.stand,
  merkeHuelle: vi.fn(),
  merkeUmschalter: vi.fn(),
  merkeSprache: vi.fn(),
}));
/* Die Glocke fragt die Datenbank nach Ungelesenem — hier geht es um die Sprache. */
vi.mock('@/components/portal/Glocke', () => ({ Glocke: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));

const { seitendatei, inhaltFolgtSitzung } =
  await import('../../src/server/registry/seitensprache.js');
const { rahmenSprachen } = await import('../../src/components/portal/rahmen-sprache.js');
const { PortalRahmen } = await import('../../src/components/portal/PortalRahmen.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const NOCH_DEUTSCH = new Set(UEBERSETZUNG_AUSNAHMEN);

function seiten(verzeichnis: string): string[] {
  const treffer: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) treffer.push(...seiten(voll));
    else if (eintrag === 'page.tsx') treffer.push(relative(WURZEL, voll));
  }
  return treffer;
}

/** Eine Adresse, unter der Next die Seite `datei` ausliefert. */
function adresse(datei: string): string {
  return datei.replace(/^src\/app/u, '').replace(/\/page\.tsx$/u, '').split('/').map((seg) => {
    if (seg === '[mandant]') return 'reinigung';
    if (/^\[.+\]$/u.test(seg)) return '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
    return seg;
  }).join('/');
}

/**
 * Die Seiten, deren Sprache `PortalRahmen` ansagt: Verwaltung, Kunden und
 * Gruppe. Das Arbeiterportal und die Kontoseiten sagen sie selbst an (4);
 * die Auffangseiten `[...rest]` antworten auf eine Adresse ausserhalb des
 * Manifests mit 404, `/portal` ist ein Wegweiser ohne Hülle.
 */
const RAHMENSEITEN = seiten(join(WURZEL, 'src/app/portal'))
  .filter((d) => !/^src\/app\/portal\/(?:mein|konto)\//u.test(d))
  .filter((d) => !d.includes('[...rest]') && d !== 'src/app/portal/page.tsx');

describe('(1) von der Adresse zur Seitendatei — genau, über den ganzen Baum', () => {
  it('der Baum ist der, den es zu prüfen gilt', () => {
    expect(RAHMENSEITEN.length).toBeGreaterThan(350);
  });

  it('jede Seite der Verwaltung, der Kunden und der Gruppe findet über ihre Adresse sich selbst', () => {
    const daneben = RAHMENSEITEN.filter((d) => seitendatei(adresse(d)) !== d)
      .map((d) => `${d} → ${String(seitendatei(adresse(d)))}`);
    expect(daneben, 'Manifest und Seitenbaum laufen auseinander — die Sprachangabe '
      + 'fragte die falsche Datei').toEqual([]);
  });

  it('jede Manifestzeile dieser Portale hat ihre Seite — keine Antwort über eine Datei, die es nicht gibt', () => {
    const ohne = ROUTEN.map((r) => r.pfad)
      .filter((p) => /^\/portal\/(?!mein\/|mein$|konto\/|konto$)/u.test(p))
      .filter((p) => !existsSync(join(WURZEL, 'src/app', p, 'page.tsx')));
    expect(ohne).toEqual([]);
  });

  it('eine Seite der Ausnahmeliste spricht deutsch, jede andere die Sitzung, eine fremde Adresse deutsch', () => {
    const deutsch = RAHMENSEITEN.find((d) => NOCH_DEUTSCH.has(d));
    const uebersetzt = RAHMENSEITEN.find((d) => !NOCH_DEUTSCH.has(d));
    expect(deutsch).toBeDefined();
    expect(uebersetzt).toBeDefined();
    expect(inhaltFolgtSitzung(adresse(deutsch!))).toBe(false);
    expect(inhaltFolgtSitzung(adresse(uebersetzt!))).toBe(true);
    expect(inhaltFolgtSitzung('/portal/reinigung/gibt/es/nicht/wirklich/hier')).toBe(false);
  });

  it('die Antwort folgt der Liste über den ganzen Baum — Streichen einer Zeile stellt die Seite um', () => {
    for (const d of RAHMENSEITEN) {
      expect(inhaltFolgtSitzung(adresse(d)), d).toBe(!NOCH_DEUTSCH.has(d));
    }
  });

  it('die neuen Seiten der Gruppen Berichte und Kalender/Recruiting: ihre Datei, und ihr Inhalt folgt der Sitzung', () => {
    for (const [pfad, datei] of [
      ['/portal/reinigung/kalender/neu', 'src/app/portal/[mandant]/kalender/neu/page.tsx'],
      ['/portal/reinigung/recruiting/bewerbungen/neu',
        'src/app/portal/[mandant]/recruiting/bewerbungen/neu/page.tsx'],
      ['/portal/reinigung/berichte/druck/umsatz',
        'src/app/portal/[mandant]/berichte/druck/[bericht]/page.tsx'],
    ] as const) {
      expect(seitendatei(pfad), pfad).toBe(datei);
      /* Ihre Wörter kommen aus den Texttabellen der Sitzungssprache — keine steht auf der Liste. */
      expect(NOCH_DEUTSCH.has(datei), datei).toBe(false);
      expect(inhaltFolgtSitzung(pfad), pfad).toBe(true);
    }
  });
});

describe('(2) die Entscheidung des Rahmens', () => {
  const DEUTSCH = adresse(RAHMENSEITEN.find((d) => NOCH_DEUTSCH.has(d))!);
  const UEBERSETZT = adresse(RAHMENSEITEN.find((d) => !NOCH_DEUTSCH.has(d))!);

  it('englische Sitzung: Hülle englisch, Inhalt englisch — oder deutsch, wo die Seite es noch ist', () => {
    expect(rahmenSprachen({ sprache: 'en', pfad: UEBERSETZT }, false))
      .toEqual({ huelle: 'en', inhalt: 'en', huelleLang: 'en', inhaltLang: 'en' });
    expect(rahmenSprachen({ sprache: 'en', pfad: DEUTSCH }, false))
      .toEqual({ huelle: 'en', inhalt: 'de', huelleLang: 'en', inhaltLang: 'de-DE' });
  });

  it('deutsche oder keine Wahl: beides deutsch; Arabisch und Türkisch spricht die Verwaltung nicht (D-592)', () => {
    for (const sprache of ['de', null, 'ar', 'tr'] as const) {
      expect(rahmenSprachen({ sprache, pfad: UEBERSETZT }, false), String(sprache))
        .toEqual({ huelle: 'de', inhalt: 'de', huelleLang: 'de-DE', inhaltLang: 'de-DE' });
    }
  });

  it('eigene Beschriftungen oder keine Pforte: der Rahmen sagt nichts, der Aufrufer sagt es', () => {
    expect(rahmenSprachen({ sprache: 'ar', pfad: '/portal/mein' }, true)).toBeNull();
    expect(rahmenSprachen({ sprache: 'en', pfad: null }, false)).toBeNull();
  });
});

describe('(3) PortalRahmen, gerendert', () => {
  const DEUTSCH = adresse(RAHMENSEITEN.find((d) =>
    NOCH_DEUTSCH.has(d) && d.startsWith('src/app/portal/[mandant]/'))!);
  const UEBERSETZT = adresse(RAHMENSEITEN.find((d) =>
    !NOCH_DEUTSCH.has(d) && d.startsWith('src/app/portal/[mandant]/'))!);

  beforeEach(() => {
    zustand.stand = {
      sprache: 'en', pfad: UEBERSETZT,
      rueckweg: { ziel: '/portal/reinigung/finanzen', segment: 'finanzen' }, umschalter: null,
    };
  });

  const rahmen = (extra: Record<string, unknown> = {}): string => renderToStaticMarkup(
    createElement(PortalRahmen, {
      titel: 'Seitentitel', bereich: 'reinigung', nurLesen: false, leiste: 'intern_admin',
      wurzel: '/portal/reinigung', ...extra,
    } as React.ComponentProps<typeof PortalRahmen>, createElement('p', null, 'Inhalt')));

  const tag = (html: string, muster: RegExp): string => html.match(muster)?.[0] ?? '';

  it('übersetzte Seite, englische Sitzung: Hülle, Titel, Inhalt und Rückweg sagen en', () => {
    const html = rahmen();
    expect(tag(html, /<div data-cse="portal-rahmen"[^>]*>/u)).toContain('lang="en"');
    expect(tag(html, /<main[^>]*>/u)).toContain('lang="en"');
    expect(html).toMatch(/<span class="truncate" lang="en">Seitentitel<\/span>/u);
    /* Der abgeleitete Rückweg: Name und Sprache der Hülle. */
    expect(tag(html, /<nav aria-label="Back"[^>]*>/u)).toContain('lang="en"');
    /* Die Hülle SPRICHT auch englisch — sonst wäre die Angabe eine Behauptung. */
    expect(html).toContain('Sign out');
  });

  it('Seite der Ausnahmeliste, englische Sitzung: Hülle en, Titel und Inhalt de-DE, Rückweg en', () => {
    zustand.stand = { ...zustand.stand, pfad: DEUTSCH };
    const html = rahmen();
    expect(tag(html, /<div data-cse="portal-rahmen"[^>]*>/u)).toContain('lang="en"');
    expect(tag(html, /<main[^>]*>/u)).toContain('lang="de-DE"');
    expect(html).toMatch(/<span class="truncate" lang="de-DE">Seitentitel<\/span>/u);
    /* Der abgeleitete Rückweg ist ein Wort der Hülle — auch über deutschem Inhalt. */
    expect(tag(html, /<nav aria-label="Back"[^>]*>/u)).toContain('lang="en"');
  });

  it('der Rückweg der Seite spricht wie ihr Inhalt — kein eigenes lang, der Name deutsch', () => {
    zustand.stand = { ...zustand.stand, pfad: DEUTSCH };
    const html = rahmen({ zurueck: { ziel: '/portal/reinigung/auftraege', text: 'Alle Aufträge' } });
    expect(tag(html, /<nav aria-label="Zurück"[^>]*>/u)).not.toContain('lang=');
    expect(html).toContain('Alle Aufträge');
  });

  it('in der Spur trägt der Wurzeltitel die Sprache des Inhalts', () => {
    zustand.stand = { ...zustand.stand, pfad: DEUTSCH };
    const html = rahmen({ wurzelTitel: 'Übersicht' });
    expect(html).toMatch(/<span class="truncate" lang="de-DE">Übersicht<\/span>/u);
    expect(html).toMatch(/<span class="truncate text-h3 text-text" lang="de-DE">Seitentitel<\/span>/u);
  });

  it('deutsche Sitzung: alles de-DE', () => {
    zustand.stand = { ...zustand.stand, sprache: 'de' };
    const html = rahmen();
    expect(tag(html, /<div data-cse="portal-rahmen"[^>]*>/u)).toContain('lang="de-DE"');
    expect(tag(html, /<main[^>]*>/u)).toContain('lang="de-DE"');
  });

  it('mit eigenen Beschriftungen (Arbeiterhülle) und ohne Pforte (Kontoseiten) kein lang vom Rahmen', () => {
    for (const html of [
      rahmen({ beschriftungen: { 'sitzung.abmelden': 'تسجيل الخروج' } }),
      (() => { zustand.stand = { ...zustand.stand, pfad: null }; return rahmen(); })(),
    ]) {
      expect(tag(html, /<div data-cse="portal-rahmen"[^>]*>/u)).not.toContain('lang=');
      expect(tag(html, /<main[^>]*>/u)).not.toContain('lang=');
    }
  });

  it('eine Kontoseite: die Kopfzeile folgt jetzt der Sprache der Person (merkeSprache)', () => {
    zustand.stand = { sprache: 'en', pfad: null, rueckweg: null, umschalter: null };
    expect(rahmen()).toContain('Sign out');
  });
});

describe('(4) die Hüllen, die ihre Sprache selbst ansagen', () => {
  const quelle = (datei: string): string => readFileSync(join(WURZEL, datei), 'utf8');

  it('das Arbeiterportal: MeinRahmen setzt lang und dir UM den Rahmen, und jede Seite nimmt ihn', () => {
    const rahmenDatei = quelle('src/app/portal/mein/rahmen.tsx');
    expect(rahmenDatei).toMatch(/<div\s+lang=\{PORTAL_BCP47\[basis\.sprache\]\}\s+dir=\{PORTAL_RICHTUNG\[basis\.sprache\]\}/u);
    expect(rahmenDatei).toMatch(/beschriftungen=\{meinBeschriftungen\(basis\.texte\)\}/u);
    /* Wer ohne MeinRahmen rendert (das Druckblatt), sagt seine Sprache selbst an. */
    const ohne = seiten(join(WURZEL, 'src/app/portal/mein'))
      .filter((d) => !d.includes('[...rest]'))
      .filter((d) => !quelle(d).includes('<MeinRahmen') && !/lang=\{PORTAL_BCP47\[/u.test(quelle(d)));
    expect(ohne, 'eine Seite des Arbeiterportals ohne MeinRahmen und ohne eigenes lang').toEqual([]);
  });

  it('ein Blatt ohne Hülle (cse-blatt) sagt seine Sprache selbst an — ausser es steht deutsch auf der Liste', () => {
    /*
     * Ein Druckblatt steht ohne `PortalRahmen`; niemand sonst sagt ihm die
     * Sprache an. Auf der Ausnahmeliste ist es deutsch und erbt richtig
     * `<html lang="de-DE">` (das Angebot); sonst stehen seine Wörter in der
     * Sprache der Sitzung, und es muss sie selbst ansagen (das Druckblatt der
     * Berichte, mit der Gruppe Berichte neu; D-767 Nachsatz).
     */
    const blaetter = RAHMENSEITEN.filter((d) => quelle(d).includes('className="cse-blatt"'));
    expect(blaetter).toContain('src/app/portal/[mandant]/berichte/druck/[bericht]/page.tsx');
    const ohne = blaetter.filter((d) => !NOCH_DEUTSCH.has(d))
      .filter((d) => !/className="cse-blatt" lang=\{PORTAL_BCP47\[\w+\]\}/u.test(quelle(d)));
    expect(ohne, 'ein übersetztes Blatt ohne eigenes lang erbt <html lang="de-DE">').toEqual([]);
    const bericht = quelle('src/app/portal/[mandant]/berichte/druck/[bericht]/page.tsx');
    expect(bericht).toContain('const t = nachSprache(BERICHT_DRUCK_TEXTE, blattSprache);');
    expect(bericht).toContain('lang={PORTAL_BCP47[blattSprache]}');
  });

  it('der Monatsnachweis: lang folgt der Sprache, in der seine Wörter stehen — nicht fest de', () => {
    const blatt = quelle('src/app/portal/mein/monatsnachweis/page.tsx');
    expect(blatt).toContain('const t = meinTexte(blattSprache);');
    expect(blatt).toContain('lang={PORTAL_BCP47[blattSprache]}');
    expect(blatt).not.toContain('className="cse-blatt" lang="de"');
  });

  it('die Kontoseiten: jede setzt lang und dir um ihren Inhalt, und leseKonto legt die Sprache ab', () => {
    for (const d of seiten(join(WURZEL, 'src/app/portal/konto'))) {
      expect(quelle(d), d).toMatch(/lang=\{PORTAL_BCP47\[\w+\]\} dir=\{PORTAL_RICHTUNG\[\w+\]\}/u);
    }
    expect(quelle('src/app/portal/konto/konto.ts')).toContain('merkeSprache(bild.sprache);');
  });
});
