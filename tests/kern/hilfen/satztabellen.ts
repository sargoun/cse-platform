/**
 * Welches Feld einer Satztabelle liest überhaupt jemand? — gelesen am
 * Syntaxbaum (V-249, D-744).
 *
 * **Der Befund, aus dem das kommt.** `ANTRAG_FORM_TEXTE.pflichtBei` trug in
 * vier Sprachen einen „Pflicht bei: …"-Satz, den keine Seite zeigte — das
 * Formular nahm den gleichnamigen Satz aus `MEIN_FORMULAR_TEXTE`. Der einzige
 * Leser war eine Prüfung, die ihn aufrief und damit bestätigte. Ein Satz, den
 * niemand sieht, veraltet, ohne dass es jemand merkt, und eine Prüfung daran
 * prüft nichts, was ein Mensch liest.
 *
 * **Was eine Satztabelle ist.** Eine Konstante oben in einer Datei unter
 * `src/lib/i18n`, deren Wert ein Objekt mit Sprachen als Schlüsseln ist
 * (`{ de: {…}, en: {…} }`, auch `{ de: DE, en: EN }` mit Konstanten derselben
 * Datei). Ihre Felder sind die des ersten Spracheintrags. Verschachtelte
 * Felder (`gruende.fehlt_einsatz`) zählen mit ihrem obersten Namen.
 *
 * **Wie ein Eintrag gefunden wird.** `T[sprache]`, `T.de`, und ein Aufruf
 * einer Wahlfunktion, die `tabelle[…]` ihres ersten Parameters zurückgibt
 * (`nachSprache(T, …)`) — auch über einen zweiten Namen der Tabelle
 * (`const T = RECRUITING_KANDIDAT_TEXTE`). Von dort wird der Wert verfolgt:
 *   - `e.feld`, `e['feld']`, `const { feld } = e` lesen ein Feld;
 *   - `const t = e`, `t = e`, ein Vorgabewert `{ t = e }` — jede Verwendung
 *     von `t` in ihrem Gültigkeitsbereich;
 *   - `f(e)` — in die Funktion `f` (in der Datei oder über den Import), an
 *     ihrem Parameter weiter; wird `f` erst zur Laufzeit aus einer Tabelle
 *     von Funktionen gewählt (`eigenerEintrag(ANTWORT_TEXT, a)(t)`), in jede
 *     Funktion dieser Tabelle;
 *   - `<Baustein t={e} />` — in den Baustein, an der Eigenschaft `t` weiter
 *     (`{ t }`, `{ t: texte }` oder `props.t`);
 *   - `return e` — an jeden Aufruf der Funktion, auch über den Import
 *     (`meinTexte(sprache)`);
 *   - `{ texte: e }` — in ein Objekt unter dem Namen `texte`: dann gilt jedes
 *     `x.texte` und jedes `{ texte }` im Baum als dieser Eintrag
 *     (`basis.texte` im Arbeiterportal). Das zählt eher zu viel als Leser als
 *     zu wenig.
 * Durch `?:`, `??`, `||`, rechts von `&&`, Klammern und `as` geht der Wert
 * unverändert; ein Vergleich, `!`, `typeof` und eine Bedingung lesen nichts.
 *
 * **Wo die Verfolgung aufhört, gilt die Tabelle als ganz gelesen**
 * (`alle`): ein Schlüssel, der erst zur Laufzeit feststeht (`t[art]`), ein
 * Aufruf, der sich nicht auflösen lässt (`Object.entries(t)`), ein Wert, der
 * in eine Liste oder hinter `...` wandert. Lieber ein totes Feld übersehen
 * als ein gelesenes für tot erklären — die Gründe stehen im Ergebnis.
 *
 * **Eine Beschriftungskarte ist kein Satz** (`Karte<K>` aus
 * `beschriftung/basis.ts`, D-725, D-726): sie hält das Wort zu einem Wert der
 * Datenbank (`beschriftung(ZUORDNUNG_STATUS_TEXT, b.status)`), und welcher
 * Eintrag erscheint, entscheidet der Wert. Ihr Schlüssel ist ein geschlossener
 * Typ, jedes Feld steht für genau einen Wert. Sie gilt als ganz gelesen,
 * sobald eine Stelle sie liest — und als ganz ungelesen, wenn keine es tut.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type * as TS from 'typescript';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;

export interface Satztabelle {
  readonly datei: string;
  readonly name: string;
  readonly felder: readonly string[];
  /**
   * Eine Beschriftungskarte (`Karte<K>`, D-725, D-726): das Wort zu einem Wert der
   * Datenbank, kein Satz. Welcher Eintrag gezeigt wird, entscheidet der Wert
   * (`beschriftung(K, zeile.status)`) — sie gilt deshalb als ganz gelesen,
   * sobald eine Stelle sie liest, und als ganz ungelesen, wenn keine es tut.
   */
  readonly karte: boolean;
}

export interface Lesestand {
  /** Die Felder, die ein Leser liest. */
  readonly felder: ReadonlySet<string>;
  /** Ein Weg liess sich nicht verfolgen: die Tabelle gilt als ganz gelesen. */
  readonly alle: boolean;
  /** Wo die Verfolgung aufhörte — `datei:zeile was`. */
  readonly gruende: readonly string[];
  /** Wie viele Einträge (`T[sprache]` und ihre Weitergaben) gefunden wurden. */
  readonly orte: number;
}

const SPRACHEN = new Set(['de', 'en', 'ar', 'tr']);

function baum(datei: string, quelle: string): TS.SourceFile {
  return ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true,
    datei.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function ohneHuelle(e: TS.Expression): TS.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x)
      || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
}

function name(n: TS.PropertyName | TS.BindingName, sf: TS.SourceFile): string {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)
      || ts.isNoSubstitutionTemplateLiteral(n) || ts.isPrivateIdentifier(n)) return n.text;
  return n.getText(sf);
}

/** Die Satztabellen einer Datei. */
export function satztabellenIn(datei: string, quelle: string): readonly Satztabelle[] {
  const sf = baum(datei, quelle);
  const konstanten = new Map<string, TS.Expression>();
  const karten = new Set<string>();
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer !== undefined) konstanten.set(d.name.text, d.initializer);
      if (ts.isIdentifier(d.name) && d.type !== undefined && ts.isTypeReferenceNode(d.type)
          && ts.isIdentifier(d.type.typeName) && d.type.typeName.text === 'Karte') karten.add(d.name.text);
    }
  }
  const objekt = (e: TS.Expression): TS.ObjectLiteralExpression | null => {
    let x = ohneHuelle(e);
    if (ts.isIdentifier(x)) {
      const i = konstanten.get(x.text);
      if (i === undefined) return null;
      x = ohneHuelle(i);
    }
    return ts.isObjectLiteralExpression(x) ? x : null;
  };
  const aus: Satztabelle[] = [];
  for (const [n, init] of konstanten) {
    const o = objekt(init);
    if (o === null || o.properties.length < 2) continue;
    const sprachen = o.properties.filter((p): p is TS.PropertyAssignment =>
      ts.isPropertyAssignment(p) && SPRACHEN.has(name(p.name, sf)));
    if (sprachen.length < 2 || sprachen.length !== o.properties.length) continue;
    const erste = objekt(sprachen[0]!.initializer);
    if (erste === null) continue;
    const felder = erste.properties.flatMap((p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p)
        || ts.isGetAccessorDeclaration(p)) ? [name(p.name, sf)] : []);
    aus.push({ datei, name: n, felder, karte: karten.has(n) });
  }
  return aus;
}

interface Stand {
  felder: Set<string>;
  alle: boolean;
  gruende: string[];
  orte: number;
}

/** Ein Import einer Datei: der lokale Name und woher er kommt (oder der ganze Namensraum). */
interface Import {
  readonly sf: TS.SourceFile;
  readonly lokal: TS.Identifier;
  readonly herkunft: { readonly datei: string; readonly name: string } | null;
  readonly namensraum: string | null;
}

type Funktion = TS.FunctionDeclaration | TS.ArrowFunction | TS.FunctionExpression | TS.MethodDeclaration;

function istFunktion(k: TS.Node): k is Funktion {
  return ts.isFunctionDeclaration(k) || ts.isArrowFunction(k) || ts.isFunctionExpression(k)
    || ts.isMethodDeclaration(k);
}

/** Steht der Bezeichner dort, wo ein Wert gelesen wird? */
function istWert(k: TS.Identifier): boolean {
  const p = k.parent;
  if (p === undefined) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === k) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)
      || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p)) && p.name === k) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)
      || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p)
      || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) && p.name === k) return false;
  if (ts.isBindingElement(p) && p.propertyName === k) return false;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p)
      || ts.isNamespaceImport(p)) return false;
  if (ts.isJsxAttribute(p) && p.name === k) return false;
  if (ts.isQualifiedName(p) || ts.isTypeQueryNode(p) || ts.isTypeReferenceNode(p)) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  // In einer Typangabe (`typeof t['x']`) wird nichts gelesen.
  for (let a: TS.Node | undefined = p; a !== undefined; a = a.parent) {
    if (ts.isTypeNode(a) && !ts.isExpressionWithTypeArguments(a)) return false;
    if (ts.isStatement(a) || ts.isSourceFile(a)) break;
  }
  return true;
}

/** Deklariert dieser Knoten den Namen neu (Parameter, Variable) und verdeckt damit den äusseren? */
function verdeckt(k: TS.Node, n: string): boolean {
  const bindet = (b: TS.BindingName): boolean => {
    if (ts.isIdentifier(b)) return b.text === n;
    return b.elements.some((e) => !ts.isOmittedExpression(e) && bindet(e.name));
  };
  if (istFunktion(k)) return k.parameters.some((p) => bindet(p.name));
  if (ts.isBlock(k) || ts.isSourceFile(k) || ts.isModuleBlock(k)) {
    return k.statements.some((s) => ts.isVariableStatement(s)
      && s.declarationList.declarations.some((d) => bindet(d.name)));
  }
  if (ts.isForOfStatement(k) || ts.isForInStatement(k) || ts.isForStatement(k)) {
    const i = k.initializer;
    return i !== undefined && ts.isVariableDeclarationList(i) && i.declarations.some((d) => bindet(d.name));
  }
  if (ts.isCatchClause(k)) return k.variableDeclaration !== undefined && bindet(k.variableDeclaration.name);
  return false;
}

/** Der Bereich, in dem eine Deklaration gilt. */
function bereich(deklaration: TS.Node): TS.Node {
  if (ts.isParameter(deklaration)) return deklaration.parent;
  for (let a: TS.Node | undefined = deklaration.parent; a !== undefined; a = a.parent) {
    if (ts.isBlock(a) || ts.isSourceFile(a) || ts.isModuleBlock(a) || istFunktion(a)
        || ts.isForOfStatement(a) || ts.isForInStatement(a) || ts.isForStatement(a) || ts.isCatchClause(a)) return a;
  }
  return deklaration.getSourceFile();
}

/** Jede Verwendung des Namens `n`, der in `bereich` deklariert ist, als Wert. */
function verwendungen(raum: TS.Node, n: string, ohne: TS.Node): TS.Identifier[] {
  const aus: TS.Identifier[] = [];
  const gehe = (k: TS.Node): void => {
    if (k !== raum && verdeckt(k, n)) return;
    // Auch `{ t }` in einem Objekt: dort wandert der Wert ins Objekt.
    if (ts.isIdentifier(k) && k.text === n && k !== ohne && istWert(k)) aus.push(k);
    ts.forEachChild(k, gehe);
  };
  ts.forEachChild(raum, gehe);
  return aus;
}

/**
 * Die gelesenen Felder jeder Tabelle über alle Dateien. `lies` liefert
 * Dateien ausserhalb von `dateien` (Bausteine, Hilfsfunktionen).
 */
export function leserDerSatztabellen(
  tabellen: readonly Satztabelle[],
  dateien: readonly (readonly [string, string])[],
  lies: (datei: string) => string | null,
  wurzel: string,
): ReadonlyMap<string, Lesestand> {
  return new Leser(tabellen, dateien, lies, wurzel).lauf();
}

class Leser {
  private readonly baeume = new Map<string, TS.SourceFile | null>();
  private readonly quellen: readonly string[];
  private readonly spur = new Set<string>();
  private readonly ergebnis = new Map<string, Stand>();

  constructor(
    private readonly tabellen: readonly Satztabelle[],
    dateien: readonly (readonly [string, string])[],
    private readonly lies: (datei: string) => string | null,
    private readonly wurzel: string,
  ) {
    for (const [d, q] of dateien) this.baeume.set(d, baum(d, q));
    this.quellen = dateien.map(([d]) => d);
  }

  lauf(): ReadonlyMap<string, Lesestand> {
    for (const t of this.tabellen) {
      const stand: Stand = { felder: new Set(), alle: false, gruende: [], orte: 0 };
      this.ergebnis.set(`${t.datei}#${t.name}`, stand);
      // Dieselbe Stelle (`maske` in `FormularFehler`) kann Einträge mehrerer Tabellen sehen.
      this.spur.clear();
      const verweise = this.verweiseAufExport(t.datei, t.name);
      if (t.karte) {
        // Eine Beschriftungskarte liest der Wert, nicht der Code: gelesen ist sie ganz — oder gar nicht.
        stand.orte = verweise.length;
        if (verweise.length > 0) for (const f of t.felder) stand.felder.add(f);
        continue;
      }
      for (const { sf, knoten } of verweise) this.tabelle(knoten, sf, stand);
    }
    return this.ergebnis;
  }

  private baum(datei: string): TS.SourceFile | null {
    if (this.baeume.has(datei)) return this.baeume.get(datei) ?? null;
    const q = this.lies(datei);
    const sf = q === null ? null : baum(datei, q);
    this.baeume.set(datei, sf);
    return sf;
  }

  private aufloesen(von: string, spez: string): string | null {
    let basis: string;
    if (spez.startsWith('@/')) basis = join(this.wurzel, 'src', spez.slice(2));
    else if (spez.startsWith('.')) basis = resolve(dirname(von), spez);
    else return null;
    basis = basis.replace(/\.js$/u, '');
    for (const k of [`${basis}.ts`, `${basis}.tsx`, join(basis, 'index.ts'), join(basis, 'index.tsx')]) {
      if (this.baum(k) !== null) return k;
    }
    return null;
  }

  /** Wo steht die Deklaration, die `datei` unter `n` exportiert — über Weiterexporte hinweg? */
  private herkunft(datei: string, n: string, tiefe = 0): { datei: string; name: string } | null {
    const sf = this.baum(datei);
    if (sf === null || tiefe > 8) return null;
    for (const s of sf.statements) {
      if (ts.isExportDeclaration(s) && s.moduleSpecifier !== undefined && ts.isStringLiteral(s.moduleSpecifier)) {
        const ziel = this.aufloesen(datei, s.moduleSpecifier.text);
        if (ziel === null) continue;
        if (s.exportClause === undefined) {
          const h = this.herkunft(ziel, n, tiefe + 1);
          if (h !== null) return h;
        } else if (ts.isNamedExports(s.exportClause)) {
          for (const e of s.exportClause.elements) {
            if (e.name.text === n) return this.herkunft(ziel, (e.propertyName ?? e.name).text, tiefe + 1);
          }
        }
      }
    }
    return { datei, name: n };
  }

  /** Jeder Import jeder Datei, einmal aufgelöst: wer holt was woher. */
  private importe: Import[] | null = null;

  private alleImporte(): Import[] {
    if (this.importe !== null) return this.importe;
    const aus: Import[] = [];
    for (const q of this.quellen) {
      const sf = this.baum(q);
      if (sf === null) continue;
      for (const s of sf.statements) {
        if (!ts.isImportDeclaration(s) || s.importClause === undefined || !ts.isStringLiteral(s.moduleSpecifier)) continue;
        if (s.importClause.isTypeOnly) continue;
        const ziel = this.aufloesen(q, s.moduleSpecifier.text);
        if (ziel === null) continue;
        const b = s.importClause.namedBindings;
        if (b !== undefined && ts.isNamedImports(b)) {
          for (const e of b.elements) {
            if (e.isTypeOnly) continue;
            aus.push({ sf, lokal: e.name, herkunft: this.herkunft(ziel, (e.propertyName ?? e.name).text), namensraum: null });
          }
        } else if (b !== undefined && ts.isNamespaceImport(b)) {
          aus.push({ sf, lokal: b.name, herkunft: null, namensraum: ziel });
        }
      }
    }
    this.importe = aus;
    return aus;
  }

  /**
   * Jede Stelle, die die Top-Level-Deklaration `n` aus `datei` meint: in der
   * Datei selbst und in jeder Datei, die sie importiert (auch `ns.n`).
   */
  private verweiseAufExport(datei: string, n: string): { sf: TS.SourceFile; knoten: TS.Expression }[] {
    const aus: { sf: TS.SourceFile; knoten: TS.Expression }[] = [];
    const eigen = this.baum(datei);
    if (eigen !== null) {
      for (const v of verwendungen(eigen, n, eigen)) aus.push({ sf: eigen, knoten: v });
    }
    for (const i of this.alleImporte()) {
      if (i.sf.fileName === datei) continue;
      if (i.herkunft?.datei === datei && i.herkunft.name === n) {
        for (const v of verwendungen(i.sf, i.lokal.text, i.lokal)) aus.push({ sf: i.sf, knoten: v });
      } else if (i.namensraum !== null && this.herkunft(i.namensraum, n)?.datei === datei) {
        for (const v of verwendungen(i.sf, i.lokal.text, i.lokal)) {
          const p = v.parent;
          if (ts.isPropertyAccessExpression(p) && p.expression === v && p.name.text === n) aus.push({ sf: i.sf, knoten: p });
        }
      }
    }
    return aus;
  }

  private grund(stand: Stand, sf: TS.SourceFile, k: TS.Node, was: string): void {
    stand.alle = true;
    const zeile = sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1;
    stand.gruende.push(`${sf.fileName}:${String(zeile)} ${was}: ${k.getText(sf).replace(/\s+/gu, ' ').slice(0, 80)}`);
  }

  /** Klettert über Hüllen, durch die ein Wert unverändert geht. */
  private aussen(k: TS.Expression): TS.Expression {
    let x: TS.Expression = k;
    for (;;) {
      const p = x.parent;
      if (p === undefined) return x;
      if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)
          || ts.isNonNullExpression(p) || ts.isTypeAssertionExpression(p)) { x = p; continue; }
      if (ts.isConditionalExpression(p) && p.condition !== x) { x = p; continue; }
      if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
          || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) { x = p; continue; }
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          && p.right === x) { x = p; continue; }
      return x;
    }
  }

  /** Ein Verweis auf die Tabelle selbst: wo wird aus ihr ein Eintrag? */
  private tabelle(k: TS.Expression, sf: TS.SourceFile, stand: Stand): void {
    const x = this.aussen(k);
    const p = x.parent;
    if (p !== undefined && ts.isElementAccessExpression(p) && p.expression === x) { this.eintrag(p, sf, stand); return; }
    if (p !== undefined && ts.isPropertyAccessExpression(p) && p.expression === x) {
      if (SPRACHEN.has(p.name.text)) { this.eintrag(p, sf, stand); return; }
      this.grund(stand, sf, p, 'Tabelle ohne Sprache');
      return;
    }
    if (p !== undefined && ts.isCallExpression(p) && p.arguments[0] === x && this.istWahl(p, sf)) {
      this.eintrag(p, sf, stand);
      return;
    }
    // Ein zweiter Name für die Tabelle (`const T = RECRUITING_KANDIDAT_TEXTE`): jede seiner Verwendungen.
    if (p !== undefined && ts.isVariableDeclaration(p) && p.initializer === x && ts.isIdentifier(p.name)) {
      for (const v of verwendungen(bereich(p), p.name.text, p.name)) this.tabelle(v, sf, stand);
      return;
    }
    if (p !== undefined && ts.isExportSpecifier(p)) return;
    this.grund(stand, sf, p ?? x, 'Tabelle weitergegeben');
  }

  /** Ruft `aufruf` eine Funktion, die `erster[…]` zurückgibt (`nachSprache`)? */
  private istWahl(aufruf: TS.CallExpression, sf: TS.SourceFile): boolean {
    const f = this.funktion(aufruf.expression, sf);
    if (f === null) return false;
    const p0 = f.f.parameters[0];
    if (p0 === undefined || !ts.isIdentifier(p0.name)) return false;
    const rueck = rueckgaben(f.f);
    return rueck.length > 0 && rueck.every((r) => {
      const e = ohneHuelle(r);
      return ts.isElementAccessExpression(e) && ts.isIdentifier(ohneHuelle(e.expression))
        && (ohneHuelle(e.expression) as TS.Identifier).text === (p0.name as TS.Identifier).text;
    });
  }

  /** Die Funktion hinter einem Aufrufziel oder Bausteinnamen — in der Datei oder über den Import. */
  private funktion(ziel: TS.Node, sf: TS.SourceFile): { sf: TS.SourceFile; f: Funktion } | null {
    if (!ts.isIdentifier(ziel)) return null;
    return this.deklaration(sf, ziel.text);
  }

  private deklaration(sf: TS.SourceFile, n: string, tiefe = 0): { sf: TS.SourceFile; f: Funktion } | null {
    if (tiefe > 8) return null;
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && s.name?.text === n && s.body !== undefined) return { sf, f: s };
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || d.name.text !== n || d.initializer === undefined) continue;
          const i = ohneHuelle(d.initializer);
          if (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) return { sf, f: i };
        }
      }
    }
    for (const s of sf.statements) {
      if (!ts.isImportDeclaration(s) || s.importClause === undefined || !ts.isStringLiteral(s.moduleSpecifier)) continue;
      const ziel = this.aufloesen(sf.fileName, s.moduleSpecifier.text);
      const zsf = ziel === null ? null : this.baum(ziel);
      if (zsf === null) continue;
      if (s.importClause.name?.text === n) {
        for (const a of zsf.statements) {
          if (ts.isFunctionDeclaration(a) && a.body !== undefined
              && a.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return { sf: zsf, f: a };
        }
        return null;
      }
      const b = s.importClause.namedBindings;
      if (b === undefined || !ts.isNamedImports(b)) continue;
      for (const e of b.elements) {
        if (e.name.text !== n) continue;
        const h = this.herkunft(ziel!, (e.propertyName ?? e.name).text);
        const hsf = h === null ? null : this.baum(h.datei);
        return hsf === null || h === null ? null : this.deklaration(hsf, h.name, tiefe + 1);
      }
    }
    return null;
  }

  /** Ein Wert, der ein Spracheintrag ist: wer liest welches Feld? */
  private eintrag(e: TS.Expression, sf: TS.SourceFile, stand: Stand): void {
    const schluessel = `${sf.fileName}:${String(e.pos)}:${String(e.end)}`;
    if (this.spur.has(schluessel)) return;
    this.spur.add(schluessel);
    stand.orte += 1;
    const x = this.aussen(e);
    const p = x.parent;
    if (p === undefined) { this.grund(stand, sf, x, 'ohne Umgebung'); return; }
    if (ts.isPropertyAccessExpression(p) && p.expression === x) { stand.felder.add(p.name.text); return; }
    if (ts.isElementAccessExpression(p) && p.expression === x) {
      const a = p.argumentExpression;
      if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) stand.felder.add(a.text);
      else this.grund(stand, sf, p, 'Schlüssel zur Laufzeit');
      return;
    }
    if (ts.isVariableDeclaration(p) && p.initializer === x) { this.bindung(p.name, p, sf, stand); return; }
    // Ein Vorgabewert: `function f(t = T.de)`, `({ texte = T.de }) => …`.
    if (ts.isParameter(p) && p.initializer === x) { this.bindung(p.name, p, sf, stand); return; }
    if (ts.isBindingElement(p) && p.initializer === x) {
      let d: TS.Node = p;
      while (!ts.isParameter(d) && !ts.isVariableDeclaration(d) && d.parent !== undefined) d = d.parent;
      this.bindung(p.name, d, sf, stand);
      return;
    }
    // In ein Objekt unter dem Namen `P`: jedes `x.P` im Baum gilt als dieser Eintrag.
    if ((ts.isPropertyAssignment(p) && p.initializer === x) || ts.isShorthandPropertyAssignment(p)) {
      this.feldname(name(p.name, sf), stand);
      return;
    }
    // Ein Vergleich, eine Wahrheitsprobe, ein `typeof` liest kein Feld.
    if (ts.isBinaryExpression(p)) {
      const op = p.operatorToken.kind;
      if (VERGLEICHE.has(op)) return;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken && p.left === x) return;
      if (op === ts.SyntaxKind.EqualsToken && p.left === x) return;
      if (op === ts.SyntaxKind.EqualsToken && p.right === x && ts.isIdentifier(p.left)) {
        const d = deklarationVon(p.left);
        if (d !== null) { this.bindung(d.name, d, sf, stand); return; }
      }
    }
    if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return;
    if (ts.isTypeOfExpression(p)) return;
    if (ts.isConditionalExpression(p) && p.condition === x) return;
    if ((ts.isIfStatement(p) || ts.isWhileStatement(p)) && p.expression === x) return;
    if (ts.isCallExpression(p) && p.arguments.includes(x)) { this.argument(p, p.arguments.indexOf(x), sf, stand); return; }
    if (ts.isJsxExpression(p) && p.parent !== undefined && ts.isJsxAttribute(p.parent)) {
      this.eigenschaft(p.parent, sf, stand);
      return;
    }
    if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === x)) { this.rueckgabe(p, sf, stand); return; }
    this.grund(stand, sf, p, 'Weg nicht verfolgt');
  }

  /** Jeder Zugriff `x.P` und jedes `{ P }`-Muster im Baum, nach `P` geordnet. */
  private zugriffe: Map<string, { sf: TS.SourceFile; knoten: TS.Node }[]> | null = null;

  private feldname(p: string, stand: Stand): void {
    if (this.spur.has(`feld:${p}`)) return;
    this.spur.add(`feld:${p}`);
    if (this.zugriffe === null) {
      const z = new Map<string, { sf: TS.SourceFile; knoten: TS.Node }[]>();
      const merke = (n: string, sf: TS.SourceFile, knoten: TS.Node): void => {
        const l = z.get(n);
        if (l === undefined) z.set(n, [{ sf, knoten }]);
        else l.push({ sf, knoten });
      };
      for (const q of this.quellen) {
        const sf = this.baum(q);
        if (sf === null) continue;
        const gehe = (k: TS.Node): void => {
          if (ts.isPropertyAccessExpression(k)) merke(k.name.text, sf, k);
          if (ts.isBindingElement(k) && ts.isObjectBindingPattern(k.parent) && k.dotDotDotToken === undefined) {
            merke(name(k.propertyName ?? k.name, sf), sf, k);
          }
          ts.forEachChild(k, gehe);
        };
        gehe(sf);
      }
      this.zugriffe = z;
    }
    for (const { sf, knoten } of this.zugriffe.get(p) ?? []) {
      if (ts.isPropertyAccessExpression(knoten)) { this.eintrag(knoten, sf, stand); continue; }
      const b = knoten as TS.BindingElement;
      let d: TS.Node = b;
      while (!ts.isParameter(d) && !ts.isVariableDeclaration(d) && d.parent !== undefined) d = d.parent;
      this.bindung(b.name, d, sf, stand);
    }
  }

  /** `const t = e`, `const { a, b } = e`, ein Parameter `t` oder `{ a }`. */
  private bindung(n: TS.BindingName, deklaration: TS.Node, sf: TS.SourceFile, stand: Stand): void {
    if (ts.isIdentifier(n)) {
      for (const v of verwendungen(bereich(deklaration), n.text, n)) this.eintrag(v, sf, stand);
      return;
    }
    if (ts.isObjectBindingPattern(n)) {
      for (const b of n.elements) {
        if (b.dotDotDotToken !== undefined) { this.grund(stand, sf, b, 'Rest'); continue; }
        stand.felder.add(name(b.propertyName ?? b.name, sf));
      }
      return;
    }
    this.grund(stand, sf, n, 'Listenmuster');
  }

  /** `f(…, e, …)` — an den Parameter von `f` weiter. */
  private argument(aufruf: TS.CallExpression, i: number, sf: TS.SourceFile, stand: Stand): void {
    const ziele = this.aufrufziele(aufruf.expression, sf);
    if (ziele.length === 0) { this.grund(stand, sf, aufruf, 'Aufruf nicht aufgelöst'); return; }
    for (const f of ziele) {
      const p = f.f.parameters[i];
      if (p === undefined) continue;
      if (p.dotDotDotToken !== undefined) { this.grund(stand, f.sf, p, 'Restparameter'); continue; }
      this.bindung(p.name, p, f.sf, stand);
    }
  }

  /**
   * Welche Funktionen ein Aufruf erreichen kann: eine benannte (in der Datei
   * oder über den Import) — oder jede Funktion einer Tabelle von Funktionen,
   * aus der das Ziel erst zur Laufzeit gewählt wird
   * (`eigenerEintrag(ANTWORT_TEXT, antwort)(t)`, `ANTWORT_TEXT[a](t)`).
   */
  private aufrufziele(ziel: TS.Expression, sf: TS.SourceFile): { sf: TS.SourceFile; f: Funktion }[] {
    const x = ohneHuelle(ziel);
    const benannt = this.funktion(x, sf);
    if (benannt !== null) return [benannt];
    let quelle: TS.Node | null = null;
    if (ts.isIdentifier(x)) {
      const d = deklarationVon(x);
      if (d !== null && ts.isVariableDeclaration(d) && d.initializer !== undefined) quelle = d.initializer;
    } else if (ts.isElementAccessExpression(x) || ts.isPropertyAccessExpression(x)) {
      quelle = x.expression;
    }
    if (quelle === null) return [];
    const aus: { sf: TS.SourceFile; f: Funktion }[] = [];
    const gehe = (k: TS.Node): void => {
      if (ts.isIdentifier(k)) {
        for (const s of sf.statements) {
          if (!ts.isVariableStatement(s)) continue;
          for (const d of s.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || d.name.text !== k.text || d.initializer === undefined) continue;
            const o = ohneHuelle(d.initializer);
            if (!ts.isObjectLiteralExpression(o)) continue;
            for (const p of o.properties) {
              const w = ts.isPropertyAssignment(p) ? ohneHuelle(p.initializer) : null;
              if (w !== null && (ts.isArrowFunction(w) || ts.isFunctionExpression(w))) aus.push({ sf, f: w });
            }
          }
        }
      }
      ts.forEachChild(k, gehe);
    };
    gehe(quelle);
    return aus;
  }

  /** `<Baustein t={e} />` — an die Eigenschaft `t` des Bausteins weiter. */
  private eigenschaft(attr: TS.JsxAttribute, sf: TS.SourceFile, stand: Stand): void {
    const el = attr.parent.parent;
    const tag = el.tagName;
    const f = /^[A-Z]/u.test(tag.getText(sf)) ? this.funktion(tag, sf) : null;
    if (f === null) { this.grund(stand, sf, attr, 'Baustein nicht aufgelöst'); return; }
    const attrName = attr.name.getText(sf);
    const p0 = f.f.parameters[0];
    if (p0 === undefined) return;
    if (ts.isObjectBindingPattern(p0.name)) {
      for (const b of p0.name.elements) {
        if (b.dotDotDotToken !== undefined) { this.grund(stand, f.sf, b, 'Eigenschaften weitergereicht'); continue; }
        if (name(b.propertyName ?? b.name, f.sf) !== attrName) continue;
        this.bindung(b.name, p0, f.sf, stand);
      }
      return;
    }
    if (ts.isIdentifier(p0.name)) {
      for (const v of verwendungen(bereich(p0), p0.name.text, p0.name)) {
        const q = v.parent;
        if (ts.isPropertyAccessExpression(q) && q.expression === v) {
          if (q.name.text === attrName) this.eintrag(q, f.sf, stand);
          continue;
        }
        if (ts.isVariableDeclaration(q) && q.initializer === v && ts.isObjectBindingPattern(q.name)) {
          for (const b of q.name.elements) {
            if (b.dotDotDotToken !== undefined) { this.grund(stand, f.sf, b, 'Eigenschaften weitergereicht'); continue; }
            if (name(b.propertyName ?? b.name, f.sf) === attrName) this.bindung(b.name, q, f.sf, stand);
          }
          continue;
        }
        this.grund(stand, f.sf, q, 'Eigenschaften weitergereicht');
      }
      return;
    }
    this.grund(stand, f.sf, p0, 'Parameter');
  }

  /** `return e` — an jeden Aufruf der Funktion weiter. */
  private rueckgabe(k: TS.Node, sf: TS.SourceFile, stand: Stand): void {
    let f: TS.Node | undefined = k;
    while (f !== undefined && !istFunktion(f)) f = f.parent;
    if (f === undefined) { this.grund(stand, sf, k, 'Rückgabe ausserhalb'); return; }
    let n: string | null = null;
    if (ts.isFunctionDeclaration(f) && f.name !== undefined) n = f.name.text;
    else if (f.parent !== undefined && ts.isVariableDeclaration(f.parent) && ts.isIdentifier(f.parent.name)) {
      n = f.parent.name.text;
    }
    // Nur Funktionen oben in der Datei: dort gibt es einen Namen, den man importieren kann.
    const oben = f.parent !== undefined && (ts.isSourceFile(f.parent)
      || (ts.isVariableDeclaration(f.parent) && ts.isVariableStatement(f.parent.parent.parent)
        && ts.isSourceFile(f.parent.parent.parent.parent)));
    if (n === null || !oben) { this.grund(stand, sf, k, 'Rückgabe einer inneren Funktion'); return; }
    for (const { sf: s, knoten } of this.verweiseAufExport(sf.fileName, n)) {
      const q = knoten.parent;
      if (q !== undefined && ts.isCallExpression(q) && q.expression === knoten) this.eintrag(q, s, stand);
      else if (q !== undefined && ts.isExportSpecifier(q)) continue;
      else this.grund(stand, s, q ?? knoten, 'Funktion weitergegeben');
    }
  }
}

const VERGLEICHE = new Set<TS.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.InstanceOfKeyword, ts.SyntaxKind.InKeyword,
]);

/** Die Deklaration (`let t`, ein Parameter), an die `t = …` zuweist. */
function deklarationVon(n: TS.Identifier): TS.VariableDeclaration | TS.ParameterDeclaration | null {
  for (let a: TS.Node | undefined = n.parent; a !== undefined; a = a.parent) {
    if (ts.isBlock(a) || ts.isSourceFile(a) || ts.isModuleBlock(a)) {
      for (const s of a.statements) {
        if (!ts.isVariableStatement(s)) continue;
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === n.text) return d;
        }
      }
    }
    if (istFunktion(a)) {
      for (const p of a.parameters) if (ts.isIdentifier(p.name) && p.name.text === n.text) return p;
    }
  }
  return null;
}

function rueckgaben(f: Funktion): TS.Expression[] {
  const aus: TS.Expression[] = [];
  const koerper = f.body;
  if (koerper === undefined) return aus;
  if (!ts.isBlock(koerper)) return [koerper];
  const gehe = (k: TS.Node): void => {
    if (istFunktion(k)) return;
    if (ts.isReturnStatement(k) && k.expression !== undefined) aus.push(k.expression);
    ts.forEachChild(k, gehe);
  };
  ts.forEachChild(koerper, gehe);
  return aus;
}
