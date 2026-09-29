/**
 * Was aus der ADRESSE roh auf dem Schirm steht — gelesen am Syntaxbaum
 * (V-250, D-741).
 *
 * **Wozu.** Eine Route meldet einen abgewiesenen Schritt mit einem Grund in
 * der Adresse (`?fehler=kein_recht`), die Seite macht daraus einen Satz.
 * Sechzehn Seiten fielen für einen Grund, den sie nicht kannten, auf den Grund
 * selbst zurück — `eigenerEintrag(T, fehler) ?? fehler`, `FEHLER[roh] ?? roh`,
 * `` `Nicht übernommen: ${fehler}` `` —, und zeigten dann, was in der Adresse
 * stand: einen Schlüssel (`erfasst`, `beginn_fehlt`, „RATE_LIMITED"), einen
 * Satz der Route, oder was immer jemand in einen Link geschrieben hat. Richtig
 * ist: ein bekannter Grund wird sein Satz, jeder andere ein allgemeiner Satz.
 *
 * **Was hier ein Adressparameter ist.** `searchParams` einer Seite und die
 * Eigenschaft `suche` eines Bausteins (so heisst sie im Baum, wo eine Seite
 * ihre Adresse weitergibt); was daraus gelesen wird (`suche.fehler`,
 * `suche['fehler']`, `const { fehler } = await searchParams`); was einen
 * solchen Wert unverändert weiterreicht — `??`, `||`, `?:`, eine Vorlage,
 * `String(…)`, `.trim()`, eine Funktion, die ihn zurückgibt (`einer(…)`,
 * `einWert('fehler')`, auch über den Import). Kein Adressparameter mehr ist,
 * was ihn NACHSCHLÄGT (`eigenerEintrag(T, f)`, `T[f]`) — das Ergebnis ist ein
 * Satz der Seite — und was eine Bedingung GEPRÜFT hat: im Ast nach
 * `/^\d{4}-\d{2}$/u.test(m)`, `REITER.includes(r)`, `istReiter(r)` oder
 * `r === 'raumbuch'` hat der Wert die Form, die die Seite erwartet.
 *
 * **Was gemeldet wird.** Jede Stelle, an der ein solcher Wert sichtbar wird
 * (die Stellen der Textwache: ein Kind in `{…}`, eine Beschriftung, eine
 * Zelle — durch `?:`, `&&`, `??`, `||`, `+`, Vorlagen, Namen und Funktionen
 * hindurch). `rueckfall` heisst: der Wert steht hinter `??` oder `||` eines
 * Satzes der Seite, oder die Datei kennt Gründe für denselben Parameter — sie
 * schlägt ihn nach oder vergleicht ihn mit einem Grund (`f === 'kein_recht'`,
 * ein `switch`) — und zeigt einen unbekannten roh. `direkt` heisst: die Seite
 * zeigt den Parameter als solchen (ein Suchwort, eine vorbelegte Eingabe, eine
 * Anzahl, eine weitergereichte Meldung der Route).
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type * as TS from 'typescript';
import { SICHTBARE_ATTRIBUTE } from './sichtbarer-text.js';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;

export interface AdressBefund {
  readonly datei: string;
  readonly zeile: number;
  readonly art: 'rueckfall' | 'direkt';
  /** Der Name in der Adresse (`fehler`, `meldung`) — `?`, wo er nicht fest steht. */
  readonly parameter: string;
  /** Der Ausdruck an der Stelle, gekürzt. */
  readonly ausdruck: string;
}

/** Eine Eigenschaft eines Bausteins, die die Adresse der Seite trägt. */
const ADRESSE_ALS_EIGENSCHAFT: ReadonlySet<string> = new Set(['searchParams', 'suche']);

/** Methoden einer Zeichenkette, die sie unverändert (oder beschnitten) weiterreichen. */
const DURCHREICHEND: ReadonlySet<string> = new Set([
  'trim', 'trimStart', 'trimEnd', 'toString', 'slice', 'substring', 'at', 'replace', 'replaceAll',
  'toLowerCase', 'toUpperCase', 'normalize', 'join', 'concat', 'padStart', 'padEnd', 'split',
]);

/** Wie `sichtbarer-text.ts`: als Objektfeld der Wert einer Auswahl, kein Text. */
const NUR_ALS_ATTRIBUT: ReadonlySet<string> = new Set(['wert', 'defaultValue']);

type Spur = ReadonlySet<string>;
const KEINE: Spur = new Set();

function vereint(...s: Spur[]): Spur {
  const alle = new Set<string>();
  for (const x of s) for (const k of x) alle.add(k);
  return alle.size === 0 ? KEINE : alle;
}

function ohneHuelle(e: TS.Expression): TS.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)
      || ts.isSatisfiesExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
}

type Funktion = TS.FunctionDeclaration | TS.ArrowFunction | TS.FunctionExpression;

interface Lauf {
  readonly lies: (datei: string) => string | null;
  readonly wurzel: string;
  readonly baeume: Map<string, TS.SourceFile | null>;
  /** Parameter einer Funktion, die gerade mit einem Adresswert aufgerufen gelesen wird. */
  readonly kontext: Map<TS.ParameterDeclaration, Spur>;
  /** Parameter derselben Funktion, deren Argument ein festes Wort ist. */
  readonly woerter: Map<TS.ParameterDeclaration, string>;
  /** Gegen Rekursion: Deklarationen und Funktionen, die gerade gelesen werden. */
  readonly offen: Set<TS.Node>;
  /** Im Ast `wahr` eines `?:`: Namen und Zugriffe, die die Bedingung geprüft hat. */
  readonly geprueft: Set<TS.Node | string>;
  readonly befunde: AdressBefund[];
}

function istText(e: TS.Expression): e is TS.StringLiteral | TS.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e);
}

/**
 * Ein festes Wort, das einen GRUND benennt (`'kein_recht'`, `'bauabzug'`) —
 * nicht das leere Wort (`hinweis !== ''` fragt, ob etwas da ist) und keine
 * Zahl (`gesetzt === '0'` fragt nach einer Anzahl).
 */
function istGrund(e: TS.Expression): boolean {
  return istText(e) && e.text !== '' && !/^\d+$/u.test(e.text);
}

/** Wie ein Zugriff wiedererkannt wird: `suche.reiter` und `suche['reiter']` gleich. */
function zugriffText(e: TS.Expression): string | null {
  const x = ohneHuelle(e);
  if (ts.isIdentifier(x)) return x.text;
  if (ts.isPropertyAccessExpression(x)) {
    const o = zugriffText(x.expression);
    return o === null ? null : `${o}.${x.name.text}`;
  }
  if (ts.isElementAccessExpression(x) && istText(ohneHuelle(x.argumentExpression))) {
    const o = zugriffText(x.expression);
    return o === null ? null : `${o}.${(ohneHuelle(x.argumentExpression) as TS.StringLiteral).text}`;
  }
  return null;
}

/**
 * Was eine Bedingung geprüft hat: ein Muster (`/^\d{4}-\d{2}$/u.test(m)`),
 * eine Liste (`REITER.includes(r)`), eine Typprüfung (`istReiter(r)`), ein
 * festes Wort (`r === 'raumbuch'`). Im Ast `wahr` hat der Wert dann die Form,
 * die die Seite erwartet — er ist kein roher Text mehr.
 */
function gepruefteWerte(lauf: Lauf, sf: TS.SourceFile, bedingung: TS.Expression): (TS.Node | string)[] {
  const x = ohneHuelle(bedingung);
  const wert = (e: TS.Expression): (TS.Node | string)[] => {
    const i = ohneHuelle(e);
    const aus: (TS.Node | string)[] = [];
    if (ts.isIdentifier(i)) {
      const d = deklaration(i);
      if (d !== null) aus.push(d);
    }
    const t = zugriffText(i);
    if (t !== null && !ts.isIdentifier(i)) aus.push(t);
    return aus;
  };
  if (ts.isBinaryExpression(x)) {
    const op = x.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      return [...gepruefteWerte(lauf, sf, x.left), ...gepruefteWerte(lauf, sf, x.right)];
    }
    if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) {
      const l = ohneHuelle(x.left);
      const r = ohneHuelle(x.right);
      if (istText(r) && r.text !== '') return wert(l);
      if (istText(l) && l.text !== '') return wert(r);
    }
    return [];
  }
  if (ts.isCallExpression(x)) {
    const c = ohneHuelle(x.expression);
    const a = x.arguments[0];
    if (a !== undefined && ts.isPropertyAccessExpression(c) && ['test', 'includes', 'has'].includes(c.name.text)
        && spur(lauf, sf, c.expression).size === 0) return wert(a);
    const f = funktionHinter(lauf, sf, c);
    if (f?.type !== undefined && ts.isTypePredicateNode(f.type)) return x.arguments.flatMap(wert);
  }
  return [];
}

/** Liest `lesen` mit den geprüften Werten der Bedingung. */
function imGeprueftenAst<T>(lauf: Lauf, sf: TS.SourceFile, bedingung: TS.Expression, lesen: () => T): T {
  const neu = gepruefteWerte(lauf, sf, bedingung).filter((g) => !lauf.geprueft.has(g));
  for (const g of neu) lauf.geprueft.add(g);
  try {
    return lesen();
  } finally {
    for (const g of neu) lauf.geprueft.delete(g);
  }
}

function holeBaum(lauf: Lauf, datei: string): TS.SourceFile | null {
  if (lauf.baeume.has(datei)) return lauf.baeume.get(datei) ?? null;
  const quelle = lauf.lies(datei);
  const sf = quelle === null ? null : ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true,
    datei.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  lauf.baeume.set(datei, sf);
  return sf;
}

function aufloesen(lauf: Lauf, von: string, spezifikator: string): string | null {
  let basis: string;
  if (spezifikator.startsWith('@/')) basis = join(lauf.wurzel, 'src', spezifikator.slice(2));
  else if (spezifikator.startsWith('.')) basis = resolve(dirname(von), spezifikator);
  else return null;
  basis = basis.replace(/\.js$/u, '');
  for (const k of [`${basis}.ts`, `${basis}.tsx`, join(basis, 'index.ts'), join(basis, 'index.tsx')]) {
    if (holeBaum(lauf, k) !== null) return k;
  }
  return null;
}

/** Der Knoten, der `gesucht` in einem Bindungsmuster bindet — Deklaration, Parameter oder Element. */
function bindung(n: TS.BindingName, gesucht: string): TS.Node | null {
  if (ts.isIdentifier(n)) return n.text === gesucht ? n.parent : null;
  for (const el of n.elements) {
    if (ts.isOmittedExpression(el)) continue;
    const b = bindung(el.name, gesucht);
    if (b !== null) return b;
  }
  return null;
}

/** Die Deklaration eines Namens im Gültigkeitsbereich — Parameter, Variable, Funktion, Import. */
function deklaration(name: TS.Identifier): TS.Node | null {
  const gesucht = name.text;
  for (let k: TS.Node | undefined = name.parent; k !== undefined; k = k.parent) {
    if (ts.isFunctionLike(k)) {
      for (const p of k.parameters) {
        const b = bindung(p.name, gesucht);
        if (b !== null) return b;
      }
    }
    if ((ts.isForOfStatement(k) || ts.isForInStatement(k)) && ts.isVariableDeclarationList(k.initializer)) {
      for (const d of k.initializer.declarations) {
        const b = bindung(d.name, gesucht);
        if (b !== null) return b;
      }
    }
    const anweisungen = ts.isSourceFile(k) || ts.isBlock(k) || ts.isModuleBlock(k)
      ? k.statements : ts.isCaseClause(k) || ts.isDefaultClause(k) ? k.statements : null;
    if (anweisungen === null) continue;
    for (const a of anweisungen) {
      if (ts.isVariableStatement(a)) {
        for (const d of a.declarationList.declarations) {
          const b = bindung(d.name, gesucht);
          if (b !== null) return b;
        }
      }
      if (ts.isFunctionDeclaration(a) && a.name?.text === gesucht) return a;
      if (ts.isImportDeclaration(a) && a.importClause !== undefined) {
        const nb = a.importClause.namedBindings;
        if (nb !== undefined && ts.isNamedImports(nb)) {
          for (const e of nb.elements) if (e.name.text === gesucht) return e;
        }
      }
    }
  }
  return null;
}

/** Die Funktion hinter einem Aufruf — in derselben Datei oder über den Import. */
function funktionHinter(lauf: Lauf, sf: TS.SourceFile, c: TS.Expression): Funktion | null {
  if (!ts.isIdentifier(c)) return null;
  const d = deklaration(c);
  if (d === null) return null;
  if (ts.isFunctionDeclaration(d)) return d;
  if (ts.isVariableDeclaration(d) && d.initializer !== undefined) {
    const i = ohneHuelle(d.initializer);
    return ts.isArrowFunction(i) || ts.isFunctionExpression(i) ? i : null;
  }
  if (!ts.isImportSpecifier(d)) return null;
  const decl = d.parent.parent.parent;
  if (!ts.isStringLiteral(decl.moduleSpecifier)) return null;
  const ziel = aufloesen(lauf, sf.fileName, decl.moduleSpecifier.text);
  const zsf = ziel === null ? null : holeBaum(lauf, ziel);
  if (zsf === null) return null;
  const exportiert = (d.propertyName ?? d.name).text;
  for (const a of zsf.statements) {
    if (ts.isFunctionDeclaration(a) && a.name?.text === exportiert) return a;
    if (ts.isVariableStatement(a)) {
      for (const v of a.declarationList.declarations) {
        if (!ts.isIdentifier(v.name) || v.name.text !== exportiert || v.initializer === undefined) continue;
        const i = ohneHuelle(v.initializer);
        return ts.isArrowFunction(i) || ts.isFunctionExpression(i) ? i : null;
      }
    }
  }
  return null;
}

/** Die Ausdrücke, die eine Funktion zurückgibt. */
function rueckgabeAusdruecke(f: Funktion): readonly TS.Expression[] {
  const k = f.body;
  if (k === undefined) return [];
  if (!ts.isBlock(k)) return [k];
  const aus: TS.Expression[] = [];
  const gehe = (n: TS.Node): void => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression !== undefined) aus.push(n.expression);
    ts.forEachChild(n, gehe);
  };
  ts.forEachChild(k, gehe);
  return aus;
}

/**
 * Liest `f` mit seinen Argumenten: jeder Parameter trägt die Spur seines
 * Arguments, und ein festes Wort als Argument (`einWert('fehler')`) bleibt
 * lesbar, damit `suche[name]` den Namen in der Adresse kennt.
 */
function mitArgumenten<T>(
  lauf: Lauf, sf: TS.SourceFile, f: Funktion, argumente: readonly TS.Expression[], lesen: () => T, sonst: T,
): T {
  if (lauf.offen.has(f)) return sonst;
  const spuren = argumente.map((a) => spur(lauf, sf, a));
  const woerter = argumente.map((a) => {
    const w = ohneHuelle(a);
    return istText(w) ? w.text : undefined;
  });
  lauf.offen.add(f);
  const vorher = new Map<TS.ParameterDeclaration, readonly [Spur | undefined, string | undefined]>();
  f.parameters.forEach((p, i) => {
    vorher.set(p, [lauf.kontext.get(p), lauf.woerter.get(p)]);
    lauf.kontext.set(p, spuren[i] ?? KEINE);
    const w = woerter[i];
    if (w === undefined) lauf.woerter.delete(p);
    else lauf.woerter.set(p, w);
  });
  try {
    return lesen();
  } finally {
    for (const [p, [s, w]] of vorher) {
      if (s === undefined) lauf.kontext.delete(p);
      else lauf.kontext.set(p, s);
      if (w === undefined) lauf.woerter.delete(p);
      else lauf.woerter.set(p, w);
    }
    lauf.offen.delete(f);
  }
}

/** Der Name in der Adresse bei `suche[k]`: ein festes Wort, oder ein Parameter, der eines trägt. */
function schluesselName(lauf: Lauf, k: TS.Expression): string {
  const a = ohneHuelle(k);
  if (istText(a)) return a.text;
  if (ts.isIdentifier(a)) {
    const d = deklaration(a);
    if (d !== null && ts.isParameter(d)) return lauf.woerter.get(d) ?? '?';
  }
  return '?';
}

/** Die Spur einer Bindung: welche Adressparameter sie trägt. */
function spurDerDeklaration(lauf: Lauf, sf: TS.SourceFile, d: TS.Node): Spur {
  if (lauf.offen.has(d) || lauf.geprueft.has(d)) return KEINE;
  lauf.offen.add(d);
  try {
    if (ts.isParameter(d)) {
      if (ts.isIdentifier(d.name) && d.name.text === 'searchParams') return new Set(['*']);
      return lauf.kontext.get(d) ?? KEINE;
    }
    if (ts.isVariableDeclaration(d)) {
      return d.initializer === undefined ? KEINE : spur(lauf, sf, d.initializer);
    }
    if (ts.isBindingElement(d)) {
      // Das Muster hinauf bis zur Deklaration oder zum Parameter, der es bindet.
      let wurzel: TS.Node = d;
      while (ts.isBindingElement(wurzel) || ts.isObjectBindingPattern(wurzel) || ts.isArrayBindingPattern(wurzel)) {
        wurzel = wurzel.parent;
      }
      const name = d.propertyName !== undefined && (ts.isIdentifier(d.propertyName) || ts.isStringLiteral(d.propertyName))
        ? d.propertyName.text : ts.isIdentifier(d.name) ? d.name.text : '?';
      const oben = ts.isObjectBindingPattern(d.parent) && d.parent.parent === wurzel;
      let quelle: Spur = KEINE;
      if (ts.isParameter(wurzel)) {
        // `function Seite({ searchParams })`, `function Baustein({ suche })`
        if (oben && ADRESSE_ALS_EIGENSCHAFT.has(name)) return new Set(['*']);
        quelle = lauf.kontext.get(wurzel) ?? KEINE;
      } else if (ts.isVariableDeclaration(wurzel) && wurzel.initializer !== undefined) {
        quelle = spur(lauf, sf, wurzel.initializer);
      }
      if (quelle.has('*')) return new Set([ts.isArrayBindingPattern(d.parent) ? '?' : name]);
      return quelle;
    }
    return KEINE;
  } finally {
    lauf.offen.delete(d);
  }
}

/** Welche Adressparameter trägt dieser Wert unverändert? */
function spur(lauf: Lauf, sf: TS.SourceFile, e: TS.Expression): Spur {
  const x = ohneHuelle(e);
  if (ts.isAwaitExpression(x)) return spur(lauf, sf, x.expression);
  if (ts.isIdentifier(x)) {
    const d = deklaration(x);
    return d === null ? KEINE : spurDerDeklaration(lauf, sf, d);
  }
  if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) {
    const t = zugriffText(x);
    if (t !== null && lauf.geprueft.has(t)) return KEINE;
  }
  if (ts.isPropertyAccessExpression(x)) {
    if (ADRESSE_ALS_EIGENSCHAFT.has(x.name.text) && ts.isIdentifier(x.expression)) {
      // `props.searchParams`, `props.suche` — die Adresse selbst.
      const d = deklaration(x.expression);
      if (d !== null && ts.isParameter(d)) return new Set(['*']);
    }
    const s = spur(lauf, sf, x.expression);
    if (s.has('*')) return new Set([x.name.text]);
    return x.name.text === 'length' ? KEINE : s;
  }
  if (ts.isElementAccessExpression(x)) {
    const s = spur(lauf, sf, x.expression);
    if (s.has('*')) return new Set([schluesselName(lauf, x.argumentExpression)]);
    return s;
  }
  if (ts.isBinaryExpression(x)) {
    const op = x.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken
        || op === ts.SyntaxKind.PlusToken) {
      return vereint(spur(lauf, sf, x.left), spur(lauf, sf, x.right));
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return spur(lauf, sf, x.right);
    return KEINE;
  }
  if (ts.isConditionalExpression(x)) {
    return vereint(imGeprueftenAst(lauf, sf, x.condition, () => spur(lauf, sf, x.whenTrue)),
      spur(lauf, sf, x.whenFalse));
  }
  if (ts.isTemplateExpression(x)) return vereint(...x.templateSpans.map((s) => spur(lauf, sf, s.expression)));
  if (ts.isArrayLiteralExpression(x)) {
    return vereint(...x.elements.filter((el): el is TS.Expression => !ts.isOmittedExpression(el))
      .map((el) => spur(lauf, sf, ts.isSpreadElement(el) ? el.expression : el)));
  }
  if (ts.isCallExpression(x)) {
    const c = ohneHuelle(x.expression);
    if (ts.isPropertyAccessExpression(c) && DURCHREICHEND.has(c.name.text)) return spur(lauf, sf, c.expression);
    if (ts.isIdentifier(c) && (c.text === 'String' || c.text === 'decodeURIComponent' || c.text === 'decodeURI')) {
      const a = x.arguments[0];
      return a === undefined ? KEINE : spur(lauf, sf, a);
    }
    const f = funktionHinter(lauf, sf, c);
    if (f === null) return KEINE;
    const fsf = f.getSourceFile();
    // Eine Funktion einer anderen Datei sieht die Adresse nur über ihre Argumente;
    // eine derselben Datei kann sie auch aus ihrer Umgebung lesen (`einWert('fehler')`).
    if (fsf !== sf && x.arguments.every((a) => spur(lauf, sf, a).size === 0)) return KEINE;
    return mitArgumenten(lauf, sf, f, x.arguments,
      () => vereint(...rueckgabeAusdruecke(f).map((r) => spur(lauf, fsf, r))), KEINE);
  }
  return KEINE;
}

/**
 * Die Parameter, deren Gründe die Datei kennt: sie schlägt sie in einer
 * Tabelle nach (`eigenerEintrag(T, f)`, `T[f]`, `Object.hasOwn(T, f)`,
 * `f in T`), vergleicht sie mit einem festen Wort (`f === 'kein_recht'`)
 * oder unterscheidet sie in einem `switch`. Der Vergleich mit dem leeren
 * Wort zählt nicht — `hinweis !== ''` prüft, ob etwas da ist, nicht, was
 * es heisst.
 */
function nachgeschlagen(lauf: Lauf, sf: TS.SourceFile): Spur {
  const bekannt = new Set<string>();
  const merke = (e: TS.Expression): void => { for (const k of spur(lauf, sf, e)) bekannt.add(k); };
  const gehe = (k: TS.Node): void => {
    if (ts.isCallExpression(k)) {
      const c = ohneHuelle(k.expression);
      const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : '';
      if ((name === 'eigenerEintrag' || name === 'hasOwn') && k.arguments[1] !== undefined) merke(k.arguments[1]);
    } else if (ts.isElementAccessExpression(k) && spur(lauf, sf, k.expression).size === 0) {
      merke(k.argumentExpression);
    } else if (ts.isBinaryExpression(k)) {
      const op = k.operatorToken.kind;
      if (op === ts.SyntaxKind.InKeyword) merke(k.left);
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken
          || op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
        const l = ohneHuelle(k.left);
        const r = ohneHuelle(k.right);
        if (istGrund(r)) merke(l);
        if (istGrund(l)) merke(r);
      }
    } else if (ts.isSwitchStatement(k)
        && k.caseBlock.clauses.some((c) => ts.isCaseClause(c) && istGrund(ohneHuelle(c.expression)))) {
      merke(k.expression);
    }
    ts.forEachChild(k, gehe);
  };
  gehe(sf);
  // Ein Name, der erst zur Laufzeit feststeht, ist keiner, dessen Gründe man kennt.
  bekannt.delete('*');
  bekannt.delete('?');
  return bekannt;
}

/**
 * Ein Wert an einer sichtbaren Stelle: jeder Adressparameter darin, der roh
 * auf dem Schirm landet. `hinter` — der Wert steht hinter `??` oder `||`.
 */
function zeige(
  lauf: Lauf, sf: TS.SourceFile, bekannt: Spur, e: TS.Expression, hinter: boolean, ort?: TS.Node,
): void {
  const x = ohneHuelle(e);
  const hier = ort ?? x;
  if (ts.isCallExpression(x)) {
    const c = ohneHuelle(x.expression);
    // `liste.map((z) => …)` — die Rückgabe des Rückrufs steht an dieser Stelle.
    if (ts.isPropertyAccessExpression(c) && (c.name.text === 'map' || c.name.text === 'flatMap')) {
      const f = x.arguments[0];
      if (f !== undefined && (ts.isArrowFunction(f) || ts.isFunctionExpression(f))) {
        for (const r of rueckgabeAusdruecke(f)) zeige(lauf, sf, bekannt, r, hinter, ort);
      }
      return;
    }
  }
  // Was keinen Adressparameter trägt — ein Satz, ein nachgeschlagener, ein geprüfter Wert —, ist fertig.
  if (spur(lauf, sf, x).size === 0) return;
  if (ts.isTemplateExpression(x)) {
    for (const s of x.templateSpans) zeige(lauf, sf, bekannt, s.expression, hinter, ort);
    return;
  }
  if (ts.isConditionalExpression(x)) {
    imGeprueftenAst(lauf, sf, x.condition, () => zeige(lauf, sf, bekannt, x.whenTrue, hinter, ort));
    zeige(lauf, sf, bekannt, x.whenFalse, hinter, ort);
    return;
  }
  if (ts.isBinaryExpression(x)) {
    const op = x.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.CommaToken) {
      zeige(lauf, sf, bekannt, x.right, hinter, ort);
    } else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      // `satz(f) ?? f`: links ein Satz der Seite, rechts der Rückfall auf die Adresse.
      // Steht links selbst die Adresse (`suche.meldung ?? suche.erfolg`), ist rechts keiner.
      zeige(lauf, sf, bekannt, x.left, hinter, ort);
      zeige(lauf, sf, bekannt, x.right, hinter || spur(lauf, sf, x.left).size === 0, ort);
    } else if (op === ts.SyntaxKind.PlusToken) {
      zeige(lauf, sf, bekannt, x.left, hinter, ort);
      zeige(lauf, sf, bekannt, x.right, hinter, ort);
    }
    return;
  }
  if (ts.isArrayLiteralExpression(x)) {
    for (const el of x.elements) {
      if (!ts.isSpreadElement(el) && !ts.isOmittedExpression(el)) zeige(lauf, sf, bekannt, el, hinter, ort);
    }
    return;
  }
  if (ts.isCallExpression(x)) {
    const c = ohneHuelle(x.expression);
    // Eine Funktion, die mit einem Adresswert aufgerufen wird: was sie davon zurückgibt.
    const f = funktionHinter(lauf, sf, c);
    if (f !== null) {
      const fsf = f.getSourceFile();
      mitArgumenten(lauf, sf, f, x.arguments, () => {
        // Was die Funktion selbst nachschlägt, gilt in ihr — gelesen mit ihren Argumenten.
        const fBekannt = fsf === sf ? bekannt : vereint(bekannt, nachgeschlagen(lauf, fsf));
        for (const r of rueckgabeAusdruecke(f)) zeige(lauf, fsf, fBekannt, r, hinter, hier);
      }, undefined);
      return;
    }
  }
  if (ts.isIdentifier(x)) {
    const d = deklaration(x);
    // Ein Name für einen zusammengesetzten Wert: an der Stelle des Namens gelesen.
    if (d !== null && ts.isVariableDeclaration(d) && d.initializer !== undefined && !lauf.offen.has(d)) {
      const i = ohneHuelle(d.initializer);
      if (ts.isBinaryExpression(i) || ts.isConditionalExpression(i) || ts.isTemplateExpression(i)
          || ts.isCallExpression(i)) {
        lauf.offen.add(d);
        try {
          zeige(lauf, sf, bekannt, i, hinter, hier);
        } finally {
          lauf.offen.delete(d);
        }
        return;
      }
    }
  }
  const s = spur(lauf, sf, x);
  if (s.size === 0 || s.has('*')) return;
  const hs = hier.getSourceFile();
  const zeile = hs.getLineAndCharacterOfPosition(hier.getStart(hs)).line + 1;
  const ausdruck = x.getText(x.getSourceFile()).replace(/\s+/gu, ' ').slice(0, 100);
  for (const p of s) {
    lauf.befunde.push({
      datei: hs.fileName, zeile, art: hinter || bekannt.has(p) ? 'rueckfall' : 'direkt', parameter: p, ausdruck,
    });
  }
}

function eigenschaftsName(p: TS.PropertyAssignment): string {
  const n = p.name;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return '';
}

/**
 * Prüft jede `.tsx`: jede sichtbare Stelle, an der ein Adressparameter roh
 * steht. `lies` liefert weitere Dateien für aufgelöste Importe.
 */
export function rohAusDerAdresse(
  dateien: readonly (readonly [string, string])[],
  lies: (datei: string) => string | null,
  wurzel: string,
): readonly AdressBefund[] {
  const quellen = new Map(dateien);
  const lauf: Lauf = {
    lies: (d) => quellen.get(d) ?? lies(d), wurzel, baeume: new Map(), kontext: new Map(), woerter: new Map(),
    offen: new Set(), geprueft: new Set(), befunde: [],
  };
  for (const [datei] of dateien) {
    if (!datei.endsWith('.tsx')) continue;
    const sf = holeBaum(lauf, datei);
    if (sf === null) continue;
    const bekannt = nachgeschlagen(lauf, sf);
    const gehe = (k: TS.Node): void => {
      if (ts.isJsxExpression(k) && k.expression !== undefined
          && (ts.isJsxElement(k.parent) || ts.isJsxFragment(k.parent))) {
        zeige(lauf, sf, bekannt, k.expression, false);
      } else if (ts.isJsxAttribute(k) && SICHTBARE_ATTRIBUTE.has(k.name.getText(sf))
          && k.initializer !== undefined && ts.isJsxExpression(k.initializer)
          && k.initializer.expression !== undefined) {
        zeige(lauf, sf, bekannt, k.initializer.expression, false);
      } else if (ts.isPropertyAssignment(k) && SICHTBARE_ATTRIBUTE.has(eigenschaftsName(k))
          && !NUR_ALS_ATTRIBUT.has(eigenschaftsName(k))) {
        zeige(lauf, sf, bekannt, k.initializer, false);
      } else if (ts.isPropertyAssignment(k) && eigenschaftsName(k) === 'zelle'
          && (ts.isArrowFunction(k.initializer) || ts.isFunctionExpression(k.initializer))) {
        for (const r of rueckgabeAusdruecke(k.initializer)) zeige(lauf, sf, bekannt, r, false);
      }
      ts.forEachChild(k, gehe);
    };
    gehe(sf);
  }
  const eindeutig = new Map<string, AdressBefund>();
  for (const b of lauf.befunde) eindeutig.set(`${b.datei}:${String(b.zeile)}:${b.parameter}:${b.art}`, b);
  return [...eindeutig.values()];
}
