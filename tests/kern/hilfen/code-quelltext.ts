/**
 * Was steht als CODE auf dem Schirm? — gelesen am Syntaxbaum (V-251, D-742).
 *
 * **Der Befund.** Das Kontaktblatt und die Rechtsgrundlagen-Seite erklärten
 * ihre Regeln mit den Namen der Datenbank: „der Auslöser
 * `kern.erzwinge_widerspruch`", „der CHECK
 * `ansprechpartner_kanaele_nur_bei_einwilligung`", „aus
 * `app.darf_kontaktiert_werden`". 46 weitere Seiten taten dasselbe, dazu
 * Dateipfade (`server/benachrichtigung/registry.ts`), Befehle
 * (`pnpm content:import`), SQL (`returning`, `insert`) und Funktionsnamen
 * (`fuelleTatsachen()`). Für den Menschen, der das liest, ist das Quelltext
 * — er erfährt, DASS etwas gilt, aber nicht, was es für ihn heisst.
 *
 * **Was hier gelesen wird:** jedes `<code>` und jedes Element mit
 * `font-mono` in `className`, dessen Inhalt fest im Quelltext steht — als
 * Text, Zeichenkette, Konstante derselben Datei oder Konstante über den
 * Import. Ein Wert, der erst zur Laufzeit entsteht (`{b.dateiSha256}`,
 * `{k.iban}`, `/unternehmen/{mandant}`), ist Anzeige eines Datums und kein
 * Quelltext.
 *
 * **Was als Datenbankname gilt**, wenn es der ganze Inhalt ist: ein Name mit
 * Unterstrich (`lead_aktivitaet_hat_bezug`), `schema.name` oder
 * `tabelle.spalte` (`app.darf_kontaktiert_werden()`, `raum.bemerkung`) —
 * ausser einem Dateinamen (`index.xml`) und einem Rechteschlüssel (den prüft
 * `recht-im-satz.test.ts`) —, und der Name einer Tabelle aus `drizzle/`.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type * as TS from 'typescript';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;

export interface CodeStelle {
  readonly datei: string;
  readonly zeile: number;
  /** Der feste Inhalt, getrimmt. */
  readonly inhalt: string;
}

const DATEIENDUNG = /\.(?:tsx?|jsx?|mjs|xml|csv|json|md|pdf|txt|sql|html?|zip|png|svg)$/u;
const MIT_UNTERSTRICH = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u;
const MIT_PUNKT = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u;

/** Die Tabellen, die `drizzle/` anlegt — aus den Migrationen gelesen. */
export function tabellenAus(migrationen: readonly string[]): ReadonlySet<string> {
  const aus = new Set<string>();
  for (const sql of migrationen) {
    for (const m of sql.matchAll(
      /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:[a-z_]+\.)?"?([a-z_][a-z0-9_]*)"?/giu)) {
      aus.add((m[1] ?? '').toLowerCase());
    }
  }
  return aus;
}

/** Ist dieser Inhalt eines Code-Elements ein Name aus der Datenbank? */
export function istDatenbankname(
  inhalt: string, tabellen: ReadonlySet<string>, schluessel: ReadonlySet<string>,
): boolean {
  const name = inhalt.trim().replace(/\(\)$/u, '');
  if (name === '' || DATEIENDUNG.test(name) || schluessel.has(name)) return false;
  return MIT_UNTERSTRICH.test(name) || MIT_PUNKT.test(name) || tabellen.has(name);
}

function baum(datei: string, quelle: string): TS.SourceFile {
  return ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true,
    datei.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function klassen(e: TS.JsxOpeningElement, sf: TS.SourceFile): readonly string[] {
  for (const a of e.attributes.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== 'className' || a.initializer === undefined) continue;
    if (ts.isStringLiteral(a.initializer)) return a.initializer.text.split(/\s+/u);
  }
  return [];
}

/** Die Zeichenkette einer Konstante oben in `sf` — oder `null`. */
function konstanteIn(sf: TS.SourceFile, name: string): string | null {
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== name || d.initializer === undefined) continue;
      let i = d.initializer;
      while (ts.isAsExpression(i) || ts.isParenthesizedExpression(i) || ts.isSatisfiesExpression(i)) i = i.expression;
      return ts.isStringLiteral(i) || ts.isNoSubstitutionTemplateLiteral(i) ? i.text : null;
    }
  }
  return null;
}

interface Lauf {
  readonly lies: (datei: string) => string | null;
  readonly wurzel: string;
  readonly baeume: Map<string, TS.SourceFile | null>;
}

function holen(lauf: Lauf, datei: string): TS.SourceFile | null {
  if (lauf.baeume.has(datei)) return lauf.baeume.get(datei) ?? null;
  const q = lauf.lies(datei);
  const sf = q === null ? null : baum(datei, q);
  lauf.baeume.set(datei, sf);
  return sf;
}

/** Die Zeichenkette hinter einem Namen: in der Datei, sonst über ihren Import. */
function konstante(lauf: Lauf, sf: TS.SourceFile, name: string): string | null {
  const hier = konstanteIn(sf, name);
  if (hier !== null) return hier;
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || s.importClause?.namedBindings === undefined
        || !ts.isNamedImports(s.importClause.namedBindings) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    for (const e of s.importClause.namedBindings.elements) {
      if (e.name.text !== name) continue;
      const spez = s.moduleSpecifier.text;
      let basis: string;
      if (spez.startsWith('@/')) basis = join(lauf.wurzel, 'src', spez.slice(2));
      else if (spez.startsWith('.')) basis = resolve(dirname(sf.fileName), spez);
      else return null;
      basis = basis.replace(/\.js$/u, '');
      for (const k of [`${basis}.ts`, `${basis}.tsx`, join(basis, 'index.ts'), join(basis, 'index.tsx')]) {
        const ziel = holen(lauf, k);
        if (ziel !== null) return konstanteIn(ziel, (e.propertyName ?? e.name).text);
      }
      return null;
    }
  }
  return null;
}

/**
 * Der feste Inhalt eines Elements — oder `null`, wenn ein Teil erst zur
 * Laufzeit entsteht (dann ist es ein Wert, kein Quelltext).
 */
function fester(lauf: Lauf, el: TS.JsxElement, sf: TS.SourceFile): string | null {
  let text = '';
  for (const k of el.children) {
    if (ts.isJsxText(k)) text += k.text;
    else if (ts.isJsxExpression(k)) {
      const e = k.expression;
      if (e === undefined) continue;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) text += e.text;
      else if (ts.isIdentifier(e)) {
        const wert = konstante(lauf, sf, e.text);
        if (wert === null) return null;
        text += wert;
      } else return null;
    } else return null;
  }
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Jedes Code-Element des Baums mit festem Inhalt. `lies` liefert Dateien für
 * Konstanten über den Import.
 */
export function festerCode(
  dateien: readonly (readonly [string, string])[],
  lies: (datei: string) => string | null,
  wurzel: string,
): readonly CodeStelle[] {
  const quellen = new Map(dateien);
  const lauf: Lauf = { lies: (d) => quellen.get(d) ?? lies(d), wurzel, baeume: new Map() };
  const aus: CodeStelle[] = [];
  for (const [datei] of dateien) {
    const sf = holen(lauf, datei);
    if (sf === null) continue;
    const gehe = (k: TS.Node): void => {
      if (ts.isJsxElement(k)) {
        const tag = k.openingElement.tagName.getText(sf);
        const code = tag === 'code' || klassen(k.openingElement, sf).includes('font-mono');
        const inhalt = code ? fester(lauf, k, sf) : null;
        if (inhalt !== null && inhalt !== '') {
          aus.push({ datei, zeile: sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1, inhalt });
        }
      }
      ts.forEachChild(k, gehe);
    };
    gehe(sf);
  }
  return aus;
}
