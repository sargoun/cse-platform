/**
 * XML-Wohlgeformtheit — von Hand, weil Node keinen XML-Parser mitbringt.
 *
 * **Warum es diese Datei gibt.** Acht Motivtafeln lagen monatelang im Baum,
 * sahen im Editor richtig aus und waren es nie: ein XML-Kommentar enthielt
 * einen doppelten Bindestrich, und ein XML-Kommentar darf das nicht. Der
 * Server lieferte die Dateien mit 200 aus, der Browser lud sie, verwarf sie
 * beim Parsen und zeichnete ein kaputtes Bild. Jede Pruefung eine Ebene
 * darunter war gruen — die Datei existierte, der `src` stimmte, die Antwort
 * war 200, das `<img>` stand im DOM, und der Test prueft die Kennzeichnung
 * DANEBEN. Gruen war alles ausser dem, worauf es ankam.
 *
 * Node hat kein `DOMParser`; das ist eine Browser-Schnittstelle. Eine
 * Abhaengigkeit fuer eine Wache aufzunehmen waere zu viel Gewicht, also steht
 * der Pruefer hier. Er deckt die Teilmenge von XML ab, die SVG braucht, und
 * **weist zurueck, was er nicht versteht, statt es zu ueberspringen**: eine
 * Wache, die im Zweifel schweigt, ist die Wache, die diesen Fehler
 * durchgelassen hat. Die Richtung des Irrtums ist hier bewusst gewaehlt.
 *
 * Was er NICHT ist: eine Namensraum- oder Schemapruefung. Er sagt „der Parser
 * kommt durch", nicht „das ist ein gueltiges SVG".
 */

export interface XmlFehler {
  readonly zeile: number;
  readonly text: string;
}

/** Nur die fuenf ohne DTD vordefinierten Entitaeten sind erlaubt. */
const ENTITAETEN = new Set(['amp', 'lt', 'gt', 'apos', 'quot']);

const IST_LEERRAUM = (z: string): boolean => z === ' ' || z === '\t' || z === '\n' || z === '\r';

/**
 * XMLs `NameStartChar` ist eine lange Liste von Unicode-Bereichen. Hier steht
 * die praktische Naeherung: ASCII-Buchstabe, `_`, `:` — oder irgendetwas
 * jenseits von ASCII. Enger waere falsch (ein Element mit Umlaut ist gueltig),
 * weiter waere ein Loch.
 */
function istNamensanfang(z: string): boolean {
  return /[A-Za-z_:]/u.test(z) || z.charCodeAt(0) > 127;
}

function istNamenszeichen(z: string): boolean {
  return /[A-Za-z0-9._:-]/u.test(z) || z.charCodeAt(0) > 127;
}

/**
 * Prueft eine Zeichenkette auf XML-Wohlgeformtheit.
 *
 * Gibt den ERSTEN Fehler zurueck, oder `null`. Der erste genuegt: eine Datei,
 * die an einer Stelle bricht, wird vom Browser ganz verworfen.
 */
export function pruefeXml(inhalt: string): XmlFehler | null {
  /** Zeilennummer erst im Fehlerfall berechnen — sonst zaehlen wir umsonst. */
  const zeileVon = (pos: number): number => {
    let n = 1;
    for (let k = 0; k < pos && k < inhalt.length; k += 1) if (inhalt[k] === '\n') n += 1;
    return n;
  };
  const fehler = (pos: number, text: string): XmlFehler => ({ zeile: zeileVon(pos), text });

  const stapel: { name: string; pos: number }[] = [];
  let wurzelGesehen = false;
  let i = 0;

  /**
   * `&` muss eine Entitaet beginnen. Ein einzelnes `&` im Text — etwa in
   * „Reinigung & Service" — ist der zweithaeufigste Grund, warum ein SVG
   * still nicht laedt.
   */
  const pruefeEntitaeten = (text: string, versatz: number): XmlFehler | null => {
    let k = text.indexOf('&');
    while (k !== -1) {
      const semikolon = text.indexOf(';', k);
      if (semikolon === -1 || semikolon === k + 1) {
        return fehler(versatz + k, 'Ein `&` ohne Entitaet — im XML muss es `&amp;` heissen.');
      }
      const name = text.slice(k + 1, semikolon);
      const gueltig = name.startsWith('#x') || name.startsWith('#X')
        ? /^#[xX][0-9a-fA-F]+$/u.test(name)
        : name.startsWith('#')
          ? /^#[0-9]+$/u.test(name)
          : ENTITAETEN.has(name);
      if (!gueltig) {
        return fehler(
          versatz + k,
          `Unbekannte Entitaet \`&${name};\` — ohne DTD kennt XML nur `
          + `${[...ENTITAETEN].map((e) => `&${e};`).join(' ')} und Zahlen.`,
        );
      }
      k = text.indexOf('&', semikolon);
    }
    return null;
  };

  while (i < inhalt.length) {
    if (inhalt[i] !== '<') {
      // ── Text ──────────────────────────────────────────────────────────
      const naechstes = inhalt.indexOf('<', i);
      const ende = naechstes === -1 ? inhalt.length : naechstes;
      const text = inhalt.slice(i, ende);
      if (stapel.length === 0 && text.trim() !== '') {
        return fehler(i, 'Text ausserhalb des Wurzelelements.');
      }
      if (text.includes(']]>')) {
        return fehler(i + text.indexOf(']]>'), 'Die Folge `]]>` darf im Text nicht stehen.');
      }
      const e = pruefeEntitaeten(text, i);
      if (e !== null) return e;
      i = ende;
      continue;
    }

    if (inhalt.startsWith('<!--', i)) {
      // ── Kommentar ─────────────────────────────────────────────────────
      const schluss = inhalt.indexOf('-->', i + 4);
      if (schluss === -1) return fehler(i, 'Kommentar wird nie geschlossen.');
      const rumpf = inhalt.slice(i + 4, schluss);
      if (rumpf.includes('--')) {
        return fehler(
          i + 4 + rumpf.indexOf('--'),
          'Doppelter Bindestrich in einem XML-Kommentar. Der Browser liefert die '
          + 'Datei mit 200 aus und zeichnet sie NICHT. Genau dieser Fehler hat die '
          + 'acht Motivtafeln unsichtbar gemacht.',
        );
      }
      if (rumpf.endsWith('-')) {
        return fehler(i + 4, 'Ein XML-Kommentar darf nicht auf einen Bindestrich enden.');
      }
      i = schluss + 3;
      continue;
    }

    if (inhalt.startsWith('<![CDATA[', i)) {
      const schluss = inhalt.indexOf(']]>', i + 9);
      if (schluss === -1) return fehler(i, 'CDATA-Abschnitt wird nie geschlossen.');
      if (stapel.length === 0) return fehler(i, 'CDATA ausserhalb des Wurzelelements.');
      i = schluss + 3;
      continue;
    }

    if (inhalt.startsWith('<!DOCTYPE', i)) {
      /**
       * Die interne Teilmenge (`<!DOCTYPE svg [ … ]>`) kann eigene Entitaeten
       * einfuehren und damit alles verschieben, was diese Wache ueber `&`
       * annimmt. Statt sie halb zu pruefen, sagt die Wache, dass sie es nicht
       * kann — lieber ein lauter Befund an einer Stelle, die es hier nicht
       * gibt, als eine stille Zusage.
       */
      const schluss = inhalt.indexOf('>', i);
      if (schluss === -1) return fehler(i, 'DOCTYPE wird nie geschlossen.');
      if (inhalt.slice(i, schluss).includes('[')) {
        return fehler(i, 'DOCTYPE mit interner Teilmenge — diese Wache kann das nicht pruefen.');
      }
      i = schluss + 1;
      continue;
    }

    if (inhalt.startsWith('<?', i)) {
      const schluss = inhalt.indexOf('?>', i + 2);
      if (schluss === -1) return fehler(i, 'Verarbeitungsanweisung wird nie geschlossen.');
      i = schluss + 2;
      continue;
    }

    if (inhalt.startsWith('<!', i)) {
      return fehler(i, 'Unbekannte Deklaration `<!…` — diese Wache kann das nicht pruefen.');
    }

    if (inhalt.startsWith('</', i)) {
      // ── Schluss-Tag ───────────────────────────────────────────────────
      let k = i + 2;
      if (k >= inhalt.length || !istNamensanfang(inhalt[k]!)) {
        return fehler(i, 'Schluss-Tag ohne Namen.');
      }
      while (k < inhalt.length && istNamenszeichen(inhalt[k]!)) k += 1;
      const name = inhalt.slice(i + 2, k);
      while (k < inhalt.length && IST_LEERRAUM(inhalt[k]!)) k += 1;
      if (inhalt[k] !== '>') return fehler(i, `Schluss-Tag \`</${name}\` ohne \`>\`.`);
      const offen = stapel.pop();
      if (offen === undefined) return fehler(i, `\`</${name}>\` ohne offenes Element.`);
      if (offen.name !== name) {
        return fehler(
          i,
          `\`</${name}>\` schliesst \`<${offen.name}>\` aus Zeile ${zeileVon(offen.pos)}.`,
        );
      }
      i = k + 1;
      continue;
    }

    // ── Start-Tag ───────────────────────────────────────────────────────
    const tagAnfang = i;
    let k = i + 1;
    if (k >= inhalt.length || !istNamensanfang(inhalt[k]!)) {
      return fehler(i, 'Ein `<` im Text — im XML muss es `&lt;` heissen.');
    }
    while (k < inhalt.length && istNamenszeichen(inhalt[k]!)) k += 1;
    const name = inhalt.slice(i + 1, k);
    if (stapel.length === 0 && wurzelGesehen) {
      return fehler(i, `Zweites Wurzelelement \`<${name}>\` — XML erlaubt genau eines.`);
    }

    const gesehen = new Set<string>();
    for (;;) {
      let leerraum = false;
      while (k < inhalt.length && IST_LEERRAUM(inhalt[k]!)) { k += 1; leerraum = true; }
      if (k >= inhalt.length) return fehler(tagAnfang, `\`<${name}\` wird nie geschlossen.`);

      if (inhalt[k] === '>') {
        stapel.push({ name, pos: tagAnfang });
        wurzelGesehen = true;
        k += 1;
        break;
      }
      if (inhalt[k] === '/') {
        if (inhalt[k + 1] !== '>') return fehler(tagAnfang, `\`<${name}\`: \`/\` ohne \`>\`.`);
        if (stapel.length === 0) wurzelGesehen = true;
        k += 2;
        break;
      }
      if (!leerraum) {
        return fehler(tagAnfang, `\`<${name}\`: Attribute brauchen Leerraum dazwischen.`);
      }

      const attrAnfang = k;
      if (!istNamensanfang(inhalt[k]!)) {
        return fehler(attrAnfang, `\`<${name}\`: \`${inhalt[k]}\` ist kein Attributname.`);
      }
      while (k < inhalt.length && istNamenszeichen(inhalt[k]!)) k += 1;
      const attr = inhalt.slice(attrAnfang, k);
      if (gesehen.has(attr)) {
        return fehler(attrAnfang, `\`<${name}\`: Attribut \`${attr}\` steht zweimal.`);
      }
      gesehen.add(attr);

      while (k < inhalt.length && IST_LEERRAUM(inhalt[k]!)) k += 1;
      if (inhalt[k] !== '=') return fehler(attrAnfang, `Attribut \`${attr}\` ohne Wert.`);
      k += 1;
      while (k < inhalt.length && IST_LEERRAUM(inhalt[k]!)) k += 1;

      const anfuehrung = inhalt[k];
      if (anfuehrung !== '"' && anfuehrung !== "'") {
        return fehler(attrAnfang, `Der Wert von \`${attr}\` steht ohne Anfuehrungszeichen.`);
      }
      const schluss = inhalt.indexOf(anfuehrung, k + 1);
      if (schluss === -1) return fehler(attrAnfang, `Der Wert von \`${attr}\` wird nie geschlossen.`);
      const wert = inhalt.slice(k + 1, schluss);
      if (wert.includes('<')) {
        return fehler(k + 1 + wert.indexOf('<'), `Ein \`<\` im Wert von \`${attr}\`.`);
      }
      const e = pruefeEntitaeten(wert, k + 1);
      if (e !== null) return e;
      k = schluss + 1;
    }
    i = k;
  }

  const offen = stapel.pop();
  if (offen !== undefined) {
    return fehler(offen.pos, `\`<${offen.name}>\` wird nie geschlossen.`);
  }
  if (!wurzelGesehen) return fehler(0, 'Kein Wurzelelement — die Datei ist kein XML.');
  return null;
}
