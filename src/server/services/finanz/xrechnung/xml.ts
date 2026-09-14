/**
 * Ein winziger, strenger XML-Schreiber — nur fuer UBL (FIN-11).
 *
 * **Warum keine Bibliothek.** Was hier gebraucht wird, sind Elemente,
 * Attribute und maskierter Text, in genau der Reihenfolge, in der die
 * UBL-Sequenz sie verlangt. Ein Allzweckserialisierer bringt dafuer eine
 * Abhaengigkeit mit, die Rechnungen erzeugt, und nimmt einem die eine
 * Eigenschaft, auf die es ankommt: dass der Baum GAR NICHT ERST entstehen
 * kann, wenn ein Wert fehlt oder ein Zeichen nicht hineingehoert.
 *
 * **Maskiert wird immer, nie „wenn noetig".** Ein Kundenname wie
 * „Meyer & Sohn" macht aus einem gueltigen Dokument sonst eines, das der
 * Pruefer des Empfaengers mit „not well-formed" ablehnt — und zwar erst
 * dort, nach dem Versand, an einer Rechnung, die nicht mehr geaendert werden
 * darf. Deshalb gibt es hier keinen Weg, rohes Markup einzusetzen: der
 * Schreiber maskiert, und eine Hintertuer dazu gibt es nicht.
 *
 * **Steuerzeichen werden abgewiesen, nicht entfernt.** XML 1.0 kennt keine
 * Darstellung fuer U+0000 bis U+001F ausser Tabulator, Zeilenumbruch und
 * Wagenruecklauf; ein Schreiber, der sie still wegwirft, aendert den Inhalt
 * eines unveraenderlichen Belegs. Der hier wirft.
 */

export class XmlFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'XmlFehler';
  }
}

/**
 * **Exportiert, weil es einen zweiten XML-Erzeuger gibt.** Der XMP-Block im
 * ZUGFeRD-PDF (`zugferd/pdfa3.ts`) baut sein XML als Zeichenkette und setzte
 * `leistender.name` roh hinein — ein Firmenname wie „Müller & Söhne" machte
 * die Metadaten damit nicht wohlgeformt, und ein PDF/A-3, dessen XMP nicht
 * parst, faellt bei veraPDF durch. Zwei Maskierer waeren zwei Auslegungen von
 * „gueltiges XML"; es gibt nur diesen.
 *
 * Die fuenf Ersetzungen, und `>` ist keine Bequemlichkeit: die Folge `]]>`
 * beendet einen CDATA-Abschnitt und ist auch ausserhalb eines solchen
 * verboten.
 *
 * `\r` wird zu `&#13;`, weil ein Parser rohe Wagenruecklaeufe beim Einlesen
 * zu `\n` normalisiert — der Text kaeme anders zurueck, als er hineinging.
 */
export function maskiere(wert: string, pfad: string): string {
  let aus = '';
  for (const zeichen of wert.normalize('NFC')) {
    const code = zeichen.codePointAt(0) ?? 0;
    if (code < 0x20 && zeichen !== '\n' && zeichen !== '\t' && zeichen !== '\r') {
      throw new XmlFehler(
        `${pfad}: Steuerzeichen U+${code.toString(16).padStart(4, '0').toUpperCase()} `
        + 'ist in XML 1.0 nicht darstellbar. Der Wert wird NICHT stillschweigend '
        + 'bereinigt — ein Beleg, der anders herauskommt, als er hineinging, ist keiner.',
      );
    }
    aus += zeichen === '&' ? '&amp;'
      : zeichen === '<' ? '&lt;'
        : zeichen === '>' ? '&gt;'
          : zeichen === '"' ? '&quot;'
            : zeichen === "'" ? '&apos;'
              : zeichen === '\r' ? '&#13;'
                : zeichen;
  }
  return aus;
}

/** Ein Attributpaar. Der Wert wird maskiert wie jeder andere Text. */
export type Attribute = Readonly<Record<string, string>>;

export interface Element {
  readonly name: string;
  readonly attribute: Attribute;
  readonly kinder: readonly Element[];
  readonly text: string | null;
}

const NAME_MUSTER = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/u;

function pruefeName(name: string): string {
  if (!NAME_MUSTER.test(name)) {
    throw new XmlFehler(`Kein gueltiger XML-Name: ${JSON.stringify(name)}`);
  }
  return name;
}

/**
 * Ein Element mit Text — oder, wenn der Text `null` ist, KEIN Element.
 *
 * Das `null` ist der ganze Zweck: UBL-Sequenzen sind geordnet, und ein leeres
 * `<cbc:CompanyID/>` ist nicht dasselbe wie ein fehlendes. Wer den Fall an
 * jeder Aufrufstelle einzeln behandelt, vergisst ihn an einer — hier faellt
 * das Element weg, und `el()` siebt die Luecken aus seiner Kinderliste.
 */
export function feld(name: string, text: string | null, attribute: Attribute = {}): Element | null {
  return text === null ? null : {
    name: pruefeName(name), attribute, kinder: [], text,
  };
}

export function el(
  name: string,
  kinder: readonly (Element | null)[],
  attribute: Attribute = {},
): Element {
  return {
    name: pruefeName(name),
    attribute,
    kinder: kinder.filter((k): k is Element => k !== null),
    text: null,
  };
}

function schreibeAttribute(attribute: Attribute, pfad: string): string {
  // Schluesselreihenfolge ist die Einfuegereihenfolge. XML misst ihr keine
  // Bedeutung bei, ein Byte-Vergleich in einem Test schon — deshalb
  // ausdruecklich nicht sortiert, sondern so, wie der Aufrufer sie schrieb.
  return Object.entries(attribute)
    .map(([k, v]) => ` ${pruefeName(k)}="${maskiere(v, `${pfad}@${k}`)}"`)
    .join('');
}

function schreibe(element: Element, tiefe: number, pfad: string): string {
  const einzug = '  '.repeat(tiefe);
  const wo = `${pfad}/${element.name}`;
  const attribute = schreibeAttribute(element.attribute, wo);

  if (element.text !== null) {
    return `${einzug}<${element.name}${attribute}>${maskiere(element.text, wo)}</${element.name}>`;
  }
  if (element.kinder.length === 0) {
    /**
     * Ein Element ohne Text und ohne Kinder ist in UBL fast immer ein Fehler
     * der aufrufenden Stelle — ein `feld()` waere hier `null` geworden und
     * gar nicht erst entstanden. Es wird trotzdem geschrieben und nicht
     * geworfen: `<cac:PartyIdentification/>` ist schema-gueltig, und diese
     * Datei kennt UBL nicht. Was fehlen darf, entscheidet `index.ts`.
     */
    return `${einzug}<${element.name}${attribute}/>`;
  }
  const kinder = element.kinder.map((k) => schreibe(k, tiefe + 1, wo)).join('\n');
  return `${einzug}<${element.name}${attribute}>\n${kinder}\n${einzug}</${element.name}>`;
}

/**
 * Das fertige Dokument, mit Deklaration und abschliessendem Zeilenumbruch.
 *
 * UTF-8 steht ausgeschrieben in der Deklaration, obwohl es der Standardwert
 * ist: die Datei verlaesst das Haus, und ein Empfaenger, der sie ohne
 * Transportkopf bekommt, raet sonst.
 */
export function dokument(wurzel: Element): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${schreibe(wurzel, 0, '')}\n`;
}
