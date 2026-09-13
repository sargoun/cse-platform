/**
 * CAMT.053 einlesen (ACC-04, `05-FINANZEN.md` §7.4, PR 61).
 *
 * **Es gibt keine Bankanbindung, und es wird keine vorgetäuscht.** Kein
 * PSD2, kein FinTS, keine ausgehende SEPA-Datei. Die Bank stellt einen
 * Kontoauszug als XML bereit, ein Mensch lädt ihn hoch, und diese Datei liest
 * ihn. Mehr behauptet die Plattform nicht.
 *
 * **Diese Datei ist rein.** Sie bekommt XML-Text und gibt Zeilen zurück; sie
 * kennt keine Datenbank, keinen offenen Posten und keine Zuordnung. Der
 * Abgleich ist ein eigener Schritt, und dass er getrennt ist, ist der Grund,
 * warum sich hier jeder Grenzfall ohne Fixtur prüfen lässt.
 *
 * **Beträge werden in ganze Cent gelesen, ohne Fliesskommaschritt**
 * (Invariante 1). `parseFloat('1234.56') * 100` ergibt `123455.99999999999`,
 * und das ist der Fehler, der in einem Kontoauszug erst beim Abgleich
 * auffällt — als Differenz von einem Cent, die niemand erklären kann.
 * Gelesen wird über Zeichenketten.
 *
 * **Die Richtung steht in `CdtDbtInd`, nie im Vorzeichen.** CAMT führt
 * Beträge positiv und nennt daneben `CRDT` (Eingang) oder `DBIT` (Ausgang).
 * Ein Minuszeichen im Betrag wäre ein Formatfehler; die Datei weist ihn ab,
 * statt ihn zu deuten.
 */

export class CamtFehler extends Error {
  constructor(nachricht: string, readonly grund: 'kein_xml' | 'kein_auszug' | 'feld') {
    super(nachricht);
    this.name = 'CamtFehler';
  }
}

export type Richtung = 'eingang' | 'ausgang';

/**
 * **Die Währung ist EUR, und das ist eine Entscheidung, keine Annahme.**
 *
 * Das `Ccy`-Attribut steht am Betrag, und dieser Leser wirft Attribute weg —
 * absichtlich, denn Attribute sind die Stelle, an der ein XML-Leser
 * kompliziert wird. `zahlung.waehrung` ist ohnehin auf EUR beschränkt (0121),
 * ein Auszug in anderer Währung liesse sich also gar nicht speichern.
 *
 * TODO(client, O-05): Fremdwährung. Sobald sie ein Fall wird, braucht der
 * Leser Attribute UND `zahlung` eine zweite Spalte — beides zusammen, sonst
 * steht ein Dollarbetrag als Euro in der Buchhaltung.
 */
const WAEHRUNG = 'EUR' as const;

export interface CamtUmsatz {
  /** `EndToEndId`, `TxId` oder `NtryRef` — die Kennung, an der Doppelte hängen. */
  readonly referenz: string | null;
  readonly betragCent: bigint;
  readonly waehrung: string;
  readonly richtung: Richtung;
  /** Buchungstag, ISO. */
  readonly buchungsdatum: string;
  /** Wertstellung, ISO. `null`, wenn der Auszug sie nicht nennt. */
  readonly valuta: string | null;
  /** Der Verwendungszweck, zusammengesetzt aus allen `Ustrd`-Zeilen. */
  readonly verwendungszweck: string;
  readonly gegenpartei: string | null;
  readonly gegenIban: string | null;
  /** Nur gebuchte Zeilen zählen; `PDNG` ist eine Vormerkung. */
  readonly gebucht: boolean;
}

export interface CamtAuszug {
  /** `Stmt/Id` — die Auszugskennung der Bank. */
  readonly auszugId: string;
  readonly iban: string | null;
  readonly waehrung: string | null;
  readonly von: string | null;
  readonly bis: string | null;
  readonly anfangssaldoCent: bigint | null;
  readonly endsaldoCent: bigint | null;
  readonly umsaetze: readonly CamtUmsatz[];
}

// ---------------------------------------------------------------------------
// Ein kleiner XML-Leser — genug für CAMT, und nichts darüber hinaus
// ---------------------------------------------------------------------------

interface Knoten {
  readonly name: string;
  readonly text: string;
  readonly kinder: readonly Knoten[];
}

/**
 * **Warum kein XML-Paket.** Node bringt keinen DOM mit, und die verbreiteten
 * Pakete lösen Entitäten und externe Referenzen auf — genau das, womit eine
 * XXE-Lücke entsteht, wenn jemand einen Kontoauszug hochlädt, den er nicht
 * selbst geschrieben hat.
 *
 * Dieser Leser kennt Elemente, Text und die fünf vordefinierten Entitäten.
 * `<!DOCTYPE` und `<!ENTITY` weist er ab, statt sie zu ignorieren: eine Datei,
 * die eine Entität deklariert, ist kein Kontoauszug, und sie stillschweigend
 * zu lesen hiesse, die Absicht dahinter nicht zu bemerken.
 */
export function leseXml(text: string): Knoten {
  if (/<!DOCTYPE/iu.test(text) || /<!ENTITY/iu.test(text)) {
    throw new CamtFehler(
      'Die Datei deklariert eine DTD oder eine Entität. Ein Kontoauszug tut '
      + 'das nicht; sie wird abgewiesen.',
      'kein_xml');
  }

  /*
   * **CDATA wird VOR dem Zerlegen aufgeloest, nicht danach.**
   *
   * Ein `<![CDATA[RE & 17 < 20]]>` enthaelt ein `<`, und der Markenausdruck
   * unten sieht darin den Anfang einer Marke: die Zeile zerfaellt, und der
   * Leser meldet eine nicht geschlossene Marke, wo ein voellig
   * regelkonformer Verwendungszweck stand. Ein Test hat genau das gefunden.
   *
   * Der Inhalt wird dabei ESCAPED und nicht roh eingesetzt — sonst haette ein
   * `<Ntry>` innerhalb eines CDATA-Blocks einen Umsatz erfunden.
   */
  const ohneProlog = text
    .replace(/<\?[\s\S]*?\?>/gu, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu,
      (_, inhalt: string) => inhalt
        .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;'));

  const marken = /<\s*([^!?\s/>]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\s*\/\s*([^\s>]+)\s*>/gu;
  const stapel: { name: string; text: string; kinder: Knoten[] }[] = [];
  let wurzel: Knoten | null = null;
  let letzte = 0;
  let treffer: RegExpExecArray | null;

  const roh = (s: string): string => s
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"').replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, n: string) => String.fromCodePoint(Number(n)))
    /* `&amp;` ZULETZT — sonst würde `&amp;lt;` zu `<` statt zu `&lt;`. */
    .replace(/&amp;/gu, '&');

  while ((treffer = marken.exec(ohneProlog)) !== null) {
    const zwischen = ohneProlog.slice(letzte, treffer.index);
    letzte = marken.lastIndex;
    const oben = stapel[stapel.length - 1];
    if (oben !== undefined && zwischen.trim() !== '') oben.text += roh(zwischen);

    const schliessend = treffer[4];
    if (schliessend !== undefined) {
      const fertig = stapel.pop();
      if (fertig === undefined || fertig.name !== schliessend) {
        throw new CamtFehler(
          `Die Marke </${schliessend}> passt zu keiner offenen.`, 'kein_xml');
      }
      const knoten: Knoten = {
        name: fertig.name, text: fertig.text.trim(), kinder: fertig.kinder,
      };
      const eltern = stapel[stapel.length - 1];
      if (eltern === undefined) wurzel = knoten; else eltern.kinder.push(knoten);
      continue;
    }

    /* Der Namensraum interessiert nicht — `urn:iso:std:…:camt.053` ist fix. */
    const name = (treffer[1] ?? '').replace(/^[^:]+:/u, '');
    if (treffer[3] === '/') {
      const leer: Knoten = { name, text: '', kinder: [] };
      const eltern = stapel[stapel.length - 1];
      if (eltern === undefined) wurzel = leer; else eltern.kinder.push(leer);
      continue;
    }
    stapel.push({ name, text: '', kinder: [] });
  }

  if (stapel.length > 0) {
    throw new CamtFehler(
      `Die Marke <${stapel[stapel.length - 1]!.name}> wurde nicht geschlossen.`,
      'kein_xml');
  }
  if (wurzel === null) throw new CamtFehler('Die Datei enthält kein XML.', 'kein_xml');
  return wurzel;
}

/** Das erste Kind mit diesem Namen, beliebig tief. */
function tief(k: Knoten, name: string): Knoten | null {
  for (const kind of k.kinder) {
    if (kind.name === name) return kind;
    const treffer = tief(kind, name);
    if (treffer !== null) return treffer;
  }
  return null;
}

/** Alle Nachfahren mit diesem Namen, in Dokumentreihenfolge. */
function alle(k: Knoten, name: string): Knoten[] {
  const treffer: Knoten[] = [];
  for (const kind of k.kinder) {
    if (kind.name === name) treffer.push(kind);
    treffer.push(...alle(kind, name));
  }
  return treffer;
}

function text(k: Knoten | null): string | null {
  return k === null || k.text === '' ? null : k.text;
}

// ---------------------------------------------------------------------------
// Betrag und Datum
// ---------------------------------------------------------------------------

/**
 * `"1234.56"` → `123456n`. Über Zeichenketten, nie über `Number`.
 *
 * CAMT schreibt den Punkt als Dezimaltrenner und höchstens zwei
 * Nachkommastellen für EUR. Mehr als zwei werden NICHT gerundet, sondern
 * abgewiesen: ein Auszug mit drei Stellen ist keiner, den diese Plattform
 * versteht, und eine stille Rundung wäre eine erfundene Zahl.
 */
export function centAus(roh: string): bigint {
  const wert = roh.trim();
  const treffer = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(wert);
  if (treffer === null) {
    if (/^-/u.test(wert)) {
      throw new CamtFehler(
        `Der Betrag "${wert}" trägt ein Vorzeichen. CAMT führt Beträge positiv; `
        + 'die Richtung steht in CdtDbtInd.',
        'feld');
    }
    throw new CamtFehler(`"${wert}" ist kein CAMT-Betrag.`, 'feld');
  }
  const ganze = treffer[1]!;
  const nach = (treffer[2] ?? '').padEnd(2, '0');
  return BigInt(ganze + nach);
}

/** `2026-08-15T10:03:00+02:00` → `2026-08-15`. CAMT führt beide Formen. */
export function datumAus(roh: string | null): string | null {
  if (roh === null) return null;
  const treffer = /^(\d{4}-\d{2}-\d{2})/u.exec(roh.trim());
  return treffer === null ? null : treffer[1]!;
}

// ---------------------------------------------------------------------------
// Der Auszug
// ---------------------------------------------------------------------------

export function leseCamt053(xml: string): CamtAuszug {
  const wurzel = leseXml(xml);
  const stmt = tief(wurzel, 'Stmt');
  if (stmt === null) {
    throw new CamtFehler(
      'Die Datei enthält kein <Stmt> — sie ist kein CAMT.053-Kontoauszug. '
      + 'CAMT.052 (Zwischensaldo) und CAMT.054 (Avis) werden nicht gelesen.',
      'kein_auszug');
  }

  const auszugId = text(tief(stmt, 'Id'));
  if (auszugId === null) {
    throw new CamtFehler('Dem Auszug fehlt seine Kennung <Id>.', 'kein_auszug');
  }

  const konto = tief(stmt, 'Acct');
  const iban = konto === null ? null : text(tief(konto, 'IBAN'));
  const waehrung = konto === null ? null : text(tief(konto, 'Ccy'));

  const zeitraum = tief(stmt, 'FrToDt');
  const von = zeitraum === null ? null : datumAus(text(tief(zeitraum, 'FrDtTm')));
  const bis = zeitraum === null ? null : datumAus(text(tief(zeitraum, 'ToDtTm')));

  const saldo = (art: string): bigint | null => {
    for (const b of alle(stmt, 'Bal')) {
      if (text(tief(b, 'Cd')) !== art) continue;
      const betrag = text(tief(b, 'Amt'));
      if (betrag === null) continue;
      const cent = centAus(betrag);
      /* Ein Sollsaldo ist negativ — hier steht die Richtung im Vorzeichen. */
      return text(tief(b, 'CdtDbtInd')) === 'DBIT' ? -cent : cent;
    }
    return null;
  };

  const umsaetze: CamtUmsatz[] = [];
  for (const ntry of alle(stmt, 'Ntry')) {
    umsaetze.push(...leseEintrag(ntry));
  }

  return {
    auszugId,
    iban,
    waehrung,
    von,
    bis,
    /* `OPBD`/`CLBD` sind die Eröffnungs- und Schlusssalden des Tages. */
    anfangssaldoCent: saldo('OPBD'),
    endsaldoCent: saldo('CLBD'),
    umsaetze,
  };
}

/**
 * Ein `<Ntry>` kann MEHRERE Einzelumsätze tragen (`TxDtls`) — eine
 * Sammelbuchung.
 *
 * Das ist der Normalfall bei einem Lastschrifteinzug und der Grund, warum
 * hier eine Liste zurückkommt: den Sammelbetrag als EINEN Umsatz zu führen
 * hiesse, dass keine einzelne Rechnung je einen Treffer bekäme.
 *
 * Trägt der Eintrag keine Einzelheiten, ist er selbst der Umsatz.
 */
function leseEintrag(ntry: Knoten): CamtUmsatz[] {
  const gebucht = text(tief(ntry, 'Sts')) !== 'PDNG';
  const richtung: Richtung = text(tief(ntry, 'CdtDbtInd')) === 'DBIT'
    ? 'ausgang' : 'eingang';

  const buchungsdatum = datumAus(text(tief(tief(ntry, 'BookgDt') ?? ntry, 'Dt')))
    ?? datumAus(text(tief(tief(ntry, 'BookgDt') ?? ntry, 'DtTm')));
  if (buchungsdatum === null) {
    throw new CamtFehler('Einem Umsatz fehlt sein Buchungstag <BookgDt>.', 'feld');
  }
  const valDt = tief(ntry, 'ValDt');
  const valuta = valDt === null ? null
    : (datumAus(text(tief(valDt, 'Dt'))) ?? datumAus(text(tief(valDt, 'DtTm'))));

  const betragKnoten = tief(ntry, 'Amt');
  if (betragKnoten === null) {
    throw new CamtFehler('Einem Umsatz fehlt sein Betrag <Amt>.', 'feld');
  }
  const eintragWaehrung = WAEHRUNG;
  const ntryRef = text(tief(ntry, 'NtryRef'));

  const details = alle(ntry, 'TxDtls');
  if (details.length === 0) {
    return [{
      referenz: ntryRef,
      betragCent: centAus(betragKnoten.text),
      waehrung: eintragWaehrung,
      richtung,
      buchungsdatum,
      valuta,
      verwendungszweck: zweckAus(ntry),
      gegenpartei: gegenparteiAus(ntry, richtung),
      gegenIban: gegenIbanAus(ntry, richtung),
      gebucht,
    }];
  }

  return details.map((d) => {
    const betrag = tief(d, 'Amt');
    return {
      referenz: text(tief(d, 'EndToEndId')) ?? text(tief(d, 'TxId')) ?? ntryRef,
      betragCent: centAus(betrag?.text ?? betragKnoten.text),
      waehrung: eintragWaehrung,
      richtung,
      buchungsdatum,
      valuta,
      verwendungszweck: zweckAus(d),
      gegenpartei: gegenparteiAus(d, richtung),
      gegenIban: gegenIbanAus(d, richtung),
      gebucht,
    };
  });
}

/** Alle `Ustrd`-Zeilen, mit Leerzeichen verbunden — so steht es auf dem Beleg. */
function zweckAus(k: Knoten): string {
  const zeilen = alle(k, 'Ustrd').map((u) => u.text).filter((t) => t !== '');
  if (zeilen.length > 0) return zeilen.join(' ');
  return text(tief(k, 'AddtlNtryInf')) ?? '';
}

/** Bei einem Eingang ist die Gegenpartei der Zahler (`Dbtr`), sonst `Cdtr`. */
function gegenparteiAus(k: Knoten, richtung: Richtung): string | null {
  const seite = tief(k, richtung === 'eingang' ? 'Dbtr' : 'Cdtr');
  return seite === null ? null : text(tief(seite, 'Nm'));
}

function gegenIbanAus(k: Knoten, richtung: Richtung): string | null {
  const konto = tief(k, richtung === 'eingang' ? 'DbtrAcct' : 'CdtrAcct');
  return konto === null ? null : text(tief(konto, 'IBAN'));
}
