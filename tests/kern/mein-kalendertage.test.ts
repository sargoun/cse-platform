/**
 * Das Arbeiterportal schreibt Kalendertage in der Sprache der Seite, nie als
 * `JJJJ-MM-TT` (V-199, D-693, EMP-12; Fortsetzung von V-210).
 *
 * **Der Befund.** Die Dienste liefern einen Kalendertag absichtlich als
 * ISO-Text — für Logik, Adressen, `key` und `data-*`. Die Seiten gaben ihn
 * aber unverändert aus: auf dem Blatt eines Zeiteintrags stand die
 * Überschrift „2026-09-11" über dem Feld Beginn „11.09.2026 22:00", dazu
 * Wochenwechsler, Nachweise, Anträge, Abwesenheiten, Dienstanweisungen und
 * Dokumente. V-210 hatte nur die Schichtseiten und den Monatsnachweis
 * umgestellt.
 *
 * **Geprüft am Quellbaum, nicht an einer Liste von Seiten:** jede `.tsx`
 * unter `src/app/portal/mein` — auch eine, die morgen dazukommt. Ein Feld, das
 * ein Dienst als ISO-Tag liefert, steht nie roh in einer JSX-Klammer oder in
 * einem Vorlagentext. Beschriftungen (`t.von`, `texte.bis`, `b.tag` des
 * Monatsnachweises …) sind keine Tage und bleiben aussen vor; Adressen, Schlüssel, `data-*` und versteckte
 * Felder behalten ISO, weil dort ein Programm liest.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tagInSprache } from '../../src/lib/datum/kalendertag.js';

const WURZEL = join(import.meta.dirname, '..', '..');
const PORTAL = join(WURZEL, 'src/app/portal/mein');

/** Jedes Feld, das ein Dienst des Arbeiterportals als `YYYY-MM-DD` liefert. */
const TAGESFELDER = [
  'planDatum', 'tag', 'von', 'bis', 'vonDatum', 'bisDatum', 'gueltigAb', 'gueltigBis',
  'widerrufenAm', 'entstandenAm', 'eintritt', 'austritt', 'betrifftDatum', 'kalendertag',
  'stichtag', 'leistungszeitraumVon', 'leistungszeitraumBis',
].join('|');

/** Ein Tag roh in einer JSX-Klammer — `{a.von}`, `{n.gueltigBis ?? …}`, `{tag}`. */
const IN_KLAMMER = new RegExp(
  String.raw`\{\s*(?!(?:t|texte|u|f|b)\.)(?:[\w.]+\.)?(?:${TAGESFELDER})\s*(?:\?\?[^}]*)?\}`, 'u');
/** Ein Tag roh in einem Vorlagentext — `` ` (${n.gueltigBis})` ``. */
const IN_VORLAGE = new RegExp(
  String.raw`\$\{\s*(?!(?:t|texte|u|f|b)\.)(?:[\w.]+\.)?(?:${TAGESFELDER})\s*\}`, 'u');
/** Ein berechneter Tag roh: `{tagePlus(von, 7)}`. */
const BERECHNET = /\{\s*tagePlus\(/u;

function seiten(): readonly string[] {
  return readdirSync(PORTAL, { recursive: true, encoding: 'utf8' })
    .filter((d) => d.endsWith('.tsx'))
    .map((d) => join(PORTAL, d));
}

/** Nur Code: Kommentarzeilen sprechen über Felder, sie zeigen sie nicht. */
function codeZeilen(pfad: string): readonly [number, string][] {
  return readFileSync(pfad, 'utf8').split('\n')
    .map((z, i): [number, string] => [i + 1, z])
    .filter(([, z]) => !/^\s*(?:\*|\/\/|\/\*|\{\/\*)/u.test(z))
    /*
     * Eigenschaften liest ein Programm — Adresse, Schlüssel, `data-*`,
     * Formularwert, ein Wechsler, der mit dem Tag rechnet. Nur die, die ein
     * Mensch liest (Beschriftung, Text, Titel), bleiben in der Prüfung.
     */
    .map(([n, z]): [number, string] => [n, z
      .replace(/\b(?!(?:label|text|titel|title|aria-label|alt)=)[\w-]+=\{`[^`]*`\}/gu, '')
      .replace(/\b(?!(?:label|text|titel|title|aria-label|alt)=)[\w-]+=\{[^}]*\}/gu, '')]);
}

describe('Kalendertage im Arbeiterportal', () => {
  it('der Quellbaum ist gefunden', () => {
    expect(seiten().length).toBeGreaterThan(30);
  });

  it('kein Feld, das ein ISO-Tag ist, steht roh auf dem Bildschirm', () => {
    const funde: string[] = [];
    for (const pfad of seiten()) {
      for (const [n, z] of codeZeilen(pfad)) {
        if (IN_KLAMMER.test(z) || IN_VORLAGE.test(z) || BERECHNET.test(z)) {
          funde.push(`${relative(WURZEL, pfad)}:${String(n)}: ${z.trim()}`);
        }
      }
    }
    expect(funde).toEqual([]);
  });

  it('die Wache sieht, wonach sie sucht (Gegenprobe)', () => {
    for (const roh of [
      '<span className="cse-zahl">{z.tag}</span>',
      '<span className="cse-zahl">{a.antrag.vonDatum ?? \'—\'}</span>',
      '{n.gueltigBis ?? t.unbefristet}',
      '<span className="cse-zahl">{von}</span>',
      "{n.gueltigBis === null ? '' : ` (${n.gueltigBis})`}",
      '← <span className="cse-zahl">{tagePlus(von, -7)}</span>',
    ]) {
      expect(IN_KLAMMER.test(roh) || IN_VORLAGE.test(roh) || BERECHNET.test(roh), roh)
        .toBe(true);
    }
    for (const gut of [
      '<label htmlFor="antrag-von">{t.von}</label>',
      '<span className="cse-zahl">{tagInSprache(z.tag, basis.sprache)}</span>',
      '{texte.bis}',
    ]) {
      expect(IN_KLAMMER.test(gut) || IN_VORLAGE.test(gut) || BERECHNET.test(gut), gut)
        .toBe(false);
    }
  });

  it('Deutsch, Arabisch und Türkisch schreiben TT.MM.JJJJ, Englisch „11 Sep 2026"', () => {
    expect(tagInSprache('2026-09-11', 'de')).toBe('11.09.2026');
    expect(tagInSprache('2026-09-11', 'ar')).toBe('11.09.2026');
    expect(tagInSprache('2026-09-11', 'tr')).toBe('11.09.2026');
    expect(tagInSprache('2026-09-11', 'en')).toMatch(/^11 Sep\w* 2026$/u);
    /* Die Sommerzeitnacht verschiebt keinen Kalendertag (Invariante 2). */
    expect(tagInSprache('2026-03-29', 'en')).toMatch(/^29 Mar\w* 2026$/u);
    expect(tagInSprache('2026-10-25', 'de')).toBe('25.10.2026');
  });
});
