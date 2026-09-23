/**
 * Der EINE Kanonisierer — `cse.rechnung.v4`, RFC 8785 (JCS).
 *
 * `05-FINANZEN.md` §5.3. Diese Datei erzeugt die Bytes, die gehasht werden.
 * Es gibt sie genau einmal, und das ist keine Stilfrage: die Kette wird in
 * SQL geschrieben (`fin.rechnung_kette_schreiben`) und in TypeScript geprueft
 * (`hash-chain.ts`). Gaebe es zwei Kanonisierer, verifizierte die Kette gegen
 * keinen von beiden — und der Bruch faellt erst dem naechtlichen Lauf auf,
 * Wochen nachdem die Rechnungen aus dem Haus sind.
 *
 * **Vier Regeln, und jede verhindert einen konkreten Ausfall:**
 *
 * 1. **Betraege sind ganzzahlige Cent-JSON-Zahlen.** Kein `19.99`, nirgends.
 *    Ein Gleitkommawert ueberlebt die Rundreise `parse(stringify(x))` nicht
 *    zuverlaessig, und ein Beleg, dessen Nutzlast sich nicht byte-genau
 *    reproduzieren laesst, ist kein Beweis.
 *
 * 2. **Mengen und Dezimalsaetze sind ZEICHENKETTEN mit genau drei
 *    Nachkommastellen** (`"12.500"`). `numeric(12,3)` in eine JS-Zahl zu
 *    wandeln und zurueck ist nicht reproduzierbar; als Zeichenkette ist es
 *    exakt dasselbe, was in der Spalte steht.
 *
 * 3. **Nullwerte werden AUSGESCHRIEBEN, nie weggelassen.** Ein spaeter
 *    hinzukommendes Feld aendert damit sichtbar den Hash, statt unsichtbar
 *    zu fehlen. `undefined` ist deshalb ein FEHLER und kein stilles `null`:
 *    ein vergessenes Feld soll laut sein.
 *
 * 4. **Schluessel sortiert nach UTF-16-Codeeinheiten, Arrays in
 *    festgelegter Reihenfolge.** Das ist RFC 8785; die Array-Ordnungen
 *    (`positionen` nach `nr`, `zuschlaege` nach `(art, bezeichnung)`,
 *    `steuerzeilen` nach Gruppenschluessel …) stehen daneben, weil JCS ueber
 *    Arrays nichts sagt und zwei Abfragen ohne `order by` zwei Hashes
 *    ergaeben.
 *
 * **Was hier NICHT steht:** irgendeine Rechnung. Der Kanonisierer nimmt
 * fertige Werte entgegen und formatiert sie. Rechnen tut `steuer/satz.ts`
 * (Invariante 1, Invariante 6).
 */
import type { Cent } from './geld.js';
import { mengeNachPostgres, type MilliMenge } from './menge.js';

/**
 * Die Gestalt der Nutzlast. Sie wird erhoeht, BEVOR damit festgeschrieben
 * wird — nie danach.
 *
 * **v1 → v2 (PR 52, FIN-11).** v1 trug die Anschriften als EINE Zeile
 * (`"Musterstr. 1, 10115 Berlin, DE"`), erzeugt von `concat_ws` in der
 * Kopfabfrage. Fuer das PDF genuegt das; fuer eine XRechnung nicht. EN 16931
 * verlangt Strasse, Ort, Postleitzahl und Laendercode als EIGENE Felder
 * (BT-35, BT-37, BT-38, BT-40 — und fuer den Empfaenger BT-50, BT-52, BT-53,
 * BT-55), und die XRechnung-CIUS macht drei davon zu harten Regeln (BR-DE-3
 * bis BR-DE-5). Aus einer Zeile liessen sie sich nur RATEN — ein Komma ist
 * kein Feldtrenner, „Berlin, DE" und „Berlin" sind beide plausibel, und ein
 * falscher Laendercode macht aus einer Rechnung eine abgelehnte Rechnung.
 *
 * K-12 laesst dafuer genau einen Weg: der Snapshot ist das Dokument, also
 * muss er die Felder tragen. Deshalb eine neue Gestalt statt eines Parsers.
 *
 * **Bestehende Glieder bleiben gueltig.** Der Kettenlauf hasht
 * `rechnung_snapshot.nutzlast_bytes`, wie sie gespeichert sind; er baut die
 * Nutzlast nie neu. Eine v1-Zeile bleibt damit byte-gleich und verifiziert
 * weiter — sie traegt ihre Gestalt in `schema_version` bei sich.
 */
export const SCHEMA_VERSION = 'cse.rechnung.v4' as const;

/** Die Gestalt, mit der bis PR 52 festgeschrieben wurde. Nur noch zum Lesen. */
export const SCHEMA_VERSION_V1 = 'cse.rechnung.v1' as const;

/**
 * Die Gestalt vor V-099 — **weiterhin vollwertig lesbar**, und das ist der
 * Unterschied zu v1.
 *
 * v1 → v2 war ein echter Bruch: v1 trug die Anschrift als EINE Zeile, und
 * EN 16931 verlangt Strasse, Ort, PLZ und Laendercode einzeln. Sie daraus zu
 * zerlegen waere geraten, und ein falscher Laendercode laesst die Rechnung
 * beim Empfaenger durchfallen — eine v1-Rechnung braucht Storno und
 * Neuausstellung.
 *
 * v2 → v3 fuegt ein Feld HINZU: `leistender.fusszeile`. Eine v2-Zeile hat es
 * nicht, und das ist kein Schaden, sondern ihr Zustand — sie entstand, bevor
 * die Fusszeile ueberhaupt ein Dokument erreichte. Der Leser nimmt beide
 * Gestalten an und liest fuer v2 `null`. **Keine bestehende Kette wird
 * entwertet**, und keine Rechnung muss storniert werden.
 *
 * Wer v2 einmal wie v1 behandelt, erzwingt Stornos, die niemand braucht.
 */
export const SCHEMA_VERSION_V2 = 'cse.rechnung.v2' as const;

/**
 * Die Gestalt vor V-132 — **weiterhin vollwertig lesbar**, aus demselben
 * Grund wie v2: v3 → v4 fügt ein Feld HINZU (`leistender.logo`). Eine
 * v3-Rechnung wurde festgeschrieben, bevor ein Logo sie erreichen konnte; der
 * Leser liefert dafür `null`, und ihre Kette bleibt heil.
 */
export const SCHEMA_VERSION_V3 = 'cse.rechnung.v3' as const;

export class KanonisierungsFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'KanonisierungsFehler';
  }
}

/**
 * Was der Kanonisierer ueberhaupt annimmt.
 *
 * `bigint` steht ausdruecklich drin — Geld ist `bigint` Cent (Invariante 1),
 * und `JSON.stringify` wirft darauf. Deshalb serialisiert diese Datei selbst,
 * statt `JSON.stringify` mit sortierten Schluesseln zu fuettern.
 */
export type KanonischerWert =
  | null
  | boolean
  | number
  | bigint
  | string
  | readonly KanonischerWert[]
  | { readonly [k: string]: KanonischerWert };

/**
 * Zeichenketten nach RFC 8785: die ES-`JSON.stringify`-Escapes, und der Text
 * zuvor NFC-normalisiert.
 *
 * Ohne NFC ergeben „Müller" in zusammengesetzter und in zerlegter Form zwei
 * verschiedene Byte-Folgen und damit zwei verschiedene Hashes — derselbe
 * Kundenname, je nachdem, ueber welches Betriebssystem er einmal eingetippt
 * wurde.
 */
function zeichenkette(wert: string): string {
  return JSON.stringify(wert.normalize('NFC'));
}

function zahl(wert: number): string {
  if (!Number.isInteger(wert)) {
    throw new KanonisierungsFehler(
      `Nur ganze Zahlen sind kanonisierbar, nicht ${String(wert)} — `
      + 'Betraege sind Cent, Mengen sind Zeichenketten (§5.3).',
    );
  }
  if (!Number.isSafeInteger(wert)) {
    throw new KanonisierungsFehler(`Zahl ausserhalb des sicheren Bereichs: ${String(wert)}`);
  }
  // `-0` und `0` sind derselbe Betrag und muessen dieselben Bytes ergeben.
  return String(wert === 0 ? 0 : wert);
}

/**
 * Der Serialisierer. Rekursiv, ohne Zwischenobjekt, ohne `JSON.stringify` auf
 * der Struktur — nur auf einzelnen Zeichenketten.
 */
function schreibe(wert: KanonischerWert, pfad: string): string {
  if (wert === null) return 'null';
  if (typeof wert === 'boolean') return wert ? 'true' : 'false';
  if (typeof wert === 'bigint') return wert.toString(10);
  if (typeof wert === 'number') return zahl(wert);
  if (typeof wert === 'string') return zeichenkette(wert);

  if (Array.isArray(wert)) {
    const teile = (wert as readonly KanonischerWert[]).map(
      (w, i) => schreibe(w, `${pfad}[${String(i)}]`),
    );
    return `[${teile.join(',')}]`;
  }

  const objekt = wert as { readonly [k: string]: KanonischerWert };
  // RFC 8785: Sortierung nach UTF-16-Codeeinheiten. Genau das tut
  // `Array.prototype.sort` ohne Vergleichsfunktion — und genau deshalb steht
  // hier keine.
  const schluessel = Object.keys(objekt).sort();
  const teile = schluessel.map((k) => {
    const v = objekt[k];
    if (v === undefined) {
      throw new KanonisierungsFehler(
        `${pfad}.${k} ist undefined. Nullwerte werden AUSGESCHRIEBEN (§5.3) — `
        + 'ein weggelassenes Feld aendert den Hash unsichtbar.',
      );
    }
    return `${zeichenkette(k)}:${schreibe(v, `${pfad}.${k}`)}`;
  });
  return `{${teile.join(',')}}`;
}

/** Die kanonischen UTF-8-Bytes eines Wertes. Massgeblich ist diese Ausgabe. */
export function kanonisiere(wert: KanonischerWert): Uint8Array {
  return Buffer.from(schreibe(wert, '$'), 'utf8');
}

/** Dieselbe Ausgabe als Text — fuer Tests und Fehlermeldungen. */
export function kanonischerText(wert: KanonischerWert): string {
  return schreibe(wert, '$');
}

/**
 * `25_000n` → `"25.000"`. Die Mengenform des §5.3: drei Nachkommastellen,
 * Punkt als Trenner, nie eine JSON-Zahl.
 */
export function mengeAlsText(menge: MilliMenge | null): string | null {
  return menge === null ? null : mengeNachPostgres(menge);
}

/**
 * Ein Instant als RFC 3339 UTC mit Millisekunden.
 *
 * Ausgeschrieben und nicht `toISOString()` ueberlassen? Doch — genau das tut
 * `toISOString()`, und es haengt an keiner Zonen- oder Locale-Einstellung.
 * Was hier geprueft wird, ist die EINGABE: ein ungueltiges Datum ergaebe
 * „Invalid Date" und damit eine Nutzlast, die aussieht wie eine Nutzlast.
 */
export function instantAlsText(wert: Date | string | null): string | null {
  if (wert === null) return null;
  const d = typeof wert === 'string' ? new Date(wert) : wert;
  if (Number.isNaN(d.getTime())) {
    throw new KanonisierungsFehler(`Kein gueltiger Zeitpunkt: ${String(wert)}`);
  }
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Die Gestalt von `cse.rechnung.v1` (§5.3)
// ---------------------------------------------------------------------------

/**
 * **Identitaet wird abgebildet, nicht verwiesen** (K-12).
 *
 * Mit nur `kunde_id` und `mandant_id` als Verweis aenderte eine spaetere
 * Pflege des Kundenstamms oder der Steuernummer, was die Rechnung, die
 * XRechnung und das PDF SAGEN — waehrend die Kettenpruefung weiter
 * „intakt: true" meldet. Deshalb steht hier der Name, die Anschrift und die
 * Steuernummer, wie sie an dem Tag lauteten.
 */
/**
 * Eine Anschrift in ihren Teilen — und zusaetzlich als Zeile.
 *
 * `zeile` ist, was v1 allein trug, und sie bleibt: das PDF setzt sie, und
 * sie ist die Fassung, die ein Mensch gegenliest. Die Teile daneben sind
 * das, was EN 16931 verlangt; aus der Zeile waeren sie nur zu erraten.
 *
 * `land` ist ISO 3166-1 alpha-2 (BT-40 / BT-55) und NICHT optional — ohne
 * Laendercode ist kein EN-16931-Dokument gueltig, und ein stilles `DE` waere
 * fuer einen Kunden in Wien schlicht falsch. Woher der Wert kommt, ist
 * geklaert: `mandant.land`, `kunde.land` und `objekt.land` sind alle
 * `char(2) not null default 'DE'`.
 */
export interface Anschrift {
  /** Die einzeilige Fassung — `concat_ws`, wie v1 sie trug. */
  readonly zeile: string;
  /** BT-35 / BT-50 — Strasse samt Hausnummer. */
  readonly strasse: string | null;
  /** BT-36 / BT-51 — Adresszusatz, „c/o", Gebaeude. */
  readonly zusatz: string | null;
  /** BT-38 / BT-53. */
  readonly plz: string | null;
  /** BT-37 / BT-52. */
  readonly ort: string | null;
  /** BT-40 / BT-55 — ISO 3166-1 alpha-2. */
  readonly land: string;
}

/**
 * Der Kontakt des Leistenden (BG-6) — in der XRechnung KEIN Beiwerk.
 *
 * BR-DE-2 macht die Gruppe zur Pflicht, BR-DE-6 bis BR-DE-8 die drei Felder
 * darin. Ein Dokument ohne sie wird vom Pruefer des oeffentlichen
 * Auftraggebers abgewiesen — und das faellt erst DORT auf, an einer
 * Rechnung, die nicht mehr geaendert werden darf.
 *
 * Die Werte sind Stammdaten und werden nie erfunden: fehlt einer, nennt der
 * Bauer ihn und erzeugt nichts.
 */
export interface Kontakt {
  /** BT-41 — die Stelle, nicht zwingend ein Mensch („Buchhaltung"). */
  readonly name: string | null;
  /** BT-42. */
  readonly telefon: string | null;
  /** BT-43. */
  readonly email: string | null;
}

export interface Leistender {
  readonly id: string;
  readonly name: string;
  readonly rechtsform: string | null;
  readonly anschrift: Anschrift;
  readonly kontakt: Kontakt;
  readonly steuernummer: string | null;
  readonly ustid: string | null;
  readonly gericht: string | null;
  readonly hrb: string | null;
  readonly geschaeftsfuehrer: string | null;
  readonly eadresse: string | null;
  readonly eadresseSchema: string | null;
  /**
   * `mandant_identitaet.rechnung_fuss` — **kopiert, nie verwiesen** (K-12,
   * V-099).
   *
   * Sie war pflegbar und erreichte kein einziges Dokument: der Spaltenname
   * kam im ganzen Baum nur in der Anzeige derselben Einstellungsseite vor.
   *
   * Sie steht HIER und nicht als Verweis auf die lebende Zeile, weil eine
   * festgeschriebene Rechnung sich nicht mehr aendern darf. Wer die Fusszeile
   * ein Jahr spaeter pflegt, aenderte sonst jedes alte Dokument rueckwirkend —
   * und der Hash ueber die Nutzlast bliebe derselbe, weil er ueber die
   * Nutzlast geht und nicht ueber die Anzeige. Die Kette saehe heil aus und
   * beschriebe ein anderes Blatt.
   *
   * Neu in `cse.rechnung.v3`. Eine v2-Zeile traegt sie nicht; der Leser
   * liefert dafuer `null`.
   */
  readonly fusszeile: string | null;
  /**
   * Das Drucklogo der Gesellschaft — **festgehalten, nicht verwiesen** (K-12,
   * V-132, DESIGN §11 „each entity prints its own logo").
   *
   * Festgehalten wird der SCHLÜSSEL und die PRÜFSUMME der Datei im Behälter
   * `marke`. Beides zusammen ist so gut wie eine Kopie: der Schlüssel IST der
   * Inhalt (`<mandant>/<art>/<sha256>.<endung>`, `mi_bildpfad_eigen`), ein
   * neues Logo bekommt einen neuen Schlüssel, und nichts in diesem Behälter
   * wird je überschrieben oder gelöscht. Eine spätere Pflege der Identität
   * ändert diese Rechnung deshalb nicht — und weil die Prüfsumme in der
   * Nutzlast steht, geht sie in die Hashkette ein.
   *
   * Nur Raster (PNG, JPEG): ein SVG-Logo lässt sich in PDF/A-3 nicht ohne
   * Umrechnung einbetten, und eine Umrechnung wäre eine zweite Datei, die
   * niemand geprüft hat. `null` heisst: kein Rasterlogo hinterlegt, als die
   * Rechnung festgeschrieben wurde.
   *
   * Neu in `cse.rechnung.v4`; eine v2/v3-Zeile trägt es nicht.
   */
  readonly logo: RechnungsLogo | null;
}

/** Siehe `Leistender.logo`. */
export interface RechnungsLogo {
  readonly schluessel: string;
  readonly sha256: string;
  readonly mime: 'image/png' | 'image/jpeg';
}

export interface Empfaenger {
  readonly id: string;
  readonly name: string;
  readonly anschrift: Anschrift;
  readonly ustid: string | null;
  readonly leitwegId: string | null;
  readonly kaeuferReferenz: string | null;
  readonly bestellnummer: string | null;
  readonly eadresse: string | null;
  readonly eadresseSchema: string | null;
}

export interface Leistungsort {
  readonly id: string;
  readonly bezeichnung: string;
  readonly anschrift: Anschrift;
}

/** Eine Quelle hinter einer Position (FIN-07). In PR 46 immer leer. */
export interface Quelle {
  readonly typ: string;
  readonly id: string;
  readonly mengeAnteil: MilliMenge | null;
}

export interface Position {
  readonly nr: number;
  readonly art: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly menge: MilliMenge | null;
  readonly einheit: string | null;
  /** BT-130, UN/ECE Rec 20. NULL, solange die Zuordnung Platzhalter ist (O-174). */
  readonly einheitCode: string | null;
  readonly preisBasismenge: MilliMenge;
  readonly einzelpreisCent: Cent | null;
  readonly rabattBp: number;
  readonly nettoCent: Cent | null;
  readonly steuersatzGruppe: string;
  readonly satzBp: number;
  readonly kategorie: string;
  readonly abrechnungsart: string | null;
  readonly leistungVon: string | null;
  readonly leistungBis: string | null;
  readonly quellen: readonly Quelle[];
}

/**
 * §5.3 fuehrt in `zuschlaege` ZWEIMAL den Schluessel `satz_bp` — einmal als
 * BT-94/BT-101 (der Satz des Nachlasses) und einmal als Satz der
 * Steuergruppe. Ein JSON-Objekt kann denselben Schluessel nicht zweimal
 * tragen; die zweite Nennung ueberschriebe die erste, und welche das ist,
 * entschiede die Reihenfolge im Quelltext.
 *
 * Aufgeloest wie die TABELLE es aufloest (§4.3): `gruppe_satz_bp` und
 * `gruppe_kategorie`. Die Spaltennamen sind die eindeutige Fassung derselben
 * Aussage, also ist das die Lesart, die niemand neu erfindet.
 */
export interface Zuschlag {
  readonly art: string;
  readonly bezeichnung: string;
  readonly grundCode: string | null;
  readonly basisCent: Cent | null;
  readonly satzBp: number | null;
  readonly betragCent: Cent;
  readonly steuersatzGruppe: string;
  readonly gruppeSatzBp: number;
  readonly gruppeKategorie: string;
}

export interface Steuerzeile {
  readonly steuersatzGruppe: string;
  readonly kategorie: string;
  readonly satzBp: number;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
  readonly befreiungsgrundCode: string | null;
  readonly befreiungsgrundText: string | null;
}

/** Der Abzug eines Abschlags (FIN-08, PR 48). In PR 46 immer leer. */
export interface Abzug {
  readonly abschlagNummer: string;
  readonly steuersatzGruppe: string;
  readonly abzugNettoCent: Cent;
  readonly abzugSteuerCent: Cent;
}

export interface Freistellungsbescheinigung {
  readonly nummer: string;
  readonly finanzamt: string;
  readonly gueltigVon: string;
  readonly gueltigBis: string;
  readonly umfang: string;
}

export interface Bauabzugsteuer {
  readonly pflichtig: boolean;
  readonly satzBp: number | null;
  readonly grundlageCent: Cent | null;
  readonly einbehaltCent: Cent;
  readonly freistellungsbescheinigung: Freistellungsbescheinigung | null;
}

export interface Bankkonto {
  readonly iban: string;
  readonly bic: string | null;
  readonly kontoinhaber: string;
}

export interface Zahlungsangaben {
  /** BG-16. NULL, solange `bankkonto` nicht existiert (PR 49). */
  readonly bankkonto: Bankkonto | null;
  readonly zahlungsmittelCode: string | null;
  readonly zahlungsbedingungText: string | null;
  readonly zahlungszielTage: number | null;
  readonly faelligAm: string | null;
  readonly skontoBp: number | null;
  readonly skontoTage: number | null;
}

/** Alles, was in die Nutzlast eingeht — fertig aufgeloest, nichts verwiesen. */
export interface RechnungVollstaendig {
  readonly leistender: Leistender;
  readonly empfaenger: Empfaenger;
  readonly nummernkreisId: string;
  readonly nummer: string;
  readonly kettePosition: number;
  readonly rechnungsart: string;
  readonly rechnungsartCode: string;
  readonly rechnungsdatum: string;
  readonly leistungVon: string | null;
  readonly leistungBis: string | null;
  readonly vereinnahmungGeplantAm: string | null;
  readonly objekt: Leistungsort | null;
  readonly sprache: string;
  readonly waehrung: string;
  readonly kopftext: string | null;
  readonly fusstext: string | null;
  readonly steuerhinweis: string | null;
  readonly hinweise: readonly string[];
  readonly positionen: readonly Position[];
  readonly zuschlaege: readonly Zuschlag[];
  readonly steuerzeilen: readonly Steuerzeile[];
  readonly abzuege: readonly Abzug[];
  readonly nettoGesamtCent: Cent;
  readonly steuerGesamtCent: Cent;
  readonly bruttoCent: Cent;
  readonly abzugBruttoCent: Cent;
  readonly zahlbetragCent: Cent;
  readonly bauabzugsteuer: Bauabzugsteuer;
  readonly ueberweisungsbetragCent: Cent;
  readonly zahlung: Zahlungsangaben;
  readonly istKleinbetrag: boolean;
  readonly kleinbetragGrenzeCent: Cent | null;
  readonly reverseCharge: boolean;
  readonly reverseChargeGrundlage: string | null;
  readonly festgeschriebenAm: string;
  readonly festgeschriebenVon: string;
}

/** `positionen` nach `nr`; das ist die Ordnung des §5.3. */
function nachNr(a: Position, b: Position): number {
  return a.nr - b.nr;
}

/** Reine Codeeinheiten-Ordnung — dieselbe, nach der JCS Schluessel sortiert. */
function textOrdnung(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function nachArtBezeichnung(a: Zuschlag, b: Zuschlag): number {
  return textOrdnung(a.art, b.art) || textOrdnung(a.bezeichnung, b.bezeichnung);
}

function nachGruppe(a: Steuerzeile, b: Steuerzeile): number {
  return textOrdnung(a.steuersatzGruppe, b.steuersatzGruppe);
}

function nachAbschlag(a: Abzug, b: Abzug): number {
  return textOrdnung(a.abschlagNummer, b.abschlagNummer)
      || textOrdnung(a.steuersatzGruppe, b.steuersatzGruppe);
}

function nachTypId(a: Quelle, b: Quelle): number {
  return textOrdnung(a.typ, b.typ) || textOrdnung(a.id, b.id);
}

/** Eine Anschrift in kanonischer Form. Alle sechs Felder, immer. */
function anschriftAlsWert(a: Anschrift): KanonischerWert {
  return {
    zeile: a.zeile,
    strasse: a.strasse,
    zusatz: a.zusatz,
    plz: a.plz,
    ort: a.ort,
    land: a.land,
  };
}

/**
 * Die Nutzlast als Struktur — in der Form, die `kanonisiere` erwartet.
 *
 * Sie wird getrennt von der Serialisierung angeboten, weil
 * `rechnung_snapshot.nutzlast` (jsonb, nur zum Suchen) denselben INHALT
 * traegt und die Bytes daraus NICHT abgeleitet werden duerfen: `jsonb`
 * sortiert um und formatiert Zahlen neu.
 */
export function baueNutzlast(r: RechnungVollstaendig): KanonischerWert {
  return {
    schema: SCHEMA_VERSION,
    leistender: {
      id: r.leistender.id,
      name: r.leistender.name,
      rechtsform: r.leistender.rechtsform,
      anschrift: anschriftAlsWert(r.leistender.anschrift),
      kontakt: {
        name: r.leistender.kontakt.name,
        telefon: r.leistender.kontakt.telefon,
        email: r.leistender.kontakt.email,
      },
      steuernummer: r.leistender.steuernummer,
      ustid: r.leistender.ustid,
      gericht: r.leistender.gericht,
      hrb: r.leistender.hrb,
      geschaeftsfuehrer: r.leistender.geschaeftsfuehrer,
      eadresse: r.leistender.eadresse,
      eadresse_schema: r.leistender.eadresseSchema,
      /* K-12: KOPIERT, nicht verwiesen — neu in v3 (V-099). */
      fusszeile: r.leistender.fusszeile,
      /* K-12: Schlüssel und Prüfsumme des Drucklogos — neu in v4 (V-132). */
      logo: r.leistender.logo === null ? null : {
        schluessel: r.leistender.logo.schluessel,
        sha256: r.leistender.logo.sha256,
        mime: r.leistender.logo.mime,
      },
    },
    empfaenger: {
      id: r.empfaenger.id,
      name: r.empfaenger.name,
      anschrift: anschriftAlsWert(r.empfaenger.anschrift),
      ustid: r.empfaenger.ustid,
      leitweg_id: r.empfaenger.leitwegId,
      kaeufer_referenz: r.empfaenger.kaeuferReferenz,
      bestellnummer: r.empfaenger.bestellnummer,
      eadresse: r.empfaenger.eadresse,
      eadresse_schema: r.empfaenger.eadresseSchema,
    },
    nummernkreis_id: r.nummernkreisId,
    nummer: r.nummer,
    kette_position: r.kettePosition,
    rechnungsart: r.rechnungsart,
    rechnungsart_code: r.rechnungsartCode,
    rechnungsdatum: r.rechnungsdatum,
    leistung_von: r.leistungVon,
    leistung_bis: r.leistungBis,
    vereinnahmung_geplant_am: r.vereinnahmungGeplantAm,
    objekt: r.objekt === null ? null : {
      id: r.objekt.id,
      bezeichnung: r.objekt.bezeichnung,
      anschrift: anschriftAlsWert(r.objekt.anschrift),
    },
    sprache: r.sprache,
    waehrung: r.waehrung,
    kopftext: r.kopftext,
    fusstext: r.fusstext,
    steuerhinweis: r.steuerhinweis,
    hinweise: [...r.hinweise],
    positionen: [...r.positionen].sort(nachNr).map((p) => ({
      nr: p.nr,
      art: p.art,
      bezeichnung: p.bezeichnung,
      beschreibung: p.beschreibung,
      menge: mengeAlsText(p.menge),
      einheit: p.einheit,
      einheit_code: p.einheitCode,
      preis_basismenge: mengeAlsText(p.preisBasismenge),
      einzelpreis_cent: p.einzelpreisCent,
      rabatt_bp: p.rabattBp,
      netto_cent: p.nettoCent,
      steuersatz_gruppe: p.steuersatzGruppe,
      satz_bp: p.satzBp,
      kategorie: p.kategorie,
      abrechnungsart: p.abrechnungsart,
      leistung_von: p.leistungVon,
      leistung_bis: p.leistungBis,
      quellen: [...p.quellen].sort(nachTypId).map((q) => ({
        typ: q.typ,
        id: q.id,
        menge_anteil: mengeAlsText(q.mengeAnteil),
      })),
    })),
    zuschlaege: [...r.zuschlaege].sort(nachArtBezeichnung).map((z) => ({
      art: z.art,
      bezeichnung: z.bezeichnung,
      grund_code: z.grundCode,
      basis_cent: z.basisCent,
      satz_bp: z.satzBp,
      betrag_cent: z.betragCent,
      steuersatz_gruppe: z.steuersatzGruppe,
      gruppe_satz_bp: z.gruppeSatzBp,
      gruppe_kategorie: z.gruppeKategorie,
    })),
    steuerzeilen: [...r.steuerzeilen].sort(nachGruppe).map((s) => ({
      steuersatz_gruppe: s.steuersatzGruppe,
      kategorie: s.kategorie,
      satz_bp: s.satzBp,
      netto_cent: s.nettoCent,
      steuer_cent: s.steuerCent,
      befreiungsgrund_code: s.befreiungsgrundCode,
      befreiungsgrund_text: s.befreiungsgrundText,
    })),
    abzuege: [...r.abzuege].sort(nachAbschlag).map((a) => ({
      abschlag_nummer: a.abschlagNummer,
      steuersatz_gruppe: a.steuersatzGruppe,
      abzug_netto_cent: a.abzugNettoCent,
      abzug_steuer_cent: a.abzugSteuerCent,
    })),
    netto_gesamt_cent: r.nettoGesamtCent,
    steuer_gesamt_cent: r.steuerGesamtCent,
    brutto_cent: r.bruttoCent,
    abzug_brutto_cent: r.abzugBruttoCent,
    zahlbetrag_cent: r.zahlbetragCent,
    bauabzugsteuer: {
      pflichtig: r.bauabzugsteuer.pflichtig,
      satz_bp: r.bauabzugsteuer.satzBp,
      grundlage_cent: r.bauabzugsteuer.grundlageCent,
      einbehalt_cent: r.bauabzugsteuer.einbehaltCent,
      freistellungsbescheinigung: r.bauabzugsteuer.freistellungsbescheinigung === null ? null : {
        nummer: r.bauabzugsteuer.freistellungsbescheinigung.nummer,
        finanzamt: r.bauabzugsteuer.freistellungsbescheinigung.finanzamt,
        gueltig_von: r.bauabzugsteuer.freistellungsbescheinigung.gueltigVon,
        gueltig_bis: r.bauabzugsteuer.freistellungsbescheinigung.gueltigBis,
        umfang: r.bauabzugsteuer.freistellungsbescheinigung.umfang,
      },
    },
    ueberweisungsbetrag_cent: r.ueberweisungsbetragCent,
    zahlung: {
      bankkonto: r.zahlung.bankkonto === null ? null : {
        iban: r.zahlung.bankkonto.iban,
        bic: r.zahlung.bankkonto.bic,
        kontoinhaber: r.zahlung.bankkonto.kontoinhaber,
      },
      zahlungsmittel_code: r.zahlung.zahlungsmittelCode,
      zahlungsbedingung_text: r.zahlung.zahlungsbedingungText,
      zahlungsziel_tage: r.zahlung.zahlungszielTage,
      faellig_am: r.zahlung.faelligAm,
      skonto_bp: r.zahlung.skontoBp,
      skonto_tage: r.zahlung.skontoTage,
    },
    ist_kleinbetrag: r.istKleinbetrag,
    kleinbetrag_grenze_cent: r.kleinbetragGrenzeCent,
    reverse_charge: r.reverseCharge,
    reverse_charge_grundlage: r.reverseChargeGrundlage,
    festgeschrieben_am: r.festgeschriebenAm,
    festgeschrieben_von: r.festgeschriebenVon,
  };
}

/**
 * Die kanonischen Bytes einer Rechnung — die EINE Hasheingabe der Plattform.
 *
 * Sie kann erst nach dem Zug der Nummer gebaut werden: `nummer` und
 * `kette_position` stehen darin. Genau deshalb ist die Festschreibung in zwei
 * Definer-Aufrufe geteilt (§5.6) und nicht in einen.
 */
export function buildKanonischePayload(r: RechnungVollstaendig): Uint8Array {
  if (r.nummer === '' || r.kettePosition <= 0) {
    throw new KanonisierungsFehler(
      'Nutzlast ohne Nummer oder ohne Kettenposition — sie wird NACH dem Zug '
      + 'gebaut, nicht davor (§5.6).',
    );
  }
  return kanonisiere(baueNutzlast(r));
}
