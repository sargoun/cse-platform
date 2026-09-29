/**
 * **Kein Leerzeichen geht an einem Zeilenumbruch verloren** (V-252, D-743).
 *
 * JSX wirft Leerraum, der einen Zeilenumbruch enthält, am Rand eines
 * Textstücks ganz weg. Der Quelltext
 *
 *     Die Schichten liegen hinter dem Recht
 *     <Recht schluessel="dienstplan.lesen" />, das dieses Konto nicht hält.
 *
 * sieht richtig aus und rendert „hinter dem Recht„Dienstplan lesen““. Auf
 * main 21561fd standen 31 solche Fugen in 22 Dateien — neben einem Recht,
 * einem `<code>`, einem `<strong>`, einer Liste, einem Betrag.
 * Die Konvention des Baums ist `{' '}` am Ende der Zeile; wo zwei Stücke
 * wirklich aneinanderstossen sollen (`<strong>Mindest</strong>stärke`,
 * `+{betrag}`, ein Datum aus drei Teilen), stehen sie auf EINER Zeile.
 *
 * Die Regel liest `tests/kern/hilfen/jsx-leerraum.ts` am Syntaxbaum: welches
 * Zeichen jedes Stück an seinem Rand rendert, welche Hülle ihre Kinder als
 * Kästen stapelt, was ein eigener Baustein an seiner Wurzel hat.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pruefeLeerraum } from './hilfen/jsx-leerraum.js';

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));

function baum(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return baum(p);
    return e.endsWith('.tsx') ? [p] : [];
  });
}

const lies = (d: string): string | null => {
  try { return readFileSync(d, 'utf8'); } catch { return null; }
};

/** Die Zeilen einer Fixtur, auf der `{' '}` fehlt — `[]`, wenn keine. */
function fugen(quelle: string, weitere: readonly (readonly [string, string])[] = []): readonly number[] {
  const dateien = [['/x/a.tsx', quelle] as const, ...weitere];
  const quellen = new Map<string, string>(dateien);
  return pruefeLeerraum([dateien[0]!], (d) => quellen.get(d) ?? null, '/x').map((b) => b.zeile);
}

describe('kein Leerzeichen geht an einem Zeilenumbruch verloren', () => {
  it('über den ganzen Baum: Seiten und Bausteine', () => {
    const dateien = [...baum(join(WURZEL, 'src/app')), ...baum(join(WURZEL, 'src/components'))];
    // Die Prüfung liest überhaupt etwas — sonst wäre „keine Fuge" billig.
    expect(dateien.length).toBeGreaterThan(500);
    const befunde = pruefeLeerraum(dateien.map((d) => [d, readFileSync(d, 'utf8')] as const), lies, WURZEL)
      .map((b) => `${relative(WURZEL, b.datei)}:${String(b.zeile)}  …${b.links} ⏎ ${b.rechts}`);
    expect(befunde, "`{' '}` ans Ende der Zeile — oder beide Stücke auf eine Zeile, wenn sie "
      + 'aneinanderstossen sollen').toEqual([]);
  });

  it('die Gegenprobe: jede Art Fuge wird gefunden, in beiden Richtungen', () => {
    // Text vor einem Recht, einem Code, einem hervorgehobenen Wort.
    expect(fugen('const a = <p>Dafür fehlt\n  <Recht schluessel="crm.lesen" />.</p>;')).toEqual([1]);
    expect(fugen('const a = <p>kommen aus\n  <code>/datenschutz/anfrage</code>, dem Weg</p>;')).toEqual([1]);
    // Ein Element vor Text — auch vor einer Klammer.
    expect(fugen('const a = <p><strong>im Code</strong>\n  (vorerst)</p>;')).toEqual([1]);
    expect(fugen('const a = <p><code>x</code>\n  wirft, wenn</p>;')).toEqual([1]);
    // Ein Ausdruck, der ein Element rendern kann, und einer unbekannten Inhalts.
    expect(fugen('const a = <dd>12 m²/h\n  {x ? <span>unbestätigt</span> : null}</dd>;')).toEqual([1]);
    expect(fugen('const a = <p>Summe.\n  {t.satz}</p>;')).toEqual([1]);
    // Eine Liste vor einem freistehenden Strich.
    expect(fugen('const a = <p>{xs.map((x) => <code key={x}>{x}</code>)}\n  — genau die</p>;')).toEqual([1]);
    // Ein eigener Baustein, der als Wurzel ein Inline-Element rendert — auch über den Import.
    expect(fugen('function Betrag() { return <span>1 €</span>; }\nconst a = <p>Es sind\n  <Betrag /></p>;'))
      .toEqual([2]);
    expect(fugen("import { Betrag } from './betrag';\nconst a = <p>Es sind\n  <Betrag /></p>;",
      [['/x/betrag.tsx', 'export function Betrag() { return <span>1 €</span>; }']])).toEqual([2]);
    // Ein Ausdruck, der nichts rendern kann, lässt seine Nachbarn aneinanderstossen:
    // der Punkt trifft auf `t.mehr` — und, wenn der leer bleibt, auf `t.weiter`.
    expect(fugen("const a = <p>Satz.\n  {x ? t.mehr : ''}\n  {t.weiter}</p>;")).toEqual([1, 1]);
  });

  it('und findet nichts, wo das Leerzeichen steht oder nicht hingehört', () => {
    // Das Leerzeichen steht da.
    expect(fugen("const a = <p>Dafür fehlt{' '}\n  <Recht schluessel=\"crm.lesen\" />.</p>;")).toEqual([]);
    expect(fugen("const a = <p>Dafür fehlt\n  {' '}<Recht schluessel=\"crm.lesen\" />.</p>;")).toEqual([]);
    expect(fugen('const a = <p>Dafür fehlt <Recht schluessel="crm.lesen" />.</p>;')).toEqual([]);
    // Auf einer Zeile gewollt aneinander.
    expect(fugen('const a = <p>die <strong>Mindest</strong>stärke</p>;')).toEqual([]);
    // Satzzeichen, die sich anhängen, und Zeichen, hinter denen nichts steht.
    expect(fugen('const a = <p><Recht schluessel="crm.lesen" />\n  , und</p>;')).toEqual([]);
    expect(fugen('const a = <p>(\n  <Recht schluessel="crm.lesen" />)</p>;')).toEqual([]);
    expect(fugen('const a = <p>E-\n  <b>Mail</b></p>;')).toEqual([]);
    // Kästen statt Fliesstext: Flex-Hülle, Block-Kind, Zeilenumbruch, Liste.
    expect(fugen('const a = <p className="flex gap-s2">Text\n  <span>x</span></p>;')).toEqual([]);
    expect(fugen('const a = <div>Text\n  <p>Absatz</p></div>;')).toEqual([]);
    expect(fugen('const a = <p>Zeile\n  <br />\n  nächste</p>;')).toEqual([]);
    expect(fugen('const a = <ul>\n  <li>a</li>\n  <li>b</li>\n</ul>;')).toEqual([]);
    expect(fugen('const a = <span>Text\n  <span className="block">x</span></span>;')).toEqual([]);
    // Ein Baustein, der sich nicht auflösen lässt, gilt als Kasten.
    expect(fugen("import { Knopf } from '@/unbekannt';\nconst a = <p>Text\n  <Knopf /></p>;")).toEqual([]);
  });
});
