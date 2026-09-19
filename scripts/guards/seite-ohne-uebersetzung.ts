/**
 * Die Sperrklinke gegen die deutsche Verdrahtung.
 *
 * **Der Befund.** Der Mandant stellte die Sprache auf Englisch: die
 * Seitenleiste wurde englisch, der Seiteninhalt blieb deutsch. Ursache ist
 * nicht eine fehlende Uebersetzung, sondern eine Bauart — 359 Seiten unter
 * `src/app/portal/` tragen ihre sichtbaren Woerter als Zeichenketten IM
 * Seitenrumpf. Ein `sprache`-Wert kann daran nichts aendern.
 *
 * **Warum diese Wache VOR der Umstellung kommt.** Die Umstellung dauert
 * laenger als eine Sitzung. Ohne Sperrklinke waechst der Rueckstand waehrend
 * der Arbeit weiter, und er wird nie kleiner. Mit ihr ist ab heute keine NEUE
 * Seite mehr auf Deutsch festnagelbar — auch wenn die 359 noch Monate
 * brauchen.
 *
 * **Die Ausnahmeliste darf schrumpfen, nie wachsen.** Beides wird gemeldet:
 * eine Seite mit fester Zeichenkette, die NICHT in der Liste steht (eine neue
 * Verdrahtung), und ein Eintrag IN der Liste, der keine feste Zeichenkette
 * mehr hat (eine erledigte Seite, die noch drinsteht). Der zweite Fall ist
 * der wichtigere: ohne ihn bleibt die Liste stehen, nachdem die Arbeit getan
 * ist, und die Wache verliert ihre Schaerfe.
 *
 * **Geprueft wird der Syntaxbaum, nicht der Text.** Eine Suche mit regulaeren
 * Ausdruecken kann `className="mt-s2 …"` nicht von `titel="Zahlungen"`
 * unterscheiden und haelt `Record<string, string>` fuer JSX. Der Compiler
 * unterscheidet beides genau: `JsxText` ist sichtbarer Text, und ein
 * `JsxAttribute` mit Zeichenketten-Wert ist eine Beschriftung, wenn sein Name
 * eine ist.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as TS from 'typescript';

/**
 * **Der Compiler wird erst geladen, wenn es etwas zu lesen gibt.**
 *
 * `wachen.test.ts` laesst die Wachen in einem Wegwerf-Baum laufen, der kein
 * `node_modules` hat. Ein `import ts from 'typescript'` am Dateikopf wird beim
 * LADEN ausgewertet — und riss damit den ganzen Wachenlauf mit, noch bevor die
 * erste Wache lief: 36 von 37 Pruefstuecken fielen mit „Cannot find module
 * 'typescript'" statt mit dem Befund, den sie pruefen sollten. Dort gibt es
 * Drei Pruefstuecke schreiben aber `.tsx` unter `src/components/`, und dann
 * WIRD geladen. Deshalb ist das Fehlen des Compilers hier kein Absturz,
 * sondern eine Auskunft: `null`. Wer sie bekommt, entscheidet selbst — der
 * Wegwerf-Baum ueberspringt die Wache, der ECHTE Baum meldet sie als Verstoss
 * (`wacheSeiteOhneUebersetzung`). Ein stilles Ueberspringen im echten Baum
 * waere der teure Fall: „alle sauber", ohne eine Zeile gelesen zu haben.
 */
let compiler: typeof TS | null = null;
let gesucht = false;
export function compilerOderNichts(): typeof TS | null {
  if (!gesucht) {
    gesucht = true;
    try {
      compiler = createRequire(import.meta.url)('typescript') as typeof TS;
    } catch {
      compiler = null;
    }
  }
  return compiler;
}

/**
 * Attribut- und Feldnamen, deren Zeichenketten-Wert auf dem Bildschirm
 * LANDET.
 *
 * `className`, `href`, `name`, `id`, `type`, `action`, `method` stehen
 * bewusst nicht darin: sie sind Technik und werden nie uebersetzt. `alt` und
 * `aria-label` stehen darin, weil eine Sprachausgabe sie vorliest — eine
 * deutsche Bildbeschreibung in einer englischen Oberflaeche ist derselbe
 * Fehler wie eine deutsche Ueberschrift, nur unsichtbar (WCAG 1.1.1).
 */
const SICHTBARE_NAMEN: ReadonlySet<string> = new Set([
  'titel', 'wurzelTitel', 'untertitel', 'kopf', 'beschriftung', 'beschreibung',
  'label', 'aria-label', 'aria-description', 'alt', 'placeholder',
  'hinweis', 'legende', 'text', 'leerText', 'knopfText', 'titelText',
  'ueberschrift', 'meldung', 'fehler', 'erklaerung', 'zusammenfassung',
  'aktuell', 'zielTitel', 'frage', 'antwort', 'warnung', 'summary',
]);

/**
 * Woerter, die in beiden Sprachen gleich lauten — Normen, Dateiformate,
 * Gesetze und Abkuerzungen.
 *
 * Sie sind keine Uebersetzungsluecke: `IBAN` heisst auf Englisch `IBAN`. Ein
 * Eintrag hier ist eine Behauptung ueber die Sprache, nicht ueber die
 * Bequemlichkeit — deshalb ist die Liste kurz und enthaelt kein einziges
 * gewoehnliches Wort.
 */
const SPRACHNEUTRAL: ReadonlySet<string> = new Set([
  'IBAN', 'BIC', 'SEPA', 'PDF', 'CSV', 'XML', 'JSON', 'HTML', 'CSS', 'SQL',
  'API', 'URL', 'UUID', 'ZIP', 'QR', 'PIN', 'TOTP', 'SHA256', 'UTC', 'GPS',
  'ZUGFeRD', 'XRechnung', 'DATEV', 'GoBD', 'UStG', 'VOB', 'GewO', 'ArbZG',
  'DSGVO', 'GDPR', 'TMG', 'BFSG', 'WCAG', 'AGG', 'UWG', 'EStG', 'AO', 'BGB',
  'HGB', 'GmbH', 'CSE', 'SSE', 'REALTIME', 'OpenAI', 'Supabase', 'Vercel',
  'n8n', 'LinkedIn', 'Instagram', 'E', 'ID', 'Nr', 'kWh', 'EUR', 'USt',
  /* Einheiten und Kuerzel: ein Zeichen, keine Sprache. */
  'min', 'max', 'Std', 'kg', 'km', 'qm', 'lfm', 'Stk', 'MiLoG', 'ct',
]);

/**
 * Bauteile, deren sichtbarer Text aus einem festen Wortschatz kommt und die
 * ihn deshalb SELBST uebersetzen — sobald man ihnen die Sprache sagt.
 *
 * `StatusPill` ist der Fall, an dem sich das entschieden hat: sein `zustand`
 * ist zugleich Schluessel (er waehlt die Farbe, DESIGN §5) und Beschriftung.
 * Den Schluessel zu uebersetzen waere falsch — `zustand="Overdue"` haette
 * keine Farbe. Also uebersetzt das Bauteil, und was hier geprueft wird, ist
 * nur: hat es die Sprache bekommen? Ohne sie faellt es auf Deutsch, und das
 * ist genau die Luecke, die diese Wache sichtbar halten soll.
 */
const SPRACHBEDUERFTIGE_BAUTEILE: ReadonlySet<string> = new Set(['StatusPill']);

export interface Fundstelle {
  readonly datei: string;
  readonly zeile: number;
  readonly text: string;
}

/** Traegt der Wert ueberhaupt Sprache — oder nur Zeichen? */
function traegtSprache(roh: string): boolean {
  const text = roh.replace(/\s+/gu, ' ').trim();
  if (text === '') return false;
  /*
   * Ein Wort endet NICHT auf einem Bindestrich. Ohne diese Feinheit las
   * `(O-159)` — die Nummer einer offenen Frage — als das zweibuchstabige
   * Wort `O-` und galt als Uebersetzungsluecke. Ein Bindestrich verbindet
   * nur, wo auf beiden Seiten Buchstaben stehen (`E-Mail`, `Vor-Ort`).
   */
  const woerter = text.match(/\p{L}[\p{L}\p{M}'’]*(?:-[\p{L}\p{M}'’]+)*/gu) ?? [];
  // Jedes Wort sprachneutral oder zu kurz, um eines zu sein → keine Luecke.
  return woerter.some((w) => w.length >= 2 && !SPRACHNEUTRAL.has(w));
}

/**
 * Die fest verdrahteten sichtbaren Zeichenketten einer Datei.
 *
 * `quelle` ist ein Parameter, damit der Test die Wache gegen einen String
 * fahren kann, ohne eine Datei anzulegen.
 */
export function festeZeichenketten(datei: string, quelle?: string): readonly Fundstelle[] {
  const inhalt = quelle ?? readFileSync(datei, 'utf8');
  const ts = compilerOderNichts();
  if (ts === null) return [];
  const baum = ts.createSourceFile(datei, inhalt, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const funde: Fundstelle[] = [];

  const melde = (knoten: TS.Node, text: string): void => {
    if (!traegtSprache(text)) return;
    const { line } = baum.getLineAndCharacterOfPosition(knoten.getStart(baum));
    funde.push({
      datei, zeile: line + 1,
      text: text.replace(/\s+/gu, ' ').trim().slice(0, 90),
    });
  };

  const namenVon = (knoten: TS.Node): string | null => {
    if (ts.isJsxAttribute(knoten)) return knoten.name.getText(baum);
    if (ts.isPropertyAssignment(knoten)) {
      const n = knoten.name;
      if (ts.isIdentifier(n)) return n.text;
      if (ts.isStringLiteral(n)) return n.text;
    }
    return null;
  };

  const gehe = (knoten: TS.Node): void => {
    /* Sichtbarer Text zwischen zwei Elementen. */
    if (ts.isJsxText(knoten)) melde(knoten, knoten.text);

    /* `<p>{'Text'}</p>` — ein Ausdruck, der nur eine Zeichenkette ist. */
    if (ts.isJsxExpression(knoten) && knoten.expression !== undefined
      && (ts.isStringLiteral(knoten.expression)
        || ts.isNoSubstitutionTemplateLiteral(knoten.expression))) {
      melde(knoten, knoten.expression.text);
    }

    /* Eine Beschriftung als Attribut oder als Feld eines Spaltenobjekts. */
    const name = namenVon(knoten);
    if (name !== null && SICHTBARE_NAMEN.has(name)) {
      const wert = ts.isJsxAttribute(knoten) ? knoten.initializer
        : (knoten as TS.PropertyAssignment).initializer;
      if (wert !== undefined) {
        if (ts.isStringLiteral(wert) || ts.isNoSubstitutionTemplateLiteral(wert)) {
          melde(knoten, wert.text);
        } else if (ts.isJsxExpression(wert) && wert.expression !== undefined
          && (ts.isStringLiteral(wert.expression)
            || ts.isNoSubstitutionTemplateLiteral(wert.expression))) {
          melde(knoten, wert.expression.text);
        }
      }
    }

    /* Ein Bauteil mit eigenem Wortschatz, dem die Sprache fehlt. */
    if (ts.isJsxSelfClosingElement(knoten) || ts.isJsxOpeningElement(knoten)) {
      const marke = knoten.tagName.getText(baum);
      if (SPRACHBEDUERFTIGE_BAUTEILE.has(marke)) {
        const hatSprache = knoten.attributes.properties.some(
          (a) => ts.isJsxAttribute(a) && a.name.getText(baum) === 'sprache');
        const hatStreuung = knoten.attributes.properties.some(ts.isJsxSpreadAttribute);
        if (!hatSprache && !hatStreuung) {
          const { line } = baum.getLineAndCharacterOfPosition(knoten.getStart(baum));
          funde.push({
            datei, zeile: line + 1,
            text: `<${marke}> ohne \`sprache\` — faellt auf Deutsch`,
          });
        }
      }
    }

    ts.forEachChild(knoten, gehe);
  };

  gehe(baum);
  return funde;
}
