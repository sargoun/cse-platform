/**
 * Welche Datenbanknamen stehen als Code auf dem Schirm? — gelesen am
 * Syntaxbaum (V-251, D-742).
 *
 * **Der Befund.** Das Kontaktblatt und die Rechtsgrundlagen-Seite erklärten
 * ihre Regeln mit den Namen der Datenbank: „der Auslöser
 * `kern.erzwinge_widerspruch`", „der CHECK
 * `ansprechpartner_kanaele_nur_bei_einwilligung`", „aus
 * `app.darf_kontaktiert_werden`". Für die Vertriebskraft, die das liest, ist
 * das Quelltext — sie erfährt, DASS etwas gilt, aber nicht, was es für sie
 * heisst.
 *
 * **Was hier als Datenbankname gilt**, wenn es als ganzer Inhalt eines
 * `<code>` (oder eines `font-mono`-Elements) dasteht — Text, Zeichenkette
 * oder eine Konstante derselben Datei:
 *  - ein Name mit Unterstrich (`lead_aktivitaet_hat_bezug`, `geschehen_am`);
 *  - `schema.name` oder `tabelle.spalte` (`app.darf_kontaktiert_werden()`,
 *    `raum.bemerkung`) — ausser einem Dateinamen (`index.xml`) und einem
 *    Rechteschlüssel (den prüft `recht-im-satz.test.ts`);
 *  - der Name einer Tabelle aus `drizzle/` (`werbewiderspruch`, `seite`).
 *
 * Ein Wert aus der Anfrage (`<code>{b.dateiSha256}</code>`) ist Anzeige,
 * kein Name, und wird nicht gezählt.
 */
import { createRequire } from 'node:module';
import type * as TS from 'typescript';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;

export interface CodeName {
  readonly datei: string;
  readonly zeile: number;
  readonly name: string;
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

function klassen(e: TS.JsxOpeningElement, sf: TS.SourceFile): readonly string[] {
  for (const a of e.attributes.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== 'className' || a.initializer === undefined) continue;
    if (ts.isStringLiteral(a.initializer)) return a.initializer.text.split(/\s+/u);
  }
  return [];
}

/** Die Zeichenkette einer Konstante derselben Datei — oder `null`. */
function konstante(sf: TS.SourceFile, name: string): string | null {
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== name || d.initializer === undefined) continue;
      const i = d.initializer;
      return ts.isStringLiteral(i) || ts.isNoSubstitutionTemplateLiteral(i) ? i.text : null;
    }
  }
  return null;
}

/**
 * Der feste Inhalt eines Elements — oder `null`, wenn ein Teil erst zur
 * Laufzeit entsteht (dann ist es ein Wert, kein Name).
 */
function fester(el: TS.JsxElement, sf: TS.SourceFile): string | null {
  let text = '';
  for (const k of el.children) {
    if (ts.isJsxText(k)) text += k.text;
    else if (ts.isJsxExpression(k)) {
      const e = k.expression;
      if (e === undefined) continue;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) text += e.text;
      else if (ts.isIdentifier(e)) {
        const wert = konstante(sf, e.text);
        if (wert === null) return null;
        text += wert;
      } else return null;
    } else return null;
  }
  return text;
}

/** Jedes Code-Element des Baums, das einen Datenbanknamen zeigt. */
export function datenbanknamenInCode(
  dateien: readonly (readonly [string, string])[],
  tabellen: ReadonlySet<string>,
  schluessel: ReadonlySet<string>,
): readonly CodeName[] {
  const aus: CodeName[] = [];
  for (const [datei, quelle] of dateien) {
    const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const gehe = (k: TS.Node): void => {
      if (ts.isJsxElement(k)) {
        const tag = k.openingElement.tagName.getText(sf);
        const code = tag === 'code' || klassen(k.openingElement, sf).includes('font-mono');
        const inhalt = code ? fester(k, sf) : null;
        if (inhalt !== null && istDatenbankname(inhalt, tabellen, schluessel)) {
          aus.push({
            datei, zeile: sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1,
            name: inhalt.trim(),
          });
        }
      }
      ts.forEachChild(k, gehe);
    };
    gehe(sf);
  }
  return aus;
}
