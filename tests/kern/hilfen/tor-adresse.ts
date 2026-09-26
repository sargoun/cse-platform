/**
 * Welche Adresse bekommt ein Tor? — gelesen am Syntaxbaum (V-248, V-255, D-747).
 *
 * **Wozu.** Jedes Portaltor baut aus dem Pfad, den die Seite ihm gibt, mehr
 * als eine Entscheidung: den Rückweg (`rueckwegFuer`, D-613), das
 * `zurueck` des Sprachumschalters, das Sprungziel des Wechselblatts und das
 * `weiter=` nach der Zwei-Faktor-Anmeldung. Gibt eine Seite ihm das MUSTER
 * ihrer Route (`…/agenten/[agent]/aufgaben/[id]`) statt der aufgerufenen
 * Adresse, landet das Muster wörtlich in all diesen Verweisen (V-248).
 * `rueckwegFuer` blendet seither den Pfeil für ein Muster aus — still. Die
 * anderen drei bekämen es weiter. Diese Prüfung ist deshalb die erste Linie,
 * und sie muss JEDEN Weg sehen, auf dem ein Pfad ins Tor kommt.
 *
 * **Was sie liest.** Jeden Aufruf der fünf Eingänge (`TORE`) und sein erstes
 * Argument, aufgelöst bis zu den Zeichenketten, aus denen es besteht:
 *
 *  - ein Literal oder eine Vorlage (`\`/portal/${mandant}/…\``) — geprüft
 *    werden ihre festen Teile;
 *  - ein Name — über seine Deklaration im Gültigkeitsbereich, auch durch
 *    `?:` und `+` hindurch;
 *  - ein Parameter eines der fünf Tore selbst — die Weitergabe INNERHALB der
 *    Tore; geprüft wird an deren Aufrufern;
 *  - ein Parameter einer anderen Funktion (ein „Weiterreicher" wie
 *    `RecruitingSeite({ unterpfad })`) — geprüft wird an JEDEM Aufruf und
 *    jedem JSX-Element dieser Funktion, auch wenn der Parameter nur in
 *    `${…}` eingesetzt wird.
 *
 * **Eingesetzt ist nicht dasselbe wie ganz.** Was in `${…}` steht, ist
 * meistens ein Wert — die Kennung, der Slug —, und ein Wert, den erst die
 * Anfrage bringt, lässt sich nicht auflösen und muss es auch nicht. Dort
 * zählt nur, ob irgendwo ein Literal mit `[…]` hineinfliesst. Das GANZE
 * erste Argument dagegen muss sich auflösen lassen: ein Funktionsaufruf,
 * eine Eigenschaft oder eine Schleifenvariable an dieser Stelle heisst
 * **unprüfbar** und wird gemeldet, nicht übergangen — eine Wache, die
 * schweigt, wo sie nichts sieht, sieht beim nächsten Umbau gar nichts mehr.
 */
import { createRequire } from 'node:module';
import type * as TS from 'typescript';

const ts = createRequire(import.meta.url)('typescript') as typeof TS;

/** Die fünf Eingänge, die einen Seitenpfad annehmen (`slugTor` nimmt einen Zugang). */
export const TORE: ReadonlySet<string> = new Set([
  'portalZugang', 'mandantTor', 'meinPortal', 'kundePortal', 'gruppenTor',
]);

/** Ein Segment `[…]` — `${id}` ist die Adresse, `[id]` das Muster. */
const MUSTER_SEGMENT = /(?:^|\/)\[[^\]/]*\]/u;

export interface Befund {
  readonly datei: string;
  readonly zeile: number;
  readonly art: 'muster' | 'unpruefbar';
  readonly text: string;
}

type Stelle =
  | { readonly art: 'position'; readonly index: number }
  | { readonly art: 'eigenschaft'; readonly name: string };

interface Weiterreicher {
  readonly funktion: string;
  readonly stelle: Stelle;
  /** Kam der Parameter als `${…}` herein? Dann ist ein unbekannter Wert ein Wert. */
  readonly einsetzung: boolean;
}

type Deklaration =
  | { readonly art: 'variable'; readonly init: TS.Expression | undefined; readonly knoten: TS.Node }
  | { readonly art: 'parameter'; readonly funktion: string | null; readonly stelle: Stelle }
  | { readonly art: 'sonst' };

/** Der Name einer Funktion — Deklaration, `const X = () => …` oder Methode. */
function funktionsName(f: TS.SignatureDeclaration): string | null {
  if ((ts.isFunctionDeclaration(f) || ts.isMethodDeclaration(f)) && f.name !== undefined
      && ts.isIdentifier(f.name)) return f.name.text;
  const eltern = f.parent;
  if ((ts.isArrowFunction(f) || ts.isFunctionExpression(f))
      && eltern !== undefined && ts.isVariableDeclaration(eltern) && ts.isIdentifier(eltern.name)) {
    return eltern.name.text;
  }
  return null;
}

/** Bindet dieses Muster den Namen? `true` direkt, das Element bei einer Zerlegung. */
function bindetNamen(muster: TS.BindingName, name: string): TS.BindingElement | true | null {
  if (ts.isIdentifier(muster)) return muster.text === name ? true : null;
  for (const e of muster.elements) {
    if (ts.isOmittedExpression(e)) continue;
    const t = bindetNamen(e.name, name);
    if (t === true) return e;
    if (t !== null) return t;
  }
  return null;
}

/** Wo ist `name` an dieser Stelle deklariert? Von innen nach aussen. */
function deklaration(stelle: TS.Node, name: string): Deklaration {
  for (let k: TS.Node | undefined = stelle.parent; k !== undefined; k = k.parent) {
    if (ts.isFunctionLike(k)) {
      const f = k as TS.SignatureDeclaration;
      for (const [index, p] of f.parameters.entries()) {
        const t = bindetNamen(p.name, name);
        if (t === null) continue;
        const funktion = funktionsName(f);
        if (t === true) return { art: 'parameter', funktion, stelle: { art: 'position', index } };
        const eigenschaft = t.propertyName !== undefined && ts.isIdentifier(t.propertyName)
          ? t.propertyName.text : name;
        return { art: 'parameter', funktion, stelle: { art: 'eigenschaft', name: eigenschaft } };
      }
    }
    const anweisungen = ts.isSourceFile(k) || ts.isBlock(k) || ts.isModuleBlock(k)
      || ts.isCaseClause(k) || ts.isDefaultClause(k) ? k.statements : null;
    if (anweisungen === null) continue;
    for (const a of anweisungen) {
      if (!ts.isVariableStatement(a)) continue;
      for (const d of a.declarationList.declarations) {
        const t = bindetNamen(d.name, name);
        if (t === true) return { art: 'variable', init: d.initializer, knoten: d };
        if (t !== null) return { art: 'sonst' };
      }
    }
  }
  return { art: 'sonst' };
}

interface Lauf {
  readonly weiterreicher: Map<string, Weiterreicher>;
  readonly gesehen: Set<TS.Node>;
}

/**
 * Die festen Zeichenketten, aus denen ein Ausdruck besteht — oder `null`,
 * wenn er sich nicht auflösen lässt (nur im GANZEN Argument; eingesetzt ist
 * Unbekanntes ein Wert, siehe Dateikopf).
 */
function feste(e: TS.Expression, lauf: Lauf, einsetzung: boolean): readonly string[] | null {
  const unbekannt = einsetzung ? [] : null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isTemplateExpression(e)) {
    const teile: string[] = [e.head.text];
    for (const s of e.templateSpans) {
      teile.push(s.literal.text);
      const innen = feste(s.expression, lauf, true);
      if (innen === null) return null;
      teile.push(...innen);
    }
    return teile;
  }
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)
      || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) {
    return feste(e.expression, lauf, einsetzung);
  }
  if (ts.isConditionalExpression(e)) {
    const a = feste(e.whenTrue, lauf, einsetzung);
    const b = feste(e.whenFalse, lauf, einsetzung);
    return a === null || b === null ? null : [...a, ...b];
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = feste(e.left, lauf, einsetzung);
    const b = feste(e.right, lauf, einsetzung);
    return a === null || b === null ? null : [...a, ...b];
  }
  if (!ts.isIdentifier(e)) return unbekannt;

  const d = deklaration(e, e.text);
  if (d.art === 'variable') {
    if (d.init === undefined) return unbekannt;
    if (lauf.gesehen.has(d.knoten)) return [];
    lauf.gesehen.add(d.knoten);
    return feste(d.init, lauf, einsetzung);
  }
  if (d.art === 'parameter') {
    // Die Weitergabe innerhalb der Tore: geprüft wird an deren Aufrufern.
    if (d.funktion !== null && TORE.has(d.funktion) && !einsetzung) return [];
    if (d.funktion === null) return unbekannt;
    const w: Weiterreicher = { funktion: d.funktion, stelle: d.stelle, einsetzung };
    lauf.weiterreicher.set(JSON.stringify(w), w);
    return [];
  }
  return unbekannt;
}

function baum(datei: string, quelle: string): TS.SourceFile {
  return ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true,
    datei.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function besuche(knoten: TS.Node, fn: (k: TS.Node) => void): void {
  fn(knoten);
  ts.forEachChild(knoten, (k) => besuche(k, fn));
}

function melde(
  befunde: Befund[], sf: TS.SourceFile, stelle: TS.Node, teile: readonly string[] | null,
): void {
  const zeile = sf.getLineAndCharacterOfPosition(stelle.getStart(sf)).line + 1;
  const text = stelle.getText(sf).replace(/\s+/gu, ' ').slice(0, 160);
  if (teile === null) befunde.push({ datei: sf.fileName, zeile, art: 'unpruefbar', text });
  else if (teile.some((t) => MUSTER_SEGMENT.test(t))) {
    befunde.push({ datei: sf.fileName, zeile, art: 'muster', text });
  }
}

/** Die Aufrufe und JSX-Elemente eines Weiterreichers, jeder mit seinem Wert an der Stelle. */
function pruefeAufrufer(
  befunde: Befund[], sf: TS.SourceFile, k: TS.Node, w: Weiterreicher, lauf: Lauf,
): void {
  const pruefe = (stelle: TS.Node, wert: TS.Expression | undefined): void => {
    if (wert === undefined) {
      if (!w.einsetzung) melde(befunde, sf, stelle, null);
      return;
    }
    melde(befunde, sf, stelle, feste(wert, lauf, w.einsetzung));
  };

  if (ts.isCallExpression(k)) {
    if (w.stelle.art === 'position') {
      pruefe(k, k.arguments[w.stelle.index]);
      return;
    }
    const obj = k.arguments[0];
    if (obj === undefined || !ts.isObjectLiteralExpression(obj)) {
      pruefe(k, undefined);
      return;
    }
    for (const p of obj.properties) {
      if (p.name === undefined || !ts.isIdentifier(p.name) || p.name.text !== w.stelle.name) continue;
      if (ts.isPropertyAssignment(p)) pruefe(p, p.initializer);
      else if (ts.isShorthandPropertyAssignment(p)) pruefe(p, p.name);
      else pruefe(p, undefined);
    }
    return;
  }

  if (ts.isJsxOpeningElement(k) || ts.isJsxSelfClosingElement(k)) {
    if (w.stelle.art !== 'eigenschaft') { pruefe(k, undefined); return; }
    for (const a of k.attributes.properties) {
      if (ts.isJsxSpreadAttribute(a)) { pruefe(a, undefined); continue; }
      if (!ts.isIdentifier(a.name) || a.name.text !== w.stelle.name) continue;
      const init = a.initializer;
      if (init !== undefined && ts.isStringLiteral(init)) pruefe(a, init);
      else if (init !== undefined && ts.isJsxExpression(init)) pruefe(a, init.expression);
      else pruefe(a, undefined);
    }
  }
}

/**
 * Prüft einen Quellbaum (`[datei, quelltext]`) und gibt jeden Aufruf zurück,
 * der ein Muster ins Tor gibt oder dessen Adresse sich nicht auflösen lässt.
 */
export function pruefeTorAdressen(
  dateien: readonly (readonly [string, string])[],
): { readonly befunde: readonly Befund[]; readonly aufrufe: number } {
  const befunde: Befund[] = [];
  const lauf: Lauf = { weiterreicher: new Map(), gesehen: new Set() };
  const baeume = dateien.map(([datei, quelle]) => baum(datei, quelle));
  let aufrufe = 0;

  for (const sf of baeume) {
    besuche(sf, (k) => {
      if (!ts.isCallExpression(k) || !ts.isIdentifier(k.expression)) return;
      if (!TORE.has(k.expression.text)) return;
      const arg = k.arguments[0];
      if (arg === undefined) return;
      aufrufe += 1;
      melde(befunde, sf, k, feste(arg, lauf, false));
    });
  }

  /*
   * Die Weiterreicher, Runde um Runde, bis keiner mehr dazukommt: der Wert an
   * einem Aufrufer kann selbst wieder ein Parameter sein.
   */
  const erledigt = new Set<string>();
  for (let runde = 0; runde < 8; runde += 1) {
    const offen = [...lauf.weiterreicher.entries()].filter(([s]) => !erledigt.has(s));
    if (offen.length === 0) break;
    const nachName = new Map<string, Weiterreicher[]>();
    for (const [schluessel, w] of offen) {
      erledigt.add(schluessel);
      nachName.set(w.funktion, [...(nachName.get(w.funktion) ?? []), w]);
    }
    for (const sf of baeume) {
      besuche(sf, (k) => {
        const name = ts.isCallExpression(k) && ts.isIdentifier(k.expression) ? k.expression.text
          : (ts.isJsxOpeningElement(k) || ts.isJsxSelfClosingElement(k))
            && ts.isIdentifier(k.tagName) ? k.tagName.text : null;
        if (name === null) return;
        for (const w of nachName.get(name) ?? []) pruefeAufrufer(befunde, sf, k, w, lauf);
      });
    }
  }
  return { befunde, aufrufe };
}
