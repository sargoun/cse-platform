/**
 * **Jeder Sprung in der Recruiting-Zeile hat einen Eintrag im Routenmanifest
 * — und die Zeile fragt GENAU dessen Rechte ab.**
 *
 * `rahmen.tsx` hatte je Sprung einen handgesetzten Schlüssel. Zwei davon waren
 * zu mild: `/recruiting/bedarf` verlangt zusätzlich `dienstplan.lesen`,
 * `/recruiting/gespraeche` zusätzlich `kalender.schreiben`. Wer nur das eine
 * hielt, sah den Knopf und bekam dahinter 404 (AUT-06).
 *
 * Die Zeile liest die Rechte jetzt aus dem Manifest. Dieser Test hält die
 * andere Hälfte fest: dass es den Manifest-Eintrag ÜBERHAUPT gibt. Fehlt er,
 * ist die Rechteliste leer und der Sprung verschwindet still aus der Zeile —
 * die sichere Richtung, aber eine, die sonst niemandem auffiele ausser dem
 * Menschen, dem der Knopf fehlt.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findeRoute, leserechte, routeMitPfad } from '../../src/server/registry/routen.js';

const RAHMEN = fileURLToPath(
  new URL('../../src/app/portal/[mandant]/recruiting/rahmen.tsx', import.meta.url));

/** Die Pfade aus `SPRUNGZIELE` — gelesen, nicht abgeschrieben. */
function sprungziele(): readonly string[] {
  const quelle = readFileSync(RAHMEN, 'utf8');
  const block = /const SPRUNGZIELE[\s\S]*?\n\];/u.exec(quelle);
  expect(block, 'SPRUNGZIELE nicht gefunden — wurde die Zeile umbenannt?').not.toBeNull();
  return [...block![0].matchAll(/\{\s*pfad:\s*'([^']*)'/gu)].map((m) => m[1]!);
}

describe('die Recruiting-Sprungzeile steht auf dem Routenmanifest', () => {
  it('findet sieben Ziele', () => {
    expect(sprungziele()).toHaveLength(7);
  });

  it('jedes Ziel hat einen Manifest-Eintrag MIT mindestens einem Leserecht', () => {
    for (const p of sprungziele()) {
      const pfad = `/portal/[mandant]/recruiting${p === '' ? '' : `/${p}`}`;
      const eintrag = routeMitPfad(pfad);
      expect(eintrag, `kein Manifest-Eintrag fuer ${pfad}`).toBeDefined();
      expect(leserechte(eintrag!).length, `${pfad} ohne Leserecht`).toBeGreaterThan(0);
    }
  });

  /**
   * Die beiden Fälle, die der Befund nannte — ausdrücklich und namentlich,
   * damit ein späteres „das eine Recht genügt doch" hier auffällt.
   */
  it('`bedarf` verlangt auch `dienstplan.lesen`, `gespraeche` auch `kalender.schreiben`', () => {
    expect(leserechte(routeMitPfad('/portal/[mandant]/recruiting/bedarf')!))
      .toContain('dienstplan.lesen');
    expect(leserechte(routeMitPfad('/portal/[mandant]/recruiting/gespraeche')!))
      .toContain('kalender.schreiben');
  });
});

/**
 * **Jede Recruiting-Seite öffnet sich unter IHREM eigenen Recht.**
 *
 * `RecruitingSeite` baut aus `unterpfad` den Pfad, gegen den `mandantTor` das
 * Manifest fragt. Wer dort den Zweig statt der Seite einträgt, öffnet die
 * Seite unter dem Recht des Zweiges — und das ist regelmässig das mildere:
 *
 *  - `stellen/[id]/veroeffentlichung` verlangt `recruiting.stelle_veroeffentlichen`,
 *    `stellen` nur `recruiting.stelle_schreiben`;
 *  - `kandidaten/[id]/bewertung` verlangt `recruiting.bewerbung_bewerten`,
 *  - `kandidaten/[id]/entscheidung` verlangt `recruiting.entscheiden`,
 *    `kandidaten` nur `recruiting.bewerbung_lesen`.
 *
 * Alle drei standen auf ihrem Zweig. Gemeldet hat die Copilot-Runde auf PR 16
 * EINEN davon; die anderen zwei fand erst diese Prüfung — und genau dafür
 * steht sie hier: sie zählt nicht drei Fälle ab, sie liest den Baum.
 */
const RECRUITING = fileURLToPath(
  new URL('../../src/app/portal/[mandant]/recruiting', import.meta.url));

function seiten(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return seiten(p);
    return e === 'page.tsx' ? [p] : [];
  });
}

describe('jede Recruiting-Seite prueft ihren EIGENEN Manifestpfad', () => {
  it('der unterpfad jeder Seite ergibt ihre eigene Route', () => {
    const falsch: string[] = [];
    for (const datei of seiten(RECRUITING)) {
      const quelle = readFileSync(datei, 'utf8');
      if (!quelle.includes('RecruitingSeite')) continue;
      const treffer = /unterpfad=(?:"([^"]*)"|\{`([^`]*)`\})/u.exec(quelle);
      if (treffer === null) continue;
      /* Der Wert aus der Vorlage: `${id}` ist ein Segment, egal welches. */
      const roh = (treffer[1] ?? treffer[2] ?? '').replace(/\$\{[^}]*\}/gu, 'x');
      const gemeint = `/portal/[mandant]/recruiting${roh === '' ? '' : `/${roh}`}`;
      /* Und der Pfad, den die DATEI selbst darstellt. */
      const eigen = '/portal/[mandant]/recruiting'
        + relative(RECRUITING, datei).replace(/\/?page\.tsx$/u, '')
          .split('/').map((t) => (t === '' ? '' : `/${t}`)).join('');
      const a = findeRoute(gemeint.replace(/\[mandant\]/u, 'reinigung'));
      const b = routeMitPfad(eigen);
      if (b === undefined) continue;
      const soll = [...leserechte(b)].sort().join(',');
      const ist = a === undefined ? '(keine)' : [...leserechte(a)].sort().join(',');
      if (soll !== ist) falsch.push(`${eigen}: prueft ${ist}, verlangt aber ${soll}`);
    }
    expect(falsch).toEqual([]);
  });
});
