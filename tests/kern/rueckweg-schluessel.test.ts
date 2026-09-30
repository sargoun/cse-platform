/**
 * **Kein Satz aus der Adresse** (D-769, V-272 bis V-276) — die Wache über den
 * ganzen Baum, gelesen am Syntaxbaum.
 *
 * Bis D-769 lasen 34 Seiten den Suchparameter `meldung` und zeigten ihn in
 * einem Kasten; rund 25 Routen schrieben den deutschen Satz eines Dienstes
 * per `encodeURIComponent` in die Adresse. Jeder präparierte Link schrieb
 * damit seine eigene Systemmeldung — auch auf der Website. Die fünf Teile
 * haben jeden Rückweg auf Schlüssel umgestellt; diese Wache hält es so:
 *
 *  1. Kein Text in `src/app` oder `src/server` baut eine Adresse mit
 *     `meldung=` (Zeichenketten und Vorlagen, nicht Kommentare).
 *  2. Keine Seite und kein Baustein liest `meldung` aus der Adresse — weder
 *     `x['meldung']` noch `f(x, 'meldung')`.
 *  3. Kein Rückweg schreibt einen Satz per `encodeURIComponent(…)` in
 *     `fehler`, `erfolg`, `ok`, `grund` oder `hinweis`: dort stehen nur
 *     Schlüssel.
 *
 * Dass eine Seite `erfolg`/`ok`/`hinweis` nie ROH zeigt, prüft
 * `adressparameter.test.ts` (Art `direkt`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as TS from 'typescript';
import { describe, expect, it } from 'vitest';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;
const WURZEL = fileURLToPath(new URL('../..', import.meta.url));

function baum(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return baum(p);
    return /\.tsx?$/u.test(p) && !p.endsWith('.d.ts') ? [p] : [];
  });
}

function besuche(datei: string, f: (k: TS.Node, sf: TS.SourceFile) => void): void {
  const sf = ts.createSourceFile(datei, readFileSync(datei, 'utf8'), ts.ScriptTarget.Latest, true,
    datei.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lauf = (k: TS.Node): void => { f(k, sf); ts.forEachChild(k, lauf); };
  lauf(sf);
}

const ort = (datei: string, k: TS.Node, sf: TS.SourceFile): string =>
  `${relative(WURZEL, datei)}:${String(sf.getLineAndCharacterOfPosition(k.getStart()).line + 1)}`;

/** Der Text eines Zeichenketten- oder Vorlagenstücks, sonst `null`. */
function stueck(k: TS.Node): string | null {
  if (ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k)) return k.text;
  if (ts.isTemplateHead(k) || ts.isTemplateMiddle(k) || ts.isTemplateTail(k)) return k.text;
  return null;
}

const ALLE = [...baum(join(WURZEL, 'src/app')), ...baum(join(WURZEL, 'src/server'))];
const OBERFLAECHE = [...baum(join(WURZEL, 'src/app')), ...baum(join(WURZEL, 'src/components'))]
  .filter((d) => d.endsWith('.tsx') || !/\/route\.ts$/u.test(d));

describe('kein Satz aus der Adresse', () => {
  it('die Wache liest überhaupt Dateien', () => {
    expect(ALLE.length).toBeGreaterThan(800);
    expect(OBERFLAECHE.length).toBeGreaterThan(500);
  });

  it('(1) keine Adresse mit `meldung=`', () => {
    const treffer: string[] = [];
    for (const d of ALLE) {
      besuche(d, (k, sf) => {
        const t = stueck(k);
        if (t !== null && /[?&]meldung=/u.test(t)) treffer.push(ort(d, k, sf));
      });
    }
    expect(treffer).toEqual([]);
  });

  it('(2) keine Seite und kein Baustein liest `meldung` aus der Adresse', () => {
    const treffer: string[] = [];
    for (const d of OBERFLAECHE) {
      besuche(d, (k, sf) => {
        if (ts.isElementAccessExpression(k) && stueck(k.argumentExpression) === 'meldung') {
          treffer.push(ort(d, k, sf));
        }
        if (ts.isCallExpression(k) && k.arguments.some((a) => stueck(a) === 'meldung')) {
          treffer.push(ort(d, k, sf));
        }
      });
    }
    expect(treffer).toEqual([]);
  });

  it('(3) in `fehler`, `erfolg`, `ok`, `grund`, `hinweis` reist nie ein kodierter Satz', () => {
    const treffer: string[] = [];
    const PARAMETER = /[?&](?:fehler|erfolg|ok|grund|hinweis)=$/u;
    for (const d of ALLE) {
      besuche(d, (k, sf) => {
        if (!ts.isTemplateExpression(k)) return;
        const teile = [k.head, ...k.templateSpans.map((s) => s.literal)];
        k.templateSpans.forEach((span, i) => {
          const davor = teile[i]?.text ?? '';
          const e = span.expression;
          if (PARAMETER.test(davor) && ts.isCallExpression(e)
            && ts.isIdentifier(e.expression) && e.expression.text === 'encodeURIComponent') {
            const arg = e.arguments[0];
            const quelle = arg === undefined ? '' : arg.getText(sf);
            if (/message|meldung|satz|text/iu.test(quelle)) treffer.push(`${ort(d, span, sf)} ${quelle}`);
          }
        });
      });
    }
    expect(treffer).toEqual([]);
  });

  it('die Gegenprobe: jede der drei Formen wird gefunden', () => {
    const probe = (quelle: string): readonly string[] => {
      const sf = ts.createSourceFile('/x.tsx', quelle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const gefunden: string[] = [];
      const lauf = (k: TS.Node): void => {
        const t = stueck(k);
        if (t !== null && /[?&]meldung=/u.test(t)) gefunden.push('1');
        if (ts.isElementAccessExpression(k) && stueck(k.argumentExpression) === 'meldung') gefunden.push('2');
        if (ts.isCallExpression(k) && k.arguments.some((a) => stueck(a) === 'meldung')) gefunden.push('2');
        ts.forEachChild(k, lauf);
      };
      lauf(sf);
      return gefunden;
    };
    expect(probe('const u = `${z}?meldung=${encodeURIComponent(e.message)}`;')).toContain('1');
    expect(probe("const m = suche['meldung'];")).toEqual(['2']);
    expect(probe("const m = wort(suche, 'meldung', 500);")).toEqual(['2']);
    expect(probe("// früher: ?meldung=\nconst f = suche['fehler'];")).toEqual([]);
  });
});
