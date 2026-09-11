/**
 * Der Rechenansatz-Parser (BAU-02, 03-GEWERKE §7.7, §10.3).
 *
 * Ein Aufmaß nach § 14 VOB/B besteht aus zwei Dingen, und beide werden
 * gespeichert: dem **Rechenansatz als Text**, so wie der Polier ihn
 * aufgeschrieben hat, und dem daraus berechneten **Ergebnis**. Der Text allein
 * hiesse, bei jedem Lesen neu zu rechnen — ein Fehlerbehebung im Parser
 * veränderte dann rückwirkend Mengen, die längst abgerechnet sind. Das
 * Ergebnis allein nähme dem Prüfer die Möglichkeit nachzuvollziehen, WIE die
 * Zahl entstanden ist. Also beides, plus `parser_version`.
 *
 * **Es gibt kein `eval` und kein `new Function`.** Ein Rechenansatz kommt aus
 * einem Formularfeld; ihn als JavaScript auszuführen wäre eine Codeausführung
 * mit Kundendaten daneben. Stattdessen: Zerleger, rekursiver Abstieg,
 * Ganzzahlarithmetik. `tests/kern/rechenansatz.test.ts` belegt die Abwesenheit
 * am Quelltext, damit sie nicht beim nächsten „schnellen Fix" zurückkommt.
 *
 * ## Gerechnet wird in ganzen Zahlen
 *
 * Jede Zahl im Text ist eine endliche Dezimalzahl, und `+`, `−` und `×` führen
 * aus endlichen Dezimalzahlen wieder auf endliche Dezimalzahlen. Deshalb ist
 * das Zwischenergebnis EXAKT darstellbar als Paar `(Mantisse, Skala)` mit
 * `bigint`-Mantisse — keine Gleitkommazahl kommt vor, an keiner Stelle, auch
 * nicht „nur kurz zur Anzeige".
 *
 * ## Die Rundungsregel — genau einmal, ganz am Ende
 *
 * Zwischenergebnisse werden NIE gerundet. Erst das exakte Endergebnis wird
 * **einmal** auf die feste Skala 10⁻⁴ der Einheit gerundet, kaufmännisch
 * (halbe Einheit vom Null weg), und als GANZE ZAHL gespeichert: bei `m²` sind
 * das Quadratzentimeter, `30,87 m² = 308.700`. Die Spalte `menge`
 * (`numeric(12,3)`, 03-GEWERKE §7.7) ist eine **Projektion** dieser einen
 * Zahl — sie wird aus `ergebnis_skaliert` abgeleitet und nicht ein zweites Mal
 * aus dem Rechenansatz berechnet. Zwei unabhängige Rundungen desselben Werts
 * könnten sich in der dritten Stelle unterscheiden, und dann stritte die
 * Datenbank mit sich selbst darüber, welche Menge abgerechnet wurde.
 *
 * ## Was der Parser NICHT tut
 *
 * Er wendet **keine** Übermessungs- oder Abzugsregel an. Was der Mensch
 * geschrieben hat, wird gerechnet — nicht mehr.
 * // TODO(client, O-23): Sollen VOB/C-Abzugs- und Uebermessungsregeln (ATV je
 * Gewerk, DIN 18299 ff.) automatisch angewandt werden, oder bleibt der
 * Rechenansatz vollstaendig manuell?
 */

/**
 * Welcher Parser-Bau ein Ergebnis erzeugt hat — steht in
 * `aufmass_zeile.parser_version` und ist der Bezugspunkt des nächtlichen
 * Nachrechnungslaufs.
 *
 * **Die Zahl wird erhöht, wenn sich das ERGEBNIS für irgendeine Eingabe
 * ändert**, nicht bei jeder Codeänderung: der Nachrechnungslauf meldet
 * Abweichungen, statt sie zu korrigieren, und ohne einen Versionswechsel
 * sähe eine gemeldete Abweichung aus wie eine Manipulation an der Zeile.
 */
export const PARSER_VERSION = 'rechenansatz-1';

/**
 * Die feste Skala des gespeicherten Ergebnisses: 10⁻⁴ der Einheit.
 *
 * Bei `m²` ist das der Quadratzentimeter, bei `m` der Zehntelmillimeter. Vier
 * Stellen und nicht drei, weil `menge numeric(12,3)` daraus abgeleitet wird
 * und eine Skala, die genauso grob ist wie ihre Projektion, keine Reserve für
 * die Rundung liesse.
 */
export const ERGEBNIS_SKALA = 4;

/** 10^ERGEBNIS_SKALA — einmal ausgerechnet, damit es nirgends zweimal steht. */
export const ERGEBNIS_FAKTOR = 10_000n;

/**
 * Die Obergrenze des gespeicherten Ergebnisses.
 *
 * `ergebnis_skaliert` ist `bigint` in Postgres, also 2⁶³−1. Wer darüber
 * hinaus rechnet, bekäme beim Schreiben einen Datenbankfehler statt einer
 * Meldung am Feld — TECHNISCHE Grenze, keine Geschäftsregel.
 */
const MAX_ERGEBNIS = 9_223_372_036_854_775_807n;

/**
 * Technische Schranken. Keine davon ist eine Geschäftsregel; sie halten den
 * Zerleger davon ab, an einer bösartigen Eingabe Speicher oder Stapel zu
 * verbrauchen — ein Rechenansatz ist ein Formularfeld, kein Rechenwerk.
 */
const MAX_ZEICHEN = 2_000;
const MAX_TIEFE = 32;
const MAX_MANTISSE_ZIFFERN = 400;

/** Warum eine Eingabe zurückgewiesen wurde — typisiert, nie nur ein Text. */
export type RechenansatzGrund =
  | 'leer'
  | 'zu_lang'
  | 'zeichen_unbekannt'
  | 'zahl_ungueltig'
  | 'operand_fehlt'
  | 'zeichen_ueberzaehlig'
  | 'klammer_offen'
  | 'klammer_ueberzaehlig'
  | 'zu_tief'
  | 'zu_gross';

/**
 * Der eine Fehler dieses Moduls — mit **Zeichenoffset**.
 *
 * Der Offset ist der Punkt: „ungültiger Rechenansatz" schickt den Polier auf
 * die Suche, `Zeichen 14` zeigt auf das `%`, das er getippt hat. Gezählt wird
 * in UTF-16-Einheiten ab 0, also so, wie ein `<input>` seine Auswahl zählt.
 */
export class RechenansatzFehler extends Error {
  readonly status = 422 as const;

  constructor(
    readonly grund: RechenansatzGrund,
    readonly offset: number,
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'RechenansatzFehler';
  }
}

/**
 * Der Syntaxbaum, wie er in `aufmass_zeile.rechenansatz_ast` landet.
 *
 * Reines JSON: die Mantisse einer Zahl ist eine ZEICHENKETTE, weil `bigint`
 * sich nicht serialisieren lässt und `number` genau die Genauigkeit verlöre,
 * um die es hier geht. Der Baum ist der Beleg dafür, dass die gespeicherte
 * Menge aus dieser Formel stammt und nicht aus einer Eingabe daneben.
 */
export type Knoten =
  | {
    readonly art: 'zahl';
    /** Mantisse als Dezimalziffernfolge; Wert = mantisse / 10^skala. */
    readonly mantisse: string;
    readonly skala: number;
    /** Wie es im Text stand — „4,20", nicht „4.2". */
    readonly text: string;
    readonly offset: number;
  }
  | {
    readonly art: 'binaer';
    readonly operator: 'plus' | 'minus' | 'mal';
    readonly links: Knoten;
    readonly rechts: Knoten;
    readonly offset: number;
  }
  | {
    readonly art: 'negation';
    readonly operand: Knoten;
    readonly offset: number;
  };

/** Eine exakte Dezimalzahl: `mantisse / 10^skala`. Nie eine Gleitkommazahl. */
interface Dezimal {
  readonly mantisse: bigint;
  readonly skala: number;
}

/**
 * Was ein gerechneter Rechenansatz liefert. `skaliert` ist die massgebliche
 * Zahl; alles andere hängt an ihr.
 */
export interface RechenansatzErgebnis {
  /** Der Text, wörtlich wie eingegeben — er wird gespeichert, nicht normiert. */
  readonly formel: string;
  readonly ast: Knoten;
  /** Das Ergebnis in fester Skala als ganze Zahl (10⁻⁴ der Einheit). */
  readonly skaliert: bigint;
  /** `menge numeric(12,3)` in der Form, die Postgres liest: `"30.870"`. */
  readonly mengePostgres: string;
  /** Die deutsche Anzeige neben der Formel: `"30,87"`. */
  readonly anzeige: string;
  readonly parserVersion: string;
}

/* ---------------------------------------------------------------------------
 * 1. Zerleger
 * ------------------------------------------------------------------------ */

/**
 * Der geschlossene Zeichenvorrat. Alles andere wird mit Offset zurückgewiesen
 * — auch `.`, `:` und `/`.
 *
 * Das ist strenger, als es zunächst wirkt, und mit Absicht: `1.234,50` ist in
 * Deutschland eintausendzweihundertvierunddreissig, in einem Import aus einer
 * Tabellenkalkulation aber oft `1.234` im Sinne von eins Komma zwei drei vier.
 * Eine Zahl, die zwei Bedeutungen haben kann, wird nicht geraten, sondern
 * abgewiesen — der Mensch entscheidet, was er meinte. Aus demselben Grund gibt
 * es keine Division: eine Länge geteilt durch etwas ist keine Aufmaßzeile, die
 * jemand später nachvollziehen möchte, und `/` als Trennzeichen zwischen zwei
 * Massen („2,10/0,90") ist die häufigere Bedeutung — beide würden hier still
 * zu einer Zahl.
 */
const MAL = new Set(['×', 'x', '*']);
const MINUS = new Set(['−', '-']);
const LEERRAUM = new Set([' ', '\t', '\n', '\r', '\u00A0', '\u202F', '\u2007']);

type TokenArt = 'zahl' | 'plus' | 'minus' | 'mal' | 'klammer_auf' | 'klammer_zu';

interface Token {
  readonly art: TokenArt;
  readonly offset: number;
  /** Nur bei `zahl` gesetzt. */
  readonly text: string;
  readonly mantisse: bigint;
  readonly skala: number;
}

function zerlege(eingabe: string): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < eingabe.length) {
    const zeichen = eingabe[i] as string;

    if (LEERRAUM.has(zeichen)) {
      i += 1;
      continue;
    }
    if (zeichen === '(') {
      tokens.push(marke('klammer_auf', i));
      i += 1;
      continue;
    }
    if (zeichen === ')') {
      tokens.push(marke('klammer_zu', i));
      i += 1;
      continue;
    }
    if (zeichen === '+') {
      tokens.push(marke('plus', i));
      i += 1;
      continue;
    }
    if (MINUS.has(zeichen)) {
      tokens.push(marke('minus', i));
      i += 1;
      continue;
    }
    if (MAL.has(zeichen)) {
      tokens.push(marke('mal', i));
      i += 1;
      continue;
    }
    if (istZiffer(zeichen)) {
      const zahl = lieszahl(eingabe, i);
      tokens.push(zahl);
      i += zahl.text.length;
      continue;
    }
    throw new RechenansatzFehler(
      'zeichen_unbekannt',
      i,
      `Zeichen ${JSON.stringify(zeichen)} ist im Rechenansatz nicht zugelassen `
      + '(erlaubt: Ziffern, Komma, + − × und Klammern).',
    );
  }
  return tokens;
}

function marke(art: TokenArt, offset: number): Token {
  return { art, offset, text: '', mantisse: 0n, skala: 0 };
}

function istZiffer(zeichen: string): boolean {
  return zeichen >= '0' && zeichen <= '9';
}

/**
 * Eine Zahl ab `start`: Ziffern, höchstens ein Komma, danach wieder Ziffern.
 *
 * `4,` und `4,,20` werden abgewiesen statt ergänzt. Eine Formel, in der eine
 * halb getippte Zahl still zu `4,0` wird, rechnet ohne Widerspruch das
 * Falsche — und der Rechenansatz steht daneben und sieht richtig aus.
 */
function lieszahl(eingabe: string, start: number): Token {
  let i = start;
  let ganz = '';
  let bruch = '';
  let kommaGesehen = false;

  while (i < eingabe.length) {
    const zeichen = eingabe[i] as string;
    if (istZiffer(zeichen)) {
      if (kommaGesehen) bruch += zeichen;
      else ganz += zeichen;
      i += 1;
      continue;
    }
    if (zeichen === ',') {
      if (kommaGesehen) {
        throw new RechenansatzFehler(
          'zahl_ungueltig', i, 'Eine Zahl hat höchstens ein Komma.',
        );
      }
      kommaGesehen = true;
      i += 1;
      continue;
    }
    break;
  }

  if (kommaGesehen && bruch === '') {
    throw new RechenansatzFehler(
      'zahl_ungueltig', i, 'Nach dem Komma fehlen die Nachkommastellen.',
    );
  }
  const text = eingabe.slice(start, i);
  return {
    art: 'zahl',
    offset: start,
    text,
    mantisse: BigInt(`${ganz === '' ? '0' : ganz}${bruch}`),
    skala: bruch.length,
  };
}

/* ---------------------------------------------------------------------------
 * 2. Zerteiler — rekursiver Abstieg, kein eval
 * ------------------------------------------------------------------------ */

/**
 * ```
 * ausdruck := term (('+' | '−') term)*
 * term     := faktor ('×' faktor)*
 * faktor   := ('+' | '−') faktor | zahl | '(' ausdruck ')'
 * ```
 *
 * Punkt vor Strich steckt in der Schachtelung der drei Regeln, nicht in einer
 * Vorrangtabelle: `3 × 4 + 2` ergibt 14, nie 18.
 *
 * **Das einstellige Minus ist zugelassen**, weil eine Aufmaßzeile im Rückbau
 * negativ sein darf (§7.7: „No sign check on `menge`") und `−2 × (0,90 ×
 * 2,10)` als führender Term genau so geschrieben wird.
 */
export function parseRechenansatz(eingabe: string): Knoten {
  if (typeof eingabe !== 'string' || eingabe.trim() === '') {
    throw new RechenansatzFehler('leer', 0, 'Der Rechenansatz ist leer.');
  }
  if (eingabe.length > MAX_ZEICHEN) {
    throw new RechenansatzFehler(
      'zu_lang', MAX_ZEICHEN,
      `Der Rechenansatz ist länger als ${String(MAX_ZEICHEN)} Zeichen.`,
    );
  }

  const tokens = zerlege(eingabe);
  const zustand = { i: 0, tiefe: 0 };
  const baum = ausdruck(tokens, zustand, eingabe.length);

  const rest = tokens[zustand.i];
  if (rest !== undefined) {
    if (rest.art === 'klammer_zu') {
      throw new RechenansatzFehler(
        'klammer_ueberzaehlig', rest.offset, 'Hier schliesst eine Klammer, die nie geöffnet wurde.',
      );
    }
    throw new RechenansatzFehler(
      'zeichen_ueberzaehlig', rest.offset, 'Nach dem Ende des Ausdrucks steht noch etwas.',
    );
  }
  return baum;
}

interface Zustand { i: number; tiefe: number }

function ausdruck(tokens: readonly Token[], z: Zustand, ende: number): Knoten {
  let links = term(tokens, z, ende);
  for (;;) {
    const t = tokens[z.i];
    if (t === undefined || (t.art !== 'plus' && t.art !== 'minus')) return links;
    z.i += 1;
    const rechts = term(tokens, z, ende);
    links = {
      art: 'binaer',
      operator: t.art === 'plus' ? 'plus' : 'minus',
      links,
      rechts,
      offset: t.offset,
    };
  }
}

function term(tokens: readonly Token[], z: Zustand, ende: number): Knoten {
  let links = faktor(tokens, z, ende);
  for (;;) {
    const t = tokens[z.i];
    if (t === undefined || t.art !== 'mal') return links;
    z.i += 1;
    const rechts = faktor(tokens, z, ende);
    links = { art: 'binaer', operator: 'mal', links, rechts, offset: t.offset };
  }
}

function faktor(tokens: readonly Token[], z: Zustand, ende: number): Knoten {
  const t = tokens[z.i];
  if (t === undefined) {
    throw new RechenansatzFehler('operand_fehlt', ende, 'Hier fehlt eine Zahl.');
  }

  if (t.art === 'plus' || t.art === 'minus') {
    z.i += 1;
    const operand = tiefer(z, () => faktor(tokens, z, ende), t.offset);
    return t.art === 'plus' ? operand : { art: 'negation', operand, offset: t.offset };
  }

  if (t.art === 'zahl') {
    z.i += 1;
    return {
      art: 'zahl', mantisse: t.mantisse.toString(), skala: t.skala, text: t.text, offset: t.offset,
    };
  }

  if (t.art === 'klammer_auf') {
    z.i += 1;
    const innen = tiefer(z, () => ausdruck(tokens, z, ende), t.offset);
    const schluss = tokens[z.i];
    if (schluss === undefined || schluss.art !== 'klammer_zu') {
      throw new RechenansatzFehler(
        'klammer_offen', t.offset, 'Diese Klammer wird nie geschlossen.',
      );
    }
    z.i += 1;
    return innen;
  }

  throw new RechenansatzFehler(
    'operand_fehlt', t.offset, 'Hier steht ein Rechenzeichen, wo eine Zahl stehen müsste.',
  );
}

/**
 * Zählt die Schachtelungstiefe mit — `((((…` ohne Grenze legt den Prozess mit
 * einem Stapelüberlauf still, und ein Absturz ist kein typisierter Fehler.
 */
function tiefer(z: Zustand, weiter: () => Knoten, offset: number): Knoten {
  z.tiefe += 1;
  if (z.tiefe > MAX_TIEFE) {
    throw new RechenansatzFehler(
      'zu_tief', offset, `Mehr als ${String(MAX_TIEFE)} ineinander geschachtelte Klammern.`,
    );
  }
  try {
    return weiter();
  } finally {
    z.tiefe -= 1;
  }
}

/* ---------------------------------------------------------------------------
 * 3. Auswertung — exakt, und genau eine Rundung am Ende
 * ------------------------------------------------------------------------ */

function angleichen(a: Dezimal, b: Dezimal): readonly [bigint, bigint, number] {
  const skala = Math.max(a.skala, b.skala);
  return [
    a.mantisse * 10n ** BigInt(skala - a.skala),
    b.mantisse * 10n ** BigInt(skala - b.skala),
    skala,
  ];
}

function pruefeGroesse(wert: Dezimal, offset: number): Dezimal {
  const ziffern = (wert.mantisse < 0n ? -wert.mantisse : wert.mantisse).toString().length;
  if (ziffern > MAX_MANTISSE_ZIFFERN) {
    throw new RechenansatzFehler(
      'zu_gross', offset, 'Das Zwischenergebnis ist unrealistisch gross.',
    );
  }
  return wert;
}

/** Der exakte Wert des Baums — ohne jede Rundung. */
function exakt(knoten: Knoten): Dezimal {
  switch (knoten.art) {
    case 'zahl':
      return { mantisse: BigInt(knoten.mantisse), skala: knoten.skala };
    case 'negation': {
      const innen = exakt(knoten.operand);
      return { mantisse: -innen.mantisse, skala: innen.skala };
    }
    case 'binaer': {
      const links = exakt(knoten.links);
      const rechts = exakt(knoten.rechts);
      if (knoten.operator === 'mal') {
        return pruefeGroesse(
          { mantisse: links.mantisse * rechts.mantisse, skala: links.skala + rechts.skala },
          knoten.offset,
        );
      }
      const [l, r, skala] = angleichen(links, rechts);
      return pruefeGroesse(
        { mantisse: knoten.operator === 'plus' ? l + r : l - r, skala },
        knoten.offset,
      );
    }
  }
}

/**
 * Kaufmännisch runden: die halbe Einheit geht **von der Null weg**.
 *
 * Nicht `Math.round` und keine Gleitkommazahl — beides würde bei
 * `0,00005` genau dort falsch, wo diese Funktion gebraucht wird. Für negative
 * Mengen (Rückbau, Abzugszeile) muss `−0,00005` auf `−0,0001` gehen und nicht
 * auf `0`, sonst wären Zu- und Abgang nicht symmetrisch.
 */
function rundeAuf(wert: Dezimal, zielSkala: number): bigint {
  if (wert.skala <= zielSkala) {
    return wert.mantisse * 10n ** BigInt(zielSkala - wert.skala);
  }
  const teiler = 10n ** BigInt(wert.skala - zielSkala);
  const negativ = wert.mantisse < 0n;
  const abs = negativ ? -wert.mantisse : wert.mantisse;
  const gerundet = (abs * 2n + teiler) / (teiler * 2n);
  return negativ ? -gerundet : gerundet;
}

/**
 * Der Wert des Baums in fester Skala, als ganze Zahl.
 *
 * **Hier und nur hier wird gerundet**, einmal, aus dem exakten Ergebnis. Wer
 * eine gröbere Skala braucht (`menge numeric(12,3)`), leitet sie aus dieser
 * Zahl ab, statt ein zweites Mal aus der Formel zu rechnen.
 */
export function werteAus(knoten: Knoten, zielSkala: number = ERGEBNIS_SKALA): bigint {
  const ergebnis = rundeAuf(exakt(knoten), zielSkala);
  if (ergebnis > MAX_ERGEBNIS || ergebnis < -MAX_ERGEBNIS) {
    throw new RechenansatzFehler(
      'zu_gross', knoten.offset, 'Das Ergebnis ist grösser, als eine Menge sein kann.',
    );
  }
  return ergebnis;
}

/**
 * `308700n` → `"30.870"` — die Form, die Postgres für `numeric(12,3)` liest.
 *
 * Die PROJEKTION der massgeblichen Zahl auf drei Stellen, nicht eine zweite
 * Rechnung (siehe Kopf). Sie rundet, weil 10⁻⁴ feiner ist als 10⁻³, und zwar
 * nach derselben Regel wie oben.
 */
export function mengeAusSkaliert(skaliert: bigint): string {
  const negativ = skaliert < 0n;
  const abs = negativ ? -skaliert : skaliert;
  const tausendstel = (abs * 2n + 10n) / 20n;
  const ganz = tausendstel / 1000n;
  const bruch = (tausendstel % 1000n).toString().padStart(3, '0');
  return `${negativ ? '-' : ''}${ganz.toString()}.${bruch}`;
}

/**
 * Die Anzeige neben der Formel: `"30,87"`, deutsch, mindestens zwei und
 * höchstens drei Nachkommastellen — dieselbe Regel wie `formatiereMenge` in
 * `finanz/menge.ts`, nur ohne den Umweg über eine `number`, den eine Fläche
 * mit vier Stellen nicht verträgt.
 */
export function anzeigeAusSkaliert(skaliert: bigint): string {
  const postgres = mengeAusSkaliert(skaliert);
  const negativ = postgres.startsWith('-');
  const [ganz = '0', bruch = '000'] = (negativ ? postgres.slice(1) : postgres).split('.');
  const gruppiert = ganz.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const gekuerzt = bruch.replace(/0+$/u, '').padEnd(2, '0');
  return `${negativ ? '−' : ''}${gruppiert},${gekuerzt}`;
}

/**
 * Der Weg, den jeder Aufrufer nimmt: Text hinein, Ergebnis heraus — und der
 * Text bleibt wörtlich erhalten.
 *
 * `formel` ist die Eingabe unverändert (nur aussen beschnitten), weil § 14
 * VOB/B den Rechenansatz als Beleg meint und nicht dessen normierte Fassung.
 */
export function berechneRechenansatz(eingabe: string): RechenansatzErgebnis {
  const formel = typeof eingabe === 'string' ? eingabe.trim() : '';
  const ast = parseRechenansatz(formel);
  const skaliert = werteAus(ast);
  return {
    formel,
    ast,
    skaliert,
    mengePostgres: mengeAusSkaliert(skaliert),
    anzeige: anzeigeAusSkaliert(skaliert),
    parserVersion: PARSER_VERSION,
  };
}

/** Das Ergebnis eines Versuchs — für Aufrufer, die nicht werfen wollen. */
export type Versuch =
  | { readonly ok: true; readonly ergebnis: RechenansatzErgebnis }
  | {
    readonly ok: false;
    readonly grund: RechenansatzGrund;
    readonly offset: number;
    readonly meldung: string;
  };

/**
 * Dieselbe Rechnung, als Wert statt als Ausnahme.
 *
 * **Sie fängt jeden Fehler, nicht nur den eigenen.** Die Zusage aus PR 43 ist,
 * dass zehntausend beliebige Eingaben einen Wert ODER einen typisierten Fehler
 * liefern — nie einen Absturz. Ein unerwarteter `RangeError` aus der Tiefe
 * wäre genau der Absturz; er kommt hier als `zu_gross` heraus, mit Offset 0,
 * statt die Anfrage abzubrechen.
 */
export function versucheRechenansatz(eingabe: string): Versuch {
  try {
    return { ok: true, ergebnis: berechneRechenansatz(eingabe) };
  } catch (fehler: unknown) {
    if (fehler instanceof RechenansatzFehler) {
      return { ok: false, grund: fehler.grund, offset: fehler.offset, meldung: fehler.message };
    }
    return {
      ok: false,
      grund: 'zu_gross',
      offset: 0,
      meldung: 'Der Rechenansatz liess sich nicht auswerten.',
    };
  }
}
