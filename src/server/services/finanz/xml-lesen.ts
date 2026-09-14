/**
 * Ein kleiner XML-Leser — Elemente, Text, Attribute, die fünf vordefinierten
 * Entitäten. Nichts darüber hinaus, und das ist die Zusage.
 *
 * **Warum kein XML-Paket.** Node bringt keinen DOM mit, und die verbreiteten
 * Pakete lösen Entitäten und externe Referenzen auf — genau das, womit eine
 * XXE-Lücke entsteht, wenn jemand eine Datei hochlädt, die er nicht selbst
 * geschrieben hat: einen Kontoauszug (CAMT.053), eine E-Rechnung (XRechnung
 * als UBL oder CII, ZUGFeRD). `<!DOCTYPE` und `<!ENTITY` weist dieser Leser
 * ab, statt sie zu ignorieren: eine Datei, die eine Entität deklariert, ist
 * keine, die dieses Haus versteht, und sie stillschweigend zu lesen hiesse,
 * die Absicht dahinter nicht zu bemerken.
 *
 * **Der Leser stand in `bank/camt.ts` und ist hierher gezogen**, weil die
 * E-Rechnung (PR 63) denselben braucht. Zwei Fassungen desselben Lesers gehen
 * beim ersten Befund auseinander — und ein Befund an einem XML-Leser ist ein
 * Sicherheitsbefund. Neu gegenüber der CAMT-Fassung: **Attribute werden
 * gelesen.** Die Währung eines Betrags (`<Amt Ccy="USD">`, `currencyID`) steht
 * in einem Attribut, und ein Leser, der Attribute wegwirft, buchte einen
 * Dollarbetrag als Euro.
 *
 * Namensraum-Präfixe werden abgeschnitten: `cbc:ID` wird zu `ID`,
 * `ram:Name` zu `Name`. Die Vokabulare, die hier gelesen werden, sind
 * innerhalb eines Dokuments eindeutig genug; wer `Document/Invoice`
 * unterscheiden muss, tut es am Wurzelnamen.
 */

export class XmlLeseFehler extends Error {
  constructor(nachricht: string, readonly grund: 'dtd' | 'struktur' | 'leer') {
    super(nachricht);
    this.name = 'XmlLeseFehler';
  }
}

export interface Knoten {
  readonly name: string;
  readonly text: string;
  readonly attribute: Readonly<Record<string, string>>;
  readonly kinder: readonly Knoten[];
}

/** Die fünf vordefinierten Entitäten und numerische Zeichenreferenzen. */
function roh(s: string): string {
  return s
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"').replace(/&apos;/gu, "'")
    .replace(/&#x([0-9a-fA-F]+);/gu, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/gu, (_, n: string) => String.fromCodePoint(Number(n)))
    /* `&amp;` ZULETZT — sonst würde `&amp;lt;` zu `<` statt zu `&lt;`. */
    .replace(/&amp;/gu, '&');
}

/** `a="1" b='2'` → `{ a: '1', b: '2' }` — der Präfix eines Attributs fällt wie beim Element. */
function attributeAus(text: string): Readonly<Record<string, string>> {
  const attribute: Record<string, string> = {};
  const muster = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(text)) !== null) {
    const rohName = treffer[1] ?? '';
    /* Namensraumdeklarationen sind keine Attribute des Vokabulars. */
    if (rohName === 'xmlns' || rohName.startsWith('xmlns:')) continue;
    const name = rohName.replace(/^[^:]+:/u, '');
    if (name === '') continue;
    attribute[name] = roh(treffer[2] ?? treffer[3] ?? '');
  }
  return attribute;
}

export function leseXml(text: string): Knoten {
  if (/<!DOCTYPE/iu.test(text) || /<!ENTITY/iu.test(text)) {
    throw new XmlLeseFehler(
      'Die Datei deklariert eine DTD oder eine Entität. Sie wird abgewiesen — '
      + 'kein Format dieses Hauses braucht das, und eine externe Entität ist der '
      + 'Weg, auf dem ein Leser Dateien des Servers preisgibt.',
      'dtd');
  }

  /*
   * **CDATA wird VOR dem Zerlegen aufgelöst, nicht danach.** Ein
   * `<![CDATA[RE & 17 < 20]]>` enthält ein `<`, und der Markenausdruck sähe
   * darin den Anfang einer Marke. Der Inhalt wird dabei ESCAPED eingesetzt —
   * sonst hätte ein `<Ntry>` innerhalb eines CDATA-Blocks einen Umsatz
   * erfunden.
   */
  const ohneProlog = text
    .replace(/^﻿/u, '')
    .replace(/<\?[\s\S]*?\?>/gu, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu,
      (_, inhalt: string) => inhalt
        .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;'));

  const marken = /<\s*([^!?\s/>]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\s*\/\s*([^\s>]+)\s*>/gu;
  const stapel: { name: string; text: string; attribute: Readonly<Record<string, string>>;
    kinder: Knoten[] }[] = [];
  let wurzel: Knoten | null = null;
  let letzte = 0;
  let treffer: RegExpExecArray | null;

  while ((treffer = marken.exec(ohneProlog)) !== null) {
    const zwischen = ohneProlog.slice(letzte, treffer.index);
    letzte = marken.lastIndex;
    const oben = stapel[stapel.length - 1];
    if (oben !== undefined && zwischen.trim() !== '') oben.text += roh(zwischen);

    const schliessend = treffer[4];
    if (schliessend !== undefined) {
      const fertig = stapel.pop();
      const name = schliessend.replace(/^[^:]+:/u, '');
      if (fertig === undefined || fertig.name !== name) {
        throw new XmlLeseFehler(
          `Die Marke </${schliessend}> passt zu keiner offenen.`, 'struktur');
      }
      const knoten: Knoten = {
        name: fertig.name, text: fertig.text.trim(), attribute: fertig.attribute,
        kinder: fertig.kinder,
      };
      const eltern = stapel[stapel.length - 1];
      if (eltern === undefined) wurzel = knoten; else eltern.kinder.push(knoten);
      continue;
    }

    const name = (treffer[1] ?? '').replace(/^[^:]+:/u, '');
    const attribute = attributeAus(treffer[2] ?? '');
    if (treffer[3] === '/') {
      const leer: Knoten = { name, text: '', attribute, kinder: [] };
      const eltern = stapel[stapel.length - 1];
      if (eltern === undefined) wurzel = leer; else eltern.kinder.push(leer);
      continue;
    }
    stapel.push({ name, text: '', attribute, kinder: [] });
  }

  if (stapel.length > 0) {
    throw new XmlLeseFehler(
      `Die Marke <${stapel[stapel.length - 1]!.name}> wurde nicht geschlossen.`,
      'struktur');
  }
  if (wurzel === null) throw new XmlLeseFehler('Die Datei enthält kein XML.', 'leer');
  return wurzel;
}

/** Das erste Kind mit diesem Namen, beliebig tief (Dokumentreihenfolge). */
export function tief(k: Knoten, name: string): Knoten | null {
  for (const kind of k.kinder) {
    if (kind.name === name) return kind;
    const treffer = tief(kind, name);
    if (treffer !== null) return treffer;
  }
  return null;
}

/** Das erste DIREKTE Kind mit diesem Namen — für Vokabulare, in denen ein Name auf mehreren Ebenen vorkommt. */
export function kind(k: Knoten, name: string): Knoten | null {
  return k.kinder.find((c) => c.name === name) ?? null;
}

/** Ein Pfad aus direkten Kindern: `pfad(k, 'A', 'B')` ist `k/A/B` oder `null`. */
export function pfad(k: Knoten, ...namen: readonly string[]): Knoten | null {
  let aktuell: Knoten | null = k;
  for (const name of namen) {
    if (aktuell === null) return null;
    aktuell = kind(aktuell, name);
  }
  return aktuell;
}

/** Alle Nachfahren mit diesem Namen, in Dokumentreihenfolge. */
export function alle(k: Knoten, name: string): Knoten[] {
  const treffer: Knoten[] = [];
  for (const c of k.kinder) {
    if (c.name === name) treffer.push(c);
    treffer.push(...alle(c, name));
  }
  return treffer;
}

/** Alle DIREKTEN Kinder mit diesem Namen. */
export function kinder(k: Knoten, name: string): Knoten[] {
  return k.kinder.filter((c) => c.name === name);
}

export function text(k: Knoten | null): string | null {
  return k === null || k.text === '' ? null : k.text;
}
