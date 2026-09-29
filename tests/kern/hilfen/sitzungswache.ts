/**
 * Antwortet eine Schreibroute ohne Sitzung SELBST — an der Weiche vorbei, die
 * Formulare erkennt? Gelesen am Syntaxbaum (D-766, V-256).
 *
 * **Wozu.** 218 Stellen in 170 Dateien unter `src/app/api` antworteten
 * ohne Sitzung mit `NextResponse.json({ fehler: 'keine_sitzung' },
 * { status: 401 })` und ohne zweiten Faktor mit `{ fehler: 'zweiter_faktor' }`
 * (403) — einem nativen
 * Browserformular eine weisse JSON-Seite. Die Weiche steht jetzt in
 * `server/auth/antwort.ts`; diese Wache hält den Baum dagegen, damit die
 * nächste Route nicht wieder abschreibt, was vorher überall stand.
 *
 * **Was sie meldet**, in jeder Datei unter `src/app/api`, die ein Schreibweg
 * ist oder einem Schreibweg zuarbeitet (Gerüste, Brücken, Übersetzer):
 *
 *  - `status_401` — die Zahl 401 im Code. Wer 401 selbst schreibt, schreibt
 *    auch die Antwort selbst; die einzige Stelle dafür ist die Weiche.
 *  - `anmeldecode` — die Codes der Anmeldung (`keine_sitzung`,
 *    `nicht_angemeldet`, `zweiter_faktor`) als Zeichenkette im Code: sie
 *    gehören in eine Antwort, und die schreibt die Weiche.
 *  - `ohne_weiche` — die Datei fragt `aktuelleSitzung()` und ruft keine der
 *    Weichen. Dann beantwortet sie „keine Sitzung" auf einem anderen Weg,
 *    und diese Wache sähe ihn nicht — also muss sie ihn melden.
 *
 * **Was sie nicht meldet:** Kommentare und Texte in Zeichenketten, die nur
 * ERKLÄREN (der Syntaxbaum kennt beide nicht als Code), und reine Lesewege
 * (eine `route.ts` ohne `POST`/`PUT`/`PATCH`/`DELETE`): ein `GET` ist kein
 * Formular dieser Plattform — geschrieben wird nie per `GET` (D-10).
 */
import { createRequire } from 'node:module';
import type * as TS from 'typescript';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;

/** Die Weichen, die ein Browserformular erkennen (`server/auth/antwort.ts`, `api/mein/formular.ts`). */
export const WEICHEN: ReadonlySet<string> = new Set([
  'ohneSitzungAntwort', 'ohneSitzungBeschaeftigte',
]);

/** Die JSON-Codes der Anmeldung — nur die Weiche schreibt sie. */
export const ANMELDE_CODES: ReadonlySet<string> = new Set([
  'keine_sitzung', 'nicht_angemeldet', 'zweiter_faktor',
]);

export type Befundart = 'status_401' | 'anmeldecode' | 'ohne_weiche';

export interface Befund {
  readonly datei: string;
  readonly zeile: number;
  readonly art: Befundart;
  readonly text: string;
}

const SCHREIBEND = /\bexport\s+(?:async\s+)?(?:function|const)\s+(?:POST|PUT|PATCH|DELETE)\b/u;

/** Eine `route.ts` ohne schreibenden Handler — ein Leseweg, kein Formular. */
export function istLeseweg(datei: string, quelle: string): boolean {
  return /(?:^|\/)route\.tsx?$/u.test(datei) && !SCHREIBEND.test(quelle);
}

/** Die Befunde einer Datei — leer heisst: ohne Sitzung antwortet hier die Weiche. */
export function pruefeQuelle(datei: string, quelle: string): Befund[] {
  if (istLeseweg(datei, quelle)) return [];
  const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const befunde: Befund[] = [];
  const melde = (n: TS.Node, art: Befundart): void => {
    befunde.push({
      datei,
      zeile: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      art,
      text: n.getText(sf).slice(0, 80),
    });
  };
  const stand: { sitzung: TS.Node | null; weiche: boolean } = { sitzung: null, weiche: false };
  const besuche = (n: TS.Node): void => {
    if (ts.isNumericLiteral(n) && Number(n.text) === 401) melde(n, 'status_401');
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
        && ANMELDE_CODES.has(n.text)) {
      melde(n, 'anmeldecode');
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === 'aktuelleSitzung') stand.sitzung ??= n;
      if (WEICHEN.has(n.expression.text)) stand.weiche = true;
    }
    ts.forEachChild(n, besuche);
  };
  besuche(sf);
  if (stand.sitzung !== null && !stand.weiche) melde(stand.sitzung, 'ohne_weiche');
  return befunde;
}
