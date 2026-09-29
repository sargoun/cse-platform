/**
 * Wo verschluckt JSX ein Leerzeichen? — gelesen am Syntaxbaum (V-252, D-743).
 *
 * **Die Regel, die den Fehler macht.** JSX wirft Leerraum, der einen
 * Zeilenumbruch enthält, am Rand eines Textstücks ganz weg — anders als HTML,
 * das ihn zu einem Leerzeichen zusammenzieht. Aus
 *
 *     dafür fehlt
 *     <Recht schluessel="crm.lesen" />
 *
 * wird „dafür fehlt„CRM lesen““, und aus
 *
 *     <strong>im Code</strong>
 *     (vorerst)
 *
 * wird „im Code(vorerst)“. Der Quelltext sieht richtig aus; falsch ist erst
 * der Schirm, und dort sieht es niemand, der den Quelltext liest.
 *
 * **Was hier gelesen wird.** Jede Kinderliste eines JSX-Elements, Stück für
 * Stück, mit dem, was jedes Stück an seinem linken und rechten Rand rendert:
 * ein bekanntes Zeichen (Text, Zeichenkette, der Satz von `<Recht>`), Text
 * unbekannten Inhalts (`{t.satz}`, `{name}`), Leerraum, nichts, oder etwas,
 * neben dem kein Leerzeichen gebraucht wird (ein Block, ein Zeilenumbruch,
 * ein Icon). Ein Ausdruck, der je nach Bedingung verschieden rendert
 * (`{a ? <b>x</b> : null}`), bringt jede Möglichkeit mit; einer, der gar
 * nichts rendern kann, lässt seine Nachbarn aneinanderstossen.
 *
 * **Gemeldet wird eine Fuge**, an der
 *   1. der verschluckte Leerraum einen Zeilenumbruch enthielt — was im
 *      Quelltext auf EINER Zeile aneinanderstösst (`<b>Mindest</b>stärke`,
 *      `{betrag}{' €'}`), ist so geschrieben und gewollt;
 *   2. links etwas endet, hinter dem im Satz ein Leerzeichen steht (Buchstabe,
 *      Ziffer, `, ; : . ! ? )`, ein schliessendes Anführungszeichen, ein
 *      freistehender Gedankenstrich) — nicht aber `( „ / -` oder ein Strich,
 *      der zwei Wörter verbindet;
 *   3. rechts etwas beginnt, vor dem eines steht (Buchstabe, Ziffer, `( „`,
 *      ein öffnendes Anführungszeichen, ein freistehender Strich) — nicht
 *      aber `) , . ; : ! ?` oder ein schliessendes Anführungszeichen.
 *
 * **Wo es nicht zählt.** In einer Flex- oder Grid-Hülle (`className` mit
 * `flex`/`grid`, ohne Bildschirmpräfix) ist jedes Kind ein eigener Kasten, und
 * Leerraum dazwischen rendert ohnehin nicht; ebenso in Listen- und
 * Tabellenhüllen (`ul`, `table`, `tr` …). Ein Element mit `block`, `flex`,
 * `grid` oder `table` in seiner `className` ist selbst ein Block.
 *
 * **Eigene Bausteine** (`<StatusPill>`, `<Betrag>` …) werden über ihre
 * Definition aufgelöst — in derselben Datei oder über den Import: was als
 * Wurzel ein Inline-Element rendert, ist Text unbekannten Inhalts; was einen
 * Block rendert, ein Block; ein Icon (`svg`) ist stumm. Was sich nicht
 * auflösen lässt, gilt als Block — lieber eine Fuge übersehen als einen
 * Baustein, der nichts mit Text zu tun hat, mit Leerzeichen zu umstellen.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type * as TS from 'typescript';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;

export interface LeerraumBefund {
  readonly datei: string;
  /** Die Zeile, auf der das linke Stück sichtbar endet — dort gehört `{' '}` hin. */
  readonly zeile: number;
  readonly links: string;
  readonly rechts: string;
}

/** Was ein Stück an einem Rand rendert. */
type Rand =
  | { readonly art: 'leer' }
  | { readonly art: 'raum' }
  | { readonly art: 'block' }
  | { readonly art: 'text' }
  /** `nachbar`: das Zeichen daneben, nach innen gelesen (`''` wenn keins). */
  | { readonly art: 'zeichen'; readonly z: string; readonly nachbar: string };

type Seite = 'anfang' | 'ende';

const LEER: Rand = { art: 'leer' };
const RAUM: Rand = { art: 'raum' };
const BLOCK: Rand = { art: 'block' };
const TEXT: Rand = { art: 'text' };

/** Inline-Elemente des HTML, deren Inhalt Text ist. */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'ins',
  'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time',
  'u', 'var',
]);
/** Hüllen, in denen Leerraum zwischen den Kindern nicht rendert. */
const OHNE_FLIESSTEXT = new Set([
  'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'select', 'optgroup',
  'datalist', 'svg', 'head', 'html',
]);
/** Kein Text, aber auch kein Block: daneben braucht es kein Leerzeichen. */
const STUMM = new Set([
  'svg', 'img', 'input', 'select', 'textarea', 'button', 'iframe', 'video', 'audio', 'canvas',
  'meter', 'progress', 'picture', 'object', 'embed', 'wbr',
]);
const BLOCK_KLASSEN = new Set(['block', 'flex', 'grid', 'table', 'flow-root', 'list-item']);
const HUELLEN_KLASSEN = new Set(['flex', 'grid', 'inline-flex', 'inline-grid']);

const BUCHSTABE_ODER_ZIFFER = /[\p{L}\p{N}]/u;
const LEERZEICHEN = /[ \t\r\n ]/u;

function istLeer(z: string): boolean {
  return z === '' || LEERZEICHEN.test(z);
}

/** Steht hinter diesem letzten Zeichen im Satz ein Leerzeichen? */
function brauchtDanach(r: Rand): boolean {
  if (r.art === 'text') return true;
  if (r.art !== 'zeichen') return false;
  const { z, nachbar } = r;
  if (BUCHSTABE_ODER_ZIFFER.test(z)) return true;
  if (',;:.!?)]}…%°²³'.includes(z)) return true;
  // Ein schliessendes Anführungszeichen hat links etwas stehen; ein öffnendes nicht.
  if ('“”‘’"\''.includes(z)) return z === '”' || z === '’' || !istLeer(nachbar);
  if ('(„‚[{/-‐'.includes(z)) return false;
  // Striche, Punkte, Pfeile, Zeichen: freistehend (links ein Leerzeichen) ist es
  // ein Satzzeichen mit Luft auf beiden Seiten; angehängt verbindet es.
  return istLeer(nachbar);
}

/** Steht vor diesem ersten Zeichen im Satz ein Leerzeichen? */
function brauchtDavor(r: Rand): boolean {
  if (r.art === 'text') return true;
  if (r.art !== 'zeichen') return false;
  const { z, nachbar } = r;
  if (BUCHSTABE_ODER_ZIFFER.test(z)) return true;
  // Ein Pfad (`/datenschutz/anfrage`) ist ein Wort; nur `-` hängt sich an („E-“ + „Mail“).
  if ('(„‚[{§/'.includes(z)) return true;
  if (',;:.!?)]}…%-‐'.includes(z)) return false;
  // Ein öffnendes Anführungszeichen hat rechts etwas stehen; ein schliessendes nicht.
  if ('“‘"\''.includes(z)) return !istLeer(nachbar) && !',;:.!?)'.includes(nachbar);
  if ('”’'.includes(z)) return false;
  return istLeer(nachbar);
}

/** Die Teile eines JSX-Textes: was vorne und hinten verschwindet, und was bleibt. */
interface TextTeile {
  /** Vorne Leerraum mit Zeilenumbruch (verschwindet), ohne (bleibt als Leerzeichen), oder keiner. */
  readonly vorne: 'umbruch' | 'raum' | 'nichts';
  readonly hinten: 'umbruch' | 'raum' | 'nichts';
  /** Der Inhalt ohne Rand; `''` bei reinem Leerraum. */
  readonly inhalt: string;
}

function textTeile(roh: string): TextTeile {
  const text = entschluessele(roh);
  const m = /^([ \t\r\n]*)([\s\S]*?)([ \t\r\n]*)$/u.exec(text);
  const vorn = m?.[1] ?? '';
  const inhalt = m?.[2] ?? '';
  const hint = m?.[3] ?? '';
  if (inhalt === '') {
    const umbruch = /[\r\n]/u.test(text);
    return { vorne: umbruch ? 'umbruch' : text === '' ? 'nichts' : 'raum', hinten: 'nichts', inhalt: '' };
  }
  const art = (s: string): TextTeile['vorne'] =>
    s === '' ? 'nichts' : /[\r\n]/u.test(s) ? 'umbruch' : 'raum';
  return { vorne: art(vorn), hinten: art(hint), inhalt };
}

const ENTITAETEN: Readonly<Record<string, string>> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', shy: '­',
  ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  sbquo: '‚', hellip: '…', middot: '·', thinsp: ' ', nbhy: '‑',
};

function entschluessele(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (ganz, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITAETEN[name.toLowerCase()] ?? ganz;
  });
}

function zeichenRand(s: string, seite: Seite): Rand {
  if (s === '') return LEER;
  const zeichen = [...s];
  const z = seite === 'anfang' ? zeichen[0]! : zeichen[zeichen.length - 1]!;
  if (LEERZEICHEN.test(z)) return RAUM;
  const nachbar = (seite === 'anfang' ? zeichen[1] : zeichen[zeichen.length - 2]) ?? '';
  return { art: 'zeichen', z, nachbar };
}

/** Die Klassen einer `className`, soweit sie im Quelltext stehen — ohne Bildschirmpräfix. */
function klassen(attrs: TS.JsxAttributes): ReadonlySet<string> {
  const aus = new Set<string>();
  for (const a of attrs.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== 'className' || a.initializer === undefined) continue;
    const texte: string[] = [];
    const sammle = (k: TS.Node): void => {
      if (ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k)) texte.push(k.text);
      else if (ts.isTemplateExpression(k)) {
        texte.push(k.head.text);
        for (const s of k.templateSpans) texte.push(s.literal.text);
      }
      ts.forEachChild(k, sammle);
    };
    sammle(a.initializer);
    for (const t of texte) for (const k of t.split(/\s+/u)) if (k !== '') aus.add(k);
  }
  return aus;
}

interface Kontext {
  readonly sf: TS.SourceFile;
  readonly bausteine: Bausteinverzeichnis;
}

/** Was ein eigener Baustein an seinen Rändern rendert: Text, Block oder nichts Lesbares. */
type Bausteinart = 'text' | 'block' | 'stumm';

/**
 * Löst `<Name …>` auf seine Definition auf — in der Datei selbst oder über ihren
 * Import — und liest, was die Wurzel seines JSX ist.
 */
export class Bausteinverzeichnis {
  private readonly baeume = new Map<string, TS.SourceFile>();
  private readonly arten = new Map<string, Bausteinart | 'unterwegs'>();

  constructor(
    private readonly lies: (datei: string) => string | null,
    private readonly wurzel: string,
  ) {}

  baum(datei: string): TS.SourceFile | null {
    const da = this.baeume.get(datei);
    if (da !== undefined) return da;
    const quelle = this.lies(datei);
    if (quelle === null) return null;
    const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true,
      datei.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    this.baeume.set(datei, sf);
    return sf;
  }

  /** Die Art des Bausteins `name`, wie ihn die Datei `sf` sieht. */
  art(sf: TS.SourceFile, name: string): Bausteinart {
    const ziel = this.finde(sf, name);
    if (ziel === null) return 'block';
    const schluessel = `${ziel.sf.fileName}#${ziel.name}`;
    const bekannt = this.arten.get(schluessel);
    if (bekannt === 'unterwegs') return 'block';
    if (bekannt !== undefined) return bekannt;
    this.arten.set(schluessel, 'unterwegs');
    const art = this.wurzelArt(ziel.sf, ziel.funktion);
    this.arten.set(schluessel, art);
    return art;
  }

  private finde(sf: TS.SourceFile, name: string):
    { sf: TS.SourceFile; name: string; funktion: TS.SignatureDeclaration } | null {
    const eigene = funktionIn(sf, name);
    if (eigene !== null) return { sf, name, funktion: eigene };
    for (const a of sf.statements) {
      if (!ts.isImportDeclaration(a) || a.importClause === undefined) continue;
      const bindung = a.importClause.namedBindings;
      let importiert: string | null = null;
      if (a.importClause.name?.text === name) importiert = 'default';
      if (bindung !== undefined && ts.isNamedImports(bindung)) {
        for (const e of bindung.elements) {
          if (e.name.text === name) importiert = e.propertyName?.text ?? e.name.text;
        }
      }
      if (importiert === null || !ts.isStringLiteral(a.moduleSpecifier)) continue;
      const datei = this.aufloesen(sf.fileName, a.moduleSpecifier.text);
      if (datei === null) return null;
      const ziel = this.baum(datei);
      if (ziel === null) return null;
      const f = importiert === 'default' ? standardFunktion(ziel) : funktionIn(ziel, importiert);
      return f === null ? null : { sf: ziel, name: importiert, funktion: f };
    }
    return null;
  }

  private aufloesen(von: string, spezifikator: string): string | null {
    let basis: string;
    if (spezifikator.startsWith('@/')) basis = join(this.wurzel, 'src', spezifikator.slice(2));
    else if (spezifikator.startsWith('.')) basis = resolve(dirname(von), spezifikator);
    else return null;
    basis = basis.replace(/\.js$/u, '');
    for (const kandidat of [`${basis}.tsx`, `${basis}.ts`, join(basis, 'index.tsx'), join(basis, 'index.ts')]) {
      if (this.baum(kandidat) !== null) return kandidat;
    }
    return null;
  }

  private wurzelArt(sf: TS.SourceFile, f: TS.SignatureDeclaration): Bausteinart {
    const wurzeln: TS.Expression[] = [];
    const koerper = (f as TS.FunctionLikeDeclaration).body;
    if (koerper === undefined) return 'block';
    if (!ts.isBlock(koerper)) wurzeln.push(koerper);
    else {
      const gehe = (k: TS.Node): void => {
        if (ts.isFunctionLike(k)) return;
        if (ts.isReturnStatement(k) && k.expression !== undefined) wurzeln.push(k.expression);
        ts.forEachChild(k, gehe);
      };
      ts.forEachChild(koerper, gehe);
    }
    const arten = new Set<Bausteinart>();
    const kontext: Kontext = { sf, bausteine: this };
    for (const w of wurzeln) {
      for (const r of [...rand(w, 'anfang', kontext), ...rand(w, 'ende', kontext)]) {
        if (r.art === 'block') arten.add('block');
        else if (r.art === 'text' || r.art === 'zeichen') arten.add('text');
      }
    }
    if (arten.has('text')) return 'text';
    if (arten.has('block')) return 'block';
    return 'stumm';
  }
}

function funktionIn(sf: TS.SourceFile, name: string): TS.SignatureDeclaration | null {
  for (const a of sf.statements) {
    if (ts.isFunctionDeclaration(a) && a.name?.text === name) return a;
    if (ts.isVariableStatement(a)) {
      for (const d of a.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== name || d.initializer === undefined) continue;
        const i = d.initializer;
        if (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) return i;
      }
    }
  }
  return null;
}

function standardFunktion(sf: TS.SourceFile): TS.SignatureDeclaration | null {
  for (const a of sf.statements) {
    if (ts.isFunctionDeclaration(a) && a.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return a;
  }
  return null;
}

function tagName(k: TS.JsxElement | TS.JsxSelfClosingElement): string {
  return (ts.isJsxElement(k) ? k.openingElement.tagName : k.tagName).getText();
}

function attribute(k: TS.JsxElement | TS.JsxSelfClosingElement): TS.JsxAttributes {
  return ts.isJsxElement(k) ? k.openingElement.attributes : k.attributes;
}

function vereinige(...listen: readonly (readonly Rand[])[]): readonly Rand[] {
  const aus: Rand[] = [];
  const gesehen = new Set<string>();
  for (const l of listen) {
    for (const r of l) {
      const s = JSON.stringify(r);
      if (!gesehen.has(s)) { gesehen.add(s); aus.push(r); }
    }
  }
  return aus;
}

/** Der Rand eines Elements. */
function elementRand(k: TS.JsxElement | TS.JsxSelfClosingElement, seite: Seite, kx: Kontext): readonly Rand[] {
  const name = tagName(k);
  const kinder = ts.isJsxElement(k) ? k.children : ([] as unknown as TS.NodeArray<TS.JsxChild>);
  if (name === 'Recht') {
    // „Kalkulationen lesen“ — der Satz steht in Anführungszeichen (Recht.tsx).
    return [seite === 'anfang' ? { art: 'zeichen', z: '„', nachbar: 'K' } : { art: 'zeichen', z: '“', nachbar: 'n' }];
  }
  const klasse = klassen(attribute(k));
  if ([...klasse].some((c) => BLOCK_KLASSEN.has(c))) return [BLOCK];
  if (name === 'br') return [BLOCK];
  if (name === 'Link' || /^[a-z]/u.test(name)) {
    // Ein Feld, ein Bild, ein Icon trägt keinen Text: daneben braucht es kein Leerzeichen.
    if (name !== 'Link' && (STUMM.has(name) || !INLINE.has(name))) return [BLOCK];
    const r = kinderRand(kinder, seite, kx);
    return r.length === 0 ? [LEER] : r;
  }
  if (name === 'Fragment' || name === 'React.Fragment') return kinderRand(kinder, seite, kx);
  const art = /^[A-Z][\w]*$/u.test(name) ? kx.bausteine.art(kx.sf, name) : 'block';
  if (art === 'text') {
    // Mit eigenen Kindern: deren Rand, sonst Text unbekannten Inhalts.
    const r = kinder.length > 0 ? kinderRand(kinder, seite, kx) : [];
    return r.length > 0 && r.every((x) => x.art !== 'leer') ? r : [TEXT];
  }
  return [BLOCK];
}

/** Der Rand einer Kinderliste von einer Seite her; ein Kind, das leer sein kann, lässt den nächsten durch. */
function kinderRand(kinder: readonly TS.JsxChild[], seite: Seite, kx: Kontext): readonly Rand[] {
  const folge = seite === 'anfang' ? kinder : [...kinder].reverse();
  let aus: readonly Rand[] = [];
  for (const kind of folge) {
    let r: readonly Rand[];
    if (ts.isJsxText(kind)) {
      const t = textTeile(kind.text);
      if (t.inhalt === '') {
        if (t.vorne === 'raum') r = [RAUM];
        else continue;
      } else {
        const rand = seite === 'anfang' ? t.vorne : t.hinten;
        r = rand === 'raum' ? [RAUM] : [zeichenRand(t.inhalt, seite)];
      }
    } else {
      r = kindRand(kind, seite, kx);
    }
    const ohneLeer = r.filter((x) => x.art !== 'leer');
    aus = vereinige(aus, ohneLeer);
    if (ohneLeer.length === r.length) return aus;
  }
  return vereinige(aus, [LEER]);
}

function kindRand(k: TS.JsxChild, seite: Seite, kx: Kontext): readonly Rand[] {
  if (ts.isJsxText(k)) {
    const t = textTeile(k.text);
    if (t.inhalt === '') return t.vorne === 'raum' ? [RAUM] : [LEER];
    const r = seite === 'anfang' ? t.vorne : t.hinten;
    return r === 'raum' ? [RAUM] : [zeichenRand(t.inhalt, seite)];
  }
  if (ts.isJsxExpression(k)) return k.expression === undefined ? [LEER] : rand(k.expression, seite, kx);
  if (ts.isJsxFragment(k)) {
    const r = kinderRand(k.children, seite, kx);
    return r.length === 0 ? [LEER] : r;
  }
  if (ts.isJsxElement(k) || ts.isJsxSelfClosingElement(k)) return elementRand(k, seite, kx);
  return [BLOCK];
}

/** Der Rand eines Ausdrucks in `{…}`. */
function rand(e: TS.Expression, seite: Seite, kx: Kontext): readonly Rand[] {
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)
      || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) {
    return rand(e.expression, seite, kx);
  }
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [zeichenRand(e.text, seite)];
  if (ts.isNumericLiteral(e) || ts.isBigIntLiteral(e)) return [zeichenRand(e.text, seite)];
  if (ts.isTemplateExpression(e)) {
    const kante = seite === 'anfang' ? e.head.text : e.templateSpans[e.templateSpans.length - 1]?.literal.text ?? '';
    return kante === '' ? [TEXT] : [zeichenRand(kante, seite)];
  }
  if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.TrueKeyword
      || e.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(e) && e.text === 'undefined')) {
    return [LEER];
  }
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return kindRand(e, seite, kx);
  if (ts.isConditionalExpression(e)) return vereinige(rand(e.whenTrue, seite, kx), rand(e.whenFalse, seite, kx));
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return vereinige([LEER], rand(e.right, seite, kx));
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return vereinige(rand(e.left, seite, kx), rand(e.right, seite, kx));
    }
    if (op === ts.SyntaxKind.PlusToken) return rand(seite === 'anfang' ? e.left : e.right, seite, kx);
    return [TEXT];
  }
  if (ts.isCallExpression(e)) {
    const c = e.expression;
    if (ts.isPropertyAccessExpression(c) && (c.name.text === 'map' || c.name.text === 'flatMap')) {
      const f = e.arguments[0];
      if (f !== undefined && (ts.isArrowFunction(f) || ts.isFunctionExpression(f))) {
        const rueck: TS.Expression[] = [];
        if (!ts.isBlock(f.body)) rueck.push(f.body);
        else {
          const gehe = (k: TS.Node): void => {
            if (ts.isFunctionLike(k)) return;
            if (ts.isReturnStatement(k) && k.expression !== undefined) rueck.push(k.expression);
            ts.forEachChild(k, gehe);
          };
          ts.forEachChild(f.body, gehe);
        }
        // Eine leere Liste rendert nichts.
        return vereinige([LEER], ...rueck.map((r) => rand(r, seite, kx)));
      }
      return [BLOCK];
    }
    return [TEXT];
  }
  if (ts.isIdentifier(e)) {
    if (e.text === 'children') return [BLOCK];
    const init = lokaleInitialisierung(e);
    if (init !== null && (ts.isJsxElement(init) || ts.isJsxSelfClosingElement(init) || ts.isJsxFragment(init)
        || ts.isConditionalExpression(init) || ts.isParenthesizedExpression(init))) {
      return rand(init, seite, kx);
    }
    return [TEXT];
  }
  if (ts.isPropertyAccessExpression(e) && e.name.text === 'children') return [BLOCK];
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return [BLOCK];
  return [TEXT];
}

/** `const x = …` im Gültigkeitsbereich von `name` — für `{knopf}`, das JSX hält. */
function lokaleInitialisierung(name: TS.Identifier): TS.Expression | null {
  for (let k: TS.Node | undefined = name.parent; k !== undefined; k = k.parent) {
    const anweisungen = ts.isSourceFile(k) || ts.isBlock(k) ? k.statements : null;
    if (anweisungen === null) continue;
    for (const a of anweisungen) {
      if (!ts.isVariableStatement(a)) continue;
      for (const d of a.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name.text) return d.initializer ?? null;
      }
    }
  }
  return null;
}

/** Ein Stück der Kinderliste mit seinen Rändern. */
interface Stueck {
  readonly knoten: TS.JsxChild;
  readonly anfang: readonly Rand[];
  readonly ende: readonly Rand[];
}

interface Offen {
  readonly rand: Rand;
  readonly knoten: TS.JsxChild;
  /** Liegt zwischen diesem Rand und hier ein verschluckter Zeilenumbruch? */
  readonly umbruch: boolean;
}

/** Die Zeile, auf der ein Stück sichtbar endet — bei Text vor seinem Leerraum. */
function endzeile(k: TS.JsxChild, sf: TS.SourceFile): number {
  const ende = ts.isJsxText(k) ? k.pos + k.text.replace(/[ \t\r\n]+$/u, '').length : k.getEnd();
  return sf.getLineAndCharacterOfPosition(Math.max(ende - 1, k.pos)).line + 1;
}

function kurz(sf: TS.SourceFile, k: TS.Node, seite: Seite): string {
  const text = k.getText(sf).replace(/\s+/gu, ' ').trim();
  return seite === 'ende' ? text.slice(-60) : text.slice(0, 60);
}

function pruefeKinder(eltern: TS.JsxElement | TS.JsxFragment, kx: Kontext, befunde: LeerraumBefund[]): void {
  if (ts.isJsxElement(eltern)) {
    const name = tagName(eltern);
    if (OHNE_FLIESSTEXT.has(name)) return;
    if ([...klassen(eltern.openingElement.attributes)].some((c) => HUELLEN_KLASSEN.has(c))) return;
  }
  let offen: Offen[] = [];
  const pruefe = (rechts: readonly Rand[], knoten: TS.JsxChild, umbruchDavor: boolean): void => {
    for (const l of offen) {
      if (!l.umbruch && !umbruchDavor) continue;
      if (!ts.isJsxText(l.knoten) && !ts.isJsxText(knoten)) continue;
      if (!brauchtDanach(l.rand)) continue;
      if (!rechts.some(brauchtDavor)) continue;
      const zeile = endzeile(l.knoten, kx.sf);
      const eintrag: LeerraumBefund = {
        datei: kx.sf.fileName, zeile, links: kurz(kx.sf, l.knoten, 'ende'), rechts: kurz(kx.sf, knoten, 'anfang'),
      };
      if (!befunde.some((b) => b.datei === eintrag.datei && b.zeile === eintrag.zeile && b.rechts === eintrag.rechts)) {
        befunde.push(eintrag);
      }
    }
  };

  for (const kind of eltern.children) {
    if (ts.isJsxText(kind)) {
      const t = textTeile(kind.text);
      if (t.inhalt === '') {
        if (t.vorne === 'umbruch') offen = offen.map((o) => ({ ...o, umbruch: true }));
        else if (t.vorne === 'raum') offen = [];
        continue;
      }
      if (t.vorne === 'raum') offen = [];
      else pruefe([zeichenRand(t.inhalt, 'anfang')], kind, t.vorne === 'umbruch');
      offen = t.hinten === 'raum' ? []
        : [{ rand: zeichenRand(t.inhalt, 'ende'), knoten: kind, umbruch: t.hinten === 'umbruch' }];
      continue;
    }
    const s: Stueck = {
      knoten: kind,
      anfang: kindRand(kind, 'anfang', kx),
      ende: kindRand(kind, 'ende', kx),
    };
    // Ein Stück, das nichts rendern kann, lässt die offenen Ränder davor durch.
    const leer = s.anfang.some((r) => r.art === 'leer');
    pruefe(s.anfang.filter((r) => r.art !== 'leer'), kind, false);
    const neu: Offen[] = s.ende
      .filter((r) => r.art !== 'leer' && r.art !== 'raum')
      .map((r) => ({ rand: r, knoten: kind, umbruch: false }));
    const raum = s.ende.some((r) => r.art === 'raum');
    offen = [...neu, ...(leer ? offen : [])];
    if (raum && !leer) offen = neu;
  }
}

/**
 * Prüft einen Quellbaum (`[datei, quelltext]`) und gibt jede Fuge zurück, an
 * der ein Zeilenumbruch ein Leerzeichen verschluckt, das im Satz stehen muss.
 * `lies` liefert weitere Dateien für die Auflösung eigener Bausteine.
 */
export function pruefeLeerraum(
  dateien: readonly (readonly [string, string])[],
  lies: (datei: string) => string | null,
  wurzel: string,
): readonly LeerraumBefund[] {
  const quellen = new Map(dateien);
  const bausteine = new Bausteinverzeichnis((d) => quellen.get(d) ?? lies(d), wurzel);
  const befunde: LeerraumBefund[] = [];
  for (const [datei] of dateien) {
    const sf = bausteine.baum(datei);
    if (sf === null) continue;
    const kx: Kontext = { sf, bausteine };
    const gehe = (k: TS.Node): void => {
      if (ts.isJsxElement(k) || ts.isJsxFragment(k)) pruefeKinder(k, kx, befunde);
      ts.forEachChild(k, gehe);
    };
    gehe(sf);
  }
  return befunde;
}
