/**
 * Was steht als TEXT auf dem Schirm? — gelesen am Syntaxbaum (V-250, D-741).
 *
 * **Wozu.** Die Sperrklinke in `recht-im-satz.test.ts` sah nur
 * `<code>…</code>`. Dieselben Schlüssel standen weiter roh auf dem Schirm:
 * als Text zwischen zwei Elementen („dafür fehlt `zeit.abwesenheit_lesen`"),
 * als Zeichenkette in einem Ausdruck (`'… dafür fehlt Ihnen angebot.schreiben.'`),
 * in `<span className="font-mono">`, in `<strong>{RECHT_EINGANG_LESEN}</strong>`
 * und in den Satztabellen, aus denen die Seiten ihre Sätze nehmen („Ihnen
 * fehlt objekt.schreiben."). Dazu Markdown-Backticks, die im Browser nicht
 * Code werden, sondern Backticks bleiben.
 *
 * **Was hier als sichtbar gilt.**
 *
 *  - In `.tsx`: jeder JSX-Text; jede Zeichenkette an einer Stelle, deren Wert
 *    gerendert wird — ein Kind in `{…}`, durch `?:` (nur die beiden Äste),
 *    `&&` (nur rechts), `||`/`??`/`+` (beide Seiten), Klammern, Vorlagen
 *    (`\`…${x}…\``, auch die eingesetzten Werte), Listen, der Rückruf von
 *    `.map` und die Rückgabe einer Funktion derselben Datei, die dort
 *    aufgerufen wird; der Wert einer Beschriftung (`aria-label`,
 *    `placeholder`, `alt`, `label`, `titel`, `text`, `hinweis` … — die Liste
 *    der Übersetzungswache, ohne `title`: dort trägt `<Recht>` den Schlüssel
 *    mit Absicht) und einer Tabellenzelle (`zelle: (z) => …`); ein Name an
 *    einer solchen Stelle, der auf eine Konstante zeigt — in derselben Datei
 *    oder über den Import. Gemeldet wird an der Stelle, an der er steht.
 *  - In jeder Datei, auch einer Seite, als Satztabelle: jede Zeichenkette,
 *    die Wert eines Objektfelds ist, auch über `+`, `?:` und Vorlagen
 *    hinweg. Ein Wert, der NUR ein Schlüssel ist (`recht: 'crm.lesen'`), ist
 *    dort Steuerung und kein Satz; ein Schlüssel IN einem Satz ist einer.
 *
 * **Nicht sichtbar** sind Vergleiche (`x === 'crm.lesen'`), Aufrufargumente
 * (`hatRecht('crm.lesen')`, `tx.unsafe('select …')`), Feldzugriffe
 * (`darf['crm.lesen']`), `className`, `href`, `schluessel`, `data-*` und
 * `title`.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type * as TS from 'typescript';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;

export interface TextBefund {
  readonly datei: string;
  readonly zeile: number;
  /**
   * `schluessel` ein Rechteschlüssel, `backtick` ein Markdown-Backtick,
   * `bezeichner` ein Name aus dem Quelltext (`quelle_ausgabe_uk`,
   * `app.berlin_heute()`, `fuelleTatsachen()`), `pfad` ein Dateipfad
   * (`server/benachrichtigung/registry.ts`), `sql` ein SQL-Wort in
   * Grossbuchstaben (`UPDATE`, `NULL`, `CHECK`).
   */
  readonly art: 'schluessel' | 'backtick' | 'bezeichner' | 'pfad' | 'sql';
  /** Der Schlüssel, der Backtick, der Name, der Pfad oder das Wort. */
  readonly fund: string;
  readonly text: string;
}

/**
 * Beschriftungen, deren Wert auf dem Schirm landet — die Liste der
 * Übersetzungswache (`scripts/guards/seite-ohne-uebersetzung.ts`) ohne
 * `title`, dazu, was die Bausteine hier sonst als Text zeigen: `unterzeile`
 * der Anmeldeseiten, `wert` eines Feldes, `leer` einer Tabelle, `was`/`weg`
 * eines noch nicht gebauten Wegs, `defaultValue` eines Textfelds.
 */
export const SICHTBARE_ATTRIBUTE: ReadonlySet<string> = new Set([
  'titel', 'wurzelTitel', 'untertitel', 'kopf', 'beschriftung', 'beschreibung',
  'label', 'aria-label', 'aria-description', 'alt', 'placeholder',
  'hinweis', 'legende', 'text', 'leerText', 'knopfText', 'titelText',
  'ueberschrift', 'meldung', 'fehler', 'erklaerung', 'zusammenfassung',
  'aktuell', 'zielTitel', 'frage', 'antwort', 'warnung', 'summary', 'unterzeile',
  'wert', 'leer', 'was', 'weg', 'defaultValue',
]);

/** `modul.aktion`, auch dreiteilig (`gruppe.abrechnung.lesen`). */
const SCHLUESSEL_KANDIDAT = /[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,2}/gu;

/**
 * Ein Name aus dem Quelltext: mit Unterstrich, auch mit Punkt davor oder
 * dahinter (`quelle_ausgabe_uk`, `super_admin`, `app.darf_kontaktiert_werden`),
 * oder mit Aufrufklammern (`app.berlin_heute()`, `fuelleTatsachen()`, `gate()`).
 */
const BEZEICHNER = /(?<![\w./@-])(?:(?=[a-z0-9_.]*_)[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*(?:\(\))?|[a-z][a-zA-Z0-9_]*(?:\.[a-z][a-zA-Z0-9_]*)*\(\))(?![\w@])/gu;

/** Ein Dateipfad mit Endung des Quelltexts (`server/agent/policy.ts`, `docs/DESIGN.md`). */
const PFAD = /[\w.-]*\/[\w./-]*\.(?:tsx?|jsx?|mjs|cjs|sql|md)\b/gu;

/** SQL in Grossbuchstaben — in einem deutschen oder englischen Satz ist das kein Wort. */
const SQL_WORT = /\b(?:SELECT|INSERT|UPDATE|DELETE|RETURNING|WHERE|NULL|CHECK|TRIGGER|POLICY|GRANT|REVOKE|TRUNCATE|JOIN|RLS)\b/gu;

function baum(datei: string, quelle: string): TS.SourceFile {
  return ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true,
    datei.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function ohneHuelle(e: TS.Expression): TS.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)
      || ts.isSatisfiesExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
}

interface Lauf {
  readonly schluessel: ReadonlySet<string>;
  readonly befunde: TextBefund[];
  readonly lies: (datei: string) => string | null;
  readonly wurzel: string;
  readonly baeume: Map<string, TS.SourceFile | null>;
  /** Funktionen, deren Rückgabe gerade gelesen wird — gegen Rekursion. */
  readonly offen: Set<TS.Node>;
}

function holeBaum(lauf: Lauf, datei: string): TS.SourceFile | null {
  if (lauf.baeume.has(datei)) return lauf.baeume.get(datei) ?? null;
  const quelle = lauf.lies(datei);
  const sf = quelle === null ? null : baum(datei, quelle);
  lauf.baeume.set(datei, sf);
  return sf;
}

/**
 * Prüft einen sichtbaren Text an der Stelle `ort`. `nurImSatz`: ein Wert,
 * der ausschliesslich ein Schlüssel ist, zählt nicht (Satztabellen).
 */
function pruefeText(
  lauf: Lauf, sf: TS.SourceFile, ort: TS.Node, text: string, nurImSatz: boolean,
  /** Ein Eingabebeispiel (`placeholder`): ein Name darin ist, was der Mensch tippt. */
  eingabe = false,
): void {
  const zeile = sf.getLineAndCharacterOfPosition(ort.getStart(sf)).line + 1;
  const kurz = text.replace(/\s+/gu, ' ').trim().slice(0, 120);
  if (text.includes('`')) {
    lauf.befunde.push({ datei: sf.fileName, zeile, art: 'backtick', fund: '`', text: kurz });
  }
  // Ein Wert, der NUR ein Name ist (`recht: 'crm.lesen'`, `wert: 'einwand_mitarbeiter'`),
  // ist in einer Tabelle Steuerung und kein Satz.
  if (nurImSatz && (lauf.schluessel.has(text.trim())
      || /^[A-Za-z0-9](?:[\w./:@-]*[A-Za-z0-9)])?$/u.test(text.trim()))) return;
  const schluessel: string[] = [];
  for (const m of text.matchAll(SCHLUESSEL_KANDIDAT)) {
    const start = m.index ?? 0;
    const vor = text[start - 1] ?? '';
    // Teil eines längeren Namens (`app.hat_recht`, `/pfad/crm.lesen`): kein eigener Schlüssel.
    if (/[\w./]/u.test(vor)) continue;
    if (!lauf.schluessel.has(m[0])) continue;
    schluessel.push(m[0]);
    lauf.befunde.push({ datei: sf.fileName, zeile, art: 'schluessel', fund: m[0], text: kurz });
  }
  if (eingabe) return;
  for (const m of text.matchAll(PFAD)) {
    lauf.befunde.push({ datei: sf.fileName, zeile, art: 'pfad', fund: m[0], text: kurz });
  }
  for (const m of text.matchAll(BEZEICHNER)) {
    // Ein Rechteschlüssel ist oben schon gemeldet; ein Teil eines Pfads ebenso.
    if (schluessel.some((s) => m[0].startsWith(s))) continue;
    if ([...text.matchAll(PFAD)].some((p) => p[0].includes(m[0]))) continue;
    lauf.befunde.push({ datei: sf.fileName, zeile, art: 'bezeichner', fund: m[0], text: kurz });
  }
  for (const m of text.matchAll(SQL_WORT)) {
    lauf.befunde.push({ datei: sf.fileName, zeile, art: 'sql', fund: m[0], text: kurz });
  }
}

/** Die Deklaration eines Namens im Gültigkeitsbereich — Variable, Funktion oder Import. */
function finde(name: TS.Identifier): TS.Node | null {
  for (let k: TS.Node | undefined = name.parent; k !== undefined; k = k.parent) {
    const anweisungen = ts.isSourceFile(k) || ts.isBlock(k) || ts.isModuleBlock(k) ? k.statements : null;
    if (anweisungen === null) continue;
    for (const a of anweisungen) {
      if (ts.isVariableStatement(a)) {
        for (const d of a.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name.text) return d;
        }
      }
      if (ts.isFunctionDeclaration(a) && a.name?.text === name.text) return a;
      if (ts.isImportDeclaration(a) && a.importClause !== undefined) {
        const b = a.importClause.namedBindings;
        if (b !== undefined && ts.isNamedImports(b)) {
          for (const e of b.elements) if (e.name.text === name.text) return e;
        }
      }
    }
  }
  return null;
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

/** Die Zeichenkette einer exportierten Konstante einer anderen Datei — oder `null`. */
function exportierteZeichenkette(lauf: Lauf, datei: string, name: string): string | null {
  const sf = holeBaum(lauf, datei);
  if (sf === null) return null;
  for (const a of sf.statements) {
    if (!ts.isVariableStatement(a)) continue;
    for (const d of a.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== name || d.initializer === undefined) continue;
      const i = ohneHuelle(d.initializer);
      return ts.isStringLiteral(i) || ts.isNoSubstitutionTemplateLiteral(i) ? i.text : null;
    }
  }
  return null;
}

/**
 * Ein Wert, der gerendert wird: jede Zeichenkette darin, die Äste, die
 * Einsetzungen, und was ein Name oder ein Aufruf derselben Datei liefert.
 * `ort` ist die Stelle auf der Seite — für einen Namen der Name, nicht
 * seine Deklaration.
 */
function wert(lauf: Lauf, sf: TS.SourceFile, e: TS.Expression, ort?: TS.Node): void {
  const x = ohneHuelle(e);
  const hier = ort ?? x;
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) {
    pruefeText(lauf, sf, hier, x.text, false);
    return;
  }
  if (ts.isTemplateExpression(x)) {
    pruefeText(lauf, sf, hier, [x.head.text, ...x.templateSpans.map((s) => s.literal.text)].join('…'), false);
    for (const s of x.templateSpans) wert(lauf, sf, s.expression, ort);
    return;
  }
  if (ts.isConditionalExpression(x)) {
    wert(lauf, sf, x.whenTrue, ort);
    wert(lauf, sf, x.whenFalse, ort);
    return;
  }
  if (ts.isBinaryExpression(x)) {
    const op = x.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.CommaToken) {
      wert(lauf, sf, x.right, ort);
    } else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken
        || op === ts.SyntaxKind.PlusToken) {
      wert(lauf, sf, x.left, ort);
      wert(lauf, sf, x.right, ort);
    }
    return;
  }
  if (ts.isArrayLiteralExpression(x)) {
    for (const el of x.elements) {
      if (!ts.isSpreadElement(el) && !ts.isOmittedExpression(el)) wert(lauf, sf, el, ort);
    }
    return;
  }
  if (ts.isCallExpression(x)) {
    const c = x.expression;
    // `liste.map((z) => 'Satz')` — die Rückgabe des Rückrufs wird gerendert.
    if (ts.isPropertyAccessExpression(c) && (c.name.text === 'map' || c.name.text === 'flatMap')) {
      const f = x.arguments[0];
      if (f !== undefined && (ts.isArrowFunction(f) || ts.isFunctionExpression(f))) rueckgaben(lauf, sf, f, ort);
      return;
    }
    // Eine Funktion derselben Datei: was sie zurückgibt, steht an dieser Stelle.
    if (ts.isIdentifier(c)) {
      const d = finde(c);
      if (d !== null && ts.isFunctionDeclaration(d)) rueckgaben(lauf, sf, d, ort ?? x);
      else if (d !== null && ts.isVariableDeclaration(d) && d.initializer !== undefined
          && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
        rueckgaben(lauf, sf, d.initializer, ort ?? x);
      }
    }
    return;
  }
  if (ts.isIdentifier(x)) {
    const d = finde(x);
    if (d === null) return;
    if (ts.isVariableDeclaration(d) && d.initializer !== undefined) {
      const init = ohneHuelle(d.initializer);
      // Nur eine Zeichenkette (auch zusammengesetzt) zählt — ein Objekt ist keine Anzeige.
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)
          || ts.isTemplateExpression(init) || ts.isConditionalExpression(init)
          || ts.isBinaryExpression(init)) {
        wert(lauf, sf, init, hier);
      }
      return;
    }
    if (ts.isImportSpecifier(d)) {
      const decl = d.parent.parent.parent;
      if (!ts.isStringLiteral(decl.moduleSpecifier)) return;
      const ziel = aufloesen(lauf, sf.fileName, decl.moduleSpecifier.text);
      if (ziel === null) return;
      const text = exportierteZeichenkette(lauf, ziel, (d.propertyName ?? d.name).text);
      if (text !== null) pruefeText(lauf, sf, hier, text, false);
    }
  }
}

function rueckgaben(lauf: Lauf, sf: TS.SourceFile, f: TS.SignatureDeclaration, ort?: TS.Node): void {
  if (lauf.offen.has(f)) return;
  lauf.offen.add(f);
  const koerper = (f as TS.FunctionLikeDeclaration).body;
  if (koerper !== undefined && !ts.isBlock(koerper)) wert(lauf, sf, koerper, ort);
  else if (koerper !== undefined) {
    const gehe = (k: TS.Node): void => {
      if (ts.isFunctionLike(k)) return;
      if (ts.isReturnStatement(k) && k.expression !== undefined) wert(lauf, sf, k.expression, ort);
      ts.forEachChild(k, gehe);
    };
    ts.forEachChild(koerper, gehe);
  }
  lauf.offen.delete(f);
}

/**
 * `wert` und `defaultValue` sind als Attribut eines Feldes Text
 * (`<Feld wert="…">`, ein vorbelegtes Textfeld) — als Objektfeld aber der
 * Wert einer Auswahl (`{ wert: 'zeit_korrektur', text: 'Zeitkorrektur' }`).
 */
const NUR_ALS_ATTRIBUT: ReadonlySet<string> = new Set(['wert', 'defaultValue']);

/** `defaultValue` einer Auswahlliste ist der Wert der vorgewählten Option, kein Text. */
function vorauswahl(a: TS.JsxAttribute, sf: TS.SourceFile): boolean {
  if (a.name.getText(sf) !== 'defaultValue') return false;
  const el = a.parent.parent;
  return el.tagName.getText(sf) === 'select';
}

function eigenschaftsName(p: TS.PropertyAssignment): string {
  const n = p.name;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return '';
}

/** Eine Seite oder ein Baustein (`.tsx`). */
function pruefeTsx(lauf: Lauf, sf: TS.SourceFile): void {
  const gehe = (k: TS.Node): void => {
    if (ts.isJsxText(k)) pruefeText(lauf, sf, k, k.text, false);
    else if (ts.isJsxExpression(k) && k.expression !== undefined
        && (ts.isJsxElement(k.parent) || ts.isJsxFragment(k.parent))) {
      wert(lauf, sf, k.expression);
    } else if (ts.isJsxAttribute(k) && SICHTBARE_ATTRIBUTE.has(k.name.getText(sf))
        && k.initializer !== undefined && !vorauswahl(k, sf)) {
      const i = k.initializer;
      // Ein Platzhalter zeigt, was der Mensch tippt — auch einen Schlüssel wie `vollzeit_39`.
      const eingabe = k.name.getText(sf) === 'placeholder';
      const fest = ts.isJsxExpression(i) && i.expression !== undefined ? ohneHuelle(i.expression) : i;
      if (ts.isStringLiteral(fest) || ts.isNoSubstitutionTemplateLiteral(fest)) {
        pruefeText(lauf, sf, fest, fest.text, false, eingabe);
      } else if (ts.isJsxExpression(i) && i.expression !== undefined) wert(lauf, sf, i.expression);
    } else if (ts.isPropertyAssignment(k) && SICHTBARE_ATTRIBUTE.has(eigenschaftsName(k))
        && !NUR_ALS_ATTRIBUT.has(eigenschaftsName(k))) {
      wert(lauf, sf, k.initializer);
    } else if (ts.isPropertyAssignment(k) && eigenschaftsName(k) === 'zelle'
        && (ts.isArrowFunction(k.initializer) || ts.isFunctionExpression(k.initializer))) {
      // Eine Tabellenzelle: was der Rückruf zurückgibt, steht in der Zelle.
      rueckgaben(lauf, sf, k.initializer);
    }
    ts.forEachChild(k, gehe);
  };
  gehe(sf);
}

/**
 * Der Text einer Kette aus `+`, als EIN Satz gelesen — `'Ihnen fehlt ' +
 * 'objekt.schreiben.'` ist ein Satz mit Schlüssel, nicht zwei Stücke, von
 * denen eines „nur ein Name" wäre. Was erst zur Laufzeit entsteht, steht als
 * `…` darin; `null`, wenn gar kein Text dabei ist.
 */
function kette(e: TS.Expression): string | null {
  const x = ohneHuelle(e);
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return x.text;
  if (ts.isTemplateExpression(x)) return [x.head.text, ...x.templateSpans.map((s) => s.literal.text)].join('…');
  if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = kette(x.left);
    const r = kette(x.right);
    return l === null && r === null ? null : `${l ?? '…'}${r ?? '…'}`;
  }
  return null;
}

/** Die Werte der Objektfelder einer Datei — auch durch `+`, `?:` und Vorlagen. */
function pruefeTabelle(lauf: Lauf, sf: TS.SourceFile): void {
  const satz = (e: TS.Expression): void => {
    const x = ohneHuelle(e);
    if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isTemplateExpression(x)
        || (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const text = kette(x);
      if (text !== null) pruefeText(lauf, sf, x, text, true);
    } else if (ts.isConditionalExpression(x)) {
      satz(x.whenTrue);
      satz(x.whenFalse);
    } else if ((ts.isArrowFunction(x) || ts.isFunctionExpression(x)) && !ts.isBlock(x.body)) {
      // `warnungAb: (p) => \`Warnung ab ${p} %\`` — die Rückgabe ist der Satz.
      satz(x.body);
    }
  };
  const gehe = (k: TS.Node): void => {
    if (ts.isPropertyAssignment(k)) satz(k.initializer);
    ts.forEachChild(k, gehe);
  };
  gehe(sf);
}

/**
 * Prüft den Baum: jede `.tsx` nach ihren sichtbaren Stellen, jede Datei nach
 * ihren Satztabellen. `lies` liefert weitere Dateien für aufgelöste Importe.
 */
export function pruefeSichtbarenText(
  dateien: readonly (readonly [string, string])[],
  schluessel: ReadonlySet<string>,
  lies: (datei: string) => string | null,
  wurzel: string,
): readonly TextBefund[] {
  const quellen = new Map(dateien);
  const lauf: Lauf = {
    schluessel, befunde: [], wurzel, baeume: new Map(), offen: new Set(),
    lies: (d) => quellen.get(d) ?? lies(d),
  };
  for (const [datei] of dateien) {
    const sf = holeBaum(lauf, datei);
    if (sf === null) continue;
    if (datei.endsWith('.tsx')) pruefeTsx(lauf, sf);
    // Auch eine Seite führt eigene Satztabellen (`const FEHLERTEXT = { … }`).
    pruefeTabelle(lauf, sf);
  }
  const eindeutig = new Map<string, TextBefund>();
  for (const b of lauf.befunde) eindeutig.set(`${b.datei}:${String(b.zeile)}:${b.art}:${b.fund}`, b);
  return [...eindeutig.values()];
}
