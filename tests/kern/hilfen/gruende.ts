/**
 * Welche Gründe kann eine Route auf ihre Seite zurückschicken? — gelesen am
 * Syntaxbaum (V-274, D-772).
 *
 * **Wozu.** Eine Route schickt den Grund einer Abweisung als Schlüssel in die
 * Adresse (`?fehler=kunde_unbekannt`), und die Seite schlägt ihn in IHRER
 * Tabelle nach (D-769). Fehlt dort ein Grund, steht der allgemeine Satz da —
 * ehrlich, aber ohne das, was der Mensch ändern muss. Die Tabellen sind
 * deshalb an die Gründe gebunden, die die Route wirklich werfen kann, und
 * zwar aus dem Quelltext gelesen, nicht abgetippt: wer einem Dienst einen
 * neuen Grund gibt, bricht die Prüfung, bis die Seite einen Satz dafür hat.
 *
 * **Was gelesen wird.** Ab einer Funktion (`POST` einer Route oder eine
 * Funktion eines Dienstes) jeder Wurf `new K(satz, grund, …)` einer der
 * genannten Klassen — der Grund ist das ZWEITE Argument. Ein festes Wort
 * zählt, ebenso beide Äste eines `?:`; ein Parameter zählt mit dem Wort, das
 * der Aufrufer an dieser Stelle übergibt (`alsKennung(…, 'dokument_keine_kennung')`).
 * Von dort weiter in jede aufgerufene Funktion derselben Datei und, über den
 * Import, jeder Datei unter `src/server/services` — auch in Rückrufe
 * (`db().begin(async (tx) => withTenant(…, async (k) => …))`), weil sie im
 * Rumpf stehen. Nicht verfolgt werden Methoden (`kontext.schreibe(…)`) und
 * Module ausserhalb der Dienste (`authorize`, `withTenant`): sie werfen
 * keinen fachlichen Grund.
 *
 * **Was sich nicht lesen lässt, steht unter `offen`** (`datei#funktion:zeile`)
 * — ein Grund, der erst zur Laufzeit entsteht (eine Abbildung aus einer
 * Tabelle). Die Prüfung nennt solche Stellen ausdrücklich und liest ihre
 * Gründe aus der Tabelle selbst; eine neue offene Stelle bricht sie.
 */
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import type * as TS from 'typescript';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;

export interface GrundFund {
  /** Jeder Grund, den ein Wurf auf diesem Weg tragen kann. */
  readonly gruende: ReadonlySet<string>;
  /** Würfe, deren Grund kein festes Wort ist — `datei#funktion:zeile`, relativ zur Wurzel. */
  readonly offen: readonly string[];
}

type Funktion = TS.FunctionDeclaration | TS.ArrowFunction | TS.FunctionExpression;
/** Die Wörter, die ein Parameter an dieser Stelle trägt; `null`: kein festes Wort. */
type Umgebung = ReadonlyMap<string, readonly string[] | null>;

interface Lauf {
  readonly lies: (datei: string) => string | null;
  readonly wurzel: string;
  readonly klassen: ReadonlySet<string>;
  readonly baeume: Map<string, TS.SourceFile | null>;
  readonly gesehen: Set<string>;
  readonly gruende: Set<string>;
  readonly offen: Set<string>;
}

function ohneHuelle(e: TS.Expression): TS.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)
      || ts.isSatisfiesExpression(x) || ts.isAwaitExpression(x)) x = x.expression;
  return x;
}

function baum(lauf: Lauf, datei: string): TS.SourceFile | null {
  if (lauf.baeume.has(datei)) return lauf.baeume.get(datei) ?? null;
  const quelle = lauf.lies(datei);
  const sf = quelle === null ? null : ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true,
    datei.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  lauf.baeume.set(datei, sf);
  return sf;
}

/** `@/…` und relative Pfade auf eine Datei — sonst `null` (ein Paket). */
function aufloesen(lauf: Lauf, von: string, spezifikator: string): string | null {
  let basis: string;
  if (spezifikator.startsWith('@/')) basis = join(lauf.wurzel, 'src', spezifikator.slice(2));
  else if (spezifikator.startsWith('.')) basis = resolve(dirname(von), spezifikator);
  else return null;
  basis = basis.replace(/\.js$/u, '');
  for (const k of [`${basis}.ts`, `${basis}.tsx`, join(basis, 'index.ts')]) {
    if (baum(lauf, k) !== null) return k;
  }
  return null;
}

/** Die Funktion `name` oben in einer Datei — Deklaration oder `const name = (…) =>`. */
function funktionIn(sf: TS.SourceFile, name: string): Funktion | null {
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === name && s.body !== undefined) return s;
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== name || d.initializer === undefined) continue;
      const i = ohneHuelle(d.initializer);
      if (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) return i;
    }
  }
  return null;
}

/** Wohin ein Name dieser Datei zeigt: auf eine Funktion hier oder, über den Import, dort. */
function ziel(lauf: Lauf, sf: TS.SourceFile, name: string): { datei: string; name: string } | null {
  if (funktionIn(sf, name) !== null) return { datei: sf.fileName, name };
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const bindungen = s.importClause?.namedBindings;
    if (s.importClause?.isTypeOnly === true || bindungen === undefined
        || !ts.isNamedImports(bindungen)) continue;
    for (const e of bindungen.elements) {
      if (e.name.text !== name || e.isTypeOnly) continue;
      const datei = aufloesen(lauf, sf.fileName, s.moduleSpecifier.text);
      if (datei === null) return null;
      /* Nur die Dienste werfen fachliche Gründe — `authorize` und `withTenant` nicht. */
      if (!relative(lauf.wurzel, datei).startsWith(join('src', 'server', 'services'))) return null;
      return { datei, name: e.propertyName?.text ?? e.name.text };
    }
  }
  return null;
}

/** Die festen Wörter eines Ausdrucks — `null`, wenn er keines ist. */
function woerter(e: TS.Expression | undefined, umgebung: Umgebung): readonly string[] | null {
  if (e === undefined) return null;
  const x = ohneHuelle(e);
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return [x.text];
  if (ts.isConditionalExpression(x)) {
    const a = woerter(x.whenTrue, umgebung);
    const b = woerter(x.whenFalse, umgebung);
    return a === null || b === null ? null : [...a, ...b];
  }
  if (ts.isIdentifier(x)) return umgebung.get(x.text) ?? null;
  return null;
}

function lies(lauf: Lauf, datei: string, name: string, umgebung: Umgebung): void {
  const schluessel = `${datei}#${name}#${JSON.stringify([...umgebung])}`;
  if (lauf.gesehen.has(schluessel)) return;
  lauf.gesehen.add(schluessel);
  const sf = baum(lauf, datei);
  const f = sf === null ? null : funktionIn(sf, name);
  if (sf === null || f === null) {
    lauf.offen.add(`${relative(lauf.wurzel, datei)}#${name} (nicht gefunden)`);
    return;
  }
  const besuche = (k: TS.Node): void => {
    if (ts.isNewExpression(k) && ts.isIdentifier(k.expression)
        && lauf.klassen.has(k.expression.text)) {
      const w = woerter(k.arguments?.[1], umgebung);
      if (w === null) {
        const zeile = sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1;
        lauf.offen.add(`${relative(lauf.wurzel, datei)}#${name}:${String(zeile)}`);
      } else {
        for (const g of w) lauf.gruende.add(g);
      }
    }
    if (ts.isCallExpression(k)) {
      const aufruf = ohneHuelle(k.expression);
      const z = ts.isIdentifier(aufruf) ? ziel(lauf, sf, aufruf.text) : null;
      const zsf = z === null ? null : baum(lauf, z.datei);
      const zf = z === null || zsf === null ? null : funktionIn(zsf, z.name);
      if (z !== null && zf !== null) {
        const neu = new Map<string, readonly string[] | null>();
        zf.parameters.forEach((p, i) => {
          if (ts.isIdentifier(p.name)) neu.set(p.name.text, woerter(k.arguments[i], umgebung));
        });
        lies(lauf, z.datei, z.name, neu);
      }
    }
    ts.forEachChild(k, besuche);
  };
  if (f.body !== undefined) besuche(f.body);
}

/**
 * Die Gründe ab `funktion` in `datei` (relativ zu `wurzel`) für die Klassen
 * `klassen`. `lies` liefert den Quelltext einer Datei (oder `null`) — die
 * Gegenprobe gibt hier erfundene Dateien hinein.
 */
export function gruendeAb(
  start: { readonly datei: string; readonly funktion: string },
  klassen: readonly string[],
  lies_: (datei: string) => string | null,
  wurzel: string,
): GrundFund {
  const lauf: Lauf = {
    lies: lies_, wurzel, klassen: new Set(klassen), baeume: new Map(), gesehen: new Set(),
    gruende: new Set(), offen: new Set(),
  };
  lies(lauf, resolve(wurzel, start.datei), start.funktion, new Map());
  return { gruende: lauf.gruende, offen: [...lauf.offen].sort() };
}
